
CREATE OR REPLACE FUNCTION public.log_usage_transaction(p_credits integer, p_amount numeric, p_description text DEFAULT NULL::text, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_started timestamptz; v_ended timestamptz; v_last_hb timestamptz;
  v_session_used int := 0;
  v_elapsed int; v_server_cap int;
  v_logged int; v_amount numeric;
  v_delta int; v_note text := '';
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_credits IS NULL OR p_credits < 0 THEN RAISE EXCEPTION 'Invalid credit amount'; END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT user_id, started_at, ended_at, last_heartbeat, COALESCE(credits_used,0)
      INTO v_owner, v_started, v_ended, v_last_hb, v_session_used
      FROM public.stream_sessions WHERE id = p_session_id;
    IF v_owner IS NULL OR v_owner <> v_user THEN
      INSERT INTO public.transactions (user_id, type, amount, credits, description, session_id, category)
      VALUES (v_user, 'usage', 0, 0,
              COALESCE(p_description,'') || ' [BLOCKED: session mismatch, ask=' || p_credits || 'c]',
              p_session_id, 'purchase');
      RETURN;
    END IF;
  ELSE
    SELECT id, user_id, started_at, ended_at, last_heartbeat, COALESCE(credits_used,0)
      INTO p_session_id, v_owner, v_started, v_ended, v_last_hb, v_session_used
      FROM public.stream_sessions
     WHERE user_id = v_user AND started_at >= now() - interval '12 hours'
     ORDER BY started_at DESC LIMIT 1;
    IF v_started IS NULL THEN
      INSERT INTO public.transactions (user_id, type, amount, credits, description, category)
      VALUES (v_user, 'usage', 0, 0,
              COALESCE(p_description,'') || ' [BLOCKED: no session, ask=' || p_credits || 'c]',
              'purchase');
      RETURN;
    END IF;
  END IF;

  IF p_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.transactions
     WHERE session_id = p_session_id AND type = 'usage'
  ) THEN
    RETURN;
  END IF;

  v_elapsed    := GREATEST(EXTRACT(EPOCH FROM (COALESCE(v_ended, v_last_hb, v_started) - v_started))::int, 0);
  v_server_cap := (v_elapsed + 10) * 2;

  v_logged := GREATEST(LEAST(COALESCE(p_credits, 0), v_server_cap), v_session_used);

  IF v_logged <> COALESCE(p_credits, 0) THEN
    v_note := ' [reconciled: client=' || COALESCE(p_credits,0)
              || ' cap=' || v_server_cap
              || ' hb=' || v_session_used
              || ' → logged=' || v_logged || ']';
  END IF;

  IF COALESCE(p_credits, 0) > 0 AND COALESCE(p_amount, 0) > 0 THEN
    v_amount := ROUND(p_amount * v_logged::numeric / p_credits::numeric, 2);
  ELSE
    v_amount := v_logged;
  END IF;

  v_delta := GREATEST(v_logged - v_session_used, 0);
  IF v_delta > 0 THEN
    UPDATE public.credits
       SET balance = GREATEST(0, balance - v_delta),
           updated_at = now()
     WHERE user_id = v_user;
  END IF;

  BEGIN
    INSERT INTO public.transactions
      (user_id, type, amount, credits, description, session_id, category)
    VALUES
      (v_user, 'usage', v_amount, v_logged,
       COALESCE(p_description, '') || v_note, p_session_id, 'purchase');
  EXCEPTION WHEN unique_violation THEN
    IF v_delta > 0 THEN
      UPDATE public.credits
         SET balance = balance + v_delta, updated_at = now()
       WHERE user_id = v_user;
    END IF;
    RETURN;
  END;

  UPDATE public.stream_sessions
     SET credits_used = v_logged,
         ended_at     = COALESCE(ended_at, now())
   WHERE id = p_session_id;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_usage_per_session_uidx
  ON public.transactions(session_id)
  WHERE type = 'usage' AND session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.auto_close_stale_stream_sessions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_elapsed int;
  v_amount int;
  v_exists boolean;
  v_close_at timestamptz;
BEGIN
  FOR r IN
    SELECT id, user_id, started_at, last_heartbeat, COALESCE(credits_used,0) AS credits_used
      FROM public.stream_sessions
     WHERE ended_at IS NULL
       AND COALESCE(last_heartbeat, started_at) < now() - interval '5 minutes'
  LOOP
    v_close_at := COALESCE(r.last_heartbeat, r.started_at);
    UPDATE public.stream_sessions SET ended_at = v_close_at WHERE id = r.id;

    SELECT EXISTS(
      SELECT 1 FROM public.transactions
       WHERE session_id = r.id AND type = 'usage'
    ) INTO v_exists;
    IF v_exists THEN CONTINUE; END IF;

    v_elapsed := GREATEST(
      EXTRACT(EPOCH FROM (v_close_at - r.started_at))::int,
      0
    );
    v_amount := COALESCE(NULLIF(r.credits_used, 0), GREATEST(0, v_elapsed) * 2 + 20);

    BEGIN
      INSERT INTO public.transactions
        (user_id, type, amount, credits, description, session_id, category)
      VALUES
        (r.user_id, 'usage', v_amount, v_amount,
         'Stream session — auto-closed by cron', r.id, 'purchase');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END;
$function$;
