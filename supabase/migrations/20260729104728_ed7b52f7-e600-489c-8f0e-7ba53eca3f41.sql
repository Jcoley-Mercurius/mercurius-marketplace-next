-- 1. Columns for match lifecycle
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS match_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_match_expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_contractor_ids uuid[] NOT NULL DEFAULT '{}';
-- 2. Event types
ALTER TYPE public.job_event_type ADD VALUE IF NOT EXISTS 'match_offered';
ALTER TYPE public.job_event_type ADD VALUE IF NOT EXISTS 'match_declined';
ALTER TYPE public.job_event_type ADD VALUE IF NOT EXISTS 'match_expired';
ALTER TYPE public.job_event_type ADD VALUE IF NOT EXISTS 'match_reassigned';
-- 3. Match attempt history
CREATE TABLE IF NOT EXISTS public.job_match_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL DEFAULT 1,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  responded_at timestamptz,
  outcome text NOT NULL DEFAULT 'pending',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jma_request ON public.job_match_attempts(service_request_id);
CREATE INDEX IF NOT EXISTS idx_jma_contractor ON public.job_match_attempts(contractor_id);
GRANT SELECT ON public.job_match_attempts TO authenticated;
GRANT ALL ON public.job_match_attempts TO service_role;
ALTER TABLE public.job_match_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage match attempts"
  ON public.job_match_attempts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants can view match attempts"
  ON public.job_match_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.service_requests sr
             WHERE sr.id = service_request_id AND sr.customer_id = auth.uid())
    OR contractor_id IN (SELECT c.id FROM public.contractors c WHERE c.user_id = auth.uid())
  );
CREATE TRIGGER trg_jma_updated_at BEFORE UPDATE ON public.job_match_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- 4. Stamp a response deadline + attempt row whenever a vendor is matched
CREATE OR REPLACE FUNCTION public.set_assigned_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.contractor_id IS NULL AND NEW.contractor_id IS NOT NULL THEN
    NEW.assigned_at = now();
    NEW.match_attempt_count = COALESCE(OLD.match_attempt_count, 0) + 1;
    IF NEW.match_expires_at IS NULL THEN
      NEW.match_expires_at = now() + interval '24 hours';
    END IF;
  END IF;

  IF NEW.contractor_id IS NULL THEN
    NEW.assigned_at = NULL;
    NEW.match_expires_at = NULL;
  END IF;

  -- Once the vendor accepts (or the job moves past matched), the clock stops.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'matched' THEN
    NEW.match_expires_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.record_match_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_user uuid;
BEGIN
  IF NEW.contractor_id IS NOT NULL AND OLD.contractor_id IS DISTINCT FROM NEW.contractor_id THEN
    -- close any lingering open attempt
    UPDATE public.job_match_attempts
       SET outcome = 'reassigned', responded_at = now()
     WHERE service_request_id = NEW.id AND outcome = 'pending';

    INSERT INTO public.job_match_attempts
      (service_request_id, contractor_id, attempt_number, expires_at)
    VALUES (NEW.id, NEW.contractor_id, NEW.match_attempt_count, NEW.match_expires_at);

    PERFORM public.log_job_event(NEW.id, 'match_offered', auth.uid(),
      jsonb_build_object('contractor_id', NEW.contractor_id, 'attempt', NEW.match_attempt_count,
                         'expires_at', NEW.match_expires_at));

    SELECT user_id INTO v_user FROM public.contractors WHERE id = NEW.contractor_id;
    IF v_user IS NOT NULL THEN
      PERFORM public.notify_user(v_user, 'job_offer', 'warning',
        'New job offer — respond within 24 hours',
        'A ' || NEW.service_type || ' job was matched to you. Accept or decline before the window closes.',
        '/vendor/requests', NEW.id, NEW.contractor_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_record_match_offer ON public.service_requests;
CREATE TRIGGER trg_record_match_offer AFTER UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_match_offer();
-- 5. Shared: return a job to the unmatched pool
CREATE OR REPLACE FUNCTION public.release_job_match(
  _job_id uuid, _contractor_id uuid, _outcome text, _reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE j record; admin_id uuid; bounced integer;
BEGIN
  SELECT * INTO j FROM public.service_requests WHERE id = _job_id;
  IF j IS NULL THEN RETURN; END IF;

  UPDATE public.job_match_attempts
     SET outcome = _outcome, reason = _reason, responded_at = now()
   WHERE service_request_id = _job_id AND contractor_id = _contractor_id AND outcome = 'pending';

  UPDATE public.service_requests
     SET contractor_id = NULL,
         status = 'pending',
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

  -- Homeowner stays informed
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
REVOKE EXECUTE ON FUNCTION public.release_job_match(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
-- 6. Vendor decline
CREATE OR REPLACE FUNCTION public.vendor_decline_job(_job_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE j record;
BEGIN
  SELECT sr.*, c.user_id AS vendor_user_id INTO j
    FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
   WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'Job not found or not assigned'; END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR j.vendor_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF j.status NOT IN ('matched', 'pending') THEN
    RAISE EXCEPTION 'This job can no longer be declined';
  END IF;

  PERFORM public.release_job_match(_job_id, j.contractor_id, 'declined', _reason);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vendor_decline_job(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_decline_job(uuid, text) TO authenticated;
-- 7. Vendor accept (guards against acting on an expired/reassigned match)
CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    RAISE EXCEPTION 'Your response window for this job has expired';
  END IF;

  UPDATE public.service_requests
     SET status = 'scheduled', match_expires_at = NULL, updated_at = now()
   WHERE id = _job_id AND status = 'matched';

  UPDATE public.job_match_attempts
     SET outcome = 'accepted', responded_at = now()
   WHERE service_request_id = _job_id AND contractor_id = j.contractor_id AND outcome = 'pending';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.vendor_accept_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_accept_job(uuid) TO authenticated;
-- 8. Expire stale matches (called by the scheduled worker)
CREATE OR REPLACE FUNCTION public.expire_stale_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id, contractor_id FROM public.service_requests
     WHERE status = 'matched'
       AND contractor_id IS NOT NULL
       AND match_expires_at IS NOT NULL
       AND match_expires_at < now()
     LIMIT 200
  LOOP
    PERFORM public.release_job_match(r.id, r.contractor_id, 'expired', 'No vendor response within the window');
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.expire_stale_matches() FROM PUBLIC, anon, authenticated;
-- 9. Vendors must not see jobs they no longer hold; also allow the vendor-scope
--    trigger to keep working for accepted jobs (unchanged) — decline/accept now
--    go through the SECURITY DEFINER RPCs above.;
