-- MPS 6.2: homeowner consent precedes fallback; administrative changes carry reasons.
DROP FUNCTION public.admin_assign_contractor(uuid,uuid);
DROP FUNCTION public.create_job_offer(uuid,uuid,uuid,uuid,boolean);
ALTER TABLE public.service_requests DROP CONSTRAINT service_requests_matching_status_check;
ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_matching_status_check CHECK
  (matching_status IN ('awaiting_match','offered','matched','quote_pending','sourcing','exhausted','awaiting_consent'));
CREATE TABLE public.matching_fallback_consents (
  request_id uuid PRIMARY KEY REFERENCES public.service_requests(id),
  preferred_contractor_id uuid NOT NULL REFERENCES public.contractors(id),
  homeowner_id uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.matching_fallback_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.matching_fallback_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.matching_fallback_consents TO authenticated;
GRANT ALL ON public.matching_fallback_consents TO service_role;
CREATE POLICY "Participants read fallback consent" ON public.matching_fallback_consents
  FOR SELECT TO authenticated USING (homeowner_id=auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION private.fallback_permitted(_request_id uuid, _contractor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.service_requests r WHERE r.id=_request_id AND
    (r.preferred_contractor_id IS NULL OR r.preferred_contractor_id=_contractor_id OR EXISTS
      (SELECT 1 FROM public.matching_fallback_consents c WHERE c.request_id=r.id
        AND c.homeowner_id=r.customer_id AND c.preferred_contractor_id=r.preferred_contractor_id)))
$$;
REVOKE ALL ON FUNCTION private.fallback_permitted(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.consent_to_provider_fallback(_request_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_request_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the homeowner can consent to fallback' USING ERRCODE='42501';
  END IF;
  IF r.preferred_contractor_id IS NULL OR r.status NOT IN ('pending','matched') OR r.matching_status='matched' THEN
    RAISE EXCEPTION 'Request is not awaiting matching' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.matching_fallback_consents(request_id,preferred_contractor_id,homeowner_id)
    VALUES(r.id,r.preferred_contractor_id,auth.uid()) ON CONFLICT(request_id) DO NOTHING;
  IF FOUND THEN
    PERFORM public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object(
      'action','provider_fallback_consented','preferred_contractor_id',r.preferred_contractor_id,'policy','MPS-6.2'));
  END IF;
  RETURN private.offer_next_for_request_internal(r.id);
END;
$$;
REVOKE ALL ON FUNCTION public.consent_to_provider_fallback(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consent_to_provider_fallback(uuid) TO authenticated;


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

  IF NOT private.fallback_permitted(_request_id,_contractor_id) THEN
    RAISE EXCEPTION 'Homeowner consent is required before provider fallback' USING ERRCODE='42501';
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at <= now();

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
      'expires_at', deadline, 'path', candidate.path, 'rank', candidate.rank_order, 'ranking_version','balanced-v1'));

  INSERT INTO public.notifications(user_id,type,severity,title,body,link,related_request_id,related_contractor_id)
    SELECT user_id,'job_offer','warning','New job offer — respond within four hours',
      'Accept or decline this exclusive offer before its four-hour deadline.','/vendor/jobs',_request_id,candidate.contractor_id
    FROM public.contractors WHERE id=candidate.contractor_id AND user_id IS NOT NULL;
  RETURN offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.offer_next_for_request_internal(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  pending_offer uuid;
  candidate record;
  candidate_count integer;
  request_status public.request_status;
  request_matching_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  SELECT request.status, request.matching_status
  INTO request_status, request_matching_status
  FROM public.service_requests request
  WHERE request.id = _request_id;
  IF request_status NOT IN ('pending', 'matched') OR request_matching_status = 'matched' THEN
    RETURN NULL;
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at <= now();

  SELECT id INTO pending_offer
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id AND outcome = 'pending'
  LIMIT 1;
  IF pending_offer IS NOT NULL THEN RETURN pending_offer; END IF;

  SELECT count(*) INTO candidate_count
  FROM private.find_eligible_packages_core(_request_id);

  SELECT eligible.* INTO candidate
  FROM private.find_eligible_packages_core(_request_id) eligible
  WHERE NOT EXISTS (
    SELECT 1 FROM public.job_match_attempts previous
    WHERE previous.service_request_id = _request_id
      AND previous.contractor_id = eligible.contractor_id
      AND previous.outcome IN ('accepted', 'declined', 'expired', 'withdrawn')
  )
  ORDER BY eligible.preferred DESC, eligible.rank_order
  LIMIT 1;

  IF candidate.contractor_id IS NOT NULL AND NOT private.fallback_permitted(_request_id,candidate.contractor_id) THEN
    UPDATE public.service_requests
    SET contractor_id = NULL,
        assigned_at = NULL,
        match_expires_at = NULL,
        status = 'pending',
        matching_status = 'awaiting_consent',
        needs_admin_review = true,
        updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  IF candidate.contractor_id IS NULL THEN
    UPDATE public.service_requests
    SET contractor_id = NULL,
        assigned_at = NULL,
        match_expires_at = NULL,
        status = 'pending',
        matching_status = 'exhausted',
        needs_admin_review = true,
        updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  RETURN private.create_job_offer_internal(
    _request_id, candidate.contractor_id, candidate.package_id,
    candidate.package_tier_id, false
  );
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
    jsonb_build_object('from','matched','to','scheduled','reason','vendor_accepted','offer_id',offer.id,'lifecycle_version','phase4-v1'));
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
    AND contractor.user_id = auth.uid()
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

CREATE FUNCTION public.create_job_offer(_request_id uuid,_contractor_id uuid,
  _package_id uuid DEFAULT NULL,_package_tier_id uuid DEFAULT NULL,_force boolean DEFAULT false,_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE before_state jsonb; result uuid;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) AND COALESCE(auth.role(),'') <> 'service_role' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
  END IF;
  IF NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Assignment reason required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text,0));
  SELECT jsonb_build_object('contractor_id',contractor_id,'status',status,'matching_status',matching_status)
    INTO before_state FROM public.service_requests WHERE id=_request_id FOR UPDATE;
  result := private.create_job_offer_internal(_request_id,_contractor_id,_package_id,_package_tier_id,_force);
  PERFORM public.log_job_event(_request_id,'status_changed',auth.uid(),jsonb_build_object(
    'action','admin_offer_override','before',before_state,'contractor_id',_contractor_id,'offer_id',result,'reason',btrim(_reason)));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_job_offer(uuid,uuid,uuid,uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_job_offer(uuid,uuid,uuid,uuid,boolean,text) TO authenticated,service_role;

CREATE FUNCTION public.admin_assign_contractor(_job_id uuid,_contractor_id uuid,_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
  PERFORM public.create_job_offer(_job_id,_contractor_id,NULL,NULL,true,_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_contractor(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_contractor(uuid,uuid,text) TO authenticated;
