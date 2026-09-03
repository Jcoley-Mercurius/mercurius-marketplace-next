-- Track when a vendor was assigned so we can compute acceptance deadline
ALTER TABLE public.service_requests
ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
-- Default acceptance window in hours (admin-configurable later)
-- We'll store this as a platform setting, but for now we compute 24h from assigned_at in code

-- Auto-set assigned_at when contractor_id changes from null to a value
CREATE OR REPLACE FUNCTION public.set_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- When contractor_id is set (was null before), stamp assigned_at
  IF OLD.contractor_id IS NULL AND NEW.contractor_id IS NOT NULL THEN
    NEW.assigned_at = now();
  END IF;
  -- If contractor_id is cleared, also clear assigned_at
  IF NEW.contractor_id IS NULL THEN
    NEW.assigned_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_set_assigned_at
BEFORE UPDATE ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_assigned_at();
