
CREATE TABLE IF NOT EXISTS public.admin_integrity_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_email text,
  computed_balance bigint NOT NULL,
  actual_balance bigint NOT NULL,
  drift bigint NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  note text
);

GRANT SELECT ON public.admin_integrity_alerts TO authenticated;
GRANT ALL ON public.admin_integrity_alerts TO service_role;

ALTER TABLE public.admin_integrity_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view integrity alerts" ON public.admin_integrity_alerts;
CREATE POLICY "Admins view integrity alerts" ON public.admin_integrity_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_integrity_alerts_detected ON public.admin_integrity_alerts (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_integrity_alerts_user ON public.admin_integrity_alerts (user_id);

CREATE OR REPLACE FUNCTION public.run_credit_integrity_check()
RETURNS TABLE(user_id uuid, user_email text, computed_balance bigint, actual_balance bigint, drift bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  _computed bigint;
  _actual bigint;
  _email text;
BEGIN
  FOR r IN
    SELECT c.user_id AS uid, c.balance AS bal
    FROM public.credits c
  LOOP
    SELECT COALESCE(SUM(
      CASE
        WHEN t.category = 'reversal' THEN 0
        WHEN t.type = 'purchase' THEN t.credits
        WHEN t.type = 'usage'    THEN -t.credits
        ELSE 0
      END
    ), 0) INTO _computed
    FROM (
      SELECT type, category, credits
      FROM public.transactions
      WHERE user_id = r.uid
      ORDER BY created_at
    ) t;

    -- Apply the same GREATEST(0,…) clamp iteratively
    SELECT COALESCE(SUM(step), 0) INTO _computed FROM (
      SELECT * FROM (
        WITH ordered AS (
          SELECT ROW_NUMBER() OVER (ORDER BY created_at) AS rn,
                 CASE
                   WHEN category = 'reversal' THEN 0
                   WHEN type = 'purchase' THEN credits
                   WHEN type = 'usage'    THEN -credits
                   ELSE 0
                 END AS signed_delta
          FROM public.transactions WHERE user_id = r.uid
        )
        SELECT 0 AS step
      ) sub
    ) x;

    -- Real iterative replay (rewrites _computed):
    _computed := 0;
    FOR _actual IN
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
      _computed := GREATEST(0, _computed + _actual);
    END LOOP;

    IF _computed <> r.bal THEN
      SELECT au.email INTO _email FROM auth.users au WHERE au.id = r.uid;
      INSERT INTO public.admin_integrity_alerts (user_id, user_email, computed_balance, actual_balance, drift)
      VALUES (r.uid, _email, _computed, r.bal, r.bal - _computed);
      user_id := r.uid; user_email := _email;
      computed_balance := _computed; actual_balance := r.bal; drift := r.bal - _computed;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_credit_integrity_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_credit_integrity_check() TO service_role;

-- Nightly schedule (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('run_credit_integrity_check_nightly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'run_credit_integrity_check_nightly',
  '0 3 * * *',
  $cron$SELECT public.run_credit_integrity_check();$cron$
);
