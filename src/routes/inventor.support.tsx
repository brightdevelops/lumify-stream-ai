import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  getAutoReplyConfig,
  setAutoReplyEnabled,
  upsertAutoReplyRule,
  deleteAutoReplyRule,
} from "@/lib/support-autoreply.functions";
import {
  Send,
  Trash2,
  Pencil,
  Plus,
  Bot,
  MoreHorizontal,
  Clock,
  Check,
  X,
  PanelRight,
  Inbox as InboxIcon,
  AlertCircle,
  CircleDot,
  CheckCircle2,
  Layers,
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
  topic: string;
  status: string;
  snoozed_until: string | null;
  last_sender: "user" | "admin";
  last_admin_was_auto: boolean;
  unanswered_count: number;
  first_message_at: string;
  message_count: number;
};

type Msg = {
  id: string;
  message: string;
  sender: "user" | "admin";
  is_auto_reply?: boolean;
  created_at: string;
};

type Rule = { id: string; triggers: string[]; response: string; sort_order: number };
type Canned = { id: string; slug: string; body: string; sort_order: number };

type CustomerCtx = {
  found: boolean;
  email?: string;
  signed_up_at?: string;
  balance?: number;
  session_count?: number;
  lifetime_topups_ngn?: number;
  transactions?: Array<{
    id: string;
    credits: number;
    amount_ngn: number | null;
    category: string;
    description: string | null;
    reference: string | null;
    created_at: string;
  }>;
  last_session?: { started_at: string; ended_at: string | null; credits_used: number } | null;
};

export const Route = createFileRoute("/inventor/support")({
  component: SupportInbox,
});

/* ---------- tokens ---------- */
const BG = "#0b0d0a";
const RAIL = "#101309";
const CARD = "#14170f";
const CARD_BORDER = "#262b1c";
const DIVIDER = "#1e2316";
const LIME = "#c6f24e";
const RED = "#ff7a6b";
const AMBER = "#f2c14e";
const BLUE = "#7ab8d9";
const GREEN = "#7fd98a";
const GREY = "#7d8474";

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const labelStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const TOPICS = [
  { key: "payments", label: "Payments & credits", color: AMBER },
  { key: "camera", label: "Camera & streaming", color: BLUE },
  { key: "account", label: "Account", color: LIME },
  { key: "other", label: "Other", color: GREY },
] as const;

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

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "TODAY";
  if (same(d, yest)) return "YESTERDAY";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function isSnoozed(c: Conv) {
  return c.status === "snoozed" && !!c.snoozed_until && new Date(c.snoozed_until).getTime() > Date.now();
}
function needsHuman(c: Conv) {
  return (
    c.status !== "resolved" &&
    !isSnoozed(c) &&
    c.last_sender === "user" &&
    (c.last_admin_was_auto || c.unanswered_count >= 2)
  );
}

function Tag({ text, color, solid }: { text: string; color: string; solid?: boolean }) {
  return (
    <span
      style={{
        ...labelStyle,
        fontSize: 9,
        color,
        border: `1px solid ${color}44`,
        background: solid ? `${color}22` : `${color}14`,
        borderRadius: 4,
        padding: "1.5px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function SupportInbox() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [queue, setQueue] = useState<"needs" | "unread" | "auto" | "resolved" | "all">("needs");
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [oldestFirst, setOldestFirst] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [ctx, setCtx] = useState<CustomerCtx | null>(null);
  const [canned, setCanned] = useState<Canned[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-reply admin config
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [showAutoPanel, setShowAutoPanel] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<{ id?: string; triggers: string; response: string } | null>(null);

  const selected = useMemo(() => convs.find((c) => c.id === selectedId) ?? null, [convs, selectedId]);

  const loadAutoConfig = useCallback(async () => {
    try {
      const cfg = await getAutoReplyConfig();
      setAutoEnabled(cfg.enabled);
      setRules(cfg.rules);
    } catch (e: any) {
      console.warn("autoreply config load", e?.message ?? e);
    }
  }, []);

  const loadCanned = useCallback(async () => {
    const { data } = await supabase
      .from("support_canned_replies")
      .select("id, slug, body, sort_order")
      .order("sort_order", { ascending: true });
    if (data) setCanned(data as Canned[]);
  }, []);

  const loadConvs = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_list_support_conversations", { p_limit: 300 });
    if (error) setErr(error.message);
    else setConvs((data as unknown as Conv[]) ?? []);
  }, []);

  useEffect(() => {
    loadAutoConfig();
    loadCanned();
  }, [loadAutoConfig, loadCanned]);

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
  }, [loadConvs]);

  // thread
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("support_messages")
      .select("id, message, sender, is_auto_reply, created_at")
      .eq("conversation_id", selectedId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data as Msg[]);
      });
    supabase.rpc("admin_mark_conversation_read", { p_conversation_id: selectedId });

    const ch = supabase
      .channel(`support-admin-thread-${selectedId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (m.sender === "user") {
            supabase.rpc("admin_mark_conversation_read", { p_conversation_id: selectedId });
          }
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [selectedId]);

  // customer context
  const loadCtx = useCallback(async (userId: string) => {
    setCtx(null);
    const { data, error } = await supabase.rpc("admin_support_customer_context", { p_user_id: userId });
    if (error) setCtx({ found: false });
    else setCtx(data as unknown as CustomerCtx);
  }, []);

  useEffect(() => {
    if (selected?.user_id) loadCtx(selected.user_id);
    else setCtx(null);
  }, [selected?.user_id, loadCtx]);

  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [messages]);

  /* ---------- actions ---------- */
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
      await upsertAutoReplyRule({ data: { id: ruleDraft.id, triggers, response: ruleDraft.response.trim() } });
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

  const setStatus = useCallback(
    async (id: string, status: "open" | "resolved" | "snoozed") => {
      try {
        const { error } = await supabase.rpc("admin_set_conversation_status", {
          p_conversation_id: id,
          p_status: status,
        });
        if (error) throw error;
        await loadConvs();
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    },
    [loadConvs],
  );

  async function closeConversation(c: Conv) {
    const ok = window.confirm(
      `Close & wipe the conversation with ${c.user_email ?? c.user_id}?\n\nAll messages will be permanently deleted. This is IRREVERSIBLE.`,
    );
    if (!ok) return;
    try {
      const { error } = await supabase.rpc("admin_close_support_conversation", { p_conversation_id: c.id });
      if (error) throw error;
      setConvs((prev) => prev.filter((x) => x.id !== c.id));
      setMessages([]);
      setSelectedId(null);
      setMenuOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function addCanned() {
    const slug = window.prompt("Shortcut name (no spaces), e.g. refund-sent");
    if (!slug?.trim()) return;
    const body = window.prompt("Reply text");
    if (!body?.trim()) return;
    const { error } = await supabase
      .from("support_canned_replies")
      .insert({ slug: slug.trim().replace(/^\//, ""), body: body.trim(), sort_order: canned.length + 1 });
    if (error) setErr(error.message);
    else loadCanned();
  }

  async function creditAccount() {
    if (!selected) return;
    const raw = window.prompt("Credits to add (negative to remove):");
    if (!raw) return;
    const delta = parseInt(raw, 10);
    if (!Number.isFinite(delta) || delta === 0) return;
    const note = window.prompt("Note (audited):", "Support adjustment") ?? "Support adjustment";
    try {
      const { error } = await supabase.rpc("admin_adjust_credits", {
        target_user_id: selected.user_id,
        delta,
        note,
      });
      if (error) throw error;
      await loadCtx(selected.user_id);
      await loadConvs();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  /* ---------- derived ---------- */
  const counts = useMemo(() => {
    const visible = convs.filter((c) => !isSnoozed(c));
    return {
      needs: visible.filter(needsHuman).length,
      unread: visible.filter((c) => c.unread_for_admin > 0).length,
      auto: visible.filter((c) => c.last_sender === "admin" && c.last_admin_was_auto).length,
      resolved: convs.filter((c) => c.status === "resolved").length,
      all: convs.length,
      topics: Object.fromEntries(
        TOPICS.map((t) => [t.key, visible.filter((c) => (c.topic || "other") === t.key).length]),
      ) as Record<string, number>,
    };
  }, [convs]);

  const filtered = useMemo(() => {
    let list = convs.slice();
    if (queue !== "all") list = list.filter((c) => !isSnoozed(c));
    if (queue === "needs") list = list.filter(needsHuman);
    else if (queue === "unread") list = list.filter((c) => c.unread_for_admin > 0);
    else if (queue === "auto") list = list.filter((c) => c.last_sender === "admin" && c.last_admin_was_auto);
    else if (queue === "resolved") list = list.filter((c) => c.status === "resolved");

    if (topicFilter) list = list.filter((c) => (c.topic || "other") === topicFilter);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.user_email ?? "").toLowerCase().includes(q) ||
          (c.last_message_preview ?? "").toLowerCase().includes(q) ||
          (c.subject ?? "").toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      const d = new Date(a.last_message_at).getTime() - new Date(b.last_message_at).getTime();
      return oldestFirst ? d : -d;
    });
    return list;
  }, [convs, queue, topicFilter, search, oldestFirst]);

  // Needs-a-human defaults to oldest first; other queues to newest
  useEffect(() => {
    setOldestFirst(queue === "needs");
  }, [queue]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const idx = filtered.findIndex((c) => c.id === selectedId);
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        const next = filtered[Math.min(filtered.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        const prev = filtered[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      } else if (e.key === "Enter" || e.key === "r" || e.key === "R") {
        if (selectedId) {
          e.preventDefault();
          replyRef.current?.focus();
        }
      } else if (e.key === "e" || e.key === "E") {
        if (selectedId) {
          e.preventDefault();
          setStatus(selectedId, "resolved");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedId, setStatus]);

  const queueTitle =
    queue === "needs"
      ? "Needs a human"
      : queue === "unread"
        ? "Unread"
        : queue === "auto"
          ? "Auto-replied"
          : queue === "resolved"
            ? "Resolved"
            : "All conversations";

  /* ---------- render ---------- */
  return (
    <div
      className="-mx-4 -my-6 sm:-mx-6 flex overflow-hidden"
      style={{ background: BG, height: "calc(100vh - 148px)", minHeight: 520 }}
    >
      {/* 1 — QUEUES RAIL */}
      <aside
        className="hidden md:flex flex-col shrink-0 overflow-y-auto w-[68px] lg:w-[210px]"
        style={{ background: RAIL, borderRight: `1px solid ${DIVIDER}` }}
      >
        <div className="px-4 py-4 hidden lg:block">
          <div style={{ ...labelStyle, color: LIME, fontSize: 11 }}>Lumify</div>
          <div style={{ ...labelStyle, color: "#8f978a" }}>Support</div>
        </div>
        <div className="lg:hidden px-2 py-4 text-center" style={{ color: LIME }}>
          <InboxIcon className="h-5 w-5 mx-auto" />
        </div>

        <RailSection label="Queues" />
        <RailItem icon={<AlertCircle className="h-3.5 w-3.5" />} dot={RED} label="Needs a human" count={counts.needs} countColor={RED} active={queue === "needs"} onClick={() => setQueue("needs")} />
        <RailItem icon={<CircleDot className="h-3.5 w-3.5" />} dot={LIME} label="Unread" count={counts.unread} active={queue === "unread"} onClick={() => setQueue("unread")} />
        <RailItem icon={<Bot className="h-3.5 w-3.5" />} dot={GREY} label="Auto-replied" count={counts.auto} active={queue === "auto"} onClick={() => setQueue("auto")} />
        <RailItem icon={<CheckCircle2 className="h-3.5 w-3.5" />} dot={GREEN} label="Resolved" count={counts.resolved} active={queue === "resolved"} onClick={() => setQueue("resolved")} />
        <RailItem icon={<Layers className="h-3.5 w-3.5" />} dot="transparent" label="All conversations" count={counts.all} active={queue === "all"} onClick={() => setQueue("all")} />

        <RailSection label="Topics" />
        {TOPICS.map((t) => (
          <RailItem
            key={t.key}
            icon={<span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />}
            dot={t.color}
            label={t.label}
            count={counts.topics[t.key] ?? 0}
            active={topicFilter === t.key}
            onClick={() => setTopicFilter((v) => (v === t.key ? null : t.key))}
          />
        ))}

        <div className="mt-auto p-3 space-y-2" style={{ borderTop: `1px solid ${DIVIDER}` }}>
          <button
            onClick={toggleAuto}
            className="w-full flex items-center gap-2 rounded-md px-2 py-2 transition-colors duration-150"
            style={{
              ...labelStyle,
              color: autoEnabled ? LIME : "#8f978a",
              border: `1px solid ${autoEnabled ? `${LIME}44` : DIVIDER}`,
              background: autoEnabled ? `${LIME}12` : "transparent",
            }}
            title="Toggle Lumi auto-reply"
          >
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden lg:inline">Lumi {autoEnabled ? "on" : "off"}</span>
          </button>
          <button
            onClick={() => setShowAutoPanel(true)}
            className="w-full text-left px-2 hidden lg:block transition-colors duration-150 hover:text-white"
            style={{ ...labelStyle, color: "#8f978a" }}
          >
            Rules ›
          </button>
        </div>
      </aside>

      {/* 2 — CONVERSATION LIST */}
      <section
        className={`flex-col shrink-0 w-full md:w-[330px] overflow-hidden ${selectedId ? "hidden md:flex" : "flex"}`}
        style={{ borderRight: `1px solid ${DIVIDER}` }}
      >
        <div className="px-4 pt-4 pb-3 space-y-3" style={{ borderBottom: `1px solid ${DIVIDER}` }}>
          <div className="flex items-baseline gap-2">
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: 19, color: "#f2f5ee" }}>{queueTitle}</h2>
            <span
              style={{
                ...labelStyle,
                fontSize: 9,
                color: queue === "needs" ? RED : "#8f978a",
                border: `1px solid ${queue === "needs" ? `${RED}55` : DIVIDER}`,
                background: queue === "needs" ? `${RED}18` : "transparent",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              {filtered.length} {queue === "needs" ? "waiting" : "total"}
            </span>
          </div>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search email or message… ( / )"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150"
            style={{ background: CARD, border: `1px solid ${CARD_BORDER}`, color: "#e7ecdf" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = LIME)}
            onBlur={(e) => (e.currentTarget.style.borderColor = CARD_BORDER)}
          />
          <div className="flex flex-wrap gap-1.5">
            <Chip active={oldestFirst} onClick={() => setOldestFirst(true)} label="Oldest first" />
            <Chip active={!oldestFirst} onClick={() => setOldestFirst(false)} label="Newest" />
            {TOPICS.map((t) => (
              <Chip
                key={t.key}
                active={topicFilter === t.key}
                onClick={() => setTopicFilter((v) => (v === t.key ? null : t.key))}
                label={t.label.split(" ")[0]!}
                color={t.color}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-sm" style={{ color: "#7d8474" }}>
              Nothing in this queue.
            </div>
          )}
          {filtered.map((c) => {
            const active = selectedId === c.id;
            const unread = c.unread_for_admin > 0;
            const topic = TOPICS.find((t) => t.key === (c.topic || "other"))!;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-left px-4 py-3 transition-colors duration-150"
                style={{
                  background: active ? "#181c11" : "transparent",
                  borderBottom: `1px solid ${DIVIDER}`,
                  borderLeft: active ? `2px solid ${LIME}` : "2px solid transparent",
                }}
              >
                <div className="flex items-center gap-2">
                  {unread && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: LIME }} />}
                  <span
                    className="truncate text-[13px]"
                    style={{ fontWeight: 600, color: unread ? "#f4f8ec" : "#b9c1ac" }}
                  >
                    {c.user_email ?? c.user_id.slice(0, 8)}
                  </span>
                  <span className="ml-auto shrink-0" style={{ ...labelStyle, fontSize: 10.5, color: "#767d6c" }}>
                    {relativeTime(c.last_message_at)}
                  </span>
                </div>
                <div className="mt-1 truncate text-[12.5px]" style={{ color: "#8f978a" }}>
                  {c.last_message_preview ?? "—"}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Tag text={topic.label.split(" ")[0]!} color={topic.color} />
                  {needsHuman(c) && c.last_admin_was_auto && <Tag text="Replied after auto" color={RED} />}
                  {c.last_sender === "user" && c.unanswered_count >= 2 && (
                    <Tag text={`${c.unanswered_count} unanswered`} color={RED} />
                  )}
                  {c.last_sender === "admin" && c.last_admin_was_auto && <Tag text="Auto-replied" color={GREY} />}
                  {c.status === "resolved" && <Tag text="Resolved" color={GREEN} />}
                  {isSnoozed(c) && <Tag text="Snoozed" color={GREY} />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3 — THREAD */}
      <section className={`flex-1 min-w-0 flex-col ${selectedId ? "flex" : "hidden md:flex"}`}>
        {!selected ? (
          <div className="flex-1 grid place-items-center text-sm" style={{ color: "#7d8474" }}>
            Select a conversation to view the thread.
          </div>
        ) : (
          <>
            {/* header */}
            <div
              className="flex items-start gap-3 px-5 py-3"
              style={{ borderBottom: `1px solid ${DIVIDER}` }}
            >
              <button
                onClick={() => setSelectedId(null)}
                className="md:hidden mt-1"
                style={{ color: "#8f978a" }}
                aria-label="Back"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px]" style={{ fontWeight: 700, color: "#f2f5ee" }}>
                  {selected.user_email ?? selected.user_id}
                </div>
                <div className="mt-0.5 truncate" style={{ fontFamily: mono, fontSize: 11, color: "#767d6c" }}>
                  {selected.type.toUpperCase()} · FIRST SEEN {relativeTime(selected.first_message_at).toUpperCase()} ·{" "}
                  {selected.message_count} MESSAGES
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setStatus(selected.id, "snoozed")}
                  className="rounded-md px-2.5 py-1.5 transition-colors duration-150"
                  style={{ ...labelStyle, color: "#8f978a", border: `1px solid ${DIVIDER}` }}
                >
                  <Clock className="h-3 w-3 inline mr-1" />
                  Snooze
                </button>
                <button
                  onClick={() => setStatus(selected.id, "resolved")}
                  className="rounded-md px-2.5 py-1.5 transition-colors duration-150"
                  style={{ ...labelStyle, color: "#0b0d0a", background: LIME, fontWeight: 700 }}
                >
                  <Check className="h-3 w-3 inline mr-1" />
                  Resolve
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="rounded-md px-2 py-1.5"
                    style={{ color: "#8f978a", border: `1px solid ${DIVIDER}` }}
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                  {menuOpen && (
                    <div
                      className="absolute right-0 z-30 mt-1 w-52 rounded-xl p-1"
                      style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
                    >
                      <MenuItem label="Assign" onClick={() => setMenuOpen(false)} />
                      <MenuItem label="Block sender" onClick={() => setMenuOpen(false)} />
                      <MenuItem label="Close & wipe" danger onClick={() => closeConversation(selected)} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowContext((v) => !v)}
                  className="xl:hidden rounded-md px-2 py-1.5"
                  style={{ color: "#8f978a", border: `1px solid ${DIVIDER}` }}
                  aria-label="Customer context"
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* messages */}
            <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                const admin = m.sender === "admin";
                const auto = admin && m.is_auto_reply;
                return (
                  <div key={m.id}>
                    {newDay && (
                      <div className="my-4 text-center" style={{ ...labelStyle, color: "#5f6656" }}>
                        — {dayLabel(m.created_at)} —
                      </div>
                    )}
                    <div className={admin ? "ml-auto max-w-[72%]" : "mr-auto max-w-[72%]"}>
                      <div
                        className="px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words"
                        style={
                          auto
                            ? {
                                background: `${LIME}12`,
                                border: `1px solid ${LIME}40`,
                                color: "#b9c1ac",
                                borderRadius: 12,
                                borderBottomRightRadius: 4,
                              }
                            : admin
                              ? { background: LIME, color: "#0b0d0a", borderRadius: 12, borderBottomRightRadius: 4 }
                              : {
                                  background: CARD,
                                  border: `1px solid ${CARD_BORDER}`,
                                  color: "#e7ecdf",
                                  borderRadius: 12,
                                  borderBottomLeftRadius: 4,
                                }
                        }
                      >
                        {auto && (
                          <div style={{ ...labelStyle, fontSize: 9.5, color: LIME, marginBottom: 4 }}>
                            🤖 Auto-reply · Lumi
                          </div>
                        )}
                        {m.message}
                      </div>
                      <div
                        className={admin ? "text-right" : ""}
                        style={{ ...labelStyle, color: "#5f6656", marginTop: 4 }}
                      >
                        {relativeTime(m.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* composer */}
            <div className="px-5 py-3" style={{ borderTop: `1px solid ${DIVIDER}` }}>
              <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
                {canned.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setReply((r) => (r.trim() ? r + "\n" + c.body : c.body));
                      replyRef.current?.focus();
                    }}
                    className="shrink-0 rounded-full px-2.5 py-1 transition-colors duration-150"
                    style={{ ...labelStyle, color: "#8f978a", border: `1px solid ${DIVIDER}`, background: CARD }}
                    title={c.body}
                  >
                    /{c.slug}
                  </button>
                ))}
                <button
                  onClick={addCanned}
                  className="shrink-0 rounded-full px-2.5 py-1"
                  style={{ ...labelStyle, color: LIME, border: `1px solid ${LIME}44` }}
                >
                  + New
                </button>
              </div>
              <div
                className="flex items-end gap-2 rounded-xl px-3 py-2"
                style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}
              >
                <textarea
                  ref={replyRef}
                  value={reply}
                  onChange={(e) => {
                    setReply(e.target.value);
                    e.currentTarget.style.height = "auto";
                    e.currentTarget.style.height = Math.min(160, e.currentTarget.scrollHeight) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendReply();
                    }
                  }}
                  rows={1}
                  placeholder="Write a reply…"
                  className="flex-1 bg-transparent text-[13.5px] outline-none resize-none max-h-40"
                  style={{ color: "#e7ecdf" }}
                />
                <button
                  onClick={() => sendReply()}
                  disabled={!reply.trim() || sending}
                  className="h-8 w-8 shrink-0 grid place-items-center rounded-lg disabled:opacity-40"
                  style={{ background: LIME, color: "#0b0d0a" }}
                  aria-label="Send reply"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-1.5" style={{ ...labelStyle, color: "#5f6656" }}>
                Enter to send · Shift+Enter new line · J/K next/prev conversation · E resolve
              </div>
            </div>
          </>
        )}
      </section>

      {/* 4 — CUSTOMER CONTEXT */}
      <aside
        className={`shrink-0 w-[280px] overflow-y-auto ${showContext ? "fixed right-0 top-0 bottom-0 z-40 block" : "hidden xl:block"}`}
        style={{ background: RAIL, borderLeft: `1px solid ${DIVIDER}` }}
      >
        {showContext && (
          <div className="flex justify-end p-2 xl:hidden">
            <button onClick={() => setShowContext(false)} style={{ color: "#8f978a" }} aria-label="Close panel">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <ContextPanel
          conv={selected}
          ctx={ctx}
          onCredit={creditAccount}
          onWipe={() => selected && closeConversation(selected)}
        />
      </aside>

      {/* Rules drawer */}
      {showAutoPanel && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-md overflow-y-auto p-5 space-y-3" style={{ background: BG, borderLeft: `1px solid ${DIVIDER}` }}>
            <div className="flex items-center justify-between">
              <div style={{ ...labelStyle, color: LIME }}>Lumi auto-reply rules</div>
              <button onClick={() => setShowAutoPanel(false)} style={{ color: "#8f978a" }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setRuleDraft({ triggers: "", response: "" })}
              className="rounded-md px-2.5 py-1.5"
              style={{ ...labelStyle, background: LIME, color: "#0b0d0a", fontWeight: 700 }}
            >
              <Plus className="h-3 w-3 inline mr-1" /> New rule
            </button>
            {ruleDraft && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}>
                <input
                  value={ruleDraft.triggers}
                  onChange={(e) => setRuleDraft({ ...ruleDraft, triggers: e.target.value })}
                  placeholder="Triggers (comma-separated): refund, money back"
                  className="w-full rounded-md px-2 py-1.5 text-sm outline-none"
                  style={{ background: BG, border: `1px solid ${CARD_BORDER}`, color: "#e7ecdf" }}
                />
                <textarea
                  value={ruleDraft.response}
                  onChange={(e) => setRuleDraft({ ...ruleDraft, response: e.target.value })}
                  placeholder="Response message"
                  rows={3}
                  className="w-full rounded-md px-2 py-1.5 text-sm outline-none resize-none"
                  style={{ background: BG, border: `1px solid ${CARD_BORDER}`, color: "#e7ecdf" }}
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setRuleDraft(null)} className="rounded-md px-3 py-1.5" style={{ ...labelStyle, color: "#8f978a", border: `1px solid ${DIVIDER}` }}>
                    Cancel
                  </button>
                  <button onClick={saveRule} className="rounded-md px-3 py-1.5" style={{ ...labelStyle, background: LIME, color: "#0b0d0a", fontWeight: 700 }}>
                    Save
                  </button>
                </div>
              </div>
            )}
            {rules.map((r) => (
              <div key={r.id} className="rounded-xl p-3 flex gap-2" style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-1 mb-1">
                    {r.triggers.map((t, i) => (
                      <Tag key={i} text={t} color={GREY} />
                    ))}
                  </div>
                  <div className="text-[13px] whitespace-pre-wrap break-words" style={{ color: "#b9c1ac" }}>
                    {r.response}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => setRuleDraft({ id: r.id, triggers: r.triggers.join(", "), response: r.response })} style={{ color: "#8f978a" }} aria-label="Edit rule">
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button onClick={() => removeRule(r.id)} style={{ color: RED }} aria-label="Delete rule">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-3 py-2 text-xs"
          style={{ background: CARD, border: `1px solid ${RED}55`, color: RED }}
          onClick={() => setErr(null)}
        >
          {err}
        </div>
      )}
    </div>
  );
}

/* ---------- small pieces ---------- */

function RailSection({ label }: { label: string }) {
  return (
    <div className="px-4 pt-4 pb-1.5 hidden lg:block" style={{ ...labelStyle, color: "#5f6656" }}>
      {label}
    </div>
  );
}

function RailItem({
  icon,
  dot,
  label,
  count,
  countColor,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  dot: string;
  label: string;
  count: number;
  countColor?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="mx-2 flex items-center gap-2 rounded-md px-2 py-2 transition-colors duration-150"
      style={{
        background: active ? LIME : "transparent",
        color: active ? "#0b0d0a" : "#b9c1ac",
      }}
    >
      <span className="lg:hidden">{icon}</span>
      <span className="hidden lg:inline h-1.5 w-1.5 rounded-full shrink-0" style={{ background: active ? "#0b0d0a" : dot }} />
      <span className="hidden lg:inline truncate text-[12.5px]">{label}</span>
      <span
        className="hidden lg:inline ml-auto"
        style={{ ...labelStyle, color: active ? "#0b0d0a" : (countColor ?? "#767d6c") }}
      >
        {count}
      </span>
    </button>
  );
}

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  const c = color ?? LIME;
  return (
    <button
      onClick={onClick}
      className="rounded-full px-2 py-1 transition-colors duration-150"
      style={{
        ...labelStyle,
        fontSize: 9,
        color: active ? "#0b0d0a" : "#8f978a",
        background: active ? c : "transparent",
        border: `1px solid ${active ? c : DIVIDER}`,
      }}
    >
      {label}
    </button>
  );
}

function MenuItem({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg px-2.5 py-2 transition-colors duration-150"
      style={{ ...labelStyle, color: danger ? RED : "#b9c1ac" }}
    >
      {label}
    </button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3" style={{ background: CARD, border: `1px solid ${CARD_BORDER}` }}>
      <div style={{ ...labelStyle, color: "#5f6656", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span style={{ ...labelStyle, color: "#767d6c" }}>{label}</span>
      <span className="text-[12.5px]" style={{ color: color ?? "#e7ecdf" }}>
        {value}
      </span>
    </div>
  );
}

function ContextPanel({
  conv,
  ctx,
  onCredit,
  onWipe,
}: {
  conv: Conv | null;
  ctx: CustomerCtx | null;
  onCredit: () => void;
  onWipe: () => void;
}) {
  if (!conv) {
    return (
      <div className="p-4" style={{ ...labelStyle, color: "#5f6656" }}>
        No conversation selected
      </div>
    );
  }
  if (!ctx) {
    return (
      <div className="p-4" style={{ ...labelStyle, color: "#5f6656" }}>
        Loading…
      </div>
    );
  }
  if (!ctx.found) {
    return (
      <div className="p-3">
        <Card title="Customer">
          <div className="text-[12.5px]" style={{ color: "#8f978a" }}>
            No Lumify account found for this email.
          </div>
        </Card>
      </div>
    );
  }

  const txs = ctx.transactions ?? [];
  const lowBalance = (ctx.balance ?? 0) < 100;
  const pendingish = txs.find((t) => (t.description ?? "").toLowerCase().match(/pending|failed/));
  const showPaymentCallout =
    !!pendingish &&
    conv.topic === "payments" &&
    Math.abs(new Date(pendingish.created_at).getTime() - new Date(conv.last_message_at).getTime()) < 86400000;

  return (
    <div className="p-3 space-y-3">
      <Card title="Customer">
        <Row label="Signed up" value={ctx.signed_up_at ? new Date(ctx.signed_up_at).toLocaleDateString() : "—"} />
        <Row label="Stream sessions" value={String(ctx.session_count ?? 0)} />
        <Row label="Balance" value={`${ctx.balance ?? 0} cr`} color={lowBalance ? AMBER : undefined} />
        <Row label="Lifetime top-ups" value={`₦${(ctx.lifetime_topups_ngn ?? 0).toLocaleString()}`} />
      </Card>

      <Card title="Wallet · last transactions">
        {txs.length === 0 && (
          <div className="text-[12.5px]" style={{ color: "#767d6c" }}>
            No transactions yet.
          </div>
        )}
        {txs.map((t) => {
          const purchase = t.category === "purchase";
          return (
            <div key={t.id} className="flex items-center justify-between py-1.5">
              <div className="min-w-0">
                <div className="text-[12.5px] truncate" style={{ color: "#e7ecdf" }}>
                  {purchase ? `+${t.credits} cr` : `-${Math.abs(t.credits)} cr`}
                  {t.amount_ngn ? ` · ₦${t.amount_ngn.toLocaleString()}` : ""}
                </div>
                <div style={{ ...labelStyle, color: "#5f6656" }}>{relativeTime(t.created_at)}</div>
              </div>
              <Tag text={purchase ? "Success" : "Usage"} color={purchase ? GREEN : GREY} />
            </div>
          );
        })}
        {showPaymentCallout && (
          <div
            className="mt-2 rounded-lg px-2 py-1.5"
            style={{ ...labelStyle, color: AMBER, background: `${AMBER}12`, border: `1px solid ${AMBER}44` }}
          >
            ⚠ Pending payment matches this complaint
          </div>
        )}
      </Card>

      <Card title="Quick actions">
        <button
          onClick={onCredit}
          className="w-full text-left rounded-lg px-2.5 py-2 mb-1.5 transition-colors duration-150"
          style={{ ...labelStyle, color: LIME, border: `1px solid ${LIME}44` }}
        >
          Credit account — audited
        </button>
        <Link
          to="/inventor/users"
          className="block w-full rounded-lg px-2.5 py-2 mb-1.5 transition-colors duration-150"
          style={{ ...labelStyle, color: "#b9c1ac", border: `1px solid ${DIVIDER}` }}
        >
          Open in admin — full user record
        </Link>
        <button
          onClick={onWipe}
          className="w-full text-left rounded-lg px-2.5 py-2 transition-colors duration-150"
          style={{ ...labelStyle, color: RED, border: `1px solid ${RED}55` }}
        >
          Close &amp; wipe — irreversible
        </button>
      </Card>

      {ctx.last_session && (
        <Card title="Last session">
          <Row label="When" value={relativeTime(ctx.last_session.started_at)} />
          <Row
            label="Duration"
            value={
              ctx.last_session.ended_at
                ? `${Math.max(
                    1,
                    Math.round(
                      (new Date(ctx.last_session.ended_at).getTime() -
                        new Date(ctx.last_session.started_at).getTime()) /
                        60000,
                    ),
                  )}m`
                : "live / open"
            }
          />
          <Row label="Credits used" value={String(ctx.last_session.credits_used)} />
        </Card>
      )}
    </div>
  );
}
