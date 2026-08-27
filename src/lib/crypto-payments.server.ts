import { createHash } from "node:crypto";

/** Server-authoritative price table — the browser only ever sends a pack id. */
export const CRYPTO_PACKS: Record<
  string,
  { name: string; credits: number; amountNgn: number }
> = {
  starter: { name: "Starter", credits: 500, amountNgn: 11_500 },
  basic: { name: "Basic", credits: 1000, amountNgn: 23_000 },
  pro: { name: "Pro", credits: 2000, amountNgn: 46_000 },
  enterprise: { name: "Enterprise", credits: 5000, amountNgn: 115_000 },
};

export const CRYPTOMUS_ENDPOINT = "https://api.cryptomus.com/v1/payment";
const FX_ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const RATE_MIN = 800;
const RATE_MAX = 5000;

/** Outgoing request signature: md5( base64(exact body string) + PAYMENT_API_KEY ). */
export function signRequest(bodyStr: string, apiKey: string): string {
  return createHash("md5")
    .update(Buffer.from(bodyStr, "utf8").toString("base64") + apiKey)
    .digest("hex");
}

/**
 * PHP's json_encode, which Cryptomus uses to build the webhook signature:
 *  1. forward slashes are escaped
 *  2. non-ASCII is escaped to \uXXXX
 */
export function phpJsonEncode(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\//g, "\\/")
    .replace(/[\u0080-\uffff]/g, (c) =>
      "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
}

export function verifyWebhookSignature(
  payload: Record<string, unknown>,
  apiKey: string,
): boolean {
  const received = String(payload["sign"] ?? "");
  if (!received) return false;
  const rest = { ...payload };
  delete rest["sign"];
  const b64 = Buffer.from(phpJsonEncode(rest), "utf8").toString("base64");
  const expected = createHash("md5").update(b64 + apiKey).digest("hex");
  if (expected.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
}

/** Returns null when no trustworthy rate is available — callers must fail closed. */
export async function fetchUsdNgnRate(): Promise<number | null> {
  try {
    const res = await fetch(FX_ENDPOINT);
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = Number(data?.rates?.["NGN"]);
    if (Number.isFinite(rate) && rate >= RATE_MIN && rate <= RATE_MAX) return rate;
    console.error("[cryptomus] FX rate out of bounds or missing:", rate);
  } catch (err) {
    console.error("[cryptomus] FX fetch failed:", err);
  }
  return null;
}
