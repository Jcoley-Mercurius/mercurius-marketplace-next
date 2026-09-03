-- 1) Vendor contact exposure: ensure email/phone are never readable by public roles
REVOKE SELECT (email, phone) ON public.contractors FROM anon;
REVOKE SELECT (email, phone) ON public.contractors FROM authenticated;
REVOKE SELECT (email, phone) ON public.contractors FROM PUBLIC;
-- Scope the public listing policy to explicit roles instead of PUBLIC
DROP POLICY IF EXISTS "Anyone can view active contractors" ON public.contractors;
CREATE POLICY "Anyone can view active contractors"
  ON public.contractors
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
DROP POLICY IF EXISTS "Vendors can view own contractor record" ON public.contractors;
CREATE POLICY "Vendors can view own contractor record"
  ON public.contractors
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Vendors can update own contractor record" ON public.contractors;
CREATE POLICY "Vendors can update own contractor record"
  ON public.contractors
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- 2) job-photos storage: require the upload path to belong to the uploader
DROP POLICY IF EXISTS "Authenticated users can upload job photos" ON storage.objects;
CREATE POLICY "Users can upload job photos to own folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'job-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
DROP POLICY IF EXISTS "Users can delete own job photos" ON storage.objects;
CREATE POLICY "Users can delete own job photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'job-photos'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );
