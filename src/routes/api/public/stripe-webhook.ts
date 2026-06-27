import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { creditStripeSession } from "@/lib/payments.functions";

/**
 * Stripe webhook signature verification — manual implementation so we don't
 * pull in the `stripe` npm package (which has Node-only deps that don't work
 * cleanly in the Worker runtime).
 *
 * Header shape:  t=<unix_ts>,v1=<hex_sig>,v1=<hex_sig>,...
 * signed payload = `${t}.${rawBody}`, hashed HMAC-SHA256 with the secret.
 */
function verifyStripeSignature(rawBody: string, header: string, secret: string, toleranceSeconds = 300) {
  const parts = header.split(",").map((p) => p.trim());
  const tPart = parts.find((p) => p.startsWith("t="));
  const v1Parts = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!tPart || v1Parts.length === 0) return false;
  const timestamp = Number(tPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const expBuf = Buffer.from(expected, "utf8");
  return v1Parts.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  });
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Not configured", { status: 500 });

        const signature = request.headers.get("stripe-signature") ?? "";
        const rawBody = await request.text();

        if (!verifyStripeSignature(rawBody, signature, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: { type: string; data: { object: Record<string, unknown> } };
        try {
          event = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        // We only care about completed Checkout Sessions.
        if (event.type !== "checkout.session.completed") {
          return new Response(JSON.stringify({ ok: true, ignored: event.type }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const session = event.data.object as {
          id: string;
          payment_status?: string;
          amount_total?: number;
          currency?: string;
          metadata?: { user_id?: string; pack_id?: string };
          client_reference_id?: string;
        };

        if (session.payment_status !== "paid") {
          return new Response(JSON.stringify({ ok: true, ignored: "unpaid" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const userId = session.metadata?.user_id ?? session.client_reference_id ?? "";
        const packId = session.metadata?.pack_id ?? "";
        const amountPaidUsd = (session.amount_total ?? 0) / 100;

        if (!userId || !packId) {
          console.error("Stripe webhook missing metadata", { sessionId: session.id });
          return new Response("Missing metadata", { status: 400 });
        }

        try {
          const result = await creditStripeSession({
            sessionId: session.id,
            userId,
            packId,
            amountPaidUsd,
          });
          return new Response(JSON.stringify({ ok: true, ...result }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "error";
          console.error("Stripe webhook credit failed:", msg, { sessionId: session.id });
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
