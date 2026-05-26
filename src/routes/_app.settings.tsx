import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
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
