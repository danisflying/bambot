/**
 * GET /api/bambot/v1/tools
 *
 * Returns the tool definitions for AI agents in OpenAI function calling format.
 * Agents can fetch this to discover available robot control tools.
 *
 * Optional query params:
 *   ?format=openai (default) - OpenAI function calling format
 *   ?format=anthropic - Anthropic tool use format
 */

import { NextRequest, NextResponse } from "next/server";
import { getToolDefinitions, getSystemPrompt } from "@/lib/bambot";
import type { ApiResponse } from "@/lib/bambot";

type ToolsResponse = {
  tools: ReturnType<typeof getToolDefinitions>;
  system_prompt: string;
  api_base_url: string;
  robot_id: string;
};

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("format") || "openai";
  const tools = getToolDefinitions();
  const systemPrompt = getSystemPrompt();

  // Determine API base URL from request
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("host") || "localhost:3000";
  const apiBaseUrl = `${protocol}://${host}/api/bambot/v1`;

  if (format === "anthropic") {
    // Convert to Anthropic tool format
    const anthropicTools = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));

    return NextResponse.json<ApiResponse<{ tools: typeof anthropicTools; system_prompt: string; api_base_url: string; robot_id: string }>>({
      success: true,
      data: {
        tools: anthropicTools,
        system_prompt: systemPrompt,
        api_base_url: apiBaseUrl,
        robot_id: "so-arm100",
      },
    });
  }

  return NextResponse.json<ApiResponse<ToolsResponse>>({
    success: true,
    data: {
      tools,
      system_prompt: systemPrompt,
      api_base_url: apiBaseUrl,
      robot_id: "so-arm100",
    },
  });
}
