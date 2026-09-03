-- Smart Picks table: admin-managed vendor highlights per service
CREATE TABLE public.smart_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id text NOT NULL,
  pick_type text NOT NULL CHECK (pick_type IN ('best-rated', 'best-value', 'bonus-deal', 'rising-star')),
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  custom_highlight text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_id, pick_type)
);
-- Enable RLS
ALTER TABLE public.smart_picks ENABLE ROW LEVEL SECURITY;
-- Policies
CREATE POLICY "Anyone can view active smart picks"
  ON public.smart_picks FOR SELECT TO public
  USING (is_active = true);
CREATE POLICY "Admins can view all smart picks"
  ON public.smart_picks FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert smart picks"
  ON public.smart_picks FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update smart picks"
  ON public.smart_picks FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete smart picks"
  ON public.smart_picks FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));
-- Updated_at trigger
CREATE TRIGGER update_smart_picks_updated_at
  BEFORE UPDATE ON public.smart_picks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
