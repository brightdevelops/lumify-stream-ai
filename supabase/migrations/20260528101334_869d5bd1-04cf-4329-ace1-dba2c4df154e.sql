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
    (SELECT MAX(v.created_at) FROM page_visits v WHERE v.user_id = p.id),
    public.has_role(p.id, 'admin'),
    EXISTS(SELECT 1 FROM stream_sessions s WHERE s.user_id = p.id AND s.ended_at IS NULL AND s.last_heartbeat > now() - interval '30 seconds')
  FROM profiles p
  LEFT JOIN credits c ON c.user_id = p.id
  ORDER BY p.created_at DESC;
END;
$function$;