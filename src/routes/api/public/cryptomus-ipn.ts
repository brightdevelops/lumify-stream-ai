import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { creditCryptomusOrder } from "@/lib/payments.functions";

/**
 * Cryptomus webhook.
 *
 * Signature scheme (per Cryptomus docs):
 *   sign = md5( base64( json_body_without_sign_field ) + PAYMENT_API_KEY )
 *
 * The `sign` field is included IN the JSON body — we strip it before hashing.
 */
export const Route = createFileRoute("/api/public/cryptomus-ipn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.CRYPTOMUS_PAYMENT_API_KEY;
        if (!apiKey) return new Response("Not configured", { status: 500 });

        const rawBody = await request.text();
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const receivedSign = String(parsed.sign ?? "");
        if (!receivedSign) return new Response("Missing sign", { status: 401 });

        // Rebuild the body without `sign` and hash the same way Cryptomus does.
        const { sign: _drop, ...rest } = parsed;
        void _drop;
        const bodyForHash = JSON.stringify(rest).replace(/\//g, "\\/");
        const b64 = Buffer.from(bodyForHash, "utf8").toString("base64");
        const expected = createHash("md5").update(b64 + apiKey).digest("hex");

        if (expected !== receivedSign) {
          // Fallback: some serializers don't escape forward slashes.
          const b64Alt = Buffer.from(JSON.stringify(rest), "utf8").toString("base64");
          const expectedAlt = createHash("md5").update(b64Alt + apiKey).digest("hex");
          if (expectedAlt !== receivedSign) {
            return new Response("Invalid signature", { status: 401 });
          }
        }

        const status = String(parsed.status ?? "");
        const orderId = String(parsed.order_id ?? "");
        // Cryptomus sends the paid fiat amount in `payment_amount` (string).
        const paidUsd = Number(parsed.payment_amount ?? parsed.amount ?? 0);

        // Terminal success states in Cryptomus:
        //   paid, paid_over — credit the user.
        // Everything else (process, check, fail, cancel, wrong_amount, refund_*)
        // is a no-op for crediting.
        if (status !== "paid" && status !== "paid_over") {
          return new Response(JSON.stringify({ ok: true, ignored: status }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await creditCryptomusOrder({ orderId, paidUsd });
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "error";
          console.error("Cryptomus IPN credit failed:", msg, { orderId });
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
