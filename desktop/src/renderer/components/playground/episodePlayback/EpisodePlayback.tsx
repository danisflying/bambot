import React, { useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { useEpisodePlayback } from "@/hooks/useEpisodePlayback";
import type { EpisodeSummary } from "@/lib/episode";
import type { UpdateJointsDegrees } from "@/hooks/useRobotControl";

import EpisodeBrowser from "./EpisodeBrowser";
import PlaybackControls from "./PlaybackControls";
import PlaybackImageViewer from "./PlaybackImageViewer";

// ── Props ──────────────────────────────────────────────────────────────────

interface EpisodePlaybackProps {
  show: boolean;
  onHide: () => void;
  mode?: "floating" | "sidebar";
  /** Push action angles to the 3D model / real robot */
  updateJointsDegrees: UpdateJointsDegrees;
  /** Joint details for mapping action → servo updates */
  jointDetails: {
    name: string;
    servoId: number;
    jointType: "revolute" | "continuous";
  }[];
  /** Notify parent when playback is active */
  onBusyChange?: (busy: boolean) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

const EpisodePlayback = ({
  show,
  onHide,
  updateJointsDegrees,
  jointDetails,
  onBusyChange,
  mode = "floating",
}: EpisodePlaybackProps) => {
  const [position, setPosition] = React.useState({ x: 420, y: 70 });
  const [measureRef, bounds] = useMeasure();
  const [driveRobot, setDriveRobot] = React.useState(true);

  const playback = useEpisodePlayback();
  const { state } = playback;

  // Notify parent when playback is active
  useEffect(() => {
    onBusyChange?.(state.phase === "playing");
  }, [state.phase, onBusyChange]);

  // Auto-fetch episode list when panel opens
  useEffect(() => {
    if (show) {
      playback.fetchEpisodeList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Position panel once measured
  useEffect(() => {
    if (bounds.height > 0) setPosition({ x: 420, y: 70 });
  }, [bounds.height]);

  // Drive the 3D model when action changes and driveRobot is on
  const prevActionRef = useRef<number[] | null>(null);
  useEffect(() => {
    if (!driveRobot || !state.currentAction) return;
    if (state.currentAction === prevActionRef.current) return;
    prevActionRef.current = state.currentAction;

    const revoluteJoints = jointDetails.filter((j) => j.jointType === "revolute");
    const updates = revoluteJoints
      .map((j, i) => ({
        servoId: j.servoId,
        value: state.currentAction![i] ?? 0,
      }))
      .filter((u) => !isNaN(u.value));

    if (updates.length > 0) {
      updateJointsDegrees(updates);
    }
  }, [state.currentAction, driveRobot, jointDetails, updateJointsDegrees]);

  if (!show) return null;

  const handleSelectEpisode = (ep: EpisodeSummary) => {
    playback.loadEpisode(ep);
  };

  const isLoaded = state.phase !== "idle" && state.phase !== "loading";

  const panelContent = (
    <>
      {/* Episode browser */}
      <EpisodeBrowser
        episodes={playback.episodeList}
        loading={playback.listLoading}
        selectedEpisode={state.episode}
        onSelect={handleSelectEpisode}
        onRefresh={playback.fetchEpisodeList}
      />

      {/* Loading indicator with prefetch progress */}
      {state.phase === "loading" && (
        <div className="my-2">
          <div className="text-xs text-zinc-400 animate-pulse mb-1">
            Loading episode{state.prefetchProgress > 0 ? " — prefetching images..." : "..."}
          </div>
          {state.prefetchProgress > 0 && (
            <div className="w-full bg-zinc-700 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-150"
                style={{ width: `${Math.round(state.prefetchProgress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {state.error && (
        <div className="text-xs text-red-400 my-2">{state.error}</div>
      )}

      {/* Playback controls */}
      {isLoaded && (
        <>
          <PlaybackControls
            phase={state.phase}
            frameIndex={state.frameIndex}
            totalFrames={state.totalFrames}
            speed={state.speed}
            fps={state.episode?.fps ?? 30}
            onPlay={playback.play}
            onPause={playback.pause}
            onStop={playback.stop}
            onSeek={playback.seekTo}
            onStepForward={playback.stepForward}
            onStepBackward={playback.stepBackward}
            onSpeedChange={playback.setPlaybackSpeed}
            onUnload={playback.unload}
          />

          {/* Drive robot toggle */}
          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={driveRobot}
                onChange={(e) => setDriveRobot(e.target.checked)}
                className="accent-blue-500"
              />
              Drive 3D model
            </label>
          </div>

          {/* Camera image viewer */}
          <PlaybackImageViewer images={state.currentImages} />

          {/* Joint data display */}
          {state.currentAction && state.episode && (
            <div className="mt-2 border-t border-white/20 pt-2">
              <div className="text-xs font-semibold mb-1 opacity-70">Joint Angles</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
                {state.episode.joint_names.map((name, i) => (
                  <div key={name} className="flex justify-between">
                    <span className="text-zinc-400 truncate mr-1">{name}</span>
                    <span>{state.currentAction![i]?.toFixed(1)}°</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  // ── Sidebar mode ──
  if (mode === "sidebar") {
    return (
      <div className="p-3 text-sm text-white overflow-y-auto h-full">
        {panelContent}
      </div>
    );
  }

  // ── Floating mode (original) ──
  return (
    <Rnd
      position={position}
      onDragStop={(_, d) => setPosition({ x: d.x, y: d.y })}
      bounds="window"
      className="z-50"
      style={{ display: show ? undefined : "none" }}
      cancel="input,select,textarea,button,a,option,div[data-scrubber]"
    >
      <div
        ref={measureRef}
        className={"max-h-[90vh] overflow-y-auto text-sm w-[420px] " + panelStyle}
      >
        <h3 className="mt-0 mb-3 border-b border-white/50 pb-1 font-bold text-base flex justify-between items-center">
          <span>Episode Playback</span>
          <button
            className="ml-2 text-xl hover:bg-zinc-800 px-2 rounded-full"
            title="Close"
            onClick={onHide}
            onTouchEnd={onHide}
          >
            ×
          </button>
        </h3>
        {panelContent}
      </div>
    </Rnd>
  );
};

export default EpisodePlayback;
