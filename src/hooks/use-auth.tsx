import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { parseStoredSupabaseSession } from "@/lib/supabase-session-storage";

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
  const recoveryAttemptedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applySession = (s: Session | null) => {
      if (!mounted) return;
      if (s) hadSessionRef.current = true;
      sessionRef.current = s;
      setSession(s);
    };

    const finishLoading = () => {
      if (mounted) setLoading(false);
    };

    const clearSignedOut = () => {
      hadSessionRef.current = false;
      applySession(null);
      finishLoading();
    };

    const handleUnexpectedSignOut = () => {
      const current = sessionRef.current;
      const withinWindow = Date.now() - lastSignedInAtRef.current < 30_000;
      if (
        withinWindow &&
        !recoveryAttemptedRef.current &&
        current?.access_token &&
        current?.refresh_token
      ) {
        recoveryAttemptedRef.current = true;
        const access_token = current.access_token;
        const refresh_token = current.refresh_token;
        // Defer — never call auth methods synchronously inside
        // onAuthStateChange; the SDK holds an internal lock.
        setTimeout(async () => {
          try {
            const { data, error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (error || !data.session) {
              clearSignedOut();
            }
            // On success, SIGNED_IN will re-sync everything.
          } catch {
            clearSignedOut();
          }
        }, 0);
        // Do NOT clear state here — wait for setSession result.
        return;
      }
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
        recoveryAttemptedRef.current = false;
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
        recoveryAttemptedRef.current = false;
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
      subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };

  }, []);

  const signOut = useCallback(async () => {
    intentionalSignOutRef.current = true;
    try {
      await supabase.auth.signOut();
    } catch {
      // If signOut throws, reset the flag so a later unexpected SIGNED_OUT
      // can still be evaluated by the race guard.
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
