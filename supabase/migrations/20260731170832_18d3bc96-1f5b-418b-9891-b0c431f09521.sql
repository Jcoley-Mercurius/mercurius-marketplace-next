ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS document_urls text[] NOT NULL DEFAULT '{}'::text[];
-- Storage policies for the private vendor-documents bucket
CREATE POLICY "Applicants can upload application documents"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'vendor-documents'
  AND (storage.foldername(name))[1] = 'applications'
);
CREATE POLICY "Admins can read vendor documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'vendor-documents' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update vendor documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'vendor-documents' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'vendor-documents' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete vendor documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'vendor-documents' AND public.has_role(auth.uid(), 'admin'));
