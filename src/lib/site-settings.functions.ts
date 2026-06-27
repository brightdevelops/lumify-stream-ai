import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Public read of the maintenance mode flag. Reads via the publishable-key
 * client; the public read policy on site_settings makes this safe.
 */
export const getMaintenanceMode = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await supa
    .from("site_settings")
    .select("value")
    .eq("key", "maintenance_mode")
    .maybeSingle();
  return { enabled: Boolean(data?.value) };
});

/**
 * Admin-only toggle. Uses the SECURITY DEFINER `set_site_setting` RPC,
 * which checks admin status server-side.
 */
export const setMaintenanceMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_site_setting", {
      p_key: "maintenance_mode",
      p_value: data.enabled,
    });
    if (error) throw new Error(error.message);
    return { enabled: data.enabled };
  });

/**
 * Server-side guard used by streaming + payment server functions. Throws a
 * clean error when maintenance mode is on so the client sees a 503-style
 * message instead of opening a checkout/stream.
 */
export async function assertNotInMaintenance(reason: "streaming" | "purchase") {
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await supa
    .from("site_settings")
    .select("value")
    .eq("key", "maintenance_mode")
    .maybeSingle();
  if (data?.value) {
    throw new Error(
      reason === "streaming"
        ? "Streaming is temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT."
        : "Credit purchases are temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT.",
    );
  }
}
