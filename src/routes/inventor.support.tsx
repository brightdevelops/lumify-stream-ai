import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Inbox, MessageCircle, Mail, Send, User as UserIcon, Coins, Trash2 } from "lucide-react";

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
  created_at: string;
};

export const Route = createFileRoute("/inventor/support")({
  component: SupportInbox,
});

function SupportInbox() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const loadConvs = async () => {
    const { data, error } = await supabase.rpc("admin_list_support_conversations", { p_limit: 300 });
    if (error) setErr(error.message);
    else setConvs((data as Conv[]) ?? []);
  };

  // Initial + realtime list refresh
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

  // Load messages for selected conv + realtime
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
          // Keep unread cleared while admin is actively viewing this thread
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

  async function sendReply() {
    if (!selected || !reply.trim() || sending) return;
    setSending(true);
    const body = reply.trim();
    setReply("");
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
      setReply(body);
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

  const totalUnread = convs.reduce((s, c) => s + (c.unread_for_admin || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
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
        {/* List */}
        <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
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
                  className={`w-full text-left px-3 py-3 transition ${
                    active ? "bg-primary/10" : "hover:bg-secondary/40"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {c.type === "chat" ? (
                      <MessageCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                    <span className={`text-sm truncate ${isUnread ? "font-semibold" : ""}`}>
                      {c.user_email ?? c.user_id.slice(0, 8)}
                    </span>
                    {isUnread && (
                      <span className="ml-auto rounded-full bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0.5">
                        {c.unread_for_admin}
                      </span>
                    )}
                  </div>
                  {c.subject && (
                    <div className="text-xs text-foreground/80 truncate">{c.subject}</div>
                  )}
                  <div className="text-xs text-muted-foreground truncate">
                    {c.last_message_preview ?? "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(c.last_message_at).toLocaleString()}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Thread */}
        <div className="rounded-lg border border-border bg-card flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the thread.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <UserIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selected.user_email ?? selected.user_id}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Coins className="h-3.5 w-3.5" />
                  {selected.credit_balance} credits
                </div>
                <span className="rounded-md bg-secondary text-secondary-foreground text-[10px] uppercase tracking-wider px-2 py-0.5">
                  {selected.type}
                </span>
                {selected.subject && (
                  <span className="text-xs text-muted-foreground truncate ml-auto">
                    {selected.subject}
                  </span>
                )}
                <button
                  onClick={closeConversation}
                  className={`inline-flex items-center gap-1.5 rounded-md border border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground text-xs px-2.5 py-1 transition ${selected.subject ? "" : "ml-auto"}`}
                  title="Close conversation and wipe all messages"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Close & wipe
                </button>
              </div>

              <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-background min-h-[300px]">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      m.sender === "admin"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "mr-auto bg-secondary text-secondary-foreground"
                    }`}
                  >
                    <div>{m.message}</div>
                    <div className={`text-[10px] mt-1 ${m.sender === "admin" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {new Date(m.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply();
                }}
                className="flex items-center gap-2 p-3 border-t border-border"
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply to user…"
                  className="flex-1 rounded-md bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!reply.trim() || sending}
                  className="h-9 px-4 grid place-items-center rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
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
