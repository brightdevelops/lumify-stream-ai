import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "./_app.dashboard";
import { clearMyBillingHistory } from "@/lib/billing.functions";

export const Route = createFileRoute("/_app/billing")({
  component: BillingPage,
  head: () => ({
    meta: [
      { title: "Billing — Lumify" },
      { name: "description", content: "Every top-up and every second streamed, in one ledger." },
    ],
  }),
});

type Txn = {
  id: string;
  type: string | null;
  credits: number;
  amount: number | null;
  amount_ngn: number | null;
  description: string | null;
  package_id: string | null;
  reference: string | null;
  created_at: string;
};

function fmtDate(s: string) {
  return new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function fmtNGN(n: number) { return "₦" + n.toLocaleString(); }

function labelType(t: Txn) {
  if (t.type === "purchase") return "Wallet top-up";
  if (t.type === "usage") return "Stream usage";
  return t.type ?? "Transaction";
}

function describe(t: Txn) {
  return t.reference ?? t.description ?? (t.package_id ? `${t.package_id}` : "—");
}

function BillingPage() {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const clearFn = useServerFn(clearMyBillingHistory);
  const [clearing, setClearing] = useState(false);
  const [clearErr, setClearErr] = useState<string | null>(null);

  const { data: txns = [], isLoading, error } = useQuery({
    queryKey: ["billing-transactions", user?.id],
    enabled: !!user && !authLoading,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,type,credits,amount,amount_ngn,description,package_id,reference,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });

  const loading = authLoading || isLoading;
  const err = error ? (error as Error).message : null;

  const stats = useMemo(() => {
    let spent = 0, purchased = 0;
    for (const t of txns) {
      if (t.type === "purchase") {
        spent += Number(t.amount_ngn ?? t.amount ?? 0);
        purchased += t.credits;
      }
    }
    return { spent, purchased, count: txns.length };
  }, [txns]);

  async function handleClear() {
    if (!user) return;
    if (!window.confirm("Permanently delete your entire billing history? This cannot be undone.")) return;
    setClearing(true); setClearErr(null);
    try {
      await clearFn();
      await qc.invalidateQueries({ queryKey: ["billing-transactions", user.id] });
    } catch (e) {
      setClearErr((e as Error).message);
    } finally {
      setClearing(false);
    }
  }

  function exportCsv() {
    const rows = [
      ["Date", "Type", "Reference", "Credits", "Amount (NGN)"],
      ...txns.map((t) => {
        const credits = t.type === "usage" ? -Math.abs(t.credits) : t.credits;
        return [
          fmtDate(t.created_at),
          labelType(t),
          describe(t),
          String(credits),
          String(Number(t.amount_ngn ?? t.amount ?? 0)),
        ];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumify-billing-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[38px] leading-tight">Billing</h1>
          <p className="mt-1 text-[14px] text-[color:var(--muted-foreground)]">Every top-up and every second streamed, in one ledger.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} disabled={txns.length === 0} className="btn-ghost text-[13px] px-3.5 py-2 disabled:opacity-50">
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <Stat label="Total spent" value={fmtNGN(stats.spent)} hint="Lifetime" />
        <Stat label="Credits purchased" value={stats.purchased.toLocaleString()} hint="Lifetime" accent />
        <Stat label="Transactions" value={stats.count.toLocaleString()} hint="All time" />
      </div>

      <div className="card-surface p-0 overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="eyebrow">Ledger</h2>
            {clearErr && <p className="text-[12px] text-[color:var(--destructive)] mt-1">{clearErr}</p>}
          </div>
          <button
            onClick={handleClear}
            disabled={clearing || txns.length === 0}
            className="rounded-lg border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {clearing ? "Clearing…" : "Clear history"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Reference</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-[color:var(--faint)]">Loading…</td></tr>
              ) : err ? (
                <tr><td colSpan={6} className="text-center py-10 text-[color:var(--destructive)]">{err}</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-[color:var(--faint)]">No transactions yet.</td></tr>
              ) : txns.map((t) => {
                const signed = t.type === "usage" ? -Math.abs(t.credits) : t.credits;
                const status = t.type === "purchase" ? "Success" : t.type === "usage" ? "Complete" : "—";
                const amount = Number(t.amount_ngn ?? t.amount ?? 0);
                return (
                  <tr key={t.id}>
                    <td>{fmtDate(t.created_at)}</td>
                    <td>{labelType(t)}</td>
                    <td className="font-mono text-[12px] truncate max-w-[220px]">{describe(t)}</td>
                    <td className={`text-right ${signed > 0 ? "text-primary" : "text-foreground"}`}>
                      {signed > 0 ? "+" : ""}{signed.toLocaleString()}
                    </td>
                    <td className="text-right">{amount ? fmtNGN(amount) : "—"}</td>
                    <td>{status === "—" ? "—" : <StatusBadge status={status} />}</td>
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

function Stat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={accent ? "accent-card rounded-2xl p-5" : "card-surface"}>
      <div className="eyebrow">{label}</div>
      <div className="mt-3 font-display text-[28px] leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[12px] text-[color:var(--faint)]">{hint}</div>
    </div>
  );
}
