import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  getStoredSupabaseSession,
  parseStoredSupabaseSession,
} from "@/lib/supabase-session-storage";
import { logAuthEvent } from "@/lib/auth-telemetry";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

/** Pure localStorage read — reuses the single shared parser. */
function readStoredSession(): Session | null {
  return getStoredSupabaseSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks whether we've ever seen an authenticated session in this tab.
  // Used to ignore transient `null` sessions emitted during token refresh
  // before Supabase fires an explicit SIGNED_OUT event.
  const hadSessionRef = useRef(false);
  // Latest session snapshot, mirrored to a ref so async recovery can read
  // the tokens without depending on stale closures.
  const sessionRef = useRef<Session | null>(null);
  // Set true only when the app itself initiated a sign-out. Any SIGNED_OUT
  // event that arrives while this is false is treated as a candidate for
  // the "background-refresh killed a fresh login" race and may be recovered.
  const intentionalSignOutRef = useRef(false);
  const lastSignedInAtRef = useRef(0);
  const loadingRef = useRef(true);

  useEffect(() => {
    let mounted = true;
    let loadingTimer: number | undefined;

    const applySession = (s: Session | null) => {
      if (!mounted) return;
      if (s) hadSessionRef.current = true;
      sessionRef.current = s;
      setSession(s);
    };

    const finishLoading = () => {
      if (loadingTimer !== undefined) {
        window.clearTimeout(loadingTimer);
        loadingTimer = undefined;
      }
      loadingRef.current = false;
      if (mounted) setLoading(false);
    };

    const clearSignedOut = () => {
      hadSessionRef.current = false;
      applySession(null);
      finishLoading();
    };

    const handleUnexpectedSignOut = () => {
      const current = sessionRef.current;
      void logAuthEvent("unexpected_signout", {
        had_session: !!current,
        session_age_seconds: Math.round((Date.now() - lastSignedInAtRef.current) / 1000),
      });

      // NEVER call setSession()/refreshSession() with the tokens we already hold.
      // If the refresh token was consumed, replaying it triggers Supabase's reuse
      // detection and revokes the whole token family.
      const stored = readStoredSession();
      const nowSec = Math.floor(Date.now() / 1000);
      const storedIsNewer =
        !!stored?.access_token &&
        (stored.expires_at ?? 0) > nowSec &&
        stored.access_token !== current?.access_token;

      if (storedIsNewer) {
        // Another tab, or the SDK itself, already wrote a fresh session. Adopt it.
        void logAuthEvent("recovery_adopted", {});
        lastSignedInAtRef.current = Date.now();
        applySession(stored);
        finishLoading();
        return;
      }

      void logAuthEvent("recovery_failed", {});
      clearSignedOut();
    };

    // 1. Subscribe FIRST so we don't miss the initial INITIAL_SESSION event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // Explicit sign-out — apply the race guard unless the app asked for it.
      if (event === "SIGNED_OUT") {
        if (intentionalSignOutRef.current) {
          intentionalSignOutRef.current = false;
          clearSignedOut();
          return;
        }
        handleUnexpectedSignOut();
        return;
      }
      // For any other event with a session, apply it (covers SIGNED_IN,
      // TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION).
      if (s) {
        lastSignedInAtRef.current = Date.now();
        // Keep the realtime socket's token fresh through long sessions.
        try {
          supabase.realtime.setAuth(s.access_token);
        } catch (err) {
          void logAuthEvent("refresh_failed", {
            where: "realtime_setauth",
            message: (err as Error)?.message ?? String(err),
          }, s);
        }
        applySession(s);
        finishLoading();
        return;
      }

      // During token recovery/refresh Supabase can briefly emit a null
      // session before a TOKEN_REFRESHED / INITIAL_SESSION event. Treat that
      // as transient once this tab has seen a real session; only SIGNED_OUT
      // above is allowed to clear an authenticated user.
      if (hadSessionRef.current) {
        finishLoading();
        return;
      }
      applySession(null);
      finishLoading();
    });

    // 1b. Loading-timeout fallback: if the SDK never emits, don't park the
    //     user on "Loading…" forever. Read-only, never redirects.
    loadingTimer = window.setTimeout(() => {
      loadingTimer = undefined;
      if (!mounted) return;
      if (!loadingRef.current) return;
      const stored = readStoredSession();
      const nowSec = Math.floor(Date.now() / 1000);
      const valid = !!stored?.access_token && (stored.expires_at ?? 0) > nowSec;
      void logAuthEvent("loading_timeout", { had_stored: valid }, stored);
      applySession(valid ? stored : null);
      finishLoading();
    }, 8000);

    // 2. Let the SDK emit INITIAL_SESSION from storage. Calling getSession()
    // here can also start a proactive refresh and race the SDK's own startup
    // refresh path on Windows/Edge/Chrome, causing refresh-token revocation.

    // 3. Cross-tab sync: when another tab signs in/out, Supabase writes to
    //    localStorage. Parse the stored value directly instead of calling
    //    getSession(), because getSession() may trigger a refresh during
    //    login startup and compete for the same rotating refresh token.
    const onStorage = (e: StorageEvent) => {
      if (!e.key?.startsWith("sb-") || !e.key.endsWith("-auth-token")) return;
      // Removed key → another tab signed out. Route through the same guard
      // so an unexpected removal doesn't instantly kill a fresh login here.
      if (e.newValue === null) {
        handleUnexpectedSignOut();
        return;
      }
      const parsed = parseStoredSupabaseSession(e.newValue);
      if (parsed) {
        lastSignedInAtRef.current = Date.now();
      }
      applySession(parsed);
    };
    window.addEventListener("storage", onStorage);

    // NOTE: We intentionally do NOT force a refresh on visibilitychange/focus.
    // Supabase's SDK already runs autoRefresh on focus and near expiry. Adding
    // our own manual refreshSession() in parallel consumes the rotating
    // refresh token twice — one call wins, the other comes back invalid and
    // used to sign the user out immediately after login.

    return () => {
      mounted = false;
      if (loadingTimer !== undefined) window.clearTimeout(loadingTimer);
      subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };

  }, []);

  const signOut = useCallback(async () => {
    intentionalSignOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      // If signOut throws, reset the flag so a later unexpected SIGNED_OUT
      // can still be evaluated by the race guard.
      void logAuthEvent("refresh_failed", {
        where: "sign_out",
        message: (err as Error)?.message ?? String(err),
      });
      intentionalSignOutRef.current = false;
    }
  }, []);

  return (
    <Ctx.Provider value={{ user: session?.user ?? null, session, loading, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
