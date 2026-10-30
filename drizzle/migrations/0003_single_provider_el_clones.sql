ALTER TABLE public.user_cloned_voices ADD COLUMN voice_id text;
UPDATE public.user_cloned_voices SET voice_id = elevenlabs_voice_id WHERE elevenlabs_voice_id IS NOT NULL;
ALTER TABLE public.user_cloned_voices ALTER COLUMN cartesia_voice_id DROP NOT NULL;
CREATE UNIQUE INDEX user_cloned_voices_voice_id_key ON public.user_cloned_voices (voice_id) WHERE voice_id IS NOT NULL;
COMMENT ON COLUMN public.user_cloned_voices.voice_id IS 'ElevenLabs voice id — the clone id in the single-provider system.';
COMMENT ON COLUMN public.user_cloned_voices.cartesia_voice_id IS 'DEPRECATED: Cartesia twin removed; replaced by voice_id.';
COMMENT ON COLUMN public.user_cloned_voices.elevenlabs_voice_id IS 'DEPRECATED: twin semantics removed; replaced by voice_id.';

CREATE TABLE public.voice_reclone_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
GRANT SELECT ON public.voice_reclone_grants TO authenticated;
GRANT ALL ON public.voice_reclone_grants TO service_role;
ALTER TABLE public.voice_reclone_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own re-clone grant" ON public.voice_reclone_grants FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.save_el_cloned_voice(p_user_id uuid, p_voice_id text, p_name text, p_language text, p_max int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  IF (SELECT count(*) FROM public.user_cloned_voices WHERE user_id = p_user_id) >= p_max THEN
    RAISE EXCEPTION 'voice_slot_full';
  END IF;
  INSERT INTO public.user_cloned_voices (user_id, voice_id, name, language) VALUES (p_user_id, p_voice_id, p_name, p_language) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.consume_reclone_grant(p_user_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.voice_reclone_grants SET used_at = now() WHERE user_id = p_user_id AND used_at IS NULL;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.save_el_cloned_voice(uuid,text,text,text,int), public.consume_reclone_grant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_el_cloned_voice(uuid,text,text,text,int), public.consume_reclone_grant(uuid) TO service_role;