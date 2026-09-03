DROP POLICY IF EXISTS "System can insert visits" ON public.job_visits;
CREATE POLICY "Admins can insert visits"
  ON public.job_visits FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
