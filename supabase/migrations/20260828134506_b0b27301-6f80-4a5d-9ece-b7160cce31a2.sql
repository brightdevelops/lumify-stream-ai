ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS attachment_path text;

CREATE POLICY "Users upload own support attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'support-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users read own support attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'support-attachments' AND ((storage.foldername(name))[1] = auth.uid()::text OR has_role(auth.uid(), 'admin'::app_role)));

CREATE POLICY "Admins upload support attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'support-attachments' AND has_role(auth.uid(), 'admin'::app_role));