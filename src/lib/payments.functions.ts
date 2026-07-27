import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotInMaintenance } from "@/lib/site-settings.functions";

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
 *  - Idempotent via the append-only `payment_receipts` table.
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
// User-facing payment issue reporting
// ─────────────────────────────────────────────────────────────────────────────

export const reportPaymentIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        method: z.enum(["flutterwave", "korapay", "other"]),
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
// Korapay (hosted checkout, NGN) — mirrors the Flutterwave pattern.
// Flow: init → user redirected to Korapay checkout → returns to
// `/credits?korapay=1&reference=<ref>` → we verify server-side and credit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize a Korapay hosted checkout and return the redirect URL.
 */
export const createKorapayCheckout = createServerFn({ method: "POST" })
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
    const secret = process.env.KORAPAY_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured (missing KORAPAY_SECRET_KEY)");

    const appUrl = (process.env.PUBLIC_APP_URL || "https://lumifylive.com").replace(/\/$/, "");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name")
      .eq("id", userId)
      .maybeSingle();
    const email = profile?.email;
    if (!email) throw new Error("Missing account email");

    // Bind reference to the caller (verify enforces the same rule).
    const reference = `lumify_${data.packId}_${userId.slice(0, 8)}_${Date.now()}`;

    const res = await fetch("https://api.korapay.com/merchant/api/v1/charges/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: pack.amountNgn,
        redirect_url: `${appUrl}/credits?korapay=1`,
        currency: "NGN",
        reference,
        narration: `Lumify ${pack.name} pack — ${pack.credits} credits`,
        channels: ["card", "bank_transfer", "mobile_money"],
        customer: {
          email,
          name: profile?.full_name || email,
        },
        metadata: {
          user_id: userId,
          pack_id: data.packId,
          credits: pack.credits,
          amount_ngn: pack.amountNgn,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Korapay init failed (${res.status}) ${text.slice(0, 200)}`);
    }

    const payload = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: { checkout_url?: string; reference?: string };
    };
    if (!payload.status || !payload.data?.checkout_url) {
      throw new Error(payload.message || "Korapay returned no checkout URL");
    }
    return { checkoutUrl: payload.data.checkout_url, reference };
  });

/**
 * Server-side verification of a Korapay checkout.
 * Idempotent via the append-only `payment_receipts` table.
 */
export const verifyKorapayAndCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reference: z.string().min(6).max(128).regex(/^[a-zA-Z0-9_\-\.]+$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const secret = process.env.KORAPAY_SECRET_KEY;
    if (!secret) throw new Error("Payment provider not configured");

    const expectedPrefix = userId.slice(0, 8).toLowerCase();
    const refMatch = /^lumify_(starter|basic|pro|enterprise)_([a-f0-9]{8})_\d+$/.exec(
      data.reference.toLowerCase(),
    );
    if (!refMatch || refMatch[2] !== expectedPrefix) {
      throw new Error("Transaction reference does not belong to this account");
    }
    const packId = refMatch[1] as keyof typeof PACKS;
    const pack = PACKS[packId];

    const marker = `Korapay:${data.reference}`;
    const { data: existingReceipt, error: existingReceiptErr } = await supabaseAdmin
      .from("payment_receipts")
      .select("id, user_id")
      .eq("provider", "korapay")
      .eq("reference", data.reference)
      .maybeSingle();
    if (existingReceiptErr) throw new Error(existingReceiptErr.message);
    if (existingReceipt) {
      if (existingReceipt.user_id === userId) return { ok: true, alreadyCredited: true, packId };
      throw new Error("This payment reference has already been credited to another account");
    }

    const verifyUrl = `https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(data.reference)}`;
    const res = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!res.ok) throw new Error(`Korapay verification failed (${res.status})`);

    const payload = (await res.json()) as {
      status: boolean;
      message?: string;
      data?: {
        status?: string;
        amount?: number | string;
        currency?: string;
        reference?: string;
      };
    };
    const tx = payload?.data;
    if (!payload.status || !tx) throw new Error("Payment could not be verified");
    if ((tx.status || "").toLowerCase() !== "success") throw new Error("Payment was not successful");
    if (tx.currency !== "NGN") throw new Error("Unexpected currency");
    if (tx.reference !== data.reference) throw new Error("Reference mismatch");
    if (Number(tx.amount) < pack.amountNgn) {
      throw new Error("Payment amount does not match selected pack");
    }

    const { error: receiptErr } = await supabaseAdmin
      .from("payment_receipts")
      .insert({
        provider: "korapay",
        reference: data.reference,
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

