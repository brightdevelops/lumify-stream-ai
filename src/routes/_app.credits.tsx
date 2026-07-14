import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Info } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { createCryptomusInvoice, reportPaymentIssue, createFlutterwaveCheckout, verifyFlutterwaveAndCredit } from "@/lib/payments.functions";
import { useMaintenanceMode, MAINTENANCE_PURCHASE_MESSAGE } from "@/hooks/use-maintenance-mode";

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

function CreditsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { enabled: maintenanceOn } = useMaintenanceMode();
  const purchasesPaused = PURCHASES_PAUSED || maintenanceOn;
  const purchasesPausedMessage = maintenanceOn ? MAINTENANCE_PURCHASE_MESSAGE : PURCHASES_PAUSED_MESSAGE;
  const [selected, setSelected] = useState("basic");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cryptoUrl, setCryptoUrl] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueMethod, setIssueMethod] = useState<"crypto" | "card" | "other">("crypto");
  const [issueRef, setIssueRef] = useState("");
  const [issueMsg, setIssueMsg] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueSent, setIssueSent] = useState(false);
  const pack = PACKS.find((p) => p.id === selected)!;
  const streamMins = Math.round(pack.credits / 2 / 60);

  // Handle Flutterwave redirect callback: /credits?flutterwave=1&status=&tx_ref=&transaction_id=
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("flutterwave") !== "1") return;
    const txRef = params.get("tx_ref");
    const transactionId = params.get("transaction_id");
    const status = params.get("status");
    if (!user) return;
    // Strip query early so a refresh doesn't retrigger verification.
    window.history.replaceState({}, "", "/credits");
    if (status === "cancelled" || !txRef || !transactionId) {
      if (status && status !== "successful" && status !== "completed") {
        setError("Payment was cancelled or did not complete.");
      }
      return;
    }
    setProcessing(true);
    (async () => {
      try {
        await verifyFlutterwaveAndCredit({ data: { txRef, transactionId } });
        navigate({ to: "/dashboard" });
      } catch (e: any) {
        setProcessing(false);
        setError(e?.message ?? "Payment could not be verified. If you were charged, contact support with your reference.");
      }
    })();
  }, [user, navigate]);


  const submitIssue = async () => {
    if (issueMsg.trim().length < 5) { setError("Please describe the issue (min 5 chars)."); return; }
    setIssueSubmitting(true);
    setError(null);
    try {
      await reportPaymentIssue({
        data: {
          method: issueMethod,
          message: issueMsg.trim(),
          orderReference: issueRef.trim() || null,
          packId: pack.id as "starter" | "basic" | "pro" | "enterprise",
        },
      });
      setIssueSent(true);
      setIssueMsg(""); setIssueRef("");
      setTimeout(() => { setIssueOpen(false); setIssueSent(false); }, 2500);
    } catch (e: any) {
      setError(e?.message ?? "Could not send report");
    } finally {
      setIssueSubmitting(false);
    }
  };

  const handlePayment = async () => {
    if (PURCHASES_PAUSED) return;
    if (!user?.email) {
      setError("You must be logged in.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      const { checkoutUrl } = await createFlutterwaveCheckout({
        data: { packId: pack.id as "starter" | "basic" | "pro" | "enterprise" },
      });
      window.location.href = checkoutUrl;
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start payment");
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
      const { invoiceUrl } = await createCryptomusInvoice({
        data: { packId: pack.id as "starter" | "basic" | "pro" | "enterprise", returnOrigin: window.location.origin },
      });
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

  const handleStripePayment = async () => {
    if (PURCHASES_PAUSED) return;
    if (!user) {
      setError("You must be logged in.");
      return;
    }
    setError(null);
    setProcessing(true);
    try {
      const { checkoutUrl } = await createStripeCheckout({
        data: { packId: pack.id as "starter" | "basic" | "pro" | "enterprise" },
      });
      window.location.href = checkoutUrl;
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start card checkout");
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
            <Row k="Stripe fee (card only)" v={<span className="text-muted-foreground">+$1</span>} />
            <div className="h-px bg-border my-3" />
            <Row k={<span className="text-foreground">Total</span>} v={<span className="text-foreground font-display text-xl">₦{pack.price.toLocaleString()}</span>} />
            <p className="text-xs text-muted-foreground">Paying with Stripe? A flat +$1 processing fee is added at checkout.</p>
          </div>

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          {cryptoUrl && (
            <a
              href={cryptoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-primary underline"
            >
              Open crypto checkout →
            </a>
          )}
          <button
            onClick={handlePayment}
            disabled={processing || PURCHASES_PAUSED}
            title={PURCHASES_PAUSED ? "Purchases are temporarily paused for maintenance" : undefined}
            className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {PURCHASES_PAUSED ? "Purchases paused for maintenance" : processing ? "Processing…" : "Pay with Flutterwave (NGN)"}
          </button>
          <button
            onClick={handleStripePayment}
            disabled={processing || PURCHASES_PAUSED}
            title={PURCHASES_PAUSED ? "Purchases are temporarily paused for maintenance" : undefined}
            className="mt-3 w-full rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {processing ? "Processing…" : "Pay with Card (Stripe)"}
          </button>
          {user?.email?.toLowerCase() === "brightsolutionslab@gmail.com" && (
            <button
              onClick={handleCryptoPayment}
              disabled={processing || PURCHASES_PAUSED}
              title={PURCHASES_PAUSED ? "Purchases are temporarily paused for maintenance" : undefined}
              className="mt-3 w-full rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {processing ? "Processing…" : "Pay with Crypto (Cryptomus)"}
            </button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {user?.email?.toLowerCase() === "brightsolutionslab@gmail.com"
              ? "Card, bank, USSD & transfer payments via Flutterwave. Card payments in NGN via Stripe (+$1 processing fee). Crypto payments (BTC, ETH, USDT and more) via Cryptomus."
              : "Card, bank, USSD & transfer payments via Flutterwave. Card payments in NGN via Stripe (+$1 processing fee)."}
          </p>



          <div className="mt-4 flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <span key={m} className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">{m}</span>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-border">
            {!issueOpen ? (
              <button
                onClick={() => { setIssueOpen(true); setIssueSent(false); }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Having trouble with a payment? Report an issue
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Report a payment issue</h4>
                  <button onClick={() => setIssueOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">close</button>
                </div>
                {issueSent ? (
                  <p className="text-sm text-emerald-500">Thanks — we received your report. The team will reach out shortly.</p>
                ) : (
                  <>
                    <div className="flex gap-1 text-xs">
                      {(["crypto", "card", "other"] as const).map((m) => (
                        <button key={m} onClick={() => setIssueMethod(m)}
                          className={`px-3 py-1 rounded-md border capitalize ${issueMethod === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                    <input
                      value={issueRef}
                      onChange={(e) => setIssueRef(e.target.value)}
                      placeholder="Transaction reference / order ID (if any)"
                      className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
                    />
                    <textarea
                      value={issueMsg}
                      onChange={(e) => setIssueMsg(e.target.value)}
                      placeholder="Describe what went wrong (e.g. paid in BTC but credits never arrived, transaction stuck pending…)"
                      rows={3}
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <button
                      onClick={submitIssue}
                      disabled={issueSubmitting}
                      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {issueSubmitting ? "Sending…" : "Send report"}
                    </button>
                  </>
                )}
              </div>
            )}
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
