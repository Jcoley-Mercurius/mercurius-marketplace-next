-- Public/vendor trust surfaces use real Mercurius service request history,
-- never the editable contractors.jobs_completed legacy field.
CREATE OR REPLACE FUNCTION public.get_completed_job_counts(
  _contractor_ids uuid[]
)
RETURNS TABLE (
  contractor_id uuid,
  completed_jobs bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    c.id AS contractor_id,
    count(sr.id)::bigint AS completed_jobs
  FROM public.contractors c
  LEFT JOIN public.service_requests sr
    ON sr.contractor_id = c.id
   AND sr.status::text = ANY (
     ARRAY[
       'homeowner_confirmed',
       'completed',
       'review_requested',
       'reviewed',
       'closed'
     ]::text[]
   )
  WHERE c.id = ANY (_contractor_ids)
    AND (
      (c.is_active IS TRUE AND c.marketing_enabled IS NOT FALSE)
      OR c.user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
    )
  GROUP BY c.id;
$$;

REVOKE ALL ON FUNCTION public.get_completed_job_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_completed_job_counts(uuid[]) TO anon, authenticated;

COMMENT ON FUNCTION public.get_completed_job_counts(uuid[]) IS
  'Returns aggregate Mercurius-completed service request counts for public providers, linked owners, and admins.';
