import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InventorMetrics = {
  total_credits_held: number;
  total_credits_sold: number;
  total_revenue_ngn: number;
  total_users: number;
  paying_users: number;
  recent_transactions: Array<{
    id: string;
    user_id: string;
    email: string | null;
    package_id: string | null;
    credits: number;
    amount_ngn: number | null;
    reference: string | null;
    created_at: string;
  }>;
};

export type InventorUser = {
  id: string;
  email: string;
  credits: number;
  is_admin: boolean;
  banned: boolean;
  has_streamed: boolean;
  last_sign_in_at: string | null;
  created_at: string;
};

export type LedgerRow = {
  id: string;
  user_id: string;
  user_email: string | null;
  delta: number;
  reason: string;
  performed_by: string | null;
  admin_email: string | null;
  note: string | null;
  balance_after: number;
  created_at: string;
};

export type InventorFinance = {
  revenue_today: number;
  revenue_this_week: number;
  revenue_this_month: number;
  revenue_all_time: number;
  total_transactions: number;
  avg_transaction_ngn: number;
  paying_users: number;
  arpu_ngn: number;
  credits_sold: number;
  credits_in_wallets: number;
  credits_streamed: number;
  deferred_revenue_ngn: number;
  recognized_revenue_ngn: number;
  by_package: Array<{ package_id: string | null; purchase_count: number; credits_sold: number; total_revenue_ngn: number }>;
  daily_revenue: Array<{ day: string; revenue_ngn: number; tx_count: number }>;
};

export type InventorVisitStats = {
  active_now: number;
  visitors_today: number;
  visitors_this_month: number;
};

export const amIInventor = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", context.userId)
      .maybeSingle();
    return { isAdmin: !!data?.is_admin };
  });

export const inventorGetMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_get_metrics");
    if (error) throw new Error(error.message);
    return { metrics: data as unknown as InventorMetrics };
  });

export const inventorListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_list_users");
    if (error) throw new Error(error.message);
    return { users: (data ?? []) as InventorUser[] };
  });

export const inventorAdjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      target_user_id: z.string().uuid(),
      delta: z.number().int().refine((n) => n !== 0, "delta must be non-zero"),
      note: z.string().min(1).max(500),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: newBalance, error } = await context.supabase.rpc("admin_adjust_credits", {
      target_user_id: data.target_user_id,
      delta: data.delta,
      note: data.note,
    });
    if (error) throw new Error(error.message);
    return { new_balance: newBalance as unknown as number };
  });

export const inventorGetLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      row_limit: z.number().int().min(1).max(500).optional(),
      filter_user_id: z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase.rpc("admin_get_ledger", {
      row_limit: data.row_limit ?? 200,
      filter_user_id: data.filter_user_id ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as LedgerRow[] };
  });

export const inventorSetAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ target_user_id: z.string().uuid(), make_admin: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("admin_set_admin", {
      target_user_id: data.target_user_id,
      make_admin: data.make_admin,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inventorBanUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ target_user_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("admin_ban_user", { target_user_id: data.target_user_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inventorUnbanUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ target_user_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("admin_unban_user", { target_user_id: data.target_user_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inventorDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ target_user_id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.rpc("admin_delete_user", { target_user_id: data.target_user_id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const inventorFinanceStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("admin_get_finance_stats");
    if (error) throw new Error(error.message);
    return { finance: data as unknown as InventorFinance };
  });

export const inventorVisitStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("inventor_visit_stats");
    if (error) throw new Error(error.message);
    return { stats: data as unknown as InventorVisitStats };
  });
