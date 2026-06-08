import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Info } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { verifyPaystackAndCredit } from "@/lib/payments.functions";

export const Route = createFileRoute("/_app/credits")({
  component: CreditsPage,
});

const PAYSTACK_PUBLIC_KEY = "pk_live_8aa20c0306707d49e656e1fc5d8c44f27359046e";

// ── Maintenance flag ────────────────────────────────────────────────────────
// Set to false to re-enable credit purchases.
// Existing credits and streaming are unaffected by this flag.
const PURCHASES_PAUSED = false;
const PURCHASES_PAUSED_MESSAGE =
  "Credit purchases are temporarily paused for maintenance and will be back within 24 hours. Your existing credits and streaming are unaffected. Thanks for your patience! — The Lumify Team";
// ────────────────────────────────────────────────────────────────────────────

const PACKS = [
  { id: "starter", name: "Starter", credits: 500, price: 11500, amountKobo: 1_150_000 },
  { id: "basic", name: "Basic", credits: 1000, price: 23000, amountKobo: 2_300_000 },
  { id: "pro", name: "Pro", credits: 2000, price: 46000, amountKobo: 4_600_000 },
  { id: "enterprise", name: "Enterprise", credits: 5000, price: 115000, amountKobo: 11_500_000 },
];
const METHODS = ["Card", "Bank Transfer", "USSD", "Mobile Money"];

type PaystackHandler = {
  openIframe: () => void;
};

declare global {
  interface Window {
    PaystackPop?: {
      setup: (opts: {
        key: string;
        email: string;
        amount: number;
        currency?: string;
        ref?: string;
        metadata?: Record<string, unknown>;
        channels?: string[];
        callback: (response: { reference: string; status?: string }) => void;
        onClose: () => void;
      }) => PaystackHandler;
    };
  }
}

function loadPaystack(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.PaystackPop) return resolve();
    const existing = document.getElementById("paystack-inline-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Paystack")));
      return;
    }
    const s = document.createElement("script");
    s.id = "paystack-inline-js";
    s.src = "https://js.paystack.co/v1/inline.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Paystack"));
    document.body.appendChild(s);
  });
}

function CreditsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState("basic");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = PACKS.find((p) => p.id === selected)!;
  const streamMins = Math.round(pack.credits / 2 / 60);

  const handlePayment = async () => {
    if (!user?.email) {
      setError("You must be logged in.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      await loadPaystack();
      if (!window.PaystackPop) throw new Error("Paystack not available");

      const reference = `lumify_${pack.id}_${user.id.slice(0, 8)}_${Date.now()}`;
      let settled = false;

      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: user.email,
        amount: pack.amountKobo,
        currency: "NGN",
        ref: reference,
        channels: ["card", "bank", "ussd", "mobile_money", "bank_transfer"],
        metadata: { packId: pack.id, userId: user.id },
        callback: (response) => {
          settled = true;
          void finalizePayment(response.reference);
        },
        onClose: () => {
          if (!settled) {
            setProcessing(false);
            setError("Payment was cancelled.");
          }
        },
      });
      handler.openIframe();
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start payment");
    }
  };

  const finalizePayment = async (reference: string) => {
    try {
      if (!user) throw new Error("Not authenticated");
      await verifyPaystackAndCredit({
        data: {
          reference,
          packId: pack.id as "starter" | "basic" | "pro" | "enterprise",
        },
      });
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Payment could not be verified. If you were charged, contact support with your reference.");
    }
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <h1 className="text-3xl">Buy Credits</h1>
      <p className="mt-1 text-sm text-muted-foreground">Add credits to your account. Pay once, stream when you need.</p>

      <div className="mt-6 flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground">
        <Info className="h-4 w-4 text-primary" />
        <span><span className="text-foreground font-medium">2 credits per second (₦46/sec)</span> · 1 credit = ₦23 · Credits never expire</span>
      </div>

      {PURCHASES_PAUSED && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-primary/30 bg-primary/10 px-5 py-4 text-sm leading-relaxed text-foreground"
        >
          {PURCHASES_PAUSED_MESSAGE}
        </div>
      )}

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
          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          <button
            onClick={handlePayment}
            disabled={processing || PURCHASES_PAUSED}
            title={PURCHASES_PAUSED ? "Purchases are temporarily paused for maintenance" : undefined}
            className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {PURCHASES_PAUSED ? "Purchases paused for maintenance" : processing ? "Processing…" : "Pay with Paystack"}
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
