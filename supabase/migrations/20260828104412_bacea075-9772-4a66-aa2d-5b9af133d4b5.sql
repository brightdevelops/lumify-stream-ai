CREATE TABLE public.auth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  event text NOT NULL,
  detail jsonb,
  clock_skew_seconds int,
  visibility_state text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.auth_events TO anon, authenticated;
GRANT ALL ON public.auth_events TO service_role;

ALTER TABLE public.auth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log auth events"
  ON public.auth_events FOR INSERT TO anon, authenticated
  WITH CHECK (true);