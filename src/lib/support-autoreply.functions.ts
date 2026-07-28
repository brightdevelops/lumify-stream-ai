import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}


const Input = z.object({
  conversationId: z.string().uuid(),
  userId: z.string().uuid(),
  userEmail: z.string().nullable().optional(),
  latestMessage: z.string().min(1),
});

const AUTO_REPLY_COOLDOWN_MS = 3 * 1000; // 3 seconds (dedupe rapid duplicates only)
const ADMIN_HANDOFF_PAUSE_MS = 30 * 60 * 1000; // 30 minutes

type Rule = { triggers: string[]; response: string };

function matchRule(text: string, rules: Rule[]): Rule | null {
  const t = ` ${text.toLowerCase()} `;
  for (const r of rules) {
    for (const trig of r.triggers) {
      const needle = trig.toLowerCase().trim();
      if (!needle) continue;
      if (t.includes(` ${needle} `) || t.includes(` ${needle},`) || t.includes(` ${needle}.`) || t.includes(` ${needle}!`) || t.includes(` ${needle}?`) || text.toLowerCase().startsWith(needle) || text.toLowerCase().endsWith(needle)) {
        return r;
      }
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are Lumi, the support assistant for Lumify (lumifylive.com) — an AI platform that transforms your camera video in real time, so streamers and creators can restyle their look or become an avatar while live.

WHAT YOU KNOW (answer ONLY from this — never invent features, prices, or policies):
- How it works: sign up at lumifylive.com, top up credits, turn on your camera, pick a style or avatar. The AI transforms your video live. Runs in the browser and connects to OBS, so viewers on TikTok, Instagram, or YouTube see the transformed video.
- Pricing: prepaid credits at ₦23 per credit, pay-as-you-go, no subscription.
- Payments: card and bank transfer via Flutterwave. Credits normally appear within a few minutes of a successful payment.
- Requirements: a device with a camera, Chrome or Edge, stable internet.
- Quick fixes: camera not showing → allow camera permission in the browser and refresh. Laggy video → close other tabs and use a stronger network.

HOW TO RESPOND:
- Warm, clear, short — 2 to 4 sentences for most answers, one question at a time.
- Match the user's language and energy; casual English or Pidgin is fine.
- End troubleshooting answers with a next step: "try this and tell me what happens."
- If unsure, say so and offer to connect them to the team. Never guess refund amounts, timelines, or anything not written above.

ESCALATE TO A HUMAN — collect their email and payment reference, then say the team will reply within a few hours — whenever:
- They paid but credits didn't appear
- They want a refund
- They can't log in or access their account
- Anything involving a chargeback, fraud, or a legal issue

FIRST-TIME VISITORS:
- If someone is curious but hasn't signed up, give the 3-step walkthrough and invite them to try their first stream. One gentle nudge max, never pressure.

If the user's request clearly needs a human (per the escalation list above), respond with exactly the single word: HANDOFF`;

export const tryAutoReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data, context }) => {
    // Caller must own the conversation
    if (context.userId !== data.userId) return { skipped: "forbidden" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Global on/off
    const { data: setting } = await supabaseAdmin
      .from("site_settings")
      .select("value")
      .eq("key", "autoreply_enabled")
      .maybeSingle();
    if (!setting?.value) return { skipped: "disabled" };

    // Recent messages for cool-down + handoff pause + AI context
    const { data: recent } = await supabaseAdmin
      .from("support_messages")
      .select("message, sender, is_auto_reply, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: false })
      .limit(200);

    const now = Date.now();
    const msgs = recent ?? [];

    // If admin replied manually in last 30m, pause
    const lastAdminManual = msgs.find(
      (m) => m.sender === "admin" && !m.is_auto_reply,
    );
    if (lastAdminManual && now - new Date(lastAdminManual.created_at).getTime() < ADMIN_HANDOFF_PAUSE_MS) {
      return { skipped: "admin_handoff" };
    }

    // Cool-down: skip if we just auto-replied
    const lastAuto = msgs.find((m) => m.is_auto_reply);
    if (lastAuto && now - new Date(lastAuto.created_at).getTime() < AUTO_REPLY_COOLDOWN_MS) {
      return { skipped: "cooldown" };
    }

    async function post(reply: string) {
      await supabaseAdmin.from("support_messages").insert({
        conversation_id: data.conversationId,
        user_id: data.userId,
        user_email: data.userEmail ?? null,
        type: "chat",
        message: reply,
        sender: "admin",
        is_auto_reply: true,
      });
    }

    // Layer 1: keyword rules
    const { data: rulesData } = await supabaseAdmin
      .from("support_autoreply_rules")
      .select("triggers, response")
      .order("sort_order", { ascending: true });
    const rules = (rulesData ?? []) as Rule[];
    const hit = matchRule(data.latestMessage, rules);
    if (hit) {
      await post(hit.response);
      return { replied: "rule", reply: hit.response };
    }

    // Layer 2: Lovable AI fallback
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { skipped: "no_ai_key" };

    // Build short conversation history (chronological)
    // Build full conversation history (chronological) so the bot has full context
    const history = [...msgs]
      .reverse()
      .map((m) => ({
        role: m.sender === "user" ? ("user" as const) : ("assistant" as const),
        content: m.message,
      }));
    // Ensure latest user message is included
    if (!history.length || history[history.length - 1].content !== data.latestMessage) {
      history.push({ role: "user", content: data.latestMessage });
    }

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
        },
        body: JSON.stringify({
          model: "google/gemini-3.1-flash-lite",
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });
      if (!resp.ok) {
        console.warn("autoreply gateway error", resp.status, await resp.text().catch(() => ""));
        return { skipped: "ai_error" };
      }
      const json: any = await resp.json();
      const text: string = (json?.choices?.[0]?.message?.content ?? "").trim();
      if (!text || text.toUpperCase().includes("HANDOFF")) {
        return { skipped: "handoff" };
      }
      await post(text);
      return { replied: "ai", reply: text };
    } catch (err) {
      console.warn("autoreply exception", err);
      return { skipped: "exception" };
    }
  });

// ---- Admin management ----

export const getAutoReplyConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: setting }, { data: rules }] = await Promise.all([
      supabaseAdmin.from("site_settings").select("value").eq("key", "autoreply_enabled").maybeSingle(),
      supabaseAdmin
        .from("support_autoreply_rules")
        .select("id, triggers, response, sort_order")
        .order("sort_order", { ascending: true }),
    ]);
    return {
      enabled: Boolean(setting?.value),
      rules: (rules ?? []) as { id: string; triggers: string[]; response: string; sort_order: number }[],
    };
  });


const SetEnabledInput = z.object({ enabled: z.boolean() });

export const setAutoReplyEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => SetEnabledInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("site_settings")
      .upsert({ key: "autoreply_enabled", value: data.enabled }, { onConflict: "key" });
    return { enabled: data.enabled };
  });

const RuleInput = z.object({
  id: z.string().uuid().optional(),
  triggers: z.array(z.string().min(1)).min(1),
  response: z.string().min(1),
  sort_order: z.number().int().optional(),
});

export const upsertAutoReplyRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => RuleInput.parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      const { error } = await supabaseAdmin
        .from("support_autoreply_rules")
        .update({
          triggers: data.triggers,
          response: data.response,
          sort_order: data.sort_order ?? 100,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: inserted, error } = await supabaseAdmin
      .from("support_autoreply_rules")
      .insert({ triggers: data.triggers, response: data.response, sort_order: data.sort_order ?? 100 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

export const deleteAutoReplyRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("support_autoreply_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

