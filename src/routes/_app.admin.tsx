import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Shield, Users, Coins, Wallet, ShieldCheck, Eye, Globe } from "lucide-react";
import {
  adminListUsers,
  amIAdmin,
  adminGetVisitStats,
  adminListRecentVisits,
  type AdminUserRow,
  type VisitStats,
  type RecentVisit,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AdminPage() {
  const navigate = useNavigate();
  const listFn = useServerFn(adminListUsers);
  const checkFn = useServerFn(amIAdmin);
  const statsFn = useServerFn(adminGetVisitStats);
  const visitsFn = useServerFn(adminListRecentVisits);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);
  const [visits, setVisits] = useState<RecentVisit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await checkFn();
        if (!me.isAdmin) {
          navigate({ to: "/dashboard" });
          return;
        }
        const [u, s, v] = await Promise.all([listFn(), statsFn(), visitsFn()]);
        if (cancelled) return;
        setUsers(u.users);
        setVisitStats(s.stats);
        setVisits(v.visits);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [listFn, checkFn, statsFn, visitsFn, navigate]);

  const filtered = users.filter((u) =>
    !search ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.full_name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const totals = users.reduce(
    (acc, u) => {
      acc.balance += Number(u.balance);
      acc.spent += Number(u.total_spent);
      acc.used += Number(u.total_credits_used);
      return acc;
    },
    { balance: 0, spent: 0, used: 0 },
  );

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
          <Shield className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-3xl">Admin</h1>
          <p className="text-sm text-muted-foreground">All users and credit balances.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 my-8">
        <Stat label="Registered Users" value={users.length.toLocaleString()} icon={Users} />
        <Stat label="Total Page Views" value={(visitStats?.total_visits ?? 0).toLocaleString()} icon={Eye} highlight />
        <Stat label="Visits Today" value={(visitStats?.visits_today ?? 0).toLocaleString()} icon={Globe} />
        <Stat label="Visits (7 days)" value={(visitStats?.visits_last_7_days ?? 0).toLocaleString()} icon={Globe} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 mb-8">
        <Stat label="Total Credits Held" value={totals.balance.toLocaleString()} icon={Coins} />
        <Stat label="Lifetime Revenue" value={`₦${totals.spent.toLocaleString()}`} icon={Wallet} />
        <Stat label="Credits Used" value={totals.used.toLocaleString()} icon={Coins} />
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
          <h2 className="text-lg">Users</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or name…"
            className="h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3">User</th>
                <th className="px-6 py-3">Joined</th>
                <th className="px-6 py-3 text-right">Balance</th>
                <th className="px-6 py-3 text-right">Spent</th>
                <th className="px-6 py-3 text-right">Used</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-destructive">{error}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-muted-foreground">No users found.</td></tr>
              ) : filtered.map((u) => (
                <tr key={u.user_id} className="border-t border-border">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-medium flex items-center gap-1.5">
                          {u.full_name || u.email.split("@")[0]}
                          {u.is_admin && <ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                        </div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{fmtDate(u.created_at)}</td>
                  <td className="px-6 py-4 text-right font-medium text-primary">{Number(u.balance).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right">₦{Number(u.total_spent).toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-muted-foreground">{Number(u.total_credits_used).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden mt-8">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-4">
          <h2 className="text-lg flex items-center gap-2"><Eye className="h-4 w-4" /> Recent page visits</h2>
          <span className="text-xs text-muted-foreground">Last {visits.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-6 py-3">When</th>
                <th className="px-6 py-3">Path</th>
                <th className="px-6 py-3">Visitor</th>
                <th className="px-6 py-3">Referrer</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">Loading…</td></tr>
              ) : visits.length === 0 ? (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-muted-foreground">No visits recorded yet.</td></tr>
              ) : visits.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="px-6 py-3 text-muted-foreground whitespace-nowrap">{fmtDateTime(v.created_at)}</td>
                  <td className="px-6 py-3 font-mono text-xs">{v.path}</td>
                  <td className="px-6 py-3">{v.user_email ?? <span className="text-muted-foreground italic">anonymous</span>}</td>
                  <td className="px-6 py-3 text-muted-foreground truncate max-w-xs">{v.referrer || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, highlight }: { label: string; value: string; icon: typeof Users; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${highlight ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className={`mt-3 text-3xl font-display ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
