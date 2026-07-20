
DROP FUNCTION IF EXISTS public.run_credit_integrity_check();

CREATE FUNCTION public.run_credit_integrity_check()
RETURNS TABLE(out_user_id uuid, out_user_email text, out_computed_balance bigint, out_actual_balance bigint, out_drift bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  _computed bigint;
  _signed bigint;
  _email text;
BEGIN
  FOR r IN SELECT c.user_id AS uid, c.balance AS bal FROM public.credits c LOOP
    _computed := 0;
    FOR _signed IN
      SELECT
        CASE
          WHEN t.category = 'reversal' THEN 0
          WHEN t.type = 'purchase' THEN t.credits
          WHEN t.type = 'usage'    THEN -t.credits
          ELSE 0
        END
      FROM public.transactions t
      WHERE t.user_id = r.uid
      ORDER BY t.created_at, t.id
    LOOP
      _computed := GREATEST(0, _computed + _signed);
    END LOOP;

    IF _computed <> r.bal THEN
      SELECT au.email INTO _email FROM auth.users au WHERE au.id = r.uid;
      INSERT INTO public.admin_integrity_alerts (user_id, user_email, computed_balance, actual_balance, drift)
      VALUES (r.uid, _email, _computed, r.bal, r.bal - _computed);
      out_user_id := r.uid; out_user_email := _email;
      out_computed_balance := _computed; out_actual_balance := r.bal; out_drift := r.bal - _computed;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_credit_integrity_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_credit_integrity_check() TO service_role;

-- Refresh cron entry to point at new function signature
DO $$ BEGIN PERFORM cron.unschedule('run_credit_integrity_check_nightly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('run_credit_integrity_check_nightly','0 3 * * *',$cron$SELECT public.run_credit_integrity_check();$cron$);
