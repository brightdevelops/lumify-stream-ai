import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Copy, Check, X } from "lucide-react";
import { createApiKey, listMyApiKeys, revokeApiKey, deleteApiKey } from "@/lib/api-keys.functions";

export const Route = createFileRoute("/_app/api-keys")({
  head: () => ({
    meta: [
      { title: "API keys · Lumify" },
      { name: "description", content: "Create and manage Lumify API keys to control Lumify Voice from your own code." },
      { property: "og:title", content: "API keys · Lumify" },
      { property: "og:description", content: "Create and manage Lumify API keys for the Lumify Voice API." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ApiKeysPage,
});

const API_BASE = "https://lumifylive.com/api/public/api-v1";

const CURL_VOICES = `curl ${API_BASE}/v1/voices \\
  -H "Authorization: Bearer lumify_live_..."`;

const CURL_SPEECH = `curl ${API_BASE}/v1/voice/speech \\
  -X POST -H "Authorization: Bearer lumify_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Hello from Lumify","voice_id":"<voice-id>","format":"mp3"}' \\
  --output speech.mp3`;

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
  color: "#9aa08c",
};

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function CopyButton({ text, label = "Copy", lime = false }: { text: string; label?: string; lime?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1400);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 10px",
        borderRadius: 8,
        fontSize: 11.5,
        fontWeight: lime ? 700 : 500,
        transition: "all 150ms",
        background: lime ? "#c6f24e" : "transparent",
        color: lime ? "#111406" : "#9aa08c",
        border: lime ? "1px solid #c6f24e" : "1px solid #262b1c",
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "Copied ✓" : label}
    </button>
  );
}

function ApiKeysPage() {
  const list = useServerFn(listMyApiKeys);
  const create = useServerFn(createApiKey);
  const revoke = useServerFn(revokeApiKey);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = (await list({ data: {} } as never)) as KeyRow[];
      setKeys(rows ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const closeModal = () => {
    setModalOpen(false);
    setRawKey(null);
    setName("");
    setError(null);
    void refresh();
  };

  const onCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = (await create({ data: { name: name.trim() } })) as { key: string };
      setRawKey(res.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create key.");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    setConfirmId(null);
    try {
      await revoke({ data: { key_id: id } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke key.");
    }
  };

  const createBtn = (
    <button
      onClick={() => setModalOpen(true)}
      style={{
        background: "#c6f24e",
        color: "#111406",
        fontWeight: 700,
        fontSize: 13,
        height: 40,
        padding: "0 16px",
        borderRadius: 12,
        boxShadow: "0 6px 24px -6px rgba(198,242,78,.25)",
        transition: "all 150ms",
      }}
    >
      + Create key
    </button>
  );

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", color: "#f2f4ec" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400 }}>API keys</h1>
        <p style={{ fontSize: 13, color: "#6b7160", marginTop: 6 }}>
          Control Lumify from your own code. Requests are billed from your credit wallet.
        </p>
      </header>

      {/* PRODUCTS */}
      <div className="api-products" style={{ display: "grid", gap: 16, marginBottom: 16 }}>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={cardTitle}>Lumify Voice</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                textTransform: "uppercase",
                background: "rgba(198,242,78,.12)",
                color: "#c6f24e",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              Live
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#9aa08c", marginTop: 10 }}>
            Text to speech with any Lumify voice — yours or cloned. 1 credit per 10 characters.
          </p>
          <p style={{ fontSize: 11, color: "#6b7160", marginTop: 8 }}>Scope: voice</p>
        </div>

        <div style={{ ...card, opacity: 0.65 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={cardTitle}>AI Body Swap</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                textTransform: "uppercase",
                background: "#101309",
                color: "#6b7160",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              Coming soon
            </span>
          </div>
          <p style={{ fontSize: 13, color: "#6b7160", marginTop: 10 }}>
            Swap bodies in real time from your own code. Not yet available.
          </p>
        </div>
      </div>

      {/* YOUR KEYS */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={cardTitle}>Your keys</span>
          {keys.length > 0 && createBtn}
        </div>

        {error && <p style={{ fontSize: 12, color: "#ff7a6b", marginTop: 10 }}>{error}</p>}

        {loading ? (
          <p style={{ fontSize: 12.5, color: "#6b7160", marginTop: 16 }}>Loading…</p>
        ) : keys.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0" }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "rgba(198,242,78,.12)",
                display: "grid",
                placeItems: "center",
                margin: "0 auto 12px",
              }}
            >
              <KeyRound size={22} color="#c6f24e" />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No API keys yet</div>
            <div style={{ fontSize: 12.5, color: "#6b7160", margin: "6px 0 16px" }}>
              Create a key to start building with Lumify Voice
            </div>
            {createBtn}
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  {["Name", "Key", "Created", "Last used", "Status", ""].map((h) => (
                    <th
                      key={h}
                      style={{
                        ...cardTitle,
                        textAlign: "left",
                        padding: "8px 8px",
                        borderBottom: "1px solid #1e2316",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const revoked = !!k.revoked_at;
                  return (
                    <tr key={k.id} style={{ opacity: revoked ? 0.5 : 1 }}>
                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #1e2316", fontSize: 13, color: "#f2f4ec" }}>
                        {k.name}
                      </td>
                      <td
                        style={{
                          padding: "12px 8px",
                          borderBottom: "1px solid #1e2316",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 12,
                          color: "#9aa08c",
                        }}
                      >
                        {k.key_prefix}••••
                      </td>
                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #1e2316", fontSize: 12.5, color: "#9aa08c" }}>
                        {fmtDate(k.created_at)}
                      </td>
                      <td
                        style={{
                          padding: "12px 8px",
                          borderBottom: "1px solid #1e2316",
                          fontSize: 12.5,
                          color: k.last_used_at ? "#9aa08c" : "#6b7160",
                        }}
                      >
                        {fmtDate(k.last_used_at) ?? "Never"}
                      </td>
                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #1e2316" }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: "ui-monospace, monospace",
                            textTransform: "uppercase",
                            padding: "3px 8px",
                            borderRadius: 999,
                            background: revoked ? "rgba(255,122,107,.12)" : "rgba(198,242,78,.12)",
                            color: revoked ? "#ff7a6b" : "#c6f24e",
                          }}
                        >
                          {revoked ? "Revoked" : "Active"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 8px", borderBottom: "1px solid #1e2316", textAlign: "right" }}>
                        {!revoked && (
                          <button
                            onClick={() => setConfirmId(k.id)}
                            style={{
                              fontSize: 12,
                              color: "#ff7a6b",
                              border: "1px solid rgba(255,122,107,.3)",
                              borderRadius: 8,
                              padding: "5px 10px",
                              transition: "all 150ms",
                            }}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QUICK START */}
      <div style={card}>
        <span style={cardTitle}>Quick start</span>
        <p style={{ fontSize: 13, color: "#9aa08c", margin: "10px 0 14px" }}>
          Authenticate with a Bearer header. Find voice IDs with the voices endpoint, then generate speech.
        </p>
        {[CURL_VOICES, CURL_SPEECH].map((snippet) => (
          <div key={snippet} style={{ position: "relative", marginBottom: 12 }}>
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              <CopyButton text={snippet} />
            </div>
            <pre
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                background: "#101309",
                border: "1px solid #262b1c",
                borderRadius: 12,
                padding: 14,
                paddingRight: 84,
                overflowX: "auto",
                color: "#9aa08c",
                margin: 0,
              }}
            >
              {snippet}
            </pre>
          </div>
        ))}
        <p style={{ fontSize: 12, color: "#6b7160" }}>
          Pricing: 1 credit per 10 characters (minimum 10 credits per request) · 1,000 characters ≈ 100 credits.
        </p>
      </div>

      {/* CREATE MODAL */}
      {modalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={closeModal}
        >
          <div style={{ ...card, width: 420, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={cardTitle}>{rawKey ? "Your new key" : "Create key"}</span>
              <button onClick={closeModal} style={{ color: "#6b7160" }} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {rawKey ? (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    background: "#101309",
                    border: "1px solid #262b1c",
                    borderRadius: 10,
                    padding: 12,
                    wordBreak: "break-all",
                    userSelect: "all",
                    color: "#f2f4ec",
                  }}
                >
                  {rawKey}
                </div>
                <div style={{ marginTop: 10 }}>
                  <CopyButton text={rawKey} lime />
                </div>
                <div
                  style={{
                    marginTop: 12,
                    background: "rgba(255,210,138,.1)",
                    color: "#ffd28a",
                    fontSize: 12,
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  ⚠ Copy this key now — for your security, it won't be shown again.
                </div>
                <div style={{ marginTop: 14, textAlign: "right" }}>
                  <button
                    onClick={closeModal}
                    style={{ fontSize: 12.5, color: "#9aa08c", border: "1px solid #262b1c", borderRadius: 8, padding: "8px 14px" }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <label style={{ ...cardTitle, display: "block", marginBottom: 6 }}>Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. My voice bot"
                  style={{
                    width: "100%",
                    height: 40,
                    background: "#101309",
                    border: "1px solid #262b1c",
                    borderRadius: 10,
                    padding: "0 12px",
                    fontSize: 13,
                    color: "#f2f4ec",
                  }}
                />
                <div style={{ ...cardTitle, marginTop: 16, marginBottom: 8 }}>Products</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#f2f4ec" }}>
                  <input type="checkbox" checked readOnly style={{ accentColor: "#c6f24e" }} />
                  Lumify Voice — text to speech
                </label>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#6b7160", marginTop: 8 }}
                >
                  <input type="checkbox" disabled />
                  AI Body Swap — coming soon
                </label>

                {error && <p style={{ fontSize: 12, color: "#ff7a6b", marginTop: 10 }}>{error}</p>}

                <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={closeModal}
                    style={{ fontSize: 12.5, color: "#9aa08c", border: "1px solid #262b1c", borderRadius: 8, padding: "8px 14px" }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void onCreate()}
                    disabled={!name.trim() || creating}
                    style={{
                      background: "#c6f24e",
                      color: "#111406",
                      fontWeight: 700,
                      fontSize: 12.5,
                      borderRadius: 12,
                      padding: "9px 16px",
                      opacity: !name.trim() || creating ? 0.5 : 1,
                    }}
                  >
                    {creating ? "Creating…" : "Create key"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* REVOKE CONFIRM */}
      {confirmId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            display: "grid",
            placeItems: "center",
            zIndex: 60,
            padding: 16,
          }}
          onClick={() => setConfirmId(null)}
        >
          <div style={{ ...card, width: 420, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
            <span style={cardTitle}>Revoke key</span>
            <p style={{ fontSize: 13, color: "#9aa08c", marginTop: 10 }}>
              Revoke this key? Any integration using it stops working immediately.
            </p>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirmId(null)}
                style={{ fontSize: 12.5, color: "#9aa08c", border: "1px solid #262b1c", borderRadius: 8, padding: "8px 14px" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void onRevoke(confirmId)}
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "#ff7a6b",
                  background: "rgba(255,122,107,.12)",
                  border: "1px solid rgba(255,122,107,.3)",
                  borderRadius: 8,
                  padding: "8px 14px",
                }}
              >
                Revoke key
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .api-products { grid-template-columns: 1fr; }
        @media (min-width: 720px) { .api-products { grid-template-columns: 1fr 1fr; } }
      `}</style>
    </div>
  );
}
