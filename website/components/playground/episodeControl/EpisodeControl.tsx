"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Rnd } from "react-rnd";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { useCameras } from "@/hooks/useCameras";
import { useEpisodeRecorder } from "@/hooks/useEpisodeRecorder";
import type { Episode, EpisodeRecorderConfig } from "@/lib/episode";
import type { JointState } from "@/hooks/useRobotControl";

// ── Props ──────────────────────────────────────────────────────────────────

interface EpisodeControlProps {
  show: boolean;
  onHide: () => void;
  /** Leader robot control — needed to read leader positions for observation */
  leaderControl: {
    isConnected: boolean;
    getPositions: () => Promise<Map<number, number>>;
    disconnectLeader: () => Promise<void>;
  };
  /** Follower joint states from useRobotControl */
  jointStates: JointState[];
  /** Joint details matching the robot config */
  jointDetails: {
    name: string;
    servoId: number;
    jointType: "revolute" | "continuous";
  }[];
  /** Robot name, e.g. "so-arm100" */
  robotName: string;
  /** Three.js renderer canvas for robot_view simulated camera */
  robotViewCanvas?: HTMLCanvasElement | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_FPS = 30;
const DEFAULT_CAM_WIDTH = 640;
const DEFAULT_CAM_HEIGHT = 480;
const DEFAULT_CAM_QUALITY = 0.85;

const PRESET_CAMERA_NAMES = [
  "cam_high",
  "cam_low",
  "cam_wrist",
  "cam_left",
  "cam_right",
];

// ── Camera Preview subcomponent ────────────────────────────────────────────

function CameraPreview({
  name,
  getVideoElement,
  isActive,
}: {
  name: string;
  getVideoElement: (name: string) => HTMLVideoElement | null;
  isActive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const videoEl = getVideoElement(name);
    if (videoEl && isActive) {
      videoEl.style.width = "100%";
      videoEl.style.height = "100%";
      videoEl.style.objectFit = "cover";
      videoEl.style.display = "block";

      if (videoEl.parentElement !== container) {
        container.innerHTML = "";
        container.appendChild(videoEl);
      }
    }

    return () => {
      if (videoEl && videoEl.parentElement === container) {
        container.removeChild(videoEl);
      }
    };
  }, [name, getVideoElement, isActive]);

  return (
    <div
      ref={containerRef}
      className="relative bg-black rounded overflow-hidden"
      style={{ aspectRatio: "4/3" }}
    >
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-xs">
          Not started
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

const EpisodeControl = ({
  show,
  onHide,
  leaderControl,
  jointStates,
  jointDetails,
  robotName,
  robotViewCanvas = null,
}: EpisodeControlProps) => {
  // UI state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [ref, bounds] = useMeasure();
  const [taskName, setTaskName] = useState("untitled");
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [addCamOpen, setAddCamOpen] = useState(false);
  const addCamRef = useRef<HTMLDivElement>(null);

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
  const [lastSaveResult, setLastSaveResult] = useState<
    "success" | "error" | null
  >(null);
  const [successTag, setSuccessTag] = useState(true);
  const [notes, setNotes] = useState("");
  const lastEpisodeRef = useRef<Episode | null>(null);
  const [, forceRender] = useState(0);

  // Multi-camera manager
  const cameras = useCameras();

  // Initialize with one default camera
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      cameras.addCamera("cam_high", {
        width: DEFAULT_CAM_WIDTH,
        height: DEFAULT_CAM_HEIGHT,
        quality: DEFAULT_CAM_QUALITY,
      });
      initializedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive servo IDs and joint names for revolute joints only
  const revoluteJoints = useMemo(
    () => jointDetails.filter((j) => j.jointType === "revolute"),
    [jointDetails]
  );

  const servoIds = useMemo(
    () => revoluteJoints.map((j) => j.servoId),
    [revoluteJoints]
  );
  const jointNames = useMemo(
    () => revoluteJoints.map((j) => j.name),
    [revoluteJoints]
  );

  // Follower angle getter (stable ref to avoid stale closures)
  const jointStatesRef = useRef(jointStates);
  jointStatesRef.current = jointStates;

  const getFollowerAngles = useCallback((): number[] => {
    return revoluteJoints.map((j) => {
      const st = jointStatesRef.current.find((s) => s.servoId === j.servoId);
      return typeof st?.degrees === "number" ? st.degrees : 0;
    });
  }, [revoluteJoints]);

  // Camera grabbers (rebuilt when camera states change)
  const cameraGrabbers = useMemo(
    () => cameras.getGrabbers(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameras.cameraStates, cameras.getGrabbers]
  );

  const cameraNames = useMemo(
    () => cameras.getCameraNames(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameras.cameraStates, cameras.getCameraNames]
  );

  // Episode recorder config
  const recorderConfig: EpisodeRecorderConfig = useMemo(
    () => ({
      fps,
      task: taskName,
      robot: robotName,
      cameraNames,
    }),
    [fps, taskName, robotName, cameraNames]
  );

  // Episode recorder
  const recorder = useEpisodeRecorder(
    {
      getLeaderPositions: leaderControl.getPositions,
      getFollowerAngles,
      servoIds,
      jointNames,
      cameraGrabbers,
    },
    recorderConfig
  );

  // Position panel
  useEffect(() => {
    if (bounds.height > 0) {
      setPosition({ x: 20, y: 70 });
    }
  }, [bounds.height]);

  // Clear save result after 3s
  useEffect(() => {
    if (lastSaveResult) {
      const t = setTimeout(() => setLastSaveResult(null), 3000);
      return () => clearTimeout(t);
    }
  }, [lastSaveResult]);

  // ── Camera management handlers ────────────────────────────────────────────

  const handleAddSimCamera = (
    name: string,
    type: "noise" | "robot_view"
  ) => {
    cameras.addCamera(name, {
      width: DEFAULT_CAM_WIDTH,
      height: DEFAULT_CAM_HEIGHT,
      quality: DEFAULT_CAM_QUALITY,
    });
    // Start immediately after adding (use setTimeout to let React sync the instance)
    setTimeout(() => {
      cameras.startSimulatedCamera(
        name,
        type,
        type === "robot_view" ? robotViewCanvas ?? undefined : undefined
      );
    }, 0);
  };

  const handleAddCamera = (name: string) => {
    cameras.addCamera(name, {
      width: DEFAULT_CAM_WIDTH,
      height: DEFAULT_CAM_HEIGHT,
      quality: DEFAULT_CAM_QUALITY,
    });
  };

  const handleRemoveCamera = (name: string) => {
    cameras.removeCamera(name);
  };

  const handleStartCamera = async (name: string, deviceId?: string) => {
    await cameras.startCamera(name, deviceId);
  };

  const handleStopCamera = (name: string) => {
    cameras.stopCamera(name);
  };

  // ── Recording handlers ────────────────────────────────────────────────────

  const { isRecording, isPaused, frameCount, elapsedMs } = recorder.state;
  const hasLastEpisode = lastEpisodeRef.current !== null;

  const handleStart = () => {
    if (cameras.cameraCount === 0) {
      alert("Add at least one camera before recording.");
      return;
    }
    if (!cameras.allActive) {
      alert("Start all cameras before recording.");
      return;
    }
    if (!leaderControl.isConnected) {
      alert("Connect the leader robot before recording.");
      return;
    }
    recorder.startRecording();
  };

  const handlePause = () => recorder.pauseRecording();
  const handleResume = () => recorder.resumeRecording();

  const handleStop = () => {
    const episode = recorder.stopRecording(successTag, notes || undefined);
    lastEpisodeRef.current = episode;
    forceRender((n) => n + 1);
  };

  const handleDiscard = () => {
    recorder.discardRecording();
    lastEpisodeRef.current = null;
    forceRender((n) => n + 1);
  };

  const handleSave = async () => {
    const episode = lastEpisodeRef.current;
    if (!episode) return;
    const ok = await recorder.saveEpisode(episode);
    setLastSaveResult(ok ? "success" : "error");
    if (ok) {
      lastEpisodeRef.current = null;
      forceRender((n) => n + 1);
    }
  };

  const handleDownload = () => {
    const episode = lastEpisodeRef.current;
    if (!episode) return;
    recorder.downloadEpisode(episode);
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const availableCameraPresets = PRESET_CAMERA_NAMES.filter(
    (n) => !cameras.cameraStates.find((c) => c.name === n)
  );

  const formatTime = (ms: number) => {
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = (totalSec % 60).toFixed(1);
    return `${min}:${sec.padStart(4, "0")}`;
  };

  if (!show) return null;

  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-50"
      style={{ display: show ? undefined : "none" }}
      cancel="input,select,textarea,button,a,option"
    >
      <div
        ref={ref}
        className={
          "max-h-[90vh] overflow-y-auto text-sm w-[380px] " + panelStyle
        }
      >
        {/* Header */}
        <h3 className="mt-0 mb-3 border-b border-white/50 pb-1 font-bold text-base flex justify-between items-center">
          <span>Episode Recorder</span>
          <button
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Collapse"
            onClick={onHide}
            onTouchEnd={onHide}
          >
            ×
          </button>
        </h3>

        {/* ── Cameras Section ─────────────────────────────────────────── */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-xs uppercase tracking-wide opacity-70">
              Cameras ({cameras.cameraCount})
            </span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                cameras.allActive
                  ? "bg-green-600/60 text-green-200"
                  : cameras.anyActive
                  ? "bg-yellow-600/60 text-yellow-200"
                  : "bg-zinc-700 text-zinc-400"
              }`}
            >
              {cameras.allActive
                ? "All Active"
                : cameras.anyActive
                ? "Partial"
                : cameras.cameraCount === 0
                ? "None"
                : "Off"}
            </span>
          </div>

          {/* Camera list */}
          <div className="space-y-2 mb-2">
            {cameras.cameraStates.map((cam) => (
              <div
                key={cam.name}
                className="border border-white/10 rounded p-2"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold flex items-center gap-1">
                    {cam.name}
                    {cam.isSimulated && (
                      <span className="text-[9px] font-mono px-1 rounded bg-emerald-700/60 text-emerald-300 leading-tight">SIM</span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        cam.isActive ? "bg-green-400" : "bg-zinc-500"
                      }`}
                    />
                    {!isRecording && (
                      <button
                        className="text-xs text-zinc-400 hover:text-red-400 ml-1"
                        onClick={() => handleRemoveCamera(cam.name)}
                        title="Remove camera"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                {/* Preview */}
                <CameraPreview
                  name={cam.name}
                  getVideoElement={cameras.getVideoElement}
                  isActive={cam.isActive}
                />

                {/* Camera device selector + start/stop */}
                <div className="flex gap-1 mt-1">
                  {cam.isActive ? (
                    <button
                      className="flex-1 bg-red-600/80 hover:bg-red-500 px-2 py-1 rounded text-xs"
                      onClick={() => handleStopCamera(cam.name)}
                      disabled={isRecording}
                    >
                      Stop
                    </button>
                  ) : cam.isSimulated ? (
                    // Simulated camera: show restart button (already added via dropdown)
                    <button
                      className="flex-1 bg-emerald-700 hover:bg-emerald-600 px-2 py-1 rounded text-xs"
                      onClick={() =>
                        cameras.startSimulatedCamera(
                          cam.name,
                          cam.simulationType ?? "noise",
                          cam.simulationType === "robot_view" ? robotViewCanvas ?? undefined : undefined
                        )
                      }
                    >
                      Restart Sim
                    </button>
                  ) : (
                    <>
                      <button
                        className="flex-1 bg-blue-600 hover:bg-blue-500 px-2 py-1 rounded text-xs"
                        onClick={() => handleStartCamera(cam.name)}
                      >
                        Start
                      </button>
                      {cameras.availableDevices.length > 0 && (
                        <select
                          className="bg-zinc-800 border border-zinc-600 rounded px-1 py-1 text-xs text-white max-w-[140px]"
                          onChange={(e) => {
                            if (e.target.value) {
                              handleStartCamera(cam.name, e.target.value);
                            }
                          }}
                          defaultValue=""
                        >
                          <option value="">Choose device...</option>
                          {cameras.availableDevices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Camera ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>

                {cam.error && (
                  <div className="mt-1 text-xs text-red-400">{cam.error}</div>
                )}
              </div>
            ))}
          </div>

          {/* Add camera */}
          {!isRecording && (
            <div ref={addCamRef} className="relative">
              <button
                className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-300 text-left flex items-center justify-between"
                onClick={() => setAddCamOpen((o) => !o)}
              >
                <span>+ Add camera...</span>
                <span className="opacity-50 text-[10px]">{addCamOpen ? "▲" : "▼"}</span>
              </button>

              {addCamOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-zinc-900 border border-zinc-600 rounded shadow-xl z-50 overflow-hidden">
                  {/* Physical camera presets */}
                  {availableCameraPresets.length > 0 && (
                    <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-500">
                      Physical
                    </div>
                  )}
                  {availableCameraPresets.map((n) => (
                    <button
                      key={n}
                      className="w-full text-left px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
                      onClick={() => {
                        handleAddCamera(n);
                        setAddCamOpen(false);
                      }}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    className="w-full text-left px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 border-t border-zinc-700"
                    onClick={() => {
                      const custom = prompt("Enter camera name:");
                      if (!custom) return;
                      handleAddCamera(custom.trim().replace(/\s+/g, "_"));
                      setAddCamOpen(false);
                    }}
                  >
                    Custom name...
                  </button>

                  {/* Simulated cameras */}
                  <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-500 border-t border-zinc-700 mt-0.5">
                    Simulated
                  </div>
                  {([
                    { label: "Noise test", type: "noise" as const, baseName: "sim_noise" },
                    { label: "Robot view (3D)", type: "robot_view" as const, baseName: "sim_robot" },
                  ]).map(({ label, type, baseName }) => {
                    // Find unused name
                    const existingNames = cameras.cameraStates.map((c) => c.name);
                    let simName = baseName;
                    let i = 2;
                    while (existingNames.includes(simName)) {
                      simName = `${baseName}_${i++}`;
                    }
                    return (
                      <button
                        key={type}
                        className="w-full text-left px-3 py-1.5 text-xs text-emerald-300 hover:bg-zinc-700 flex items-center gap-1.5"
                        onClick={() => {
                          handleAddSimCamera(simName, type);
                          setAddCamOpen(false);
                        }}
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

        {/* ── Config Section ──────────────────────────────────────────── */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-xs w-12 shrink-0">Task</label>
            <input
              type="text"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              disabled={isRecording}
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
              placeholder="e.g. pick_cup"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs w-12 shrink-0">FPS</label>
            <input
              type="number"
              value={fps}
              onChange={(e) =>
                setFps(Math.max(1, Math.min(60, Number(e.target.value))))
              }
              disabled={isRecording}
              className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
              min={1}
              max={60}
            />
            <span className="text-xs text-zinc-400">Hz</span>
          </div>
        </div>

        {/* ── Status ──────────────────────────────────────────────────── */}
        <div className="mb-3 flex gap-4 text-xs">
          <div className="flex items-center gap-1">
            <span className="opacity-70">Frames:</span>
            <span className="font-mono">
              {lastEpisodeRef.current && !isRecording
                ? lastEpisodeRef.current.frames.length
                : frameCount}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-70">Time:</span>
            <span className="font-mono">
              {lastEpisodeRef.current && !isRecording
                ? formatTime(
                    lastEpisodeRef.current.frames.length > 0
                      ? lastEpisodeRef.current.frames[
                          lastEpisodeRef.current.frames.length - 1
                        ].timestamp_ms
                      : 0
                  )
                : formatTime(elapsedMs)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-70">Ep:</span>
            <span className="font-mono">
              {recorder.state.currentEpisodeId}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="opacity-70">Cams:</span>
            <span className="font-mono">{cameras.cameraCount}</span>
          </div>
        </div>

        {/* ── Recording indicator ─────────────────────────────────────── */}
        {isRecording && (
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                isPaused ? "bg-yellow-400" : "bg-red-500 animate-pulse"
              }`}
            />
            <span className="text-xs font-semibold">
              {isPaused ? "Paused" : "Recording..."}
            </span>
          </div>
        )}

        {/* ── Recording Controls ──────────────────────────────────────── */}
        <div className="flex gap-2 mb-3">
          {!isRecording ? (
            <button
              className={`flex-1 px-2 py-2 rounded text-xs ${
                hasLastEpisode
                  ? "bg-gray-700 cursor-not-allowed"
                  : "bg-green-600 hover:bg-green-500"
              }`}
              onClick={handleStart}
              disabled={!!hasLastEpisode}
            >
              {recorder.state.currentEpisodeId > 0 && !hasLastEpisode
                ? "Next Episode"
                : "Start"}
            </button>
          ) : isPaused ? (
            <button
              className="flex-1 px-2 py-2 rounded text-xs bg-green-600 hover:bg-green-500"
              onClick={handleResume}
            >
              Resume
            </button>
          ) : (
            <button
              className="flex-1 px-2 py-2 rounded text-xs bg-yellow-600 hover:bg-yellow-500"
              onClick={handlePause}
            >
              Pause
            </button>
          )}

          <button
            className={`flex-1 px-2 py-2 rounded text-xs ${
              isRecording
                ? "bg-red-600 hover:bg-red-500"
                : "bg-gray-700 cursor-not-allowed"
            }`}
            onClick={handleStop}
            disabled={!isRecording}
          >
            Stop
          </button>

          <button
            className={`flex-1 px-2 py-2 rounded text-xs ${
              isRecording
                ? "bg-zinc-700 hover:bg-zinc-600"
                : "bg-gray-700 cursor-not-allowed"
            }`}
            onClick={handleDiscard}
            disabled={!isRecording}
          >
            Discard
          </button>
        </div>

        {/* ── Post-recording: Success tag & Notes ─────────────────────── */}
        {hasLastEpisode && !isRecording && (
          <div className="mb-3 space-y-2 border-t border-white/20 pt-2">
            <div className="flex items-center gap-2">
              <label className="text-xs w-16 shrink-0">Result</label>
              <div className="flex gap-2">
                <button
                  className={`px-2 py-1 rounded text-xs ${
                    successTag
                      ? "bg-green-600 text-white"
                      : "bg-zinc-700 text-zinc-300"
                  }`}
                  onClick={() => setSuccessTag(true)}
                >
                  Success
                </button>
                <button
                  className={`px-2 py-1 rounded text-xs ${
                    !successTag
                      ? "bg-red-600 text-white"
                      : "bg-zinc-700 text-zinc-300"
                  }`}
                  onClick={() => setSuccessTag(false)}
                >
                  Fail
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <label className="text-xs w-16 shrink-0 pt-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white resize-none"
                rows={2}
                placeholder="Optional notes..."
              />
            </div>

            <div className="flex gap-2">
              <button
                className="flex-1 bg-blue-600 hover:bg-blue-500 px-2 py-1.5 rounded text-xs"
                onClick={handleSave}
              >
                Save to Server
              </button>
              <button
                className="flex-1 bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 rounded text-xs"
                onClick={handleDownload}
              >
                Download JSON
              </button>
              <button
                className="px-2 py-1.5 rounded text-xs bg-zinc-700 hover:bg-zinc-600"
                onClick={() => {
                  lastEpisodeRef.current = null;
                  setNotes("");
                  setSuccessTag(true);
                  setLastSaveResult(null);
                  forceRender((n) => n + 1);
                }}
              >
                Clear
              </button>
            </div>

            {lastSaveResult && (
              <div
                className={`text-xs mt-1 ${
                  lastSaveResult === "success"
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {lastSaveResult === "success"
                  ? "Episode saved successfully!"
                  : "Failed to save episode. Check console."}
              </div>
            )}
          </div>
        )}

        {/* ── Session Summary ─────────────────────────────────────────── */}
        {recorder.completedEpisodes.length > 0 && (
          <div className="border-t border-white/20 pt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs uppercase tracking-wide opacity-70">
                Session ({recorder.completedEpisodes.length} episodes)
              </span>
              <button
                className="text-xs text-zinc-400 hover:text-white"
                onClick={recorder.clearCompletedEpisodes}
              >
                Clear
              </button>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-1">
              {recorder.completedEpisodes.map((ep, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-zinc-300"
                >
                  <span className="font-mono">ep_{ep.episode_id}</span>
                  <span className="opacity-60">{ep.task}</span>
                  <span
                    className={
                      ep.success ? "text-green-400" : "text-red-400"
                    }
                  >
                    {ep.success ? "✓" : "✗"}
                  </span>
                  <span className="opacity-40">{ep.frames.length}f</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Rnd>
  );
};

export default EpisodeControl;
