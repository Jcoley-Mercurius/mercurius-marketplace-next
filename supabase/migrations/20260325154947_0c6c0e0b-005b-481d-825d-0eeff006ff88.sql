-- Public reviews table (visible to everyone)
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_request_id)
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
-- Anyone can view reviews (public transparency)
CREATE POLICY "Anyone can view reviews" ON public.reviews FOR SELECT TO public USING (true);
-- Homeowners can create reviews for their own completed requests
CREATE POLICY "Homeowners can create reviews for own requests" ON public.reviews
  FOR INSERT TO public
  WITH CHECK (
    auth.uid() = customer_id
    AND service_request_id IN (
      SELECT id FROM public.service_requests
      WHERE customer_id = auth.uid() AND status = 'completed'
    )
  );
-- Admins can manage reviews
CREATE POLICY "Admins can manage reviews" ON public.reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Private quality feedback (internal only, admins see it)
CREATE TABLE public.quality_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  punctuality integer NOT NULL CHECK (punctuality >= 1 AND punctuality <= 5),
  communication integer NOT NULL CHECK (communication >= 1 AND communication <= 5),
  workmanship integer NOT NULL CHECK (workmanship >= 1 AND workmanship <= 5),
  would_recommend boolean NOT NULL DEFAULT true,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_request_id)
);
ALTER TABLE public.quality_feedback ENABLE ROW LEVEL SECURITY;
-- Only admins can view quality feedback
CREATE POLICY "Admins can view quality feedback" ON public.quality_feedback
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- Homeowners can submit quality feedback for own completed requests
CREATE POLICY "Homeowners can submit quality feedback" ON public.quality_feedback
  FOR INSERT TO public
  WITH CHECK (
    auth.uid() = customer_id
    AND service_request_id IN (
      SELECT id FROM public.service_requests
      WHERE customer_id = auth.uid() AND status = 'completed'
    )
  );
-- Admins can manage quality feedback
CREATE POLICY "Admins can manage quality feedback" ON public.quality_feedback
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
