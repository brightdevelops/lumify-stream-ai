DROP POLICY IF EXISTS "Anyone can log auth events" ON public.auth_events;
CREATE POLICY "Log own or anonymous auth events" ON public.auth_events
FOR INSERT TO anon, authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND event IN ('unexpected_signout','recovery_adopted','recovery_failed','loading_timeout','guard_redirect','refresh_failed')
  AND (user_agent IS NULL OR length(user_agent) <= 512)
  AND (visibility_state IS NULL OR length(visibility_state) <= 32)
  AND (detail IS NULL OR pg_column_size(detail) <= 4096)
);