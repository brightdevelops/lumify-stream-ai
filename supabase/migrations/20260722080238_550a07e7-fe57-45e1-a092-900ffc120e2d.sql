
-- STEP 1a: Clean any existing duplicate open sessions per user.
-- Keep the most recent open row (by started_at), close older ones,
-- and reconcile their usage exactly like auto_close_stale_stream_sessions().
DO $cleanup$
DECLARE
  r record;
  v_close_at timestamptz;
  v_elapsed int;
  v_amount int;
  v_exists boolean;
BEGIN
  FOR r IN
    SELECT s.id, s.user_id, s.started_at, s.last_heartbeat, COALESCE(s.credits_used,0) AS credits_used
    FROM public.stream_sessions s
    WHERE s.ended_at IS NULL
      AND s.id NOT IN (
        SELECT DISTINCT ON (user_id) id
        FROM public.stream_sessions
        WHERE ended_at IS NULL
        ORDER BY user_id, started_at DESC
      )
  LOOP
    v_close_at := COALESCE(r.last_heartbeat, r.started_at);
    UPDATE public.stream_sessions SET ended_at = v_close_at WHERE id = r.id;

    SELECT EXISTS(
      SELECT 1 FROM public.transactions WHERE session_id = r.id AND type = 'usage'
    ) INTO v_exists;
    IF v_exists THEN CONTINUE; END IF;

    v_elapsed := GREATEST(EXTRACT(EPOCH FROM (v_close_at - r.started_at))::int, 0);
    v_amount := COALESCE(NULLIF(r.credits_used, 0), GREATEST(0, v_elapsed) * 2 + 20);

    BEGIN
      INSERT INTO public.transactions
        (user_id, type, amount, credits, description, session_id, category)
      VALUES
        (r.user_id, 'usage', v_amount, v_amount,
         'Stream session — auto-closed (duplicate open session cleanup)', r.id, 'purchase');
    EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;
END $cleanup$;

-- STEP 1b: Hard guarantee — at most one open session per user.
CREATE UNIQUE INDEX IF NOT EXISTS one_open_stream_per_user
  ON public.stream_sessions (user_id)
  WHERE ended_at IS NULL;

-- STEP 2: RPC that safely starts a session for auth.uid().
CREATE OR REPLACE FUNCTION public.start_stream_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_user uuid := auth.uid();
  v_existing record;
  v_close_at timestamptz;
  v_elapsed int;
  v_amount int;
  v_exists boolean;
  v_new_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Find the caller's open session, if any.
  SELECT id, started_at, last_heartbeat, COALESCE(credits_used, 0) AS credits_used
    INTO v_existing
    FROM public.stream_sessions
   WHERE user_id = v_user AND ended_at IS NULL
   ORDER BY started_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- The meter tick updates last_heartbeat every second. Treat >30s as dead.
    IF COALESCE(v_existing.last_heartbeat, v_existing.started_at) < now() - interval '30 seconds' THEN
      v_close_at := COALESCE(v_existing.last_heartbeat, v_existing.started_at);
      UPDATE public.stream_sessions SET ended_at = v_close_at WHERE id = v_existing.id;

      SELECT EXISTS(
        SELECT 1 FROM public.transactions WHERE session_id = v_existing.id AND type = 'usage'
      ) INTO v_exists;

      IF NOT v_exists THEN
        v_elapsed := GREATEST(EXTRACT(EPOCH FROM (v_close_at - v_existing.started_at))::int, 0);
        v_amount := COALESCE(NULLIF(v_existing.credits_used, 0), GREATEST(0, v_elapsed) * 2 + 20);
        BEGIN
          INSERT INTO public.transactions
            (user_id, type, amount, credits, description, session_id, category)
          VALUES
            (v_user, 'usage', v_amount, v_amount,
             'Stream session — auto-closed on new-start reconciliation', v_existing.id, 'purchase');
        EXCEPTION WHEN unique_violation THEN NULL; END;
      END IF;
    ELSE
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.stream_sessions (user_id) VALUES (v_user)
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status', 'conflict');
  END;

  RETURN jsonb_build_object('status', 'ok', 'session_id', v_new_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.start_stream_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_stream_session() TO authenticated;
