-- TRACE-010: no Cron registration or activation. One transactional batch owns
-- state + in-app notification + audit. A failed write rolls back the whole batch.
CREATE TABLE public.lifecycle_worker_runs (
  id uuid PRIMARY KEY,
  actor_id uuid,
  completed_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL
);
ALTER TABLE public.lifecycle_worker_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lifecycle_worker_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.lifecycle_worker_runs TO authenticated;
CREATE POLICY "Admins inspect lifecycle runs" ON public.lifecycle_worker_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT ALL ON public.lifecycle_worker_runs TO service_role;

CREATE OR REPLACE FUNCTION public.run_lifecycle_batch(_run_id uuid, _actor_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp AS $$
DECLARE
  j record;
  admin_id uuid;
  result jsonb;
  expired integer := 0;
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

  expired := public.expire_stale_matches();

  -- Legacy pending completion rows receive a notice before any escalation.
  -- New transitions send the same notice atomically at vendor completion.
  FOR j IN SELECT * FROM public.service_requests
    WHERE status = 'vendor_completed' AND confirmation_sent_at IS NULL
      AND confirmation_due_at <= now()
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
    'matches_expired', expired, 'confirmations_sent', notices, 'admin_flagged', flagged,
    'lifecycle_version', 'phase4-v1');
  INSERT INTO public.lifecycle_worker_runs(id, actor_id, summary) VALUES (_run_id, _actor_id, result);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.run_lifecycle_batch(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_lifecycle_batch(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.run_lifecycle_batch(uuid, uuid) IS
  'Inactive scheduler implementation: atomic expiry and 72-hour admin escalation. No automatic confirmation, payment, review solicitation or unapproved reminder timers.';
