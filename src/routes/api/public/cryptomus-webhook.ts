import { createFileRoute } from "@tanstack/react-router";

const SUCCESS_STATUSES = new Set(["paid", "paid_over"]);
const FAILED_STATUSES = new Set(["fail", "cancel", "system_fail", "wrong_amount"]);

/**
 * Cryptomus payment callback. Authentication is the HMAC-style `sign` field —
 * external callers cannot send a Supabase JWT, so this lives under
 * /api/public/*, and the signature check is the security boundary.
 *
 * The payload only tells us WHICH order completed. How many credits to grant is
 * read from our own `crypto_invoices` row, written before the user paid.
 */
export const Route = createFileRoute("/api/public/cryptomus-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["CRYPTOMUS_PAYMENT_API_KEY"];
        if (!apiKey) return new Response("misconfigured", { status: 500 });

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(await request.text()) as Record<string, unknown>;
        } catch {
          return new Response("bad payload", { status: 400 });
        }

        const { verifyWebhookSignature } = await import("@/lib/crypto-payments.server");
        if (!verifyWebhookSignature(payload, apiKey)) {
          return new Response("invalid signature", { status: 401 });
        }

        const orderId = String(payload["order_id"] ?? "");
        const status = String(payload["status"] ?? "");
        const isFinal = payload["is_final"] === true || payload["is_final"] === "true";
        if (!orderId) return new Response("missing order_id", { status: 200 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: invoice } = await supabaseAdmin
          .from("crypto_invoices")
          .select("*")
          .eq("order_id", orderId)
          .maybeSingle();

        // Ack unknown orders with 200 so Cryptomus stops retrying something we
        // can never resolve.
        if (!invoice) {
          console.error("[cryptomus] unknown order_id", orderId);
          return new Response("unknown order", { status: 200 });
        }

        if (invoice.status === "completed") return new Response("ok", { status: 200 });

        if (!SUCCESS_STATUSES.has(status)) {
          if (FAILED_STATUSES.has(status) && isFinal) {
            await supabaseAdmin
              .from("crypto_invoices")
              .update({ status: "failed", updated_at: new Date().toISOString() })
              .eq("order_id", orderId);
          }
          return new Response("ignored", { status: 200 });
        }

        // The echoed invoice amount must match what we asked for. payment_amount
        // may exceed it for `paid_over`, which is fine.
        const echoed = Number(payload["amount"]);
        if (Number.isFinite(echoed) && Math.abs(echoed - Number(invoice.amount_usd)) > 0.01) {
          console.error(
            `[cryptomus] amount mismatch ${orderId}: got ${echoed}, expected ${invoice.amount_usd}`,
          );
          return new Response("amount mismatch", { status: 200 });
        }

        const description = `Credit purchase — ${invoice.package_id} pack (Cryptomus:${orderId})`;

        // Append-only receipt with a UNIQUE (provider, reference) constraint is
        // the double-credit defence. 23505 = already credited = success.
        const { error: receiptErr } = await supabaseAdmin.from("payment_receipts").insert({
          provider: "cryptomus",
          reference: orderId,
          user_id: invoice.user_id,
          credits: invoice.credits,
          amount_ngn: invoice.amount_ngn,
          description,
        });

        let alreadyCredited = false;
        if (receiptErr) {
          if ((receiptErr as { code?: string }).code === "23505") {
            alreadyCredited = true;
          } else {
            console.error("[cryptomus] receipt insert failed", receiptErr.message);
            return new Response("credit failed", { status: 500 });
          }
        }

        if (!alreadyCredited) {
          // Grant exactly what OUR row says — never anything from the payload.
          const { error: rpcErr } = await supabaseAdmin.rpc("purchase_credits_for_user", {
            p_user_id: invoice.user_id,
            p_credits: invoice.credits,
            p_amount: invoice.amount_ngn,
            p_description: description,
          });
          if (rpcErr) {
            console.error("[cryptomus] purchase_credits_for_user failed", rpcErr.message);
            // Real failure on a real payment: 500 so Cryptomus retries.
            return new Response("credit failed", { status: 500 });
          }
        }

        await supabaseAdmin
          .from("crypto_invoices")
          .update({
            status: "completed",
            payer_currency: (payload["payer_currency"] as string) ?? null,
            payment_amount: (payload["payment_amount"] as number) ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("order_id", orderId);

        return new Response("ok", { status: 200 });
      },
    },
  },
});
