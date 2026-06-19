import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const REFRESH_MARGIN_SECONDS = 120;

let sessionCheck: Promise<Session | null> | null = null;

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  if (typeof atob === "function") return atob(padded);
  if (typeof Buffer !== "undefined") return Buffer.from(padded, "base64").toString("utf8");
  return "";
}

function getJwtExpiry(accessToken: string | undefined) {
  if (!accessToken) return 0;
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return 0;
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: number };
    return typeof parsed.exp === "number" ? parsed.exp : 0;
  } catch {
    return 0;
  }
}

function getExpiresAt(session: Session) {
  return getJwtExpiry(session.access_token) || session.expires_at || 0;
}

async function clearSession(redirectToLogin: boolean) {
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  if (redirectToLogin && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
  return null;
}

async function refreshOrClear(redirectToLogin: boolean) {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session) return clearSession(redirectToLogin);
  return data.session;
}

async function runSessionCheck(redirectToLogin: boolean) {
  const { data } = await supabase.auth.getSession();
  let session = data.session ?? null;
  if (!session) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (getExpiresAt(session) - nowSec < REFRESH_MARGIN_SECONDS) {
    session = await refreshOrClear(redirectToLogin);
    if (!session) return null;
  }

  const verified = await supabase.auth.getUser();
  if (!verified.error && verified.data.user) return session;

  session = await refreshOrClear(redirectToLogin);
  if (!session) return null;

  const reverified = await supabase.auth.getUser();
  if (reverified.error || !reverified.data.user) return clearSession(redirectToLogin);

  return session;
}

export function ensureFreshSupabaseSession(options: { redirectToLogin?: boolean } = {}) {
  if (!sessionCheck) {
    sessionCheck = runSessionCheck(Boolean(options.redirectToLogin)).finally(() => {
      sessionCheck = null;
    });
  }
  return sessionCheck;
}