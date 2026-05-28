
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login timestamptz;

CREATE OR REPLACE FUNCTION public.record_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.profiles SET last_login = now() WHERE id = v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;
