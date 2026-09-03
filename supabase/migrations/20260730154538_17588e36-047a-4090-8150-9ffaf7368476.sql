DROP POLICY IF EXISTS "vendor_logos_probe" ON storage.objects;
CREATE POLICY "vendor_logos_probe" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vendor-logos' AND auth.uid() IS NOT NULL);
