
DROP FUNCTION IF EXISTS public.admin_list_recent_visits(integer);

CREATE OR REPLACE FUNCTION public.admin_list_recent_visits(p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, path text, referrer text, user_agent text, user_id uuid, user_email text, created_at timestamp with time zone, ip text, visit_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (COALESCE(v.ip, v.id::text))
      v.id, v.path, v.referrer, v.user_agent, v.user_id, v.created_at, v.ip
    FROM public.page_visits v
    ORDER BY COALESCE(v.ip, v.id::text), v.created_at DESC
  ),
  counts AS (
    SELECT ip, COUNT(*)::bigint AS c
    FROM public.page_visits
    WHERE ip IS NOT NULL
    GROUP BY ip
  )
  SELECT l.id, l.path, l.referrer, l.user_agent, l.user_id, p.email, l.created_at, l.ip,
         COALESCE(c.c, 1) AS visit_count
  FROM latest l
  LEFT JOIN public.profiles p ON p.id = l.user_id
  LEFT JOIN counts c ON c.ip = l.ip
  ORDER BY l.created_at DESC
  LIMIT p_limit;
END;
$function$;
