-- Job photos table: stores before/after photos per service request
CREATE TABLE public.job_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_request_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  uploader_role text NOT NULL CHECK (uploader_role IN ('vendor', 'homeowner', 'admin')),
  photo_url text NOT NULL,
  caption text,
  photo_type text NOT NULL DEFAULT 'evidence' CHECK (photo_type IN ('before', 'after', 'evidence', 'issue')),
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT job_photos_service_request_id_fkey
    FOREIGN KEY (service_request_id) REFERENCES public.service_requests(id) ON DELETE CASCADE
);
-- Enable RLS
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;
-- Homeowner can view photos for their own service requests
CREATE POLICY "Homeowners can view photos for own requests"
  ON public.job_photos FOR SELECT
  USING (
    service_request_id IN (
      SELECT id FROM public.service_requests WHERE customer_id = auth.uid()
    )
  );
-- Vendor can view photos for their assigned requests
CREATE POLICY "Vendors can view photos for assigned requests"
  ON public.job_photos FOR SELECT
  USING (
    service_request_id IN (
      SELECT sr.id FROM public.service_requests sr
      JOIN public.contractors c ON c.id = sr.contractor_id
      WHERE c.user_id = auth.uid()
    )
  );
-- Admins can view all photos
CREATE POLICY "Admins can view all photos"
  ON public.job_photos FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
-- Vendor can upload photos for their assigned requests
CREATE POLICY "Vendors can upload photos for assigned requests"
  ON public.job_photos FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by
    AND uploader_role = 'vendor'
    AND service_request_id IN (
      SELECT sr.id FROM public.service_requests sr
      JOIN public.contractors c ON c.id = sr.contractor_id
      WHERE c.user_id = auth.uid()
    )
  );
-- Homeowner can upload photos for their own requests
CREATE POLICY "Homeowners can upload photos for own requests"
  ON public.job_photos FOR INSERT
  WITH CHECK (
    auth.uid() = uploaded_by
    AND uploader_role = 'homeowner'
    AND service_request_id IN (
      SELECT id FROM public.service_requests WHERE customer_id = auth.uid()
    )
  );
-- Admins can insert
CREATE POLICY "Admins can insert photos"
  ON public.job_photos FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- Only uploader or admin can delete
CREATE POLICY "Uploader or admin can delete photos"
  ON public.job_photos FOR DELETE
  USING (auth.uid() = uploaded_by OR has_role(auth.uid(), 'admin'::app_role));
-- Storage bucket for job photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', false)
ON CONFLICT (id) DO NOTHING;
-- Storage RLS: allow authenticated users to upload to job-photos
CREATE POLICY "Authenticated users can upload job photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
-- Storage RLS: allow authenticated users to view job photos
CREATE POLICY "Authenticated users can view job photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-photos' AND auth.role() = 'authenticated');
-- Storage RLS: allow uploader to delete their own photos
CREATE POLICY "Users can delete own job photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'job-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
