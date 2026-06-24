import type { Session } from "@supabase/supabase-js";

type StoredSupabaseSession = Partial<Session> & {
  currentSession?: Partial<Session>;
};

export function parseStoredSupabaseSession(raw: string | null): Session | null {
  if (!raw) return null;

  try {
    const stored = JSON.parse(raw) as StoredSupabaseSession;
    const session = stored.currentSession ?? stored;
    return session.access_token && session.user ? (session as Session) : null;
  } catch {
    return null;
  }
}

export function getStoredSupabaseAccessToken() {
  if (typeof window === "undefined") return null;

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

    const session = parseStoredSupabaseSession(window.localStorage.getItem(key));
    if (session?.access_token) return session.access_token;
  }

  return null;
}