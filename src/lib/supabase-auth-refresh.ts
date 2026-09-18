import { supabase } from "@/integrations/supabase/client";

/**
 * Single-flight session read.
 *
 * Supabase's SDK already owns token refresh (autoRefreshToken: true), and
 * `getSession()` refreshes an expired token internally. The problem this
 * module solves is CONCURRENCY: several server-function RPCs (and the stream
 * page's own RPCs) can each ask for a token at the same moment. With rotating
 * refresh tokens only the first request wins — the rest come back
 * `over_request_rate_limit` (429) or `refresh_token_not_found`, which used to
 * leave the tab holding a dead token and sign the user out.
 *
 * Everything that needs a fresh access token funnels through here, so at most
 * one refresh is ever in flight per tab.
 */
let inFlight: Promise<string | null> | null = null;

async function readSession(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Returns a usable access token, deduplicating concurrent callers. */
export function getFreshAccessToken(): Promise<string | null> {
  if (!inFlight) {
    inFlight = readSession().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
