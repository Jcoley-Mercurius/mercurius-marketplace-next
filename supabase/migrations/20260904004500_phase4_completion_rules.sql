-- Approved baseline is one photo; category overrides are versioned, not inferred.
CREATE TABLE public.completion_evidence_rules (
  service_id text NOT NULL REFERENCES public.services_catalog(id),
  version integer NOT NULL CHECK(version>0),
  minimum_photos integer NOT NULL CHECK(minimum_photos>=1),
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(service_id,version)
);
ALTER TABLE public.completion_evidence_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.completion_evidence_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.completion_evidence_rules TO authenticated;
GRANT ALL ON public.completion_evidence_rules TO service_role;
CREATE POLICY "Authenticated users read completion requirements" ON public.completion_evidence_rules FOR SELECT TO authenticated USING(true);
CREATE FUNCTION public.set_completion_evidence_rule(_service_id text,_minimum_photos integer,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF _minimum_photos IS NULL OR _minimum_photos<1 OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Photo minimum and reason required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('completion_rule:'||_service_id,0));
  INSERT INTO public.completion_evidence_rules(service_id,version,minimum_photos,actor_id,reason)
    SELECT _service_id,coalesce(max(version),0)+1,_minimum_photos,auth.uid(),btrim(_reason) FROM public.completion_evidence_rules WHERE service_id=_service_id;
END;
$$;
REVOKE ALL ON FUNCTION public.set_completion_evidence_rule(text,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_completion_evidence_rule(text,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_job_status(_job_id uuid, _to_status request_status, _reason text DEFAULT NULL::text, _metadata jsonb DEFAULT NULL::jsonb)
 RETURNS request_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  j record;
  actor text;
  vendor_user uuid;
  paid boolean;
  rework_ok boolean;
  quote_ok boolean;
  q_amount numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT sr.*, c.user_id AS vendor_user_id
    INTO j
    FROM public.service_requests sr
    LEFT JOIN public.contractors c ON c.id = sr.contractor_id
   WHERE sr.id = _job_id
     FOR UPDATE OF sr;

  IF j IS NULL THEN
    PERFORM public.log_status_rejection(_job_id, NULL, _to_status::text, 'job_not_found', _metadata);
    RAISE EXCEPTION 'Job not found';
  END IF;

  vendor_user := j.vendor_user_id;

  -- Resolve actor class
  IF auth.role() = 'service_role' THEN
    actor := 'internal';
  ELSIF public.has_role(auth.uid(), 'admin') THEN
    actor := 'admin';
  ELSIF auth.uid() = j.customer_id THEN
    actor := 'homeowner';
  ELSIF vendor_user IS NOT NULL AND auth.uid() = vendor_user THEN
    actor := 'vendor';
  ELSE
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text, 'not_authorized', _metadata);
    RAISE EXCEPTION 'Not authorized to change this job';
  END IF;

  -- Authenticate before rejecting duplicate transitions. Worker retries use a separate atomic RPC.
  IF j.status = _to_status THEN
    RAISE EXCEPTION 'Duplicate job transition' USING ERRCODE = '22023';
  END IF;
  IF _to_status = 'homeowner_confirmed' AND actor <> 'homeowner' THEN
    RAISE EXCEPTION 'Only the homeowner can confirm completion' USING ERRCODE = '42501';
  END IF;
  IF actor = 'admin' AND NULLIF(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Admin transition requires a reason' USING ERRCODE = '22023';
  END IF;
  IF actor = 'vendor' AND _to_status = 'in_progress' AND j.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Accept the offer before starting work' USING ERRCODE = '42501';
  END IF;
  IF actor = 'homeowner' AND _to_status = 'scheduled' AND j.matching_status <> 'matched' THEN
    RAISE EXCEPTION 'Vendor acceptance is required for scheduling' USING ERRCODE = '42501';
  END IF;

  IF NOT public.job_transition_actor_allowed(actor, _to_status)
     AND NOT (actor = 'homeowner' AND j.status = 'homeowner_confirmed' AND _to_status = 'completed' AND pg_trigger_depth() > 0) THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
      'actor_not_allowed:' || actor, _metadata);
    RAISE EXCEPTION 'A % cannot move a job to "%"', actor, _to_status USING ERRCODE = '42501';
  END IF;

  IF NOT public.job_transition_allowed(j.status, _to_status) THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
      'invalid_transition', _metadata);
    RAISE EXCEPTION 'Invalid job transition: % -> %', j.status, _to_status USING ERRCODE = '22023';
  END IF;

  IF _to_status IN ('quoted','pending_review') THEN
    RAISE EXCEPTION 'Use the canonical quote or completion workflow' USING ERRCODE='42501';
  END IF;
  IF _to_status='resolved' AND EXISTS(SELECT 1 FROM public.disputes WHERE job_id=j.id AND status<>'resolved') THEN
    RAISE EXCEPTION 'Resolve the dispute ticket before clearing disputed status' USING ERRCODE='42501';
  END IF;
  IF _to_status='disputed' AND NOT EXISTS(SELECT 1 FROM public.disputes WHERE job_id=_job_id AND status<>'resolved') THEN
    RAISE EXCEPTION 'Open a dispute ticket before changing dispute status' USING ERRCODE='42501';
  END IF;
  IF _to_status='disputed' AND actor='homeowner' AND (j.vendor_completed_at IS NULL OR now()>=j.vendor_completed_at+interval '48 hours') THEN
    RAISE EXCEPTION 'The 48-hour dispute window has ended; contact support' USING ERRCODE='22023';
  END IF;
  IF _to_status='reviewed' AND (j.homeowner_confirmed_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.reviews WHERE service_request_id=_job_id AND customer_id=j.customer_id)) THEN
    RAISE EXCEPTION 'A verified review is required' USING ERRCODE='42501';
  END IF;

  -- Guard: homeowners cannot start/schedule work before payment is confirmed
  IF actor = 'homeowner' AND _to_status IN ('scheduled', 'in_progress') THEN
    rework_ok := (_to_status = 'in_progress'
                  AND j.status IN ('vendor_completed', 'pending_review', 'disputed'));
    quote_ok  := (_to_status = 'scheduled'
                  AND j.status = 'quoted'
                  AND j.quote_approved_at IS NOT NULL);

    IF NOT (rework_ok OR quote_ok) THEN
      paid := COALESCE(j.payment_status::text IN ('captured', 'released'), false)
              OR EXISTS (
                SELECT 1 FROM public.invoices i
                 WHERE i.service_request_id = _job_id
                   AND i.status IN ('paid'::invoice_status,
                                    'pending_release'::invoice_status,
                                    'released'::invoice_status)
              );

      IF NOT paid THEN
        PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
          'payment_required', _metadata);
        RAISE EXCEPTION 'Payment must be confirmed before this job can move to "%"', _to_status
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF _to_status='cancelled' AND j.status<>'pending' AND NOT EXISTS(
    SELECT 1 FROM public.job_operations WHERE job_id=j.id AND kind='customer_cancel'
      AND operation_key::text=_metadata->>'operation_key' AND actor_id=auth.uid() AND created_at=now()) THEN
    RAISE EXCEPTION 'Record cancellation policy before cancelling this service' USING ERRCODE='42501';
  END IF;
  -- Guard: completion proof is mandatory
  IF _to_status = 'vendor_completed' THEN
    IF COALESCE(array_length(j.photo_proof_urls, 1), 0) < COALESCE((SELECT minimum_photos FROM public.completion_evidence_rules WHERE service_id=j.service_catalog_id ORDER BY version DESC LIMIT 1),1)
        THEN
      PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
        'missing_photo_proof', _metadata);
      RAISE EXCEPTION 'Required completion photos are missing for this service';
    END IF;
  END IF;

  -- Guard: a vendor must be assigned before work states
  IF _to_status IN ('scheduled','in_progress','pending_review','vendor_completed')
     AND j.contractor_id IS NULL THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
      'no_vendor_assigned', _metadata);
    RAISE EXCEPTION 'Assign a vendor before moving this job to "%"', _to_status;
  END IF;

  -- ── Apply the transition + all downstream field effects ──
  UPDATE public.service_requests SET
    status = _to_status,
    vendor_completed_at = CASE WHEN _to_status = 'vendor_completed' THEN now()
                               WHEN _to_status = 'in_progress' THEN NULL
                               ELSE vendor_completed_at END,
    confirmation_due_at = CASE WHEN _to_status = 'vendor_completed' THEN NULL
                               WHEN _to_status IN ('homeowner_confirmed','disputed','cancelled','in_progress') THEN NULL
                               ELSE confirmation_due_at END,
    confirmation_sent_at = CASE WHEN _to_status = 'vendor_completed' THEN now() WHEN _to_status = 'in_progress' THEN NULL ELSE confirmation_sent_at END,
    confirmation_deadline_at = CASE WHEN _to_status = 'vendor_completed' THEN now() + interval '72 hours' WHEN _to_status IN ('homeowner_confirmed','disputed','cancelled','in_progress') THEN NULL
                               ELSE confirmation_deadline_at END,
    homeowner_confirmed_at = CASE WHEN _to_status = 'homeowner_confirmed' THEN now() ELSE homeowner_confirmed_at END,
    review_request_due_at = CASE WHEN _to_status = 'homeowner_confirmed' THEN NULL
                               WHEN _to_status IN ('review_requested','reviewed','disputed','cancelled') THEN NULL
                               ELSE review_request_due_at END,
    review_requested_at = CASE WHEN _to_status = 'review_requested' THEN now() ELSE review_requested_at END,
    disputed = CASE WHEN _to_status = 'disputed' THEN true
                    WHEN _to_status = 'resolved' THEN false ELSE disputed END,
    disputed_at = CASE WHEN _to_status = 'disputed' THEN now() ELSE disputed_at END,
    dispute_reason = CASE WHEN _to_status = 'disputed' THEN COALESCE(_reason, dispute_reason) ELSE dispute_reason END,
    dispute_resolved_at = CASE WHEN _to_status = 'resolved' THEN now() ELSE dispute_resolved_at END,
    dispute_resolution = CASE WHEN _to_status = 'resolved' THEN COALESCE(_reason, dispute_resolution) ELSE dispute_resolution END,
    match_expires_at = CASE WHEN _to_status <> 'matched' THEN NULL ELSE match_expires_at END,
    needs_admin_review = CASE WHEN _to_status IN ('homeowner_confirmed','completed','closed','resolved')
                              THEN false ELSE needs_admin_review END,
    updated_at = now()
  WHERE id = _job_id;

  IF _to_status = 'cancelled' THEN
    UPDATE public.job_match_attempts SET outcome='withdrawn', withdrawn_at=now(),responded_at=now(),
      reason='Request cancelled',updated_at=now() WHERE service_request_id=_job_id AND outcome='pending';
  END IF;

  -- ── Job event log ──
  PERFORM public.log_job_event(
    _job_id,
    CASE _to_status
      WHEN 'vendor_completed' THEN 'job_completed_by_vendor'::job_event_type
      WHEN 'homeowner_confirmed' THEN 'confirmation_received'::job_event_type
      WHEN 'disputed' THEN 'dispute_opened'::job_event_type
      WHEN 'resolved' THEN 'dispute_resolved'::job_event_type
      WHEN 'review_requested' THEN 'review_requested'::job_event_type
      WHEN 'reviewed' THEN 'review_submitted'::job_event_type
      ELSE 'status_changed'::job_event_type
    END,
    auth.uid(),
    COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object('from', j.status, 'to', _to_status, 'actor', actor, 'reason', _reason, 'lifecycle_version', 'phase4-v1', 'completion_rule_version', CASE WHEN _to_status='vendor_completed' THEN COALESCE((SELECT max(version) FROM public.completion_evidence_rules WHERE service_id=j.service_catalog_id),0) ELSE NULL END)
  );

  -- ── Notifications ──
  IF _to_status = 'quoted' THEN
    SELECT COALESCE(
             NULLIF(_metadata->>'quote_amount','')::numeric,
             sr.quote_amount,
             sr.total_amount)
      INTO q_amount
      FROM public.service_requests sr WHERE sr.id = _job_id;

    PERFORM public.notify_user(j.customer_id, 'job_status', 'warning',
      'Your quote is ready',
      'Your ' || j.service_type || ' quote is ready'
        || CASE WHEN q_amount IS NOT NULL
                THEN ': $' || trim(to_char(q_amount, 'FM999999990.00'))
                ELSE '' END
        || '. Review and approve it to get scheduled.',
      '/dashboard', _job_id, j.contractor_id);
  ELSIF _to_status = 'in_progress' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'info',
      'Your pro has started work',
      'Work on your ' || j.service_type || ' job is now in progress.', '/dashboard', _job_id, j.contractor_id);
  ELSIF _to_status = 'scheduled' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'info',
      'Your job is scheduled',
      'Your ' || j.service_type || ' job is confirmed and scheduled.', '/dashboard', _job_id, j.contractor_id);
  ELSIF _to_status = 'vendor_completed' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'warning',
      'Your job is finished — please confirm',
      'Your pro marked the ' || j.service_type || ' job complete and uploaded photo proof. Please confirm or report an issue. If you do not respond within 72 hours, Mercurius will review the job; silence does not confirm completion.',
      '/dashboard', _job_id, j.contractor_id);
  ELSIF _to_status = 'homeowner_confirmed' AND vendor_user IS NOT NULL THEN
    PERFORM public.notify_user(vendor_user, 'job_status', 'info',
      'Homeowner confirmed the job',
      'The homeowner confirmed your completed work. Payout is handled separately under the approved payment policy.',
      '/vendor/jobs', _job_id, j.contractor_id);
  ELSIF _to_status = 'completed' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'info',
      'Job complete',
      'Your ' || j.service_type || ' job is closed out. Thanks for using Mercurius.',
      '/dashboard', _job_id, j.contractor_id);
    IF vendor_user IS NOT NULL THEN
      PERFORM public.notify_user(vendor_user, 'job_status', 'info',
        'Job completed', 'This job is now complete. Payout eligibility is handled separately.',
        '/vendor/jobs', _job_id, j.contractor_id);
    END IF;
  ELSIF _to_status = 'cancelled' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'warning',
      'Job cancelled', 'Your ' || j.service_type || ' job was cancelled.', '/dashboard', _job_id, j.contractor_id);
    IF vendor_user IS NOT NULL THEN
      PERFORM public.notify_user(vendor_user, 'job_status', 'warning',
        'Job cancelled', 'A job assigned to you was cancelled.', '/vendor/jobs', _job_id, j.contractor_id);
    END IF;
  END IF;

  RETURN _to_status;
END;
$function$;
