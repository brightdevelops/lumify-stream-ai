
-- Adjust credits against the live credits.balance used by the app
CREATE OR REPLACE FUNCTION public.admin_adjust_credits(target_user_id uuid, delta integer, note text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _old int; _new int; _actual int;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF delta = 0 THEN RAISE EXCEPTION 'delta must be non-zero'; END IF;

  SELECT balance INTO _old FROM public.credits WHERE user_id = target_user_id;
  IF _old IS NULL THEN
    INSERT INTO public.credits (user_id, balance) VALUES (target_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    _old := 0;
  END IF;

  UPDATE public.credits
    SET balance = GREATEST(balance + delta, 0), updated_at = now()
    WHERE user_id = target_user_id
    RETURNING balance INTO _new;

  _actual := _new - _old;

  -- keep profiles.credits in sync for legacy reads
  UPDATE public.profiles SET credits = _new WHERE id = target_user_id;

  INSERT INTO public.credit_ledger (user_id, delta, reason, performed_by, note, balance_after)
  VALUES (target_user_id, _actual, 'admin_adjustment', auth.uid(), note, _new);

  INSERT INTO public.transactions (user_id, type, amount, credits, description)
  VALUES (
    target_user_id,
    CASE WHEN _actual >= 0 THEN 'purchase'::transaction_type ELSE 'usage'::transaction_type END,
    0,
    ABS(_actual),
    COALESCE('Admin adjustment: ' || note, 'Admin adjustment')
  );

  RETURN _new;
END;
$function$;

-- List users with their real wallet balance
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(id uuid, email text, credits integer, is_admin boolean, banned boolean, has_streamed boolean, last_sign_in_at timestamp with time zone, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  RETURN QUERY
    SELECT p.id, u.email::text, COALESCE(c.balance, p.credits, 0) AS credits,
      p.is_admin, p.banned,
      EXISTS(
        SELECT 1 FROM public.transactions t
        WHERE t.user_id = p.id AND t.type = 'usage'
        UNION ALL
        SELECT 1 FROM public.credit_ledger cl
        WHERE cl.user_id = p.id AND cl.reason = 'stream_deduction'
      ) AS has_streamed,
      u.last_sign_in_at, p.created_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.credits c ON c.user_id = p.id
    ORDER BY p.created_at DESC;
END;
$function$;

-- Inventor metrics: use real credits + all purchase transactions
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
    'total_credits_sold',   (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='purchase'),
    'total_revenue_ngn',    (SELECT COALESCE(SUM(COALESCE(amount_ngn, amount)),0) FROM public.transactions WHERE type='purchase'),
    'total_users',          (SELECT COUNT(*) FROM public.profiles),
    'paying_users',         (SELECT COUNT(DISTINCT user_id) FROM public.transactions WHERE type='purchase' AND COALESCE(amount_ngn, amount) > 0),
    'recent_transactions',  (
      SELECT COALESCE(json_agg(r),'[]'::json) FROM (
        SELECT t.id, t.user_id, u.email, t.package_id, t.credits,
               COALESCE(t.amount_ngn, t.amount)::numeric AS amount_ngn,
               t.reference, t.created_at
        FROM public.transactions t LEFT JOIN auth.users u ON u.id = t.user_id
        WHERE t.type='purchase'
        ORDER BY t.created_at DESC LIMIT 20) r)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

-- Finance: cover both legacy amount_ngn rows and current amount rows; use real credit tables
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
    'total_transactions',    (SELECT COUNT(*) FROM public.transactions WHERE type='purchase'),
    'avg_transaction_ngn',   (SELECT ROUND(COALESCE(AVG(COALESCE(amount_ngn, amount)),0)) FROM public.transactions WHERE type='purchase'),
    'paying_users',          (SELECT COUNT(DISTINCT user_id) FROM public.transactions WHERE type='purchase' AND COALESCE(amount_ngn, amount) > 0),
    'arpu_ngn',              (SELECT CASE WHEN COUNT(DISTINCT user_id) > 0
                                          THEN ROUND(SUM(COALESCE(amount_ngn, amount))::numeric / COUNT(DISTINCT user_id))
                                          ELSE 0 END
                              FROM public.transactions WHERE type='purchase'),
    'credits_sold',          (SELECT COALESCE(SUM(credits),0) FROM public.transactions WHERE type='purchase'),
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
        WHERE type='purchase'
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
