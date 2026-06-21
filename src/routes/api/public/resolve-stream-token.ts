import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/resolve-stream-token")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing token" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("stream_token", token)
          .maybeSingle();
        if (error || !data) {
          return new Response(JSON.stringify({ error: "Invalid stream token" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ userId: data.id }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
