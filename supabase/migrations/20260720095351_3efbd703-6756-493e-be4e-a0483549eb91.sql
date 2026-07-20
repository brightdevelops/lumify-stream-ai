
-- 1. Add session_id link on transactions
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.stream_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_session ON public.transactions(session_id);

-- 2. Rewrite log_usage_transaction with strict session-scoped cap
CREATE OR REPLACE FUNCTION public.log_usage_transaction(
  p_credits integer,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_last_hb timestamptz;
  v_session_owner uuid;
  v_elapsed_sec int;
  v_max_credits int;
  v_capped_credits int := COALESCE(p_credits, 0);
  v_capped_amount numeric := COALESCE(p_amount, 0);
  v_desc text := p_description;
  v_note text := '';
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_credits IS NULL OR p_credits < 0 THEN RAISE EXCEPTION 'Invalid credit amount'; END IF;

  -- Prefer explicit session_id
  IF p_session_id IS NOT NULL THEN
    SELECT s.user_id, s.started_at, s.ended_at, s.last_heartbeat
      INTO v_session_owner, v_started_at, v_ended_at, v_last_hb
    FROM public.stream_sessions s
    WHERE s.id = p_session_id;

    IF v_session_owner IS NULL OR v_session_owner <> v_user THEN
      -- Session not found or belongs to a different user: charge 0 with a warning row
      INSERT INTO public.transactions (user_id, type, amount, credits, description, session_id)
      VALUES (v_user, 'usage', 0, 0,
              COALESCE(v_desc,'') || ' [BLOCKED: session ' || COALESCE(p_session_id::text,'null') || ' not found for user; original ask ' || COALESCE(p_credits,0) || 'c]',
              p_session_id);
      RAISE WARNING 'log_usage_transaction: session % missing/mismatched for user %, charged 0', p_session_id, v_user;
      RETURN;
    END IF;
  ELSE
    -- Legacy path: fall back to most-recent session in last 12h, but never uncapped
    SELECT s.id, s.started_at, s.ended_at, s.last_heartbeat
      INTO p_session_id, v_started_at, v_ended_at, v_last_hb
    FROM public.stream_sessions s
    WHERE s.user_id = v_user
      AND s.started_at >= now() - interval '12 hours'
    ORDER BY s.started_at DESC
    LIMIT 1;

    IF v_started_at IS NULL THEN
      INSERT INTO public.transactions (user_id, type, amount, credits, description)
      VALUES (v_user, 'usage', 0, 0,
              COALESCE(v_desc,'') || ' [BLOCKED: no matching session; original ask ' || COALESCE(p_credits,0) || 'c]');
      RAISE WARNING 'log_usage_transaction: no session for user %, charged 0', v_user;
      RETURN;
    END IF;
  END IF;

  -- Elapsed, clamped to 0 if negative (corrupted timestamps)
  v_elapsed_sec := GREATEST(
    EXTRACT(EPOCH FROM (COALESCE(v_ended_at, v_last_hb, v_started_at) - v_started_at))::int,
    0
  );
  v_max_credits := (v_elapsed_sec + 10) * 2; -- 10s grace, 2 credits/sec

  IF v_capped_credits > v_max_credits THEN
    IF p_credits > 0 AND v_capped_amount > 0 THEN
      v_capped_amount := ROUND(v_capped_amount * v_max_credits::numeric / p_credits::numeric, 2);
    END IF;
    v_note := ' [capped from ' || p_credits || ' → ' || v_max_credits || ' by session-duration guard]';
    v_capped_credits := v_max_credits;
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, credits, description, session_id)
  VALUES (v_user, 'usage', v_capped_amount, v_capped_credits, COALESCE(v_desc,'') || v_note, p_session_id);
END;
$$;

-- 3. pg_cron: auto-close stale sessions every 5 minutes
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'auto-close-stale-sessions';
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;

SELECT cron.schedule(
  'auto-close-stale-sessions',
  '*/5 * * * *',
  $cron$
    UPDATE public.stream_sessions
       SET ended_at = last_heartbeat
     WHERE ended_at IS NULL
       AND last_heartbeat < now() - interval '5 minutes'
  $cron$
);

-- 4. Dry-run: list overcharges eligible for refund (idempotent, admin-only)
CREATE OR REPLACE FUNCTION public.admin_dry_run_overcharge_refunds()
RETURNS TABLE(
  user_id uuid,
  user_email text,
  tx_id uuid,
  tx_created_at timestamptz,
  charged_credits int,
  allowed_credits int,
  over_credits int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT ON (t.id)
      t.id AS tx_id, t.user_id, t.created_at AS tx_created_at, t.credits AS charged_credits,
      COALESCE(t.session_id, s.id) AS session_id,
      GREATEST(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, s.last_heartbeat, s.started_at) - s.started_at))::int, 0) AS elapsed_sec
    FROM public.transactions t
    LEFT JOIN public.stream_sessions s
      ON s.id = t.session_id
      OR (t.session_id IS NULL
          AND s.user_id = t.user_id
          AND s.started_at <= t.created_at
          AND s.started_at >= t.created_at - interval '12 hours')
    WHERE t.type = 'usage'
    ORDER BY t.id, s.started_at DESC
  )
  SELECT
    m.user_id,
    p.email,
    m.tx_id,
    m.tx_created_at,
    m.charged_credits,
    ((COALESCE(m.elapsed_sec, 0) + 10) * 2) AS allowed_credits,
    (m.charged_credits - ((COALESCE(m.elapsed_sec, 0) + 10) * 2)) AS over_credits
  FROM matched m
  JOIN public.profiles p ON p.id = m.user_id
  WHERE m.charged_credits > ((COALESCE(m.elapsed_sec, 0) + 10) * 2)
    AND p.email <> 'brightsolutionslab@gmail.com'
    AND NOT EXISTS (
      SELECT 1 FROM public.credit_ledger cl
      WHERE cl.user_id = m.user_id
        AND cl.reason = 'overcharge_refund'
        AND cl.note = 'tx=' || m.tx_id::text
    )
  ORDER BY (m.charged_credits - ((COALESCE(m.elapsed_sec, 0) + 10) * 2)) DESC;
END; $$;

-- 5. Execute refunds — idempotent, admin-only, NOT run automatically
CREATE OR REPLACE FUNCTION public.admin_execute_overcharge_refunds()
RETURNS TABLE(refunded_tx_count int, total_credits_refunded bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_new_balance int;
  v_count int := 0;
  v_total bigint := 0;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor, 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = v_actor), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  FOR r IN SELECT * FROM public.admin_dry_run_overcharge_refunds() LOOP
    -- Guard against races: re-check per row
    IF EXISTS (
      SELECT 1 FROM public.credit_ledger cl
      WHERE cl.user_id = r.user_id AND cl.reason = 'overcharge_refund' AND cl.note = 'tx=' || r.tx_id::text
    ) THEN CONTINUE; END IF;

    UPDATE public.credits
       SET balance = balance + r.over_credits, updated_at = now()
     WHERE user_id = r.user_id
     RETURNING balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
      INSERT INTO public.credits (user_id, balance) VALUES (r.user_id, r.over_credits)
      RETURNING balance INTO v_new_balance;
    END IF;

    UPDATE public.profiles SET credits = v_new_balance WHERE id = r.user_id;

    INSERT INTO public.credit_ledger (user_id, delta, reason, performed_by, note, balance_after)
    VALUES (r.user_id, r.over_credits, 'overcharge_refund', v_actor, 'tx=' || r.tx_id::text, v_new_balance);

    v_count := v_count + 1;
    v_total := v_total + r.over_credits;
  END LOOP;

  RETURN QUERY SELECT v_count, v_total;
END; $$;

REVOKE ALL ON FUNCTION public.admin_dry_run_overcharge_refunds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_execute_overcharge_refunds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dry_run_overcharge_refunds() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_execute_overcharge_refunds() TO authenticated, service_role;
