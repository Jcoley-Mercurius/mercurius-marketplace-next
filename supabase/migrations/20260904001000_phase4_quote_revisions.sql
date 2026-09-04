-- DEC-008 / MPS 6.3: 24-hour homeowner approval, independent of scheduling.
CREATE TABLE public.request_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.service_requests(id),
  revision integer NOT NULL CHECK(revision>0),
  supersedes_id uuid REFERENCES public.request_quotes(id),
  amount numeric NOT NULL CHECK(amount>0),
  policy_version text NOT NULL DEFAULT 'DEC-2026-008',
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK(length(btrim(reason))>0),
  status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','declined','expired','superseded')),
  decision_actor uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  UNIQUE(request_id,revision),
  CHECK(expires_at=sent_at+interval '24 hours')
);
CREATE UNIQUE INDEX request_quotes_one_submitted ON public.request_quotes(request_id) WHERE status='submitted';
ALTER TABLE public.request_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_quotes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.request_quotes TO authenticated;
GRANT ALL ON public.request_quotes TO service_role;
CREATE POLICY "Quote participants read history" ON public.request_quotes FOR SELECT TO authenticated USING
  (EXISTS (SELECT 1 FROM public.service_requests r WHERE r.id=request_id AND
    (r.customer_id=auth.uid() OR public.has_role(auth.uid(),'admin') OR EXISTS
      (SELECT 1 FROM public.contractors c WHERE c.id=r.contractor_id AND c.user_id=auth.uid()))));
ALTER TABLE public.service_requests
  ADD COLUMN current_quote_id uuid REFERENCES public.request_quotes(id),
  ADD COLUMN quote_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN quote_status text CHECK(quote_status IN ('submitted','accepted','declined','expired','legacy_review')),
  ADD COLUMN quote_expires_at timestamptz;
-- Preserve legacy amounts/history; do not invent a notice time or retroactive expiry.
UPDATE public.service_requests SET quote_status='legacy_review',needs_admin_review=true WHERE status='quoted';

CREATE FUNCTION private.guard_quote_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','decision_actor','decided_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','decision_actor','decided_at']) THEN
    RAISE EXCEPTION 'Quote terms are immutable; send a new revision' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_quote_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_quote_terms BEFORE UPDATE OR DELETE ON public.request_quotes FOR EACH ROW EXECUTE FUNCTION private.guard_quote_history();

DROP FUNCTION public.admin_send_quote(uuid,numeric,text);
CREATE FUNCTION public.admin_send_quote(_job_id uuid,_amount numeric,_reason text,_expected_revision integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; q_id uuid;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Only admins can send quotes' USING ERRCODE='42501'; END IF;
  IF NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Quote reason required' USING ERRCODE='22023'; END IF;
  IF _amount IS NULL OR _amount<=0 THEN RAISE EXCEPTION 'Quote amount must be greater than zero' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  IF r.id IS NULL OR r.status NOT IN ('pending','matched','quoted','scheduled') THEN RAISE EXCEPTION 'Job cannot receive a quote' USING ERRCODE='22023'; END IF;
  IF _expected_revision IS DISTINCT FROM r.quote_revision THEN RAISE EXCEPTION 'Quote changed; refresh before sending' USING ERRCODE='22023'; END IF;
  UPDATE public.request_quotes SET status='superseded' WHERE request_id=r.id AND status='submitted';
  INSERT INTO public.request_quotes(request_id,revision,supersedes_id,amount,sender_id,reason)
    VALUES(r.id,r.quote_revision+1,r.current_quote_id,_amount,auth.uid(),btrim(_reason)) RETURNING id INTO q_id;
  UPDATE public.service_requests SET current_quote_id=q_id,quote_revision=r.quote_revision+1,
    quote_status='submitted',quote_expires_at=now()+interval '24 hours',quote_amount=_amount,
    quote_approved_at=NULL,quote_declined_at=NULL,updated_at=now() WHERE id=r.id;
  PERFORM public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object('action','quote_submitted',
    'quote_id',q_id,'revision',r.quote_revision+1,'supersedes',r.current_quote_id,'amount',_amount,'reason',btrim(_reason),'expires_at',now()+interval '24 hours'));
  PERFORM public.notify_user(r.customer_id,'job_status','info','Price quote ready for approval',
    'Review this price quote within 24 hours. Provider acceptance controls scheduling; quote approval authorizes these terms, not a payment.',
    '/dashboard',r.id,r.contractor_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_send_quote(uuid,numeric,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_send_quote(uuid,numeric,text,integer) TO authenticated;

DROP FUNCTION public.homeowner_respond_to_quote(uuid,boolean);
CREATE FUNCTION public.homeowner_respond_to_quote(_job_id uuid,_approve boolean,_quote_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; q public.request_quotes; admin_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the homeowner can respond to this quote' USING ERRCODE='42501';
  END IF;
  IF _quote_id IS NULL OR _quote_id IS DISTINCT FROM r.current_quote_id THEN RAISE EXCEPTION 'Quote changed; refresh before responding' USING ERRCODE='22023'; END IF;
  SELECT * INTO q FROM public.request_quotes WHERE id=_quote_id FOR UPDATE;
  IF _approve IS NULL OR q.status<>'submitted' OR r.status NOT IN ('pending','matched','quoted','scheduled') THEN
    RAISE EXCEPTION 'There is no open quote on this job' USING ERRCODE='22023';
  END IF;
  IF q.expires_at<=now() THEN RAISE EXCEPTION 'Quote has expired' USING ERRCODE='22023'; END IF;
  UPDATE public.request_quotes SET status=CASE WHEN _approve THEN 'accepted' ELSE 'declined' END,
    decision_actor=auth.uid(),decided_at=now() WHERE id=q.id;
  UPDATE public.service_requests SET quote_status=CASE WHEN _approve THEN 'accepted' ELSE 'declined' END,
    quote_approved_at=CASE WHEN _approve THEN now() ELSE NULL END,
    quote_declined_at=CASE WHEN NOT _approve THEN now() ELSE NULL END,
    needs_admin_review=needs_admin_review OR NOT _approve WHERE id=r.id;
  -- Approval/decline never fabricates or reverses vendor acceptance.
  IF NOT _approve THEN
    UPDATE public.job_match_attempts SET outcome='withdrawn',withdrawn_at=now(),responded_at=now(),reason='Homeowner declined quote'
      WHERE service_request_id=r.id AND outcome='pending';
    UPDATE public.service_requests SET matching_status='quote_pending' WHERE id=r.id AND matching_status<>'matched';
    FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role='admin' LOOP
      PERFORM public.notify_user(admin_id,'job_status','warning','Quote declined','Review the declined quote and contact the parties. The request has not been cancelled.','/admin/requests',r.id,r.contractor_id);
    END LOOP;
  END IF;
  PERFORM public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object('action',CASE WHEN _approve THEN 'quote_approved' ELSE 'quote_declined' END,
    'quote_id',q.id,'revision',q.revision,'amount',q.amount,'from',r.status,'to',r.status));
END;
$$;
REVOKE ALL ON FUNCTION public.homeowner_respond_to_quote(uuid,boolean,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.homeowner_respond_to_quote(uuid,boolean,uuid) TO authenticated;

CREATE FUNCTION private.expire_request_quotes() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE item record; expired integer:=0; r public.service_requests;
BEGIN
  FOR item IN SELECT id,request_id FROM public.request_quotes WHERE status='submitted' AND expires_at<=now() ORDER BY request_id LIMIT 200 LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(item.request_id::text,0));
    SELECT * INTO r FROM public.service_requests WHERE id=item.request_id FOR UPDATE;
    UPDATE public.request_quotes SET status='expired' WHERE id=item.id AND status='submitted' AND expires_at<=now();
    IF FOUND THEN
      UPDATE public.service_requests SET quote_status='expired',needs_admin_review=true WHERE id=r.id AND current_quote_id=item.id;
      PERFORM public.log_job_event(r.id,'status_changed',NULL,jsonb_build_object('action','quote_expired','quote_id',item.id,'policy','DEC-2026-008'));
      PERFORM public.notify_user(r.customer_id,'job_status','warning','Price quote expired','The 24-hour approval window ended. Contact Mercurius for a new quote. This does not cancel the service.','/dashboard',r.id,r.contractor_id);
      expired:=expired+1;
    END IF;
  END LOOP;
  RETURN expired;
END;
$$;
REVOKE ALL ON FUNCTION private.expire_request_quotes() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.run_lifecycle_batch(_run_id uuid, _actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
DECLARE
  j record;
  admin_id uuid;
  result jsonb;
  expired integer := 0;
  quotes_expired integer := 0;
  flagged integer := 0;
  notices integer := 0;
  at_time timestamptz := now();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF _run_id IS NULL THEN RAISE EXCEPTION 'Run ID required' USING ERRCODE = '22023'; END IF;
  IF _actor_id IS NOT NULL AND NOT public.has_role(_actor_id, 'admin') THEN
    RAISE EXCEPTION 'Admin actor required' USING ERRCODE = '42501';
  END IF;
  -- Serializes worker batches, not unrelated requests. Retry after HTTP timeout
  -- safely observes committed row markers even when the new run ID differs.
  PERFORM pg_advisory_xact_lock(hashtextextended('mercurius:lifecycle:phase4-v1', 0));
  SELECT summary INTO result FROM public.lifecycle_worker_runs WHERE id = _run_id;
  IF FOUND THEN RETURN result || jsonb_build_object('replayed', true); END IF;

  quotes_expired := private.expire_request_quotes();
  expired := public.expire_stale_matches();

  -- Legacy pending completion rows receive a notice before any escalation.
  -- New transitions send the same notice atomically at vendor completion.
  FOR j IN SELECT * FROM public.service_requests
    WHERE status = 'vendor_completed' AND confirmation_sent_at IS NULL
    ORDER BY vendor_completed_at NULLS FIRST, id LIMIT 200 FOR UPDATE
  LOOP
    PERFORM public.notify_user(j.customer_id, 'job_confirmation', 'warning',
      'Please confirm your completed service',
      'Confirm completion or report an issue. After 72 hours without a response, Mercurius will review the job. Silence does not confirm completion.',
      '/dashboard?confirm=' || j.id, j.id, j.contractor_id);
    UPDATE public.service_requests SET confirmation_sent_at = at_time,
      confirmation_deadline_at = at_time + interval '72 hours', confirmation_due_at = NULL
      WHERE id = j.id;
    PERFORM public.log_job_event(j.id, 'confirmation_sent', _actor_id,
      jsonb_build_object('run_id', _run_id, 'lifecycle_version', 'phase4-v1', 'deadline', at_time + interval '72 hours'));
    notices := notices + 1;
  END LOOP;

  FOR j IN SELECT * FROM public.service_requests
    WHERE status = 'vendor_completed' AND NOT needs_admin_review
      AND confirmation_sent_at IS NOT NULL
      AND confirmation_sent_at + interval '72 hours' <= at_time
    ORDER BY confirmation_sent_at, id LIMIT 200 FOR UPDATE
  LOOP
    -- Escalation is an operations flag, never homeowner confirmation.
    UPDATE public.service_requests SET needs_admin_review = true,
      confirmation_deadline_at = confirmation_sent_at + interval '72 hours'
      WHERE id = j.id;
    PERFORM public.log_job_event(j.id, 'flagged_for_admin_review', _actor_id,
      jsonb_build_object('run_id', _run_id, 'reason', 'homeowner_confirmation_unanswered',
        'lifecycle_version', 'phase4-v1', 'deadline', j.confirmation_sent_at + interval '72 hours'));
    FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
      PERFORM public.notify_user(admin_id, 'job_confirmation', 'warning',
        'Unconfirmed completion needs review',
        'The homeowner has not responded within 72 hours. Review the evidence and contact the parties; do not treat silence as confirmation.',
        '/admin/requests', j.id, j.contractor_id);
    END LOOP;
    PERFORM public.notify_user(j.customer_id, 'job_confirmation', 'info',
      'Your completed service is under review',
      'Mercurius will review the unanswered completion notice. You can still confirm or report an issue.',
      '/dashboard?confirm=' || j.id, j.id, j.contractor_id);
    flagged := flagged + 1;
  END LOOP;

  result := jsonb_build_object('ok', true, 'run_id', _run_id, 'ran_at', at_time,
    'quotes_expired',quotes_expired,'matches_expired', expired, 'confirmations_sent', notices, 'admin_flagged', flagged,
    'lifecycle_version', 'phase4-v1');
  INSERT INTO public.lifecycle_worker_runs(id, actor_id, summary) VALUES (_run_id, _actor_id, result);
  RETURN result;
END;
$$;
