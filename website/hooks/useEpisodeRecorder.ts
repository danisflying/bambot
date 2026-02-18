"use client";

import { useState, useCallback, useRef } from "react";
import {
  Episode,
  EpisodeFrame,
  EpisodeRecorderConfig,
  DEFAULT_EPISODE_CONFIG,
} from "@/lib/episode";
import { servoPositionToAngle } from "@/lib/utils";

type GrabFrameBase64Fn = () => string | null;

type EpisodeRecorderDeps = {
  /** Function to read leader arm positions — returns Map<servoId, rawServoPosition> */
  getLeaderPositions: () => Promise<Map<number, number>>;
  /** Current follower joint states — we read the last-commanded angles */
  getFollowerAngles: () => number[];
  /** Ordered servo IDs matching the joint order */
  servoIds: number[];
  /** Ordered joint names matching the joint order */
  jointNames: string[];
  /** Camera frame grabbers, keyed by camera name. Each returns base64 JPEG or null */
  cameraGrabbers: Record<string, GrabFrameBase64Fn>;
};

export type EpisodeRecorderState = {
  isRecording: boolean;
  isPaused: boolean;
  frameCount: number;
  elapsedMs: number;
  currentEpisodeId: number;
};

/**
 * Hook for recording ACT-compatible episodes.
 * Syncs: leader arm read (observation qpos) + follower write (action) + camera frames.
 */
export function useEpisodeRecorder(
  deps: EpisodeRecorderDeps,
  config: EpisodeRecorderConfig = DEFAULT_EPISODE_CONFIG
) {
  const [state, setState] = useState<EpisodeRecorderState>({
    isRecording: false,
    isPaused: false,
    frameCount: 0,
    elapsedMs: 0,
    currentEpisodeId: 0,
  });

  // Internal refs to avoid stale closures in the interval
  const framesRef = useRef<EpisodeFrame[]>([]);
  const startTimeRef = useRef<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configRef = useRef(config);
  const depsRef = useRef(deps);

  // Keep refs up to date
  configRef.current = config;
  depsRef.current = deps;

  // Completed episodes this session (for batch save)
  const [completedEpisodes, setCompletedEpisodes] = useState<Episode[]>([]);

  const captureFrame = useCallback(async () => {
    const { getLeaderPositions, getFollowerAngles, servoIds, cameraGrabbers } =
      depsRef.current;
    const now = performance.now();
    const timestamp_ms = Math.round(now - startTimeRef.current);

    // 1. Read leader arm positions (observation qpos)
    let qpos: number[];
    try {
      const posMap = await getLeaderPositions();
      qpos = servoIds.map((id) => {
        const raw = posMap.get(id);
        return raw !== undefined ? servoPositionToAngle(raw) : 0;
      });
    } catch {
      // If leader read fails, use zeros
      qpos = servoIds.map(() => 0);
    }

    // 2. Read follower joint angles (action — what was commanded)
    const action = getFollowerAngles();

    // 3. Grab camera frames
    const images: Record<string, string> = {};
    for (const [camName, grabFn] of Object.entries(cameraGrabbers)) {
      const frame = grabFn();
      if (frame) {
        images[camName] = frame;
      }
    }

    const frame: EpisodeFrame = {
      timestamp_ms,
      observation: { qpos, images },
      action,
    };

    framesRef.current.push(frame);
    setState((prev) => ({
      ...prev,
      frameCount: framesRef.current.length,
      elapsedMs: timestamp_ms,
    }));
  }, []);

  // Start recording a new episode
  const startRecording = useCallback(() => {
    framesRef.current = [];
    startTimeRef.current = performance.now();

    const intervalMs = Math.round(1000 / configRef.current.fps);

    intervalRef.current = setInterval(() => {
      captureFrame();
    }, intervalMs);

    setState((prev) => ({
      ...prev,
      isRecording: true,
      isPaused: false,
      frameCount: 0,
      elapsedMs: 0,
    }));
  }, [captureFrame]);

  // Pause recording (keeps frames, stops capturing)
  const pauseRecording = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState((prev) => ({ ...prev, isPaused: true }));
  }, []);

  // Resume recording after pause
  const resumeRecording = useCallback(() => {
    const intervalMs = Math.round(1000 / configRef.current.fps);
    intervalRef.current = setInterval(() => {
      captureFrame();
    }, intervalMs);
    setState((prev) => ({ ...prev, isPaused: false }));
  }, [captureFrame]);

  // Stop recording and bundle into an Episode
  const stopRecording = useCallback(
    (success: boolean = true, notes?: string): Episode | null => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      const frames = [...framesRef.current];
      if (frames.length === 0) {
        setState((prev) => ({
          ...prev,
          isRecording: false,
          isPaused: false,
        }));
        return null;
      }

      const cfg = configRef.current;
      const episodeId = state.currentEpisodeId;

      const episode: Episode = {
        task: cfg.task,
        episode_id: episodeId,
        robot: cfg.robot,
        fps: cfg.fps,
        success,
        notes,
        joint_names: depsRef.current.jointNames,
        frames,
        camera_names: cfg.cameraNames,
        created_at: new Date().toISOString(),
      };

      setCompletedEpisodes((prev) => [...prev, episode]);
      framesRef.current = [];

      setState((prev) => ({
        ...prev,
        isRecording: false,
        isPaused: false,
        frameCount: 0,
        elapsedMs: 0,
        currentEpisodeId: prev.currentEpisodeId + 1,
      }));

      return episode;
    },
    [state.currentEpisodeId]
  );

  // Discard current recording without saving
  const discardRecording = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    framesRef.current = [];
    setState((prev) => ({
      ...prev,
      isRecording: false,
      isPaused: false,
      frameCount: 0,
      elapsedMs: 0,
    }));
  }, []);

  // Save episode to server
  const saveEpisode = useCallback(async (episode: Episode): Promise<boolean> => {
    try {
      const res = await fetch("/api/episodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(episode),
      });
      return res.ok;
    } catch (err) {
      console.error("Failed to save episode:", err);
      return false;
    }
  }, []);

  // Download episode as JSON locally
  const downloadEpisode = useCallback((episode: Episode) => {
    const dataStr = JSON.stringify(episode);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${episode.task}_ep${episode.episode_id}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  // Clear completed episodes list
  const clearCompletedEpisodes = useCallback(() => {
    setCompletedEpisodes([]);
  }, []);

  return {
    state,
    completedEpisodes,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    saveEpisode,
    downloadEpisode,
    clearCompletedEpisodes,
  };
}
