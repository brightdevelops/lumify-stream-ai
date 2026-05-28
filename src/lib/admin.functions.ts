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
  last_login: string | null;
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
  credits_sold_all_time: number;
  revenue_all_time: number;
  total_users: number;
  active_users_total: number;
  active_today: number;
  active_week: number;
  active_month: number;
};
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
export type DailyProfitPoint = { date: string; revenue: number; credits_used: number; decart_cost: number; profit: number };


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
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data: rows, error } = await context.supabase.rpc("admin_list_transactions", {
      p_limit: data.limit ?? 500,
      p_type: data.type ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { transactions: (rows ?? []) as TransactionRow[] };
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

export const adminTopPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data, error } = await context.supabase.rpc("admin_top_pages", { p_limit: 20 });
    if (error) throw new Error(error.message);
    return { pages: (data ?? []) as TopPage[] };
  });

export const adminDailyProfit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date(startOfDay); weekStart.setUTCDate(startOfDay.getUTCDate() - 6);
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data, error } = await context.supabase
      .from("transactions")
      .select("type, credits, amount, created_at")
      .gte("created_at", monthStart.toISOString());
    if (error) throw new Error(error.message);

    const buckets = new Map<string, { revenue: number; credits_used: number }>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      buckets.set(d.toISOString().slice(0, 10), { revenue: 0, credits_used: 0 });
    }
    let creditsUsedToday = 0;
    let creditsUsedMonth = 0;
    for (const row of (data ?? []) as Array<{ type: string; credits: number; amount: number; created_at: string }>) {
      const created = new Date(row.created_at);
      const key = created.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (row.type === "purchase" && b) b.revenue += Number(row.amount) || 0;
      else if (row.type === "usage") {
        const c = Number(row.credits) || 0;
        if (b) b.credits_used += c;
        creditsUsedMonth += c;
        if (created >= startOfDay) creditsUsedToday += c;
      }
    }
    const points: DailyProfitPoint[] = Array.from(buckets.entries()).map(([date, v]) => {
      const decart_cost = (v.credits_used / 2) * 27;
      return { date, revenue: v.revenue, credits_used: v.credits_used, decart_cost, profit: v.revenue - decart_cost };
    });
    return { points, credits_used_today: creditsUsedToday, credits_used_month: creditsUsedMonth };
  });

