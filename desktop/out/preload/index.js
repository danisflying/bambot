"use strict";
const electron = require("electron");
const IPC_CHANNELS = {
  // ── Serial ────────────────────────────────────────────────
  SERIAL_LIST_PORTS: "serial:list-ports",
  SERIAL_CONNECT: "serial:connect",
  SERIAL_DISCONNECT: "serial:disconnect",
  SERIAL_WRITE: "serial:write",
  SERIAL_READ: "serial:read",
  SERIAL_FLUSH_RX: "serial:flush-rx",
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
  PYTHON_ON_EXIT: "python:on-exit"
};
const api = {
  // ── Serial (Phase 1 — native serialport via IPC) ────────
  serial: {
    listPorts: () => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_LIST_PORTS),
    connect: (opts) => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_CONNECT, opts),
    disconnect: (path) => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_DISCONNECT, path),
    write: (path, data) => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_WRITE, path, data),
    read: (path, length) => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_READ, path, length),
    flushRx: (path) => electron.ipcRenderer.invoke(IPC_CHANNELS.SERIAL_FLUSH_RX, path),
    onData: (path, callback) => {
      const handler = (_event, payload) => {
        if (payload.path === path) callback(payload.data);
      };
      electron.ipcRenderer.on(IPC_CHANNELS.SERIAL_ON_DATA, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.SERIAL_ON_DATA, handler);
    },
    onError: (path, callback) => {
      const handler = (_event, payload) => {
        if (payload.path === path) callback(payload.error);
      };
      electron.ipcRenderer.on(IPC_CHANNELS.SERIAL_ON_ERROR, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.SERIAL_ON_ERROR, handler);
    }
  },
  // ── Filesystem ─────────────────────────────────────────
  fs: {
    readEpisodes: () => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_READ_EPISODES),
    readEpisodeDetail: (task, episodeId) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_READ_EPISODE_DETAIL, task, episodeId),
    writeEpisode: (meta, data) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_EPISODE, meta, data),
    deleteEpisode: (robotName, index) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE_EPISODE, robotName, index),
    readFile: (filePath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, filePath),
    writeFile: (filePath, data) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, filePath, data),
    listDir: (dirPath) => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_DIR, dirPath),
    getDataDir: () => electron.ipcRenderer.invoke(IPC_CHANNELS.FS_GET_DATA_DIR)
  },
  // ── Python (stub — Phase 4) ─────────────────────────────
  python: {
    spawn: (opts) => electron.ipcRenderer.invoke(IPC_CHANNELS.PYTHON_SPAWN, opts),
    kill: (pid) => electron.ipcRenderer.invoke(IPC_CHANNELS.PYTHON_KILL, pid),
    onStdout: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_STDOUT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_STDOUT, handler);
    },
    onStderr: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_STDERR, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_STDERR, handler);
    },
    onExit: (callback) => {
      const handler = (_event, code) => callback(code);
      electron.ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_EXIT, handler);
      return () => electron.ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_EXIT, handler);
    }
  }
};
electron.contextBridge.exposeInMainWorld("electron", api);
