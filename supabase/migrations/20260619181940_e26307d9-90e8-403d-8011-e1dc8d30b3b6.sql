
-- 1. Restrict credits column on profiles UPDATE
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin    = (SELECT p.is_admin    FROM public.profiles p WHERE p.id = auth.uid())
    AND banned      = (SELECT p.banned      FROM public.profiles p WHERE p.id = auth.uid())
    AND credits     = (SELECT p.credits     FROM public.profiles p WHERE p.id = auth.uid())
    AND stream_token = (SELECT p.stream_token FROM public.profiles p WHERE p.id = auth.uid())
    AND NOT (obs_token IS DISTINCT FROM (SELECT p.obs_token FROM public.profiles p WHERE p.id = auth.uid()))
  );

-- 2. Standardize admin policies to has_role() only
DROP POLICY IF EXISTS "Admins read all stream events" ON public.stream_events;
CREATE POLICY "Admins read all stream events" ON public.stream_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read all recordings" ON public.stream_recordings;
CREATE POLICY "Admins read all recordings" ON public.stream_recordings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read all crypto invoices" ON public.crypto_invoices;
CREATE POLICY "Admins read all crypto invoices" ON public.crypto_invoices
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read all payment issues" ON public.payment_issues;
CREATE POLICY "Admins read all payment issues" ON public.payment_issues
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read all stream recordings" ON storage.objects;
CREATE POLICY "Admins read all stream recordings" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'stream-recordings' AND public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins delete stream recordings" ON storage.objects;
CREATE POLICY "Admins delete stream recordings" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'stream-recordings' AND public.has_role(auth.uid(), 'admin'::app_role));

-- Backfill: ensure every profiles.is_admin=true user has the 'admin' user_role
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::app_role FROM public.profiles p
WHERE p.is_admin = true
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. User SELECT policy on credit_ledger
DROP POLICY IF EXISTS "Users view own ledger" ON public.credit_ledger;
CREATE POLICY "Users view own ledger" ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 4. Revoke EXECUTE from anon on privileged SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.purchase_credits_for_user(uuid, integer, numeric, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase(uuid, text, text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_unban_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_metrics() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_finance_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_ledger(integer, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_full() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_credits() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_transactions(integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_user_transactions(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_credit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_active_streams() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_visitor_overview() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_top_pages(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_visits(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_visit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_registration_analytics(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_stream_recordings(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_session_detail(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_crypto_invoices(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_payment_issues(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_payment_issue(uuid, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inventor_visit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_stream_credits(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_start_stream() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_usage_transaction(integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_login() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_stream_token() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_ledger(integer) FROM anon, PUBLIC;

-- Keep resolve_stream_token executable by anon (OBS /output public page)
GRANT EXECUTE ON FUNCTION public.resolve_stream_token(uuid) TO anon, authenticated;
