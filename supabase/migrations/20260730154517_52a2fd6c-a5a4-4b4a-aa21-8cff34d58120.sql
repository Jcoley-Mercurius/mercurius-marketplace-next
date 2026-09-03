DROP POLICY IF EXISTS "Admins can upload vendor logos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update vendor logos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete vendor logos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload vendor gallery" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update vendor gallery" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete vendor gallery" ON storage.objects;
DROP POLICY IF EXISTS "Vendors can upload own gallery" ON storage.objects;
DROP POLICY IF EXISTS "Vendors can delete own gallery" ON storage.objects;
CREATE POLICY "vendor_logos_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-logos' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
CREATE POLICY "vendor_logos_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vendor-logos' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
)
WITH CHECK (
  bucket_id = 'vendor-logos' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
CREATE POLICY "vendor_logos_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-logos' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
CREATE POLICY "vendor_gallery_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'vendor-gallery' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
CREATE POLICY "vendor_gallery_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'vendor-gallery' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
)
WITH CHECK (
  bucket_id = 'vendor-gallery' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
CREATE POLICY "vendor_gallery_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'vendor-gallery' AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.contractors c WHERE c.user_id = auth.uid() AND c.id::text = (storage.foldername(name))[1])
  )
);
