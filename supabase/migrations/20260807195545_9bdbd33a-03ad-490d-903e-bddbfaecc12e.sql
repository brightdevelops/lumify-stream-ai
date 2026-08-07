CREATE OR REPLACE FUNCTION public.insert_cloned_voice_if_under_cap(
  p_user_id uuid,
  p_cartesia_voice_id text,
  p_name text,
  p_language text,
  p_max int
)
RETURNS public.user_cloned_voices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_row public.user_cloned_voices;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cloned_voice_cap:' || p_user_id::text));

  SELECT count(*) INTO v_count
  FROM public.user_cloned_voices
  WHERE user_id = p_user_id;

  IF v_count >= p_max THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.user_cloned_voices (user_id, cartesia_voice_id, name, language)
  VALUES (p_user_id, p_cartesia_voice_id, p_name, p_language)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_cloned_voice_if_under_cap(uuid, text, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_cloned_voice_if_under_cap(uuid, text, text, text, int) TO service_role;