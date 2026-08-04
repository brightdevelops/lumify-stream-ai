CREATE OR REPLACE FUNCTION public.api_charge_credits(p_user_id uuid, p_amount numeric, p_description text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credits int := CEIL(GREATEST(p_amount, 0))::int;
  v_new_balance int;
BEGIN
  IF v_credits <= 0 THEN RETURN true; END IF;

  UPDATE public.credits
     SET balance = balance - v_credits,
         updated_at = now()
   WHERE user_id = p_user_id
     AND balance >= v_credits
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN RETURN false; END IF;

  INSERT INTO public.transactions (user_id, type, amount, credits, description, category)
  VALUES (p_user_id, 'usage', 0, v_credits, COALESCE(p_description, 'API usage'), 'purchase');

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.api_refund_credits(p_user_id uuid, p_amount numeric, p_description text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credits int := CEIL(GREATEST(p_amount, 0))::int;
BEGIN
  IF v_credits <= 0 THEN RETURN true; END IF;

  UPDATE public.credits
     SET balance = balance + v_credits,
         updated_at = now()
   WHERE user_id = p_user_id;

  INSERT INTO public.transactions (user_id, type, amount, credits, description, category)
  VALUES (p_user_id, 'purchase', 0, v_credits, COALESCE(p_description, 'API refund'), 'refund');

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.api_charge_credits(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.api_refund_credits(uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_charge_credits(uuid, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.api_refund_credits(uuid, numeric, text) TO service_role;