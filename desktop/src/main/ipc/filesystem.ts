/**
 * Filesystem IPC handlers — reads episodes from the data/ directory.
 *
 * Data layout expected at <appRoot>/../data/episodes/{task}/ep_{N}/
 *   episode.json   — EpisodeSummary metadata
 *   frames.json    — StoredFrame[]
 *   images/        — JPEG frames
 */
import { ipcMain, app } from "electron";
import { join } from "path";
import { readdir, readFile } from "fs/promises";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type { EpisodeSummary, StoredEpisodeDetail, DirEntry } from "../../shared/types";

export function getEpisodesDir(): string {
  return join(app.getAppPath(), "..", "data", "episodes");
}

export function registerFilesystemIPC(): void {
  // ── Get base episodes directory ───────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FS_GET_DATA_DIR, async () => {
    return getEpisodesDir();
  });

  // ── List all episodes across all task folders ─────────────────────────
  ipcMain.handle(IPC_CHANNELS.FS_READ_EPISODES, async () => {
    const episodesDir = getEpisodesDir();
    const summaries: EpisodeSummary[] = [];
    try {
      const taskDirs = await readdir(episodesDir, { withFileTypes: true });
      for (const taskEntry of taskDirs) {
        if (!taskEntry.isDirectory()) continue;
        const taskPath = join(episodesDir, taskEntry.name);
        const epDirs = await readdir(taskPath, { withFileTypes: true });
        for (const epEntry of epDirs) {
          if (!epEntry.isDirectory()) continue;
          const episodeJsonPath = join(taskPath, epEntry.name, "episode.json");
          try {
            const raw = await readFile(episodeJsonPath, "utf-8");
            summaries.push(JSON.parse(raw) as EpisodeSummary);
          } catch {
            // skip malformed / incomplete episodes
          }
        }
      }
    } catch (err) {
      console.error("[fs] readEpisodes error:", err);
    }
    // Sort by task then episode_id
    summaries.sort((a, b) => a.task.localeCompare(b.task) || a.episode_id - b.episode_id);
    return summaries;
  });

  // ── Load full episode detail (metadata + frames) ──────────────────────
  ipcMain.handle(
    IPC_CHANNELS.FS_READ_EPISODE_DETAIL,
    async (_event, task: string, episodeId: number) => {
      const epDir = join(getEpisodesDir(), task, `ep_${episodeId}`);
      const [episodeRaw, framesRaw] = await Promise.all([
        readFile(join(epDir, "episode.json"), "utf-8"),
        readFile(join(epDir, "frames.json"), "utf-8"),
      ]);
      const meta = JSON.parse(episodeRaw);
      const frames = JSON.parse(framesRaw);
      return { ...meta, frames } as StoredEpisodeDetail;
    }
  );

  // ── Read a raw file and return as Uint8Array ──────────────────────────
  ipcMain.handle(IPC_CHANNELS.FS_READ_FILE, async (_event, filePath: string) => {
    const buf = await readFile(filePath);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // ── List directory entries ────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FS_LIST_DIR, async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map((e): DirEntry => ({ name: e.name, isDirectory: e.isDirectory() }));
  });

  // ── Stubs (not yet implemented) ───────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.FS_WRITE_EPISODE, async (_event, meta) => {
    console.log("[fs] writeEpisode stub called", meta);
    throw new Error("Filesystem episode write not implemented yet.");
  });

  ipcMain.handle(IPC_CHANNELS.FS_DELETE_EPISODE, async (_event, robotName, index) => {
    console.log("[fs] deleteEpisode stub called", robotName, index);
    throw new Error("Filesystem episode delete not implemented yet.");
  });

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_event, filePath) => {
    console.log("[fs] writeFile stub called", filePath);
    throw new Error("Filesystem writeFile not implemented yet.");
  });
}
