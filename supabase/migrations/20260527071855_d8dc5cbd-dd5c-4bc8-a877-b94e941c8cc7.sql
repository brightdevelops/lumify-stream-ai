
-- Drop unsafe policies
DROP POLICY IF EXISTS "Users update own credits" ON public.credits;
DROP POLICY IF EXISTS "Users insert own transactions" ON public.transactions;

-- Secure function: deduct credits and log usage in one transaction
CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_credits integer,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_log_transaction boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_new_balance integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;

  UPDATE public.credits
     SET balance = GREATEST(0, balance - p_credits),
         updated_at = now()
   WHERE user_id = v_user
   RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'No credit row for user';
  END IF;

  IF p_log_transaction THEN
    INSERT INTO public.transactions (user_id, type, amount, credits, description)
    VALUES (v_user, 'usage', COALESCE(p_amount, 0), p_credits, p_description);
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Secure function: add credits and log purchase
CREATE OR REPLACE FUNCTION public.purchase_credits(
  p_credits integer,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_new_balance integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Invalid credit amount';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  UPDATE public.credits
     SET balance = balance + p_credits,
         updated_at = now()
   WHERE user_id = v_user
   RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    INSERT INTO public.credits (user_id, balance)
    VALUES (v_user, p_credits)
    RETURNING balance INTO v_new_balance;
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, credits, description)
  VALUES (v_user, 'purchase', p_amount, p_credits, p_description);

  RETURN v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purchase_credits(integer, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) TO authenticated;
