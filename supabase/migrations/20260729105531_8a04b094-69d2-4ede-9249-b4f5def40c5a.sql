REVOKE EXECUTE ON FUNCTION public.guard_direct_status_writes() FROM PUBLIC, anon, authenticated;
-- Admin: assign a vendor (pending/quoted -> matched)
CREATE OR REPLACE FUNCTION public.admin_assign_contractor(_job_id uuid, _contractor_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can assign vendors';
  END IF;
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contractors WHERE id = _contractor_id) THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;

  UPDATE public.service_requests
     SET contractor_id = _contractor_id, updated_at = now()
   WHERE id = _job_id;

  PERFORM public.transition_job_status(_job_id, 'matched'::request_status, NULL,
    jsonb_build_object('contractor_id', _contractor_id));
END;
$$;
-- Admin: send a quote (pending -> quoted, with server-set amount)
CREATE OR REPLACE FUNCTION public.admin_send_quote(_job_id uuid, _amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can send quotes';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Quote amount must be greater than zero'; END IF;

  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  UPDATE public.service_requests
     SET total_amount = _amount,
         quote_amount = _amount,
         updated_at = now()
   WHERE id = _job_id;

  PERFORM public.transition_job_status(_job_id, 'quoted'::request_status, NULL,
    jsonb_build_object('quote_amount', _amount));
END;
$$;
-- Homeowner: approve a quote (quoted -> scheduled) / decline (-> cancelled)
CREATE OR REPLACE FUNCTION public.homeowner_respond_to_quote(_job_id uuid, _approve boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF j.status <> 'quoted' THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text,
      CASE WHEN _approve THEN 'scheduled' ELSE 'cancelled' END, 'no_open_quote', NULL);
    RAISE EXCEPTION 'There is no open quote on this job';
  END IF;

  IF _approve THEN
    UPDATE public.service_requests SET quote_approved_at = now(), updated_at = now() WHERE id = _job_id;
    PERFORM public.transition_job_status(_job_id, 'scheduled'::request_status, NULL, NULL);
  ELSE
    PERFORM public.transition_job_status(_job_id, 'cancelled'::request_status, 'Quote declined by homeowner', NULL);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_assign_contractor(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_send_quote(uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.homeowner_respond_to_quote(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_contractor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_quote(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.homeowner_respond_to_quote(uuid, boolean) TO authenticated;
-- Rematch/release: route the status half through the shared engine
CREATE OR REPLACE FUNCTION public.release_job_match(_job_id uuid, _contractor_id uuid, _outcome text, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; admin_id uuid; bounced integer;
BEGIN
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RETURN; END IF;

  UPDATE public.job_match_attempts
     SET outcome = _outcome, reason = _reason, responded_at = now()
   WHERE service_request_id = _job_id AND contractor_id = _contractor_id AND outcome = 'pending';

  -- status change first, via the single engine (skips notifications for 'pending')
  IF j.status <> 'pending' THEN
    PERFORM public.transition_job_status(_job_id, 'pending'::request_status, _reason,
      jsonb_build_object('released_contractor_id', _contractor_id, 'outcome', _outcome));
  END IF;

  UPDATE public.service_requests
     SET contractor_id = NULL,
         assigned_at = NULL,
         match_expires_at = NULL,
         last_match_expired_at = CASE WHEN _outcome = 'expired' THEN now() ELSE last_match_expired_at END,
         declined_contractor_ids = (
           SELECT ARRAY(SELECT DISTINCT unnest(declined_contractor_ids || _contractor_id))
         ),
         needs_admin_review = CASE WHEN COALESCE(match_attempt_count,0) >= 3 THEN true ELSE needs_admin_review END,
         updated_at = now()
   WHERE id = _job_id;

  PERFORM public.log_job_event(
    _job_id,
    CASE WHEN _outcome = 'declined' THEN 'match_declined'::job_event_type
         ELSE 'match_expired'::job_event_type END,
    auth.uid(),
    jsonb_build_object('contractor_id', _contractor_id, 'reason', _reason,
                       'attempt', j.match_attempt_count));

  PERFORM public.notify_user(j.customer_id, 'match_update', 'info',
    'Still finding your pro',
    CASE WHEN _outcome = 'declined'
         THEN 'The pro we matched had to pass on this job. We are matching you with another verified pro now.'
         ELSE 'Your matched pro did not respond in time. We are matching you with another verified pro now.' END,
    '/dashboard', _job_id, NULL);

  SELECT COALESCE(match_attempt_count, 0) INTO bounced FROM public.service_requests WHERE id = _job_id;
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.notify_user(admin_id, 'match_update',
      CASE WHEN bounced >= 3 THEN 'critical' ELSE 'warning' END,
      CASE WHEN _outcome = 'declined' THEN 'Vendor declined a job' ELSE 'Job match expired' END,
      'Job needs rematching (' || bounced || ' attempt(s) so far).',
      '/admin/requests', _job_id, _contractor_id);
  END LOOP;
END;
$$;
