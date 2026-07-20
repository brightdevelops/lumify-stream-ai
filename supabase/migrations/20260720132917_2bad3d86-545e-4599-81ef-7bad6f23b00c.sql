
CREATE OR REPLACE FUNCTION public.admin_get_credit_stats()
 RETURNS TABLE(credits_sold_today bigint, credits_sold_week bigint, credits_sold_month bigint, revenue_today numeric, revenue_week numeric, revenue_month numeric, total_credits_held bigint, total_credits_used bigint, active_streams bigint, credits_sold_all_time bigint, revenue_all_time numeric, total_users bigint, active_users_total bigint, active_today bigint, active_week bigint, active_month bigint)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.category='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(c.balance) FROM credits c), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='usage' AND t.category='purchase'), 0),
    (SELECT COUNT(*) FROM stream_sessions s WHERE s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds'),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.category='purchase'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.category='purchase'), 0),
    (SELECT COUNT(*) FROM profiles),
    (SELECT COUNT(*) FROM profiles WHERE last_seen IS NOT NULL),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= date_trunc('day', now())),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '7 days'),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '30 days');
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_finance_stats()
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_result json; v_price CONSTANT int := 23;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT json_build_object(
    'revenue_today',         (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND category='purchase' AND created_at >= CURRENT_DATE),
    'revenue_this_week',     (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND category='purchase' AND created_at >= date_trunc('week', now())),
    'revenue_this_month',    (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND category='purchase' AND created_at >= date_trunc('month', now())),
    'revenue_all_time',      (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'total_transactions',    (SELECT COUNT(*) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'avg_transaction_ngn',   (SELECT ROUND(COALESCE(AVG(COALESCE(amount_ngn, amount)),0)) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'paying_users',          (SELECT COUNT(DISTINCT user_id) FROM public.transactions WHERE type='purchase' AND category='purchase' AND COALESCE(amount_ngn, amount) > 0),
    'arpu_ngn',              (SELECT CASE WHEN COUNT(DISTINCT user_id) > 0
                                          THEN ROUND(SUM(COALESCE(amount_ngn, amount))::numeric / COUNT(DISTINCT user_id))
                                          ELSE 0 END
                              FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'credits_sold',          (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='purchase' AND category='purchase'),
    'credits_in_wallets',    (SELECT COALESCE(SUM(balance),0) FROM public.credits),
    'credits_streamed',      (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='usage' AND category='purchase'),
    'deferred_revenue_ngn',  (SELECT COALESCE(SUM(balance),0)*v_price FROM public.credits),
    'recognized_revenue_ngn',(SELECT COALESCE(SUM(credits),0)*v_price FROM public.transactions WHERE type='usage' AND category='purchase'),
    'by_package', (
      SELECT COALESCE(json_agg(r ORDER BY r.total_revenue_ngn DESC), '[]'::json)
      FROM (
        SELECT package_id, COUNT(*)::int AS purchase_count, SUM(credits)::int AS credits_sold, SUM(COALESCE(amount_ngn, amount))::int AS total_revenue_ngn
        FROM public.transactions WHERE type='purchase' AND category='purchase' GROUP BY package_id
      ) r),
    'daily_revenue', (
      SELECT COALESCE(json_agg(r ORDER BY r.day), '[]'::json)
      FROM (
        SELECT DATE(created_at)::text AS day, SUM(COALESCE(amount_ngn, amount))::int AS revenue_ngn, COUNT(*)::int AS tx_count
        FROM public.transactions WHERE type='purchase' AND category='purchase' AND created_at >= now() - interval '30 days'
        GROUP BY DATE(created_at)
      ) r)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_users_full()
 RETURNS TABLE(user_id uuid, email text, full_name text, created_at timestamp with time zone, balance integer, total_credits_purchased bigint, total_credits_used bigint, total_spent numeric, last_seen timestamp with time zone, is_admin boolean, is_streaming boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    p.id, p.email, p.full_name, p.created_at,
    COALESCE(c.balance, 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.user_id = p.id AND t.type='purchase' AND t.category='purchase'), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.user_id = p.id AND t.type='usage' AND t.category='purchase'), 0),
    COALESCE((SELECT SUM(t.amount)  FROM transactions t WHERE t.user_id = p.id AND t.type='purchase' AND t.category='purchase'), 0),
    p.last_seen,
    public.has_role(p.id, 'admin'),
    EXISTS(SELECT 1 FROM stream_sessions s WHERE s.user_id = p.id AND s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds')
  FROM profiles p
  LEFT JOIN credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_users_with_credits()
 RETURNS TABLE(user_id uuid, email text, full_name text, created_at timestamp with time zone, balance integer, total_spent numeric, total_credits_used integer, is_admin boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    p.id AS user_id, p.email, p.full_name, p.created_at,
    COALESCE(c.balance, 0) AS balance,
    COALESCE((SELECT SUM(amount) FROM public.transactions t WHERE t.user_id = p.id AND t.type='purchase' AND t.category='purchase'), 0) AS total_spent,
    COALESCE((SELECT SUM(credits) FROM public.transactions t WHERE t.user_id = p.id AND t.type='usage' AND t.category='purchase'), 0)::int AS total_credits_used,
    public.has_role(p.id, 'admin') AS is_admin
  FROM public.profiles p
  LEFT JOIN public.credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$function$;
