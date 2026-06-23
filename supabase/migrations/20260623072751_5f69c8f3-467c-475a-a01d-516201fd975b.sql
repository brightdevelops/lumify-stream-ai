CREATE OR REPLACE FUNCTION public.admin_close_support_conversation(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
     AND NOT public.has_role(auth.uid(), 'admin')
  THEN RAISE EXCEPTION 'Not authorized'; END IF;
  DELETE FROM public.support_messages WHERE conversation_id = p_conversation_id;
  DELETE FROM public.support_conversations WHERE id = p_conversation_id;
END; $$;