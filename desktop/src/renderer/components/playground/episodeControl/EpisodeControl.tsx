import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Rnd } from "react-rnd";
import useMeasure from "react-use-measure";
import { panelStyle } from "@/components/playground/panelStyle";
import { useCameras } from "@/hooks/useCameras";
import { useEpisodeRecorder } from "@/hooks/useEpisodeRecorder";
import type { EpisodeRecorderConfig } from "@/lib/episode";
import type { JointState } from "@/hooks/useRobotControl";
import {
  DEFAULT_CAM_FPS,
  DEFAULT_CAM_WIDTH,
  DEFAULT_CAM_HEIGHT,
  DEFAULT_CAM_QUALITY,
} from "@/config/cameraConfig";

import CameraManager from "./CameraManager";
import RecordingControls from "./RecordingControls";
import EpisodeReview from "./EpisodeReview";
import SessionSummary from "./SessionSummary";

// ── Props ──────────────────────────────────────────────────────────────────

interface EpisodeControlProps {
  show: boolean;
  onHide: () => void;
  leaderControl: {
    isConnected: boolean;
    getLastPositions: () => Map<number, number>;
    disconnectLeader: () => Promise<void>;
  };
  jointStates: JointState[];
  jointDetails: {
    name: string;
    servoId: number;
    jointType: "revolute" | "continuous";
  }[];
  robotName: string;
  robotViewCanvas?: HTMLCanvasElement | null;
  /** Notify parent when episode recording is active */
  onBusyChange?: (busy: boolean) => void;
  /** Render inline in sidebar instead of floating Rnd panel */
  mode?: "floating" | "sidebar";
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
  onBusyChange,
  mode = "floating",
}: EpisodeControlProps) => {
  // ── UI state ───────────────────────────────────────────────────────────

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [measureRef, bounds] = useMeasure();
  const [taskName, setTaskName] = useState("untitled");
  const [fps, setFps] = useState(DEFAULT_CAM_FPS);

  // ── Camera manager ─────────────────────────────────────────────────────

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

  // ── Derived joint data ─────────────────────────────────────────────────

  const revoluteJoints = useMemo(
    () => jointDetails.filter((j) => j.jointType === "revolute"),
    [jointDetails]
  );
  const servoIds = useMemo(() => revoluteJoints.map((j) => j.servoId), [revoluteJoints]);
  const jointNames = useMemo(() => revoluteJoints.map((j) => j.name), [revoluteJoints]);

  // Stable ref for follower angles
  const jointStatesRef = useRef(jointStates);
  jointStatesRef.current = jointStates;

  const getFollowerAngles = useCallback((): number[] => {
    return revoluteJoints.map((j) => {
      const st = jointStatesRef.current.find((s) => s.servoId === j.servoId);
      return typeof st?.degrees === "number" ? st.degrees : 0;
    });
  }, [revoluteJoints]);

  // Camera grabbers & names (rebuilt when camera states change)
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

  // ── Episode recorder ───────────────────────────────────────────────────

  const recorderConfig: EpisodeRecorderConfig = useMemo(
    () => ({ fps, task: taskName, robot: robotName, cameraNames }),
    [fps, taskName, robotName, cameraNames]
  );

  const recorder = useEpisodeRecorder(
    {
      getLeaderPositions: leaderControl.getLastPositions,
      getFollowerAngles,
      servoIds,
      jointNames,
      cameraGrabbers,
    },
    recorderConfig
  );

  const { phase, frameCount, elapsedMs, currentEpisodeId, droppedFrames } = recorder.state;

  // Notify parent when episode recording is active
  useEffect(() => {
    onBusyChange?.(phase === "recording" || phase === "paused");
  }, [phase, onBusyChange]);

  // ── Position panel once measured ───────────────────────────────────────

  useEffect(() => {
    if (bounds.height > 0) setPosition({ x: 20, y: 70 });
  }, [bounds.height]);

  // ── Recording handlers (validation layer) ──────────────────────────────

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

  // ── Review data for status bar ─────────────────────────────────────────

  const reviewFrameCount = recorder.lastEpisode?.frames.length;
  const reviewElapsedMs = (() => {
    const ep = recorder.lastEpisode;
    if (!ep || ep.frames.length === 0) return 0;
    return ep.frames[ep.frames.length - 1].timestamp_ms;
  })();

  // ── Render ─────────────────────────────────────────────────────────────

  if (!show) return null;

  const isActive = phase === "recording" || phase === "paused";

  const panelContent = (
    <>
      {/* Cameras */}
      <CameraManager
        cameraStates={cameras.cameraStates}
        cameraCount={cameras.cameraCount}
        allActive={cameras.allActive}
        anyActive={cameras.anyActive}
        availableDevices={cameras.availableDevices}
        locked={isActive}
        addCamera={cameras.addCamera}
        removeCamera={cameras.removeCamera}
        startCamera={cameras.startCamera}
        stopCamera={cameras.stopCamera}
        startSimulatedCamera={cameras.startSimulatedCamera}
        getVideoElement={cameras.getVideoElement}
        robotViewCanvas={robotViewCanvas}
      />

      {/* Config */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs w-12 shrink-0">Task</label>
          <input
            type="text"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            disabled={isActive}
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
            placeholder="e.g. pick_cup"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs w-12 shrink-0">FPS</label>
          <input
            type="number"
            value={fps}
            onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value))))}
            disabled={isActive}
            className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-white"
            min={1}
            max={60}
          />
          <span className="text-xs text-zinc-400">Hz</span>
        </div>
      </div>

      {/* Recording controls & status */}
      <RecordingControls
        phase={phase}
        frameCount={frameCount}
        elapsedMs={elapsedMs}
        currentEpisodeId={currentEpisodeId}
        cameraCount={cameras.cameraCount}
        droppedFrames={droppedFrames}
        reviewFrameCount={reviewFrameCount}
        reviewElapsedMs={reviewElapsedMs}
        onStart={handleStart}
        onPause={recorder.pauseRecording}
        onResume={recorder.resumeRecording}
        onStop={recorder.stopRecording}
        onDiscard={recorder.discardRecording}
      />

      {/* Post-recording review */}
      {phase === "reviewing" && recorder.lastEpisode && (
        <EpisodeReview
          episode={recorder.lastEpisode}
          onSave={recorder.saveEpisode}
          onDownload={recorder.downloadEpisode}
          onAccept={recorder.acceptEpisode}
          onDiscard={recorder.discardReviewedEpisode}
        />
      )}

      {/* Session history */}
      <SessionSummary
        episodes={recorder.completedEpisodes}
        onClear={recorder.clearCompletedEpisodes}
      />
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
      cancel="input,select,textarea,button,a,option"
    >
      <div
        ref={measureRef}
        className={"max-h-[90vh] overflow-y-auto text-sm w-[380px] " + panelStyle}
      >
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
        {panelContent}
      </div>
    </Rnd>
  );
};

export default EpisodeControl;
