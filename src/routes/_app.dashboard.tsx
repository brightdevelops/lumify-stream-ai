import { createFileRoute, Link } from "@tanstack/react-router";
import { Play, Wallet, Video, AlertTriangle, Receipt, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Dashboard — Lumify" },
      { name: "description", content: "Your streaming overview, balance and recent sessions." },
    ],
  }),
});

type Txn = {
  id: string;
  type: "purchase" | "usage" | string;
  amount: number | null;
  credits: number;
  description: string | null;
  created_at: string;
};

const RATE = 2;
const NAIRA_PER_CREDIT = 23;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${m}m`;
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Dashboard() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: c }, { data: t }] = await Promise.all([
        supabase.from("credits").select("balance").eq("user_id", user.id).maybeSingle(),
        supabase.from("transactions").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setBalance(c?.balance ?? 0);
      setTxns((t ?? []) as Txn[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const usageTxns = txns.filter((x) => x.type === "usage");
  const totalCreditsUsed = usageTxns.reduce((s, x) => s + Math.abs(x.credits), 0);
  const totalSecsStreamed = totalCreditsUsed / RATE;
  const avgSecs = usageTxns.length ? Math.round(totalSecsStreamed / usageTxns.length) : 0;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const weekSecs = usageTxns
    .filter((t) => new Date(t.created_at).getTime() > weekAgo)
    .reduce((s, x) => s + Math.abs(x.credits) / RATE, 0);

  const secondsLeft = Math.floor(balance / RATE);
  const minsLeft = Math.floor(secondsLeft / 60);
  const lowBalance = minsLeft < 10 && balance > 0;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[38px] leading-tight">{greet()} <span aria-hidden>👋</span></h1>
          <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)]">Here's how your streams are doing.</p>
        </div>
        <Link to="/stream" className="btn-primary self-start sm:self-auto"><Play size={15} /> Go live</Link>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <div className="accent-card rounded-2xl p-5">
          <div className="eyebrow">Balance</div>
          <div className="mt-3 font-display text-[34px] leading-none text-foreground">{balance.toLocaleString()}</div>
          <div className="mt-1 text-[12px] text-[color:var(--muted-foreground)]">credits · ≈ {fmtTime(secondsLeft)} left</div>
        </div>
        <StatCard label="Streamed this week" value={fmtTime(weekSecs)} hint="Last 7 days" />
        <StatCard label="Credits used" value={totalCreditsUsed.toLocaleString()} hint="All time" />
        <StatCard label="Avg session" value={avgSecs ? fmtTime(avgSecs) : "—"} hint={`${usageTxns.length} sessions`} />
      </div>

      {/* Split */}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Recent sessions */}
        <div className="card-surface p-0 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="eyebrow">Recent sessions</h2>
            <Link to="/billing" className="text-[12px] text-primary hover:underline">View all</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="text-right">Credits</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="text-center py-10 text-[color:var(--faint)]">Loading…</td></tr>
                ) : txns.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-10 text-[color:var(--faint)]">No activity yet. Top up to get started.</td></tr>
                ) : txns.slice(0, 8).map((t) => {
                  const signed = t.type === "usage" ? -Math.abs(t.credits) : t.credits;
                  const amount = Number(t.amount ?? 0);
                  return (
                    <tr key={t.id}>
                      <td>{fmtDate(t.created_at)}</td>
                      <td>{t.description ?? (t.type === "purchase" ? "Wallet top-up" : "Stream usage")}</td>
                      <td className={`text-right ${signed > 0 ? "text-primary" : "text-foreground"}`}>
                        {signed > 0 ? "+" : ""}{signed.toLocaleString()}
                      </td>
                      <td className="text-right">{amount ? `₦${amount.toLocaleString()}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {lowBalance && (
            <div className="accent-card rounded-2xl p-5" style={{ boxShadow: "0 12px 40px -20px var(--accent-glow)" }}>
              <div className="flex items-center gap-2 text-[color:var(--warning)]">
                <AlertTriangle size={16} /> <span className="eyebrow" style={{ color: "var(--warning)" }}>Low balance</span>
              </div>
              <p className="mt-3 text-[14px] text-foreground">
                You have less than 10 minutes of stream time left. Top up to avoid an interruption mid-stream.
              </p>
              <Link to="/credits" className="btn-primary mt-4 w-full"><Wallet size={15} /> Buy credits</Link>
            </div>
          )}

          <div className="card-surface">
            <div className="eyebrow mb-4">Quick actions</div>
            <div className="space-y-2">
              <QuickLink to="/stream" icon={Video} label="Start a stream" />
              <QuickLink to="/settings" icon={Monitor} label="OBS setup" />
              <QuickLink to="/billing" icon={Receipt} label="View billing" />
            </div>
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
      <div className="mt-3 font-display text-[34px] leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[12px] text-[color:var(--faint)]">{hint}</div>
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-[color:var(--muted-foreground)] hover:text-foreground hover:bg-[color:var(--sidebar)] transition-colors"
    >
      <Icon size={16} className="text-primary" /> {label}
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "paid" || s === "complete" || s === "success" ? "badge-success" :
    s === "pending" ? "badge-pending" :
    s === "failed" ? "badge-failed" :
    "badge-pending";
  return <span className={`badge ${cls}`}>{status}</span>;
}

// keep for imports elsewhere
export { NAIRA_PER_CREDIT };
