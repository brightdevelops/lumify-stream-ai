import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-authoritative price table — amounts in kobo (NGN * 100)
const PACKS: Record<string, { name: string; credits: number; amountKobo: number }> = {
  starter: { name: "Starter", credits: 500, amountKobo: 1_150_000 },
  basic: { name: "Basic", credits: 1000, amountKobo: 2_300_000 },
  pro: { name: "Pro", credits: 2000, amountKobo: 4_600_000 },
  enterprise: { name: "Enterprise", credits: 5000, amountKobo: 11_500_000 },
};

export const verifyPaystackAndCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reference: z.string().min(6).max(128).regex(/^[a-zA-Z0-9_\-\.]+$/),
        packId: z.enum(["starter", "basic", "pro", "enterprise"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = PACKS[data.packId];
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) throw new Error(`Paystack verification failed (${res.status})`);

    const payload = (await res.json()) as {
      status: boolean;
      data?: { status: string; amount: number; currency: string; reference: string };
    };
    const tx = payload?.data;
    if (!payload.status || !tx || tx.status !== "success") {
      throw new Error("Payment was not successful");
    }
    if (tx.currency !== "NGN") throw new Error("Unexpected currency");
    if (Number(tx.amount) !== pack.amountKobo) {
      throw new Error("Payment amount does not match selected pack");
    }
    if (tx.reference !== data.reference) throw new Error("Reference mismatch");

    // Idempotency
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("description", `Paystack:${tx.reference}`)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) return { ok: true, alreadyCredited: true };

    const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
      p_user_id: userId,
      p_credits: pack.credits,
      p_amount: pack.amountKobo / 100,
      p_description: `Credit purchase — ${pack.name} pack (Paystack:${tx.reference})`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return { ok: true, alreadyCredited: false };
  });
