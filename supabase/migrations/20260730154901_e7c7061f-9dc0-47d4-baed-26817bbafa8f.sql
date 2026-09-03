CREATE POLICY "vendor_media_select" ON storage.objects FOR SELECT TO authenticated, anon
USING (bucket_id = 'vendor-media');
CREATE POLICY "vendor_media_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-media' AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(objects.name))[1])
  )
);
CREATE POLICY "vendor_media_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vendor-media' AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(objects.name))[1])
  )
);
CREATE POLICY "vendor_media_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-media' AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(objects.name))[1])
  )
);
