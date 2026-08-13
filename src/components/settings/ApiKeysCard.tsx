import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Copy, Check } from "lucide-react";
import { createApiKey, listMyApiKeys, revokeApiKey } from "@/lib/api-keys.functions";

type KeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const card: React.CSSProperties = {
  background: "#14170f",
  border: "1px solid #262b1c",
  borderRadius: 16,
  padding: 20,
};

const cardTitle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".12em",
  fontWeight: 600,
  color: "#9aa08c",
};

const limeBtn: React.CSSProperties = {
  background: "#c6f24e",
  color: "#111406",
  fontWeight: 700,
  fontSize: 13,
  borderRadius: 12,
  padding: "9px 14px",
  boxShadow: "0 6px 24px -6px rgba(198,242,78,.25)",
  transition: "all 150ms",
};

const ghostBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #262b1c",
  color: "#9aa08c",
  fontSize: 13,
  borderRadius: 12,
  padding: "9px 14px",
  transition: "all 150ms",
};

const inputStyle: React.CSSProperties = {
  background: "#101309",
  border: "1px solid #262b1c",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  color: "#f2f4ec",
  width: "100%",
  outline: "none",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function relative(iso: string | null) {
  if (!iso) return "Never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export default function ApiKeysCard() {
  const list = useServerFn(listMyApiKeys);
  const create = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);

  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<KeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = (await list({ data: undefined } as never)) as KeyRow[];
      setRows(data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = (await create({ data: { name: name.trim() } })) as { key: string };
      setNewKey(res.key);
      void refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(
        /10 active API keys/i.test(msg)
          ? "You can have at most 10 active API keys. Revoke one first."
          : "Something went wrong. Try again.",
      );
    } finally {
      setCreating(false);
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setName("");
    setNewKey(null);
    setError(null);
    setCopied(false);
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revoke({ data: { key_id: revokeTarget.id } });
      setRows((r) =>
        r.map((k) => (k.id === revokeTarget.id ? { ...k, revoked_at: new Date().toISOString() } : k)),
      );
      setRevokeTarget(null);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <section style={card} className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div style={cardTitle}>API keys</div>
          <p className="mt-2 max-w-xl text-[14px]" style={{ color: "#9aa08c" }}>
            Use API keys to control Lumify from your own code. Requests are billed from your credit wallet.
          </p>
        </div>
        <button style={limeBtn} onClick={() => setCreateOpen(true)}>
          + Create key
        </button>
      </div>

      <div className="mt-5">
        {loading ? (
          <p className="py-6 text-[13px]" style={{ color: "#6b7160" }}>Loading…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2" style={{ padding: "40px 0" }}>
            <div
              className="flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(198,242,78,.12)" }}
            >
              <KeyRound size={18} color="#c6f24e" />
            </div>
            <div className="text-[14px]" style={{ color: "#9aa08c" }}>No API keys yet</div>
            <div className="text-[13px]" style={{ color: "#6b7160" }}>
              Create a key to use Lumify from your own code.
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    {["Name", "Key", "Created", "Last used", "Status", ""].map((h) => (
                      <th
                        key={h}
                        style={{
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: ".08em",
                          color: "#6b7160",
                          fontWeight: 600,
                          padding: "0 0 10px",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((k) => (
                    <tr
                      key={k.id}
                      style={{ borderTop: "1px solid #1e2316", opacity: k.revoked_at ? 0.55 : 1, height: 44 }}
                    >
                      <td className="text-[13.5px]" style={{ color: "#f2f4ec" }}>{k.name}</td>
                      <td className="font-mono text-[12px]" style={{ color: "#9aa08c" }}>
                        {k.key_prefix}••••••••
                      </td>
                      <td className="text-[13px]" style={{ color: "#9aa08c" }}>{fmtDate(k.created_at)}</td>
                      <td className="text-[13px]" style={{ color: "#9aa08c" }}>{relative(k.last_used_at)}</td>
                      <td><StatusPill revoked={!!k.revoked_at} /></td>
                      <td className="text-right">
                        {!k.revoked_at && (
                          <button
                            onClick={() => setRevokeTarget(k)}
                            style={{
                              background: "transparent",
                              border: "1px solid rgba(255,122,107,.3)",
                              color: "#ff7a6b",
                              borderRadius: 10,
                              fontSize: 13,
                              padding: "5px 12px",
                              transition: "all 150ms",
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked */}
            <div className="md:hidden">
              {rows.map((k) => (
                <div
                  key={k.id}
                  style={{ borderTop: "1px solid #1e2316", opacity: k.revoked_at ? 0.55 : 1, padding: "12px 0" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px]" style={{ color: "#f2f4ec" }}>{k.name}</div>
                      <div className="truncate font-mono text-[12px]" style={{ color: "#9aa08c" }}>
                        {k.key_prefix}••••••••
                      </div>
                    </div>
                    <StatusPill revoked={!!k.revoked_at} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-[12.5px]" style={{ color: "#6b7160" }}>
                    <span>{fmtDate(k.created_at)} · {relative(k.last_used_at)}</span>
                    {!k.revoked_at && (
                      <button
                        onClick={() => setRevokeTarget(k)}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(255,122,107,.3)",
                          color: "#ff7a6b",
                          borderRadius: 10,
                          fontSize: 13,
                          padding: "5px 12px",
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {createOpen && (
        <Modal onClose={closeCreate} maxWidth={440}>
          {!newKey ? (
            <>
              <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 400, color: "#f2f4ec" }}>
                Create API key
              </h2>
              <label className="mt-4 block" style={cardTitle}>Key name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCreate()}
                placeholder="e.g. Production bot"
                className="mt-2 focus:border-[#c6f24e]"
                style={inputStyle}
              />
              {error && <p className="mt-2 text-[13px]" style={{ color: "#ff7a6b" }}>{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button style={ghostBtn} onClick={closeCreate}>Cancel</button>
                <button
                  style={{ ...limeBtn, opacity: !name.trim() || creating ? 0.6 : 1 }}
                  disabled={!name.trim() || creating}
                  onClick={submitCreate}
                >
                  {creating ? "Creating…" : "Create key"}
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 400, color: "#f2f4ec" }}>
                Copy your key
              </h2>
              <div
                className="mt-4 flex items-start gap-2"
                style={{ background: "#101309", border: "1px solid #262b1c", borderRadius: 10, padding: 12 }}
              >
                <code className="flex-1 font-mono text-[13px]" style={{ color: "#f2f4ec", wordBreak: "break-all" }}>
                  {newKey}
                </code>
                <button
                  style={{ ...limeBtn, padding: "6px 10px", fontSize: 12 }}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(newKey);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch { /* ignore */ }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copied ✓" : "Copy"}
                  </span>
                </button>
              </div>
              <div
                className="mt-3 text-[13px]"
                style={{
                  background: "rgba(255,210,138,.1)",
                  border: "1px solid rgba(255,210,138,.3)",
                  borderRadius: 10,
                  padding: 12,
                  color: "#ffd28a",
                }}
              >
                ⚠ Copy this key now — for your security, it won't be shown again.
              </div>
              <div className="mt-5 flex justify-end">
                <button style={ghostBtn} onClick={() => { closeCreate(); void refresh(); }}>Done</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {revokeTarget && (
        <Modal onClose={() => !revoking && setRevokeTarget(null)} maxWidth={380}>
          <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 400, color: "#f2f4ec" }}>
            Revoke this key?
          </h2>
          <p className="mt-3 text-[14px]" style={{ color: "#9aa08c" }}>
            Any integration using ‘{revokeTarget.name}’ will stop working immediately. This can't be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button style={ghostBtn} disabled={revoking} onClick={() => setRevokeTarget(null)}>Cancel</button>
            <button
              disabled={revoking}
              onClick={confirmRevoke}
              style={{
                background: "rgba(255,122,107,.15)",
                border: "1px solid rgba(255,122,107,.4)",
                color: "#ff7a6b",
                fontWeight: 700,
                borderRadius: 12,
                padding: "9px 14px",
                fontSize: 13,
                opacity: revoking ? 0.6 : 1,
              }}
            >
              {revoking ? "Revoking…" : "Revoke key"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function StatusPill({ revoked }: { revoked: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        padding: "3px 9px",
        color: revoked ? "#ff7a6b" : "#c6f24e",
        background: revoked ? "rgba(255,122,107,.12)" : "rgba(198,242,78,.12)",
      }}
    >
      {revoked ? "REVOKED" : "ACTIVE"}
    </span>
  );
}

function Modal({ children, onClose, maxWidth }: { children: React.ReactNode; onClose: () => void; maxWidth: number }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 lumify-modal-overlay"
      style={{ background: "rgba(5,6,4,.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full lumify-modal-card"
        style={{ maxWidth, background: "#14170f", border: "1px solid #262b1c", borderRadius: 16, padding: 24 }}
      >
        {children}
      </div>
      <style>{`
        @keyframes lumifyModalIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .lumify-modal-card { animation: lumifyModalIn 150ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .lumify-modal-card { animation: none; } }
      `}</style>
    </div>
  );
}
