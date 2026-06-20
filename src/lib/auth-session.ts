import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Margin below which we proactively ask the SDK to refresh. Kept small so we
// don't race the SDK's built-in autoRefresh (which also runs on tab focus and
// near expiry). Rotating refresh tokens can only be consumed once — if we
// refresh while the SDK is also refreshing, one call comes back invalid.
const REFRESH_MARGIN_SECONDS = 30;

let sessionCheck: Promise<Session | null> | null = null;

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return typeof atob === "function" ? atob(padded) : "";
}

function getJwtExpiry(accessToken: string | undefined) {
  if (!accessToken) return 0;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return 0;
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: number };
    return typeof parsed.exp === "number" ? parsed.exp : 0;
  } catch {
    return 0;
  }
}

function getExpiresAt(session: Session) {
  return getJwtExpiry(session.access_token) || session.expires_at || 0;
}

async function runSessionCheck() {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  if (!session) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = getExpiresAt(session);

  // Only refresh if the token is actually expired or within the small margin.
  // Never sign the user out from here — transient errors (offline, CORS,
  // server hiccup, or a refresh-token race with the SDK's autoRefresh) must
  // not bounce a freshly-signed-in user back to /login. If the token is truly
  // dead, server requests will surface that on their own and the SDK / auth
  // listener will emit SIGNED_OUT.
  if (expiresAt - nowSec < REFRESH_MARGIN_SECONDS) {
    const { data: refreshed } = await supabase.auth.refreshSession().catch(() => ({ data: { session: null } }));
    if (refreshed?.session) return refreshed.session;
  }

  return session;
}

/**
 * Returns the current Supabase session, refreshed if close to expiry.
 * Non-destructive: never signs the user out, never redirects.
 *
 * The `redirectToLogin` option is accepted for backwards compatibility but
 * intentionally ignored — forcing a redirect on transient refresh failures
 * was logging users out right after they signed in.
 */
export function ensureFreshSupabaseSession(_options: { redirectToLogin?: boolean } = {}) {
  if (!sessionCheck) {
    sessionCheck = runSessionCheck().finally(() => {
      sessionCheck = null;
    });
  }
  return sessionCheck;
}
