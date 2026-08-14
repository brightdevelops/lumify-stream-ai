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

type Product = "voice" | "face";

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

const divider: React.CSSProperties = {
  height: 1,
  background: "#1e2316",
  margin: "16px 0",
};

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtAgo(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
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
  const del = useServerFn(deleteApiKey);

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rawKey, setRawKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    setModalProduct(null);
    setRawKey(null);
    setName("");
    setError(null);
    void refresh();
  };

  const onCreate = async () => {
    if (!name.trim() || !modalProduct) return;
    setCreating(true);
    setError(null);
    try {
      const res = (await create({ data: { name: name.trim(), product: modalProduct } })) as { key: string };
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

  const onDelete = async (id: string) => {
    setDeleteId(null);
    try {
      await del({ data: { key_id: id } });
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setToast("Key deleted");
      window.setTimeout(() => setToast(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete key.");
    }
  };

  const createBtn = (product: Product) => (
    <button
      className="lime-btn"
      onClick={() => setModalProduct(product)}
      style={{
        width: "100%",
        background: "#c6f24e",
        color: "#111406",
        fontWeight: 700,
        fontSize: 13,
        height: 40,
        borderRadius: 12,
        boxShadow: "0 6px 24px -6px rgba(198,242,78,.25)",
        transition: "all 150ms",
      }}
    >
      + Create key
    </button>
  );

  const keyRow = (k: KeyRow) => {
    const revoked = !!k.revoked_at;
    return (
      <div
        key={k.id}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 52,
          padding: "10px 0",
          borderBottom: "1px solid #1e2316",
          opacity: revoked ? 0.55 : 1,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14, color: "#f2f4ec" }}>{k.name}</span>
            <span
              style={{
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: 999,
                background: revoked ? "rgba(255,122,107,.12)" : "rgba(198,242,78,.12)",
                color: revoked ? "#ff7a6b" : "#c6f24e",
              }}
            >
              {revoked ? "Revoked" : "Active"}
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7160", display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "#9aa08c" }}>{k.key_prefix}••••••••</span>
            <span>· created {fmtDate(k.created_at)}</span>
            <span>· last used {fmtAgo(k.last_used_at)}</span>
          </div>
        </div>
        {revoked ? (
          <button
            onClick={() => setDeleteId(k.id)}
            style={{
              flexShrink: 0,
              fontSize: 12,
              color: "#ff7a6b",
              background: "transparent",
              border: "1px solid rgba(255,122,107,.3)",
              borderRadius: 10,
              padding: "6px 12px",
              transition: "all 150ms",
            }}
          >
            Delete
          </button>
        ) : (
          <button
            onClick={() => setConfirmId(k.id)}
            style={{
              flexShrink: 0,
              fontSize: 12,
              color: "#ff7a6b",
              background: "transparent",
              border: "1px solid rgba(255,122,107,.3)",
              borderRadius: 10,
              padding: "6px 12px",
              transition: "all 150ms",
            }}
          >
            Revoke
          </button>
        )}
      </div>
    );
  };

  const emptyState = (product: Product) => (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: "rgba(198,242,78,.12)",
          display: "grid",
          placeItems: "center",
          margin: "0 auto 12px",
        }}
      >
        <KeyRound size={18} color="#c6f24e" />
      </div>
      <div style={{ fontSize: 14, color: "#9aa08c" }}>
        {product === "voice" ? "No voice keys yet" : "No Body Swap keys yet"}
      </div>
      <div style={{ fontSize: 13, color: "#6b7160", marginTop: 6 }}>
        {product === "voice"
          ? "Create a key to start building with Lumify Voice."
          : "Create a key now — it activates at launch."}
      </div>
    </div>
  );

  const codeRow = (snippet: string) => (
    <div key={snippet} style={{ position: "relative", marginBottom: 10 }}>
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <CopyButton text={snippet} />
      </div>
      <pre
        style={{
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          background: "#101309",
          border: "1px solid #262b1c",
          borderRadius: 10,
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
  );

  const voiceKeys = keys.filter((k) => (k.scopes ?? []).includes("voice"));
  const faceKeys = keys.filter((k) => (k.scopes ?? []).includes("face"));

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 28px", color: "#f2f4ec" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 400 }}>API keys</h1>
        <p style={{ fontSize: 13, color: "#6b7160", marginTop: 6 }}>
          One key per product — voice keys don't work on Body Swap, and vice versa.
        </p>
      </header>

      {error && <p style={{ fontSize: 12, color: "#ff7a6b", marginBottom: 12 }}>{error}</p>}

      <div className="api-columns" style={{ display: "grid", gap: 20, alignItems: "stretch" }}>
        {/* LUMIFY VOICE */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={cardTitle}>Lumify Voice</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
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
          <p style={{ fontSize: 14, color: "#9aa08c", marginTop: 10 }}>
            Text to speech with any Lumify voice — yours or cloned. 1 credit per 10 characters.
          </p>
          <p style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#6b7160", marginTop: 8 }}>
            Scope: voice
          </p>

          <div style={divider} />

          <span style={cardTitle}>Your keys</span>
          <div style={{ marginTop: 8 }}>
            {loading ? (
              <p style={{ fontSize: 12.5, color: "#6b7160", padding: "16px 0" }}>Loading…</p>
            ) : voiceKeys.length === 0 ? (
              emptyState("voice")
            ) : (
              voiceKeys.map(keyRow)
            )}
          </div>
          <div style={{ marginTop: 16 }}>{createBtn("voice")}</div>

          <div style={divider} />

          <span style={cardTitle}>Quick start</span>
          <div style={{ marginTop: 10 }}>
            {codeRow(CURL_VOICES)}
            {codeRow(CURL_SPEECH)}
          </div>
        </div>

        {/* AI BODY SWAP */}
        <div style={{ ...card, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={cardTitle}>AI Body Swap</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                background: "rgba(255,210,138,.1)",
                color: "#ffd28a",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              Coming soon
            </span>
          </div>
          <p style={{ fontSize: 14, color: "#9aa08c", marginTop: 10 }}>
            Swap bodies in real time from your own code. Keys you create now start working the day the API goes live.
          </p>
          <p style={{ fontSize: 12, fontFamily: "ui-monospace, monospace", color: "#6b7160", marginTop: 8 }}>
            Scope: face
          </p>

          <div style={divider} />

          <span style={cardTitle}>Your keys</span>
          <div style={{ marginTop: 8 }}>
            {loading ? (
              <p style={{ fontSize: 12.5, color: "#6b7160", padding: "16px 0" }}>Loading…</p>
            ) : faceKeys.length === 0 ? (
              emptyState("face")
            ) : (
              faceKeys.map(keyRow)
            )}
          </div>
          <div style={{ marginTop: 16 }}>{createBtn("face")}</div>
          <p style={{ fontSize: 12, color: "#6b7160", textAlign: "center", marginTop: 8 }}>
            Won't work until Body Swap launches. You won't be charged before then.
          </p>

          <div style={divider} />

          <span style={cardTitle}>Quick start</span>
          <div style={{ marginTop: 10 }}>
            <div
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                background: "#101309",
                border: "1px solid #262b1c",
                borderRadius: 10,
                padding: 14,
                color: "#6b7160",
              }}
            >
              Body Swap API docs land here at launch.
            </div>
          </div>
        </div>
      </div>

      {/* CREATE MODAL */}
      {modalProduct && (
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 400 }}>
                  {rawKey
                    ? "Your new key"
                    : modalProduct === "voice"
                      ? "Create Voice key"
                      : "Create Body Swap key"}
                </h2>
                {!rawKey && (
                  <p style={{ fontSize: 13, color: "#6b7160", marginTop: 6 }}>
                    {modalProduct === "voice"
                      ? "Scope: voice — works only on the Voice API."
                      : "Scope: face — activates when Body Swap launches."}
                  </p>
                )}
              </div>
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
                  placeholder={modalProduct === "voice" ? "e.g. My voice bot" : "e.g. My swap app"}
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

      {/* DELETE CONFIRM */}
      {deleteId && (
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
          onClick={() => setDeleteId(null)}
        >
          <div style={{ ...card, width: 420, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
            <span style={cardTitle}>Delete this key permanently?</span>
            <p style={{ fontSize: 13, color: "#9aa08c", marginTop: 10 }}>
              This removes the key from your list forever. Its usage history stays in your billing records.
            </p>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setDeleteId(null)}
                style={{ fontSize: 12.5, color: "#9aa08c", border: "1px solid #262b1c", borderRadius: 8, padding: "8px 14px" }}
              >
                Cancel
              </button>
              <button
                onClick={() => void onDelete(deleteId)}
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
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#14170f",
            border: "1px solid #262b1c",
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 12.5,
            color: "#f2f4ec",
            zIndex: 70,
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        .api-columns { grid-template-columns: 1fr; }
        @media (min-width: 1100px) { .api-columns { grid-template-columns: 1fr 1fr; } }
        .lime-btn:hover { background: #d4fa66 !important; }
        @media (prefers-reduced-motion: reduce) { .api-columns * { transition: none !important; } }
      `}</style>
    </div>
  );
}
