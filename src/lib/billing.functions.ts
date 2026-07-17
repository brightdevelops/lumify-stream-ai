import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const clearMyBillingHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error, count } = await supabaseAdmin
      .from("transactions")
      .delete({ count: "exact" })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });
