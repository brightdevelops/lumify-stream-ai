
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_usage_transaction(integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_credits(integer, numeric, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_credits(integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_usage_transaction(integer, numeric, text) TO authenticated;
