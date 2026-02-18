/**
 * GET /api/bambot/v1/state
 *
 * Get the current state of the robot, including all joint angles.
 *
 * POST /api/bambot/v1/state
 *
 * Update the robot state (called by the browser client to sync state back).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getRobotState,
  updateRobotState,
  updateJointPositions,
  setRobotConnected,
} from "@/lib/bambot";
import type { ApiResponse, RobotState } from "@/lib/bambot";

export async function GET() {
  const state = getRobotState();

  return NextResponse.json<ApiResponse<RobotState>>({
    success: true,
    data: state,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.connected !== undefined) {
      setRobotConnected(body.connected);
    }

    if (body.joints && Array.isArray(body.joints)) {
      updateJointPositions(body.joints);
    }

    const state = getRobotState();

    return NextResponse.json<ApiResponse<RobotState>>({
      success: true,
      data: state,
    });
  } catch (error) {
    console.error("BamBot state update error:", error);
    return NextResponse.json<ApiResponse>(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
