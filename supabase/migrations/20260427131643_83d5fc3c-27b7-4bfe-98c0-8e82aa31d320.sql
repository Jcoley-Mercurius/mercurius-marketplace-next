-- Add dispute fields to service_requests
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS disputed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS dispute_resolved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS dispute_resolution text;
CREATE INDEX IF NOT EXISTS idx_service_requests_disputed
  ON public.service_requests (disputed)
  WHERE disputed = true;
-- Add payout pause fields to contractors
ALTER TABLE public.contractors
  ADD COLUMN IF NOT EXISTS payouts_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payouts_paused_reason text,
  ADD COLUMN IF NOT EXISTS payouts_paused_at timestamp with time zone;
-- Allow homeowners to flag their own completed/in_progress jobs as disputed
CREATE POLICY "Customers can dispute own completed jobs"
ON public.service_requests
FOR UPDATE
USING (
  auth.uid() = customer_id
  AND status IN ('completed'::request_status, 'in_progress'::request_status, 'pending_review'::request_status)
)
WITH CHECK (
  auth.uid() = customer_id
);
