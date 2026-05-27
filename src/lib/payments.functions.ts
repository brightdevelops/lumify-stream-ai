import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Server-authoritative price table — must match the client UI
const PACKS: Record<string, { name: string; credits: number; price: number }> = {
  starter: { name: "Starter", credits: 500, price: 11500 },
  basic: { name: "Basic", credits: 1000, price: 23000 },
  pro: { name: "Pro", credits: 2000, price: 46000 },
  enterprise: { name: "Enterprise", credits: 5000, price: 115000 },
};

export const verifyFlutterwaveAndCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        txRef: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_\-]+$/),
        transactionId: z.union([z.string(), z.number()]).transform((v) => String(v)),
        packId: z.enum(["starter", "basic", "pro", "enterprise"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = PACKS[data.packId];
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    // Verify with Flutterwave by transaction id
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(data.transactionId)}/verify`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) {
      throw new Error(`Flutterwave verification failed (${res.status})`);
    }
    const payload = (await res.json()) as {
      status: string;
      data?: {
        status: string;
        amount: number;
        currency: string;
        tx_ref: string;
      };
    };

    const tx = payload?.data;
    if (payload.status !== "success" || !tx || tx.status !== "successful") {
      throw new Error("Payment was not successful");
    }
    if (tx.currency !== "NGN") {
      throw new Error("Unexpected currency");
    }
    if (Number(tx.amount) !== pack.price) {
      throw new Error("Payment amount does not match selected pack");
    }
    if (tx.tx_ref !== data.txRef) {
      throw new Error("Reference mismatch");
    }

    // Idempotency: refuse if this reference was already credited
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .eq("description", `Flutterwave:${tx.tx_ref}`)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) {
      return { ok: true, alreadyCredited: true };
    }

    const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
      p_user_id: userId,
      p_credits: pack.credits,
      p_amount: pack.price,
      p_description: `Credit purchase — ${pack.name} pack (Flutterwave:${tx.tx_ref})`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return { ok: true, alreadyCredited: false };
  });
