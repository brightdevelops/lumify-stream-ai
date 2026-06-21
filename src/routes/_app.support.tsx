import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LifeBuoy, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
  const { user } = useAuth();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !subject.trim() || !message.trim() || submitting) return;
    setSubmitting(true);
    setErr(null);
    try {
      const { data: conv, error: cErr } = await supabase
        .from("support_conversations")
        .insert({
          user_id: user.id,
          user_email: user.email,
          type: "contact",
          subject: subject.trim(),
        })
        .select("id")
        .single();
      if (cErr) throw cErr;

      const { error: mErr } = await supabase.from("support_messages").insert({
        conversation_id: conv.id,
        user_id: user.id,
        user_email: user.email,
        type: "contact",
        subject: subject.trim(),
        message: message.trim(),
        sender: "user",
      });
      if (mErr) throw mErr;

      setDone(true);
      setSubject("");
      setMessage("");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-10 w-10 rounded-lg bg-primary/10 grid place-items-center text-primary">
          <LifeBuoy className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Contact Support</h1>
          <p className="text-sm text-muted-foreground">We usually reply within a few hours.</p>
        </div>
      </div>

      {done ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-3" />
          <h2 className="font-semibold mb-1">Thanks! We've received your message.</h2>
          <p className="text-sm text-muted-foreground">
            We usually reply within a few hours. You can also chat with us live using the bubble at the bottom right.
          </p>
          <button
            onClick={() => setDone(false)}
            className="mt-4 text-sm text-primary hover:underline"
          >
            Send another message
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Your email</label>
            <input
              value={user?.email ?? ""}
              disabled
              className="w-full rounded-md bg-background border border-input px-3 py-2 text-sm opacity-70"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              maxLength={140}
              placeholder="What do you need help with?"
              className="w-full rounded-md bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              maxLength={4000}
              rows={6}
              placeholder="Describe your issue or question…"
              className="w-full rounded-md bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-y"
            />
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          <button
            type="submit"
            disabled={submitting || !subject.trim() || !message.trim()}
            className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send message"}
          </button>
        </form>
      )}
    </div>
  );
}
