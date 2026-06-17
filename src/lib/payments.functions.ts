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
 * Returns the Flutterwave PUBLIC key to the browser so it can open the
 * inline checkout. The SECRET key never leaves the server.
 */
export const getFlutterwavePublicKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const key = process.env.FLUTTERWAVE_PUBLIC_KEY;
    if (!key) throw new Error("Payment provider not configured (missing FLUTTERWAVE_PUBLIC_KEY)");
    return { publicKey: key };
  });

/**
 * Server-side verification of a Flutterwave checkout.
 *
 * Security:
 *  - Uses FLUTTERWAVE_SECRET_KEY (server-only) to call Flutterwave's verify
 *    endpoint and confirm the payment actually succeeded.
 *  - Re-validates currency (NGN) and amount against the server-authoritative
 *    price table.
 *  - Idempotent: we record `Flutterwave:<tx_ref>` in transactions.description
 *    and bail out early if the same reference has already been credited.
 */
export const verifyFlutterwaveAndCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        transactionId: z.union([z.string(), z.number()]).transform((v) => String(v)),
        txRef: z.string().min(6).max(128).regex(/^[a-zA-Z0-9_\-\.]+$/),
        packId: z.enum(["starter", "basic", "pro", "enterprise"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = PACKS[data.packId];
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    // Idempotency check first
    const marker = `Flutterwave:${data.txRef}`;
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("user_id", userId)
      .like("description", `%${marker}%`)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) return { ok: true, alreadyCredited: true };

    const verifyUrl = `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(data.transactionId)}/verify`;
    const res = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) throw new Error(`Flutterwave verification failed (${res.status})`);

    const payload = (await res.json()) as {
      status: string;
      data?: {
        status: string;
        amount: number; // in major units (NGN)
        currency: string;
        tx_ref: string;
      };
    };
    const tx = payload?.data;
    if (payload.status !== "success" || !tx) throw new Error("Payment could not be verified");
    if (tx.status !== "successful") throw new Error("Payment was not successful");
    if (tx.currency !== "NGN") throw new Error("Unexpected currency");
    if (tx.tx_ref !== data.txRef) throw new Error("Reference mismatch");
    if (Number(tx.amount) < pack.amountNgn) {
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
