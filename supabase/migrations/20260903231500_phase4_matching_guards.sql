-- Remove legacy duplicate offer creation; canonical RPC owns its snapshot and notification.
DROP TRIGGER IF EXISTS trg_record_match_offer ON public.service_requests;
-- DEC-2026-007: acceptance immediately schedules; stale offers cannot revive jobs.
CREATE OR REPLACE FUNCTION private.create_job_offer_internal(
  _request_id uuid,
  _contractor_id uuid,
  _package_id uuid DEFAULT NULL,
  _package_tier_id uuid DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  candidate record;
  current_offer uuid;
  offer_id uuid;
  next_attempt integer;
  deadline timestamptz := now() + interval '4 hours';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.service_requests WHERE id=_request_id
    AND status IN ('pending','matched') AND matching_status <> 'matched' FOR UPDATE) THEN
    RAISE EXCEPTION 'Request is no longer open for matching' USING ERRCODE='22023';
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at < now();

  SELECT id INTO current_offer
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id AND outcome = 'pending'
  ORDER BY offered_at DESC
  LIMIT 1;

  IF current_offer IS NOT NULL AND NOT _force THEN
    RETURN current_offer;
  END IF;

  IF current_offer IS NOT NULL THEN
    UPDATE public.job_match_attempts
    SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
        reason = 'Withdrawn by admin force offer', updated_at = now()
    WHERE id = current_offer;
  END IF;

  SELECT eligible.* INTO candidate
  FROM private.find_eligible_packages_core(_request_id) eligible
  WHERE eligible.contractor_id = _contractor_id
    AND (_package_id IS NULL OR eligible.package_id = _package_id)
    AND (_package_tier_id IS NULL OR eligible.package_tier_id = _package_tier_id)
  ORDER BY eligible.rank_order
  LIMIT 1;

  IF candidate.contractor_id IS NULL THEN
    RAISE EXCEPTION 'Selected contractor/package is no longer eligible for this request';
  END IF;

  IF NOT _force AND EXISTS (
    SELECT 1 FROM public.job_match_attempts previous
    WHERE previous.service_request_id = _request_id
      AND previous.contractor_id = _contractor_id
      AND previous.outcome IN ('declined', 'expired', 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'This contractor already closed an offer for this request';
  END IF;

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO next_attempt
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id;

  INSERT INTO public.job_match_attempts (
    service_request_id, contractor_id, package_id, package_tier_id,
    promotion_id, frequency, offer_path, base_price, effective_price,
    score, score_breakdown, rank_order, attempt_number, offered_at,
    expires_at, outcome
  ) VALUES (
    _request_id, candidate.contractor_id, candidate.package_id,
    candidate.package_tier_id, candidate.promotion_id, candidate.frequency,
    candidate.path, candidate.base_price, candidate.effective_price,
    candidate.total_score, candidate.score_breakdown, candidate.rank_order,
    next_attempt, now(), deadline, 'pending'
  )
  RETURNING id INTO offer_id;

  UPDATE public.service_requests
  SET contractor_id = candidate.contractor_id,
      assigned_at = now(),
      match_expires_at = deadline,
      match_attempt_count = next_attempt,
      matching_status = 'offered',
      needs_admin_review = false,
      status = 'matched',
      package_id = candidate.package_id,
      package_tier_id = candidate.package_tier_id,
      promotion_id = candidate.promotion_id,
      frequency = candidate.frequency,
      pricing_mode = CASE WHEN candidate.path = 'fixed' THEN 'fixed' ELSE 'custom_quote' END,
      quote_only = candidate.path = 'quote',
      base_amount = candidate.base_price,
      resolved_price = candidate.effective_price,
      total_amount = candidate.effective_price,
      updated_at = now()
  WHERE id = _request_id;

  INSERT INTO public.job_events(job_id, event_type, actor_id, metadata)
  VALUES (_request_id, 'match_offered', auth.uid(),
    jsonb_build_object('offer_id', offer_id, 'contractor_id', candidate.contractor_id,
      'expires_at', deadline, 'path', candidate.path, 'rank', candidate.rank_order));

  INSERT INTO public.notifications(user_id,type,severity,title,body,link,related_request_id,related_contractor_id)
    SELECT user_id,'job_offer','warning','New job offer — respond within four hours',
      'Accept or decline this exclusive offer before its four-hour deadline.','/vendor/jobs',_request_id,candidate.contractor_id
    FROM public.contractors WHERE id=candidate.contractor_id AND user_id IS NOT NULL;
  RETURN offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vendor_decline_job(_job_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  offer record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND (contractor.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ORDER BY attempt.offered_at DESC
  LIMIT 1;

  IF offer.id IS NULL THEN
    RAISE EXCEPTION 'No open offer is available to decline';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_requests
    WHERE id=_job_id AND status IN ('matched','quoted') AND matching_status='offered'
      AND contractor_id=offer.contractor_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Offer is no longer actionable' USING ERRCODE='22023';
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'declined', declined_at = now(), responded_at = now(),
      response_actor_id = auth.uid(), reason = COALESCE(_reason, 'Vendor declined'),
      updated_at = now()
  WHERE id = offer.id;

  UPDATE public.service_requests request
  SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
      status = 'pending', matching_status = 'awaiting_match',
      declined_contractor_ids = CASE
        WHEN offer.contractor_id = ANY(COALESCE(request.declined_contractor_ids, '{}'::uuid[]))
          THEN COALESCE(request.declined_contractor_ids, '{}'::uuid[])
        ELSE array_append(COALESCE(request.declined_contractor_ids, '{}'::uuid[]), offer.contractor_id)
      END,
      updated_at = now()
  WHERE request.id = _job_id;

  INSERT INTO public.job_events(job_id, event_type, actor_id, metadata)
  VALUES (_job_id, 'match_declined', auth.uid(),
    jsonb_build_object('offer_id', offer.id, 'contractor_id', offer.contractor_id,
      'reason', COALESCE(_reason, 'Vendor declined')));
  PERFORM private.offer_next_for_request_internal(_job_id);
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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND (contractor.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
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

  IF offer.expires_at <= now() THEN
    UPDATE public.job_match_attempts
    SET outcome = 'expired', responded_at = now(), updated_at = now(),
        reason = COALESCE(reason, 'Response window expired')
    WHERE id = offer.id;
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match', updated_at = now()
    WHERE id = _job_id;
    PERFORM private.offer_next_for_request_internal(_job_id);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.find_eligible_packages_core(_job_id) eligible
    WHERE eligible.contractor_id = offer.contractor_id
      AND eligible.package_id = offer.package_id
      AND (offer.package_tier_id IS NULL OR eligible.package_tier_id = offer.package_tier_id)
  ) INTO still_eligible;

  IF NOT still_eligible THEN
    UPDATE public.job_match_attempts
    SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
        reason = 'Eligibility changed before acceptance', updated_at = now()
    WHERE id = offer.id;
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match', updated_at = now()
    WHERE id = _job_id;
    PERFORM private.offer_next_for_request_internal(_job_id);
    RETURN;
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
    jsonb_build_object('from','matched','to','scheduled','reason','vendor_accepted','offer_id',offer.id,'lifecycle_version','phase4-v1'));
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
  PERFORM private.offer_next_for_request_internal(_job_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_offer(
  _request_id uuid,
  _contractor_id uuid,
  _package_id uuid DEFAULT NULL,
  _package_tier_id uuid DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'), false)
    AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN private.create_job_offer_internal(
    _request_id, _contractor_id, _package_id, _package_tier_id, _force
  );
END;
$$;
