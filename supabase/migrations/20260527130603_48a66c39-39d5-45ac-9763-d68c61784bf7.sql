
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stream_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stream_token_idx ON public.profiles(stream_token);

-- Update handle_new_user to set token (default already covers it, but explicit)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.credits (user_id, balance) VALUES (NEW.id, 0);
  RETURN NEW;
END;
$function$;

-- Function to resolve a stream token to user_id (callable by anon for OBS)
CREATE OR REPLACE FUNCTION public.resolve_stream_token(p_token uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE stream_token = p_token LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_stream_token(uuid) TO anon, authenticated;

-- Function to regenerate the current user's stream token
CREATE OR REPLACE FUNCTION public.regenerate_stream_token()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_new uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.profiles SET stream_token = v_new WHERE id = v_user;
  RETURN v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_stream_token() TO authenticated;
