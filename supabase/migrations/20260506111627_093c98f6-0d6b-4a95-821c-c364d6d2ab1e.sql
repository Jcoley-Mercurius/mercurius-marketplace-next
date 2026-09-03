-- Vendor packages: a productized offering by a contractor for a specific service
CREATE TABLE public.vendor_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  service_id text NOT NULL REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  pricing_mode text NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed','deposit_quote','custom_quote')),
  default_frequency text NOT NULL DEFAULT 'one-time' CHECK (default_frequency IN ('one-time','weekly','monthly','quarterly')),
  deposit_amount numeric,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Qualifying questions asked at checkout to route the customer to the right tier
CREATE TABLE public.package_qualifying_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.vendor_packages(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  question_label text NOT NULL,
  input_type text NOT NULL DEFAULT 'number' CHECK (input_type IN ('number','select','text')),
  unit text,
  options jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Tiers within a package: each tier has a price + a numeric range rule against a qualifying question
CREATE TABLE public.package_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.vendor_packages(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric NOT NULL,
  rule_question_key text,
  rule_min numeric,
  rule_max numeric,
  includes text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendor_packages_contractor ON public.vendor_packages(contractor_id);
CREATE INDEX idx_vendor_packages_service ON public.vendor_packages(service_id);
CREATE INDEX idx_pqq_package ON public.package_qualifying_questions(package_id);
CREATE INDEX idx_pt_package ON public.package_tiers(package_id);
ALTER TABLE public.vendor_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_qualifying_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_tiers ENABLE ROW LEVEL SECURITY;
-- Public can view active packages (and their questions/tiers) so customers see them in the Plan Builder
CREATE POLICY "Anyone can view active packages"
ON public.vendor_packages FOR SELECT TO public
USING (is_active = true);
CREATE POLICY "Anyone can view questions for active packages"
ON public.package_qualifying_questions FOR SELECT TO public
USING (package_id IN (SELECT id FROM public.vendor_packages WHERE is_active = true));
CREATE POLICY "Anyone can view tiers for active packages"
ON public.package_tiers FOR SELECT TO public
USING (package_id IN (SELECT id FROM public.vendor_packages WHERE is_active = true));
-- Vendors manage their own packages
CREATE POLICY "Vendors view own packages"
ON public.vendor_packages FOR SELECT TO authenticated
USING (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
CREATE POLICY "Vendors insert own packages"
ON public.vendor_packages FOR INSERT TO authenticated
WITH CHECK (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
CREATE POLICY "Vendors update own packages"
ON public.vendor_packages FOR UPDATE TO authenticated
USING (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
CREATE POLICY "Vendors delete own packages"
ON public.vendor_packages FOR DELETE TO authenticated
USING (contractor_id IN (SELECT id FROM public.contractors WHERE user_id = auth.uid()));
-- Vendors manage questions/tiers of their own packages
CREATE POLICY "Vendors manage own package questions"
ON public.package_qualifying_questions FOR ALL TO authenticated
USING (package_id IN (
  SELECT vp.id FROM public.vendor_packages vp
  JOIN public.contractors c ON c.id = vp.contractor_id
  WHERE c.user_id = auth.uid()
))
WITH CHECK (package_id IN (
  SELECT vp.id FROM public.vendor_packages vp
  JOIN public.contractors c ON c.id = vp.contractor_id
  WHERE c.user_id = auth.uid()
));
CREATE POLICY "Vendors manage own package tiers"
ON public.package_tiers FOR ALL TO authenticated
USING (package_id IN (
  SELECT vp.id FROM public.vendor_packages vp
  JOIN public.contractors c ON c.id = vp.contractor_id
  WHERE c.user_id = auth.uid()
))
WITH CHECK (package_id IN (
  SELECT vp.id FROM public.vendor_packages vp
  JOIN public.contractors c ON c.id = vp.contractor_id
  WHERE c.user_id = auth.uid()
));
-- Admins manage everything
CREATE POLICY "Admins manage packages"
ON public.vendor_packages FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins manage package questions"
ON public.package_qualifying_questions FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins manage package tiers"
ON public.package_tiers FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
-- Updated_at triggers
CREATE TRIGGER trg_vendor_packages_updated
BEFORE UPDATE ON public.vendor_packages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
