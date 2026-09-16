import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STREAMING_PAUSED, STREAMING_PAUSED_MESSAGE } from "@/lib/maintenance";
import { assertNotInMaintenance } from "@/lib/site-settings.functions";

const DECART_API_BASE = "https://api.decart.ai";
export const DECART_MODEL = "lucy-latest";

/**
 * Returns a SHORT-LIVED Decart client token to authenticated users only.
 *
 * Guards:
 *  - Refuses entirely when STREAMING_PAUSED (maintenance) — no Decart
 *    session can start, so no credits get deducted.
 *  - Requires a minimum credit balance.
 *  - Refuses if the user already has an active stream session (prevents
 *    multi-tab / refresh duplicates that would burn Decart usage twice).
 *
 * The permanent DECART_API_KEY never reaches the browser: it is used here to
 * mint a short-lived, model-scoped client token via
 * POST {base}/v1/client/tokens (docs.platform.decart.ai client tokens).
 */
export const getDecartKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (STREAMING_PAUSED) throw new Error(STREAMING_PAUSED_MESSAGE);
    await assertNotInMaintenance("streaming", { userId: context.userId });

    const key = process.env.DECART_API_KEY;
    // Diagnostic only — NEVER log the full key.
    console.log(
      "[decart] key present =", Boolean(key),
      "length =", key?.length ?? 0,
      "prefix =", key ? `${key.slice(0, 4)}…` : "(none)",
    );
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




    // Per-user rate limit on key issuance. The Decart SDK runs in the
    // browser, so the key must reach the client to start a session — we
    // cap how often any one account can request it to limit the blast
    // radius if a user tries to scrape the key and call Decart directly.
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

    // Mint a short-lived, model-scoped client token. Only this token goes to
    // the browser; the permanent key stays server-side.
    const res = await fetch(`${DECART_API_BASE}/v1/client/tokens`, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        expiresIn: 300,
        allowedModels: [DECART_MODEL],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[decart] client token mint failed", res.status, body.slice(0, 500));
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid API key");
      }
      throw new Error(`Decart token error ${res.status}`);
    }

    const json = (await res.json()) as { apiKey?: string; expiresAt?: string };
    if (!json.apiKey) throw new Error("Decart token error: empty token");
    console.log("[decart] client token minted, expiresAt =", json.expiresAt ?? "(unknown)");

    return { apiKey: json.apiKey, expiresAt: json.expiresAt ?? null, model: DECART_MODEL };
  });

