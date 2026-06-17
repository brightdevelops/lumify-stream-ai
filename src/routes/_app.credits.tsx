import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Info } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { verifyFlutterwaveAndCredit, getFlutterwavePublicKey, createNowPaymentsInvoice } from "@/lib/payments.functions";

export const Route = createFileRoute("/_app/credits")({
  component: CreditsPage,
});

// ── Maintenance flag ────────────────────────────────────────────────────────
const PURCHASES_PAUSED = false;
const PURCHASES_PAUSED_MESSAGE =
  "Credit purchases are temporarily paused for maintenance. Your existing credits and streaming are unaffected.";
// ────────────────────────────────────────────────────────────────────────────

const PACKS = [
  { id: "starter", name: "Starter", credits: 500, price: 11500 },
  { id: "basic", name: "Basic", credits: 1000, price: 23000 },
  { id: "pro", name: "Pro", credits: 2000, price: 46000 },
  { id: "enterprise", name: "Enterprise", credits: 5000, price: 115000 },
];
const METHODS = ["Card", "Bank Transfer", "USSD", "Mobile Money"];

type FlutterwaveResponse = {
  status: string;
  transaction_id: number | string;
  tx_ref: string;
};

declare global {
  interface Window {
    FlutterwaveCheckout?: (opts: {
      public_key: string;
      tx_ref: string;
      amount: number;
      currency: string;
      payment_options?: string;
      customer: { email: string; name?: string };
      meta?: Record<string, unknown>;
      customizations?: { title?: string; description?: string; logo?: string };
      callback: (response: FlutterwaveResponse) => void;
      onclose: () => void;
    }) => void;
  }
}

function loadFlutterwave(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.FlutterwaveCheckout) return resolve();
    const existing = document.getElementById("flutterwave-inline-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Flutterwave")));
      return;
    }
    const s = document.createElement("script");
    s.id = "flutterwave-inline-js";
    s.src = "https://checkout.flutterwave.com/v3.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Flutterwave"));
    document.body.appendChild(s);
  });
}

function CreditsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState("basic");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cryptoUrl, setCryptoUrl] = useState<string | null>(null);
  const pack = PACKS.find((p) => p.id === selected)!;
  const streamMins = Math.round(pack.credits / 2 / 60);

  const handlePayment = async () => {
    if (PURCHASES_PAUSED) return;
    if (!user?.email) {
      setError("You must be logged in.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      const [{ publicKey }] = await Promise.all([getFlutterwavePublicKey(), loadFlutterwave()]);
      if (!window.FlutterwaveCheckout) throw new Error("Flutterwave not available");

      const txRef = `lumify_${pack.id}_${user.id.slice(0, 8)}_${Date.now()}`;
      let settled = false;

      window.FlutterwaveCheckout({
        public_key: publicKey,
        tx_ref: txRef,
        amount: pack.price,
        currency: "NGN",
        payment_options: "card,banktransfer,ussd,mobilemoneyghana,account",
        customer: { email: user.email, name: user.email },
        meta: { packId: pack.id, userId: user.id },
        customizations: { title: "Lumify Credits", description: `${pack.name} pack` },
        callback: (response) => {
          settled = true;
          void finalizePayment(response.transaction_id, txRef);
        },
        onclose: () => {
          if (!settled) {
            setProcessing(false);
            setError("Payment was cancelled.");
          }
        },
      });
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start payment");
    }
  };

  const finalizePayment = async (transactionId: number | string, txRef: string) => {
    try {
      if (!user) throw new Error("Not authenticated");
      await verifyFlutterwaveAndCredit({
        data: {
          transactionId: String(transactionId),
          txRef,
          packId: pack.id as "starter" | "basic" | "pro" | "enterprise",
        },
      });
      navigate({ to: "/dashboard" });
    } catch (e: any) {
      setProcessing(false);
      setError(
        e?.message ??
          "Payment could not be verified. If you were charged, contact support with your reference.",
      );
    }
  };

  const handleCryptoPayment = async () => {
    if (PURCHASES_PAUSED) return;
    if (!user) {
      setError("You must be logged in.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      const { invoiceUrl } = await createNowPaymentsInvoice({
        data: { packId: pack.id as "starter" | "basic" | "pro" | "enterprise", returnOrigin: window.location.origin },
      });
      // Open in a new tab — NOWPayments blocks iframing, so top-level navigation
      // from inside the Lovable preview iframe appears as "nothing happens".
      const win = window.open(invoiceUrl, "_blank", "noopener,noreferrer");
      if (!win) {
        setError("Your browser blocked the popup. Please allow popups for this site, or click the link below to open the crypto checkout.");
        setCryptoUrl(invoiceUrl);
      }
      setProcessing(false);
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start crypto checkout");
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
          className="mt-6 rounded-xl border border-primary/30 bg-primary/10 px-5 py-4 text-sm leading-relaxed text-foreground whitespace-pre-line"
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
            {PURCHASES_PAUSED ? "Purchases paused for maintenance" : processing ? "Processing…" : "Pay with Flutterwave"}
          </button>
          <button
            onClick={handleCryptoPayment}
            disabled={processing || PURCHASES_PAUSED}
            className="mt-3 w-full rounded-md border border-primary/40 bg-secondary px-4 py-3 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {processing ? "Opening crypto checkout…" : "Pay with Crypto (BTC, ETH, USDT…)"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Crypto payments are confirmed on-chain — credits typically appear within a few minutes after you send.
          </p>

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
