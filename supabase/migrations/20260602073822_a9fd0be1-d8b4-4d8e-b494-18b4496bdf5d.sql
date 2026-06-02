-- Revoke EXECUTE on SECURITY DEFINER functions from anon and public; keep authenticated + service_role
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', fn.proname, fn.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role;', fn.proname, fn.args);
  END LOOP;
END $$;

-- Tighten page_visits INSERT policy: require a reasonable path length instead of WITH CHECK (true)
DROP POLICY IF EXISTS "Anyone can record a visit" ON public.page_visits;
CREATE POLICY "Anyone can record a visit"
  ON public.page_visits
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    path IS NOT NULL
    AND length(path) BETWEEN 1 AND 2048
    AND (user_agent IS NULL OR length(user_agent) <= 1024)
    AND (referrer IS NULL OR length(referrer) <= 2048)
    AND (user_id IS NULL OR user_id = auth.uid())
  );