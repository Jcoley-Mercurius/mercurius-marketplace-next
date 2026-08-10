-- Private credential storage for vendor applications. Uploads use short-lived
-- signed upload URLs; only authenticated admins can create signed read URLs.
ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS document_urls text[] DEFAULT ARRAY[]::text[];

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'vendor-documents',
  'vendor-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admins can review vendor application documents'
  ) THEN
    CREATE POLICY "Admins can review vendor application documents"
      ON storage.objects
      FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'vendor-documents'
        AND public.has_role(auth.uid(), 'admin')
      );
  END IF;
END
$$;
