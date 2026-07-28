import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type OAuthNS = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

function oauth(): OAuthNS {
  return (supabase.auth as unknown as { oauth: OAuthNS }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/login", search: { next } as any });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen grid place-items-center bg-background p-6 text-sm text-muted-foreground">
      Could not load this authorization request: {String((error as Error)?.message ?? error)}
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData() as any;
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) { setBusy(false); setError(error.message); return; }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); setError("No redirect returned by the authorization server."); return; }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";
  const redirectUri = details?.client?.redirect_uri ?? details?.client?.redirect_uris?.[0];

  return (
    <main className="min-h-screen grid place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8">
        <h1 className="text-2xl">Connect {clientName} to Lumify</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This lets {clientName} use Lumify's tools as you — read your credit balance,
          recent stream sessions, and profile.
        </p>
        {redirectUri && (
          <p className="mt-3 text-xs text-muted-foreground break-all">
            Redirect: <span className="text-foreground">{redirectUri}</span>
          </p>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          This does not bypass Lumify's permissions or backend policies.
        </p>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        <div className="mt-6 flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Please wait…" : "Approve"}
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-border bg-transparent px-4 py-2.5 text-sm text-foreground hover:bg-muted/40 disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}
