/**
 * ElectronPortHandler — Phase 1 transport replacement for feetech.js PortHandler.
 *
 * Drop-in replacement for the `PortHandler` class from `lowLevelSDK.mjs`.
 * Instead of using `navigator.serial` (Web Serial API) it routes all I/O
 * through the Electron IPC bridge (`window.electron.serial`), which in turn
 * uses the `serialport` npm package in the main process.
 *
 * Usage (via ScsServoSDK portHandlerFactory option):
 *
 *   import { ElectronPortHandler } from '@/lib/ElectronPortHandler';
 *
 *   await sdk.connect({
 *     portHandlerFactory: () => new ElectronPortHandler({ portPath: '/dev/ttyUSB0' }),
 *   });
 *
 * If `portPath` is omitted, `requestPort()` will auto-select the first
 * available serial port returned by the main process.  Pass `portIndex` to
 * select a specific port by its position in the list (e.g. 1 for the second
 * port when connecting a leader + follower simultaneously).
 */

// ── Constants (mirrored from lowLevelSDK.mjs) ────────────────────────────────

const DEFAULT_BAUDRATE = 1_000_000;
// Reduced from 16 → 4: the original 16 ms was sized for Web Serial browser
// polling overhead.  With native serialport + IPC push, 4 ms is sufficient.
const LATENCY_TIMER = 4;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ElectronPortHandlerOptions {
  /** Pre-configured port path (e.g. "COM3", "/dev/ttyUSB0").
   *  If omitted, requestPort() will auto-select based on portIndex. */
  portPath?: string;
  /** When portPath is omitted, use this index from the discovered port list.
   *  Defaults to 0 (first available port). */
  portIndex?: number;
  /** Read timeout in ms for a single readPort() call. Default: 500 ms. */
  readTimeoutMs?: number;
}

// ── ElectronPortHandler ──────────────────────────────────────────────────────

export class ElectronPortHandler {
  // ── Public state (read by PacketHandler / GroupSync* internals) ────────────
  isOpen = false;
  isUsing = false;
  baudrate = DEFAULT_BAUDRATE;
  packetStartTime = 0;
  packetTimeout = 0;
  txTimePerByte = 0;
  readTimeoutMs: number;
  /** Poll interval used in legacy Web Serial readPort — not used here but
   *  kept for API compatibility with PortHandler. */
  readPollMs = 10;

  // ── Private ────────────────────────────────────────────────────────────────
  private portPath: string | null;
  private portIndex: number;

  /** Bytes received from main process via SERIAL_ON_DATA pushed here. */
  private rxBuffer: number[] = [];
  /** Resolvers woken when new bytes arrive in rxBuffer. */
  private rxWaiters: Array<() => void> = [];
  /** Cleanup function returned by window.electron.serial.onData(). */
  private unsubscribeData: (() => void) | null = null;
  /** Cleanup function returned by window.electron.serial.onError(). */
  private unsubscribeError: (() => void) | null = null;

  constructor(opts: ElectronPortHandlerOptions = {}) {
    this.portPath = opts.portPath ?? null;
    this.portIndex = opts.portIndex ?? 0;
    this.readTimeoutMs = opts.readTimeoutMs ?? 500;
  }

  // ── Public port-lifecycle API (mirrors PortHandler) ───────────────────────

  /**
   * Discovers available serial ports and stores the path for later use.
   * If portPath was provided in the constructor it is validated against the
   * discovered list; otherwise the port at portIndex is selected.
   */
  async requestPort(): Promise<boolean> {
    try {
      const ports = await window.electron.serial.listPorts();
      if (ports.length === 0) {
        console.error("[ElectronPortHandler] No serial ports found");
        return false;
      }

      if (this.portPath) {
        // Validate that the pre-configured path exists in the list
        const found = ports.find((p) => p.path === this.portPath);
        if (!found) {
          console.warn(
            `[ElectronPortHandler] Configured port "${this.portPath}" not found in port list. ` +
              `Available: ${ports.map((p) => p.path).join(", ")}`
          );
          // Fall back to portIndex selection
          this.portPath = ports[this.portIndex]?.path ?? ports[0].path;
          console.log(`[ElectronPortHandler] Falling back to "${this.portPath}"`);
        }
      } else {
        const idx = Math.min(this.portIndex, ports.length - 1);
        this.portPath = ports[idx].path;
        console.log(
          `[ElectronPortHandler] Auto-selected port[${idx}]: "${this.portPath}" ` +
            `(${ports[idx].manufacturer ?? "unknown manufacturer"})`
        );
      }

      return true;
    } catch (err) {
      console.error("[ElectronPortHandler] requestPort error:", err);
      return false;
    }
  }

  /**
   * Opens the serial port via IPC and subscribes to streaming data events.
   */
  async openPort(): Promise<boolean> {
    if (!this.portPath) {
      console.error("[ElectronPortHandler] openPort called before requestPort");
      return false;
    }

    try {
      await window.electron.serial.connect({ path: this.portPath, baudRate: this.baudrate });

      // Subscribe to streaming data — fills rxBuffer and wakes pending reads
      this.unsubscribeData = window.electron.serial.onData(this.portPath, (bytes) => {
        this.rxBuffer.push(...bytes);
        const pending = this.rxWaiters.splice(0);
        for (const wake of pending) wake();
      });

      // Subscribe to error events
      this.unsubscribeError = window.electron.serial.onError(this.portPath, (error) => {
        console.error(`[ElectronPortHandler] serial error on ${this.portPath}:`, error);
      });

      this.txTimePerByte = (1000.0 / this.baudrate) * 10.0;
      this.isOpen = true;
      console.log(`[ElectronPortHandler] Opened "${this.portPath}" @ ${this.baudrate} baud`);
      return true;
    } catch (err) {
      console.error("[ElectronPortHandler] openPort error:", err);
      return false;
    }
  }

  /**
   * Closes the port and cleans up subscriptions.
   */
  async closePort(): Promise<void> {
    if (this.unsubscribeData) {
      this.unsubscribeData();
      this.unsubscribeData = null;
    }
    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }

    if (this.portPath && this.isOpen) {
      try {
        await window.electron.serial.disconnect(this.portPath);
      } catch (err) {
        console.warn("[ElectronPortHandler] closePort error:", err);
      }
    }

    this.isOpen = false;
    this.isUsing = false;
    this.rxBuffer = [];
    // Wake any blocked readPort() calls so they can return empty
    const pending = this.rxWaiters.splice(0);
    for (const wake of pending) wake();
  }

  /**
   * Flushes the local and main-process RX buffers before sending a new packet.
   * Mirrors PortHandler.clearPort() in the Web Serial implementation.
   */
  async clearPort(): Promise<void> {
    // Only clear the local rxBuffer.  The main-process buffer (serial.ts) is
    // never read by ElectronPortHandler — data arrives via the onData push
    // channel — so the flushRx IPC round-trip was pure overhead (~5-10 ms per
    // call, multiplied by every txPacket invocation).
    this.rxBuffer = [];
    const pending = this.rxWaiters.splice(0);
    for (const wake of pending) wake();
  }

  // ── Baud rate ─────────────────────────────────────────────────────────────

  setBaudRate(baudrate: number): boolean {
    this.baudrate = baudrate;
    this.txTimePerByte = (1000.0 / baudrate) * 10.0;    // Propagate to the physical port via IPC when connected.
    if (this.isOpen && this.portPath) {
      window.electron.serial.setBaudRate(this.portPath, baudrate).catch((err) => {
        console.error("[ElectronPortHandler] setBaudRate IPC error:", err);
      });
    }    return true;
  }

  getBaudRate(): number {
    return this.baudrate;
  }

  // ── I/O ───────────────────────────────────────────────────────────────────

  /**
   * Write raw bytes to the port.
   * Returns the number of bytes written (or 0 on failure).
   */
  async writePort(data: number[]): Promise<number> {
    if (!this.isOpen || !this.portPath) return 0;
    try {
      await window.electron.serial.write(this.portPath, data);
      return data.length;
    } catch (err) {
      console.error("[ElectronPortHandler] writePort error:", err);
      return 0;
    }
  }

  /**
   * Read up to `length` bytes from the local RX buffer.
   *
   * The buffer is continuously filled by the `onData` subscription set up in
   * `openPort()`.  This method waits up to `readTimeoutMs` for enough bytes to
   * arrive, then returns whatever is available (may be fewer than `length`).
   */
  async readPort(length: number): Promise<number[]> {
    if (!this.isOpen) return [];

    const deadline = performance.now() + this.readTimeoutMs;

    while (this.rxBuffer.length < length && performance.now() < deadline) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;

      await new Promise<void>((resolve) => {
        // 1 ms fallback poll — data normally arrives via rxWaiter wake-up so
        // the timer rarely fires.  Reduced from 5 ms to avoid stalling the
        // control loop when the wake-up fires between event-loop ticks.
        const timer = setTimeout(resolve, Math.min(1, remaining));
        this.rxWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    return this.rxBuffer.splice(0, Math.min(length, this.rxBuffer.length));
  }

  // ── Packet timing (unchanged from PortHandler) ────────────────────────────

  setPacketTimeout(packetLength: number): void {
    this.packetStartTime = this.getCurrentTime();
    this.packetTimeout =
      this.txTimePerByte * packetLength + LATENCY_TIMER * 2.0 + 2.0;
  }

  setPacketTimeoutMillis(msec: number): void {
    this.packetStartTime = this.getCurrentTime();
    this.packetTimeout = msec;
  }

  isPacketTimeout(): boolean {
    if (this.getTimeSinceStart() > this.packetTimeout) {
      this.packetTimeout = 0;
      return true;
    }
    return false;
  }

  getCurrentTime(): number {
    return performance.now();
  }

  getTimeSinceStart(): number {
    const elapsed = this.getCurrentTime() - this.packetStartTime;
    if (elapsed < 0) {
      this.packetStartTime = this.getCurrentTime();
      return 0;
    }
    return elapsed;
  }
}
