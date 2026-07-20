import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const clearMyBillingHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // SECURITY: never delete 'purchase' rows — they are the payment audit trail
    // and (historically) an idempotency marker. Deleting them would enable a
    // Flutterwave/crypto reference replay. Only usage/session rows can be cleared.
    const { error, count } = await supabaseAdmin
      .from("transactions")
      .delete({ count: "exact" })
      .eq("user_id", context.userId)
      .neq("type", "purchase");
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });
