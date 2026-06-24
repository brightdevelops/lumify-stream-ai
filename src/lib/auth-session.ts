import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

let sessionCheck: Promise<Session | null> | null = null;

async function runSessionCheck() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/**
 * Returns the current Supabase session without forcing a refresh.
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
