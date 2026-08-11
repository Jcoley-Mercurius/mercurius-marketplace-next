-- Vendor-only operational aggregates. The function exposes counts and timing
-- summaries without granting vendors access to rematched homeowners' rows.

CREATE OR REPLACE FUNCTION public.get_vendor_operational_metrics(
  _contractor_id uuid
)
RETURNS TABLE (
  accepted_opportunities bigint,
  decided_opportunities bigint,
  win_rate numeric,
  median_response_minutes double precision,
  response_sample_size bigint
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
  WITH accepted AS (
    SELECT DISTINCT sr.id
    FROM public.service_requests sr
    WHERE sr.contractor_id = _contractor_id
      AND sr.status::text = ANY (ARRAY[
        'quoted', 'scheduled', 'in_progress', 'pending_review',
        'vendor_completed', 'homeowner_confirmed', 'completed',
        'review_requested', 'reviewed', 'closed', 'disputed', 'resolved'
      ]::text[])
  ), losses AS (
    SELECT DISTINCT sr.id
    FROM public.service_requests sr
    WHERE EXISTS (
      SELECT 1
      FROM unnest(COALESCE(sr.declined_contractor_ids, '{}')) declined_id
      WHERE declined_id::text = _contractor_id::text
    )
    UNION
    SELECT DISTINCT sr.id
    FROM public.service_requests sr
    WHERE sr.contractor_id = _contractor_id
      AND sr.status::text = 'expired'
  ), decisions AS (
    SELECT a.id, true AS won
    FROM accepted a
    UNION ALL
    SELECT l.id, false AS won
    FROM losses l
    WHERE NOT EXISTS (SELECT 1 FROM accepted a WHERE a.id = l.id)
  ), response_samples AS (
    SELECT EXTRACT(EPOCH FROM (sr.updated_at - sr.assigned_at)) / 60.0 AS minutes
    FROM public.service_requests sr
    WHERE sr.contractor_id = _contractor_id
      AND sr.status::text = ANY (ARRAY['scheduled', 'quoted']::text[])
      AND sr.assigned_at IS NOT NULL
      AND sr.updated_at IS NOT NULL
      AND sr.updated_at >= sr.assigned_at
  ), decision_summary AS (
    SELECT
      count(*) FILTER (WHERE won) AS accepted_count,
      count(*) AS decided_count
    FROM decisions
  ), response_summary AS (
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_minutes,
      count(*) AS sample_count
    FROM response_samples
  )
  SELECT
    ds.accepted_count,
    ds.decided_count,
    CASE
      WHEN ds.decided_count > 0
        THEN round((ds.accepted_count::numeric / ds.decided_count::numeric) * 100, 0)
      ELSE NULL
    END,
    rs.median_minutes,
    rs.sample_count
  FROM decision_summary ds
  CROSS JOIN response_summary rs;
END;
$$;

REVOKE ALL ON FUNCTION public.get_vendor_operational_metrics(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vendor_operational_metrics(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_vendor_operational_metrics(uuid) IS
  'Returns vendor-owned accepted/decided opportunity counts and a partial median first-action response signal.';
