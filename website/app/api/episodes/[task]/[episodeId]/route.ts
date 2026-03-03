import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Episode detail API
 *
 * GET /api/episodes/[task]/[episodeId] — Fetch a specific episode's metadata + frames
 */

const DATA_DIR = path.join(process.cwd(), "..", "data", "episodes");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ task: string; episodeId: string }> }
) {
  try {
    const { task, episodeId } = await params;
    const decodedTask = decodeURIComponent(task);
    const episodeDir = path.join(DATA_DIR, decodedTask, `ep_${episodeId}`);

    // Read metadata
    const metaPath = path.join(episodeDir, "episode.json");
    const metaRaw = await fs.readFile(metaPath, "utf-8");
    const metadata = JSON.parse(metaRaw);

    // Read frames
    const framesPath = path.join(episodeDir, "frames.json");
    const framesRaw = await fs.readFile(framesPath, "utf-8");
    const frames = JSON.parse(framesRaw);

    return NextResponse.json({
      ...metadata,
      frames,
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT") {
      return NextResponse.json({ error: "Episode not found" }, { status: 404 });
    }
    console.error("Failed to fetch episode:", error);
    return NextResponse.json(
      { error: "Failed to fetch episode" },
      { status: 500 }
    );
  }
}
