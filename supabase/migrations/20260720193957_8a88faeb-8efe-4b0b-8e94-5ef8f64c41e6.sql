
-- 1) One-time backfill: profiles.credits := credits.balance
UPDATE public.profiles p
   SET credits = c.balance
  FROM public.credits c
 WHERE p.id = c.user_id
   AND p.credits IS DISTINCT FROM c.balance;

-- 2) Trigger: keep profiles.credits in lockstep with credits.balance
CREATE OR REPLACE FUNCTION public.sync_profile_credits_from_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET credits = 0 WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;
  UPDATE public.profiles SET credits = NEW.balance WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_credits ON public.credits;
CREATE TRIGGER trg_sync_profile_credits
AFTER INSERT OR UPDATE OF balance OR DELETE ON public.credits
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_credits_from_wallet();

-- 3) Recreate partial unique index so reversal audit rows don't collide
DROP INDEX IF EXISTS public.transactions_one_usage_per_session_uidx;
CREATE UNIQUE INDEX transactions_one_usage_per_session_uidx
  ON public.transactions (session_id)
  WHERE type = 'usage'
    AND session_id IS NOT NULL
    AND category = 'purchase';

-- 4) Extend nightly integrity check to include profile-mirror drift
ALTER TABLE public.admin_integrity_alerts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'wallet_replay_drift';

CREATE OR REPLACE FUNCTION public.run_credit_integrity_check()
RETURNS TABLE(out_user_id uuid, out_user_email text, out_computed_balance bigint,
              out_actual_balance bigint, out_drift bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r RECORD; _computed bigint; _signed bigint; _email text;
BEGIN
  -- wallet vs signed transaction replay
  FOR r IN SELECT c.user_id AS uid, c.balance AS bal FROM public.credits c LOOP
    _computed := 0;
    FOR _signed IN
      SELECT CASE WHEN t.type='purchase' THEN t.credits
                  WHEN t.type='usage'    THEN -t.credits
                  ELSE 0 END
      FROM public.transactions t WHERE t.user_id = r.uid
      ORDER BY t.created_at, t.id
    LOOP
      _computed := GREATEST(0, _computed + _signed);
    END LOOP;

    IF _computed <> r.bal THEN
      SELECT au.email INTO _email FROM auth.users au WHERE au.id = r.uid;
      INSERT INTO public.admin_integrity_alerts (user_id, user_email, computed_balance, actual_balance, drift, kind)
      VALUES (r.uid, _email, _computed, r.bal, r.bal - _computed, 'wallet_replay_drift');
      out_user_id := r.uid; out_user_email := _email;
      out_computed_balance := _computed; out_actual_balance := r.bal; out_drift := r.bal - _computed;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- profiles.credits mirror vs credits.balance
  FOR r IN
    SELECT c.user_id AS uid, c.balance AS bal, p.credits AS mirror
      FROM public.credits c
      JOIN public.profiles p ON p.id = c.user_id
     WHERE p.credits IS DISTINCT FROM c.balance
  LOOP
    SELECT au.email INTO _email FROM auth.users au WHERE au.id = r.uid;
    INSERT INTO public.admin_integrity_alerts (user_id, user_email, computed_balance, actual_balance, drift, kind)
    VALUES (r.uid, _email, r.bal, r.mirror, r.mirror - r.bal, 'profile_mirror_drift');
    out_user_id := r.uid; out_user_email := _email;
    out_computed_balance := r.bal; out_actual_balance := r.mirror; out_drift := r.mirror - r.bal;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- 5) Audit trail repair for the two previously-deleted duplicate usage rows
-- Session 0382a232... user ef7df09c... — duplicate was 84 credits
-- Session c5b1bad8... user 3008a5a3... — duplicate was 120 credits
INSERT INTO public.transactions (user_id, type, credits, amount, description, session_id, category, created_at)
VALUES
  ('ef7df09c-c651-4a18-874d-061ac6b9007f', 'usage',    84, 84,
   'duplicate charge, refunded',
   '0382a232-2b07-4e07-a0fb-e3f12c5e06d2', 'reversal', now()),
  ('ef7df09c-c651-4a18-874d-061ac6b9007f', 'purchase', 84, 0,
   'refund of duplicate charge (session 0382a232)',
   '0382a232-2b07-4e07-a0fb-e3f12c5e06d2', 'reversal', now()),
  ('3008a5a3-fa95-4dad-8f23-ef6aad3c01c0', 'usage',    120, 120,
   'duplicate charge, refunded',
   'c5b1bad8-dffc-4a97-8730-a0772e19192b', 'reversal', now()),
  ('3008a5a3-fa95-4dad-8f23-ef6aad3c01c0', 'purchase', 120, 0,
   'refund of duplicate charge (session c5b1bad8)',
   'c5b1bad8-dffc-4a97-8730-a0772e19192b', 'reversal', now());
