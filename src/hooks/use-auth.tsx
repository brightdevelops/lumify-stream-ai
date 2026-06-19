import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthCtx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
};

const Ctx = createContext<AuthCtx>({ user: null, session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks whether we've ever seen an authenticated session in this tab.
  // Used to ignore transient `null` sessions emitted during token refresh
  // before Supabase fires an explicit SIGNED_OUT event.
  const hadSessionRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const applySession = (s: Session | null) => {
      if (!mounted) return;
      if (s) hadSessionRef.current = true;
      setSession(s);
    };

    // 1. Subscribe FIRST so we don't miss the initial INITIAL_SESSION event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      // Explicit sign-out — always honour.
      if (event === "SIGNED_OUT") {
        hadSessionRef.current = false;
        applySession(null);
        return;
      }
      // For any other event with a session, apply it (covers SIGNED_IN,
      // TOKEN_REFRESHED, USER_UPDATED, INITIAL_SESSION).
      if (s) {
        applySession(s);
        return;
      }
      // Event with null session that is NOT a sign-out — e.g. a transient
      // refresh failure. If we previously had a session, keep the old one
      // and let auto-refresh retry; don't bounce the user.
      if (!hadSessionRef.current) applySession(null);
    });

    // 2. Then read the persisted session from storage.
    supabase.auth.getSession().then(({ data }) => {
      applySession(data.session ?? null);
      if (mounted) setLoading(false);
    });

    // 3. Cross-tab sync: when another tab signs in/out, Supabase writes to
    //    localStorage. Re-read the session so this tab stays in sync.
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("sb-")) return;
      supabase.auth.getSession().then(({ data }) => applySession(data.session ?? null));
    };
    window.addEventListener("storage", onStorage);

    // 4. On tab refocus, proactively refresh the session. The browser
    //    throttles refresh timers in backgrounded tabs, so the cached
    //    access token may be expired by the time the user returns.
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase.auth.getSession();
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = data.session?.expires_at ?? 0;
      if (data.session && expiresAt - nowSec < 60) {
        const { data: refreshed, error } = await supabase.auth.refreshSession();
        if (error) {
          // Refresh token rejected (e.g. expired) — sign out so the UI
          // routes to /login instead of looping on 401s.
          await supabase.auth.signOut();
          applySession(null);
          return;
        }
        applySession(refreshed.session);
        return;
      }
      applySession(data.session ?? null);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return <Ctx.Provider value={{ user: session?.user ?? null, session, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
