-- ============================================================
-- 1. Rejected-transition audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.job_status_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid,
  actor_id uuid,
  from_status text,
  to_status text,
  reason text NOT NULL,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.job_status_rejections TO authenticated;
GRANT ALL ON public.job_status_rejections TO service_role;
ALTER TABLE public.job_status_rejections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view status rejections" ON public.job_status_rejections;
CREATE POLICY "Admins can view status rejections"
  ON public.job_status_rejections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE OR REPLACE FUNCTION public.log_status_rejection(
  _job_id uuid, _from text, _to text, _reason text, _ctx jsonb DEFAULT NULL
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.job_status_rejections (job_id, actor_id, from_status, to_status, reason, context)
  VALUES (_job_id, auth.uid(), _from, _to, _reason, _ctx);
$$;
-- ============================================================
-- 2. The state machine: single source of truth
-- ============================================================
CREATE OR REPLACE FUNCTION public.job_transition_allowed(_from request_status, _to request_status)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _from
    WHEN 'pending'             THEN _to IN ('matched','quoted','scheduled','in_progress','cancelled')
    WHEN 'quoted'              THEN _to IN ('scheduled','matched','pending','in_progress','cancelled')
    WHEN 'matched'             THEN _to IN ('scheduled','pending','in_progress','cancelled')
    WHEN 'scheduled'           THEN _to IN ('in_progress','pending','cancelled')
    WHEN 'in_progress'         THEN _to IN ('pending_review','vendor_completed','pending','cancelled')
    WHEN 'pending_review'      THEN _to IN ('vendor_completed','in_progress','cancelled')
    WHEN 'vendor_completed'    THEN _to IN ('homeowner_confirmed','disputed','in_progress')
    WHEN 'homeowner_confirmed' THEN _to IN ('review_requested','reviewed','completed','disputed')
    WHEN 'review_requested'    THEN _to IN ('reviewed','completed','disputed')
    WHEN 'reviewed'            THEN _to IN ('completed','closed','disputed')
    WHEN 'completed'           THEN _to IN ('closed','disputed')
    WHEN 'disputed'            THEN _to IN ('resolved','in_progress')
    WHEN 'resolved'            THEN _to IN ('completed','closed')
    WHEN 'cancelled'           THEN false
    WHEN 'closed'              THEN false
    ELSE false
  END
$$;
-- Which statuses each actor class may request
CREATE OR REPLACE FUNCTION public.job_transition_actor_allowed(_actor text, _to request_status)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _actor
    WHEN 'internal' THEN true
    WHEN 'admin'    THEN true
    WHEN 'vendor'   THEN _to IN ('scheduled','in_progress','pending_review','vendor_completed')
    WHEN 'homeowner'THEN _to IN ('scheduled','cancelled','homeowner_confirmed','in_progress','disputed','reviewed')
    ELSE false
  END
$$;
-- ============================================================
-- 3. The one shared transition function
-- ============================================================
CREATE OR REPLACE FUNCTION public.transition_job_status(
  _job_id uuid,
  _to_status request_status,
  _reason text DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
) RETURNS request_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j record;
  actor text;
  vendor_user uuid;
  photos int;
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
  IF _to_status = 'in_progress' THEN
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
$$;
REVOKE EXECUTE ON FUNCTION public.transition_job_status(uuid, request_status, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_job_status(uuid, request_status, text, jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.log_status_rejection(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_transition_allowed(request_status, request_status) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.job_transition_actor_allowed(text, request_status) FROM PUBLIC, anon;
-- ============================================================
-- 4. Block direct status writes from signed-in clients
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_direct_status_writes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND current_user = 'authenticated' THEN
    PERFORM public.log_status_rejection(NEW.id, OLD.status::text, NEW.status::text,
      'direct_status_write_blocked', NULL);
    RAISE EXCEPTION 'Job status must be changed through transition_job_status()'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_direct_status_writes ON public.service_requests;
CREATE TRIGGER trg_guard_direct_status_writes
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_direct_status_writes();
-- ============================================================
-- 5. Route existing entry points through the shared function
-- ============================================================
CREATE OR REPLACE FUNCTION public.vendor_complete_job(_job_id uuid, _photo_urls text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  SELECT sr.*, c.user_id AS vendor_user_id INTO j
  FROM public.service_requests sr
  LEFT JOIN public.contractors c ON c.id = sr.contractor_id
  WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR j.vendor_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _photo_urls IS NULL OR array_length(_photo_urls, 1) IS NULL THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, 'vendor_completed',
      'missing_photo_proof', NULL);
    RAISE EXCEPTION 'At least one completion photo is required';
  END IF;

  UPDATE public.service_requests
     SET photo_proof_urls = _photo_urls, updated_at = now()
   WHERE id = _job_id;

  PERFORM public.transition_job_status(_job_id, 'vendor_completed'::request_status, NULL,
    jsonb_build_object('photo_count', array_length(_photo_urls, 1)));
END;
$$;
CREATE OR REPLACE FUNCTION public.homeowner_confirm_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM public.transition_job_status(_job_id, 'homeowner_confirmed'::request_status, NULL, NULL);
END;
$$;
CREATE OR REPLACE FUNCTION public.homeowner_raise_dispute(_job_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; vendor_user uuid; d_id uuid;
BEGIN
  SELECT sr.*, c.user_id AS vendor_user_id INTO j
  FROM public.service_requests sr
  LEFT JOIN public.contractors c ON c.id = sr.contractor_id
  WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM public.transition_job_status(_job_id, 'disputed'::request_status, _reason, NULL);

  INSERT INTO public.disputes (job_id, homeowner_id, vendor_id, reason)
  VALUES (_job_id, j.customer_id, j.contractor_id, _reason)
  RETURNING id INTO d_id;

  vendor_user := j.vendor_user_id;
  IF vendor_user IS NOT NULL THEN
    PERFORM public.notify_user(vendor_user, 'dispute', 'critical',
      'Issue reported on a completed job',
      'The homeowner reported an issue. Please review and reach out.',
      '/vendor/jobs', _job_id, j.contractor_id);
  END IF;

  RETURN d_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.submit_job_review(_job_id uuid, _rating integer, _comment text)
RETURNS TABLE(review_id uuid, visibility review_visibility)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; vendor_user uuid; vis public.review_visibility; r_id uuid;
BEGIN
  IF _rating < 1 OR _rating > 5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5'; END IF;

  SELECT sr.*, c.user_id AS vendor_user_id INTO j
  FROM public.service_requests sr
  LEFT JOIN public.contractors c ON c.id = sr.contractor_id
  WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF j.contractor_id IS NULL THEN RAISE EXCEPTION 'Job has no assigned vendor'; END IF;

  vis := CASE WHEN _rating >= 4 THEN 'eligible_for_google'::public.review_visibility
              ELSE 'internal_only'::public.review_visibility END;

  INSERT INTO public.reviews (service_request_id, customer_id, contractor_id, rating, comment, visibility)
  VALUES (_job_id, auth.uid(), j.contractor_id, _rating, NULLIF(btrim(coalesce(_comment,'')), ''), vis)
  RETURNING id INTO r_id;

  PERFORM public.transition_job_status(_job_id, 'reviewed'::request_status, NULL,
    jsonb_build_object('rating', _rating, 'visibility', vis));

  vendor_user := j.vendor_user_id;
  IF _rating < 4 AND vendor_user IS NOT NULL THEN
    PERFORM public.notify_user(vendor_user, 'internal_review', 'warning',
      'New internal review needs your attention',
      'A homeowner left a ' || _rating || '-star internal review. Please contact them to resolve it.',
      '/vendor/overview', _job_id, j.contractor_id);
  END IF;

  RETURN QUERY SELECT r_id, vis;
END;
$$;
CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  SELECT sr.*, c.user_id AS vendor_user_id INTO j
    FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
   WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'This job is no longer assigned to you'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR j.vendor_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF j.status <> 'matched' THEN RAISE EXCEPTION 'This job is no longer awaiting your response'; END IF;
  IF j.match_expires_at IS NOT NULL AND j.match_expires_at < now() THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, 'scheduled', 'match_window_expired', NULL);
    RAISE EXCEPTION 'Your response window for this job has expired';
  END IF;

  PERFORM public.transition_job_status(_job_id, 'scheduled'::request_status, NULL, NULL);

  UPDATE public.job_match_attempts
     SET outcome = 'accepted', responded_at = now()
   WHERE service_request_id = _job_id AND contractor_id = j.contractor_id AND outcome = 'pending';
END;
$$;
-- Dispute resolution goes through the machine too
CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(_dispute_id uuid, _status dispute_status, _notes text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can resolve disputes'; END IF;
  SELECT * INTO d FROM public.disputes WHERE id = _dispute_id;
  IF d IS NULL THEN RAISE EXCEPTION 'Dispute not found'; END IF;

  UPDATE public.disputes
     SET status = _status,
         resolution_notes = _notes,
         resolved_at = CASE WHEN _status = 'resolved' THEN now() ELSE NULL END,
         updated_at = now()
   WHERE id = _dispute_id;

  IF _status = 'resolved' THEN
    PERFORM public.transition_job_status(d.job_id, 'resolved'::request_status, _notes, NULL);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, dispute_status, text) TO authenticated;
