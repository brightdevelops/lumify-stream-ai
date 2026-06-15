
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_ip text,
  ADD COLUMN IF NOT EXISTS last_country text;

DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(id uuid, email text, credits integer, is_admin boolean, banned boolean, has_streamed boolean, last_sign_in_at timestamp with time zone, created_at timestamp with time zone, last_ip text, last_country text)
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
      u.last_sign_in_at, p.created_at,
      p.last_ip, p.last_country
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    LEFT JOIN public.credits c ON c.user_id = p.id
    ORDER BY p.created_at DESC;
END;
$function$;
