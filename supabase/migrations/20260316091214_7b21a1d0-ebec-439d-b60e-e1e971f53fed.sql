CREATE TABLE public.vendor_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  years_experience integer NOT NULL DEFAULT 0,
  services text[] NOT NULL DEFAULT '{}',
  service_areas text,
  availability text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.vendor_applications ENABLE ROW LEVEL SECURITY;
-- Anyone can submit an application (no auth required)
CREATE POLICY "Anyone can submit vendor application"
  ON public.vendor_applications FOR INSERT
  TO public
  WITH CHECK (true);
-- Admins can view all applications
CREATE POLICY "Admins can view all applications"
  ON public.vendor_applications FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Admins can update applications (approve/reject)
CREATE POLICY "Admins can update applications"
  ON public.vendor_applications FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Admins can delete applications
CREATE POLICY "Admins can delete applications"
  ON public.vendor_applications FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
