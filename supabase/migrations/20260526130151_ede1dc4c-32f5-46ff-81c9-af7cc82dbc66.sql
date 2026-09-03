REVOKE SELECT (email, phone) ON public.contractors FROM anon;
REVOKE SELECT (customer_id) ON public.reviews FROM anon;
DROP POLICY IF EXISTS "Authenticated users can view job photos" ON storage.objects;
CREATE POLICY "Job participants can view job photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.job_photos jp
      JOIN public.service_requests sr ON sr.id = jp.service_request_id
      LEFT JOIN public.contractors c ON c.id = sr.contractor_id
      WHERE jp.photo_url LIKE '%' || storage.objects.name
        AND (sr.customer_id = auth.uid() OR c.user_id = auth.uid())
    )
  )
);
DROP POLICY IF EXISTS "Vendors can upload own gallery" ON storage.objects;
DROP POLICY IF EXISTS "Vendors can delete own gallery" ON storage.objects;
CREATE POLICY "Vendors can upload own gallery"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vendor-gallery'
  AND EXISTS (
    SELECT 1 FROM public.contractors c
    WHERE c.user_id = auth.uid()
      AND c.id::text = (storage.foldername(name))[1]
  )
);
CREATE POLICY "Vendors can delete own gallery"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'vendor-gallery'
  AND (
    EXISTS (
      SELECT 1 FROM public.contractors c
      WHERE c.user_id = auth.uid()
        AND c.id::text = (storage.foldername(name))[1]
    )
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);
