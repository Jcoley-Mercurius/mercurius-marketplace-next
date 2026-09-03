ALTER TABLE public.vendor_applications
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_user_id uuid,
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'not_invited',
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_error text;
CREATE INDEX IF NOT EXISTS idx_vendor_applications_contractor_id ON public.vendor_applications(contractor_id);
