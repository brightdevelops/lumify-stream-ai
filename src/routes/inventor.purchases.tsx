import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, X, Receipt } from "lucide-react";
import { inventorListUsers, type InventorUser } from "@/lib/inventor.functions";
import { adminUserTransactions } from "@/lib/admin.functions";
import { NUM, NGN, pkgName, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/purchases")({
  component: PurchasesPage,
});

type Tx = {
  id: string;
  type: string;
  credits: number;
  amount: number;
  description: string | null;
  created_at: string;
};

function PurchasesPage() {
  const listFn = useServerFn(inventorListUsers);
  const txFn = useServerFn(adminUserTransactions);

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<InventorUser[]>([]);
  const [selected, setSelected] = useState<InventorUser | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loadingTx, setLoadingTx] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!search.trim()) { setUsers([]); return; }
    try {
      const r = await listFn({ data: { search: search.trim(), limit: 50 } });
      setUsers(r.users);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  }, [listFn, search]);

  useEffect(() => {
    const t = setTimeout(() => { reload(); }, 250);
    return () => clearTimeout(t);
  }, [reload]);

  const loadUser = useCallback(async (u: InventorUser) => {
    setSelected(u);
    setLoadingTx(true);
    setTxs([]);
    try {
      const r = await txFn({ data: { userId: u.id } });
      setTxs(r.transactions as Tx[]);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setLoadingTx(false); }
  }, [txFn]);

  const purchases = useMemo(() => txs.filter((t) => t.type === "purchase"), [txs]);
  const adjustments = useMemo(
    () => txs.filter((t) => t.type !== "purchase" && t.type !== "usage" && (Number(t.credits) || 0) !== 0),
    [txs],
  );

  const totals = useMemo(() => {
    const paidCredits = purchases.reduce((a, t) => a + (Number(t.credits) || 0), 0);
    const revenue = purchases.reduce((a, t) => a + (Number(t.amount) || 0), 0);
    const adjCredits = adjustments.reduce((a, t) => a + (Number(t.credits) || 0), 0);
    return { paidCredits, revenue, adjCredits };
  }, [purchases, adjustments]);

  return (
    <div className="space-y-4">
      {err && (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{err}</span>
          <button onClick={() => setErr(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold">Credit Purchases</h2>
        <p className="text-xs text-muted-foreground">Search a user by email to see their full credit purchase history.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {users.length > 0 && !selected && (
        <div className="rounded-md border border-border bg-card/40 divide-y divide-border">
          {users.slice(0, 25).map((u) => (
            <button
              key={u.id}
              onClick={() => loadUser(u)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/40"
            >
              <div>
                <div className="font-medium">{u.email}</div>
                <div className="text-xs text-muted-foreground">Balance: {NUM(u.credits)} credits</div>
              </div>
              <span className="text-xs text-primary">View purchases →</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-4 py-3">
            <div>
              <div className="text-sm font-semibold">{selected.email}</div>
              <div className="text-xs text-muted-foreground">Current balance: {NUM(selected.credits)} credits</div>
            </div>
            <button
              onClick={() => { setSelected(null); setTxs([]); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
            >
              ← Back to search
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Paid credits" value={NUM(totals.paidCredits)} />
            <StatCard label="Revenue" value={NGN(totals.revenue)} />
            <StatCard label="Admin adjustments" value={`${totals.adjCredits >= 0 ? "+" : ""}${NUM(totals.adjCredits)}`} />
          </div>

          <div className="rounded-md border border-border bg-card/40">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
              <Receipt className="h-4 w-4 text-primary" /> Purchases ({purchases.length})
            </div>
            {loadingTx ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : purchases.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No purchases found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Pack</th>
                      <th className="px-3 py-2 font-medium text-right">Credits</th>
                      <th className="px-3 py-2 font-medium text-right">Amount</th>
                      <th className="px-3 py-2 font-medium">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {purchases.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{shortDate(t.created_at)}</td>
                        <td className="px-3 py-2">{pkgName(extractPack(t.description))}</td>
                        <td className="px-3 py-2 text-right">{NUM(t.credits)}</td>
                        <td className="px-3 py-2 text-right">{NGN(t.amount)}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{t.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {adjustments.length > 0 && (
            <div className="rounded-md border border-border bg-card/40">
              <div className="border-b border-border px-3 py-2 text-sm font-medium">
                Admin adjustments ({adjustments.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium text-right">Credits</th>
                      <th className="px-3 py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {adjustments.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{shortDate(t.created_at)}</td>
                        <td className="px-3 py-2 text-xs">{t.type}</td>
                        <td className={"px-3 py-2 text-right " + ((Number(t.credits) || 0) >= 0 ? "text-emerald-400" : "text-destructive")}>
                          {(Number(t.credits) || 0) >= 0 ? "+" : ""}{NUM(t.credits)}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{t.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {!selected && search.trim() && users.length === 0 && (
        <div className="rounded-md border border-border bg-card/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No users match “{search}”.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function extractPack(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(/\b(starter|basic|pro|enterprise)\b/i);
  return m ? m[1].toLowerCase() : null;
}
