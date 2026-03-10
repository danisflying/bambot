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
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { IPC_CHANNELS } from "../../shared/ipc-channels";
import type {
  EpisodeSummary,
  StoredEpisodeDetail,
  DirEntry,
  EpisodeWritePayload,
  EpisodeWriteResult,
} from "../../shared/types";

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

  // ── Write a full episode to disk ────────────────────────────────────────
  //
  // Directory layout:
  //   data/episodes/{task}/ep_{N}/
  //     episode.json  — lightweight summary (no frame data)
  //     frames.json   — frame metadata with image paths (not base64)
  //     images/       — JPEG files: frame_000000_cam_high.jpg, …
  //
  ipcMain.handle(
    IPC_CHANNELS.FS_WRITE_EPISODE,
    async (_event, episode: EpisodeWritePayload): Promise<EpisodeWriteResult> => {
      const epDir = join(getEpisodesDir(), episode.task, `ep_${episode.episode_id}`);
      const imagesDir = join(epDir, "images");

      try {
        await mkdir(imagesDir, { recursive: true });

        // Build stored frames (images replaced with relative paths) and write images
        const storedFrames: {
          timestamp_ms: number;
          observation: { qpos: number[]; images: Record<string, string> };
          action: number[];
        }[] = [];

        const imageWrites: Promise<void>[] = [];

        for (let i = 0; i < episode.frames.length; i++) {
          const frame = episode.frames[i];
          const storedImages: Record<string, string> = {};
          const padded = String(i).padStart(6, "0");

          for (const [camName, base64Data] of Object.entries(frame.observation.images)) {
            const filename = `frame_${padded}_${camName}.jpg`;
            storedImages[camName] = `images/${filename}`;

            // Strip data-URI prefix if present: "data:image/jpeg;base64,..."
            const raw = base64Data.includes(",")
              ? base64Data.split(",")[1]
              : base64Data;
            imageWrites.push(writeFile(join(imagesDir, filename), Buffer.from(raw, "base64")));
          }

          storedFrames.push({
            timestamp_ms: frame.timestamp_ms,
            observation: { qpos: frame.observation.qpos, images: storedImages },
            action: frame.action,
          });
        }

        // Write all images in parallel
        await Promise.all(imageWrites);

        // Write frames.json
        await writeFile(join(epDir, "frames.json"), JSON.stringify(storedFrames), "utf-8");

        // Write episode.json (summary — no frame data)
        const lastFrame = episode.frames[episode.frames.length - 1];
        const summary: EpisodeSummary = {
          task: episode.task,
          episode_id: episode.episode_id,
          robot: episode.robot,
          fps: episode.fps,
          success: episode.success,
          notes: episode.notes,
          joint_names: episode.joint_names,
          frame_count: episode.frames.length,
          duration_s: lastFrame ? lastFrame.timestamp_ms / 1000 : 0,
          camera_names: episode.camera_names,
          created_at: episode.created_at,
        };
        await writeFile(join(epDir, "episode.json"), JSON.stringify(summary, null, 2), "utf-8");

        console.log(
          `[fs] Saved episode: ${episode.task}/ep_${episode.episode_id} — ${episode.frames.length} frames, ${imageWrites.length} images`
        );
        return { success: true, path: epDir };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fs] writeEpisode error:`, err);
        return { success: false, path: epDir, error: message };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.FS_DELETE_EPISODE, async (_event, robotName, index) => {
    console.log("[fs] deleteEpisode stub called", robotName, index);
    throw new Error("Filesystem episode delete not implemented yet.");
  });

  ipcMain.handle(IPC_CHANNELS.FS_WRITE_FILE, async (_event, filePath) => {
    console.log("[fs] writeFile stub called", filePath);
    throw new Error("Filesystem writeFile not implemented yet.");
  });
}
