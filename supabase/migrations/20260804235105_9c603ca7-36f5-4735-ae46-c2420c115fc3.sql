CREATE TABLE public.user_cloned_voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cartesia_voice_id text NOT NULL UNIQUE,
  name text NOT NULL,
  language text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.user_cloned_voices TO authenticated;
GRANT ALL ON public.user_cloned_voices TO service_role;

ALTER TABLE public.user_cloned_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own cloned voices"
  ON public.user_cloned_voices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_cloned_voices_user ON public.user_cloned_voices(user_id);