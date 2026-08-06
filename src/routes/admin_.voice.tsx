import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { amIAdmin } from "@/lib/admin.functions";
import { voiceAdminStats, type VoiceAdminStats, type VoiceRange } from "@/lib/voice-admin.functions";

export const Route = createFileRoute("/admin_/voice")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    try {
      const r = await amIAdmin();
      if (!r.isAdmin) throw redirect({ to: "/dashboard" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({
    meta: [
      { title: "Voice Studio Admin · Lumify" },
      { name: "description", content: "Admin monitoring for Lumify Voice Studio usage, credits and users." },
      { property: "og:title", content: "Voice Studio Admin · Lumify" },
      { property: "og:description", content: "Admin monitoring for Lumify Voice Studio usage, credits and users." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VoiceAdminPage,
});

const CARD = "rounded-2xl border border-[#262b1c] bg-[#14170f] p-5";
const TITLE = "text-[11px] uppercase tracking-[0.14em] text-[#9aa08c]";
const SERIF = { fontFamily: "Georgia, 'Times New Roman', serif" } as const;
const MONO = "font-mono";
const NAIRA_PER_CREDIT = 1.5;

const nf = (n: number) => Math.round(Number(n) || 0).toLocaleString();
const money = (n: number) => `₦${Math.round(Number(n) || 0).toLocaleString()}`;

function rel(iso: string | null) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

const RANGES: Array<{ id: VoiceRange; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

function VoiceAdminPage() {
  const statsFn = useServerFn(voiceAdminStats);
  const [range, setRange] = useState<VoiceRange>("7d");
  const [data, setData] = useState<VoiceAdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    statsFn({ data: { range } })
      .then((r) => { if (!cancelled) setData(r as VoiceAdminStats); })
      .catch((e) => { if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, statsFn]);

  const t = data?.totals;
  const apiShare = data && t && t.generations > 0 ? Math.round((data.api_generations / t.generations) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0b0d0a] text-[#e8ece0]">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] leading-tight text-[#e8ece0]" style={SERIF}>Voice Studio Admin</h1>
            <p className="mt-1 text-[13px] text-[#6b7160]">Who&apos;s using voice, and what it&apos;s earning.</p>
            <Link to="/admin" className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#6b7160] hover:text-[#c6f24e]">
              <ArrowLeft className="h-3 w-3" /> Back to Admin
            </Link>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-[#262b1c] bg-[#14170f] p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={
                  "rounded-full px-3 py-1.5 text-[12px] transition " +
                  (range === r.id ? "bg-[#c6f24e] font-semibold text-[#0b0d0a]" : "text-[#9aa08c] hover:text-[#e8ece0]")
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-300">{err}</div>
        )}

        {/* Tiles */}
        <div className="mt-6 grid grid-cols-2 gap-4 min-[900px]:grid-cols-5">
          <Tile label="Generations" value={nf(t?.generations ?? 0)} sub={`≈ ${nf(t?.characters ?? 0)} characters`} loading={loading} />
          <Tile label="Credits earned" value={nf(t?.credits ?? 0)} sub={`≈ ${money((t?.credits ?? 0) * NAIRA_PER_CREDIT)} at ₦1.50/cr`} loading={loading} />
          <Tile label="Voice clones" value={nf(t?.clones ?? 0)} sub={`${nf((t?.clones ?? 0) * 150)} credits earned`} loading={loading} />
          <Tile label="Active users" value={nf(data?.active_users ?? 0)} sub={`${nf(data?.new_users ?? 0)} new vs previous period`} loading={loading} />
          <Tile label="API share" value={`${apiShare}%`} sub={`${100 - apiShare}% from dashboard`} loading={loading} />
        </div>

        {/* Chart */}
        <div className={`${CARD} mt-4`}>
          <div className={TITLE}>Daily usage</div>
          <Chart points={data?.daily ?? []} hourly={range === "today"} />
        </div>

        <UsersCard users={data?.users ?? []} />

        {/* Recent */}
        <div className={`${CARD} mt-4`}>
          <div className={TITLE}>Recent</div>
          {(data?.recent ?? []).length === 0 ? (
            <div className="py-10 text-center text-[13px] text-[#6b7160]">No usage in this period yet</div>
          ) : (
            <div className="mt-3 max-h-[420px] overflow-y-auto divide-y divide-[#1e2317]">
              {(data?.recent ?? []).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                  <span className={`${MONO} w-[70px] shrink-0 text-[10px] text-[#6b7160]`}>{rel(r.created_at)}</span>
                  <span className="text-[13px] text-[#e8ece0]">{r.email}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                      (r.kind === "generation" ? "bg-[#c6f24e]/15 text-[#c6f24e]" : "bg-amber-400/15 text-amber-300")
                    }
                  >
                    {r.kind === "generation" ? "GEN" : "CLONE"}
                  </span>
                  <span className="text-[12px] text-[#6b7160]">{nf(r.characters)} chars · {nf(r.credits)} cr</span>
                  <span className={`${MONO} rounded-full border border-[#262b1c] px-2 py-0.5 text-[10px] text-[#9aa08c]`}>
                    {r.source === "api" ? "API" : "APP"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, loading }: { label: string; value: string; sub: string; loading: boolean }) {
  return (
    <div className={CARD}>
      <div className={TITLE}>{label}</div>
      <div className="mt-2 text-[24px] leading-none text-[#e8ece0]" style={SERIF}>{loading ? "—" : value}</div>
      <div className="mt-2 text-[11px] text-[#6b7160]">{sub}</div>
    </div>
  );
}

function Chart({ points, hourly }: { points: Array<{ bucket: string; generations: number; credits: number }>; hourly: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.credits));
  if (points.length === 0 || points.every((p) => p.credits === 0 && p.generations === 0)) {
    return <div className="py-14 text-center text-[13px] text-[#6b7160]">No usage in this period yet</div>;
  }
  const label = (b: string) =>
    hourly ? `${b.slice(11, 13)}:00` : new Date(b).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="relative mt-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[180px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${(i / 2) * 100}%` }}>
            <span className={`${MONO} w-10 shrink-0 text-[10px] text-[#4d5346]`}>{nf(max * (1 - i / 2))}</span>
            <span className="h-px flex-1 bg-[#1e2317]" />
          </div>
        ))}
      </div>
      <div className="relative ml-12 flex h-[180px] items-end gap-[3px]">
        {points.map((p, i) => (
          <div
            key={p.bucket}
            className="relative flex-1"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(p.credits > 0 ? 3 : 1, (p.credits / max) * 175)}px`,
                background: "linear-gradient(to top, #8fc233, #c6f24e)",
                opacity: p.credits > 0 ? 1 : 0.15,
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            />
            {hover === i && (
              <div className={`${MONO} absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-[#262b1c] bg-[#0b0d0a] px-2 py-1 text-[10px] text-[#e8ece0]`}>
                {label(p.bucket)} · {p.generations} gen · {nf(p.credits)} cr
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={`${MONO} ml-12 mt-2 flex justify-between text-[10px] text-[#4d5346]`}>
        <span>{label(points[0]!.bucket)}</span>
        <span>{label(points[points.length - 1]!.bucket)}</span>
      </div>
    </div>
  );
}

type UserRow = VoiceAdminStats["users"][number];
type SortKey = "generations" | "credits" | "last_activity";

function UsersCard({ users }: { users: UserRow[] }) {
  const [sort, setSort] = useState<SortKey>("credits");
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const arr = [...users];
    arr.sort((a, b) => {
      if (sort === "last_activity") return (b.last_activity ?? "").localeCompare(a.last_activity ?? "");
      return (b[sort] as number) - (a[sort] as number);
    });
    return arr;
  }, [users, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / 20));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * 20, current * 20 + 20);

  const Th = ({ label, k }: { label: string; k?: SortKey }) => (
    <th className={`${TITLE} px-2 py-2 text-left font-normal`}>
      {k ? (
        <button onClick={() => { setSort(k); setPage(0); }} className="inline-flex items-center gap-1 hover:text-[#e8ece0]">
          {label}
          <span className={`text-[12px] ${sort === k ? "text-[#c6f24e]" : "text-[#4d5346]"}`}>↓</span>
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className={`${CARD} mt-4`}>
      <div className={TITLE}>Users</div>
      {users.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-[#6b7160]">No voice users yet</div>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr>
                  <Th label="Email" />
                  <Th label="Generations" k="generations" />
                  <Th label="Characters" />
                  <Th label="Credits spent" k="credits" />
                  <Th label="Clones" />
                  <Th label="Last used" k="last_activity" />
                </tr>
              </thead>
              <tbody>
                {slice.map((u) => (
                  <tr key={u.user_id} className="border-t border-[#1e2317]">
                    <td className="px-2 py-2.5 text-[13px] text-[#e8ece0]">{u.email}</td>
                    <td className="px-2 py-2.5 text-[13px] text-[#9aa08c]">{nf(u.generations)}</td>
                    <td className="px-2 py-2.5 text-[13px] text-[#9aa08c]">{nf(u.characters)}</td>
                    <td className="px-2 py-2.5 text-[13px] text-[#9aa08c]">{nf(u.credits)}</td>
                    <td className="px-2 py-2.5 text-[13px] text-[#9aa08c]">{u.clones}/5</td>
                    <td className="px-2 py-2.5 text-[13px] text-[#9aa08c]">{rel(u.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-[12px] text-[#9aa08c]">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={current === 0}
                className="rounded-full border border-[#262b1c] px-3 py-1 disabled:opacity-40"
              >
                Prev
              </button>
              <span>{current + 1} / {pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={current >= pages - 1}
                className="rounded-full border border-[#262b1c] px-3 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
