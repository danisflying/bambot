/**
 * Python process management IPC handlers — STUB for Phase 0.
 *
 * Phase 4 will implement real child_process.spawn for training / inference.
 */
import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipc-channels";

export function registerPythonIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PYTHON_SPAWN, async (_event, opts) => {
    console.log("[python] spawn stub called", opts);
    throw new Error("Python process management not implemented yet.");
  });

  ipcMain.handle(IPC_CHANNELS.PYTHON_KILL, async (_event, pid: number) => {
    console.log("[python] kill stub called", pid);
    throw new Error("Python process management not implemented yet.");
  });
}
