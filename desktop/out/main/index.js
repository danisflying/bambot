"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const serialport = require("serialport");
const promises = require("fs/promises");
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
  PYTHON_KILL: "python:kill"
};
const openPorts = /* @__PURE__ */ new Map();
function pushBytes(state, bytes) {
  for (const b of bytes) state.buffer.push(b);
  const pending = state.waiters.splice(0);
  for (const wake of pending) wake();
}
async function dequeue(state, length, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (state.buffer.length < length && Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(20, remaining));
      state.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return state.buffer.splice(0, Math.min(length, state.buffer.length));
}
function broadcastData(portPath, data) {
  const payload = { path: portPath, data };
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SERIAL_ON_DATA, payload);
    }
  }
}
function broadcastError(portPath, error) {
  const payload = { path: portPath, error };
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.SERIAL_ON_ERROR, payload);
    }
  }
}
function registerSerialIPC() {
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_LIST_PORTS, async () => {
    try {
      const ports = await serialport.SerialPort.list();
      console.log(`[serial] listPorts → ${ports.length} port(s) found`);
      return ports;
    } catch (err) {
      console.error("[serial] listPorts error:", err);
      return [];
    }
  });
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_CONNECT, async (_event, opts) => {
    const { path: path2, baudRate } = opts;
    if (openPorts.has(path2)) {
      console.log(`[serial] connect: ${path2} already open`);
      return;
    }
    return new Promise((resolve, reject) => {
      const port = new serialport.SerialPort({ path: path2, baudRate, autoOpen: false });
      const state = { port, buffer: [], waiters: [] };
      port.on("data", (chunk) => {
        const bytes = Array.from(chunk);
        pushBytes(state, bytes);
        broadcastData(path2, bytes);
      });
      port.on("error", (err) => {
        console.error(`[serial] error on ${path2}:`, err.message);
        broadcastError(path2, err.message);
      });
      port.on("close", () => {
        console.log(`[serial] port closed: ${path2}`);
        openPorts.delete(path2);
      });
      port.open((err) => {
        if (err) {
          console.error(`[serial] failed to open ${path2}:`, err.message);
          reject(new Error(`Failed to open ${path2}: ${err.message}`));
        } else {
          openPorts.set(path2, state);
          console.log(`[serial] opened ${path2} @ ${baudRate} baud`);
          resolve();
        }
      });
    });
  });
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_DISCONNECT, async (_event, path2) => {
    const state = openPorts.get(path2);
    if (!state) return;
    return new Promise((resolve) => {
      state.port.close((err) => {
        if (err) console.warn(`[serial] close error on ${path2}:`, err.message);
        openPorts.delete(path2);
        console.log(`[serial] disconnected ${path2}`);
        resolve();
      });
    });
  });
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_WRITE, async (_event, path2, data) => {
    const state = openPorts.get(path2);
    if (!state) throw new Error(`Port not open: ${path2}`);
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(data);
      state.port.write(buf, (err) => {
        if (err) {
          reject(new Error(`Write failed on ${path2}: ${err.message}`));
        } else {
          state.port.drain((drainErr) => {
            if (drainErr) {
              reject(new Error(`Drain failed on ${path2}: ${drainErr.message}`));
            } else {
              resolve();
            }
          });
        }
      });
    });
  });
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_READ, async (_event, path2, length) => {
    const state = openPorts.get(path2);
    if (!state) throw new Error(`Port not open: ${path2}`);
    const bytes = await dequeue(state, length);
    return bytes;
  });
  electron.ipcMain.handle(IPC_CHANNELS.SERIAL_FLUSH_RX, async (_event, path2) => {
    const state = openPorts.get(path2);
    if (!state) return;
    state.buffer.length = 0;
    const pending = state.waiters.splice(0);
    for (const wake of pending) wake();
    console.log(`[serial] flushed RX buffer for ${path2}`);
  });
}
function getEpisodesDir() {
  return path.join(electron.app.getAppPath(), "..", "data", "episodes");
}
function registerFilesystemIPC() {
  electron.ipcMain.handle(IPC_CHANNELS.FS_GET_DATA_DIR, async () => {
    return getEpisodesDir();
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS_READ_EPISODES, async () => {
    const episodesDir = getEpisodesDir();
    const summaries = [];
    try {
      const taskDirs = await promises.readdir(episodesDir, { withFileTypes: true });
      for (const taskEntry of taskDirs) {
        if (!taskEntry.isDirectory()) continue;
        const taskPath = path.join(episodesDir, taskEntry.name);
        const epDirs = await promises.readdir(taskPath, { withFileTypes: true });
        for (const epEntry of epDirs) {
          if (!epEntry.isDirectory()) continue;
          const episodeJsonPath = path.join(taskPath, epEntry.name, "episode.json");
          try {
            const raw = await promises.readFile(episodeJsonPath, "utf-8");
            summaries.push(JSON.parse(raw));
          } catch {
          }
        }
      }
    } catch (err) {
      console.error("[fs] readEpisodes error:", err);
    }
    summaries.sort((a, b) => a.task.localeCompare(b.task) || a.episode_id - b.episode_id);
    return summaries;
  });
  electron.ipcMain.handle(
    IPC_CHANNELS.FS_READ_EPISODE_DETAIL,
    async (_event, task, episodeId) => {
      const epDir = path.join(getEpisodesDir(), task, `ep_${episodeId}`);
      const [episodeRaw, framesRaw] = await Promise.all([
        promises.readFile(path.join(epDir, "episode.json"), "utf-8"),
        promises.readFile(path.join(epDir, "frames.json"), "utf-8")
      ]);
      const meta = JSON.parse(episodeRaw);
      const frames = JSON.parse(framesRaw);
      return { ...meta, frames };
    }
  );
  electron.ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_event, filePath) => {
    const buf = await promises.readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS_LIST_DIR, async (_event, dirPath) => {
    const entries = await promises.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS_WRITE_EPISODE, async (_event, meta) => {
    console.log("[fs] writeEpisode stub called", meta);
    throw new Error("Filesystem episode write not implemented yet.");
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS_DELETE_EPISODE, async (_event, robotName, index) => {
    console.log("[fs] deleteEpisode stub called", robotName, index);
    throw new Error("Filesystem episode delete not implemented yet.");
  });
  electron.ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_event, filePath) => {
    console.log("[fs] writeFile stub called", filePath);
    throw new Error("Filesystem writeFile not implemented yet.");
  });
}
function registerPythonIPC() {
  electron.ipcMain.handle(IPC_CHANNELS.PYTHON_SPAWN, async (_event, opts) => {
    console.log("[python] spawn stub called", opts);
    throw new Error("Python process management not implemented yet.");
  });
  electron.ipcMain.handle(IPC_CHANNELS.PYTHON_KILL, async (_event, pid) => {
    console.log("[python] kill stub called", pid);
    throw new Error("Python process management not implemented yet.");
  });
}
electron.protocol.registerSchemesAsPrivileged([
  { scheme: "local", privileges: { secure: true, standard: true, supportFetchAPI: true } }
]);
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "BamBot",
    backgroundColor: "#0a0f1a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (utils.is.dev) {
      mainWindow.webContents.openDevTools();
    }
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levelStr = ["VERBOSE", "INFO", "WARN", "ERROR"][level] || "LOG";
    console.log(`[renderer:${levelStr}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
electron.app.whenReady().then(() => {
  utils.electronApp.setAppUserModelId("com.bambot.desktop");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  registerSerialIPC();
  registerFilesystemIPC();
  registerPythonIPC();
  electron.protocol.registerFileProtocol("local", (request, callback) => {
    const url = request.url.replace(/^local:\/\//, "");
    const decoded = decodeURIComponent(url);
    const episodesDir = getEpisodesDir();
    const filePath = path.join(episodesDir, decoded);
    callback({ path: filePath });
  });
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
