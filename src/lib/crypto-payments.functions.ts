import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertNotInMaintenance } from "@/lib/site-settings.functions";

/**
 * Creates a Cryptomus hosted invoice.
 *
 * The value of the order is decided HERE, server-side, and written to
 * `crypto_invoices` BEFORE the user pays. The webhook later grants exactly what
 * that row says — it never trusts the gateway payload for credits or price.
 */
export const createCryptomusInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ packageId: z.enum(["starter", "basic", "pro", "enterprise"]) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Crypto checkout is limited to a single allowlisted account for now.
    const email = String((context.claims as { email?: string } | undefined)?.email ?? "").toLowerCase();
    if (!CRYPTO_ALLOWED_EMAILS.includes(email)) {
      throw new Error("Crypto payments are not available on this account.");
    }

    await assertNotInMaintenance("purchase", { userId: context.userId });

    const {
      CRYPTO_PACKS,
      CRYPTOMUS_ENDPOINT,
      signRequest,
      fetchUsdNgnRate,
    } = await import("@/lib/crypto-payments.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const pkg = CRYPTO_PACKS[data.packageId]!;
    const merchant = process.env["CRYPTOMUS_MERCHANT_ID"];
    const apiKey = process.env["CRYPTOMUS_PAYMENT_API_KEY"];
    if (!merchant || !apiKey) {
      throw new Error("Crypto payments are not configured yet.");
    }

    // Fail closed: a stale hardcoded rate would silently mis-price every sale.
    const rate = await fetchUsdNgnRate();
    if (rate === null) {
      throw new Error("Crypto pricing is temporarily unavailable. Please try again shortly.");
    }

    const amountUsd = Math.max(1, Math.round((pkg.amountNgn / rate) * 100) / 100);
    const orderId = `order_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const appUrl = (process.env["PUBLIC_APP_URL"] || "https://lumifylive.com").replace(/\/$/, "");

    const { error: insertError } = await supabaseAdmin.from("crypto_invoices").insert({
      order_id: orderId,
      user_id: context.userId,
      package_id: data.packageId,
      credits: pkg.credits,
      amount_ngn: pkg.amountNgn,
      amount_usd: amountUsd,
      usd_ngn_rate: rate,
      status: "pending",
    });
    if (insertError) {
      console.error("[cryptomus] invoice insert failed:", insertError.message);
      throw new Error("Could not start the payment. Please try again.");
    }

    const payload = {
      amount: amountUsd.toFixed(2),
      currency: "USD",
      order_id: orderId,
      url_callback: `${appUrl}/api/public/cryptomus-webhook`,
      url_success: `${appUrl}/credits?crypto=success`,
      url_return: `${appUrl}/credits`,
    };
    const bodyStr = JSON.stringify(payload);

    const markFailed = async () => {
      await supabaseAdmin
        .from("crypto_invoices")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("order_id", orderId);
    };

    let result: { state?: number; result?: { url?: string; uuid?: string } };
    try {
      const res = await fetch(CRYPTOMUS_ENDPOINT, {
        method: "POST",
        headers: {
          merchant,
          sign: signRequest(bodyStr, apiKey),
          "Content-Type": "application/json",
        },
        body: bodyStr,
      });
      result = (await res.json()) as typeof result;
      if (!res.ok || result?.state !== 0 || !result?.result?.url) {
        console.error("[cryptomus] create failed:", res.status, JSON.stringify(result));
        await markFailed();
        throw new Error("Could not create the crypto invoice.");
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Could not create the crypto invoice.") throw err;
      console.error("[cryptomus] request error:", err);
      await markFailed();
      throw new Error("Could not reach the crypto payment service.");
    }

    await supabaseAdmin
      .from("crypto_invoices")
      .update({ cryptomus_uuid: result.result.uuid ?? null, updated_at: new Date().toISOString() })
      .eq("order_id", orderId);

    return { url: result.result.url!, orderId, amountUsd };
  });
