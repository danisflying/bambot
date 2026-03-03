/**
 * Shared types used by both main and renderer processes.
 */

// ── Serial ────────────────────────────────────────────────

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  vendorId?: string;
  productId?: string;
}

export interface SerialConnectOptions {
  path: string;
  baudRate: number;
}

// ── Filesystem ────────────────────────────────────────────

export interface EpisodeMeta {
  robotName: string;
  episodeIndex: number;
  frameCount: number;
  timestamp: string;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** Summary metadata for a saved episode (matches episode.json on disk). */
export interface EpisodeSummary {
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
}

/** A single stored frame (images are relative paths like "images/frame_000000_cam_high.jpg"). */
export interface StoredFrame {
  timestamp_ms: number;
  observation: {
    qpos: number[];
    images: Record<string, string>;
  };
  action: number[];
}

/** Full episode detail returned by FS_READ_EPISODE_DETAIL (summary + frames). */
export interface StoredEpisodeDetail extends EpisodeSummary {
  frames: StoredFrame[];
}

// ── Python ────────────────────────────────────────────────

export interface PythonSpawnOptions {
  script: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface PythonProcessInfo {
  pid: number;
  script: string;
  running: boolean;
}

// ── Electron API exposed to renderer ────────────────────

export interface ElectronAPI {
  serial: {
    listPorts: () => Promise<SerialPortInfo[]>;
    connect: (opts: SerialConnectOptions) => Promise<void>;
    disconnect: (path: string) => Promise<void>;
    write: (path: string, data: number[]) => Promise<void>;
    read: (path: string, length: number) => Promise<number[]>;
    flushRx: (path: string) => Promise<void>;
    /** Subscribe to streaming bytes from a specific port. Returns an unsubscribe fn. */
    onData: (path: string, callback: (data: number[]) => void) => () => void;
    /** Subscribe to error events from a specific port. Returns an unsubscribe fn. */
    onError: (path: string, callback: (error: string) => void) => () => void;
  };
  fs: {
    readEpisodes: () => Promise<EpisodeSummary[]>;
    readEpisodeDetail: (task: string, episodeId: number) => Promise<StoredEpisodeDetail>;
    writeEpisode: (meta: EpisodeMeta, data: ArrayBuffer) => Promise<void>;
    deleteEpisode: (robotName: string, index: number) => Promise<void>;
    readFile: (filePath: string) => Promise<Uint8Array>;
    writeFile: (filePath: string, data: Uint8Array) => Promise<void>;
    listDir: (dirPath: string) => Promise<DirEntry[]>;
    getDataDir: () => Promise<string>;
  };
  python: {
    spawn: (opts: PythonSpawnOptions) => Promise<PythonProcessInfo>;
    kill: (pid: number) => Promise<void>;
    onStdout: (callback: (data: string) => void) => () => void;
    onStderr: (callback: (data: string) => void) => () => void;
    onExit: (callback: (code: number | null) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
