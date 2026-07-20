
-- 1. Add category column
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'purchase'
    CHECK (category IN ('purchase','adjustment','refund','reversal'));

-- 2. Backfill existing rows
UPDATE public.transactions
   SET category = 'refund'
 WHERE type = 'purchase' AND COALESCE(amount,0) = 0
   AND (description ILIKE 'Overcharge refund%' OR description ILIKE 'overcharge_refund_corrected%' OR description ILIKE '%true wallet loss%');

UPDATE public.transactions
   SET category = 'reversal'
 WHERE type = 'purchase' AND COALESCE(amount,0) = 0
   AND (description ILIKE 'Refund reversal%' OR description ILIKE 'refund_reversal%');

UPDATE public.transactions
   SET category = 'adjustment'
 WHERE type = 'purchase' AND COALESCE(amount,0) = 0
   AND category = 'purchase'
   AND (description ILIKE 'Admin adjustment%' OR description ILIKE 'Admin grant%');

-- Catch any remaining zero-money purchase rows
UPDATE public.transactions
   SET category = 'adjustment'
 WHERE type = 'purchase' AND COALESCE(amount,0) = 0 AND category = 'purchase';

CREATE INDEX IF NOT EXISTS transactions_type_category_created_at_idx
  ON public.transactions (type, category, created_at);

-- 3. Rewrite RPCs to exclude non-purchase categories from credits_sold_*

CREATE OR REPLACE FUNCTION public.admin_get_credit_stats()
 RETURNS TABLE(credits_sold_today bigint, credits_sold_week bigint, credits_sold_month bigint, revenue_today numeric, revenue_week numeric, revenue_month numeric, total_credits_held bigint, total_credits_used bigint, active_streams bigint, credits_sold_all_time bigint, revenue_all_time numeric, total_users bigint, active_users_total bigint, active_today bigint, active_week bigint, active_month bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(c.balance) FROM credits c), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='usage'), 0),
    (SELECT COUNT(*) FROM stream_sessions s WHERE s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds'),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase'), 0),
    (SELECT COUNT(*) FROM profiles),
    (SELECT COUNT(*) FROM profiles WHERE last_seen IS NOT NULL),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= date_trunc('day', now())),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '7 days'),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '30 days');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_finance_stats()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result json; v_price CONSTANT int := 23;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT json_build_object(
    'revenue_today',         (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND created_at >= CURRENT_DATE),
    'revenue_this_week',     (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND created_at >= date_trunc('week', now())),
    'revenue_this_month',    (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND created_at >= date_trunc('month', now())),
    'revenue_all_time',      (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase'),
    'total_transactions',    (SELECT COUNT(*) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'avg_transaction_ngn',   (SELECT ROUND(COALESCE(AVG(COALESCE(amount_ngn, amount)),0)) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'paying_users',          (SELECT COUNT(DISTINCT user_id) FROM public.transactions WHERE type='purchase' AND category='purchase' AND COALESCE(amount_ngn, amount) > 0),
    'arpu_ngn',              (SELECT CASE WHEN COUNT(DISTINCT user_id) > 0
                                          THEN ROUND(SUM(COALESCE(amount_ngn, amount))::numeric / COUNT(DISTINCT user_id))
                                          ELSE 0 END
                              FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'credits_sold',          (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'credits_in_wallets',    (SELECT COALESCE(SUM(balance),0) FROM public.credits),
    'credits_streamed',      (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='usage'),
    'deferred_revenue_ngn',  (SELECT COALESCE(SUM(balance),0)*v_price FROM public.credits),
    'recognized_revenue_ngn',(SELECT COALESCE(SUM(credits),0)*v_price FROM public.transactions WHERE type='usage'),
    'by_package', (
      SELECT COALESCE(json_agg(r ORDER BY r.total_revenue_ngn DESC), '[]'::json)
      FROM (
        SELECT package_id,
               COUNT(*)::int AS purchase_count,
               SUM(credits)::int AS credits_sold,
               SUM(COALESCE(amount_ngn, amount))::int AS total_revenue_ngn
        FROM public.transactions
        WHERE type='purchase' AND category='purchase'
        GROUP BY package_id
      ) r),
    'daily_revenue', (
      SELECT COALESCE(json_agg(r ORDER BY r.day), '[]'::json)
      FROM (
        SELECT DATE(created_at)::text AS day,
               SUM(COALESCE(amount_ngn, amount))::int AS revenue_ngn,
               COUNT(*)::int AS tx_count
        FROM public.transactions
        WHERE type='purchase' AND created_at >= now() - interval '30 days'
        GROUP BY DATE(created_at)
      ) r)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_metrics()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result json;
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT json_build_object(
    'total_credits_held',   (SELECT COALESCE(SUM(balance),0) FROM public.credits),
    'total_credits_sold',   (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'total_revenue_ngn',    (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase'),
    'total_users',          (SELECT COUNT(*) FROM public.profiles),
    'paying_users',         (SELECT COUNT(DISTINCT user_id) FROM public.transactions WHERE type='purchase' AND category='purchase' AND COALESCE(amount_ngn, amount) > 0),
    'recent_transactions',  (
      SELECT COALESCE(json_agg(r),'[]'::json) FROM (
        SELECT t.id, t.user_id, u.email, t.package_id, t.credits,
               COALESCE(t.amount_ngn, t.amount)::numeric AS amount_ngn,
               t.reference, t.created_at
        FROM public.transactions t LEFT JOIN auth.users u ON u.id = t.user_id
        WHERE t.type='purchase' AND t.category='purchase'
        ORDER BY t.created_at DESC LIMIT 20) r)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;
