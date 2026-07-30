import { createMiddleware } from "@tanstack/react-start";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";
import { supabase } from "@/integrations/supabase/client";

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

  // Expired or about to expire within 60s → let the SDK hand us a fresh one.
  if (!accessToken || exp === 0 || exp - nowSec <= 60) {
    try {
      const { data } = await supabase.auth.getSession();
      let session = data.session;
      if (!session || (session.expires_at ?? 0) - nowSec <= 60) {
        const refreshed = await supabase.auth.refreshSession();
        session = refreshed.data.session ?? session;
      }
      if (session?.access_token) accessToken = session.access_token;
    } catch {
      // fall through to the stored token / error below
    }
  }

  if (!accessToken) throw new Error("Your session expired. Please sign in again.");

  return next({
    headers: { Authorization: `Bearer ${accessToken}` },
  });
});
