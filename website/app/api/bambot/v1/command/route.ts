/**
 * POST /api/bambot/v1/command
 *
 * Accept a command from an AI agent to control the so-arm100 robot.
 * Only key_press and get_robot_state commands are supported.
 * Direct joint control is not available — use key_press for incremental movements.
 *
 * Request body:
 *   { "action": "key_press", "params": { "key": "i", "duration_ms": 1000 } }
 *
 * Response:
 *   { "success": true, "data": { "command_id": "cmd_...", "status": "pending", "message": "..." } }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  enqueueCommand,
  validateCommand,
  getCommandStatus,
  getRobotState,
} from "@/lib/bambot";
import type { CommandPayload, ApiResponse, CommandResponse } from "@/lib/bambot";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate the action field
    if (!body.action) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Missing 'action' field in request body." },
        { status: 400 }
      );
    }

    const payload: CommandPayload = {
      action: body.action,
      params: body.params || {},
    } as CommandPayload;

    // Validate command
    const validationError = validateCommand(payload);
    if (validationError) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: validationError },
        { status: 400 }
      );
    }

    // Handle get_robot_state inline (read-only, no need to queue)
    if (payload.action === "get_robot_state") {
      const state = getRobotState();
      return NextResponse.json<ApiResponse>({
        success: true,
        data: state,
      });
    }

    // Enqueue the command (only key_press reaches here)
    const command = enqueueCommand("so-arm100", payload);

    return NextResponse.json<ApiResponse<CommandResponse>>({
      success: true,
      data: {
        command_id: command.id,
        status: command.status,
        message: `Command '${body.action}' queued successfully.`,
      },
    });
  } catch (error) {
    console.error("BamBot API error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/bambot/v1/command?id=cmd_...
 *
 * Check the status of a previously submitted command.
 */
export async function GET(request: NextRequest) {
  const commandId = request.nextUrl.searchParams.get("id");

  if (!commandId) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: "Missing 'id' query parameter." },
      { status: 400 }
    );
  }

  const command = getCommandStatus(commandId);

  if (!command) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Command '${commandId}' not found.` },
      { status: 404 }
    );
  }

  return NextResponse.json<ApiResponse>({
    success: true,
    data: command,
  });
}
