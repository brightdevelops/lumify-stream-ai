import { createFileRoute, Link } from "@tanstack/react-router";
import { Coins, Clock, TrendingUp, Wallet, Video, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

type Txn = {
  id: string;
  type: "purchase" | "usage";
  amount: number;
  credits: number;
  description: string | null;
  created_at: string;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Dashboard() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [spent, setSpent] = useState<number>(0);
  const [used, setUsed] = useState<number>(0);
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
      const txList = (t ?? []) as Txn[];
      setTxns(txList);
      setSpent(txList.filter((x) => x.type === "purchase").reduce((s, x) => s + Number(x.amount), 0));
      setUsed(txList.filter((x) => x.type === "usage").reduce((s, x) => s + Math.abs(x.credits), 0));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const streamMin = Math.floor(balance / 2 / 60);
  const stats = [
    { label: "Credits Remaining", value: balance.toLocaleString(), icon: Coins, highlight: true, hint: `≈ ${streamMin} min of streaming` },
    { label: "Total Streamed", value: "0h 00m", icon: Clock, hint: `Across ${txns.filter(t => t.type === "usage").length} sessions` },
    { label: "Credits Used", value: used.toLocaleString(), icon: TrendingUp, hint: "All time" },
    { label: "Total Spent", value: `₦${spent.toLocaleString()}`, icon: Wallet, hint: "Lifetime" },
  ];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back. Here's your streaming overview.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border p-5 ${s.highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.highlight ? "text-primary" : "text-muted-foreground"}`} />
            </div>
            <div className={`mt-3 text-3xl font-display ${s.highlight ? "text-primary" : ""}`}>{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-8">
        <QuickAction to="/stream" icon={Video} title="Start a Stream" desc="Open the studio and transform your camera with a prompt." cta="Open studio" />
        <QuickAction to="/credits" icon={Plus} title="Top Up Credits" desc="Add credits to your balance with Flutterwave." cta="Pay with Flutterwave" />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg">Recent activity</h2>
          <Link to="/billing" className="text-xs text-primary hover:underline">View all</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-6 py-3">Description</th><th className="px-6 py-3">Date</th><th className="px-6 py-3 text-right">Credits</th><th className="px-6 py-3">Status</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">No activity yet. Buy credits to get started.</td></tr>
              ) : txns.slice(0, 5).map((a) => {
                const credits = a.type === "purchase" ? a.credits : -Math.abs(a.credits);
                return (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-6 py-4">{a.description ?? (a.type === "purchase" ? "Credit purchase" : "Stream session")}</td>
                    <td className="px-6 py-4 text-muted-foreground">{fmtDate(a.created_at)}</td>
                    <td className={`px-6 py-4 text-right font-medium ${credits > 0 ? "text-primary" : "text-foreground"}`}>
                      {credits > 0 ? "+" : ""}{credits.toLocaleString()}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={a.type === "purchase" ? "Paid" : "Complete"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, title, desc, cta }: { to: "/stream" | "/credits"; icon: typeof Video; title: string; desc: string; cta: string }) {
  return (
    <Link to={to} className="group rounded-xl border border-border bg-card p-6 hover:border-primary transition-colors">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
          <span className="mt-4 inline-block text-sm text-primary group-hover:underline">{cta} →</span>
        </div>
      </div>
    </Link>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const isGreen = status === "Paid" || status === "Complete";
  const isPending = status === "Pending";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ${
      isGreen ? "bg-primary/10 text-primary" : isPending ? "bg-yellow-500/10 text-yellow-500" : "bg-secondary text-muted-foreground"
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isGreen ? "bg-primary" : isPending ? "bg-yellow-500" : "bg-muted-foreground"}`} />
      {status}
    </span>
  );
}
