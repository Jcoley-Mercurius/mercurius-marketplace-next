CREATE TABLE public.pricing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id text NOT NULL REFERENCES public.services_catalog(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  guardrail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pricing_templates_one_active_per_service
  ON public.pricing_templates(service_id) WHERE is_active = true;
GRANT SELECT ON public.pricing_templates TO authenticated;
GRANT ALL ON public.pricing_templates TO service_role;
ALTER TABLE public.pricing_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read active templates"
  ON public.pricing_templates FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage templates"
  ON public.pricing_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_pricing_templates_updated
  BEFORE UPDATE ON public.pricing_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TABLE public.pricing_template_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pricing_templates(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  question_label text NOT NULL,
  input_type text NOT NULL CHECK (input_type IN ('number','select','multiselect','boolean','text')),
  unit text,
  options jsonb,
  min_value numeric,
  max_value numeric,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, question_key)
);
GRANT SELECT ON public.pricing_template_questions TO authenticated;
GRANT ALL ON public.pricing_template_questions TO service_role;
ALTER TABLE public.pricing_template_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read questions"
  ON public.pricing_template_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage questions"
  ON public.pricing_template_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TABLE public.pricing_template_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pricing_templates(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  rule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_price numeric NOT NULL DEFAULT 0,
  max_price numeric NOT NULL DEFAULT 0,
  suggested_price numeric,
  includes text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_template_tiers TO authenticated;
GRANT ALL ON public.pricing_template_tiers TO service_role;
ALTER TABLE public.pricing_template_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read tiers"
  ON public.pricing_template_tiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage tiers"
  ON public.pricing_template_tiers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TABLE public.pricing_template_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.pricing_templates(id) ON DELETE CASCADE,
  addon_key text NOT NULL,
  label text NOT NULL,
  description text,
  default_price numeric NOT NULL DEFAULT 0,
  price_min numeric NOT NULL DEFAULT 0,
  price_max numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, addon_key)
);
GRANT SELECT ON public.pricing_template_addons TO authenticated;
GRANT ALL ON public.pricing_template_addons TO service_role;
ALTER TABLE public.pricing_template_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read addons"
  ON public.pricing_template_addons FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage addons"
  ON public.pricing_template_addons FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
ALTER TABLE public.vendor_packages
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.pricing_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE public.package_tiers
  ADD COLUMN IF NOT EXISTS template_tier_id uuid REFERENCES public.pricing_template_tiers(id) ON DELETE SET NULL;
CREATE TABLE public.package_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.vendor_packages(id) ON DELETE CASCADE,
  template_addon_id uuid NOT NULL REFERENCES public.pricing_template_addons(id) ON DELETE CASCADE,
  price numeric NOT NULL DEFAULT 0,
  is_offered boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, template_addon_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_addons TO authenticated;
GRANT ALL ON public.package_addons TO service_role;
ALTER TABLE public.package_addons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone signed in can read package addons"
  ON public.package_addons FOR SELECT TO authenticated USING (true);
CREATE POLICY "Vendors manage their package addons"
  ON public.package_addons FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_packages vp
      JOIN public.contractors c ON c.id = vp.contractor_id
      WHERE vp.id = package_addons.package_id AND c.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendor_packages vp
      JOIN public.contractors c ON c.id = vp.contractor_id
      WHERE vp.id = package_addons.package_id AND c.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'admin')
  );
CREATE TRIGGER trg_package_addons_updated
  BEFORE UPDATE ON public.package_addons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS resolved_price numeric,
  ADD COLUMN IF NOT EXISTS pricing_inputs jsonb;
