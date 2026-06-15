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

          // Track IP + country + VPN flag on the user's profile (signed-in users only).
          if (userId && ip) {
            let country: string | null = null;
            let isVpn: boolean | null = null;
            try {
              // ip-api.com (free, no key): returns country + hosting/proxy flags via 'status' field.
              // Fields: country, proxy (vpn/proxy/tor), hosting (datacenter)
              const res = await fetch(
                `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,proxy,hosting`,
                { headers: { "user-agent": "lumify-inventor/1.0" } },
              );
              if (res.ok) {
                const json = (await res.json()) as {
                  status?: string; country?: string; proxy?: boolean; hosting?: boolean;
                };
                if (json.status === "success") {
                  if (typeof json.country === "string" && json.country.length < 100) country = json.country;
                  isVpn = !!(json.proxy || json.hosting);
                }
              }
              // Fallback for country only if ip-api failed
              if (!country) {
                const cfCountry = request.headers.get("cf-ipcountry");
                if (cfCountry && cfCountry !== "XX" && cfCountry !== "T1") country = cfCountry;
              }
            } catch {
              /* ignore */
            }
            try {
              await supabaseAdmin
                .from("profiles")
                .update({
                  last_ip: ip,
                  ...(country ? { last_country: country } : {}),
                  ...(isVpn !== null ? { is_vpn: isVpn } : {}),
                } as never)
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
