-- TRACE-097: completion evidence integrity and completion lock order (Codex Phase 4 review
-- P4-R1 and P4-R2, 2026-09-26; MPS §6.4; DEC-2026-006; TRACE-055 wrapper unchanged).
--
-- P4-R1. Completion counted array slots: two NULL entries satisfied a two-photo rule, and no
-- check established that the named files existed or belonged to the job. Now:
-- 1. The canonical transition kernel verifies the stored references before any job reaches
--    vendor_completed, whichever caller asks. A reference counts only when it is non-blank,
--    distinct, and names a job-photos object at <uploader>/<this job>/..., owned by that
--    uploader, who is the job's assigned provider or an admin. The category minimum is
--    enforced on the verified count.
-- 2. The verified objects are recorded, per completion attempt, in the immutable
--    job_completion_evidence. A rework and a later completion add a new attempt; earlier
--    attempts stay.
-- 3. Recorded evidence cannot be deleted through Storage. The delete policy takes the job's
--    lifecycle advisory lock first, so a deletion either commits before a completion reads
--    the object (the completion then refuses) or waits and is then refused.
-- 4. The job's homeowner and assigned provider can read recorded evidence objects. Before
--    this, a homeowner could read only job_photos rows, which completion never wrote.
--
-- Legacy references: nothing is backfilled or rewritten. A job already past completion keeps
-- its stored photo_proof_urls and its history, and its homeowner confirmation is unchanged.
-- Such references are not recorded evidence, so they grant no new read access and are not
-- delete-protected. completion_evidence_unverified lists open jobs in that state for
-- operators. Any new move to vendor_completed, including after rework, needs verified proof.
--
-- P4-R2. vendor_complete_job read the job and wrote photo_proof_urls (the row lock) before
-- the transition took the per-request advisory lock, the reverse of every other lifecycle
-- command, so it could deadlock with an admin correction. It now takes the advisory lock and
-- then the row lock before reading, and re-checks the actor under them.
--
-- Service-role Storage calls bypass row-level security and so bypass item 3; no platform
-- code deletes job photos with the service key.

create table public.job_completion_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.service_requests(id),
  attempt integer not null check (attempt > 0),
  position integer not null check (position > 0),
  bucket_id text not null check (bucket_id = 'job-photos'),
  object_name text not null,
  object_id uuid not null,
  uploader_id uuid not null,
  minimum_photos integer not null check (minimum_photos > 0),
  rule_version integer not null check (rule_version >= 0),
  recorded_by uuid,
  recorded_at timestamptz not null default now(),
  unique (job_id, attempt, position),
  unique (job_id, attempt, object_name)
);
create index job_completion_evidence_object on public.job_completion_evidence(bucket_id, object_name);
comment on table public.job_completion_evidence is
  'TRACE-097: verified completion photos, one row per photo per completion attempt. Immutable.';

create function private.completion_evidence_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Completion evidence is immutable' using errcode='42501';
end $$;
create trigger immutable_evidence before update or delete on public.job_completion_evidence
  for each row execute function private.completion_evidence_immutable();

alter table public.job_completion_evidence enable row level security;
revoke all on public.job_completion_evidence from public, anon, authenticated;
grant select on public.job_completion_evidence to authenticated;
grant all on public.job_completion_evidence to service_role;
create policy "Job participants read completion evidence" on public.job_completion_evidence
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or exists (
      select 1 from public.service_requests sr
      left join public.contractors c on c.id = sr.contractor_id
      where sr.id = job_id and (sr.customer_id = auth.uid() or c.user_id = auth.uid())
    )
  );

-- Verifies a job's stored references. Returns one row: refusal is null when the references
-- satisfy the category's current minimum. Caller holds the job's advisory and row locks.
create function private.completion_evidence_check(p_job uuid, p_vendor_user uuid, p_service text, p_paths text[])
returns table (refusal text, message text, minimum_photos integer, rule_version integer)
language plpgsql stable security definer set search_path='' as $$
declare
  ref text;
  obj record;
  folder text[];
  uploader_ok boolean;
  verified integer := 0;
begin
  select r.minimum_photos, r.version into minimum_photos, rule_version
    from public.completion_evidence_rules r where r.service_id = p_service order by r.version desc limit 1;
  minimum_photos := coalesce(minimum_photos, 1);
  rule_version := coalesce(rule_version, 0);

  if coalesce(cardinality(p_paths), 0) = 0 then
    refusal := 'missing_photo_proof';
    message := 'Required completion photos are missing for this service';
    return next; return;
  end if;
  if exists (select 1 from unnest(p_paths) p where p is null or btrim(p) = '') then
    refusal := 'invalid_photo_reference';
    message := 'Each completion photo must be an uploaded file';
    return next; return;
  end if;
  if (select count(distinct p) from unnest(p_paths) p) <> cardinality(p_paths) then
    refusal := 'duplicate_photo_reference';
    message := 'The same completion photo cannot be counted twice';
    return next; return;
  end if;

  foreach ref in array p_paths loop
    select o.id, coalesce(to_jsonb(o) ->> 'owner_id', o.owner::text) as uploader into obj
      from storage.objects o where o.bucket_id = 'job-photos' and o.name = ref;
    if obj.id is null then
      refusal := 'photo_not_found';
      message := 'A completion photo was not found in storage. Upload it again';
      return next; return;
    end if;
    folder := storage.foldername(ref);
    if folder[2] is distinct from p_job::text then
      refusal := 'photo_wrong_job';
      message := 'A completion photo was uploaded for a different job';
      return next; return;
    end if;
    uploader_ok := obj.uploader is not null and folder[1] is not distinct from obj.uploader
      and obj.uploader ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    if uploader_ok and obj.uploader is distinct from p_vendor_user::text then
      uploader_ok := coalesce(public.has_role(obj.uploader::uuid, 'admin'::public.app_role), false);
    end if;
    if not uploader_ok then
      refusal := 'photo_wrong_uploader';
      message := 'A completion photo was not uploaded by this job''s provider';
      return next; return;
    end if;
    verified := verified + 1;
  end loop;

  if verified < minimum_photos then
    refusal := 'missing_photo_proof';
    message := format('This service requires at least %s completion photo%s', minimum_photos,
      case when minimum_photos = 1 then '' else 's' end);
  end if;
  return next;
end $$;

-- Records the verified references as the job's next completion attempt.
create function private.completion_evidence_record(p_job uuid, p_paths text[], p_minimum integer, p_rule_version integer)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare next_attempt integer;
begin
  select coalesce(max(e.attempt), 0) + 1 into next_attempt from public.job_completion_evidence e where e.job_id = p_job;
  insert into public.job_completion_evidence(job_id, attempt, position, bucket_id, object_name, object_id,
      uploader_id, minimum_photos, rule_version, recorded_by)
    select p_job, next_attempt, u.ord, o.bucket_id, o.name, o.id,
      (storage.foldername(o.name))[1]::uuid, p_minimum, p_rule_version, auth.uid()
    from unnest(p_paths) with ordinality u(ref, ord)
    join storage.objects o on o.bucket_id = 'job-photos' and o.name = u.ref;
  return next_attempt;
end $$;

revoke all on function private.completion_evidence_check(uuid, uuid, text, text[]),
  private.completion_evidence_record(uuid, text[], integer, integer),
  private.completion_evidence_immutable()
  from public, anon, authenticated, service_role;

-- The canonical kernel (TRACE-055 moved it to private; the public wrapper is unchanged).
-- Changes from 20260904004500: the evidence guard calls completion_evidence_check, the
-- verified objects are recorded after the status update, and the completion event carries
-- the attempt number. Everything else is the existing definition.
CREATE OR REPLACE FUNCTION private.transition_job_status(_job_id uuid, _to_status request_status, _reason text DEFAULT NULL::text, _metadata jsonb DEFAULT NULL::jsonb)
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
  proof record;
  evidence_rule_version integer;
  evidence_attempt integer;
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
      AND actor_id=auth.uid() AND created_at BETWEEN now()-interval '5 minutes' AND now()) THEN
    RAISE EXCEPTION 'Record cancellation policy before cancelling this service' USING ERRCODE='42501';
  END IF;
  -- Guard: completion proof is mandatory. TRACE-097: only distinct stored objects for this
  -- job, uploaded by its assigned provider or an admin, count toward the category minimum.
  IF _to_status = 'vendor_completed' THEN
    SELECT * INTO proof FROM private.completion_evidence_check(_job_id, vendor_user, j.service_catalog_id, j.photo_proof_urls);
    IF proof.refusal IS NOT NULL THEN
      PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text,
        proof.refusal, _metadata);
      RAISE EXCEPTION '%', proof.message
        USING ERRCODE = CASE WHEN proof.refusal = 'missing_photo_proof' THEN 'P0001' ELSE '22023' END;
    END IF;
    evidence_rule_version := proof.rule_version;
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

  IF _to_status = 'vendor_completed' THEN
    evidence_attempt := private.completion_evidence_record(_job_id, j.photo_proof_urls, proof.minimum_photos, proof.rule_version);
  END IF;

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
    COALESCE(_metadata, '{}'::jsonb) || jsonb_build_object('from', j.status, 'to', _to_status, 'actor', actor, 'reason', _reason, 'lifecycle_version', 'phase4-v1', 'completion_rule_version', CASE WHEN _to_status='vendor_completed' THEN evidence_rule_version ELSE NULL END, 'completion_evidence_attempt', evidence_attempt)
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
revoke all on function private.transition_job_status(uuid, public.request_status, text, jsonb)
  from public, anon, authenticated, service_role;

-- P4-R2: lifecycle lock order (per-request advisory lock, then the row) before reading.
CREATE OR REPLACE FUNCTION public.vendor_complete_job(_job_id uuid, _photo_urls text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT sr.*, c.user_id AS vendor_user_id INTO j
  FROM public.service_requests sr
  LEFT JOIN public.contractors c ON c.id = sr.contractor_id
  WHERE sr.id = _job_id
  FOR UPDATE OF sr;

  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
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
revoke all on function public.vendor_complete_job(uuid, text[]) from public, anon;
grant execute on function public.vendor_complete_job(uuid, text[]) to authenticated;

-- Storage delete policy. Volatile, and takes the job's lifecycle advisory lock before reading
-- evidence, so it serializes with completion. Only answers for job-photos objects.
create function public.job_photo_delete_allowed(p_bucket text, p_name text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare job text := (storage.foldername(p_name))[2];
begin
  if p_bucket is distinct from 'job-photos' then return true; end if;
  if job ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform pg_advisory_xact_lock(hashtextextended(job::uuid::text, 0));
  end if;
  return not exists (select 1 from public.job_completion_evidence e where e.bucket_id = p_bucket and e.object_name = p_name);
end $$;

create function public.job_completion_evidence_visible(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.job_completion_evidence e
    join public.service_requests sr on sr.id = e.job_id
    left join public.contractors c on c.id = sr.contractor_id
    where e.bucket_id = p_bucket and e.object_name = p_name
      and (sr.customer_id = auth.uid() or c.user_id = auth.uid())
  )
$$;

revoke all on function public.job_photo_delete_allowed(text, text),
  public.job_completion_evidence_visible(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.job_photo_delete_allowed(text, text),
  public.job_completion_evidence_visible(text, text)
  to authenticated;

create policy "Completion evidence is retained" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'job-photos' or public.job_photo_delete_allowed(bucket_id, name));
create policy "Job participants can view completion evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'job-photos' and public.job_completion_evidence_visible(bucket_id, name));

-- Operator readback: open completions whose stored references were never verified.
create function public.completion_evidence_unverified()
returns table (job_id uuid, status public.request_status, vendor_completed_at timestamptz, reference_count integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'::public.app_role), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
    select sr.id, sr.status, sr.vendor_completed_at, coalesce(cardinality(sr.photo_proof_urls), 0)
    from public.service_requests sr
    where sr.status in ('vendor_completed', 'pending_review', 'disputed')
      and not exists (select 1 from public.job_completion_evidence e where e.job_id = sr.id)
    order by sr.vendor_completed_at nulls last, sr.id;
end $$;
revoke all on function public.completion_evidence_unverified() from public, anon, authenticated, service_role;
grant execute on function public.completion_evidence_unverified() to authenticated;
