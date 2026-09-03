-- Service Categories table
CREATE TABLE public.service_categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'Star',
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Services table (catalog)
CREATE TABLE public.services_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  category_id text NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  tags text[] NOT NULL DEFAULT '{}',
  icon text NOT NULL DEFAULT 'Star',
  descriptor text NOT NULL DEFAULT '',
  is_popular boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  weekly_price numeric,
  monthly_price numeric NOT NULL DEFAULT 0,
  one_time_price numeric NOT NULL DEFAULT 0,
  default_frequency text NOT NULL DEFAULT 'monthly',
  available_frequencies text[] NOT NULL DEFAULT '{monthly,one-time}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Coverage areas table
CREATE TABLE public.coverage_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zip_code text NOT NULL UNIQUE,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'FL',
  is_active boolean NOT NULL DEFAULT true,
  has_waitlist boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_areas ENABLE ROW LEVEL SECURITY;
-- Public read for active items
CREATE POLICY "Anyone can view active categories" ON public.service_categories
  FOR SELECT USING (is_active = true);
CREATE POLICY "Anyone can view active services" ON public.services_catalog
  FOR SELECT USING (is_active = true);
CREATE POLICY "Anyone can view active coverage areas" ON public.coverage_areas
  FOR SELECT USING (is_active = true);
-- Admin full access on service_categories
CREATE POLICY "Admins can view all categories" ON public.service_categories
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert categories" ON public.service_categories
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update categories" ON public.service_categories
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete categories" ON public.service_categories
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
-- Admin full access on services_catalog
CREATE POLICY "Admins can view all services" ON public.services_catalog
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert services" ON public.services_catalog
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update services" ON public.services_catalog
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete services" ON public.services_catalog
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
-- Admin full access on coverage_areas
CREATE POLICY "Admins can view all coverage areas" ON public.coverage_areas
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert coverage areas" ON public.coverage_areas
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update coverage areas" ON public.coverage_areas
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete coverage areas" ON public.coverage_areas
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
-- Updated_at triggers
CREATE TRIGGER update_service_categories_updated_at BEFORE UPDATE ON public.service_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_services_catalog_updated_at BEFORE UPDATE ON public.services_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coverage_areas_updated_at BEFORE UPDATE ON public.coverage_areas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
