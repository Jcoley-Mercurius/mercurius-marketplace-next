ALTER TABLE public.services_catalog
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS default_deposit_amount numeric;
ALTER TABLE public.services_catalog
  DROP CONSTRAINT IF EXISTS services_catalog_pricing_mode_check;
ALTER TABLE public.services_catalog
  ADD CONSTRAINT services_catalog_pricing_mode_check
  CHECK (pricing_mode IN ('fixed','deposit_quote','custom_quote'));
