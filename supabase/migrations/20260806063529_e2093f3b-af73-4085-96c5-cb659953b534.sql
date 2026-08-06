CREATE TABLE public.voice_usage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('generation','clone')),
  characters int NOT NULL DEFAULT 0,
  credits numeric NOT NULL DEFAULT 0,
  voice_id text,
  source text NOT NULL CHECK (source IN ('dashboard','api')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.voice_usage TO service_role;

ALTER TABLE public.voice_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX voice_usage_created_at_idx ON public.voice_usage (created_at DESC);
CREATE INDEX voice_usage_user_created_idx ON public.voice_usage (user_id, created_at DESC);