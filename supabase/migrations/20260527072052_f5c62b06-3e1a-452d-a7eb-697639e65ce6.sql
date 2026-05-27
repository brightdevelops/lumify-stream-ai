
CREATE OR REPLACE FUNCTION public.log_usage_transaction(
  p_credits integer,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_credits IS NULL OR p_credits < 0 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;
  INSERT INTO public.transactions (user_id, type, amount, credits, description)
  VALUES (v_user, 'usage', COALESCE(p_amount, 0), p_credits, p_description);
END;
$$;

REVOKE ALL ON FUNCTION public.log_usage_transaction(integer, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_usage_transaction(integer, numeric, text) TO authenticated;
