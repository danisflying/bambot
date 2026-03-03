/**
 * Serial IPC handlers — Phase 1 implementation.
 *
 * Uses the `serialport` npm package (native Node.js binding) instead of the
 * browser Web Serial API. Each open port is tracked in PortManager with a
 * byte-level read buffer. Incoming bytes are both buffered locally (for
 * SERIAL_READ request/response) and pushed to the renderer via SERIAL_ON_DATA
 * events so the ElectronPortHandler can maintain its own streaming buffer.
 */
import { ipcMain, BrowserWindow } from "electron";
import { SerialPort } from "serialport";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { SerialConnectOptions } from "../../shared/types";

// ── Per-port state ───────────────────────────────────────────────────────────

interface PortState {
  port: SerialPort;
  buffer: number[];
  /** Callbacks that are woken up whenever new bytes arrive */
  waiters: Array<() => void>;
}

const openPorts = new Map<string, PortState>();

/** Push new bytes into a port's buffer and wake any pending read() waiters. */
function pushBytes(state: PortState, bytes: Buffer | number[]): void {
  for (const b of bytes) state.buffer.push(b);
  const pending = state.waiters.splice(0);
  for (const wake of pending) wake();
}

/**
 * Dequeue up to `length` bytes from the port buffer, waiting at most
 * `timeoutMs` for bytes to arrive.
 */
async function dequeue(state: PortState, length: number, timeoutMs = 500): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;

  while (state.buffer.length < length && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, Math.min(20, remaining));
      state.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  return state.buffer.splice(0, Math.min(length, state.buffer.length));
}

/** Broadcast a serial data event to all open renderer windows. */
function broadcastData(portPath: string, data: number[]): void {
  const payload = { path: portPath, data };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SERIAL_ON_DATA, payload);
    }
  }
}

/** Broadcast a serial error event to all open renderer windows. */
function broadcastError(portPath: string, error: string): void {
  const payload = { path: portPath, error };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SERIAL_ON_ERROR, payload);
    }
  }
}

// ── IPC registration ─────────────────────────────────────────────────────────

export function registerSerialIPC(): void {
  // ── List available ports ──────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERIAL_LIST_PORTS, async () => {
    try {
      const ports = await SerialPort.list();
      console.log(`[serial] listPorts → ${ports.length} port(s) found`);
      return ports;
    } catch (err) {
      console.error("[serial] listPorts error:", err);
      return [];
    }
  });

  // ── Open a port ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERIAL_CONNECT, async (_event, opts: SerialConnectOptions) => {
    const { path, baudRate } = opts;

    if (openPorts.has(path)) {
      console.log(`[serial] connect: ${path} already open`);
      return; // idempotent
    }

    return new Promise<void>((resolve, reject) => {
      const port = new SerialPort({ path, baudRate, autoOpen: false });

      const state: PortState = { port, buffer: [], waiters: [] };

      port.on("data", (chunk: Buffer) => {
        const bytes = Array.from(chunk);
        pushBytes(state, bytes);
        broadcastData(path, bytes);
      });

      port.on("error", (err: Error) => {
        console.error(`[serial] error on ${path}:`, err.message);
        broadcastError(path, err.message);
      });

      port.on("close", () => {
        console.log(`[serial] port closed: ${path}`);
        openPorts.delete(path);
      });

      port.open((err) => {
        if (err) {
          console.error(`[serial] failed to open ${path}:`, err.message);
          reject(new Error(`Failed to open ${path}: ${err.message}`));
        } else {
          openPorts.set(path, state);
          console.log(`[serial] opened ${path} @ ${baudRate} baud`);
          resolve();
        }
      });
    });
  });

  // ── Close a port ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERIAL_DISCONNECT, async (_event, path: string) => {
    const state = openPorts.get(path);
    if (!state) return; // already closed

    return new Promise<void>((resolve) => {
      state.port.close((err) => {
        if (err) console.warn(`[serial] close error on ${path}:`, err.message);
        openPorts.delete(path);
        console.log(`[serial] disconnected ${path}`);
        resolve();
      });
    });
  });

  // ── Write bytes to a port ─────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.SERIAL_WRITE, async (_event, path: string, data: number[]) => {
    const state = openPorts.get(path);
    if (!state) throw new Error(`Port not open: ${path}`);

    return new Promise<void>((resolve, reject) => {
      const buf = Buffer.from(data);
      state.port.write(buf, (err) => {
        if (err) {
          reject(new Error(`Write failed on ${path}: ${err.message}`));
        } else {
          state.port.drain((drainErr) => {
            if (drainErr) {
              reject(new Error(`Drain failed on ${path}: ${drainErr.message}`));
            } else {
              resolve();
            }
          });
        }
      });
    });
  });

  // ── Read bytes from the port buffer ───────────────────────────────────────
  //
  // Returns up to `length` bytes that have been received since the last read,
  // waiting up to 500 ms for data to arrive.
  ipcMain.handle(IPC_CHANNELS.SERIAL_READ, async (_event, path: string, length: number) => {
    const state = openPorts.get(path);
    if (!state) throw new Error(`Port not open: ${path}`);

    const bytes = await dequeue(state, length);
    return bytes;
  });

  // ── Flush the receive buffer ──────────────────────────────────────────────
  //
  // Called by ElectronPortHandler.clearPort() to discard stale bytes before
  // sending a new packet (mirrors PortHandler.clearPort() in the Web Serial SDK).
  ipcMain.handle(IPC_CHANNELS.SERIAL_FLUSH_RX, async (_event, path: string) => {
    const state = openPorts.get(path);
    if (!state) return;
    state.buffer.length = 0;
    // Wake any blocked dequeue() calls so they can return an empty result.
    const pending = state.waiters.splice(0);
    for (const wake of pending) wake();
    console.log(`[serial] flushed RX buffer for ${path}`);
  });
}
