import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "brightsolutionslab@gmail.com";

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
  credits_sold_all_time: number;
  revenue_all_time: number;
  total_users: number;
  active_users_total: number;
  active_today: number;
  active_week: number;
  active_month: number;
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
export type DailyProfitPoint = { date: string; revenue: number; credits_used: number; decart_cost: number; profit: number };


export type RecentVisit = {
  id: string; path: string; referrer: string | null; user_agent: string | null;
  user_id: string | null; user_email: string | null; created_at: string;
  ip: string | null; visit_count: number;
};

export type TopPage = { path: string; visits: number; unique_visitors: number };

export type RegistrationDay = {
  day: string;
  count: number;
  users: Array<{ user_id: string; email: string; full_name: string | null; created_at: string }>;
};

export const adminRegistrationAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(365) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const email = context.claims?.email as string | undefined;
    if (email !== ADMIN_EMAIL) throw new Error("Not authorized");
    const { data: rows, error } = await context.supabase.rpc("admin_registration_analytics", { p_days: data.days });
    if (error) throw new Error(error.message);
    return { days: (rows ?? []) as RegistrationDay[] };
  });


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
    const monthStartBound = new Date(startOfDay); monthStartBound.setUTCDate(startOfDay.getUTCDate() - 29);
    const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Use supabaseAdmin to bypass RLS — the admin needs to see ALL users'
    // transactions and stream sessions, not just their own.
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("type, credits, amount, created_at")
      .gte("created_at", monthStart.toISOString());
    if (error) throw new Error(error.message);

    const buckets = new Map<string, { revenue: number; credits_used: number }>();
    const firstDay = new Date(startOfDay);
    firstDay.setUTCDate(startOfDay.getUTCDate() - 29);
    for (let i = 0; i < 30; i++) {
      const d = new Date(firstDay);
      d.setUTCDate(firstDay.getUTCDate() + i);
      buckets.set(d.toISOString().slice(0, 10), { revenue: 0, credits_used: 0 });
    }
    void monthStartBound;
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

    // Include in-progress streaming sessions started today so today's cost
    // reflects ongoing usage (usage transactions are only logged on session end).
    const { data: activeToday } = await supabaseAdmin
      .from("stream_sessions")
      .select("credits_used, started_at, ended_at")
      .is("ended_at", null)
      .gte("started_at", startOfDay.toISOString());
    for (const s of (activeToday ?? []) as Array<{ credits_used: number }>) {
      const c = Number(s.credits_used) || 0;
      creditsUsedToday += c;
      creditsUsedMonth += c;
    }

    const points: DailyProfitPoint[] = Array.from(buckets.entries()).map(([date, v]) => {
      const decart_cost = (v.credits_used / 2) * 27;
      return { date, revenue: v.revenue, credits_used: v.credits_used, decart_cost, profit: v.revenue - decart_cost };
    });
    return { points, credits_used_today: creditsUsedToday, credits_used_month: creditsUsedMonth };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Payment issue tickets
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentIssueRow = {
  id: string; user_id: string; user_email: string | null; full_name: string | null;
  method: string; order_reference: string | null; pack_id: string | null;
  message: string; status: string; admin_note: string | null;
  resolved_at: string | null; created_at: string;
};


export const adminListPaymentIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string | null; limit?: number }) => input)
  .handler(async ({ context, data }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { data: rows, error } = await context.supabase.rpc("admin_list_payment_issues", {
      p_status: data.status ?? undefined,
      p_limit: data.limit ?? 200,
    });
    if (error) throw new Error(error.message);
    return { issues: (rows ?? []) as PaymentIssueRow[] };
  });

export const adminUpdatePaymentIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "open" | "in_progress" | "resolved" | "dismissed"; note?: string | null }) => input)
  .handler(async ({ context, data }) => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);
    const { error } = await context.supabase.rpc("admin_update_payment_issue", {
      p_id: data.id, p_status: data.status, p_note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Full per-user history: profile snapshot + all transactions + stream sessions.
export type UserHistoryStreamSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  last_heartbeat: string;
  credits_used: number;
  duration_seconds: number;
};

export type UserHistoryPayload = {
  profile: {
    id: string;
    email: string;
    full_name: string | null;
    created_at: string;
    balance: number;
    last_seen: string | null;
    last_country: string | null;
    last_ip: string | null;
    is_vpn: boolean | null;
    banned: boolean;
    is_admin: boolean;
  } | null;
  transactions: Omit<TransactionRow, "user_id" | "user_email">[];
  sessions: UserHistoryStreamSession[];
  totals: {
    purchases_count: number;
    purchased_credits: number;
    revenue_ngn: number;
    usage_count: number;
    used_credits: number;
    adjustments_count: number;
    adjustments_credits: number;
    sessions_count: number;
    total_stream_seconds: number;
  };
};

export const adminUserHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => input)
  .handler(async ({ context, data }): Promise<UserHistoryPayload> => {
    await assertAdminEmail(context.userId, context.claims?.email as string | undefined);

    const [{ data: profile }, { data: txRows, error: txErr }, { data: sessRows, error: sessErr }, { data: credit }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, created_at, last_seen, last_country, last_ip, is_vpn, banned, is_admin")
          .eq("id", data.userId)
          .maybeSingle(),
        context.supabase.rpc("admin_user_transactions", { p_user: data.userId }),
        supabaseAdmin
          .from("stream_sessions")
          .select("id, started_at, ended_at, last_heartbeat, credits_used")
          .eq("user_id", data.userId)
          .order("started_at", { ascending: false })
          .limit(500),
        supabaseAdmin.from("credits").select("balance").eq("user_id", data.userId).maybeSingle(),
      ]);
    if (txErr) throw new Error(txErr.message);
    if (sessErr) throw new Error(sessErr.message);

    const transactions = (txRows ?? []) as Omit<TransactionRow, "user_id" | "user_email">[];
    const sessions: UserHistoryStreamSession[] = (sessRows ?? []).map((s) => {
      const start = new Date(s.started_at).getTime();
      const endIso = s.ended_at ?? s.last_heartbeat;
      const end = endIso ? new Date(endIso).getTime() : start;
      return {
        id: s.id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        last_heartbeat: s.last_heartbeat,
        credits_used: Number(s.credits_used) || 0,
        duration_seconds: Math.max(0, Math.round((end - start) / 1000)),
      };
    });

    let purchases_count = 0, purchased_credits = 0, revenue_ngn = 0;
    let usage_count = 0, used_credits = 0;
    let adjustments_count = 0, adjustments_credits = 0;
    for (const t of transactions) {
      const c = Number(t.credits) || 0;
      const a = Number(t.amount) || 0;
      if (t.type === "purchase") { purchases_count++; purchased_credits += c; revenue_ngn += a; }
      else if (t.type === "usage") { usage_count++; used_credits += Math.abs(c); }
      else if (c !== 0) { adjustments_count++; adjustments_credits += c; }
    }
    const total_stream_seconds = sessions.reduce((s, x) => s + x.duration_seconds, 0);

    return {
      profile: profile
        ? {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            created_at: profile.created_at,
            balance: Number(credit?.balance ?? 0),
            last_seen: profile.last_seen,
            last_country: profile.last_country,
            last_ip: profile.last_ip,
            is_vpn: profile.is_vpn,
            banned: !!profile.banned,
            is_admin: !!profile.is_admin,
          }
        : null,
      transactions,
      sessions,
      totals: {
        purchases_count,
        purchased_credits,
        revenue_ngn,
        usage_count,
        used_credits,
        adjustments_count,
        adjustments_credits,
        sessions_count: sessions.length,
        total_stream_seconds,
      },
    };
  });



