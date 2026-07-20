
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key text NOT NULL UNIQUE DEFAULT 'main',
  is_active boolean NOT NULL DEFAULT false,
  tag_text text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  button_text text NOT NULL DEFAULT '',
  button_link text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  frequency text NOT NULL DEFAULT 'once_per_user' CHECK (frequency IN ('once_per_user','once_per_day','every_visit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read announcements"
  ON public.announcements FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert announcements"
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  );

CREATE POLICY "Admins can update announcements"
  ON public.announcements FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  );

CREATE POLICY "Admins can delete announcements"
  ON public.announcements FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
  );

CREATE TRIGGER announcements_touch_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the single row so admins have something to edit immediately.
INSERT INTO public.announcements (singleton_key) VALUES ('main')
ON CONFLICT (singleton_key) DO NOTHING;

-- Storage policies for announcement-images bucket
CREATE POLICY "Public read announcement images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'announcement-images');

CREATE POLICY "Admins upload announcement images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'announcement-images'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
    )
  );

CREATE POLICY "Admins update announcement images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'announcement-images'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
    )
  );

CREATE POLICY "Admins delete announcement images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'announcement-images'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
    )
  );
