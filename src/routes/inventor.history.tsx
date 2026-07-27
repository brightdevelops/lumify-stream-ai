import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, X, User, Clock, Coins, Wallet, Activity, ShieldAlert } from "lucide-react";
import { inventorListUsers, type InventorUser } from "@/lib/inventor.functions";
import { adminUserHistory, type UserHistoryPayload } from "@/lib/admin.functions";
import { NUM, NGN, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/history")({
  component: HistoryPage,
});

function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

type Row =
  | { kind: "tx"; at: string; tx: UserHistoryPayload["transactions"][number] }
  | { kind: "session"; at: string; session: UserHistoryPayload["sessions"][number] };

function HistoryPage() {
  const listFn = useServerFn(inventorListUsers);
  const histFn = useServerFn(adminUserHistory);

  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<InventorUser[]>([]);
  const [selected, setSelected] = useState<InventorUser | null>(null);
  const [hist, setHist] = useState<UserHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "purchase" | "usage" | "session" | "adjustment">("all");

  const doSearch = useCallback(async () => {
    if (!search.trim()) { setUsers([]); return; }
    try {
      const r = await listFn({ data: { search: search.trim(), limit: 50 } });
      setUsers(r.users);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
  }, [listFn, search]);

  useEffect(() => {
    const t = setTimeout(() => { doSearch(); }, 250);
    return () => clearTimeout(t);
  }, [doSearch]);

  const loadUser = useCallback(async (u: InventorUser) => {
    setSelected(u);
    setHist(null);
    setLoading(true);
    try {
      const r = await histFn({ data: { userId: u.id } });
      setHist(r);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setLoading(false); }
  }, [histFn]);

  const timeline: Row[] = useMemo(() => {
    if (!hist) return [];
    const rows: Row[] = [];
    for (const tx of hist.transactions) rows.push({ kind: "tx", at: tx.created_at, tx });
    for (const s of hist.sessions) rows.push({ kind: "session", at: s.started_at, session: s });
    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    if (filter === "all") return rows;
    return rows.filter((r) => {
      if (filter === "session") return r.kind === "session";
      if (r.kind !== "tx") return false;
      if (filter === "purchase") return r.tx.type === "purchase";
      if (filter === "usage") return r.tx.type === "usage";
      if (filter === "adjustment") return r.tx.type !== "purchase" && r.tx.type !== "usage";
      return true;
    });
  }, [hist, filter]);

  return (
    <div className="space-y-4">
      {err && (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{err}</span>
          <button onClick={() => setErr(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold">User History</h2>
        <p className="text-xs text-muted-foreground">Search a user to see their full timeline — purchases, credit usage, stream sessions, and admin adjustments.</p>
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
              <span className="text-xs text-primary">View history →</span>
            </button>
          ))}
        </div>
      )}

      {!selected && search.trim() && users.length === 0 && (
        <div className="rounded-md border border-border bg-card/40 px-3 py-6 text-center text-sm text-muted-foreground">
          No users match “{search}”.
        </div>
      )}

      {selected && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary">
                <User className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">{selected.email}</div>
                <div className="text-xs text-muted-foreground">
                  {hist?.profile
                    ? <>Joined {shortDate(hist.profile.created_at)} · Balance {NUM(hist.profile.balance)}{hist.profile.last_country ? ` · ${hist.profile.last_country}` : ""}{hist.profile.is_vpn ? " · VPN" : ""}{hist.profile.banned ? " · BANNED" : ""}</>
                    : "Loading profile…"}
                </div>
              </div>
            </div>
            <button
              onClick={() => { setSelected(null); setHist(null); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
            >
              ← Back to search
            </button>
          </div>

          {loading || !hist ? (
            <div className="rounded-md border border-border bg-card/40 px-3 py-8 text-center text-sm text-muted-foreground">Loading history…</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard icon={<Coins className="h-4 w-4" />} label="Purchased" value={NUM(hist.totals.purchased_credits)} sub={`${hist.totals.purchases_count} orders`} />
                <StatCard icon={<Wallet className="h-4 w-4" />} label="Revenue" value={NGN(hist.totals.revenue_ngn)} sub="Lifetime" />
                <StatCard icon={<Activity className="h-4 w-4" />} label="Credits used" value={NUM(hist.totals.used_credits)} sub={`${hist.totals.usage_count} charges`} />
                <StatCard icon={<Clock className="h-4 w-4" />} label="Stream time" value={fmtDuration(hist.totals.total_stream_seconds)} sub={`${hist.totals.sessions_count} sessions`} />
              </div>

              {hist.totals.adjustments_count > 0 && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  <ShieldAlert className="h-4 w-4" />
                  <span>{hist.totals.adjustments_count} admin adjustment(s) totalling {hist.totals.adjustments_credits >= 0 ? "+" : ""}{NUM(hist.totals.adjustments_credits)} credits.</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1">
                {(["all", "purchase", "usage", "session", "adjustment"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={
                      "rounded-md px-3 py-1 text-xs " +
                      (filter === f ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted/40")
                    }
                  >
                    {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              <div className="rounded-md border border-border bg-card/40">
                <div className="border-b border-border px-3 py-2 text-sm font-medium">
                  Timeline ({timeline.length})
                </div>
                {timeline.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">No activity for this filter.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">When</th>
                          <th className="px-3 py-2 font-medium">Kind</th>
                          <th className="px-3 py-2 font-medium">Detail</th>
                          <th className="px-3 py-2 font-medium text-right">Credits</th>
                          <th className="px-3 py-2 font-medium text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {timeline.map((r) => r.kind === "tx" ? (
                          <tr key={"t" + r.tx.id}>
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{shortDate(r.tx.created_at)}</td>
                            <td className="px-3 py-2"><KindPill kind={r.tx.type} /></td>
                            <td className="px-3 py-2 text-xs text-muted-foreground max-w-md truncate" title={r.tx.description ?? ""}>{r.tx.description ?? "—"}</td>
                            <td className={"px-3 py-2 text-right text-xs " + ((Number(r.tx.credits) || 0) > 0 ? "text-emerald-400" : (Number(r.tx.credits) || 0) < 0 ? "text-destructive" : "")}>
                              {(Number(r.tx.credits) || 0) > 0 ? "+" : ""}{NUM(r.tx.credits)}
                            </td>
                            <td className="px-3 py-2 text-right text-xs">{r.tx.type === "purchase" ? NGN(r.tx.amount) : "—"}</td>
                          </tr>
                        ) : (
                          <tr key={"s" + r.session.id}>
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{shortDate(r.session.started_at)}</td>
                            <td className="px-3 py-2"><KindPill kind="session" /></td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              Duration {fmtDuration(r.session.duration_seconds)}{r.session.ended_at ? "" : " · still active"}
                            </td>
                            <td className={"px-3 py-2 text-right text-xs " + (r.session.credits_used > 0 ? "text-destructive" : "text-muted-foreground")}>
                              {r.session.credits_used > 0 ? `-${NUM(r.session.credits_used)}` : "0"}
                            </td>
                            <td className="px-3 py-2 text-right text-xs">—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function KindPill({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    purchase: "bg-emerald-500/15 text-emerald-400",
    usage: "bg-destructive/15 text-destructive",
    session: "bg-sky-500/15 text-sky-400",
  };
  const cls = map[kind] ?? "bg-muted text-muted-foreground";
  return <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " + cls}>{kind}</span>;
}
