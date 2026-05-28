DROP FUNCTION IF EXISTS public.admin_get_credit_stats();

CREATE OR REPLACE FUNCTION public.admin_get_credit_stats()
 RETURNS TABLE(
   credits_sold_today bigint, credits_sold_week bigint, credits_sold_month bigint,
   revenue_today numeric, revenue_week numeric, revenue_month numeric,
   total_credits_held bigint, total_credits_used bigint, active_streams bigint,
   credits_sold_all_time bigint, revenue_all_time numeric, total_users bigint
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= date_trunc('day', now())), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '7 days'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase' AND t.created_at >= now() - interval '30 days'), 0),
    COALESCE((SELECT SUM(c.balance) FROM credits c), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='usage'), 0),
    (SELECT COUNT(*) FROM stream_sessions s WHERE s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds'),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.type='purchase'), 0),
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.type='purchase'), 0),
    (SELECT COUNT(*) FROM profiles);
END;
$function$;