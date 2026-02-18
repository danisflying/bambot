import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Episode storage API
 *
 * POST /api/episodes — Save an episode (JSON body with Episode type)
 * GET  /api/episodes — List all saved episodes (summaries only)
 * GET  /api/episodes?task=pick_cup — Filter by task name
 */

// Base directory for episode storage (repo root / data / episodes)
const DATA_DIR = path.join(process.cwd(), "..", "data", "episodes");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

// ── POST: Save episode ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const episode = await request.json();

    // Basic validation
    if (!episode.task || episode.episode_id === undefined || !episode.frames) {
      return NextResponse.json(
        { error: "Missing required fields: task, episode_id, frames" },
        { status: 400 }
      );
    }

    const taskDir = path.join(DATA_DIR, episode.task);
    const episodeDir = path.join(taskDir, `ep_${episode.episode_id}`);
    await ensureDir(episodeDir);

    // Separate images from frames to save them individually
    const imagesDir = path.join(episodeDir, "images");
    await ensureDir(imagesDir);

    // Strip base64 images from frames and save them as files
    const strippedFrames = [];
    for (let i = 0; i < episode.frames.length; i++) {
      const frame = episode.frames[i];
      const imageRefs: Record<string, string> = {};

      if (frame.observation?.images) {
        for (const [camName, base64Data] of Object.entries(
          frame.observation.images
        )) {
          if (typeof base64Data === "string" && base64Data.length > 0) {
            const filename = `frame_${String(i).padStart(6, "0")}_${camName}.jpg`;

            // Strip data URL prefix if present
            const raw = (base64Data as string).replace(
              /^data:image\/\w+;base64,/,
              ""
            );
            const buffer = Buffer.from(raw, "base64");
            await fs.writeFile(path.join(imagesDir, filename), buffer);

            imageRefs[camName] = `images/${filename}`;
          }
        }
      }

      strippedFrames.push({
        timestamp_ms: frame.timestamp_ms,
        observation: {
          qpos: frame.observation.qpos,
          images: imageRefs, // Now contains file paths instead of base64
        },
        action: frame.action,
      });
    }

    // Save episode metadata + stripped frames
    const metadata = {
      task: episode.task,
      episode_id: episode.episode_id,
      robot: episode.robot,
      fps: episode.fps,
      success: episode.success,
      notes: episode.notes,
      joint_names: episode.joint_names,
      camera_names: episode.camera_names,
      frame_count: strippedFrames.length,
      duration_s:
        strippedFrames.length > 0
          ? strippedFrames[strippedFrames.length - 1].timestamp_ms / 1000
          : 0,
      created_at: episode.created_at,
    };

    await fs.writeFile(
      path.join(episodeDir, "episode.json"),
      JSON.stringify(metadata, null, 2)
    );

    await fs.writeFile(
      path.join(episodeDir, "frames.json"),
      JSON.stringify(strippedFrames)
    );

    return NextResponse.json({
      success: true,
      path: `${episode.task}/ep_${episode.episode_id}`,
      frame_count: strippedFrames.length,
    });
  } catch (error) {
    console.error("Failed to save episode:", error);
    return NextResponse.json(
      { error: "Failed to save episode" },
      { status: 500 }
    );
  }
}

// ── GET: List episodes ────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const taskFilter = url.searchParams.get("task");

    await ensureDir(DATA_DIR);

    const taskDirs = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const episodes = [];

    for (const taskEntry of taskDirs) {
      if (!taskEntry.isDirectory()) continue;
      if (taskFilter && taskEntry.name !== taskFilter) continue;

      const taskPath = path.join(DATA_DIR, taskEntry.name);
      const epDirs = await fs.readdir(taskPath, { withFileTypes: true });

      for (const epEntry of epDirs) {
        if (!epEntry.isDirectory()) continue;

        const metaPath = path.join(taskPath, epEntry.name, "episode.json");
        try {
          const raw = await fs.readFile(metaPath, "utf-8");
          const meta = JSON.parse(raw);
          episodes.push(meta);
        } catch {
          // Skip episodes with missing/corrupt metadata
          continue;
        }
      }
    }

    // Sort by created_at descending
    episodes.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({ episodes, count: episodes.length });
  } catch (error) {
    console.error("Failed to list episodes:", error);
    return NextResponse.json(
      { error: "Failed to list episodes" },
      { status: 500 }
    );
  }
}
