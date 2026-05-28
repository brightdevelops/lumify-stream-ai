import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/track-visit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            path?: string;
            referrer?: string;
            user_id?: string | null;
          };
          const path = typeof body.path === "string" ? body.path.slice(0, 500) : "/";
          const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null;
          const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
          const userId = typeof body.user_id === "string" ? body.user_id : null;
          const ip = (
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-real-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            null
          )?.slice(0, 64) ?? null;

          await supabaseAdmin.from("page_visits").insert({
            path,
            referrer,
            user_agent: userAgent,
            user_id: userId,
            ip,
          } as never);
          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("track-visit failed", err);
          return new Response("err", { status: 200 });
        }
      },
    },
  },
});
