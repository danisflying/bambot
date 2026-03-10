import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/ipc-channels";
import type { ElectronAPI } from "../shared/types";

const api: ElectronAPI = {
  // ── Serial (Phase 1 — native serialport via IPC) ────────
  serial: {
    listPorts: () => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_LIST_PORTS),
    connect: (opts) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_CONNECT, opts),
    disconnect: (path) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_DISCONNECT, path),
    write: (path, data) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_WRITE, path, data),
    read: (path, length) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_READ, path, length),
    flushRx: (path) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_FLUSH_RX, path),
    setBaudRate: (path, baudRate) => ipcRenderer.invoke(IPC_CHANNELS.SERIAL_SET_BAUD_RATE, path, baudRate),
    onData: (path, callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { path: string; data: number[] }) => {
        if (payload.path === path) callback(payload.data);
      };
      ipcRenderer.on(IPC_CHANNELS.SERIAL_ON_DATA, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SERIAL_ON_DATA, handler);
    },
    onError: (path, callback) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { path: string; error: string }) => {
        if (payload.path === path) callback(payload.error);
      };
      ipcRenderer.on(IPC_CHANNELS.SERIAL_ON_ERROR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.SERIAL_ON_ERROR, handler);
    },
  },

  // ── Filesystem ─────────────────────────────────────────
  fs: {
    readEpisodes: () => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_EPISODES),
    readEpisodeDetail: (task, episodeId) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_READ_EPISODE_DETAIL, task, episodeId),
    writeEpisode: (episode) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_EPISODE, episode),
    deleteEpisode: (robotName, index) =>
      ipcRenderer.invoke(IPC_CHANNELS.FS_DELETE_EPISODE, robotName, index),
    readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.FS_READ_FILE, filePath),
    writeFile: (filePath, data) => ipcRenderer.invoke(IPC_CHANNELS.FS_WRITE_FILE, filePath, data),
    listDir: (dirPath) => ipcRenderer.invoke(IPC_CHANNELS.FS_LIST_DIR, dirPath),
    getDataDir: () => ipcRenderer.invoke(IPC_CHANNELS.FS_GET_DATA_DIR),
  },

  // ── Python (stub — Phase 4) ─────────────────────────────
  python: {
    spawn: (opts) => ipcRenderer.invoke(IPC_CHANNELS.PYTHON_SPAWN, opts),
    kill: (pid) => ipcRenderer.invoke(IPC_CHANNELS.PYTHON_KILL, pid),
    onStdout: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_STDOUT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_STDOUT, handler);
    },
    onStderr: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_STDERR, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_STDERR, handler);
    },
    onExit: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, code: number | null) => callback(code);
      ipcRenderer.on(IPC_CHANNELS.PYTHON_ON_EXIT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.PYTHON_ON_EXIT, handler);
    },
  },
};

contextBridge.exposeInMainWorld("electron", api);
