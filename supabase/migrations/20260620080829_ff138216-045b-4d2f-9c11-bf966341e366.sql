
CREATE TABLE public.avatar_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  portrait_path text NOT NULL,
  script text NOT NULL,
  source_lang text NOT NULL DEFAULT 'en',
  target_lang text NOT NULL DEFAULT 'en',
  translated_script text,
  voice_id text NOT NULL,
  audio_path text,
  heygen_video_id text,
  video_url text,
  error text,
  credits_charged integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.avatar_jobs TO authenticated;
GRANT ALL ON public.avatar_jobs TO service_role;
ALTER TABLE public.avatar_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own avatar jobs" ON public.avatar_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own avatar jobs" ON public.avatar_jobs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own avatar jobs" ON public.avatar_jobs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own avatar jobs" ON public.avatar_jobs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER avatar_jobs_touch
  BEFORE UPDATE ON public.avatar_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage policies for avatar-assets (private bucket; per-user folders by id)
CREATE POLICY "Users read own avatar assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatar-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users upload own avatar assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatar-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users delete own avatar assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatar-assets' AND (storage.foldername(name))[1] = auth.uid()::text);
