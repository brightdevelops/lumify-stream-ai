import { createMiddleware } from "@tanstack/react-start";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";
import { getFreshAccessToken } from "@/lib/supabase-auth-refresh";

function decodeExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload?.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * Attaches the Supabase bearer token to server-function RPCs.
 *
 * Reads the token straight from localStorage (avoids racing the SDK's
 * autoRefresh), but validates its `exp` first: an expired token used to be
 * sent as-is and the server rejected the call with "JWT expired" — most
 * visibly on the credits/checkout page, which is the main protected
 * server-function path a user hits after a long idle session.
 */
export const attachStoredSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let accessToken = getStoredSupabaseAccessToken();
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = accessToken ? decodeExp(accessToken) : 0;

  // Only when the token is actually expired (small 5s clock-skew margin) do we
  // ask for a new one, and always through the single-flight helper. Refreshing
  // pre-emptively at a 60s margin on EVERY RPC — and doing it once per parallel
  // RPC — burned the rotating refresh token: the winner rotated it and the
  // losers came back 429 / refresh_token_not_found, signing the user out.
  // The SDK's own autoRefreshToken keeps the token fresh in the background.
  if (!accessToken || exp === 0 || exp - nowSec <= 5) {
    const fresh = await getFreshAccessToken();
    if (fresh) accessToken = fresh;
  }

  if (!accessToken) throw new Error("Your session expired. Please sign in again.");

  return next({
    headers: { Authorization: `Bearer ${accessToken}` },
  });
});
