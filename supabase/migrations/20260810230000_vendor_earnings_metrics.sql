-- Reliable release timing for future vendor payouts and privacy-safe vendor
-- aggregates. Customer-paid but unreleased invoices are not vendor earnings.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

CREATE OR REPLACE FUNCTION public.stamp_invoice_released_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status::text = 'released' THEN
    NEW.released_at := COALESCE(NEW.released_at, now());
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status::text = 'released'
    AND OLD.status::text IS DISTINCT FROM 'released' THEN
    NEW.released_at := COALESCE(NEW.released_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_invoice_released_at ON public.invoices;
CREATE TRIGGER stamp_invoice_released_at
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.stamp_invoice_released_at();

CREATE OR REPLACE FUNCTION public.get_vendor_earnings_metrics(
  _contractor_id uuid
)
RETURNS TABLE (
  lifetime_earned numeric,
  current_month_earned numeric,
  released_invoice_count bigint,
  current_month_invoice_count bigint,
  untracked_release_count bigint,
  missing_payout_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.contractors c
    WHERE c.id = _contractor_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ) THEN
    RAISE EXCEPTION 'Not authorized for this contractor'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(sum(i.vendor_payout) FILTER (
      WHERE i.status::text = 'released' AND i.vendor_payout IS NOT NULL AND i.vendor_payout >= 0
    ), 0)::numeric AS lifetime_earned,
    COALESCE(sum(i.vendor_payout) FILTER (
      WHERE i.status::text = 'released'
        AND i.vendor_payout IS NOT NULL
        AND i.vendor_payout >= 0
        AND i.released_at IS NOT NULL
        AND date_trunc('month', i.released_at AT TIME ZONE 'America/New_York')
          = date_trunc('month', now() AT TIME ZONE 'America/New_York')
    ), 0)::numeric AS current_month_earned,
    count(*) FILTER (WHERE i.status::text = 'released') AS released_invoice_count,
    count(*) FILTER (
      WHERE i.status::text = 'released'
        AND i.released_at IS NOT NULL
        AND date_trunc('month', i.released_at AT TIME ZONE 'America/New_York')
          = date_trunc('month', now() AT TIME ZONE 'America/New_York')
    ) AS current_month_invoice_count,
    count(*) FILTER (
      WHERE i.status::text = 'released' AND i.released_at IS NULL
    ) AS untracked_release_count,
    count(*) FILTER (
      WHERE i.status::text = 'released' AND (i.vendor_payout IS NULL OR i.vendor_payout < 0)
    ) AS missing_payout_count
  FROM public.invoices i
  WHERE i.contractor_id = _contractor_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vendor_earnings_metrics(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_earnings_metrics(uuid) TO authenticated;

COMMENT ON COLUMN public.invoices.released_at IS
  'Timestamp when an invoice first enters released status; used for vendor earnings periods.';

COMMENT ON FUNCTION public.get_vendor_earnings_metrics(uuid) IS
  'Returns released vendor_payout totals only; paid, pending, disputed, refunded, and estimated amounts are excluded.';
