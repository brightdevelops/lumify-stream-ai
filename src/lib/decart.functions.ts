import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Returns the Decart API key to authenticated users only.
 *
 * NOTE: Decart's realtime SDK runs in the browser, so the key must reach
 * the client at some point. Keeping it out of the public bundle and behind
 * auth limits exposure to logged-in users and lets us rotate the key
 * without redeploying. For stronger security, replace with Decart-issued
 * short-lived client tokens if/when that becomes available.
 */
export const getDecartKey = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = process.env.DECART_API_KEY;
    if (!key) throw new Error("Decart not configured");
    // Optional: enforce a minimum credit balance before handing out the key
    const { data, error } = await context.supabase
      .from("credits")
      .select("balance")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || (data.balance ?? 0) < 10) {
      throw new Error("Insufficient credits");
    }
    return { apiKey: key };
  });
