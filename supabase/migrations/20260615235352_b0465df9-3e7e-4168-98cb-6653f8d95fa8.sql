DROP FUNCTION IF EXISTS public.admin_get_session_detail(uuid);

CREATE FUNCTION public.admin_get_session_detail(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chunks jsonb;
  v_events jsonb;
BEGIN
  IF NOT COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'storage_path', r.storage_path, 'chunk_index', r.chunk_index,
    'duration_seconds', r.duration_seconds, 'size_bytes', r.size_bytes, 'created_at', r.created_at
  ) ORDER BY r.chunk_index), '[]'::jsonb)
  INTO v_chunks FROM public.stream_recordings r
  WHERE r.session_id IS NOT DISTINCT FROM p_session_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', e.id, 'event_type', e.event_type, 'prompt', e.prompt, 'style', e.style,
    'mode', e.mode, 'realism', e.realism, 'image_name', e.image_name, 'created_at', e.created_at
  ) ORDER BY e.created_at), '[]'::jsonb)
  INTO v_events FROM public.stream_events e
  WHERE e.session_id IS NOT DISTINCT FROM p_session_id;

  RETURN jsonb_build_object('chunks', v_chunks, 'events', v_events);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_session_detail(uuid) TO authenticated;