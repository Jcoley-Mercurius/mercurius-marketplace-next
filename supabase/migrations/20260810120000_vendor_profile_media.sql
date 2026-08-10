-- Self-serve vendor profile media. Public profile rows store long-lived signed
-- URLs while source objects remain in the private vendor-media bucket.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'vendor-media',
  'vendor-media',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object names begin with the linked contractor id. Admin access remains
-- available through the existing admin policies; these policies add the
-- minimum owner access required for vendor self-service.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Linked vendors can read own profile media'
  ) THEN
    CREATE POLICY "Linked vendors can read own profile media"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'vendor-media'
        AND EXISTS (
          SELECT 1 FROM public.contractors c
          WHERE c.user_id = auth.uid()
            AND c.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Linked vendors can upload own profile media'
  ) THEN
    CREATE POLICY "Linked vendors can upload own profile media"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'vendor-media'
        AND EXISTS (
          SELECT 1 FROM public.contractors c
          WHERE c.user_id = auth.uid()
            AND c.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Linked vendors can update own profile media'
  ) THEN
    CREATE POLICY "Linked vendors can update own profile media"
      ON storage.objects FOR UPDATE TO authenticated
      USING (
        bucket_id = 'vendor-media'
        AND EXISTS (
          SELECT 1 FROM public.contractors c
          WHERE c.user_id = auth.uid()
            AND c.id::text = (storage.foldername(name))[1]
        )
      )
      WITH CHECK (
        bucket_id = 'vendor-media'
        AND EXISTS (
          SELECT 1 FROM public.contractors c
          WHERE c.user_id = auth.uid()
            AND c.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Linked vendors can delete own profile media'
  ) THEN
    CREATE POLICY "Linked vendors can delete own profile media"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'vendor-media'
        AND EXISTS (
          SELECT 1 FROM public.contractors c
          WHERE c.user_id = auth.uid()
            AND c.id::text = (storage.foldername(name))[1]
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contractor_gallery'
      AND policyname = 'Linked vendors manage own profile gallery'
  ) THEN
    CREATE POLICY "Linked vendors manage own profile gallery"
      ON public.contractor_gallery FOR ALL TO authenticated
      USING (
        contractor_id IN (
          SELECT c.id FROM public.contractors c WHERE c.user_id = auth.uid()
        )
      )
      WITH CHECK (
        contractor_id IN (
          SELECT c.id FROM public.contractors c WHERE c.user_id = auth.uid()
        )
      );
  END IF;
END
$$;
