import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Returns the Decart API key to authenticated users only.
 *
 * Guards:
 *  - Requires a minimum credit balance.
 *  - Refuses if the user already has an active stream session (prevents
 *    multi-tab / refresh duplicates that would burn Decart usage twice).
 *
 * NOTE: Decart's realtime SDK runs in the browser, so the key must reach the
 * client at some point. Keeping it behind auth + an active-session guard
 * limits exposure and prevents the most common duplicate-session leaks.
 */
export const getDecartKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env.DECART_API_KEY;
    if (!key) throw new Error("Decart not configured");

    const { data: cred, error: credErr } = await context.supabase
      .from("credits")
      .select("balance")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (credErr) throw new Error(credErr.message);
    if (!cred || (cred.balance ?? 0) < 10) {
      throw new Error("Insufficient credits");
    }

    // Reject if the user already has a live stream session (within the
    // 30-second heartbeat window). Blocks multi-tab and quick-refresh dupes.
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    const { data: active, error: activeErr } = await context.supabase
      .from("stream_sessions")
      .select("id")
      .eq("user_id", context.userId)
      .is("ended_at", null)
      .gt("last_heartbeat", cutoff)
      .limit(1)
      .maybeSingle();
    if (activeErr) throw new Error(activeErr.message);
    if (active) {
      throw new Error(
        "Another stream is already active on your account. Close other tabs (or wait ~30 seconds after a refresh) and try again.",
      );
    }

    return { apiKey: key };
  });
