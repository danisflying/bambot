"use client";

import React from "react";
import type { EpisodeSummary } from "@/lib/episode";

interface SessionSummaryProps {
  episodes: EpisodeSummary[];
  onClear: () => void;
}

export default function SessionSummary({ episodes, onClear }: SessionSummaryProps) {
  if (episodes.length === 0) return null;

  return (
    <div className="border-t border-white/20 pt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-xs uppercase tracking-wide opacity-70">
          Session ({episodes.length} episodes)
        </span>
        <button
          className="text-xs text-zinc-400 hover:text-white"
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <div className="max-h-24 overflow-y-auto space-y-1">
        {episodes.map((ep, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-zinc-300">
            <span className="font-mono">ep_{ep.episode_id}</span>
            <span className="opacity-60">{ep.task}</span>
            <span className={ep.success ? "text-green-400" : "text-red-400"}>
              {ep.success ? "✓" : "✗"}
            </span>
            <span className="opacity-40">{ep.frame_count}f</span>
          </div>
        ))}
      </div>
    </div>
  );
}
