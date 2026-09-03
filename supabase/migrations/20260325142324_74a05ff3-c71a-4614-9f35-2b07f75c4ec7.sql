INSERT INTO storage.buckets (id, name, public) VALUES ('vendor-logos', 'vendor-logos', true) ON CONFLICT (id) DO NOTHING;
CREATE POLICY "Anyone can view vendor logos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'vendor-logos');
CREATE POLICY "Admins can upload vendor logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'vendor-logos' AND public.has_role(auth.uid(), 'admin'));
