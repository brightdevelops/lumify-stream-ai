
-- 1) Revoke EXECUTE from anon on SECURITY DEFINER functions that should require auth
REVOKE EXECUTE ON FUNCTION public.admin_list_support_conversations(integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_mark_conversation_read(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_my_conversation_read(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.support_after_message_insert() FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_list_support_conversations(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_conversation_read(uuid) TO authenticated;

-- 2) Admin SELECT policy on profiles so admins can manage users via RLS-aware paths
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Storage DELETE policy: users can delete their own stream recordings
DROP POLICY IF EXISTS "Users delete their own recordings" ON storage.objects;
CREATE POLICY "Users delete their own recordings" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'stream-recordings'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
