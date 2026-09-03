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
  photos int;
  paid boolean;
  rework_ok boolean;
  quote_ok boolean;
  q_amount numeric;
BEGIN
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
  IF current_user <> 'authenticated' AND auth.uid() IS NULL THEN
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

  -- No-op transitions are accepted silently
  IF j.status = _to_status THEN
    RETURN j.status;
  END IF;

  IF NOT public.job_transition_actor_allowed(actor, _to_status) THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
      'actor_not_allowed:' || actor, _metadata);
    RAISE EXCEPTION 'A % cannot move a job to "%"', actor, _to_status USING ERRCODE = '42501';
  END IF;

  IF NOT public.job_transition_allowed(j.status, _to_status) THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
      'invalid_transition', _metadata);
    RAISE EXCEPTION 'Invalid job transition: % -> %', j.status, _to_status USING ERRCODE = '22023';
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

  -- Guard: completion proof is mandatory
  IF _to_status = 'vendor_completed' THEN
    photos := COALESCE(array_length(
      COALESCE((_metadata->>'photo_count')::int, array_length(j.photo_proof_urls, 1)) ::int
      , 1), 0);
    IF COALESCE(array_length(j.photo_proof_urls, 1), 0) = 0
       AND COALESCE((_metadata->>'photo_count')::int, 0) = 0 THEN
      PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
        'missing_photo_proof', _metadata);
      RAISE EXCEPTION 'At least one completion photo is required before marking a job complete';
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
    confirmation_due_at = CASE WHEN _to_status = 'vendor_completed' THEN now() + interval '4 hours'
                               WHEN _to_status IN ('homeowner_confirmed','disputed','cancelled','in_progress') THEN NULL
                               ELSE confirmation_due_at END,
    confirmation_sent_at = CASE WHEN _to_status = 'vendor_completed' THEN NULL ELSE confirmation_sent_at END,
    confirmation_deadline_at = CASE WHEN _to_status IN ('homeowner_confirmed','disputed','cancelled') THEN NULL
                               ELSE confirmation_deadline_at END,
    homeowner_confirmed_at = CASE WHEN _to_status = 'homeowner_confirmed' THEN now() ELSE homeowner_confirmed_at END,
    review_request_due_at = CASE WHEN _to_status = 'homeowner_confirmed' THEN now() + interval '1 hour'
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
      ELSE 'flagged_for_admin_review'::job_event_type
    END,
    auth.uid(),
    jsonb_build_object('from', j.status, 'to', _to_status, 'actor', actor, 'reason', _reason)
      || COALESCE(_metadata, '{}'::jsonb)
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
      'Your pro marked the ' || j.service_type || ' job complete and uploaded photo proof. Confirm within 4 hours.',
      '/dashboard', _job_id, j.contractor_id);
  ELSIF _to_status = 'homeowner_confirmed' AND vendor_user IS NOT NULL THEN
    PERFORM public.notify_user(vendor_user, 'job_status', 'info',
      'Homeowner confirmed the job',
      'The homeowner confirmed your completed work. Payout release is now in progress.',
      '/vendor/jobs', _job_id, j.contractor_id);
  ELSIF _to_status = 'completed' THEN
    PERFORM public.notify_user(j.customer_id, 'job_status', 'info',
      'Job complete',
      'Your ' || j.service_type || ' job is closed out. Thanks for using Mercurius.',
      '/dashboard', _job_id, j.contractor_id);
    IF vendor_user IS NOT NULL THEN
      PERFORM public.notify_user(vendor_user, 'job_status', 'info',
        'Job completed', 'This job is now complete and eligible for payout release.',
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
