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
 * Public read of the Lucy model flag. Returns the Decart model id to use.
 * When `lucy_use_25` is true (default) we run "lucy-latest" (currently 2.5),
 * otherwise "lucy-2.0". The client UI always shows "Lucy 2.5" regardless.
 */
export const getLucyModel = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supa = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await supa
    .from("site_settings")
    .select("value")
    .eq("key", "lucy_use_25")
    .maybeSingle();
  const use25 = data?.value !== false; // default true
  // Decart's current model registry uses "lucy-2.5" and the "lucy-latest" alias.
  // The older 2.0 model is exposed as "lucy-2" (dash, no ".0"). Using "lucy-2.0"
  // throws MODEL_NOT_FOUND at session start.
  return { modelId: use25 ? "lucy-latest" : "lucy-2", use25 };
});

/** Admin-only toggle for the Lucy model version. */
export const setLucyModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ use25: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_site_setting", {
      p_key: "lucy_use_25",
      p_value: data.use25,
    });
    if (error) throw new Error(error.message);
    return { use25: data.use25 };
  });

/**
 * Emails that bypass maintenance mode (owner/admin accounts that need to
 * keep working while the site is paused for users).
 */
export const MAINTENANCE_BYPASS_EMAILS = ["brightsolutionslab@gmail.com"];

/**
 * Server-side guard used by streaming + payment server functions. Throws a
 * clean error when maintenance mode is on so the client sees a 503-style
 * message instead of opening a checkout/stream.
 *
 * Pass the caller's userId to allow bypass emails to keep working.
 */
export async function assertNotInMaintenance(
  reason: "streaming" | "purchase",
  opts?: { userId?: string },
) {
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
  if (!data?.value) return;

  // Maintenance is on — check bypass allowlist by email.
  if (opts?.userId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", opts.userId)
      .maybeSingle();
    if (prof?.email && MAINTENANCE_BYPASS_EMAILS.includes(prof.email.toLowerCase())) {
      return;
    }
  }

  throw new Error(
    reason === "streaming"
      ? "Streaming is temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT."
      : "Credit purchases are temporarily disabled for scheduled maintenance. We'll be back Monday at 9:00 AM WAT.",
  );
}
