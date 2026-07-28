import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_recent_streams",
  title: "List recent stream sessions",
  description:
    "List the signed-in Lumify user's recent stream sessions with start time, end time, and credits used.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max sessions to return (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("stream_sessions")
      .select("id, started_at, ended_at, credits_used")
      .eq("user_id", ctx.getUserId())
      .order("started_at", { ascending: false })
      .limit(limit ?? 10);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { sessions: data ?? [] },
    };
  },
});
