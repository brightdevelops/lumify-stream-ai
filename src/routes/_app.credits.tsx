import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Info } from "lucide-react";

export const Route = createFileRoute("/_app/credits")({
  component: CreditsPage,
});

const PACKS = [
  { id: "starter", name: "Starter", credits: 500, price: 11500 },
  { id: "basic", name: "Basic", credits: 1000, price: 23000 },
  { id: "pro", name: "Pro", credits: 2000, price: 46000 },
  { id: "enterprise", name: "Enterprise", credits: 5000, price: 115000 },
];
const METHODS = ["Bank Transfer", "Card", "USSD", "Opay"];

function CreditsPage() {
  const [selected, setSelected] = useState("basic");
  const pack = PACKS.find((p) => p.id === selected)!;
  const streamMins = Math.round(pack.credits / 2 / 60);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <h1 className="text-3xl">Buy Credits</h1>
      <p className="mt-1 text-sm text-muted-foreground">Add credits to your account. Pay once, stream when you need.</p>

      <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 text-primary" />
        <span><span className="text-foreground font-medium">2 credits per second</span> · 1 credit = ₦23 · Credits never expire</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-6">
        {PACKS.map((p) => {
          const active = selected === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`text-left rounded-xl border p-5 transition-colors ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{p.name}</span>
                {active && <Check className="h-4 w-4 text-primary" />}
              </div>
              <div className="mt-3 text-3xl font-display text-primary">{p.credits.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">credits</div>
              <div className="mt-3 text-xl">₦{p.price.toLocaleString()}</div>
              <div className="mt-1 text-xs text-muted-foreground">≈ {Math.round(p.credits / 2 / 60)} min stream</div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 mt-8 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-lg">Payment summary</h2>
          <div className="mt-5 space-y-3 text-sm">
            <Row k="Package" v={pack.name} />
            <Row k="Credits" v={<span className="text-primary font-medium">{pack.credits.toLocaleString()}</span>} />
            <Row k="Stream time" v={`≈ ${streamMins} minutes`} />
            <div className="h-px bg-border my-3" />
            <Row k={<span className="text-foreground">Total</span>} v={<span className="text-foreground font-display text-xl">₦{pack.price.toLocaleString()}</span>} />
          </div>
          <button className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90">
            Pay with Paystack
          </button>
          <div className="mt-4 flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <span key={m} className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">{m}</span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">What you get</h3>
          <ul className="mt-4 space-y-3 text-sm">
            {["Credits never expire", "Switch styles mid-stream", "720p output", "Pause anytime"].map((x) => (
              <li key={x} className="flex gap-2 text-muted-foreground"><Check className="h-4 w-4 text-primary mt-0.5" /> {x}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
