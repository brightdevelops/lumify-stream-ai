import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAIL = "brightsolutionslab@gmail.com";

export type AdminUserRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  balance: number;
  total_credits_purchased: number;
  total_credits_used: number;
  total_spent: number;
  last_seen: string | null;
  is_admin: boolean;
  is_streaming: boolean;
};

export type CreditStats = {
  credits_sold_today: number;
  credits_sold_week: number;
  credits_sold_month: number;
  revenue_today: number;
  revenue_week: number;
  revenue_month: number;
  total_credits_held: number;
  total_credits_used: number;
  active_streams: number;
};

export type VisitorOverview = {
  visits_today: number; visits_week: number; visits_month: number;
  unique_today: number; unique_week: number; unique_month: number;
  registered_visitors: number; anonymous_visitors: number; returning_visitors: number;
};

export type TransactionRow = {
  id: string; user_id: string; user_email: string | null;
  type: string; credits: number; amount: number;
  description: string | null; created_at: string;
};

export type ActiveStream = {
  session_id: string; user_id: string; user_email: string | null; full_name: string | null;
  started_at: string; last_heartbeat: string;
  credits_used: number; credits_remaining: number; duration_seconds: number;
};

export type RecentVisit = {
  id: string; path: string; referrer: string | null; user_agent: string | null;
  user_id: string | null; user_email: string | null; created_at: string;
  ip: string | null; visit_count: number;
};

export type TopPage = { path: string; visits: number; unique_visitors: number };

async function assertAdminEmail(userId: string, email: string | undefined) {
  if (email !== ADMIN_EMAIL) throw new Error("Not authorized");
  const { data } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Not authorized");
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = context.claims?.email as string | undefined;
    return { isAdmin: email === ADMIN_EMAIL };
  });

export const adminGetCreditStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_get_credit_stats");
    if (error) throw new Error(error.message);
    return { stats: ((data ?? [])[0] ?? null) as CreditStats | null };
  });

export const adminListUsersFull = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_list_users_full");
    if (error) throw new Error(error.message);
    return { users: (data ?? []) as AdminUserRow[] };
  });

export const adminListTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { type?: "purchase" | "usage" | null; limit?: number }) => input)
  .handler(async ({ context, data }) => {
  .inputValidator((input: { type?: "purchase" | "usage" | null; limit?: number }) => input)
  .handler(async ({ context, data }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data: rows, error } = await context.supabase.rpc("admin_list_transactions", {
      p_limit: data.limit ?? 500,
      p_type: data.type ?? undefined,
    });

export const adminUserTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ context, data }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data: rows, error } = await context.supabase.rpc("admin_user_transactions", { p_user: data.userId });
    if (error) throw new Error(error.message);
    return { transactions: (rows ?? []) as Omit<TransactionRow, "user_id" | "user_email">[] };
  });

export const adminGetActiveStreams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_get_active_streams");
    if (error) throw new Error(error.message);
    return { streams: (data ?? []) as ActiveStream[] };
  });

export const adminVisitorOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_visitor_overview");
    if (error) throw new Error(error.message);
    return { overview: ((data ?? [])[0] ?? null) as VisitorOverview | null };
  });

export const adminListRecentVisits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_list_recent_visits", { p_limit: 100 });
    if (error) throw new Error(error.message);
    return { visits: (data ?? []) as RecentVisit[] };
  });

export const adminTopPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_top_pages", { p_limit: 20 });
    if (error) throw new Error(error.message);
    return { pages: (data ?? []) as TopPage[] };
  });
