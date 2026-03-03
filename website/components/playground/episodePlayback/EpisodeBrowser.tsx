"use client";

import React from "react";
import type { EpisodeSummary } from "@/lib/episode";

interface EpisodeBrowserProps {
  episodes: EpisodeSummary[];
  loading: boolean;
  selectedEpisode: EpisodeSummary | null;
  onSelect: (episode: EpisodeSummary) => void;
  onRefresh: () => void;
}

export default function EpisodeBrowser({
  episodes,
  loading,
  selectedEpisode,
  onSelect,
  onRefresh,
}: EpisodeBrowserProps) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-xs uppercase tracking-wide opacity-70">
          Saved Episodes ({episodes.length})
        </span>
        <button
          className="text-xs text-zinc-400 hover:text-white"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {episodes.length === 0 && !loading && (
        <div className="text-xs text-zinc-500 py-2">No saved episodes found.</div>
      )}

      {episodes.length > 0 && (
        <div className="max-h-32 overflow-y-auto space-y-1 border border-zinc-700 rounded p-1">
          {episodes.map((ep) => {
            const isSelected =
              selectedEpisode?.task === ep.task &&
              selectedEpisode?.episode_id === ep.episode_id;

            return (
              <button
                key={`${ep.task}-${ep.episode_id}`}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                  isSelected
                    ? "bg-blue-600/40 border border-blue-500/50"
                    : "hover:bg-zinc-700/50 border border-transparent"
                }`}
                onClick={() => onSelect(ep)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">ep_{ep.episode_id}</span>
                    <span className="text-zinc-400">{ep.task}</span>
                    <span className={ep.success ? "text-green-400" : "text-red-400"}>
                      {ep.success ? "✓" : "✗"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-500">
                    <span>{ep.frame_count}f</span>
                    <span>{ep.duration_s.toFixed(1)}s</span>
                  </div>
                </div>
                <div className="text-zinc-500 mt-0.5">
                  {ep.camera_names.join(", ")} · {ep.fps}Hz · {ep.robot}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
