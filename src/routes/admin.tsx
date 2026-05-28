import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Shield, Users, Coins, Wallet, Activity, ShieldCheck, ArrowLeft, Radio, Search, X, RefreshCw, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  amIAdmin,
  adminGetCreditStats,
  adminListUsersFull,
  adminListTransactions,
  adminUserTransactions,
  adminGetActiveStreams,
  type AdminUserRow,
  type CreditStats,
  type TransactionRow,
  type ActiveStream,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

const fmtMoney = (n: number) => `₦${Number(n || 0).toLocaleString()}`;
const fmtNum = (n: number) => Number(n || 0).toLocaleString();
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60); const sec = s % 60;
  return `${m}m ${sec}s`;
};

type SortKey = keyof AdminUserRow | "none";

function AdminPage() {
  const navigate = useNavigate();
  const checkFn = useServerFn(amIAdmin);
  const statsFn = useServerFn(adminGetCreditStats);
  const usersFn = useServerFn(adminListUsersFull);
  const txFn = useServerFn(adminListTransactions);
  const userTxFn = useServerFn(adminUserTransactions);
  const activeFn = useServerFn(adminGetActiveStreams);

  const [authChecked, setAuthChecked] = useState(false);
  const [stats, setStats] = useState<CreditStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [active, setActive] = useState<ActiveStream[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });
  const [txFilter, setTxFilter] = useState<"all" | "purchase" | "usage">("all");
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [userTx, setUserTx] = useState<Omit<TransactionRow, "user_id" | "user_email">[]>([]);
  const [userTxLoading, setUserTxLoading] = useState(false);

  // Auth gate
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate({ to: "/" }); return; }
      try {
        const r = await checkFn();
        if (!r.isAdmin) { navigate({ to: "/" }); return; }
        setAuthChecked(true);
      } catch { navigate({ to: "/" }); }
    })();
  }, [checkFn, navigate]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, u, a] = await Promise.all([statsFn(), usersFn(), activeFn()]);
      setStats(s.stats); setUsers(u.users); setActive(a.streams);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }, [statsFn, usersFn, activeFn]);

  // Initial + interval refresh of dynamic data
  useEffect(() => {
    if (!authChecked) return;
    load();
    const id = setInterval(load, 1000);
    return () => clearInterval(id);
  }, [authChecked, load]);

  // Tick once per second to update "X seconds ago"
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Transactions on filter change
  useEffect(() => {
    if (!authChecked) return;
    txFn({ data: { type: txFilter === "all" ? null : txFilter, limit: 500 } })
      .then((r) => setTransactions(r.transactions))
      .catch(() => {});
  }, [authChecked, txFilter, txFn]);

  // Load user drill-down
  useEffect(() => {
    if (!selectedUser) { setUserTx([]); return; }
    setUserTxLoading(true);
    userTxFn({ data: { userId: selectedUser.user_id } })
      .then((r) => setUserTx(r.transactions))
      .finally(() => setUserTxLoading(false));
  }, [selectedUser, userTxFn]);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = !q ? [...users] : users.filter(
      (u) => u.email.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q),
    );
    if (sort.key !== "none") {
      const k = sort.key as keyof AdminUserRow;
      list.sort((a, b) => {
        const av = a[k]; const bv = b[k];
        const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [users, search, sort]);

  const toggleSort = (k: SortKey) => {
    setSort((s) => s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" });
  };

  const isActive = (u: AdminUserRow) =>
    u.last_seen && (Date.now() - new Date(u.last_seen).getTime()) < 1000 * 60 * 60 * 24 * 7;

  if (!authChecked) {
    return <div className="min-h-screen grid place-items-center bg-background text-sm text-muted-foreground">Verifying access…</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/15 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
              Lumify Admin
              <span className="relative inline-flex h-2.5 w-2.5" title="Live">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">private</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Real-time operations dashboard · Last updated:{" "}
              {lastUpdated ? `${Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000))}s ago` : "—"}
              <span className="sr-only">{tick}</span>
            </p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="text-xs inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-secondary/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link to="/dashboard" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to app
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        {error && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 px-4 py-2 text-xs flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            Refresh failed — showing last known values. ({error})
          </div>
        )}

        {/* Overview */}
        <section>
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Overview — All Time</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6">
            <Stat label="Total registered users" value={fmtNum(stats?.total_users ?? users.length)} icon={Users} />
            <Stat label="Total credits ever sold" value={fmtNum(stats?.credits_sold_all_time ?? 0)} icon={Coins} />
            <Stat label="Total credits ever used" value={fmtNum(stats?.total_credits_used ?? 0)} icon={Activity} />
            <Stat label="Total revenue all time" value={fmtMoney(stats?.revenue_all_time ?? 0)} icon={Wallet} highlight />
            <Stat label="Credits currently active" value={fmtNum(stats?.total_credits_held ?? 0)} sub="(unused in wallets)" icon={Coins} />
            <Stat
              label="Average credits per user"
              value={fmtNum(
                (stats?.total_users ?? users.length) > 0
                  ? Math.round((stats?.total_credits_held ?? 0) / (stats?.total_users ?? users.length))
                  : 0
              )}
              icon={Activity}
            />
          </div>

          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground mb-3">Overview — Recent</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="Active streams now" value={fmtNum(stats?.active_streams ?? 0)} icon={Radio} highlight />
            <Stat label="Credits sold today" value={fmtNum(stats?.credits_sold_today ?? 0)} sub={`${fmtNum(stats?.credits_sold_week ?? 0)} week · ${fmtNum(stats?.credits_sold_month ?? 0)} month`} icon={Coins} />
            <Stat label="Revenue today" value={fmtMoney(stats?.revenue_today ?? 0)} sub={`${fmtMoney(stats?.revenue_week ?? 0)} week · ${fmtMoney(stats?.revenue_month ?? 0)} month`} icon={Wallet} />
          </div>
        </section>

        {/* Real-time streams */}
        <Section title="Live streams right now" icon={Radio}>
          {active.length === 0 ? (
            <Empty>No active streams.</Empty>
          ) : (
            <Tbl headers={["User", "Started", "Duration", "Credits used", "Credits left"]}>
              {active.map((s) => (
                <tr key={s.session_id} className="border-t border-border">
                  <Td><div className="font-medium">{s.full_name || s.user_email?.split("@")[0]}</div><div className="text-xs text-muted-foreground">{s.user_email}</div></Td>
                  <Td>{fmtDate(s.started_at)}</Td>
                  <Td>{fmtDuration(s.duration_seconds)}</Td>
                  <Td>{fmtNum(s.credits_used)}</Td>
                  <Td className="text-primary font-medium">{fmtNum(s.credits_remaining)}</Td>
                </tr>
              ))}
            </Tbl>
          )}
        </Section>

        {/* Users */}
        <Section
          title="Users"
          icon={Users}
          actions={
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search email or name…"
                className="h-8 w-56 pl-7 rounded-md border border-border bg-background px-3 text-xs" />
            </div>
          }
        >
          <Tbl headers={[
            { k: "email", l: "User" },
            { k: "created_at", l: "Joined" },
            { k: "balance", l: "Balance" },
            { k: "total_credits_purchased", l: "Purchased" },
            { k: "total_credits_used", l: "Used" },
            { k: "total_spent", l: "Spent" },
            { k: "last_seen", l: "Last active" },
            { k: "none", l: "Status" },
          ]} sort={sort} onSort={toggleSort}>
            {filteredUsers.length === 0 ? (
              <tr><Td colSpan={8} className="text-center text-muted-foreground py-8">No users.</Td></tr>
            ) : filteredUsers.map((u) => (
              <tr key={u.user_id} className="border-t border-border hover:bg-secondary/40 cursor-pointer" onClick={() => setSelectedUser(u)}>
                <Td>
                  <div className="font-medium flex items-center gap-1.5">{u.full_name || u.email.split("@")[0]}
                    {u.is_admin && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </Td>
                <Td className="text-muted-foreground">{fmtDate(u.created_at)}</Td>
                <Td className="text-primary font-medium">{fmtNum(u.balance)}</Td>
                <Td>{fmtNum(u.total_credits_purchased)}</Td>
                <Td className="text-muted-foreground">{fmtNum(u.total_credits_used)}</Td>
                <Td>{fmtMoney(u.total_spent)}</Td>
                <Td className="text-muted-foreground text-xs">{fmtDate(u.last_seen)}</Td>
                <Td>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_streaming ? "bg-primary/15 text-primary" : isActive(u) ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                    {u.is_streaming ? "Streaming" : isActive(u) ? "Active" : "Inactive"}
                  </span>
                </Td>
              </tr>
            ))}
          </Tbl>
        </Section>

        {/* Credits monitor */}
        <Section
          title="Credits monitor"
          icon={Coins}
          actions={
            <div className="flex gap-1 text-xs">
              {(["all", "purchase", "usage"] as const).map((t) => (
                <button key={t} onClick={() => setTxFilter(t)}
                  className={`px-3 py-1 rounded-md border ${txFilter === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                  {t}
                </button>
              ))}
            </div>
          }
        >
          <Tbl headers={["User", "Type", "Credits", "Amount", "Description", "Date"]}>
            {transactions.length === 0 ? (
              <tr><Td colSpan={6} className="text-center text-muted-foreground py-8">No transactions.</Td></tr>
            ) : transactions.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <Td>{t.user_email ?? <span className="text-muted-foreground italic">unknown</span>}</Td>
                <Td><span className={`text-xs px-2 py-0.5 rounded-full ${t.type === "purchase" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>{t.type}</span></Td>
                <Td>{fmtNum(t.credits)}</Td>
                <Td>{fmtMoney(t.amount)}</Td>
                <Td className="text-muted-foreground truncate max-w-xs">{t.description || "—"}</Td>
                <Td className="text-muted-foreground text-xs whitespace-nowrap">{fmtDate(t.created_at)}</Td>
              </tr>
            ))}
          </Tbl>
        </Section>

      </div>

      {/* User drill-down modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur grid place-items-center p-4" onClick={() => setSelectedUser(null)}>
          <div className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div>
                <h3 className="text-lg font-semibold">{selectedUser.full_name || selectedUser.email.split("@")[0]}</h3>
                <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-4 gap-3 p-5 border-b border-border text-center">
              <div><div className="text-xs text-muted-foreground">Balance</div><div className="text-lg text-primary">{fmtNum(selectedUser.balance)}</div></div>
              <div><div className="text-xs text-muted-foreground">Purchased</div><div className="text-lg">{fmtNum(selectedUser.total_credits_purchased)}</div></div>
              <div><div className="text-xs text-muted-foreground">Used</div><div className="text-lg">{fmtNum(selectedUser.total_credits_used)}</div></div>
              <div><div className="text-xs text-muted-foreground">Spent</div><div className="text-lg">{fmtMoney(selectedUser.total_spent)}</div></div>
            </div>
            <div className="max-h-96 overflow-auto">
              <Tbl headers={["Date", "Type", "Credits", "Amount", "Description"]}>
                {userTxLoading ? (
                  <tr><Td colSpan={5} className="text-center text-muted-foreground py-8">Loading…</Td></tr>
                ) : userTx.length === 0 ? (
                  <tr><Td colSpan={5} className="text-center text-muted-foreground py-8">No transactions.</Td></tr>
                ) : userTx.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <Td className="text-xs text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</Td>
                    <Td><span className={`text-xs px-2 py-0.5 rounded-full ${t.type === "purchase" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"}`}>{t.type}</span></Td>
                    <Td>{fmtNum(t.credits)}</Td>
                    <Td>{fmtMoney(t.amount)}</Td>
                    <Td className="text-muted-foreground">{t.description || "—"}</Td>
                  </tr>
                ))}
              </Tbl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon: Icon, highlight }: { label: string; value: string; sub?: string; icon?: typeof Users; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>{Icon && <Icon className={`h-3.5 w-3.5 ${highlight ? "text-primary" : ""}`} />}
      </div>
      <div className={`mt-2 text-2xl ${highlight ? "text-primary" : ""} font-display`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Section({ title, icon: Icon, actions, children }: { title: string; icon: typeof Users; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-4">
        <h2 className="text-sm font-medium flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /> {title}</h2>
        {actions}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

type Header = string | { k: SortKey; l: string };
function Tbl({ headers, sort, onSort, children }: { headers: Header[]; sort?: { key: SortKey; dir: "asc" | "desc" }; onSort?: (k: SortKey) => void; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
        <tr>
          {headers.map((h, i) => {
            const k = typeof h === "string" ? null : h.k;
            const l = typeof h === "string" ? h : h.l;
            const active = sort && k && sort.key === k;
            return (
              <th key={i} className={`px-4 py-2.5 ${onSort && k && k !== "none" ? "cursor-pointer hover:text-foreground" : ""}`}
                onClick={() => onSort && k && k !== "none" && onSort(k)}>
                {l}{active && <span className="ml-1">{sort!.dir === "asc" ? "↑" : "↓"}</span>}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children, className = "", colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={`px-4 py-3 ${className}`}>{children}</td>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}
