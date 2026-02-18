/**
 * GET /api/bambot/v1/commands/pending
 *
 * Returns pending commands for the browser client to consume and execute.
 * The browser client should poll this endpoint periodically.
 *
 * POST /api/bambot/v1/commands/pending
 *
 * Acknowledge a command (mark as executing, completed, or failed).
 * Called by the browser client after processing a command.
 *
 * Request body:
 *   { "command_id": "cmd_...", "status": "completed", "result": "Joint moved to 90°" }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPendingCommands,
  markCommandExecuting,
  completeCommand,
} from "@/lib/bambot";
import type { ApiResponse, Command } from "@/lib/bambot";

export async function GET() {
  const commands = getPendingCommands("so-arm100");

  // Mark all returned commands as executing
  for (const cmd of commands) {
    markCommandExecuting(cmd.id);
  }

  return NextResponse.json<ApiResponse<{ commands: Command[] }>>({
    success: true,
    data: { commands },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { command_id, status, result } = body;

    if (!command_id) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Missing 'command_id' field." },
        { status: 400 }
      );
    }

    if (!["completed", "failed"].includes(status)) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "Status must be 'completed' or 'failed'.",
        },
        { status: 400 }
      );
    }

    const command = completeCommand(command_id, status, result);

    if (!command) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: `Command '${command_id}' not found.` },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse<Command>>({
      success: true,
      data: command,
    });
  } catch (error) {
    console.error("BamBot ack error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
