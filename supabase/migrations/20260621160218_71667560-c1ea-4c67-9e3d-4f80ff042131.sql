
-- 1) Revoke public/anon EXECUTE on resolve_stream_token (now called via server-side admin client only)
REVOKE EXECUTE ON FUNCTION public.resolve_stream_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_stream_token(uuid) TO service_role;

-- 2) Avatar storage: add UPDATE policy scoped to owner's folder
DROP POLICY IF EXISTS "Avatar owners can update own files" ON storage.objects;
CREATE POLICY "Avatar owners can update own files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatar-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatar-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) Support tables: drop is_admin-based policies, rely on has_role only
DROP POLICY IF EXISTS "Users see own conversations" ON public.support_conversations;
CREATE POLICY "Users see own conversations"
  ON public.support_conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update conversations" ON public.support_conversations;
CREATE POLICY "Admins update conversations"
  ON public.support_conversations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users see own messages" ON public.support_messages;
CREATE POLICY "Users see own messages"
  ON public.support_messages FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Users insert own user messages, admins insert admin messages" ON public.support_messages;
CREATE POLICY "Users insert own user messages, admins insert admin messages"
  ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (
    (sender = 'user' AND auth.uid() = user_id)
    OR (sender = 'admin' AND public.has_role(auth.uid(), 'admin'))
  );

DROP POLICY IF EXISTS "Mark messages read" ON public.support_messages;
CREATE POLICY "Mark messages read"
  ON public.support_messages FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
