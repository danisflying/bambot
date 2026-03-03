/**
 * IPC Channel definitions shared between main, preload, and renderer.
 *
 * Phase 0: These are stubs. The renderer still uses Web Serial internally.
 * Phase 1 will implement the actual serialport-backed handlers.
 */
export const IPC_CHANNELS = {
  // ── Serial ────────────────────────────────────────────────
  SERIAL_LIST_PORTS: "serial:list-ports",
  SERIAL_CONNECT: "serial:connect",
  SERIAL_DISCONNECT: "serial:disconnect",
  SERIAL_WRITE: "serial:write",
  SERIAL_READ: "serial:read",
  SERIAL_FLUSH_RX: "serial:flush-rx",
  SERIAL_SET_BAUD_RATE: "serial:set-baud-rate",
  SERIAL_ON_DATA: "serial:on-data",
  SERIAL_ON_ERROR: "serial:on-error",

  // ── Filesystem ────────────────────────────────────────────
  FS_READ_EPISODES: "fs:read-episodes",
  FS_READ_EPISODE_DETAIL: "fs:read-episode-detail",
  FS_WRITE_EPISODE: "fs:write-episode",
  FS_DELETE_EPISODE: "fs:delete-episode",
  FS_READ_FILE: "fs:read-file",
  FS_WRITE_FILE: "fs:write-file",
  FS_LIST_DIR: "fs:list-dir",
  FS_GET_DATA_DIR: "fs:get-data-dir",

  // ── Python ────────────────────────────────────────────────
  PYTHON_SPAWN: "python:spawn",
  PYTHON_KILL: "python:kill",
  PYTHON_ON_STDOUT: "python:on-stdout",
  PYTHON_ON_STDERR: "python:on-stderr",
  PYTHON_ON_EXIT: "python:on-exit",
} as const;

export type IpcChannels = typeof IPC_CHANNELS;
