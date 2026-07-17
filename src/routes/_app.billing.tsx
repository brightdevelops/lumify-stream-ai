import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { StatusBadge } from "./_app.dashboard";
import { clearMyBillingHistory } from "@/lib/billing.functions";

export const Route = createFileRoute("/_app/billing")({
  component: BillingPage,
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
  const d = new Date(s);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtNGN(n: number) {
  return "₦" + n.toLocaleString();
}

function describe(t: Txn) {
  if (t.description) return t.description;
  if (t.type === "purchase") return t.package_id ? `Credit purchase — ${t.package_id}` : "Credit purchase";
  if (t.type === "usage") return "Stream session";
  return t.type ?? "Transaction";
}

function BillingPage() {
  const { user, loading: authLoading } = useAuth();

  const { data: txns = [], isLoading, error } = useQuery({
    queryKey: ["billing-transactions", user?.id],
    enabled: !!user && !authLoading,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,type,credits,amount,amount_ngn,description,package_id,reference,created_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Txn[];
    },
  });

  const loading = authLoading || isLoading;
  const err = error ? (error as Error).message : null;

  const stats = useMemo(() => {
    let spent = 0;
    let purchased = 0;
    for (const t of txns) {
      if (t.type === "purchase") {
        spent += Number(t.amount_ngn ?? t.amount ?? 0);
        purchased += t.credits;
      }
    }
    return { spent, purchased, count: txns.length };
  }, [txns]);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <h1 className="text-3xl">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every purchase and stream session, in one place.</p>

      <div className="grid gap-4 sm:grid-cols-3 mt-8">
        <Stat label="Total Spent" value={fmtNGN(stats.spent)} hint="Lifetime" />
        <Stat label="Credits Purchased" value={stats.purchased.toLocaleString()} hint="Lifetime" highlight />
        <Stat label="Transactions" value={stats.count.toLocaleString()} hint="All time" />
      </div>

      <div className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg">Transaction history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Description</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Credits</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : err ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-destructive">{err}</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">No transactions yet.</td></tr>
              ) : txns.map((t) => {
                const signed = t.type === "usage" ? -Math.abs(t.credits) : t.credits;
                const status = t.type === "purchase" ? "Paid" : t.type === "usage" ? "Complete" : "—";
                return (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-6 py-4">{describe(t)}</td>
                    <td className="px-6 py-4 text-muted-foreground">{fmtDate(t.created_at)}</td>
                    <td className={`px-6 py-4 text-right font-medium ${signed > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {signed > 0 ? "+" : ""}{signed ? signed.toLocaleString() : "—"}
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={status} /></td>
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

function Stat({ label, value, hint, highlight }: { label: string; value: string; hint: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-3 text-3xl font-display ${highlight ? "text-primary" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
