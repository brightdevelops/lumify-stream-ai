REVOKE EXECUTE ON FUNCTION public.admin_close_support_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_support_conversation(uuid) TO authenticated;