import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AdminUserRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  balance: number;
  total_spent: number;
  total_credits_used: number;
  is_admin: boolean;
};

export type VisitStats = {
  total_visits: number;
  visits_today: number;
  visits_last_7_days: number;
  unique_visitors_logged_in: number;
};

export type RecentVisit = {
  id: string;
  path: string;
  referrer: string | null;
  user_agent: string | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
};

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Not authorized");
}

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_list_users_with_credits");
    if (error) throw new Error(error.message);
    return { users: (data ?? []) as AdminUserRow[] };
  });

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { isAdmin: !!data };
  });

export const adminGetVisitStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_get_visit_stats");
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as VisitStats | undefined;
    return {
      stats: row ?? { total_visits: 0, visits_today: 0, visits_last_7_days: 0, unique_visitors_logged_in: 0 },
    };
  });

export const adminListRecentVisits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin.rpc("admin_list_recent_visits", { p_limit: 100 });
    if (error) throw new Error(error.message);
    return { visits: (data ?? []) as RecentVisit[] };
  });
