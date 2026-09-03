-- Create contractors table for provider profiles
CREATE TABLE public.contractors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  logo_url TEXT,
  bio TEXT,
  location TEXT,
  rating NUMERIC(2,1) DEFAULT 5.0,
  badges TEXT[] DEFAULT '{}',
  services TEXT[] NOT NULL DEFAULT '{}',
  phone TEXT,
  email TEXT,
  years_experience INTEGER,
  jobs_completed INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
-- Public read access (unauthenticated users need to see providers)
CREATE POLICY "Anyone can view active contractors"
  ON public.contractors FOR SELECT
  USING (is_active = true);
-- Admin management policies (using user_roles pattern)
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
-- Admin policies for contractors
CREATE POLICY "Admins can insert contractors"
  ON public.contractors FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update contractors"
  ON public.contractors FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete contractors"
  ON public.contractors FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Admin can view roles
CREATE POLICY "Admins can view roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_contractors_updated_at
  BEFORE UPDATE ON public.contractors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- Seed some sample contractors
INSERT INTO public.contractors (name, bio, location, rating, badges, services, years_experience, jobs_completed) VALUES
  ('GreenScape Pro', 'Premier lawn care and landscaping specialists serving the greater Phoenix area.', 'Phoenix, AZ', 4.9, ARRAY['Licensed', 'Insured', 'Top Rated'], ARRAY['lawn-care', 'tree-trimming', 'fence-repair'], 12, 340),
  ('CrystalClear Pools', 'Expert pool maintenance and cleaning with eco-friendly solutions.', 'Scottsdale, AZ', 4.8, ARRAY['Certified', 'Insured', 'Eco-Friendly'], ARRAY['pool-service', 'pressure-washing'], 8, 215),
  ('SparkleHome Cleaning', 'Detail-oriented residential cleaning team you can trust.', 'Tempe, AZ', 4.7, ARRAY['Background Checked', 'Insured', 'Satisfaction Guaranteed'], ARRAY['house-cleaning', 'window-cleaning', 'floor-cleaning', 'rental-turnover-cleaning'], 6, 520),
  ('FixIt Right Handyman', 'No job too small — reliable handyman services for every home need.', 'Mesa, AZ', 4.6, ARRAY['Licensed', 'Insured', 'Veteran Owned'], ARRAY['handyman', 'painting-touch-ups', 'garage-door-repair', 'fence-repair'], 15, 890),
  ('CoolBreeze HVAC', 'Certified HVAC technicians keeping your home comfortable year-round.', 'Chandler, AZ', 4.9, ARRAY['EPA Certified', 'Licensed', 'Insured', '24/7 Emergency'], ARRAY['ac-maintenance', 'electrical-repair'], 10, 430),
  ('BugShield Pest Control', 'Safe, effective pest control for families and pets.', 'Gilbert, AZ', 4.5, ARRAY['Licensed', 'Eco-Friendly', 'Pet Safe'], ARRAY['pest-control'], 9, 670),
  ('ProFlow Plumbing', 'Fast, fair, and friendly plumbing services.', 'Glendale, AZ', 4.8, ARRAY['Licensed', 'Insured', 'Same-Day Service'], ARRAY['plumbing-repair', 'appliance-repair'], 11, 310),
  ('TopShelf Exteriors', 'Roof inspections, gutter work, and pressure washing done right.', 'Peoria, AZ', 4.7, ARRAY['Licensed', 'Insured', 'Certified Inspector'], ARRAY['roof-inspection', 'gutter-cleaning', 'pressure-washing'], 7, 195);
