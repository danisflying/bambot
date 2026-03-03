import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

/**
 * Episode image API
 *
 * GET /api/episodes/[task]/[episodeId]/images/[filename] — Serve a specific frame image
 */

const DATA_DIR = path.join(process.cwd(), "..", "data", "episodes");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ task: string; episodeId: string; filename: string }> }
) {
  try {
    const { task, episodeId, filename } = await params;
    const decodedTask = decodeURIComponent(task);

    // Sanitize filename to prevent path traversal
    const safeName = path.basename(filename);
    const imagePath = path.join(
      DATA_DIR,
      decodedTask,
      `ep_${episodeId}`,
      "images",
      safeName
    );

    const buffer = await fs.readFile(imagePath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "ENOENT") {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
    console.error("Failed to serve image:", error);
    return NextResponse.json(
      { error: "Failed to serve image" },
      { status: 500 }
    );
  }
}
