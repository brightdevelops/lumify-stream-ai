
-- 1. admin_set_admin (missing from current project)
CREATE OR REPLACE FUNCTION public.admin_set_admin(target_user_id uuid, make_admin boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot change your own admin status'; END IF;
  UPDATE public.profiles SET is_admin = make_admin WHERE id = target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.admin_set_admin(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid,boolean) TO authenticated;

-- 2. site_visits table for session heartbeats
CREATE TABLE IF NOT EXISTS public.site_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid NULL REFERENCES auth.users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.site_visits TO authenticated;
GRANT INSERT ON public.site_visits TO anon;
GRANT ALL ON public.site_visits TO service_role;
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anyone_can_log_visit" ON public.site_visits;
CREATE POLICY "anyone_can_log_visit" ON public.site_visits FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "user_reads_own_visits" ON public.site_visits;
CREATE POLICY "user_reads_own_visits" ON public.site_visits FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS site_visits_created_idx ON public.site_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS site_visits_session_idx ON public.site_visits (session_id, created_at DESC);

-- 3. inventor_visit_stats (new fn — don't clobber existing admin_get_visit_stats)
CREATE OR REPLACE FUNCTION public.inventor_visit_stats()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result json;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  THEN RAISE EXCEPTION 'not authorized'; END IF;
  SELECT json_build_object(
    'active_now',          (SELECT COUNT(DISTINCT session_id) FROM public.site_visits WHERE created_at >= now()-interval '2 minutes'),
    'visitors_today',      (SELECT COUNT(DISTINCT session_id) FROM public.site_visits WHERE created_at >= CURRENT_DATE),
    'visitors_this_month', (SELECT COUNT(DISTINCT session_id) FROM public.site_visits WHERE created_at >= date_trunc('month', now()))
  ) INTO v_result;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.inventor_visit_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventor_visit_stats() TO authenticated;
