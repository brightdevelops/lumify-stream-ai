import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, Loader2, Globe, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { inventorSearchIp, type IpSearchResult } from "@/lib/ip-lookup.functions";

export const Route = createFileRoute("/inventor/ip-search")({
  component: IpSearchPage,
});

function IpSearchPage() {
  const search = useServerFn(inventorSearchIp);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<IpSearchResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setLoading(true); setErr(null);
    try {
      const r = await search({ data: { query: query.trim() } });
      setResult(r);
    } catch (ex) {
      setErr(String((ex as Error)?.message ?? ex));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">IP address search</h2>
        <p className="text-xs text-muted-foreground">Search visits and profiles by full or partial IP (e.g. <code className="rounded bg-muted px-1">102.89</code>).</p>
        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="192.168.1.1 or partial..."
            className="font-mono"
          />
          <Button type="submit" disabled={loading || query.trim().length < 2}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-1.5">Search</span>
          </Button>
        </form>
        {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
      </div>

      {result && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Visits" value={result.visit_count.toString()} />
            <Stat label="Unique users" value={result.unique_users.toString()} />
            <Stat label="First seen" value={fmt(result.first_seen)} />
            <Stat label="Last seen" value={fmt(result.last_seen)} />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">Matching profiles ({result.profiles.length})</h3>
            </div>
            {result.profiles.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No profile has this IP as their last known IP.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {result.profiles.map((p) => (
                  <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.email ?? p.user_id}</div>
                      <div className="text-xs text-muted-foreground">{p.full_name ?? "—"}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{p.last_ip ?? "—"}</span>
                      {p.last_country && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{p.last_country}</span>}
                      {p.is_vpn && <span className="inline-flex items-center gap-1 text-amber-500"><ShieldAlert className="h-3 w-3" />VPN</span>}
                      <span>{fmt(p.last_seen)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-medium">Page visits ({result.visits.length})</h3>
            </div>
            <div className="max-h-[600px] overflow-auto">
              {result.visits.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No visits recorded for this IP.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">IP</th>
                      <th className="px-4 py-2">User</th>
                      <th className="px-4 py-2">Path</th>
                      <th className="px-4 py-2">UA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {result.visits.map((v) => (
                      <tr key={v.id}>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{fmt(v.created_at)}</td>
                        <td className="px-4 py-2 font-mono text-xs">{v.ip ?? "—"}</td>
                        <td className="px-4 py-2 text-xs">{v.user_email ?? <span className="text-muted-foreground">anonymous</span>}</td>
                        <td className="px-4 py-2 text-xs">{v.path}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-[280px] truncate" title={v.user_agent ?? ""}>{v.user_agent ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
