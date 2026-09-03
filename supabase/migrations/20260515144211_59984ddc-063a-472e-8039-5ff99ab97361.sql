ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_status text;
CREATE INDEX IF NOT EXISTS idx_service_requests_stripe_sub ON public.service_requests(stripe_subscription_id);
