import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotInMaintenance } from "@/lib/site-settings.functions";

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
  .handler(async ({ context }) => {
    await assertNotInMaintenance("purchase", { userId: context.userId });
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    // Bind the txRef to the calling user AND derive packId from it.
    // Refs are built as `lumify_<packId>_<userIdPrefix8>_<ts>`.
    const expectedPrefix = userId.slice(0, 8).toLowerCase();
    const refMatch = /^lumify_(starter|basic|pro|enterprise)_([a-f0-9]{8})_\d+$/.exec(
      data.txRef.toLowerCase(),
    );
    if (!refMatch || refMatch[2] !== expectedPrefix) {
      throw new Error("Transaction reference does not belong to this account");
    }
    const packId = refMatch[1] as keyof typeof PACKS;
    const pack = PACKS[packId];

    // GLOBAL idempotency — a Flutterwave txRef can only ever be credited once.
    // Uses the append-only payment_receipts table (no user-facing access), so
    // wiping billing history cannot clear the marker and enable a replay.
    const marker = `Flutterwave:${data.txRef}`;
    const { data: existingReceipt, error: existingReceiptErr } = await supabaseAdmin
      .from("payment_receipts")
      .select("id, user_id")
      .eq("provider", "flutterwave")
      .eq("reference", data.txRef)
      .maybeSingle();
    if (existingReceiptErr) throw new Error(existingReceiptErr.message);
    if (existingReceipt) {
      if (existingReceipt.user_id === userId) return { ok: true, alreadyCredited: true, packId };
      throw new Error("This payment reference has already been credited to another account");
    }

    const verifyUrl = `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(data.transactionId)}/verify`;
    const res = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) throw new Error(`Flutterwave verification failed (${res.status})`);

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
    if (payload.status !== "success" || !tx) throw new Error("Payment could not be verified");
    if (tx.status !== "successful") throw new Error("Payment was not successful");
    if (tx.currency !== "NGN") throw new Error("Unexpected currency");
    if (tx.tx_ref !== data.txRef) throw new Error("Reference mismatch");
    if (Number(tx.amount) < pack.amountNgn) {
      throw new Error("Payment amount does not match selected pack");
    }

    // Reserve the receipt FIRST — the unique (provider, reference) constraint is
    // the authoritative replay guard. If a concurrent call already reserved it,
    // this throws and we bail without crediting again.
    const { error: receiptErr } = await supabaseAdmin
      .from("payment_receipts")
      .insert({
        provider: "flutterwave",
        reference: data.txRef,
        user_id: userId,
        credits: pack.credits,
        amount_ngn: pack.amountNgn,
        description: `Credit purchase — ${pack.name} pack (${marker})`,
      });
    if (receiptErr) {
      if ((receiptErr as { code?: string }).code === "23505") {
        return { ok: true, alreadyCredited: true, packId };
      }
      throw new Error(receiptErr.message);
    }

    const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
      p_user_id: userId,
      p_credits: pack.credits,
      p_amount: pack.amountNgn,
      p_description: `Credit purchase — ${pack.name} pack (${marker})`,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    return { ok: true, alreadyCredited: false, packId };
  });

/**
 * Initialize a Flutterwave hosted checkout and return the redirect URL.
 * Flow: user is redirected to `link` → pays → Flutterwave redirects back to
 * `/credits?flutterwave=1&status=&tx_ref=&transaction_id=` → we verify.
 */
export const createFlutterwaveCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        packId: z.enum(["starter", "basic", "pro", "enterprise"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertNotInMaintenance("purchase", { userId: context.userId });
    const { userId } = context;
    const pack = PACKS[data.packId];
    const secret = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured (missing FLUTTERWAVE_SECRET_KEY)");

    const appUrl = (process.env.PUBLIC_APP_URL || "https://lumifylive.com").replace(/\/$/, "");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    const email = profile?.email;
    if (!email) throw new Error("Missing account email");

    // Bind reference to the caller (verify enforces the same rule).
    const txRef = `lumify_${data.packId}_${userId.slice(0, 8)}_${Date.now()}`;

    const res = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tx_ref: txRef,
        amount: pack.amountNgn,
        currency: "NGN",
        redirect_url: `${appUrl}/credits?flutterwave=1`,
        customer: { email },
        customizations: {
          title: "Lumify Credits",
          description: `${pack.name} pack — ${pack.credits} credits`,
        },
        meta: {
          user_id: userId,
          pack_id: data.packId,
          credits: pack.credits,
          amount_ngn: pack.amountNgn,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Flutterwave init failed (${res.status}) ${text.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      status: string;
      message: string;
      data?: { link: string };
    };
    if (payload.status !== "success" || !payload.data?.link) {
      throw new Error(payload.message || "Flutterwave returned no checkout URL");
    }
    return { checkoutUrl: payload.data.link, reference: txRef };
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
    await assertNotInMaintenance("purchase", { userId: context.userId });
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
        ipn_callback_url: `${(process.env.PUBLIC_APP_URL ?? origin).replace(/\/$/, "")}/api/public/nowpayments-ipn`,
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

    // Log invoice creation so admins can see who started crypto checkout
    // and whether it ever completed.
    await supabaseAdmin.from("crypto_invoices").insert({
      user_id: userId,
      order_id: orderId,
      pack_id: data.packId,
      credits: pack.credits,
      price_usd: priceUsd,
      amount_ngn: pack.amountNgn,
      status: "pending",
      invoice_url: payload.invoice_url,
    });

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
  if (existing) {
    await supabaseAdmin
      .from("crypto_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("order_id", orderId);
    return { alreadyCredited: true };
  }

  const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
    p_user_id: userId,
    p_credits: pack.credits,
    p_amount: pack.amountNgn,
    p_description: `Credit purchase — ${pack.name} pack (${marker})`,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  await supabaseAdmin
    .from("crypto_invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("order_id", orderId);

  return { alreadyCredited: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// User-facing payment issue reporting
// ─────────────────────────────────────────────────────────────────────────────

export const reportPaymentIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        method: z.enum(["crypto", "card", "other"]),
        message: z.string().min(5).max(2000),
        orderReference: z.string().max(200).optional().nullable(),
        packId: z.enum(["starter", "basic", "pro", "enterprise"]).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.from("payment_issues").insert({
      user_id: context.userId,
      method: data.method,
      message: data.message,
      order_reference: data.orderReference ?? null,
      pack_id: data.packId ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });




// ─────────────────────────────────────────────────────────────────────────────
// Cryptomus (crypto) — replaces the NOWPayments checkout on the credits page.
// Flow: createCryptomusInvoice → user redirected to hosted checkout →
// Cryptomus fires webhook to /api/public/cryptomus-ipn → we credit the user.
// ─────────────────────────────────────────────────────────────────────────────

export const createCryptomusInvoice = createServerFn({ method: "POST" })
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
    await assertNotInMaintenance("purchase", { userId: context.userId });
    const { userId } = context;
    const pack = PACKS[data.packId];
    const merchant = process.env.CRYPTOMUS_MERCHANT_ID;
    const apiKey = process.env.CRYPTOMUS_PAYMENT_API_KEY;
    if (!merchant || !apiKey) throw new Error("Crypto payments not configured");

    // NGN → USD (Cryptomus invoices in fiat, buyer settles in crypto of their choice).
    const priceUsd = Math.max(1, Math.round((pack.amountNgn / NGN_PER_USD) * 100) / 100);

    const orderId = `lumify_${data.packId}_${userId.slice(0, 8)}_${Date.now()}`;
    const origin = data.returnOrigin.replace(/\/$/, "");

    const payload = {
      amount: priceUsd.toFixed(2),
      currency: "USD",
      order_id: orderId,
      url_return: `${origin}/credits?crypto=cancel`,
      url_success: `${origin}/credits?crypto=success&order=${encodeURIComponent(orderId)}`,
      url_callback: `${(process.env.PUBLIC_APP_URL ?? origin).replace(/\/$/, "")}/api/public/cryptomus-ipn`,
      lifetime: 3600,
    };

    const body = JSON.stringify(payload);
    const { createHash } = await import("crypto");
    const b64 = Buffer.from(body, "utf8").toString("base64");
    const sign = createHash("md5").update(b64 + apiKey).digest("hex");

    const res = await fetch("https://api.cryptomus.com/v1/payment", {
      method: "POST",
      headers: {
        merchant,
        sign,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to create crypto invoice (${res.status}) ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      state?: number;
      result?: { url?: string; uuid?: string; order_id?: string };
      message?: string;
    };
    const invoiceUrl = json?.result?.url;
    if (!invoiceUrl) throw new Error(json?.message || "Cryptomus returned no invoice URL");

    await supabaseAdmin.from("crypto_invoices").insert({
      user_id: userId,
      order_id: orderId,
      pack_id: data.packId,
      credits: pack.credits,
      price_usd: priceUsd,
      amount_ngn: pack.amountNgn,
      status: "pending",
      invoice_url: invoiceUrl,
    });

    return { invoiceUrl, orderId, priceUsd };
  });

/**
 * Called from the Cryptomus webhook after signature verification.
 * Idempotent: keyed on our order_id.
 */
export async function creditCryptomusOrder(opts: {
  orderId: string;
  paidUsd: number;
}) {
  const { orderId, paidUsd } = opts;
  const m = /^lumify_(starter|basic|pro|enterprise)_([a-f0-9]{8})_\d+$/.exec(orderId);
  if (!m) throw new Error(`Unrecognized order_id: ${orderId}`);
  const packId = m[1] as keyof typeof PACKS;
  const userPrefix = m[2];
  const pack = PACKS[packId];

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

  const expectedUsd = pack.amountNgn / NGN_PER_USD;
  if (paidUsd + 0.01 < expectedUsd * 0.98) {
    throw new Error(`Underpaid: got $${paidUsd}, expected ~$${expectedUsd.toFixed(2)}`);
  }

  const marker = `Cryptomus:${orderId}`;
  const { data: existing } = await supabaseAdmin
    .from("transactions")
    .select("id")
    .eq("user_id", userId)
    .like("description", `%${marker}%`)
    .maybeSingle();
  if (existing) {
    await supabaseAdmin
      .from("crypto_invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("order_id", orderId);
    return { alreadyCredited: true };
  }

  const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
    p_user_id: userId,
    p_credits: pack.credits,
    p_amount: pack.amountNgn,
    p_description: `Credit purchase — ${pack.name} pack (${marker})`,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  await supabaseAdmin
    .from("crypto_invoices")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("order_id", orderId);

  return { alreadyCredited: false };
}




// ─────────────────────────────────────────────────────────────────────────────
// Admin reconcile — manually re-check a NOWPayments order and credit the user
// if NOWPayments confirms the payment but our IPN was missed.
// ─────────────────────────────────────────────────────────────────────────────

type AdminReconcileResult = {
  ok: boolean;
  alreadyCredited: boolean;
  orderId: string;
  userEmail: string | null;
  packId: string;
  credits: number;
  paymentStatus: string;
  paidUsd: number;
  message: string;
};

async function ensureCallerIsAdmin(userId: string) {
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!prof?.is_admin) throw new Error("Not authorized");
}

// NOWPayments JWT cache — tokens last ~5 min; refresh on demand.
let _npJwt: { token: string; expiresAt: number } | null = null;
async function getNowPaymentsJwt(): Promise<string> {
  if (_npJwt && _npJwt.expiresAt > Date.now() + 10_000) return _npJwt.token;
  const email = process.env.NOWPAYMENTS_EMAIL;
  const password = process.env.NOWPAYMENTS_PASSWORD;
  if (!email || !password) {
    throw new Error("NOWPAYMENTS_EMAIL / NOWPAYMENTS_PASSWORD not configured");
  }
  const res = await fetch("https://api.nowpayments.io/v1/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`NOWPayments auth failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const payload = (await res.json()) as { token?: string };
  if (!payload.token) throw new Error("NOWPayments auth returned no token");
  _npJwt = { token: payload.token, expiresAt: Date.now() + 4 * 60_000 };
  return payload.token;
}

async function fetchNowPaymentsByOrderId(orderId: string) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY not configured");
  const jwt = await getNowPaymentsJwt();
  // List endpoint doesn't support filtering by order_id — fetch a page of
  // recent payments and filter locally. Widen the window to be safe.
  const url = `https://api.nowpayments.io/v1/payment/?limit=500&page=0&sortBy=created_at&orderBy=desc`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`NOWPayments lookup failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    data?: Array<{
      payment_id: number | string;
      payment_status: string;
      price_amount: number;
      price_currency: string;
      actually_paid?: number;
      pay_amount?: number;
      order_id: string;
    }>;
  };
  return (payload.data ?? []).filter((p) => p.order_id === orderId);
};

async function reconcileOrderInternal(orderId: string): Promise<AdminReconcileResult> {
  const { data: invoice } = await supabaseAdmin
    .from("crypto_invoices")
    .select("user_id,pack_id,credits,price_usd,status,order_id")
    .eq("order_id", orderId)
    .maybeSingle();

  const payments = await fetchNowPaymentsByOrderId(orderId);
  // Prefer a terminal-success payment if one exists
  const success = payments.find((p) =>
    ["finished", "confirmed", "sending"].includes(String(p.payment_status))
  );
  const latest = success ?? payments[0];

  const userEmail = invoice
    ? (await supabaseAdmin.from("profiles").select("email").eq("id", invoice.user_id).maybeSingle()).data?.email ?? null
    : null;

  if (!latest) {
    return {
      ok: false,
      alreadyCredited: false,
      orderId,
      userEmail,
      packId: invoice?.pack_id ?? "?",
      credits: invoice?.credits ?? 0,
      paymentStatus: "not_found",
      paidUsd: 0,
      message: "NOWPayments has no payment recorded for this order id.",
    };
  }

  const paidUsd = Number(latest.price_amount ?? invoice?.price_usd ?? 0);

  if (!success) {
    return {
      ok: false,
      alreadyCredited: false,
      orderId,
      userEmail,
      packId: invoice?.pack_id ?? "?",
      credits: invoice?.credits ?? 0,
      paymentStatus: latest.payment_status,
      paidUsd,
      message: `Payment is not yet in a success state (status: ${latest.payment_status}). Try again later.`,
    };
  }

  const result = await creditNowPaymentsOrder({ orderId, paidUsd });
  return {
    ok: true,
    alreadyCredited: result.alreadyCredited,
    orderId,
    userEmail,
    packId: invoice?.pack_id ?? "?",
    credits: invoice?.credits ?? 0,
    paymentStatus: latest.payment_status,
    paidUsd,
    message: result.alreadyCredited
      ? "Already credited previously — no change made."
      : `Credited ${invoice?.credits ?? 0} credits to user.`,
  };
}

export const adminReconcileCryptoByOrderId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderId: z.string().min(6).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await ensureCallerIsAdmin(context.userId);
    return reconcileOrderInternal(data.orderId.trim());
  });

export const adminListPendingCryptoForEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ email: z.string().email() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await ensureCallerIsAdmin(context.userId);
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id,email")
      .ilike("email", data.email.trim())
      .maybeSingle();
    if (!prof) return { user: null, invoices: [] as Array<{ order_id: string; pack_id: string; credits: number; price_usd: number; status: string; created_at: string }> };
    const { data: invoices } = await supabaseAdmin
      .from("crypto_invoices")
      .select("order_id,pack_id,credits,price_usd,status,created_at")
      .eq("user_id", prof.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return { user: { id: prof.id, email: prof.email }, invoices: invoices ?? [] };
  });


