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

  -- HOTFIX 2026-07-22: heartbeats (deduct_and_mark_session) already charge the
  -- wallet every second. End-of-stream must ONLY write the audit tx row and
  -- close the session — NEVER touch the wallet again. Setting v_delta := 0
  -- stops the double-charge that was booking (logged - credits_used) a second
  -- time whenever credits_used lagged.
  v_delta := 0;
  v_note := v_note || ' [hotfix: no wallet delta at endStream; heartbeat is authoritative]';

  BEGIN
    INSERT INTO public.transactions
      (user_id, type, amount, credits, description, session_id, category)
    VALUES
      (v_user, 'usage', v_amount, v_logged,
       COALESCE(p_description, '') || v_note, p_session_id, 'purchase');
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  UPDATE public.stream_sessions
     SET credits_used = GREATEST(credits_used, v_logged),
         ended_at     = COALESCE(ended_at, now())
   WHERE id = p_session_id;
END;
$function$;