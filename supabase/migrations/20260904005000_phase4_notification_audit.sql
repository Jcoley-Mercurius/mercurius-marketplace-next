-- Bound expiry batches and finish successful-event communication. No external delivery.
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
    ORDER BY attempt.service_request_id LIMIT 200
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

CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  offer record;
  still_eligible boolean;
  prior_status public.request_status;
  homeowner uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND contractor.user_id = auth.uid()
  ORDER BY attempt.offered_at DESC
  LIMIT 1;

  IF offer.id IS NULL THEN
    RAISE EXCEPTION 'No open offer is available to accept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_requests
    WHERE id=_job_id AND status IN ('matched','quoted') AND matching_status='offered'
      AND contractor_id=offer.contractor_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Offer is no longer actionable' USING ERRCODE='22023';
  END IF;

  SELECT status,customer_id INTO prior_status,homeowner FROM public.service_requests WHERE id=_job_id;
  IF offer.expires_at <= now() THEN
    RAISE EXCEPTION 'Offer has expired' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.find_eligible_packages_core(_job_id) eligible
    WHERE eligible.contractor_id = offer.contractor_id
      AND eligible.package_id = offer.package_id
      AND (offer.package_tier_id IS NULL OR eligible.package_tier_id = offer.package_tier_id)
  ) INTO still_eligible;

  IF NOT still_eligible THEN
    RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023';
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'accepted', accepted_at = now(), responded_at = now(),
      response_actor_id = auth.uid(), updated_at = now()
  WHERE id = offer.id;
  UPDATE public.job_match_attempts
  SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = COALESCE(reason, 'Another offer was accepted'), updated_at = now()
  WHERE service_request_id = _job_id AND outcome = 'pending' AND id <> offer.id;

  UPDATE public.service_requests
  SET contractor_id = offer.contractor_id,
      package_id = offer.package_id,
      package_tier_id = offer.package_tier_id,
      promotion_id = offer.promotion_id,
      frequency = offer.frequency,
      pricing_mode = CASE WHEN offer.offer_path = 'fixed' THEN 'fixed' ELSE 'custom_quote' END,
      quote_only = offer.offer_path = 'quote',
      base_amount = offer.base_price,
      resolved_price = offer.effective_price,
      total_amount = offer.effective_price,
      match_expires_at = NULL,
      matching_status = 'matched',
      status = 'scheduled',
      updated_at = now()
  WHERE id = _job_id;
  PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
    jsonb_build_object('from',prior_status,'to','scheduled','reason','vendor_accepted','offer_id',offer.id,'lifecycle_version','phase4-v1'));
  PERFORM public.notify_user(homeowner,'job_status','info','Provider accepted your service','Your service is scheduled. Review the appointment details and any pending price quote.','/dashboard',_job_id,offer.contractor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_job_match(
  _job_id uuid,
  _contractor_id uuid,
  _outcome text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'), false)
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Release reason required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  IF NOT EXISTS (SELECT 1 FROM public.service_requests WHERE id=_job_id
    AND status IN ('matched','quoted') AND matching_status='offered' AND contractor_id=_contractor_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Offer is no longer actionable' USING ERRCODE='22023';
  END IF;
  UPDATE public.job_match_attempts
  SET outcome = CASE WHEN _outcome IN ('declined', 'expired', 'withdrawn') THEN _outcome ELSE 'withdrawn' END,
      responded_at = now(),
      declined_at = CASE WHEN _outcome = 'declined' THEN now() ELSE declined_at END,
      withdrawn_at = CASE WHEN _outcome NOT IN ('declined', 'expired') THEN now() ELSE withdrawn_at END,
      reason = _reason,
      updated_at = now()
  WHERE service_request_id = _job_id AND contractor_id = _contractor_id AND outcome = 'pending';
  UPDATE public.service_requests
  SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
      status = 'pending', matching_status = 'awaiting_match', updated_at = now()
  WHERE id = _job_id AND contractor_id = _contractor_id;
  PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),jsonb_build_object('action','offer_released','contractor_id',_contractor_id,'outcome',_outcome,'reason',btrim(_reason)));
  PERFORM private.offer_next_for_request_internal(_job_id);
END;
$$;

CREATE FUNCTION private.protect_ticket_queue_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user='authenticated' AND (NEW.queue_owner,NEW.next_action,NEW.priority) IS DISTINCT FROM (OLD.queue_owner,OLD.next_action,OLD.priority) THEN
    RAISE EXCEPTION 'Queue ownership and routing require an authorized workflow' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_ticket_queue_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER protect_ticket_queue BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION private.protect_ticket_queue_fields();
