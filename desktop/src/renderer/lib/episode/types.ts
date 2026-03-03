/**
 * Episode types for ACT/SMoLv data collection.
 * These define the data format for recording leader-follower demonstrations
 * with camera images, timestamps, and metadata.
 */

// ── Recorder phase state machine ───────────────────────────────────────────

/** Explicit recording lifecycle — makes impossible states unrepresentable. */
export type RecorderPhase = "idle" | "recording" | "paused" | "reviewing";

// ── Frame & Episode ────────────────────────────────────────────────────────

/** A single frame captured during an episode */
export type EpisodeFrame = {
  /** Milliseconds since episode start */
  timestamp_ms: number;
  /** Observation = what the robot sees / its state */
  observation: {
    /** Leader arm joint angles in degrees (what the human is doing) */
    qpos: number[];
    /** Camera images as base64 JPEG strings, keyed by camera name */
    images: Record<string, string>;
  };
  /** Action = what was commanded to the follower robot (joint angles in degrees) */
  action: number[];
};

/** Metadata + data for a complete episode */
export type Episode = {
  /** Task identifier, e.g. "pick_cup", "stack_blocks" */
  task: string;
  /** Sequential episode number within this task */
  episode_id: number;
  /** Robot identifier, e.g. "so-arm100" */
  robot: string;
  /** Target recording frequency in Hz */
  fps: number;
  /** Whether the demonstration was successful */
  success: boolean;
  /** Optional notes about this episode */
  notes?: string;
  /** Ordered joint names matching qpos/action indices */
  joint_names: string[];
  /** Array of frames captured during the episode */
  frames: EpisodeFrame[];
  /** ISO timestamp of when the episode was created */
  created_at: string;
  /** Camera names used */
  camera_names: string[];
};

/** Summary info for listing episodes (without frame data) — lightweight. */
export type EpisodeSummary = {
  task: string;
  episode_id: number;
  robot: string;
  fps: number;
  success: boolean;
  notes?: string;
  joint_names: string[];
  frame_count: number;
  duration_s: number;
  camera_names: string[];
  created_at: string;
};

/** Build a lightweight summary from a full episode. */
export function toEpisodeSummary(ep: Episode): EpisodeSummary {
  const lastFrame = ep.frames[ep.frames.length - 1];
  return {
    task: ep.task,
    episode_id: ep.episode_id,
    robot: ep.robot,
    fps: ep.fps,
    success: ep.success,
    notes: ep.notes,
    joint_names: ep.joint_names,
    frame_count: ep.frames.length,
    duration_s: lastFrame ? lastFrame.timestamp_ms / 1000 : 0,
    camera_names: ep.camera_names,
    created_at: ep.created_at,
  };
}

// ── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the episode recorder */
export type EpisodeRecorderConfig = {
  /** Target recording frequency in Hz (default: 30) */
  fps: number;
  /** Task name for the current recording session */
  task: string;
  /** Robot name */
  robot: string;
  /** Camera names to capture */
  cameraNames: string[];
};

export const DEFAULT_EPISODE_CONFIG: EpisodeRecorderConfig = {
  fps: 30,
  task: "untitled",
  robot: "so-arm100",
  cameraNames: ["cam_high"],
};
