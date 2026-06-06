import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  inventorFinanceStats, inventorVisitStats,
  type InventorFinance, type InventorVisitStats,
} from "@/lib/inventor.functions";
import { NGN, NUM, pkgName } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/finance")({
  component: FinancePage,
});

function FinancePage() {
  const finFn = useServerFn(inventorFinanceStats);
  const visFn = useServerFn(inventorVisitStats);
  const [fin, setFin] = useState<InventorFinance | null>(null);
  const [vis, setVis] = useState<InventorVisitStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    finFn().then((r) => setFin(r.finance)).catch((e) => setErr(String(e?.message ?? e)));
  }, [finFn]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => visFn().then((r) => !cancelled && setVis(r.stats)).catch(() => {});
    tick();
    const id = setInterval(tick, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [visFn]);

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!fin) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const totalSold = fin.credits_sold || 1;
  const burnPct = Math.min(100, Math.round((fin.credits_streamed / totalSold) * 100));
  const avgPurchase = fin.total_transactions > 0 ? Math.round(fin.revenue_all_time / fin.total_transactions) : 0;
  const maxDaily = Math.max(1, ...fin.daily_revenue.map((d) => d.revenue_ngn));
  const totalPkgRevenue = fin.by_package.reduce((s, r) => s + r.total_revenue_ngn, 0) || 1;

  return (
    <div className="space-y-6">
      {/* Today / Month snapshot + visitors */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Revenue today" value={NGN(fin.revenue_today)} />
        <Stat label="Revenue this month" value={NGN(fin.revenue_this_month)} />
        <Stat label="Active now" value={NUM(vis?.active_now ?? 0)} accent />
        <Stat label="Visitors today" value={NUM(vis?.visitors_today ?? 0)} />
        <Stat label="Visitors this month" value={NUM(vis?.visitors_this_month ?? 0)} />
      </div>

      {/* Revenue KPIs */}
      <div>
        <h2 className="mb-2 text-sm font-medium">Revenue</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="All-time" value={NGN(fin.revenue_all_time)} />
          <Stat label="Month" value={NGN(fin.revenue_this_month)} />
          <Stat label="Week" value={NGN(fin.revenue_this_week)} />
          <Stat label="Today" value={NGN(fin.revenue_today)} />
        </div>
      </div>

      {/* Financial health */}
      <div>
        <h2 className="mb-2 text-sm font-medium">Financial health</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Recognized revenue" value={NGN(fin.recognized_revenue_ngn)} sub="Credits already streamed × ₦23" />
          <Stat label="Deferred revenue" value={NGN(fin.deferred_revenue_ngn)} sub="Credits in wallets × ₦23" />
          <Stat label="ARPU" value={NGN(fin.arpu_ngn)} sub={`${NUM(fin.paying_users)} paying users`} />
        </div>
      </div>

      {/* Credit flow */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Credit flow</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Sold</div><div className="text-lg tabular-nums">{NUM(fin.credits_sold)}</div></div>
          <div><div className="text-xs text-muted-foreground">Streamed</div><div className="text-lg tabular-nums">{NUM(fin.credits_streamed)}</div></div>
          <div><div className="text-xs text-muted-foreground">In wallets</div><div className="text-lg tabular-nums">{NUM(fin.credits_in_wallets)}</div></div>
          <div><div className="text-xs text-muted-foreground">Avg purchase</div><div className="text-lg tabular-nums">{NGN(avgPurchase)}</div></div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Burn rate</span><span>{burnPct}%</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${burnPct}%` }} />
          </div>
        </div>
      </div>

      {/* 30-day chart */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Daily revenue (30 days)</h2>
        <div className="mt-4 flex items-end gap-1 h-40">
          {fin.daily_revenue.length === 0 && <p className="text-xs text-muted-foreground">No data.</p>}
          {fin.daily_revenue.map((d) => {
            const h = Math.max(2, Math.round((d.revenue_ngn / maxDaily) * 100));
            return (
              <div key={d.day} className="group flex-1 flex flex-col items-center gap-1" title={`${d.day} • ${NGN(d.revenue_ngn)}`}>
                <div className="w-full rounded-sm bg-primary/60 group-hover:bg-primary transition" style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* By package */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-medium">Revenue by package</h2></div>
        <div className="divide-y divide-border/60">
          {fin.by_package.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No purchases yet.</p>}
          {fin.by_package.map((r) => {
            const pct = Math.round((r.total_revenue_ngn / totalPkgRevenue) * 100);
            return (
              <div key={r.package_id ?? "unknown"} className="px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{pkgName(r.package_id)}</span>
                  <span className="tabular-nums text-muted-foreground">{NGN(r.total_revenue_ngn)} <span className="ml-2 text-xs">({pct}%)</span></span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{NUM(r.purchase_count)} purchases · {NUM(r.credits_sold)} credits</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={"rounded-lg border bg-card p-4 " + (accent ? "border-primary/40" : "border-border")}>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
