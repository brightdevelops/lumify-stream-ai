import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAutoReplyConfig,
  setAutoReplyEnabled,
  upsertAutoReplyRule,
  deleteAutoReplyRule,
} from "@/lib/support-autoreply.functions";
import {
  Inbox,
  MessageCircle,
  Mail,
  Send,
  User as UserIcon,
  Coins,
  Trash2,
  ArrowLeft,
  Zap,
  Pencil,
  Plus,
  X,
  Bot,
  Settings,
} from "lucide-react";


type Conv = {
  id: string;
  user_id: string;
  user_email: string | null;
  full_name: string | null;
  type: "chat" | "contact";
  subject: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread_for_admin: number;
  credit_balance: number;
  created_at: string;
};

type Msg = {
  id: string;
  message: string;
  sender: "user" | "admin";
  is_auto_reply?: boolean;
  created_at: string;
};

type Rule = { id: string; triggers: string[]; response: string; sort_order: number };


export const Route = createFileRoute("/inventor/support")({
  component: SupportInbox,
});

const DEFAULT_QUICK_REPLIES = [
  "Hi! Looking into this now — I'll get back to you shortly.",
  "Thanks for reaching out. Could you share a screenshot or the exact error message?",
  "This should be fixed now — please refresh and try again.",
  "Can you confirm the email address on your account?",
  "Apologies for the delay! Investigating this now.",
];

const QR_STORAGE_KEY = "lumify_admin_quick_replies";

function loadQuickReplies(): string[] {
  if (typeof window === "undefined") return DEFAULT_QUICK_REPLIES;
  try {
    const raw = localStorage.getItem(QR_STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_REPLIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {}
  return DEFAULT_QUICK_REPLIES;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function SupportInbox() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>(() => loadQuickReplies());
  const [editingQR, setEditingQR] = useState(false);
  const [newQR, setNewQR] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Auto-reply admin config
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [showAutoPanel, setShowAutoPanel] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<{ id?: string; triggers: string; response: string } | null>(null);

  const loadAutoConfig = async () => {
    try {
      const cfg = await getAutoReplyConfig();
      setAutoEnabled(cfg.enabled);
      setRules(cfg.rules);
    } catch (e: any) {
      // non-admin will hit forbidden; ignore
      console.warn("autoreply config load", e?.message ?? e);
    }
  };
  useEffect(() => {
    loadAutoConfig();
  }, []);

  async function toggleAuto() {
    const next = !autoEnabled;
    setAutoEnabled(next);
    try {
      await setAutoReplyEnabled({ data: { enabled: next } });
    } catch (e: any) {
      setAutoEnabled(!next);
      setErr(e?.message ?? String(e));
    }
  }

  async function saveRule() {
    if (!ruleDraft) return;
    const triggers = ruleDraft.triggers.split(",").map((s) => s.trim()).filter(Boolean);
    if (!triggers.length || !ruleDraft.response.trim()) return;
    try {
      await upsertAutoReplyRule({
        data: { id: ruleDraft.id, triggers, response: ruleDraft.response.trim() },
      });
      setRuleDraft(null);
      await loadAutoConfig();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function removeRule(id: string) {
    if (!window.confirm("Delete this auto-reply rule?")) return;
    try {
      await deleteAutoReplyRule({ data: { id } });
      await loadAutoConfig();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }


  const loadConvs = async () => {
    const { data, error } = await supabase.rpc("admin_list_support_conversations", { p_limit: 300 });
    if (error) setErr(error.message);
    else setConvs((data as Conv[]) ?? []);
  };

  useEffect(() => {
    loadConvs();
    const ch = supabase
      .channel("support-admin-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_conversations" }, () => loadConvs())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, () => loadConvs())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    supabase
      .from("support_messages")
      .select("id, message, sender, created_at")
      .eq("conversation_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data as Msg[]);
      });
    supabase.rpc("admin_mark_conversation_read", { p_conversation_id: selected.id });

    const ch = supabase
      .channel(`support-admin-thread-${selected.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${selected.id}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (m.sender === "user") {
            supabase.rpc("admin_mark_conversation_read", { p_conversation_id: selected.id });
          }
        }
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [selected]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages]);

  function persistQR(next: string[]) {
    setQuickReplies(next);
    try {
      localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  async function sendReply(overrideBody?: string) {
    const body = (overrideBody ?? reply).trim();
    if (!selected || !body || sending) return;
    setSending(true);
    if (!overrideBody) setReply("");
    try {
      const { error } = await supabase.from("support_messages").insert({
        conversation_id: selected.id,
        user_id: selected.user_id,
        user_email: selected.user_email,
        type: selected.type,
        subject: selected.subject,
        message: body,
        sender: "admin",
      });
      if (error) throw error;
      await supabase.rpc("admin_mark_conversation_read", { p_conversation_id: selected.id });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      if (!overrideBody) setReply(body);
    } finally {
      setSending(false);
    }
  }

  async function closeConversation() {
    if (!selected) return;
    const ok = window.confirm(
      `Close and wipe the conversation with ${selected.user_email ?? selected.user_id}? All messages will be permanently deleted.`
    );
    if (!ok) return;
    try {
      const { error } = await supabase.rpc("admin_close_support_conversation", {
        p_conversation_id: selected.id,
      });
      if (error) throw error;
      setConvs((prev) => prev.filter((c) => c.id !== selected.id));
      setMessages([]);
      setSelected(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  const totalUnread = useMemo(
    () => convs.reduce((s, c) => s + (c.unread_for_admin || 0), 0),
    [convs]
  );

  return (
    <div className="space-y-4">
      {/* Header — hidden on mobile when a thread is open so it doesn't crowd */}
      <div className={`flex items-center justify-between ${selected ? "hidden lg:flex" : ""}`}>
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Support Inbox</h2>
          {totalUnread > 0 && (
            <span className="rounded-full bg-destructive text-destructive-foreground text-xs px-2 py-0.5 font-medium">
              {totalUnread} unread
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{convs.length} conversations</span>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 min-h-[70vh]">
        {/* List — hidden on mobile when a thread is selected */}
        <div
          className={`rounded-lg border border-border bg-card overflow-hidden flex flex-col ${
            selected ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="overflow-y-auto divide-y divide-border">
            {convs.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No messages yet.</div>
            )}
            {convs.map((c) => {
              const active = selected?.id === c.id;
              const isUnread = c.unread_for_admin > 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelected(c)}
                  className={`w-full text-left px-4 py-4 transition min-h-[64px] ${
                    active ? "bg-primary/10" : "hover:bg-secondary/40 active:bg-secondary/60"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {c.type === "chat" ? (
                      <MessageCircle className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Mail className="h-4 w-4 text-primary shrink-0" />
                    )}
                    <span className={`text-sm truncate ${isUnread ? "font-semibold" : ""}`}>
                      {c.user_email ?? c.user_id.slice(0, 8)}
                    </span>
                    {isUnread && (
                      <span className="ml-auto rounded-full bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5 font-medium">
                        {c.unread_for_admin}
                      </span>
                    )}
                  </div>
                  {c.subject && (
                    <div className="text-xs text-foreground/80 truncate mb-0.5">{c.subject}</div>
                  )}
                  <div className="text-sm text-muted-foreground truncate">
                    {c.last_message_preview ?? "—"}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {relativeTime(c.last_message_at)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread — full width on mobile when selected */}
        <div
          className={`rounded-lg border border-border bg-card flex-col overflow-hidden ${
            selected ? "flex" : "hidden lg:flex"
          }`}
        >
          {!selected ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the thread.
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-3 py-2.5 sm:px-4 sm:py-3 border-b border-border flex items-center gap-2">
                <button
                  onClick={() => setSelected(null)}
                  className="lg:hidden p-2 -ml-1 rounded-md hover:bg-secondary text-foreground"
                  aria-label="Back to inbox"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">
                      {selected.user_email ?? selected.user_id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Coins className="h-3 w-3" />
                      {selected.credit_balance}
                    </span>
                    <span className="rounded-md bg-secondary text-secondary-foreground text-[10px] uppercase tracking-wider px-1.5 py-0.5">
                      {selected.type}
                    </span>
                    {selected.subject && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        {selected.subject}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={closeConversation}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground text-xs px-2.5 py-1.5 transition shrink-0"
                  title="Close conversation and wipe all messages"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Close & wipe</span>
                </button>
              </div>

              {/* Messages */}
              <div
                ref={scrollerRef}
                className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 space-y-2 bg-background min-h-[300px]"
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[15px] sm:text-sm leading-relaxed ${
                      m.sender === "admin"
                        ? "ml-auto bg-primary text-primary-foreground rounded-br-md"
                        : "mr-auto bg-secondary text-secondary-foreground rounded-bl-md"
                    }`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.message}</div>
                    <div
                      className={`text-[10px] mt-1 ${
                        m.sender === "admin"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {relativeTime(m.created_at)}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick replies */}
              <div className="border-t border-border bg-card">
                <div className="flex items-center justify-between px-3 py-2 sm:px-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    <Zap className="h-3 w-3" />
                    Quick replies
                  </div>
                  <button
                    onClick={() => setEditingQR((v) => !v)}
                    className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Pencil className="h-3 w-3" />
                    {editingQR ? "Done" : "Edit"}
                  </button>
                </div>
                <div className="px-3 pb-2 sm:px-4 flex gap-1.5 overflow-x-auto scrollbar-none">
                  {quickReplies.map((qr, i) => (
                    <div key={i} className="flex items-center shrink-0">
                      <button
                        onClick={() => sendReply(qr)}
                        disabled={sending}
                        className="text-xs bg-secondary hover:bg-secondary/70 text-secondary-foreground rounded-full px-3 py-1.5 max-w-[220px] truncate disabled:opacity-50"
                        title={qr}
                      >
                        {qr}
                      </button>
                      {editingQR && (
                        <button
                          onClick={() => persistQR(quickReplies.filter((_, idx) => idx !== i))}
                          className="ml-0.5 mr-1 p-1 text-muted-foreground hover:text-destructive"
                          aria-label="Remove quick reply"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {editingQR && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = newQR.trim();
                        if (!v) return;
                        persistQR([...quickReplies, v]);
                        setNewQR("");
                      }}
                      className="flex items-center gap-1 shrink-0"
                    >
                      <input
                        value={newQR}
                        onChange={(e) => setNewQR(e.target.value)}
                        placeholder="New quick reply…"
                        className="text-xs rounded-full bg-background border border-input px-3 py-1.5 w-40 focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="submit"
                        className="p-1.5 rounded-full bg-primary text-primary-foreground disabled:opacity-50"
                        disabled={!newQR.trim()}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Composer */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
                className="flex items-end gap-2 p-3 border-t border-border"
              >
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  placeholder="Reply to user…"
                  rows={1}
                  className="flex-1 rounded-lg bg-background border border-input px-3 py-2.5 text-[15px] sm:text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none max-h-32"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sending}
                  className="h-11 w-11 shrink-0 grid place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Send reply"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
