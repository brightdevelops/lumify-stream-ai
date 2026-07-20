
CREATE OR REPLACE FUNCTION public.log_usage_transaction(p_credits integer, p_amount numeric, p_description text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_elapsed_sec int;
  v_max_credits int;
  v_capped_credits int;
  v_capped_amount numeric;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_credits IS NULL OR p_credits < 0 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;

  -- Server-side cap: charged credits can never exceed the real elapsed time of
  -- the user's most recent stream session (2 credits per second) plus a small
  -- 10-second buffer to absorb rounding. This blocks client-side bugs where a
  -- stale/skewed Date.now() computes a huge duration and logs bogus credits.
  SELECT s.started_at, s.ended_at
    INTO v_started_at, v_ended_at
  FROM public.stream_sessions s
  WHERE s.user_id = v_user
    AND s.started_at >= now() - interval '12 hours'
  ORDER BY s.started_at DESC
  LIMIT 1;

  v_capped_credits := p_credits;
  v_capped_amount := COALESCE(p_amount, 0);

  IF v_started_at IS NOT NULL THEN
    v_elapsed_sec := GREATEST(EXTRACT(EPOCH FROM (COALESCE(v_ended_at, now()) - v_started_at))::int, 0);
    -- +10s buffer, then 2 credits/sec
    v_max_credits := (v_elapsed_sec + 10) * 2;
    IF v_capped_credits > v_max_credits THEN
      IF v_capped_credits > 0 AND v_capped_amount > 0 THEN
        v_capped_amount := ROUND(v_capped_amount * v_max_credits::numeric / v_capped_credits::numeric, 2);
      END IF;
      v_capped_credits := v_max_credits;
      p_description := COALESCE(p_description, '') ||
        ' [capped from ' || p_credits || ' → ' || v_capped_credits ||
        ' by session-duration guard]';
    END IF;
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, credits, description)
  VALUES (v_user, 'usage', v_capped_amount, v_capped_credits, p_description);
END;
$function$;
