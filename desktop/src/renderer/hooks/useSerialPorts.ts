/**
 * useSerialPorts — Phase 1 helper hook for Electron native serial port discovery.
 *
 * Lists available serial ports via the IPC bridge exposed by window.electron.
 * Falls back to an empty list in browser environments where window.electron
 * is not available (Web Serial path is still used in that case).
 */
import { useState, useCallback, useEffect } from "react";
import type { SerialPortInfo } from "../../shared/types";

export interface PortSelection {
  /** All ports currently discovered by the main process. */
  ports: SerialPortInfo[];
  /** The currently selected port path, or null if none selected. */
  selected: string | null;
  /** Set the selected port path. */
  setSelected: (path: string | null) => void;
  /** Re-query the main process for available ports. */
  refresh: () => Promise<void>;
  /** True while the port list is being fetched. */
  loading: boolean;
}

/**
 * Returns port discovery state when running inside Electron.
 * When `initialPortIndex` is provided the port at that index is auto-selected
 * as soon as the list is available (useful to pre-select index 1 for the
 * leader robot so it defaults to a different port than the follower).
 */
export function useSerialPorts(initialPortIndex = 0): PortSelection {
  const isElectron = typeof window !== "undefined" && !!window.electron;

  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const discovered = await window.electron.serial.listPorts();
      setPorts(discovered);
      // Auto-select if nothing is selected yet
      setSelected((prev) => {
        if (prev) {
          // Keep selection if the port is still present
          return discovered.find((p) => p.path === prev) ? prev : null;
        }
        const idx = Math.min(initialPortIndex, discovered.length - 1);
        return discovered[idx]?.path ?? null;
      });
    } catch (err) {
      console.error("[useSerialPorts] refresh error:", err);
    } finally {
      setLoading(false);
    }
  }, [isElectron, initialPortIndex]);

  // Initial discovery
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ports, selected, setSelected, refresh, loading };
}
