import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Play, Loader2, Trash2, ShieldAlert, Video } from "lucide-react";
import {
  inventorListRecordings,
  inventorGetSessionDetail,
  inventorSignRecordingUrls,
  inventorDeleteSessionRecordings,
  type RecordingRow,
  type SessionDetail,
} from "@/lib/recordings.functions";

export const Route = createFileRoute("/inventor/recordings")({
  component: RecordingsPage,
});

const fmtBytes = (b: number) => {
  if (!b) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(b) / Math.log(k)));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};
const fmtDur = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};
const fmtDate = (iso: string) => new Date(iso).toLocaleString();

function RecordingsPage() {
  const listFn = useServerFn(inventorListRecordings);
  const [sessions, setSessions] = useState<RecordingRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openSession, setOpenSession] = useState<RecordingRow | null>(null);

  const load = () => {
    listFn()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setErr(e?.message ?? "Failed to load recordings"));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (sessions ?? []).filter((s) =>
    !search ? true : (s.user_email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  if (err) return <div className="text-sm text-destructive">{err}</div>;
  if (!sessions)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading recordings…
      </div>
    );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Session Recordings</h2>
          <p className="text-xs text-muted-foreground">
            AI-output recordings, labelled by user email. Disclosed to users in Terms §5. Retention: 30 days.
          </p>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm w-full sm:w-72 focus:outline-none focus:border-primary"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <Video className="mx-auto h-8 w-8 mb-2 opacity-50" />
          No recordings yet.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Chunks</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => (
                <tr key={s.session_id ?? `row-${idx}`} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground truncate max-w-[260px]">{s.user_email ?? s.user_id ?? "unknown"}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{(s.session_id ?? "no-session").slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-foreground">{s.last_country ?? "—"}</span>
                      {s.is_vpn && (
                        <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">VPN</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(s.started_at)}</td>
                  <td className="px-4 py-3">{fmtDur(s.total_duration_seconds)}</td>
                  <td className="px-4 py-3">{s.chunk_count}</td>
                  <td className="px-4 py-3">{fmtBytes(s.total_bytes)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setOpenSession(s)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-secondary"
                    >
                      <Play className="h-3 w-3" /> Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openSession && (
        <SessionModal session={openSession} onClose={() => setOpenSession(null)} onDeleted={load} />
      )}
    </div>
  );
}

function SessionModal({
  session,
  onClose,
  onDeleted,
}: {
  session: RecordingRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const detailFn = useServerFn(inventorGetSessionDetail);
  const signFn = useServerFn(inventorSignRecordingUrls);
  const deleteFn = useServerFn(inventorDeleteSessionRecordings);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    detailFn({ data: { session_id: session.session_id } })
      .then(async (r) => {
        setDetail(r.detail);
        const paths = r.detail.chunks.map((c) => c.storage_path);
        if (paths.length) {
          const { urls: signed } = await signFn({ data: { paths, expires_in: 600 } });
          const map: Record<string, string> = {};
          signed.forEach((u) => {
            if (u.signedUrl) map[u.path] = u.signedUrl;
          });
          setUrls(map);
          setActive(paths[0] ?? null);
        }
      })
      .catch((e) => setErr(e?.message ?? "Failed to load session"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.session_id]);

  const handleDelete = async () => {
    if (!confirm("Delete all recordings for this session? This cannot be undone.")) return;
    setBusy(true);
    try {
      await deleteFn({ data: { session_id: session.session_id } });
      onDeleted();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{session.user_email ?? session.user_id}</h3>
            <p className="text-xs text-muted-foreground">
              Session {session.session_id.slice(0, 8)}… · {fmtDate(session.started_at)} · {fmtDur(session.total_duration_seconds)}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>

        {err && <div className="mt-4 text-sm text-destructive">{err}</div>}

        {!detail ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading session…
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
            <div>
              {active && urls[active] ? (
                <video
                  key={active}
                  src={urls[active]}
                  controls
                  autoPlay
                  className="w-full rounded-md border border-border bg-black aspect-video"
                />
              ) : (
                <div className="aspect-video rounded-md border border-border bg-black/40 grid place-items-center text-sm text-muted-foreground">
                  No recording chunks yet.
                </div>
              )}
              {detail.chunks.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {detail.chunks.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setActive(c.storage_path)}
                      className={`text-[11px] rounded border px-2 py-1 ${
                        active === c.storage_path
                          ? "border-primary text-primary bg-primary/10"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      #{c.chunk_index + 1} · {fmtDur(c.duration_seconds ?? 0)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <aside className="rounded-md border border-border bg-background/40 p-4">
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Style timeline</h4>
              {detail.events.length === 0 ? (
                <p className="text-xs text-muted-foreground">No prompt or style changes logged.</p>
              ) : (
                <ol className="space-y-3">
                  {detail.events.map((e) => (
                    <li key={e.id} className="text-xs">
                      <div className="flex items-center justify-between">
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {e.event_type.replace("_", " ")}
                        </span>
                        <span className="text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
                      </div>
                      {e.style && <div className="mt-1 text-foreground">Style: {e.style}</div>}
                      {e.mode && <div className="text-muted-foreground">Mode: {e.mode}{e.realism != null ? ` (${e.realism}/10)` : ""}</div>}
                      {e.image_name && <div className="text-muted-foreground truncate">Image: {e.image_name}</div>}
                      {e.prompt && (
                        <div className="mt-1 text-muted-foreground line-clamp-3">{e.prompt}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </aside>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={handleDelete}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete session recordings
          </button>
        </div>

        <p className="mt-4 flex items-start gap-2 text-[11px] text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Access to recordings is restricted to admins and audited. Use only for safety, fraud, and abuse review consistent with Terms §5 and applicable law.
        </p>
      </div>
    </div>
  );
}
