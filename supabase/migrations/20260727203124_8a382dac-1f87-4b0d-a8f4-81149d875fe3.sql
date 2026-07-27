
CREATE TABLE public.tutorials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL,
  storage_path TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tutorials TO authenticated;
GRANT ALL ON public.tutorials TO service_role;

ALTER TABLE public.tutorials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can view tutorials"
  ON public.tutorials FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admins can insert tutorials"
  ON public.tutorials FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update tutorials"
  ON public.tutorials FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete tutorials"
  ON public.tutorials FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Storage policies for tutorial-videos bucket
CREATE POLICY "authenticated can read tutorial videos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'tutorial-videos');

CREATE POLICY "admins can upload tutorial videos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'tutorial-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can update tutorial videos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'tutorial-videos' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can delete tutorial videos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'tutorial-videos' AND public.has_role(auth.uid(), 'admin'));
