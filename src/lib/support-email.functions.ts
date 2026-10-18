import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Input = {
  conversationId: string;
  kind: "contact" | "chat" | "autoreply";
  subject: string;
  message: string;
  submittedAt: string;
};

// Sends the fixed-recipient support-notification email to the support inbox
// for a conversation the signed-in user owns.
export const notifySupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: Input) => {
    if (!d || typeof d.conversationId !== "string") throw new Error("Invalid input");
    return {
      conversationId: d.conversationId,
      kind: d.kind === "contact" || d.kind === "autoreply" ? d.kind : "chat",
      subject: String(d.subject ?? "").slice(0, 300),
      message: String(d.message ?? "").slice(0, 10000),
      submittedAt: String(d.submittedAt ?? "").slice(0, 100),
    } as Input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context as any;
    const { data: conv, error: convErr } = await supabase
      .from("support_conversations")
      .select("id")
      .eq("id", data.conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (convErr || !conv) return { sent: false };

    const userEmail = (claims?.email as string | undefined) ?? undefined;
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const templateName = "support-notification";
    const recipient = "lumifysupport@gmail.com";
    const idempotencyKey =
      data.kind === "contact"
        ? `support-${data.conversationId}`
        : `${data.kind === "autoreply" ? "chat-autoreply" : "chat"}-${data.conversationId}-${Date.now()}`;

    const log = async (row: Record<string, unknown>) => {
      const { error } = await supabaseAdmin.from("email_send_log").insert({
        message_id: null,
        template_name: templateName,
        recipient_email: recipient,
        ...row,
      } as any);
      if (error) console.error("email_send_log insert failed", { code: error.code, message: error.message });
    };

    try {
      const result = await sendTemplateEmail(templateName, recipient, {
        templateData: { userEmail, subject: data.subject, message: data.message, submittedAt: data.submittedAt },
        idempotencyKey,
      });
      await log({ status: result.sent ? "sent" : "suppressed" });
      return { sent: result.sent };
    } catch (e: any) {
      await log({ status: "failed", error_message: String(e?.message ?? e).slice(0, 1000) });
      return { sent: false };
    }
  });
