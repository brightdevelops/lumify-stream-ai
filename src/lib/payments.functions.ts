import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-authoritative price table — amounts in NGN (major units)
const PACKS: Record<string, { name: string; credits: number; amountNgn: number }> = {
  starter: { name: "Starter", credits: 500, amountNgn: 11_500 },
  basic: { name: "Basic", credits: 1000, amountNgn: 23_000 },
  pro: { name: "Pro", credits: 2000, amountNgn: 46_000 },
  enterprise: { name: "Enterprise", credits: 5000, amountNgn: 115_000 },
};

/**
 * Returns the Paystack PUBLIC key to the browser so it can open the
 * inline checkout. The SECRET key never leaves the server.
 */
export const getPaystackPublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.PAYSTACK_PUBLIC_KEY;
    if (!key) throw new Error("Payment provider not configured (missing PAYSTACK_PUBLIC_KEY)");
    return { publicKey: key };
  });

/**
 * Server-side verification of a Paystack checkout.
 *
 * Security:
 *  - Uses PAYSTACK_SECRET_KEY (server-only) to call Paystack's verify
 *    endpoint and confirm the payment actually succeeded.
 *  - Re-validates currency (NGN) and amount against the server-authoritative
 *    price table. Paystack returns amounts in kobo (NGN * 100).
 *  - Idempotent: we record `Paystack:<reference>` in transactions.description
 *    and bail out early if the same reference has already been credited.
 */
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

    // Idempotency check first
    const marker = `Paystack:${data.reference}`;
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .like("description", `%${marker}%`)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) return { ok: true, alreadyCredited: true };

    const verifyUrl = `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`;
    const res = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) throw new Error(`Paystack verification failed (${res.status})`);

    const payload = (await res.json()) as {
      status: boolean;
      data?: {
        status: string;
        amount: number; // kobo
        currency: string;
        reference: string;
      };
    };
    const tx = payload?.data;
    if (!payload.status || !tx) throw new Error("Payment could not be verified");
    if (tx.status !== "success") throw new Error("Payment was not successful");
    if (tx.currency !== "NGN") throw new Error("Unexpected currency");
    if (tx.reference !== data.reference) throw new Error("Reference mismatch");
    // Paystack amount is in kobo
    if (Number(tx.amount) < pack.amountNgn * 100) {
      throw new Error("Payment amount does not match selected pack");
    }

    const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
      p_user_id: userId,
      p_credits: pack.credits,
      p_amount: pack.amountNgn,
      p_description: `Credit purchase — ${pack.name} pack (${marker})`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return { ok: true, alreadyCredited: false };
  });
