-- Fix the broken "Vendors can view assigned requests" policy on service_requests
-- It was querying auth.users directly which is not allowed
DROP POLICY IF EXISTS "Vendors can view assigned requests" ON public.service_requests;
CREATE POLICY "Vendors can view assigned requests"
ON public.service_requests FOR SELECT
USING (
  contractor_id IN (
    SELECT id FROM public.contractors WHERE user_id = auth.uid()
  )
);
