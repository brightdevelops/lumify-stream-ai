import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { creditNowPaymentsOrder } from "@/lib/payments.functions";

/**
 * Sort object keys recursively, then JSON.stringify — this is the exact
 * canonicalization NOWPayments uses when computing the HMAC-SHA512 signature
 * sent in the `x-nowpayments-sig` header.
 */
function sortedStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(sortedStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${sortedStringify(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const Route = createFileRoute("/api/public/nowpayments-ipn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.NOWPAYMENTS_IPN_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const signature = request.headers.get("x-nowpayments-sig") ?? "";
        const rawBody = await request.text();

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const expected = createHmac("sha512", secret)
          .update(sortedStringify(parsed))
          .digest("hex");

        const sigBuf = Buffer.from(signature, "utf8");
        const expBuf = Buffer.from(expected, "utf8");
        if (
          sigBuf.length !== expBuf.length ||
          !timingSafeEqual(sigBuf, expBuf)
        ) {
          return new Response("Invalid signature", { status: 401 });
        }

        const status = String(parsed.payment_status ?? "");
        const orderId = String(parsed.order_id ?? "");
        const paidUsd = Number(parsed.price_amount ?? 0);

        // Only credit on terminal success states.
        if (status !== "finished" && status !== "confirmed") {
          return new Response(JSON.stringify({ ok: true, ignored: status }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await creditNowPaymentsOrder({ orderId, paidUsd });
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "error";
          console.error("NOWPayments IPN credit failed:", msg, { orderId });
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
