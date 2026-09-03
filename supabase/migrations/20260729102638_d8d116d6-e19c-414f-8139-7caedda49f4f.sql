ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS service_catalog_id text;
CREATE INDEX IF NOT EXISTS idx_service_requests_service_catalog_id ON public.service_requests (service_catalog_id);
