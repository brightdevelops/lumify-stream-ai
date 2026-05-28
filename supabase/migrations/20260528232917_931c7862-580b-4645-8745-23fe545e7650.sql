
ALTER TABLE public.profiles RENAME COLUMN last_login TO last_seen;

CREATE OR REPLACE FUNCTION public.record_login()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.profiles SET last_seen = now() WHERE id = v_user;
END;
$function$;

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
    (SELECT COUNT(*) FROM profiles),
    (SELECT COUNT(*) FROM profiles WHERE last_seen IS NOT NULL),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= date_trunc('day', now())),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '7 days'),
    (SELECT COUNT(*) FROM profiles WHERE last_seen >= now() - interval '30 days');
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_list_users_full();
CREATE OR REPLACE FUNCTION public.admin_list_users_full()
 RETURNS TABLE(user_id uuid, email text, full_name text, created_at timestamp with time zone, balance integer, total_credits_purchased bigint, total_credits_used bigint, total_spent numeric, last_seen timestamp with time zone, is_admin boolean, is_streaming boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT
    p.id, p.email, p.full_name, p.created_at,
    COALESCE(c.balance, 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.user_id = p.id AND t.type='purchase'), 0),
    COALESCE((SELECT SUM(t.credits) FROM transactions t WHERE t.user_id = p.id AND t.type='usage'), 0),
    COALESCE((SELECT SUM(t.amount)  FROM transactions t WHERE t.user_id = p.id AND t.type='purchase'), 0),
    p.last_seen,
    public.has_role(p.id, 'admin'),
    EXISTS(SELECT 1 FROM stream_sessions s WHERE s.user_id = p.id AND s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds')
  FROM profiles p
  LEFT JOIN credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_registration_analytics(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, count bigint, users jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN QUERY
    SELECT
      (p.created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*)::bigint,
      jsonb_agg(jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name, 'created_at', p.created_at) ORDER BY p.created_at)
    FROM profiles p
    GROUP BY 1
    ORDER BY 1;
  ELSE
    RETURN QUERY
    SELECT
      (p.created_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*)::bigint,
      jsonb_agg(jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name, 'created_at', p.created_at) ORDER BY p.created_at)
    FROM profiles p
    WHERE p.created_at >= (now() - (p_days || ' days')::interval)
    GROUP BY 1
    ORDER BY 1;
  END IF;
END;
$function$;
