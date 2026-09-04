-- TRACE-010/013. Never reset an accepted/terminal job from a stale scan.
CREATE OR REPLACE FUNCTION public.expire_stale_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  stale_request_id uuid;
  expired_count integer := 0;
  row_count integer;
BEGIN
  IF auth.uid() IS NULL
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  FOR stale_request_id IN
    SELECT DISTINCT attempt.service_request_id
    FROM public.job_match_attempts attempt
    WHERE attempt.outcome = 'pending'
      AND attempt.expires_at <= now()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR auth.role() = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.contractors contractor
          WHERE contractor.id = attempt.contractor_id
            AND contractor.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.service_requests request
          WHERE request.id = attempt.service_request_id
            AND request.customer_id = auth.uid()
        )
      )
    ORDER BY attempt.service_request_id
    LIMIT 200
  LOOP
    -- Same lock/order as acceptance, decline and transition; recheck after waiting.
    PERFORM pg_advisory_xact_lock(hashtextextended(stale_request_id::text, 0));
    PERFORM 1 FROM public.service_requests WHERE id = stale_request_id FOR UPDATE;
    UPDATE public.job_match_attempts
    SET outcome = 'expired', responded_at = now(), updated_at = now(),
        reason = COALESCE(reason, 'Response window expired')
    WHERE service_request_id = stale_request_id AND outcome = 'pending' AND expires_at <= now();
    GET DIAGNOSTICS row_count = ROW_COUNT;
    IF row_count = 0 THEN CONTINUE; END IF;
    expired_count := expired_count + row_count;
    INSERT INTO public.job_events(job_id, event_type, metadata)
    VALUES (stale_request_id, 'match_expired', jsonb_build_object('lifecycle_version', 'phase4-v1', 'count', row_count));
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match',
        last_match_expired_at = now(), updated_at = now()
    WHERE id = stale_request_id AND status IN ('pending','matched','quoted') AND matching_status <> 'matched';
    PERFORM private.offer_next_for_request_internal(stale_request_id);
  END LOOP;
  RETURN expired_count;
END;
$$;
