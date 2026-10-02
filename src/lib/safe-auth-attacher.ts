import { createMiddleware } from "@tanstack/react-start";
import { getStoredSupabaseAccessToken } from "@/lib/supabase-session-storage";
import { logAuthEvent } from "@/lib/auth-telemetry";

/**
 * Attaches the Supabase bearer token to server-function RPCs.
 *
 * STRICTLY READ-ONLY. It reads the stored access token and attaches it as-is,
 * even when it is close to expiry. It must NEVER call refreshSession() or
 * setSession(): the browser SDK's autoRefreshToken is the only thing in this
 * app allowed to refresh a session. A second refresher racing it on the same
 * rotating refresh token makes Supabase revoke the whole token family and
 * signs the user out. If a call fails because the token just expired, it
 * surfaces as a normal error; the SDK will have a fresh token for the next call.
 */
export const attachStoredSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let accessToken: string | null = null;
  try {
    accessToken = getStoredSupabaseAccessToken();
  } catch (err) {
    void logAuthEvent("refresh_failed", {
      where: "safe_auth_attacher",
      message: (err as Error)?.message ?? String(err),
    });
  }

  if (!accessToken) throw new Error("Your session expired. Please sign in again.");

  return next({
    headers: { Authorization: `Bearer ${accessToken}` },
  });
});
