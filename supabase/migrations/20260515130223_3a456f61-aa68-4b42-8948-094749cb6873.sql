-- Award loyalty points the moment a customer pays an invoice (real-time gratification),
-- and stop double-awarding on job completion.

DROP TRIGGER IF EXISTS trg_award_job_completion_points ON public.service_requests;
CREATE OR REPLACE FUNCTION public.award_invoice_payment_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pts integer;
BEGIN
  IF NEW.status IN ('paid'::invoice_status, 'pending_release'::invoice_status, 'released'::invoice_status)
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND OLD.status NOT IN ('paid'::invoice_status, 'pending_release'::invoice_status, 'released'::invoice_status) THEN
    pts := LEAST(500, GREATEST(0, COALESCE(round(NEW.amount)::int, 0)));
    IF pts > 0 AND NEW.customer_id IS NOT NULL THEN
      PERFORM public.award_points(
        NEW.customer_id, pts,
        'Service payment', 'job'::public.loyalty_source_type, NEW.id,
        jsonb_build_object('invoice_id', NEW.id, 'amount', NEW.amount)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_award_invoice_payment_points ON public.invoices;
CREATE TRIGGER trg_award_invoice_payment_points
AFTER UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.award_invoice_payment_points();
-- Enable realtime so the homeowner UI updates instantly when points are awarded
ALTER PUBLICATION supabase_realtime ADD TABLE public.loyalty_accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.loyalty_transactions;
