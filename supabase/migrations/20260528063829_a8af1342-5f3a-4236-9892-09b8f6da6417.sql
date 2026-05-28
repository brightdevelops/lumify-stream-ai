
CREATE TABLE public.page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  path text NOT NULL,
  referrer text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_visits_created_at ON public.page_visits (created_at DESC);

GRANT INSERT ON public.page_visits TO anon, authenticated;
GRANT SELECT ON public.page_visits TO authenticated;
GRANT ALL ON public.page_visits TO service_role;

ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a visit"
  ON public.page_visits FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can view visits"
  ON public.page_visits FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Admin stats function
CREATE OR REPLACE FUNCTION public.admin_get_visit_stats()
RETURNS TABLE(
  total_visits bigint,
  visits_today bigint,
  visits_last_7_days bigint,
  unique_visitors_logged_in bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.page_visits),
    (SELECT COUNT(*) FROM public.page_visits WHERE created_at >= now() - interval '1 day'),
    (SELECT COUNT(*) FROM public.page_visits WHERE created_at >= now() - interval '7 days'),
    (SELECT COUNT(DISTINCT user_id) FROM public.page_visits WHERE user_id IS NOT NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_recent_visits(p_limit int DEFAULT 100)
RETURNS TABLE(
  id uuid,
  path text,
  referrer text,
  user_agent text,
  user_id uuid,
  user_email text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT v.id, v.path, v.referrer, v.user_agent, v.user_id, p.email, v.created_at
  FROM public.page_visits v
  LEFT JOIN public.profiles p ON p.id = v.user_id
  ORDER BY v.created_at DESC
  LIMIT p_limit;
END;
$$;
