import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

import { tryAutoReply } from "@/lib/support-autoreply.functions";

type Msg = {
  id: string;
  message: string;
  sender: "user" | "admin";
  is_auto_reply?: boolean;
  created_at: string;
};


export function SupportWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  // Find or create chat conversation
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: existing } = await supabase
        .from("support_conversations")
        .select("id, unread_for_user")
        .eq("user_id", user.id)
        .eq("type", "chat")
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (existing) {
        setConvId(existing.id);
        setUnread(existing.unread_for_user ?? 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load messages + realtime
  useEffect(() => {
    if (!convId) return;
    let cancelled = false;
    supabase
      .from("support_messages")
      .select("id, message, sender, is_auto_reply, created_at")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data as Msg[]);
      });

    const channel = supabase
      .channel(`support-msgs-${convId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `conversation_id=eq.${convId}` },
        (payload) => {
          const m = payload.new as Msg;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (m.sender === "admin" && !open) setUnread((u) => u + 1);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [convId, open]);

  // Autoscroll
  useEffect(() => {
    if (open && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Mark read when opened
  useEffect(() => {
    if (open && convId && unread > 0) {
      supabase.rpc("mark_my_conversation_read", { p_conversation_id: convId }).then(() => setUnread(0));
    }
  }, [open, convId, unread]);

  async function send() {
    if (!user || !text.trim() || sending) return;
    setSending(true);
    const body = text.trim();
    setText("");
    try {
      let cid = convId;
      if (!cid) {
        const { data, error } = await supabase
          .from("support_conversations")
          .insert({ user_id: user.id, user_email: user.email, type: "chat" })
          .select("id")
          .single();
        if (error) throw error;
        cid = data.id;
        setConvId(cid);
      }
      const { error: insErr } = await supabase.from("support_messages").insert({
        conversation_id: cid,
        user_id: user.id,
        user_email: user.email,
        type: "chat",
        message: body,
        sender: "user",
      });
      if (insErr) throw insErr;

      // Fire-and-forget admin notification for EVERY user message so the
      // admin sees follow-ups even after an AI auto-reply.
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (token) {
          await fetch("/lovable/email/transactional/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              templateName: "support-notification",
              idempotencyKey: `chat-${cid}-${Date.now()}`,
              templateData: {
                userEmail: user.email,
                subject: "Live chat message",
                message: body,
                submittedAt: new Date().toLocaleString(),
              },
            }),
          });
        }
      } catch (notifyErr) {
        console.warn("Chat notification email failed to enqueue", notifyErr);
      }

      // Auto-reply attempt (rules first, then AI). Await so we can notify
      // admin by email when the bot actually answered.
      try {
        const result: any = await tryAutoReply({
          data: {
            conversationId: cid!,
            userId: user.id,
            userEmail: user.email ?? null,
            latestMessage: body,
          },
        });
        if (result?.replied && result?.reply) {
          try {
            const { data: sess2 } = await supabase.auth.getSession();
            const token2 = sess2.session?.access_token;
            if (token2) {
              await fetch("/lovable/email/transactional/send", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token2}`,
                },
                body: JSON.stringify({
                  templateName: "support-notification",
                  idempotencyKey: `chat-autoreply-${cid}-${Date.now()}`,
                  templateData: {
                    userEmail: user.email,
                    subject: "🤖 Auto-reply sent",
                    message: `User asked: ${body}\n\nAuto-reply (${result.replied}): ${result.reply}`,
                    submittedAt: new Date().toLocaleString(),
                  },
                }),
              });
            }
          } catch (mailErr) {
            console.warn("Auto-reply notification email failed", mailErr);
          }
        }
      } catch (autoErr) {
        console.warn("Auto-reply failed", autoErr);
      }

    } catch (e) {
      console.error(e);
      setText(body);
    } finally {
      setSending(false);
    }
  }

  if (!user) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open support chat"
          data-tour="support"
          className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg grid place-items-center hover:opacity-90 transition"
        >
          <MessageCircle className="h-6 w-6" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold grid place-items-center px-1">
              {unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[92vw] max-w-sm h-[70vh] max-h-[560px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
            <div>
              <div className="text-sm font-semibold">Lumify Support</div>
              <div className="text-[11px] text-muted-foreground">Usually replies within a few hours</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2 bg-background">
            <div className="rounded-lg bg-secondary/60 text-secondary-foreground text-xs px-3 py-2">
              Hi! How can we help? We usually reply within a few hours.
            </div>
            <div className="text-[10px] text-muted-foreground text-center px-2">
              ⏳ Chats auto-clear after 42 hours
            </div>
            {messages.map((m) => (
              <div key={m.id} className={m.sender === "user" ? "ml-auto max-w-[80%]" : "mr-auto max-w-[80%]"}>
                {m.sender === "admin" && m.is_auto_reply && (
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <span>🤖</span> Auto-reply · a human will follow up if needed
                  </div>
                )}
                <div
                  className={`rounded-lg px-3 py-2 text-sm ${
                    m.sender === "user"
                      ? "bg-primary text-primary-foreground"
                      : m.is_auto_reply
                      ? "bg-accent/30 text-foreground border border-accent/40"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {m.message}
                </div>
              </div>
            ))}

          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-center gap-2 p-2 border-t border-border bg-card"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message…"
              className="flex-1 rounded-md bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="h-9 w-9 grid place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
