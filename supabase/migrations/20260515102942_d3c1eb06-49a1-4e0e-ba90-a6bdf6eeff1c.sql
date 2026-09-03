-- New columns on contractors
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT;
-- Gallery table
CREATE TABLE IF NOT EXISTS public.contractor_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.contractor_gallery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view gallery" ON public.contractor_gallery
  FOR SELECT USING (true);
CREATE POLICY "Admins manage gallery" ON public.contractor_gallery
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Vendors manage own gallery" ON public.contractor_gallery
  FOR ALL TO authenticated
  USING (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()))
  WITH CHECK (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
-- Service ZIPs table
CREATE TABLE IF NOT EXISTS public.contractor_service_zips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  zip_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, zip_code)
);
ALTER TABLE public.contractor_service_zips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view service zips" ON public.contractor_service_zips
  FOR SELECT USING (true);
CREATE POLICY "Admins manage service zips" ON public.contractor_service_zips
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Vendors manage own service zips" ON public.contractor_service_zips
  FOR ALL TO authenticated
  USING (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()))
  WITH CHECK (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
-- Vendor gallery storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('vendor-gallery', 'vendor-gallery', true)
  ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Anyone can view vendor gallery" ON storage.objects
  FOR SELECT USING (bucket_id = 'vendor-gallery');
CREATE POLICY "Admins can upload vendor gallery" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-gallery' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update vendor gallery" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vendor-gallery' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete vendor gallery" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vendor-gallery' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Vendors can upload own gallery" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor-gallery' AND auth.uid() IS NOT NULL);
CREATE POLICY "Vendors can delete own gallery" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vendor-gallery' AND auth.uid() IS NOT NULL);
-- Allow admins to update/delete vendor-logos
CREATE POLICY "Admins can update vendor logos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vendor-logos' AND has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete vendor logos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vendor-logos' AND has_role(auth.uid(), 'admin'::app_role));
