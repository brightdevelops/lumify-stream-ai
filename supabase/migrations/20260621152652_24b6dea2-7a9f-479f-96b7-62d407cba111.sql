CREATE OR REPLACE FUNCTION public.admin_list_support_conversations(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, user_id uuid, user_email text, full_name text, type text, subject text, last_message_at timestamp with time zone, last_message_preview text, unread_for_admin integer, credit_balance integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT COALESCE((SELECT pr.is_admin FROM profiles pr WHERE pr.id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  SELECT sc.id AS id,
         sc.user_id AS user_id,
         COALESCE(sc.user_email, p.email) AS user_email,
         p.full_name AS full_name,
         sc.type AS type,
         sc.subject AS subject,
         sc.last_message_at AS last_message_at,
         sc.last_message_preview AS last_message_preview,
         sc.unread_for_admin AS unread_for_admin,
         COALESCE(c.balance, 0) AS credit_balance,
         sc.created_at AS created_at
  FROM public.support_conversations sc
  LEFT JOIN public.profiles p ON p.id = sc.user_id
  LEFT JOIN public.credits c ON c.user_id = sc.user_id
  ORDER BY sc.last_message_at DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END; $function$;