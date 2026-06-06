import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { inventorListUsers, type InventorUser } from "@/lib/inventor.functions";
import { NUM, relativeTime, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/monitor")({
  component: MonitorPage,
});

function MonitorPage() {
  const fn = useServerFn(inventorListUsers);
  const [users, setUsers] = useState<InventorUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fn().then((r) => setUsers(r.users)).catch((e) => setErr(String(e?.message ?? e))); }, [fn]);

  const zero = useMemo(() => users.filter((u) => u.credits === 0 && !u.is_admin), [users]);
  const neverStreamed = useMemo(() => users.filter((u) => !u.has_streamed && u.credits > 0), [users]);
  const recent = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return users.filter((u) => new Date(u.created_at).getTime() >= cutoff)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  }, [users]);

  if (err) return <p className="text-sm text-destructive">{err}</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Section title="Zero balance" subtitle="Non-admin users with 0 credits" users={zero} cell={(u) => relativeTime(u.last_sign_in_at)} />
      <Section title="Never streamed" subtitle="Has credits, hasn't streamed yet" users={neverStreamed} cell={(u) => `${NUM(u.credits)} credits`} />
      <Section title="New signups" subtitle="Joined in last 30 days" users={recent} cell={(u) => shortDate(u.created_at)} />
    </div>
  );
}

function Section({ title, subtitle, users, cell }: { title: string; subtitle: string; users: InventorUser[]; cell: (u: InventorUser) => string }) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">{title} <span className="ml-1 text-xs text-muted-foreground">({users.length})</span></h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {users.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">None.</p>}
        <ul className="divide-y divide-border/60 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-4 py-2">
              <span className="truncate">{u.email}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{cell(u)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
