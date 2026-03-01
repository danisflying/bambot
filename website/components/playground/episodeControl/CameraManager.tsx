"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import type { CameraInstanceState } from "@/hooks/useCameras";
import CameraPreview from "./CameraPreview";
import {
  DEFAULT_CAM_WIDTH,
  DEFAULT_CAM_HEIGHT,
  DEFAULT_CAM_QUALITY,
  PRESET_CAMERA_NAMES,
} from "@/config/cameraConfig";

// ── Types ──────────────────────────────────────────────────────────────────

interface CameraManagerProps {
  /** Camera states from useCameras */
  cameraStates: CameraInstanceState[];
  cameraCount: number;
  allActive: boolean;
  anyActive: boolean;
  availableDevices: MediaDeviceInfo[];
  /** Whether recording is in progress (locks add/remove) */
  locked: boolean;
  /** Direct methods from useCameras */
  addCamera: (name: string, config?: { width?: number; height?: number; quality?: number }) => void;
  removeCamera: (name: string) => void;
  startCamera: (name: string, deviceId?: string) => Promise<void>;
  stopCamera: (name: string) => void;
  startSimulatedCamera: (
    name: string,
    type: "noise" | "robot_view",
    sourceCanvas?: HTMLCanvasElement | null,
    fps?: number
  ) => void;
  getVideoElement: (name: string) => HTMLVideoElement | null;
  /** Three.js canvas for robot_view sim cameras */
  robotViewCanvas?: HTMLCanvasElement | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Truncate a device label so the dropdown stays readable */
function shortLabel(d: MediaDeviceInfo, idx: number): string {
  const label = d.label || `Camera ${idx + 1}`;
  return label.length > 36 ? label.slice(0, 33) + "…" : label;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function CameraManager({
  cameraStates,
  cameraCount,
  allActive,
  anyActive,
  availableDevices,
  locked,
  addCamera,
  removeCamera,
  startCamera,
  stopCamera,
  startSimulatedCamera,
  getVideoElement,
  robotViewCanvas = null,
}: CameraManagerProps) {
  const [addCamOpen, setAddCamOpen] = useState(false);
  const addCamRef = useRef<HTMLDivElement>(null);

  // Track which deviceId each camera slot has selected (before starting)
  const [selectedDevices, setSelectedDevices] = useState<Record<string, string>>({});

  // Close dropdown on outside click
  useEffect(() => {
    if (!addCamOpen) return;
    const handler = (e: MouseEvent) => {
      if (addCamRef.current && !addCamRef.current.contains(e.target as Node)) {
        setAddCamOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addCamOpen]);

  // ── Device-in-use tracking ─────────────────────────────────────────────
  // Build a set of deviceIds that are already actively streaming on another
  // camera slot, so we can grey them out / warn.

  const usedDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const cam of cameraStates) {
      if (cam.isActive && cam.deviceId && !cam.deviceId.startsWith("sim:")) {
        ids.add(cam.deviceId);
      }
    }
    return ids;
  }, [cameraStates]);

  // ── Preset helpers ─────────────────────────────────────────────────────

  const availablePresets = PRESET_CAMERA_NAMES.filter(
    (n) => !cameraStates.find((c) => c.name === n)
  );

  const handleAddPhysical = (name: string) => {
    addCamera(name, {
      width: DEFAULT_CAM_WIDTH,
      height: DEFAULT_CAM_HEIGHT,
      quality: DEFAULT_CAM_QUALITY,
    });
    setAddCamOpen(false);
  };

  const handleAddSim = (name: string, type: "noise" | "robot_view") => {
    addCamera(name, {
      width: DEFAULT_CAM_WIDTH,
      height: DEFAULT_CAM_HEIGHT,
      quality: DEFAULT_CAM_QUALITY,
    });
    setTimeout(() => {
      startSimulatedCamera(
        name,
        type,
        type === "robot_view" ? robotViewCanvas ?? undefined : undefined
      );
    }, 0);
    setAddCamOpen(false);
  };

  // Start all inactive real cameras that have a device selected.
  // Sequential with a small gap so Windows drivers can settle between opens.
  const handleStartAll = async () => {
    const toStart = cameraStates.filter(
      (cam) => !cam.isActive && !cam.isSimulated && selectedDevices[cam.name]
    );
    for (let i = 0; i < toStart.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 300));
      await startCamera(toStart[i].name, selectedDevices[toStart[i].name]);
    }
  };

  // ── Per-camera device selector + start ─────────────────────────────────

  const handleDeviceSelect = (camName: string, deviceId: string) => {
    setSelectedDevices((prev) => ({ ...prev, [camName]: deviceId }));
  };

  const handleStartCamera = async (camName: string) => {
    const deviceId = selectedDevices[camName];
    await startCamera(camName, deviceId || undefined);
  };

  // ── Status badge ─────────────────────────────────────────────────────────

  const statusBadge = (() => {
    if (allActive) return { cls: "bg-green-600/60 text-green-200", label: "All Active" };
    if (anyActive) return { cls: "bg-yellow-600/60 text-yellow-200", label: "Partial" };
    if (cameraCount === 0) return { cls: "bg-zinc-700 text-zinc-400", label: "None" };
    return { cls: "bg-zinc-700 text-zinc-400", label: "Off" };
  })();

  // ── Resolve device label for active cameras ────────────────────────────

  const deviceLabel = (deviceId: string | null): string | null => {
    if (!deviceId || deviceId.startsWith("sim:")) return null;
    const dev = availableDevices.find((d) => d.deviceId === deviceId);
    return dev ? dev.label || deviceId.slice(0, 12) + "…" : deviceId.slice(0, 12) + "…";
  };

  return (
    <div className="mb-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-xs uppercase tracking-wide opacity-70">
          Cameras ({cameraCount})
        </span>
        <div className="flex items-center gap-2">
          {/* Start All button — only show when there are inactive real cameras */}
          {cameraStates.some((c) => !c.isActive && !c.isSimulated) && !locked && (
            <button
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
              onClick={handleStartAll}
            >
              Start All
            </button>
          )}
          <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* Camera list */}
      <div className="space-y-2 mb-2">
        {cameraStates.map((cam) => {
          const activeDeviceLabel = cam.isActive ? deviceLabel(cam.deviceId) : null;

          return (
            <div key={cam.name} className="border border-white/10 rounded p-2">
              {/* Name + status */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold flex items-center gap-1">
                  {cam.name}
                  {cam.isSimulated && (
                    <span className="text-[9px] font-mono px-1 rounded bg-emerald-700/60 text-emerald-300 leading-tight">
                      SIM
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      cam.isActive ? "bg-green-400" : "bg-zinc-500"
                    }`}
                  />
                  {!locked && (
                    <button
                      className="text-xs text-zinc-400 hover:text-red-400 ml-1"
                      onClick={() => {
                        removeCamera(cam.name);
                        setSelectedDevices((prev) => {
                          const next = { ...prev };
                          delete next[cam.name];
                          return next;
                        });
                      }}
                      title="Remove camera"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Active device indicator */}
              {activeDeviceLabel && (
                <div className="text-[10px] text-zinc-400 mb-1 truncate" title={activeDeviceLabel}>
                  📷 {activeDeviceLabel}
                </div>
              )}

              {/* Preview */}
              <CameraPreview
                name={cam.name}
                getVideoElement={getVideoElement}
                isActive={cam.isActive}
              />

              {/* Controls */}
              <div className="mt-1 space-y-1">
                {cam.isActive ? (
                  <button
                    className="w-full bg-red-600/80 hover:bg-red-500 px-2 py-1 rounded text-xs"
                    onClick={() => stopCamera(cam.name)}
                    disabled={locked}
                  >
                    Stop
                  </button>
                ) : cam.isSimulated ? (
                  <button
                    className="w-full bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded text-xs"
                    onClick={() =>
                      startSimulatedCamera(
                        cam.name,
                        cam.simulationType ?? "noise",
                        cam.simulationType === "robot_view"
                          ? robotViewCanvas ?? undefined
                          : undefined
                      )
                    }
                  >
                    Restart Sim
                  </button>
                ) : (
                  <>
                    {/* Device selector — per camera */}
                    {availableDevices.length > 0 ? (
                      <select
                        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
                        value={selectedDevices[cam.name] ?? ""}
                        onChange={(e) => handleDeviceSelect(cam.name, e.target.value)}
                      >
                        <option value="">Select webcam…</option>
                        {availableDevices.map((d, i) => {
                          const inUse = usedDeviceIds.has(d.deviceId);
                          return (
                            <option
                              key={d.deviceId}
                              value={d.deviceId}
                              disabled={inUse}
                            >
                              {shortLabel(d, i)}{inUse ? " (in use)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <div className="text-[10px] text-zinc-500 italic py-0.5">
                        No webcams detected — check permissions
                      </div>
                    )}
                    <button
                      className={`w-full px-2 py-1 rounded text-xs ${
                        selectedDevices[cam.name]
                          ? "bg-blue-600 hover:bg-blue-500 text-white"
                          : "bg-zinc-700 text-zinc-500 cursor-not-allowed"
                      }`}
                      onClick={() => handleStartCamera(cam.name)}
                      disabled={!selectedDevices[cam.name]}
                    >
                      Start
                    </button>
                  </>
                )}
              </div>

              {cam.error && (
                <div className="mt-1 text-xs text-red-400">{cam.error}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add camera dropdown */}
      {!locked && (
        <div ref={addCamRef} className="relative">
          <button
            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-300 text-left flex items-center justify-between"
            onClick={() => setAddCamOpen((o) => !o)}
          >
            <span>+ Add camera…</span>
            <span className="opacity-50 text-[10px]">{addCamOpen ? "▲" : "▼"}</span>
          </button>

          {addCamOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-600 rounded shadow-xl z-50 overflow-hidden">
              {/* Physical presets */}
              {availablePresets.length > 0 && (
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                  Physical
                </div>
              )}
              {availablePresets.map((n) => (
                <button
                  key={n}
                  className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                  onClick={() => handleAddPhysical(n)}
                >
                  {n}
                </button>
              ))}
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 border-t border-zinc-700"
                onClick={() => {
                  const custom = prompt("Enter camera name:");
                  if (!custom) return;
                  handleAddPhysical(custom.trim().replace(/\s+/g, "_"));
                }}
              >
                Custom name…
              </button>

              {/* Simulated cameras */}
              <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-500 border-t border-zinc-700 mt-0.5">
                Simulated
              </div>
              {([
                { label: "Noise test", type: "noise" as const, baseName: "sim_noise" },
                { label: "Robot view (3D)", type: "robot_view" as const, baseName: "sim_robot" },
              ] as const).map(({ label, type, baseName }) => {
                const existingNames = cameraStates.map((c) => c.name);
                let simName: string = baseName;
                let i = 2;
                while (existingNames.includes(simName)) {
                  simName = `${baseName}_${i++}`;
                }
                return (
                  <button
                    key={type}
                    className="w-full text-left px-3 py-1.5 text-xs text-emerald-300 hover:bg-zinc-700 flex items-center gap-1.5"
                    onClick={() => handleAddSim(simName, type)}
                  >
                    <span className="opacity-60">✦</span> {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
