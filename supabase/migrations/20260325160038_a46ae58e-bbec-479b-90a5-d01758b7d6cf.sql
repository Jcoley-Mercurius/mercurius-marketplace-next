CREATE POLICY "Customers can respond to quotes"
ON public.service_requests
FOR UPDATE
TO public
USING (
  auth.uid() = customer_id
  AND status = 'quoted'::request_status
)
WITH CHECK (
  auth.uid() = customer_id
  AND status IN ('scheduled'::request_status, 'cancelled'::request_status)
);
