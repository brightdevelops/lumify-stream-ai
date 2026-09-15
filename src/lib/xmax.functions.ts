import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STREAMING_PAUSED, STREAMING_PAUSED_MESSAGE } from "@/lib/maintenance";
import { assertNotInMaintenance } from "@/lib/site-settings.functions";

/**
 * Mints a short-lived Xmax temporary API key (tk-...) for the browser.
 *
 * The permanent key (uk-...) never leaves the server: we call the Open API
 * issuance endpoint with it and hand the client only the temporary key.
 *
 * Guards mirror the previous Decart key issuance:
 *  - refuses entirely during maintenance / streaming pause,
 *  - requires a minimum credit balance,
 *  - per-user rate limit on issuance.
 */
export const getXmaxKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (STREAMING_PAUSED) throw new Error(STREAMING_PAUSED_MESSAGE);
    await assertNotInMaintenance("streaming", { userId: context.userId });

    const masterKey = process.env.XMAX_API_KEY;
    if (!masterKey) throw new Error("Streaming engine not configured");

    const { data: cred, error: credErr } = await context.supabase
      .from("credits")
      .select("balance")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (credErr) throw new Error(credErr.message);
    const balance = cred?.balance ?? 0;
    if (!cred || balance < 10) {
      throw new Error("Insufficient credits");
    }

    // Per-user rate limit on key issuance.
    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: recentCount, error: rateErr } = await context.supabase
      .from("stream_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gt("started_at", hourAgo);
    if (rateErr) throw new Error(rateErr.message);
    if ((recentCount ?? 0) >= 60) {
      throw new Error(
        "You've started too many streams in the last hour. Please wait a bit before starting another.",
      );
    }

    // Same Open API backend the browser SDK talks to (global build default),
    // so the minted temporary key is valid for the realtime session.
    const baseUrl = process.env.XMAX_API_BASE_URL || "https://api.xmax.cloud/open/api/v1";

    const res = await fetch(`${baseUrl}/temporary-api-key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Api-Key": masterKey,
      },
      body: JSON.stringify({
        // One hour of validity is plenty for a single studio session.
        expireSeconds: 3600,
        // Cap provider-side spend per issued key so a leaked temporary key
        // can't burn the whole account.
        pointsLimit: 3000,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("[xmax] temporary key issuance failed", res.status, text.slice(0, 500));
      throw new Error("Invalid API key");
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      console.error("[xmax] temporary key issuance returned non-JSON", text.slice(0, 500));
      throw new Error("Streaming engine is temporarily unavailable");
    }

    const apiKey = payload?.data?.temporaryApiKey;
    if (!apiKey) {
      console.error("[xmax] temporary key missing in response", text.slice(0, 500));
      throw new Error("Invalid API key");
    }

    return {
      apiKey: apiKey as string,
      expireTimestamp: (payload?.data?.expireTimestamp ?? null) as string | null,
    };
  });
