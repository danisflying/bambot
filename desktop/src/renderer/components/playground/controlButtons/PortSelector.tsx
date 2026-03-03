/**
 * PortSelector — Phase 1 serial port picker for the Electron desktop app.
 *
 * Shows a dropdown populated from window.electron.serial.listPorts() along
 * with a refresh button.  Only renders in Electron environments; returns null
 * when window.electron is not available (browser / Web Serial path).
 */
import React, { useEffect, useState, useCallback } from "react";
import type { SerialPortInfo } from "../../../../shared/types";

interface PortSelectorProps {
  /** Currently selected port path (controlled). */
  value: string | null;
  /** Called when the user picks a different port. */
  onChange: (path: string | null) => void;
  /** Optional label shown above the selector. */
  label?: string;
  disabled?: boolean;
}

export function PortSelector({ value, onChange, label = "Serial Port", disabled }: PortSelectorProps) {
  const isElectron = typeof window !== "undefined" && !!window.electron;

  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isElectron) return;
    setLoading(true);
    try {
      const discovered = await window.electron.serial.listPorts();
      setPorts(discovered);
      // If the current selection is no longer in the list, clear it
      if (value && !discovered.find((p) => p.path === value)) {
        onChange(null);
      }
      // Auto-select first port if nothing is chosen
      if (!value && discovered.length > 0) {
        onChange(discovered[0].path);
      }
    } catch (err) {
      console.error("[PortSelector] refresh error:", err);
    } finally {
      setLoading(false);
    }
  }, [isElectron, value, onChange]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isElectron) return null;

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">{label}</span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || disabled}
          className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors px-1"
          title="Refresh port list"
        >
          {loading ? "…" : "⟳"}
        </button>
      </div>

      {ports.length === 0 ? (
        <div className="text-xs text-zinc-500 italic">
          {loading ? "Scanning…" : "No serial ports found"}
        </div>
      ) : (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          disabled={disabled || loading}
          className="w-full rounded bg-zinc-800 border border-zinc-600 text-white text-xs px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">— select port —</option>
          {ports.map((p) => (
            <option key={p.path} value={p.path}>
              {p.path}
              {p.manufacturer ? ` (${p.manufacturer})` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
