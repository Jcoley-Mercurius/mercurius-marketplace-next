-- Homeowner request intake photos reuse the established job_photos model and
-- private job-photos bucket. Object paths are scoped to auth.uid()/request-id/.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'job-photos',
  'job-photos',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

-- Keep row access tied to the request participants. These policies are
-- idempotent because some environments already have the established model.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_photos'
      AND policyname = 'Homeowners can view photos for own requests'
  ) THEN
    CREATE POLICY "Homeowners can view photos for own requests"
      ON public.job_photos FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.service_requests sr
          WHERE sr.id = service_request_id AND sr.customer_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_photos'
      AND policyname = 'Homeowners can upload photos for own requests'
  ) THEN
    CREATE POLICY "Homeowners can upload photos for own requests"
      ON public.job_photos FOR INSERT TO authenticated
      WITH CHECK (
        uploaded_by = auth.uid()
        AND uploader_role = 'homeowner'
        AND EXISTS (
          SELECT 1 FROM public.service_requests sr
          WHERE sr.id = service_request_id AND sr.customer_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_photos'
      AND policyname = 'Vendors can view photos for assigned requests'
  ) THEN
    CREATE POLICY "Vendors can view photos for assigned requests"
      ON public.job_photos FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.service_requests sr
          JOIN public.contractors c ON c.id = sr.contractor_id
          WHERE sr.id = service_request_id AND c.user_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_photos'
      AND policyname = 'Admins can view all photos'
  ) THEN
    CREATE POLICY "Admins can view all photos"
      ON public.job_photos FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'job_photos'
      AND policyname = 'Uploader or admin can delete photos'
  ) THEN
    CREATE POLICY "Uploader or admin can delete photos"
      ON public.job_photos FOR DELETE TO authenticated
      USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END
$$;

-- Remove the legacy bucket-wide authenticated policies if they still exist.
DROP POLICY IF EXISTS "Authenticated users can upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view job photos" ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can upload job photos to own folder'
  ) THEN
    CREATE POLICY "Users can upload job photos to own folder"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'job-photos'
        AND (
          auth.uid()::text = (storage.foldername(name))[1]
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Job participants can view job photos'
  ) THEN
    CREATE POLICY "Job participants can view job photos"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'job-photos'
        AND (
          auth.uid()::text = (storage.foldername(name))[1]
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR EXISTS (
            SELECT 1
            FROM public.job_photos jp
            JOIN public.service_requests sr ON sr.id = jp.service_request_id
            LEFT JOIN public.contractors c ON c.id = sr.contractor_id
            WHERE jp.photo_url = storage.objects.name
              AND (sr.customer_id = auth.uid() OR c.user_id = auth.uid())
          )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Users can delete own job photos'
  ) THEN
    CREATE POLICY "Users can delete own job photos"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'job-photos'
        AND (
          auth.uid()::text = (storage.foldername(name))[1]
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
        )
      );
  END IF;
END
$$;

COMMENT ON TABLE public.job_photos IS
  'Private request/job media. Homeowner intake photos use photo_type=evidence and are linked to each service request in the submitted plan.';
