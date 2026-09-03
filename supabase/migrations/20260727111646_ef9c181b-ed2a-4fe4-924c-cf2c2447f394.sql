-- Internal helpers -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_job_event(_job_id uuid, _type public.job_event_type, _actor uuid DEFAULT NULL, _meta jsonb DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.job_events (job_id, event_type, actor_id, metadata)
  VALUES (_job_id, _type, _actor, _meta);
$$;
REVOKE ALL ON FUNCTION public.log_job_event(uuid, public.job_event_type, uuid, jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.notify_user(_user_id uuid, _type text, _severity text, _title text, _body text, _link text, _request_id uuid DEFAULT NULL, _contractor_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, type, severity, title, body, link, related_request_id, related_contractor_id)
  VALUES (_user_id, _type, _severity, _title, _body, _link, _request_id, _contractor_id);
$$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
-- Vendor marks job complete ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.vendor_complete_job(_job_id uuid, _photo_urls text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    RAISE EXCEPTION 'At least one completion photo is required';
  END IF;

  UPDATE public.service_requests
     SET status = 'vendor_completed',
         vendor_completed_at = now(),
         photo_proof_urls = _photo_urls,
         confirmation_due_at = now() + interval '4 hours',
         confirmation_sent_at = NULL,
         needs_admin_review = false,
         updated_at = now()
   WHERE id = _job_id;

  PERFORM public.log_job_event(_job_id, 'job_completed_by_vendor', auth.uid(),
    jsonb_build_object('photo_count', array_length(_photo_urls, 1)));
END;
$$;
-- Homeowner: "Looks good" -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.homeowner_confirm_job(_job_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF j.status <> 'vendor_completed' THEN
    RAISE EXCEPTION 'Job is not awaiting confirmation';
  END IF;

  UPDATE public.service_requests
     SET status = 'homeowner_confirmed',
         homeowner_confirmed_at = now(),
         confirmation_deadline_at = NULL,
         confirmation_due_at = NULL,
         review_request_due_at = now() + interval '1 hour',
         updated_at = now()
   WHERE id = _job_id;

  PERFORM public.log_job_event(_job_id, 'confirmation_received', auth.uid(), NULL);
END;
$$;
-- Homeowner: "There's an issue" ----------------------------------------------
CREATE OR REPLACE FUNCTION public.homeowner_raise_dispute(_job_id uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  UPDATE public.service_requests
     SET status = 'disputed',
         disputed = true,
         dispute_reason = _reason,
         disputed_at = now(),
         confirmation_deadline_at = NULL,
         confirmation_due_at = NULL,
         review_request_due_at = NULL,
         updated_at = now()
   WHERE id = _job_id;

  INSERT INTO public.disputes (job_id, homeowner_id, vendor_id, reason)
  VALUES (_job_id, j.customer_id, j.contractor_id, _reason)
  RETURNING id INTO d_id;

  PERFORM public.log_job_event(_job_id, 'dispute_opened', auth.uid(), jsonb_build_object('dispute_id', d_id));

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
-- Homeowner submits review ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_job_review(_job_id uuid, _rating integer, _comment text)
RETURNS TABLE(review_id uuid, visibility public.review_visibility)
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

  UPDATE public.service_requests
     SET status = 'reviewed', updated_at = now()
   WHERE id = _job_id;

  PERFORM public.log_job_event(_job_id, 'review_submitted', auth.uid(),
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
-- Google prompt tracking ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_google_prompt(_review_id uuid, _clicked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.reviews
     SET google_prompt_shown = true,
         google_prompt_clicked = google_prompt_clicked OR _clicked
   WHERE id = _review_id AND customer_id = auth.uid();
END;
$$;
-- Admin resolves dispute ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(_dispute_id uuid, _status public.dispute_status, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    UPDATE public.service_requests
       SET status = 'resolved',
           disputed = false,
           dispute_resolved_at = now(),
           dispute_resolution = _notes,
           updated_at = now()
     WHERE id = d.job_id;
    PERFORM public.log_job_event(d.job_id, 'dispute_resolved', auth.uid(), jsonb_build_object('dispute_id', _dispute_id));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.vendor_complete_job(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.homeowner_confirm_job(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.homeowner_raise_dispute(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_job_review(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.track_google_prompt(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_resolve_dispute(uuid, public.dispute_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_complete_job(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_confirm_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_raise_dispute(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_review(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_google_prompt(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, public.dispute_status, text) TO authenticated;
