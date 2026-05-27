import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { getMyStreamToken, regenerateMyStreamToken } from "@/lib/stream-token.functions";

const OUTPUT_ORIGIN = "https://lumify-stream-ai.lovable.app";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const obsUrl = token ? `${OUTPUT_ORIGIN}/output?token=${token}` : "";

  useEffect(() => {
    getMyStreamToken()
      .then(({ token }) => token && setToken(token))
      .catch(() => {});
  }, []);

  const copyUrl = async () => {
    if (!obsUrl) return;
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const { token } = await regenerateMyStreamToken();
      setToken(token);
      setConfirm(false);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Manage your account and stream defaults.</p>

      <section className="mt-8 rounded-xl border border-border bg-card p-6 space-y-5">
        <h2 className="text-lg">Profile</h2>
        <Field label="Display name" defaultValue="Creator" />
        <Field label="Email" defaultValue="you@studio.com" type="email" />
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Save changes</button>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <h2 className="text-lg">OBS Stream URL</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste this URL into an OBS Browser Source to receive your AI output. It's permanent and private to you.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2">
          <code className="flex-1 truncate text-xs font-mono text-muted-foreground">
            {obsUrl || "Loading…"}
          </code>
          <button
            onClick={copyUrl}
            disabled={!obsUrl}
            className="inline-flex items-center gap-1 rounded border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-secondary disabled:opacity-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            <RefreshCw className="h-4 w-4" /> Regenerate token
          </button>
        ) : (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="text-foreground">
              This will invalidate your current OBS URL. You'll need to paste the new URL into OBS.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={regenerate}
                disabled={regenerating}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                {regenerating ? "Regenerating…" : "Yes, regenerate"}
              </button>
              <button
                onClick={() => setConfirm(false)}
                disabled={regenerating}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-6 space-y-5">
        <h2 className="text-lg">Stream defaults</h2>
        <Field label="Default prompt" defaultValue="Cinematic neon glow" />
        <Field label="Default quality" defaultValue="720p" />
      </section>
    </div>
  );
}

function Field({ label, defaultValue, type = "text" }: { label: string; defaultValue: string; type?: string }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{label}</span>
      <input
        type={type}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
      />
    </label>
  );
}
