CREATE TABLE public.voice_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  voice_id text,
  voice_name text,
  transcript_preview text,
  characters int,
  format text,
  storage_path text NOT NULL,
  bytes int,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.voice_generations TO authenticated;
GRANT ALL ON public.voice_generations TO service_role;

ALTER TABLE public.voice_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own saved generations"
ON public.voice_generations FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX voice_generations_user_created_idx ON public.voice_generations (user_id, created_at DESC);