-- Table to track featured/advertised contractors
CREATE TABLE public.featured_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'spotlight',
  headline text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, tier)
);
ALTER TABLE public.featured_providers ENABLE ROW LEVEL SECURITY;
-- Anyone can see active featured providers
CREATE POLICY "Anyone can view active featured providers"
  ON public.featured_providers FOR SELECT TO public
  USING (is_active = true AND (end_date IS NULL OR end_date >= CURRENT_DATE));
-- Admins full access
CREATE POLICY "Admins can manage featured providers"
  ON public.featured_providers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
