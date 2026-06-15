import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/track-visit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            path?: string;
            referrer?: string;
          };
          const path = typeof body.path === "string" ? body.path.slice(0, 500) : "/";
          const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null;
          const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
          const ip = (
            request.headers.get("cf-connecting-ip") ||
            request.headers.get("x-real-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            null
          )?.slice(0, 64) ?? null;

          // Verify user_id server-side from the bearer token instead of trusting
          // client-supplied values. Any unverified token results in an anonymous visit.
          let userId: string | null = null;
          const authHeader = request.headers.get("authorization");
          if (authHeader?.startsWith("Bearer ")) {
            const token = authHeader.slice(7);
            const SUPABASE_URL = process.env.SUPABASE_URL;
            const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
            if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && token) {
              try {
                const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                  auth: { persistSession: false, autoRefreshToken: false },
                });
                const { data } = await anon.auth.getUser(token);
                userId = data.user?.id ?? null;
              } catch {
                userId = null;
              }
            }
          }

          await supabaseAdmin.from("page_visits").insert({
            path,
            referrer,
            user_agent: userAgent,
            user_id: userId,
            ip,
          } as never);

          // Track IP + country on the user's profile (signed-in users only).
          if (userId && ip) {
            let country: string | null = null;
            try {
              const cfCountry = request.headers.get("cf-ipcountry");
              if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1") {
                country = cfCountry;
              } else {
                const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/country_name/`, {
                  headers: { "user-agent": "lumify-inventor/1.0" },
                });
                if (res.ok) {
                  const text = (await res.text()).trim();
                  if (text && !text.toLowerCase().startsWith("undefined") && text.length < 100) country = text;
                }
              }
            } catch {
              country = null;
            }
            try {
              await supabaseAdmin
                .from("profiles")
                .update({ last_ip: ip, ...(country ? { last_country: country } : {}) } as never)
                .eq("id", userId);
            } catch {
              /* ignore */
            }
          }

          return new Response("ok", { status: 200 });
        } catch (err) {
          console.error("track-visit failed", err);
          return new Response("err", { status: 200 });
        }
      },
    },
  },
});
