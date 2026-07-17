import { createFileRoute } from "@tanstack/react-router";
import { Fragment } from "react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, X } from "lucide-react";
import {
  inventorListUsers, inventorAdjustCredits, inventorBanUser, inventorUnbanUser, inventorDeleteUser,
  type InventorUser,
} from "@/lib/inventor.functions";
import { NUM, relativeTime, shortDate } from "@/lib/inventor-utils";

export const Route = createFileRoute("/inventor/users")({
  component: UsersPage,
});

type Tab = "all" | "zero" | "banned";

function UsersPage() {
  const listFn = useServerFn(inventorListUsers);
  const adjustFn = useServerFn(inventorAdjustCredits);
  const banFn = useServerFn(inventorBanUser);
  const unbanFn = useServerFn(inventorUnbanUser);
  const delFn = useServerFn(inventorDeleteUser);

  const [users, setUsers] = useState<InventorUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [openAdjust, setOpenAdjust] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventorUser | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await listFn({ data: { search: search.trim() || null } });
      setUsers(r.users);
    } catch (e) { setBanner({ kind: "err", msg: String((e as Error)?.message ?? e) }); }
  }, [listFn, search]);

  useEffect(() => {
    const t = setTimeout(() => { reload(); }, 250);
    return () => clearTimeout(t);
  }, [reload]);
  useEffect(() => {
    import("@/integrations/supabase/client").then(({ supabase }) =>
      supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)),
    );
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter((u) => {
      if (tab === "zero" && u.credits !== 0) return false;
      if (tab === "banned" && !u.banned) return false;
      if (s && !u.email.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [users, search, tab]);

  async function runAction(label: string, p: Promise<unknown>) {
    try { await p; setBanner({ kind: "ok", msg: `${label} succeeded.` }); await reload(); }
    catch (e) { setBanner({ kind: "err", msg: String((e as Error)?.message ?? e) }); }
  }

  return (
    <div className="space-y-4">
      {banner && (
        <div className={"flex items-center justify-between rounded-md border px-3 py-2 text-sm " + (banner.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-destructive/30 bg-destructive/10 text-destructive")}>
          <span>{banner.msg}</span>
          <button onClick={() => setBanner(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full rounded-md border border-border bg-card pl-8 pr-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {(["all", "zero", "banned"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={"rounded px-3 py-1 text-xs capitalize " + (tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t === "zero" ? "Zero Balance" : t}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2">Last active</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Joined</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No users.</td></tr>
            )}
            {filtered.map((u) => {
              const isSelf = me === u.id;
              return (
                <Fragment key={u.id}>
                  <tr className="border-t border-border/60">
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{NUM(u.credits)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{relativeTime(u.last_sign_in_at)}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <div className="flex flex-col leading-tight">
                        <span className="text-foreground flex items-center gap-1.5">
                          {u.last_country ?? "—"}
                          {u.is_vpn && (
                            <span title="IP belongs to a VPN, proxy, or hosting/datacenter — country may be spoofed"
                              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                              VPN
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] font-mono">{u.last_ip ?? "no ip"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <span className={"rounded-full px-2 py-0.5 text-[10px] " + (u.is_admin ? "border border-primary/30 bg-primary/10 text-primary" : "border border-border text-muted-foreground")}>
                          {u.is_admin ? "Admin" : "User"}
                        </span>
                        {u.banned && <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">Banned</span>}
                        {isSelf && <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px]">You</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{shortDate(u.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button onClick={() => setOpenAdjust(openAdjust === u.id ? null : u.id)}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-muted/40">
                          Adjust
                        </button>
                        {!isSelf && !u.is_admin && (u.banned
                          ? <button onClick={() => runAction("Unban", unbanFn({ data: { target_user_id: u.id } }))}
                              className="rounded border border-border px-2 py-1 text-xs hover:bg-muted/40">Unban</button>
                          : <button onClick={() => runAction("Ban", banFn({ data: { target_user_id: u.id } }))}
                              className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10">Ban</button>)}
                        {!isSelf && !u.is_admin && (
                          <button onClick={() => setDeleteTarget(u)}
                            className="rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">Delete</button>
                        )}
                        {u.is_admin && !isSelf && (
                          <span className="rounded border border-border px-2 py-1 text-xs text-muted-foreground">🔒 Protected</span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {openAdjust === u.id && (
                    <tr className="border-t border-border/60 bg-muted/20">
                      <td colSpan={7} className="px-3 py-3">
                        <AdjustPanel
                          user={u}
                          onClose={() => setOpenAdjust(null)}
                          onSubmit={async (delta, note) => {
                            await runAction("Credit adjustment", adjustFn({ data: { target_user_id: u.id, delta, note } }));
                            setOpenAdjust(null);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <DeleteModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const target = deleteTarget;
            setDeleteTarget(null);
            await runAction("Delete user", delFn({ data: { target_user_id: target.id } }));
          }}
        />
      )}
    </div>
  );
}

function AdjustPanel({ user, onClose, onSubmit }: { user: InventorUser; onClose: () => void; onSubmit: (delta: number, note: string) => Promise<void>; }) {
  const [delta, setDelta] = useState(0);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState<"edit" | "review">("edit");
  const [busy, setBusy] = useState(false);
  const newBalance = Math.max(0, user.credits + delta);
  const canReview = delta !== 0 && note.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">Adjust credits for <span className="text-foreground">{user.email}</span> (currently {NUM(user.credits)}).</div>
      <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
        <input type="number" value={delta} onChange={(e) => setDelta(parseInt(e.target.value || "0", 10))}
          disabled={stage === "review"}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm tabular-nums" placeholder="Delta (±)" />
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={stage === "review"}
          placeholder="Reason / note (required)"
          className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <div className="text-sm self-center text-muted-foreground">→ <span className="text-foreground tabular-nums">{NUM(newBalance)}</span></div>
      </div>
      <div className="flex gap-2">
        {stage === "edit" ? (
          <>
            <button disabled={!canReview} onClick={() => setStage("review")}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">Review</button>
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={async () => { setBusy(true); try { await onSubmit(delta, note); } finally { setBusy(false); } }}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {busy ? "Applying…" : "Confirm"}
            </button>
            <button disabled={busy} onClick={() => setStage("edit")} className="rounded-md border border-border px-3 py-1.5 text-sm">Back</button>
          </>
        )}
      </div>
    </div>
  );
}

function DeleteModal({ user, onClose, onConfirm }: { user: InventorUser; onClose: () => void; onConfirm: () => void | Promise<void>; }) {
  const [typed, setTyped] = useState("");
  const ok = typed === user.email;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold">Delete user</h3>
        <p className="mt-1 text-sm text-muted-foreground">This permanently deletes <span className="text-foreground">{user.email}</span> and all their data. Type their email to confirm.</p>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={user.email}
          className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={!ok} onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-50">Delete permanently</button>
        </div>
      </div>
    </div>
  );
}
