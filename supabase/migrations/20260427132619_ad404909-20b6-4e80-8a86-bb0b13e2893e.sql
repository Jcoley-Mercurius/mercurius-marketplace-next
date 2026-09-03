ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS paid_by_customer_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_eligible_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
CREATE INDEX IF NOT EXISTS idx_invoices_pending_release
  ON public.invoices (status, release_eligible_at)
  WHERE status = 'pending_release';
CREATE OR REPLACE FUNCTION public.sync_invoice_on_request_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.invoices
       SET status = 'pending_release'::invoice_status,
           release_eligible_at = now() + interval '48 hours'
     WHERE service_request_id = NEW.id
       AND status = 'paid'::invoice_status;
  END IF;

  IF NEW.disputed = true AND (OLD.disputed IS DISTINCT FROM true) THEN
    UPDATE public.invoices
       SET status = 'disputed'::invoice_status,
           release_eligible_at = NULL
     WHERE service_request_id = NEW.id
       AND status IN ('paid'::invoice_status, 'pending_release'::invoice_status);
  END IF;

  IF NEW.disputed = false
     AND OLD.disputed = true
     AND NEW.dispute_resolved_at IS NOT NULL THEN
    UPDATE public.invoices
       SET status = 'pending_release'::invoice_status,
           release_eligible_at = now() + interval '24 hours'
     WHERE service_request_id = NEW.id
       AND status = 'disputed'::invoice_status;
  END IF;

  RETURN NEW;
END;
$$;
-- Lock down execution: only the database itself (via trigger) should run this
REVOKE EXECUTE ON FUNCTION public.sync_invoice_on_request_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sync_invoice_on_request_change ON public.service_requests;
CREATE TRIGGER trg_sync_invoice_on_request_change
AFTER UPDATE ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.sync_invoice_on_request_change();
