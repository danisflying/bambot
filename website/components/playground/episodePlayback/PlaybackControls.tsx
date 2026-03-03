"use client";

import React from "react";
import type { PlaybackPhase } from "@/hooks/useEpisodePlayback";

interface PlaybackControlsProps {
  phase: PlaybackPhase;
  frameIndex: number;
  totalFrames: number;
  speed: number;
  fps: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSeek: (index: number) => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onSpeedChange: (speed: number) => void;
  onUnload: () => void;
}

function formatTime(frameIndex: number, fps: number) {
  const totalSec = frameIndex / fps;
  const min = Math.floor(totalSec / 60);
  const sec = (totalSec % 60).toFixed(1);
  return `${min}:${sec.padStart(4, "0")}`;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4];

export default function PlaybackControls({
  phase,
  frameIndex,
  totalFrames,
  speed,
  fps,
  onPlay,
  onPause,
  onStop,
  onSeek,
  onStepForward,
  onStepBackward,
  onSpeedChange,
  onUnload,
}: PlaybackControlsProps) {
  const isPlaying = phase === "playing";
  const canStep = phase === "ready" || phase === "paused";

  return (
    <div className="mb-3 space-y-2 border-t border-white/20 pt-2">
      {/* Status bar */}
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="opacity-70">Frame:</span>
          <span className="font-mono">
            {frameIndex + 1}/{totalFrames}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Time:</span>
          <span className="font-mono">
            {formatTime(frameIndex, fps)}/{formatTime(totalFrames - 1, fps)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="opacity-70">Speed:</span>
          <span className="font-mono">{speed}×</span>
        </div>
      </div>

      {/* Scrubber / seek bar */}
      <div data-scrubber className="px-0.5">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={frameIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full h-1.5 accent-blue-500 cursor-pointer"
        />
      </div>

      {/* Playback indicator */}
      {isPlaying && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-semibold">Playing at {speed}×</span>
        </div>
      )}
      {phase === "paused" && (
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400" />
          <span className="text-xs font-semibold">Paused</span>
        </div>
      )}

      {/* Transport buttons */}
      <div className="flex gap-1.5">
        {/* Step back */}
        <button
          className={`px-2 py-1.5 rounded text-xs ${
            canStep ? "bg-zinc-700 hover:bg-zinc-600" : "bg-gray-700 cursor-not-allowed"
          }`}
          onClick={onStepBackward}
          disabled={!canStep}
          title="Step back"
        >
          ⏮
        </button>

        {/* Play / Pause */}
        {isPlaying ? (
          <button
            className="flex-1 px-2 py-1.5 rounded text-xs bg-yellow-600 hover:bg-yellow-500"
            onClick={onPause}
          >
            ⏸ Pause
          </button>
        ) : (
          <button
            className="flex-1 px-2 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500"
            onClick={onPlay}
          >
            ▶ Play
          </button>
        )}

        {/* Stop */}
        <button
          className={`px-3 py-1.5 rounded text-xs ${
            phase !== "ready"
              ? "bg-red-600 hover:bg-red-500"
              : "bg-gray-700 cursor-not-allowed"
          }`}
          onClick={onStop}
          disabled={phase === "ready"}
        >
          ⏹ Stop
        </button>

        {/* Step forward */}
        <button
          className={`px-2 py-1.5 rounded text-xs ${
            canStep ? "bg-zinc-700 hover:bg-zinc-600" : "bg-gray-700 cursor-not-allowed"
          }`}
          onClick={onStepForward}
          disabled={!canStep}
          title="Step forward"
        >
          ⏭
        </button>
      </div>

      {/* Speed selector + Unload */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs opacity-70">Speed:</span>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={`px-1.5 py-0.5 rounded text-xs ${
                speed === s
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
              onClick={() => onSpeedChange(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          className="text-xs text-zinc-400 hover:text-white"
          onClick={onUnload}
        >
          Unload
        </button>
      </div>
    </div>
  );
}
