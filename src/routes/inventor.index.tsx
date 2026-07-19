import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Users, CreditCard, Wallet, TrendingUp, Coins, Activity, Cpu } from "lucide-react";
import { inventorGetMetrics, type InventorMetrics } from "@/lib/inventor.functions";
import { getLucyModel, setLucyModel } from "@/lib/site-settings.functions";
import { NGN, NUM, pkgName, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/")({
  component: OverviewPage,
});

function OverviewPage() {
  const fn = useServerFn(inventorGetMetrics);
  const getLucy = useServerFn(getLucyModel);
  const setLucy = useServerFn(setLucyModel);
  const [m, setM] = useState<InventorMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [use25, setUse25] = useState<boolean | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  useEffect(() => {
    fn().then((r) => setM(r.metrics)).catch((e) => setErr(String(e?.message ?? e)));
    getLucy().then((r) => setUse25(r.use25)).catch(() => {});
  }, [fn, getLucy]);

  const toggleModel = async () => {
    if (use25 === null || savingModel) return;
    setSavingModel(true);
    try {
      const next = !use25;
      const r = await setLucy({ data: { use25: next } });
      setUse25(r.use25);
    } catch (e: any) {
      alert(e?.message ?? "Failed to update model");
    } finally {
      setSavingModel(false);
    }
  };

  if (err) return <p className="text-sm text-destructive">{err}</p>;
  if (!m) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const estStreamed = Math.max(0, (m.total_credits_sold || 0) - (m.total_credits_held || 0));

  const cards = [
    { label: "Total users", value: NUM(m.total_users), Icon: Users },
    { label: "Paying users", value: NUM(m.paying_users), Icon: CreditCard },
    { label: "Total revenue", value: NGN(m.total_revenue_ngn), Icon: TrendingUp },
    { label: "Credits sold", value: NUM(m.total_credits_sold), Icon: Coins },
    { label: "Credits in wallets", value: NUM(m.total_credits_held), Icon: Wallet },
    { label: "Est. streamed", value: NUM(estStreamed), Icon: Activity },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
              <c.Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-medium">Lucy model (silent switch)</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Users always see "Lucy 2.5" in the UI. Turn this off to quietly run
              Lucy 2.0 instead (useful if 2.5 misbehaves). Takes effect on the next stream start.
            </p>
            <p className="mt-2 text-xs">
              Currently running:{" "}
              <span className={"font-semibold " + (use25 ? "text-emerald-400" : "text-amber-400")}>
                {use25 === null ? "…" : use25 ? "lucy-latest (2.5)" : "lucy-2"}
              </span>
            </p>
          </div>
          <button
            onClick={toggleModel}
            disabled={use25 === null || savingModel}
            className={
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition " +
              (use25
                ? "border border-border bg-muted/40 text-foreground hover:bg-muted/70"
                : "bg-primary text-primary-foreground hover:opacity-90") +
              " disabled:opacity-50"
            }
          >
            {savingModel ? "Saving…" : use25 ? "Switch to 2.0" : "Switch to 2.5"}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Recent purchases (last 20)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">User</th><th className="px-4 py-2">Package</th><th className="px-4 py-2 text-right">Credits</th><th className="px-4 py-2 text-right">Amount</th></tr>
            </thead>
            <tbody>
              {m.recent_transactions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No purchases yet.</td></tr>
              )}
              {m.recent_transactions.map((t) => (
                <tr key={t.id} className="border-t border-border/60">
                  <td className="px-4 py-2 text-muted-foreground">{shortDate(t.created_at)}</td>
                  <td className="px-4 py-2">{t.email ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs">{pkgName(t.package_id)}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-emerald-400">+{NUM(t.credits)}</td>
                  <td className="px-4 py-2 text-right">{NGN(t.amount_ngn ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
