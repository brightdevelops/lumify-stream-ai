
CREATE TABLE public.saved_phrases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  label text NOT NULL,
  source_text text NOT NULL,
  language_code text NOT NULL,
  language_name text NOT NULL,
  voice_id text NOT NULL,
  voice_label text NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0,
  credits_spent integer NOT NULL DEFAULT 0,
  mime_type text NOT NULL DEFAULT 'audio/mpeg',
  audio_base64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_phrases TO authenticated;
GRANT ALL ON public.saved_phrases TO service_role;

ALTER TABLE public.saved_phrases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own saved phrases"
  ON public.saved_phrases FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own saved phrases"
  ON public.saved_phrases FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own saved phrases"
  ON public.saved_phrases FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_saved_phrases_user_created ON public.saved_phrases(user_id, created_at DESC);
