CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{voice}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX idx_api_keys_user ON public.api_keys(user_id);

GRANT SELECT ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own api keys"
  ON public.api_keys FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE public.api_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  status_code int NOT NULL,
  credits_charged numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_requests_key_created ON public.api_requests(api_key_id, created_at);

GRANT SELECT ON public.api_requests TO authenticated;
GRANT ALL ON public.api_requests TO service_role;

ALTER TABLE public.api_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own api requests"
  ON public.api_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);