
-- 1) stream_sessions: prevent users from tampering with credits_used / started_at via direct writes.
CREATE OR REPLACE FUNCTION public.protect_stream_session_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- service_role bypasses this trigger logic (it can set anything)
  IF current_setting('request.jwt.claims', true) IS NOT NULL
     AND (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.credits_used := 0;
    NEW.started_at := now();
    NEW.last_heartbeat := now();
    NEW.ended_at := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Users may only update last_heartbeat and ended_at on their own rows.
    NEW.credits_used := OLD.credits_used;
    NEW.started_at := OLD.started_at;
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_stream_session_columns_trg ON public.stream_sessions;
CREATE TRIGGER protect_stream_session_columns_trg
BEFORE INSERT OR UPDATE ON public.stream_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_stream_session_columns();

-- 2) site_visits: replace overly permissive WITH CHECK (true) with constrained policy.
DROP POLICY IF EXISTS "anyone_can_log_visit" ON public.site_visits;
CREATE POLICY "anyone_can_log_visit"
ON public.site_visits
FOR INSERT
TO anon, authenticated
WITH CHECK (
  session_id IS NOT NULL
  AND length(session_id) BETWEEN 1 AND 128
  AND (user_id IS NULL OR user_id = auth.uid())
);

-- 3) Revoke EXECUTE on SECURITY DEFINER functions from anon/public.
-- These functions should only be callable by signed-in users (admin checks happen inside).
REVOKE EXECUTE ON FUNCTION public.admin_get_active_streams() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_top_pages(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_user_transactions(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_visit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_visits(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_visitor_overview() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_credit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_unban_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_credits() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_full() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_registration_analytics(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_finance_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_transactions(integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_metrics() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_ledger(integer, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inventor_visit_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_ledger(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_login() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_usage_transaction(integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_stream_credits(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerate_stream_token() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_start_stream() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purchase_credits_for_user(uuid, integer, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_purchase(uuid, text, text, integer, integer) FROM anon, PUBLIC;

-- Ensure authenticated still has EXECUTE on functions called from the app.
GRANT EXECUTE ON FUNCTION public.get_my_ledger(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_stream_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_start_stream() TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_stream_credits(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_active_streams() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_top_pages(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_transactions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_visit_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_visits(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_visitor_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_credit_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_credits() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users_full() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_registration_analytics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_finance_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_transactions(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_ledger(integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_admin(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventor_visit_stats() TO authenticated;
