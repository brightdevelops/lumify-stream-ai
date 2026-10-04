import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { computeClockSkewSeconds, logAuthEvent } from "@/lib/auth-telemetry";

/**
 * Clock-skew guard + refresh circuit breaker.
 * Neither ever refreshes, sets, or clears a session — they only STOP the SDK's
 * background refresher (the single refresher) and surface a banner.
 */

export const MAX_CLOCK_SKEW_SECONDS = 120;
const LOOP_WINDOW_MS = 60_000;
const LOOP_MAX_REFRESHES = 3;

export type AuthGuardBanner = { kind: "clock_skew" | "refresh_loop" } | null;

let banner: AuthGuardBanner = null;
const listeners = new Set<() => void>();
let refreshTimes: number[] = [];
let halted = false;

export function getAuthGuardBanner() {
  return banner;
}
export function subscribeAuthGuard(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function haltRefresh(kind: "clock_skew" | "refresh_loop") {
  if (!banner) {
    banner = { kind };
    listeners.forEach((l) => l());
  }
  if (halted) return;
  halted = true;
  try {
    void supabase.auth.stopAutoRefresh().catch(() => {});
  } catch {
    // stopping is best-effort; banner is already shown
  }
}

let haltReason: "clock_skew" | "refresh_loop" | null = null;

/** Call ONLY with a freshly issued token (SIGNED_IN / TOKEN_REFRESHED). */
export function checkSessionClock(session: Session | null) {
  const skew = computeClockSkewSeconds(session);
  if (skew === null) return;
  if (Math.abs(skew) <= MAX_CLOCK_SKEW_SECONDS) {
    // Normal clock on a fresh token: clear a clock-skew banner and resume refresh.
    if (banner?.kind === "clock_skew") {
      banner = null;
      listeners.forEach((l) => l());
    }
    if (halted && haltReason === "clock_skew") {
      halted = false;
      haltReason = null;
      try {
        void supabase.auth.startAutoRefresh().catch(() => {});
      } catch {
        // best-effort
      }
    }
    return;
  }
  const first = !halted;
  if (first) haltReason = "clock_skew";
  haltRefresh("clock_skew");
  if (first) void logAuthEvent("clock_skew_detected", { skew_seconds: skew }, session);
}

/** Call on every TOKEN_REFRESHED. Trips after >3 refreshes in 60s. */
export function recordTokenRefresh(session: Session | null) {
  const now = Date.now();
  refreshTimes = refreshTimes.filter((t) => now - t < LOOP_WINDOW_MS);
  refreshTimes.push(now);
  if (refreshTimes.length > LOOP_MAX_REFRESHES && !halted) {
    haltRefresh("refresh_loop");
    void logAuthEvent(
      "refresh_loop_blocked",
      { refreshes_in_window: refreshTimes.length, window_seconds: LOOP_WINDOW_MS / 1000 },
      session,
    );
  }
}
