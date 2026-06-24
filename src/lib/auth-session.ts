import type { Session } from "@supabase/supabase-js";
import { parseStoredSupabaseSession } from "@/lib/supabase-session-storage";

let sessionCheck: Promise<Session | null> | null = null;

async function runSessionCheck() {
  if (typeof window === "undefined") return null;

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

    const session = parseStoredSupabaseSession(window.localStorage.getItem(key));
    if (session) return session;
  }

  return null;
}

/**
 * Returns the current stored Supabase session without forcing a refresh.
 * Non-destructive: never signs the user out, never redirects. Supabase's SDK
 * owns token refresh; adding app-level refreshSession() calls can race rotating
 * refresh tokens and kick newly signed-in users back to /login.
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
