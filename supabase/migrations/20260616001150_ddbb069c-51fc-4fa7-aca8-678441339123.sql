ALTER TABLE public.stream_events ADD COLUMN IF NOT EXISTS image_path text;

CREATE OR REPLACE FUNCTION public.admin_get_session_detail(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_chunks jsonb;
  v_events jsonb;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin FROM public.profiles WHERE id = auth.uid();
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'storage_path', storage_path, 'chunk_index', chunk_index,
    'duration_seconds', duration_seconds, 'size_bytes', size_bytes, 'created_at', created_at
  ) ORDER BY chunk_index), '[]'::jsonb)
  INTO v_chunks
  FROM public.stream_recordings
  WHERE (p_session_id IS NULL AND session_id IS NULL) OR session_id = p_session_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'event_type', event_type, 'prompt', prompt, 'style', style,
    'mode', mode, 'realism', realism, 'image_name', image_name,
    'image_path', image_path, 'created_at', created_at
  ) ORDER BY created_at), '[]'::jsonb)
  INTO v_events
  FROM public.stream_events
  WHERE (p_session_id IS NULL AND session_id IS NULL) OR session_id = p_session_id;

  RETURN jsonb_build_object('chunks', v_chunks, 'events', v_events);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_session_detail(uuid) TO authenticated;