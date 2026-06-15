
-- ============================================================
-- stream_events: log of prompt/style changes during a session
-- ============================================================
CREATE TABLE public.stream_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.stream_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,           -- 'start' | 'prompt_change' | 'style_change' | 'mode_change' | 'image_change' | 'stop'
  prompt text,
  style text,
  mode text,
  realism integer,
  image_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stream_events TO authenticated;
GRANT ALL ON public.stream_events TO service_role;

ALTER TABLE public.stream_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own stream events"
  ON public.stream_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read their own stream events"
  ON public.stream_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all stream events"
  ON public.stream_events FOR SELECT TO authenticated
  USING (COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false));

CREATE INDEX stream_events_session_idx ON public.stream_events(session_id, created_at);
CREATE INDEX stream_events_user_idx ON public.stream_events(user_id, created_at DESC);

-- ============================================================
-- stream_recordings: one row per uploaded video chunk
-- ============================================================
CREATE TABLE public.stream_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.stream_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  duration_seconds integer,
  size_bytes bigint,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stream_recordings TO authenticated;
GRANT ALL ON public.stream_recordings TO service_role;

ALTER TABLE public.stream_recordings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own recordings"
  ON public.stream_recordings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read their own recordings"
  ON public.stream_recordings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins read all recordings"
  ON public.stream_recordings FOR SELECT TO authenticated
  USING (COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false));

CREATE INDEX stream_recordings_session_idx ON public.stream_recordings(session_id, chunk_index);
CREATE INDEX stream_recordings_user_idx ON public.stream_recordings(user_id, created_at DESC);

-- ============================================================
-- storage.objects RLS for the stream-recordings bucket
-- Path layout: {user_id}/{session_id}/{chunk}.webm
-- ============================================================
CREATE POLICY "Users upload recordings to their own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'stream-recordings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users read their own recordings"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'stream-recordings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Admins read all stream recordings"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'stream-recordings'
    AND COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  );

CREATE POLICY "Admins delete stream recordings"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'stream-recordings'
    AND COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  );

-- ============================================================
-- Admin RPC: list recordings grouped by session for inventor UI
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_list_stream_recordings(p_limit int DEFAULT 200)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  user_email text,
  started_at timestamptz,
  ended_at timestamptz,
  chunk_count bigint,
  total_bytes bigint,
  total_duration_seconds bigint,
  last_recording_at timestamptz,
  is_vpn boolean,
  last_country text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  SELECT
    r.session_id,
    r.user_id,
    u.email::text,
    MIN(r.created_at) AS started_at,
    MAX(r.created_at) AS ended_at,
    COUNT(*)::bigint AS chunk_count,
    COALESCE(SUM(r.size_bytes),0)::bigint AS total_bytes,
    COALESCE(SUM(r.duration_seconds),0)::bigint AS total_duration_seconds,
    MAX(r.created_at) AS last_recording_at,
    p.is_vpn,
    p.last_country
  FROM public.stream_recordings r
  LEFT JOIN auth.users u ON u.id = r.user_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  GROUP BY r.session_id, r.user_id, u.email, p.is_vpn, p.last_country
  ORDER BY MAX(r.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit,1), 1000);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_stream_recordings(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_stream_recordings(int) TO authenticated, service_role;

-- ============================================================
-- Admin RPC: list chunks + events for a single session
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_get_session_detail(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v json;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT json_build_object(
    'chunks', COALESCE((
      SELECT json_agg(json_build_object(
        'id', r.id,
        'storage_path', r.storage_path,
        'chunk_index', r.chunk_index,
        'duration_seconds', r.duration_seconds,
        'size_bytes', r.size_bytes,
        'created_at', r.created_at
      ) ORDER BY r.chunk_index)
      FROM public.stream_recordings r WHERE r.session_id = p_session_id
    ), '[]'::json),
    'events', COALESCE((
      SELECT json_agg(json_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'prompt', e.prompt,
        'style', e.style,
        'mode', e.mode,
        'realism', e.realism,
        'image_name', e.image_name,
        'created_at', e.created_at
      ) ORDER BY e.created_at)
      FROM public.stream_events e WHERE e.session_id = p_session_id
    ), '[]'::json)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_session_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_session_detail(uuid) TO authenticated, service_role;
