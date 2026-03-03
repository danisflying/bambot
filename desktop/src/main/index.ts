import { app, BrowserWindow, shell, protocol } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { registerSerialIPC } from "./ipc/serial";
import { registerFilesystemIPC, getEpisodesDir } from "./ipc/filesystem";
import { registerPythonIPC } from "./ipc/python";

// Register custom scheme before app is ready so it can load privileged resources
protocol.registerSchemesAsPrivileged([
  { scheme: "local", privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: "BamBot",
    backgroundColor: "#0a0f1a",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    if (is.dev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Log renderer console messages to main process stdout
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levelStr = ["VERBOSE", "INFO", "WARN", "ERROR"][level] || "LOG";
    console.log(`[renderer:${levelStr}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // Load the renderer
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  // Set app user model id for Windows
  electronApp.setAppUserModelId("com.bambot.desktop");

  // Default open or close DevTools by F12 in dev
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Register IPC handlers
  registerSerialIPC();
  registerFilesystemIPC();
  registerPythonIPC();

  // Serve local episode files via the `local://` scheme
  // e.g. local://episodes/pickup%20bottle/ep_0/images/frame_000000_cam_high.jpg
  protocol.registerFileProtocol("local", (request, callback) => {
    const url = request.url.replace(/^local:\/\//, "");
    const decoded = decodeURIComponent(url);
    // local:// is relative to the episodes dir's parent (data/)
    const episodesDir = getEpisodesDir();
    const filePath = join(episodesDir, decoded);
    callback({ path: filePath });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
