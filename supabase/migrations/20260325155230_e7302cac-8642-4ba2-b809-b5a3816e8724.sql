-- Allow vendors to view their own invoices (needed for performance metrics)
CREATE POLICY "Vendors can view own invoices" ON public.invoices
  FOR SELECT TO public
  USING (
    contractor_id IN (
      SELECT id FROM public.contractors WHERE user_id = auth.uid()
    )
  );
