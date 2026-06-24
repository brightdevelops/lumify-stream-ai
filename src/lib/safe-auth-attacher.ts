import { createMiddleware } from "@tanstack/react-start";

type StoredSupabaseSession = {
  access_token?: string;
  currentSession?: { access_token?: string };
};

function getStoredAccessToken() {
  if (typeof window === "undefined") return null;

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith("sb-") || !key.endsWith("-auth-token")) continue;

    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    try {
      const stored = JSON.parse(raw) as StoredSupabaseSession;
      const token = stored.access_token ?? stored.currentSession?.access_token;
      if (token) return token;
    } catch {
      // Ignore malformed storage and keep looking.
    }
  }

  return null;
}

export const attachStoredSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const accessToken = getStoredAccessToken();
  if (!accessToken) throw new Error("Not authenticated.");

  return next({
    headers: { Authorization: `Bearer ${accessToken}` },
  });
});