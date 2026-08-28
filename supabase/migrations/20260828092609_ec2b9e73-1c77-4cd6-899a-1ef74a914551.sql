CREATE TABLE public.camera_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  phase text NOT NULL,
  error_name text,
  error_message text,
  permission_state text,
  device_count int,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT INSERT ON public.camera_events TO authenticated;
GRANT ALL ON public.camera_events TO service_role;

ALTER TABLE public.camera_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own camera events"
  ON public.camera_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);