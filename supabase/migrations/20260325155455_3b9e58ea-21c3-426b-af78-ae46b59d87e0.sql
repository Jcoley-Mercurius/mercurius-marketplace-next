-- Allow homeowners to confirm (or dispute) pending_review jobs
CREATE POLICY "Customers can confirm pending_review requests"
ON public.service_requests
FOR UPDATE
TO public
USING (
  auth.uid() = customer_id
  AND status = 'pending_review'::request_status
)
WITH CHECK (
  auth.uid() = customer_id
  AND status IN ('completed'::request_status, 'in_progress'::request_status)
);
