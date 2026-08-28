import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getStoredSupabaseSession } from "@/lib/supabase-session-storage";

export type AuthEvent =
  | "unexpected_signout"
  | "recovery_adopted"
  | "recovery_failed"
  | "loading_timeout"
  | "guard_redirect"
  | "refresh_failed";

/**
 * Server-computed issue time is `expires_at - expires_in`, so the difference
 * between that and the local clock is the machine's clock skew in seconds.
 */
export function computeClockSkewSeconds(session: Session | null): number | null {
  if (!session) return null;
  const issuedAt = (session.expires_at ?? 0) - (session.expires_in ?? 0);
  if (!issuedAt) return null;
  return Math.floor(Date.now() / 1000) - issuedAt;
}

/**
 * Fire-and-forget auth telemetry. Never throws, never blocks the auth path.
 */
export function logAuthEvent(
  event: AuthEvent,
  detail: Record<string, unknown> = {},
  session?: Session | null,
) {
  try {
    if (typeof window === "undefined") return;
    const s = session ?? getStoredSupabaseSession();
    void supabase
      .from("auth_events")
      .insert({
        user_id: s?.user?.id ?? null,
        event,
        detail: detail as never,
        clock_skew_seconds: computeClockSkewSeconds(s ?? null),
        visibility_state: typeof document !== "undefined" ? document.visibilityState : null,
        user_agent: navigator?.userAgent ?? null,
      })
      .then(
        () => {},
        () => {},
      );
  } catch {
    // never throw from telemetry
  }
}
