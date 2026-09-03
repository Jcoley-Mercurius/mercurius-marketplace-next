ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.vendor_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_tier_id uuid REFERENCES public.package_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_answers jsonb,
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed' CHECK (pricing_mode IN ('fixed','deposit_quote','custom_quote')),
  ADD COLUMN IF NOT EXISTS quote_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_amount numeric,
  ADD COLUMN IF NOT EXISTS quote_approved_at timestamptz;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_deposit boolean NOT NULL DEFAULT false;
