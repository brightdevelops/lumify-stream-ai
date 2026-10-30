CREATE TABLE public.voice_clone_operations (user_id uuid PRIMARY KEY, operation_id uuid NOT NULL, expires_at timestamptz NOT NULL);
GRANT ALL ON public.voice_clone_operations TO service_role;
ALTER TABLE public.voice_clone_operations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.begin_voice_clone(p_user_id uuid, p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acquired uuid; recent jsonb;
BEGIN
 INSERT INTO public.voice_clone_operations(user_id, operation_id, expires_at) VALUES(p_user_id,p_operation_id,now()+interval '5 minutes') ON CONFLICT(user_id) DO UPDATE SET operation_id=excluded.operation_id, expires_at=excluded.expires_at WHERE voice_clone_operations.expires_at<=now() RETURNING operation_id INTO acquired;
 IF acquired IS NULL THEN RAISE EXCEPTION 'A voice clone is already in progress. Please wait and try again.'; END IF;
 SELECT coalesce(jsonb_agg(created_at ORDER BY created_at),'[]'::jsonb) INTO recent FROM public.voice_usage WHERE user_id=p_user_id AND kind='clone' AND credits>0 AND created_at>now()-interval '24 hours';
 RETURN jsonb_build_object('created_at',recent,'now',now());
END $$;
CREATE OR REPLACE FUNCTION public.finish_voice_clone(p_user_id uuid,p_operation_id uuid,p_voice_id text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.voice_clone_operations WHERE user_id=p_user_id AND operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Voice clone operation expired.'; END IF;
 INSERT INTO public.voice_usage(user_id,kind,characters,credits,voice_id,source) VALUES(p_user_id,'clone',0,150,p_voice_id,'dashboard');
END $$;
CREATE OR REPLACE FUNCTION public.end_voice_clone(p_user_id uuid,p_operation_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ DELETE FROM public.voice_clone_operations WHERE user_id=p_user_id AND operation_id=p_operation_id; $$;
REVOKE ALL ON FUNCTION public.begin_voice_clone(uuid,uuid), public.finish_voice_clone(uuid,uuid,text), public.end_voice_clone(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_voice_clone(uuid,uuid), public.finish_voice_clone(uuid,uuid,text), public.end_voice_clone(uuid,uuid) TO service_role;