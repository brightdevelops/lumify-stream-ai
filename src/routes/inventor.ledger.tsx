import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { inventorGetLedger, type LedgerRow } from "@/lib/inventor.functions";
import { NUM, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/ledger")({
  component: LedgerPage,
});

type Filter = "all" | "purchase" | "stream_deduction" | "admin_adjustment";

function LedgerPage() {
  const fn = useServerFn(inventorGetLedger);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fn({ data: { row_limit: 200 } }).then((r) => setRows(r.rows)).catch((e) => setErr(String(e?.message ?? e)));
  }, [fn]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.reason !== filter) return false;
      if (s && !(r.user_email ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, search, filter]);

  const reasonBadge = (r: string) => {
    const map: Record<string, string> = {
      purchase: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
      stream_deduction: "border-sky-500/30 bg-sky-500/10 text-sky-200",
      admin_adjustment: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    };
    return <span className={"rounded-full border px-2 py-0.5 text-[10px] " + (map[r] ?? "border-border")}>{r.replace("_", " ")}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by user email…"
          className="flex-1 min-w-[220px] rounded-md border border-border bg-card px-3 py-2 text-sm" />
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {(["all", "purchase", "stream_deduction", "admin_adjustment"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={"rounded px-3 py-1 text-xs " + (filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f === "all" ? "All" : f === "stream_deduction" ? "Streams" : f === "admin_adjustment" ? "Adjustments" : "Purchases"}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2 text-right">Delta</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2 text-right">Balance after</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No ledger entries.</td></tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-border/60">
                <td className="px-3 py-2 text-muted-foreground">{shortDate(r.created_at)}</td>
                <td className="px-3 py-2">{r.user_email ?? "—"}</td>
                <td className={"px-3 py-2 text-right tabular-nums " + (r.delta >= 0 ? "text-emerald-400" : "text-destructive")}>
                  {r.delta >= 0 ? "+" : ""}{NUM(r.delta)}
                </td>
                <td className="px-3 py-2">{reasonBadge(r.reason)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{NUM(r.balance_after)}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.admin_email ? r.admin_email.split("@")[0] : "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
