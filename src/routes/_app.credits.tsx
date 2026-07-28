import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Wallet as WalletIcon, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  createFlutterwaveCheckout,
  verifyFlutterwaveAndCredit,
} from "@/lib/payments.functions";
import { useMaintenanceMode, MAINTENANCE_PURCHASE_MESSAGE } from "@/hooks/use-maintenance-mode";
import { StatusBadge } from "./_app.dashboard";

export const Route = createFileRoute("/_app/credits")({
  component: WalletPage,
  head: () => ({
    meta: [
      { title: "Wallet — Lumify" },
      { name: "description", content: "Top up your Lumify balance with Flutterwave. Card, bank transfer, mobile money." },
    ],
  }),
});

const PURCHASES_PAUSED = false;
const PURCHASES_PAUSED_MESSAGE =
  "Credit purchases are temporarily paused for maintenance. Your existing credits and streaming are unaffected.";

const RATE = 2;

const PACKS = [
  { id: "starter", name: "Starter",  credits: 500,  price: 11500 },
  { id: "basic",   name: "Basic",    credits: 1000, price: 23000, save: 0 },
  { id: "pro",     name: "Pro",      credits: 2000, price: 46000, save: 0 },
  { id: "enterprise", name: "Enterprise", credits: 5000, price: 115000 },
];

type Txn = {
  id: string;
  type: string | null;
  credits: number;
  amount: number | null;
  amount_ngn: number | null;
  description: string | null;
  reference: string | null;
  created_at: string;
};

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}m`;
}

function WalletPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { enabled: maintenanceOn } = useMaintenanceMode();
  const paused = PURCHASES_PAUSED || maintenanceOn;
  const pausedMsg = maintenanceOn ? MAINTENANCE_PURCHASE_MESSAGE : PURCHASES_PAUSED_MESSAGE;

  const [selected, setSelected] = useState("basic");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = PACKS.find((p) => p.id === selected)!;

  const { data: balance = 0 } = useQuery({
    queryKey: ["wallet-balance", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("credits").select("balance").eq("user_id", user!.id).maybeSingle();
      return data?.balance ?? 0;
    },
  });

  const { data: txns = [] } = useQuery({
    queryKey: ["wallet-txns", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id,type,credits,amount,amount_ngn,description,reference,created_at")
        .eq("user_id", user!.id)
        .eq("type", "purchase")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as Txn[];
    },
  });

  const totalToppedUp = txns.reduce((s, t) => s + Number(t.amount_ngn ?? t.amount ?? 0), 0);
  const totalCreditsPurchased = txns.reduce((s, t) => s + Number(t.credits ?? 0), 0);
  const secondsLeft = Math.floor(balance / RATE);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("korapay") === "1") {
      const reference = params.get("reference");
      const status = params.get("status");
      window.history.replaceState({}, "", "/credits");
      if (!reference) {
        if (status && status !== "success" && status !== "successful") setError("Payment was cancelled or did not complete.");
        return;
      }
      setProcessing(true);
      (async () => {
        try {
          await verifyKorapayAndCredit({ data: { reference } });
          navigate({ to: "/dashboard" });
        } catch (e: any) {
          setProcessing(false);
          setError(e?.message ?? "Payment could not be verified. If you were charged, contact support with your reference.");
        }
      })();
    }
  }, [user, navigate]);

  const handlePayment = async () => {
    if (paused || !user?.email) return;
    setError(null);
    setProcessing(true);
    try {
      const packId = pack.id as "starter" | "basic" | "pro" | "enterprise";
      const { checkoutUrl } = await createKorapayCheckout({ data: { packId } });
      window.location.href = checkoutUrl;
    } catch (e: any) {
      setProcessing(false);
      setError(e?.message ?? "Could not start payment");
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-[38px] leading-tight">Wallet</h1>
        <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)] flex items-center gap-2">
          Top up your balance — payments secured by <span className="text-foreground font-semibold">Korapay</span>.
          <ShieldCheck size={14} className="text-primary" />
        </p>
      </div>

      {paused && (
        <div className="mb-6 rounded-2xl border border-[color:var(--primary)] bg-[color:var(--accent-soft)] px-5 py-4 text-[14px] text-foreground whitespace-pre-line">
          {pausedMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <div className="accent-card rounded-2xl p-5">
          <div className="eyebrow">Current balance</div>
          <div className="mt-3 font-display text-[34px] leading-none">{balance.toLocaleString()}</div>
          <div className="mt-1 text-[12px] text-[color:var(--muted-foreground)]">≈ {fmtTime(secondsLeft)} of streaming</div>
        </div>
        <StatCard label="Total topped up" value={`₦${totalToppedUp.toLocaleString()}`} hint="Lifetime" />
        <StatCard label="Credits purchased" value={totalCreditsPurchased.toLocaleString()} hint="Lifetime" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Packs */}
        <div className="card-surface">
          <div className="eyebrow mb-5">Choose a pack</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {PACKS.map((p) => {
              const active = selected === p.id;
              const mins = Math.round(p.credits / 2 / 60);
              return (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`text-left rounded-xl border p-5 transition-colors relative ${
                    active ? "border-[color:var(--primary)]" : "border-[color:var(--border)] hover:border-[color:var(--primary)]/60"
                  }`}
                  style={active ? { background: "var(--accent-soft)" } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">{p.name}</span>
                    {active && <Check size={16} className="text-primary" />}
                  </div>
                  <div className="mt-2 font-display text-[28px] leading-none text-foreground">
                    {p.credits.toLocaleString()} <span className="text-[13px] text-[color:var(--muted-foreground)]">cr</span>
                  </div>
                  <div className="mt-2 text-[15px] text-foreground">₦{p.price.toLocaleString()}</div>
                  <div className="text-[12px] text-[color:var(--faint)]">≈ {mins} min stream</div>
                </button>
              );
            })}
          </div>

          {error && <p className="mt-4 text-[13px] text-[color:var(--destructive)]">{error}</p>}

          <button
            onClick={handlePayment}
            disabled={processing || paused}
            className="btn-primary w-full mt-6"
          >
            <WalletIcon size={15} />
            {paused ? "Paused" : processing ? "Processing…" : `Pay ₦${pack.price.toLocaleString()} with Korapay`}
          </button>
          <p className="mt-3 text-center text-[12px] text-[color:var(--faint)]">
            Card · Bank transfer · Mobile money
          </p>
        </div>

        {/* Recent top-ups */}
        <div className="card-surface p-0 overflow-hidden">
          <div className="px-5 py-4 border-b">
            <div className="eyebrow">Recent top-ups</div>
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            {txns.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-[color:var(--faint)]">No top-ups yet.</div>
            ) : (
              <ul className="divide-y divide-[color:var(--border-soft)]">
                {txns.map((t) => (
                  <li key={t.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-foreground truncate">
                        {t.credits.toLocaleString()} credits
                      </div>
                      <div className="text-[11.5px] text-[color:var(--faint)] truncate">
                        {new Date(t.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13.5px] text-foreground">₦{Number(t.amount_ngn ?? t.amount ?? 0).toLocaleString()}</div>
                      <div className="mt-1"><StatusBadge status="Success" /></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card-surface">
      <div className="eyebrow">{label}</div>
      <div className="mt-3 font-display text-[28px] leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[12px] text-[color:var(--faint)]">{hint}</div>
    </div>
  );
}
