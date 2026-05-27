
-- Block direct authenticated access — purchases must go through verified server flow
REVOKE EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) FROM PUBLIC, anon, authenticated;

-- Service-role-only version that takes an explicit user id (called from server fn after payment verification)
CREATE OR REPLACE FUNCTION public.purchase_credits_for_user(
  p_user_id uuid,
  p_credits integer,
  p_amount numeric,
  p_description text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_balance integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user id';
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
   WHERE user_id = p_user_id
   RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    INSERT INTO public.credits (user_id, balance)
    VALUES (p_user_id, p_credits)
    RETURNING balance INTO v_new_balance;
  END IF;

  INSERT INTO public.transactions (user_id, type, amount, credits, description)
  VALUES (p_user_id, 'purchase', p_amount, p_credits, p_description);

  RETURN v_new_balance;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.purchase_credits_for_user(uuid, integer, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_credits_for_user(uuid, integer, numeric, text) TO service_role;
