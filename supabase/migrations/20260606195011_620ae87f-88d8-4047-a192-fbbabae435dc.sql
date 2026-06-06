
-- 1) Profiles: block self-escalation of sensitive columns
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND is_admin = (SELECT is_admin FROM public.profiles WHERE id = auth.uid())
  AND banned = (SELECT banned FROM public.profiles WHERE id = auth.uid())
  AND stream_token = (SELECT stream_token FROM public.profiles WHERE id = auth.uid())
  AND obs_token IS NOT DISTINCT FROM (SELECT obs_token FROM public.profiles WHERE id = auth.uid())
);

-- 2) credit_ledger: explicit admin-only SELECT policy
CREATE POLICY "Admins view credit ledger"
ON public.credit_ledger
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) Revoke anon EXECUTE on privileged SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_finance_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_ledger(integer, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_metrics() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_unban_user(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_start_stream() FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_purchase(uuid, text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.deduct_stream_credits(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_ledger(integer) FROM anon;
