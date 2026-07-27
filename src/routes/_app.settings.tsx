import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { getMyStreamToken, regenerateMyStreamToken } from "@/lib/stream-token.functions";
import { useAuth } from "@/hooks/use-auth";

const OUTPUT_ORIGIN = "https://lumifylive.com";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
  head: () => ({
    meta: [
      { title: "Settings — Lumify" },
      { name: "description", content: "Manage your profile, streaming defaults and OBS access." },
    ],
  }),
});

function SettingsPage() {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const email = user?.email ?? "";
  const displayName = (user?.user_metadata?.full_name as string | undefined) ?? email.split("@")[0] ?? "";

  const [defaults, setDefaults] = useState({
    startRealistic: true,
    lowBalanceWarning: true,
    autoStopAtZero: true,
  });

  const obsUrl = token ? `${OUTPUT_ORIGIN}/output?token=${token}` : "";

  useEffect(() => {
    getMyStreamToken().then(({ token }) => token && setToken(token)).catch(() => {});
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
    } finally { setRegenerating(false); }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[38px] leading-tight">Settings</h1>
        <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)]">Manage your profile, streaming defaults and OBS access.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          <section className="card-surface">
            <div className="eyebrow mb-5">Profile</div>
            <Field label="Display name" defaultValue={displayName} />
            <Field label="Email" value={email} type="email" readOnly />
            <button className="btn-primary mt-2">Save changes</button>
          </section>

          <section className="card-surface">
            <div className="eyebrow mb-5">Streaming defaults</div>
            <div className="space-y-4">
              <ToggleRow
                on={defaults.startRealistic}
                onChange={(v) => setDefaults((d) => ({ ...d, startRealistic: v }))}
                title="Start in Realistic Mode"
                desc="Open the studio with Realistic Mode preselected."
              />
              <ToggleRow
                on={defaults.lowBalanceWarning}
                onChange={(v) => setDefaults((d) => ({ ...d, lowBalanceWarning: v }))}
                title="Low-balance warning"
                desc="Alert me when I have less than 10 minutes of stream time left."
              />
              <ToggleRow
                on={defaults.autoStopAtZero}
                onChange={(v) => setDefaults((d) => ({ ...d, autoStopAtZero: v }))}
                title="Auto-stop at zero"
                desc="Automatically end the session when the balance hits zero."
              />
            </div>
          </section>
        </div>

        {/* Right column */}
        <section className="card-surface h-fit">
          <div className="eyebrow mb-3">OBS Access</div>
          <p className="text-[13.5px] text-[color:var(--muted-foreground)]">
            Paste this URL into an OBS Browser Source to receive your AI output. It's permanent and private to you.
          </p>

          <div className="mt-4 flex items-center gap-2 rounded-lg border bg-[color:var(--sidebar)] p-2">
            <code className="flex-1 truncate text-[12px] font-mono text-[color:var(--muted-foreground)]">
              {obsUrl || "Loading…"}
            </code>
            <button
              onClick={copyUrl}
              disabled={!obsUrl}
              className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1.5 text-[12px] font-semibold text-primary hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-[color:var(--faint)]">
            This URL is private and permanent. Regenerate it below to revoke OBS access.
          </p>

          <div className="mt-6 pt-5 border-t border-[color:var(--border-soft)]">
            {!confirm ? (
              <button
                onClick={() => setConfirm(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--destructive)]/50 bg-transparent px-4 py-2.5 text-[13px] font-semibold text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10"
              >
                <RefreshCw size={14} /> Regenerate URL
              </button>
            ) : (
              <div className="rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 p-3.5 text-[13px]">
                <p className="text-foreground">
                  This will invalidate your current OBS URL. You'll need to paste the new URL into OBS.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={regenerate}
                    disabled={regenerating}
                    className="rounded-md bg-[color:var(--destructive)] px-3 py-1.5 text-[12px] font-semibold text-[color:var(--foreground)] disabled:opacity-50"
                  >
                    {regenerating ? "Regenerating…" : "Yes, regenerate"}
                  </button>
                  <button
                    onClick={() => setConfirm(false)}
                    disabled={regenerating}
                    className="rounded-md border px-3 py-1.5 text-[12px] text-[color:var(--muted-foreground)] hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({ label, defaultValue, value, type = "text", readOnly }: { label: string; defaultValue?: string; value?: string; type?: string; readOnly?: boolean }) {
  return (
    <label className="block mb-4">
      <span className="eyebrow block mb-2">{label}</span>
      <input
        type={type}
        {...(value !== undefined ? { value, readOnly: true } : { defaultValue, readOnly })}
        className="w-full rounded-lg border bg-[color:var(--sidebar)] px-3.5 py-2.5 text-[14px] outline-none focus:border-[color:var(--primary)] read-only:opacity-70"
      />
    </label>
  );
}

function ToggleRow({ on, onChange, title, desc }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[14px] text-foreground">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-[color:var(--muted-foreground)]">{desc}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        data-on={on}
        className="toggle-switch"
      />
    </div>
  );
}
