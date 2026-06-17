import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// NGN → USD conversion used when invoicing crypto (NOWPayments prices in USD).
// Tunable via env so we can react to FX moves without a code change.
const NGN_PER_USD = Number(process.env.NGN_PER_USD ?? 1600);



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

// ─────────────────────────────────────────────────────────────────────────────
// NOWPayments (crypto) — runs alongside Flutterwave.
// Flow: createNowPaymentsInvoice → user is redirected to hosted checkout →
// NOWPayments fires IPN to /api/public/nowpayments-ipn → we credit the user.
// ─────────────────────────────────────────────────────────────────────────────

export const createNowPaymentsInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        packId: z.enum(["starter", "basic", "pro", "enterprise"]),
        returnOrigin: z.string().url(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const pack = PACKS[data.packId];
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (!apiKey) throw new Error("Crypto payments not configured");

    // Convert NGN → USD (NOWPayments invoices in fiat, settles in crypto).
    const priceUsd = Math.max(1, Math.round((pack.amountNgn / NGN_PER_USD) * 100) / 100);
    // NOWPayments rejects invoices under ~$10 (varies per coin). Block early.
    if (priceUsd < 10) {
      throw new Error(
        `Crypto payments require a minimum of about $10. The ${pack.name} pack is only ~$${priceUsd.toFixed(2)}. Please choose a larger pack.`,
      );
    }

    const orderId = `lumify_${data.packId}_${userId.slice(0, 8)}_${Date.now()}`;
    const origin = data.returnOrigin.replace(/\/$/, "");

    const res = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: priceUsd,
        price_currency: "usd",
        order_id: orderId,
        order_description: `Lumify Credits — ${pack.name} pack (${pack.credits} credits)`,
        ipn_callback_url: `${origin}/api/public/nowpayments-ipn`,
        success_url: `${origin}/credits?crypto=success&order=${encodeURIComponent(orderId)}`,
        cancel_url: `${origin}/credits?crypto=cancel`,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to create crypto invoice (${res.status}) ${text.slice(0, 200)}`);
    }

    const payload = (await res.json()) as { id: string; invoice_url: string };
    if (!payload?.invoice_url) throw new Error("NOWPayments returned no invoice URL");

    return { invoiceUrl: payload.invoice_url, orderId, priceUsd };
  });

/**
 * Helper used by the IPN webhook (NOT exported as a server fn — called from
 * the public webhook route after HMAC verification). Credits the user by
 * parsing packId + userId prefix from the order_id we generated.
 */
export async function creditNowPaymentsOrder(opts: {
  orderId: string;
  paidUsd: number;
}) {
  const { orderId, paidUsd } = opts;
  // orderId shape: lumify_<packId>_<userIdPrefix8>_<ts>
  const m = /^lumify_(starter|basic|pro|enterprise)_([a-f0-9]{8})_\d+$/.exec(orderId);
  if (!m) throw new Error(`Unrecognized order_id: ${orderId}`);
  const packId = m[1] as keyof typeof PACKS;
  const userPrefix = m[2];
  const pack = PACKS[packId];

  // Resolve full user id from the 8-char prefix.
  const { data: profile, error: profErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .like("id", `${userPrefix}%`)
    .limit(2);
  if (profErr) throw new Error(profErr.message);
  if (!profile || profile.length !== 1) {
    throw new Error(`Could not resolve user for order ${orderId} (matches: ${profile?.length ?? 0})`);
  }
  const userId = profile[0].id as string;

  // Validate amount paid covers pack price (allow 2% slack for FX drift).
  const expectedUsd = pack.amountNgn / NGN_PER_USD;
  if (paidUsd + 0.01 < expectedUsd * 0.98) {
    throw new Error(`Underpaid: got $${paidUsd}, expected ~$${expectedUsd.toFixed(2)}`);
  }

  // Idempotency
  const marker = `NOWPayments:${orderId}`;
  const { data: existing } = await supabaseAdmin
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .like("description", `%${marker}%`)
    .maybeSingle();
  if (existing) return { alreadyCredited: true };

  const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
    p_user_id: userId,
    p_credits: pack.credits,
    p_amount: pack.amountNgn,
    p_description: `Credit purchase — ${pack.name} pack (${marker})`,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  return { alreadyCredited: false };
}
