
CREATE OR REPLACE FUNCTION public.deduct_and_mark_session(p_credits integer, p_amount numeric, p_session_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_new  integer;
  v_last_hb timestamptz;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_elapsed_sec integer;
  v_charge integer;
  RATE_CREDITS_PER_SEC constant integer := 2;
  MAX_SEC_PER_TICK constant integer := 10;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Server-authoritative charge: derive from time since last_heartbeat.
  -- The client-supplied p_credits/p_amount are ignored for billing (kept only
  -- so existing callers don't break); they may still be inspected in logs.
  IF p_session_id IS NOT NULL THEN
    SELECT last_heartbeat, started_at, ended_at
      INTO v_last_hb, v_started_at, v_ended_at
    FROM public.stream_sessions
    WHERE id = p_session_id AND user_id = v_user
    FOR UPDATE;

    IF v_started_at IS NULL THEN
      RAISE EXCEPTION 'Session not found';
    END IF;
    IF v_ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'Session already ended';
    END IF;

    v_elapsed_sec := GREATEST(
      0,
      LEAST(
        MAX_SEC_PER_TICK,
        EXTRACT(EPOCH FROM (now() - COALESCE(v_last_hb, v_started_at)))::int
      )
    );
    v_charge := v_elapsed_sec * RATE_CREDITS_PER_SEC;
  ELSE
    -- No session context: fall back to a minimal single-tick charge derived
    -- from the client value but hard-capped to one server tick, so an
    -- attacker can't pass an arbitrarily large p_credits either.
    v_charge := LEAST(GREATEST(COALESCE(p_credits, 0), 0), MAX_SEC_PER_TICK * RATE_CREDITS_PER_SEC);
  END IF;

  UPDATE public.credits
     SET balance = GREATEST(0, balance - v_charge),
         updated_at = now()
   WHERE user_id = v_user
   RETURNING balance INTO v_new;
  IF v_new IS NULL THEN RAISE EXCEPTION 'No credit row for user'; END IF;

  IF p_session_id IS NOT NULL THEN
    -- SECURITY DEFINER bypasses the protect_stream_session_columns trigger's
    -- user-scope restriction because it runs as the function owner; we still
    -- explicitly scope to (id, user_id) above via the SELECT ... FOR UPDATE.
    UPDATE public.stream_sessions
       SET credits_used   = COALESCE(credits_used, 0) + v_charge,
           last_heartbeat = now()
     WHERE id = p_session_id AND user_id = v_user;
  END IF;

  RETURN v_new;
END;
$function$;
