
CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_settings public read"
  ON public.site_settings FOR SELECT
  USING (true);

CREATE POLICY "site_settings admin update"
  ON public.site_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false));

CREATE POLICY "site_settings admin insert"
  ON public.site_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false));

INSERT INTO public.site_settings (key, value)
VALUES ('maintenance_mode', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_site_setting(p_key text, p_value boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
  THEN RAISE EXCEPTION 'Not authorized'; END IF;

  INSERT INTO public.site_settings (key, value, updated_by, updated_at)
  VALUES (p_key, p_value, auth.uid(), now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
  RETURN p_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_maintenance_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT value FROM public.site_settings WHERE key = 'maintenance_mode'), false);
$$;
