import React from "react";
import type { RecorderPhase } from "@/lib/episode";

interface RecordingControlsProps {
  phase: RecorderPhase;
  frameCount: number;
  elapsedMs: number;
  currentEpisodeId: number;
  cameraCount: number;
  /** Number of frame captures skipped due to busy guard */
  droppedFrames: number;
  /** Displayed frame/time from the last episode when in reviewing phase */
  reviewFrameCount?: number;
  reviewElapsedMs?: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDiscard: () => void;
}

function formatTime(ms: number) {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec % 60).toFixed(1);
  return `${min}:${sec.padStart(4, "0")}`;
}

export default function RecordingControls({
  phase,
  frameCount,
  elapsedMs,
  currentEpisodeId,
  cameraCount,
  droppedFrames,
  reviewFrameCount,
  reviewElapsedMs,
  onStart,
  onPause,
  onResume,
  onStop,
  onDiscard,
}: RecordingControlsProps) {
  const isActive = phase === "recording" || phase === "paused";
  const showReview = phase === "reviewing" && reviewFrameCount !== undefined;

  const displayFrames = showReview ? reviewFrameCount : frameCount;
  const displayTime = showReview ? reviewElapsedMs ?? 0 : elapsedMs;

  return (
    <>
      {/* ── Status ──────────────────────────────────────────────────── */}
      <div className="mb-3 flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="opacity-70">Frames:</span>
          <span className="font-mono">{displayFrames}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Time:</span>
          <span className="font-mono">{formatTime(displayTime)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Ep:</span>
          <span className="font-mono">{currentEpisodeId}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Cams:</span>
          <span className="font-mono">{cameraCount}</span>
        </div>
        {droppedFrames > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-yellow-400 opacity-90">Dropped:</span>
            <span className="font-mono text-yellow-400">{droppedFrames}</span>
          </div>
        )}
      </div>

      {/* ── Recording indicator ─────────────────────────────────────── */}
      {isActive && (
        <div className="mb-2 flex items-center gap-2">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              phase === "paused" ? "bg-yellow-400" : "bg-red-500 animate-pulse"
            }`}
          />
          <span className="text-xs font-semibold">
            {phase === "paused" ? "Paused" : "Recording..."}
          </span>
        </div>
      )}

      {/* ── Buttons ─────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-3">
        {(() => {
          switch (phase) {
            case "idle":
              return (
                <button
                  className="flex-1 px-2 py-2 rounded text-xs bg-green-600 hover:bg-green-500"
                  onClick={onStart}
                >
                  {currentEpisodeId > 0 ? "Next Episode" : "Start"}
                </button>
              );
            case "recording":
              return (
                <button
                  className="flex-1 px-2 py-2 rounded text-xs bg-yellow-600 hover:bg-yellow-500"
                  onClick={onPause}
                >
                  Pause
                </button>
              );
            case "paused":
              return (
                <button
                  className="flex-1 px-2 py-2 rounded text-xs bg-green-600 hover:bg-green-500"
                  onClick={onResume}
                >
                  Resume
                </button>
              );
            case "reviewing":
              return (
                <button
                  className="flex-1 px-2 py-2 rounded text-xs bg-gray-700 cursor-not-allowed"
                  disabled
                >
                  Start
                </button>
              );
          }
        })()}

        <button
          className={`flex-1 px-2 py-2 rounded text-xs ${
            isActive
              ? "bg-red-600 hover:bg-red-500"
              : "bg-gray-700 cursor-not-allowed"
          }`}
          onClick={onStop}
          disabled={!isActive}
        >
          Stop
        </button>

        <button
          className={`flex-1 px-2 py-2 rounded text-xs ${
            isActive
              ? "bg-zinc-700 hover:bg-zinc-600"
              : "bg-gray-700 cursor-not-allowed"
          }`}
          onClick={onDiscard}
          disabled={!isActive}
        >
          Discard
        </button>
      </div>
    </>
  );
}
