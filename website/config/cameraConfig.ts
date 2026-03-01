/**
 * Shared camera defaults — single source of truth used by both
 * useCameras hook and EpisodeControl UI.
 */

export const DEFAULT_CAM_FPS = 30;
export const DEFAULT_CAM_WIDTH = 640;
export const DEFAULT_CAM_HEIGHT = 480;
export const DEFAULT_CAM_QUALITY = 0.85;

/** Preset physical camera slot names (LeRobot convention). */
export const PRESET_CAMERA_NAMES = [
  "cam_high",
  "cam_low",
  "cam_wrist",
  "cam_left",
  "cam_right",
] as const;
