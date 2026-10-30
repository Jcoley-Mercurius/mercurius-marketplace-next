-- Phase 6.9A / TRACE-131: exception repairs that approved rules already require.
--
-- CFG-006/007, CFG-008, MPS §1/§6.6, DEC-2026-049 items 4 and 8, DEC-2026-053 E1/E10/E12 (approved
-- 2026-10-30). Additive. No money moves here: no charge, refund, payout, collection or provider call,
-- and no function in the money fingerprint is changed. Refunds stay with the two-person reviewed
-- kernel (TRACE-056/057).
--
-- 1. A request reaches 'cancelled' only with evidence bound to the same transaction, request, actor
--    and record: the customer_cancel operation (record_job_operation) or the no-replacement decision
--    (record_provider_replacement_decision). A trigger enforces it for every writer, including the
--    service role and definer RPCs; the kernel's five-minute window is removed. Direct database
--    sessions may set mercurius.owner_maintenance for owner maintenance; API sessions never can.
-- 2. record_job_operation: one assessment source shared with the new preview; a stale guard
--    (_expected); accepted recurring plans refuse visit commands (they use the plan controls); a
--    homeowner cannot cancel started work (E1); no recorded appointment refunds 100% (E1); a
--    cancellation while a provider withdrawal awaits a replacement refunds 100% (E12); the payment
--    state at cancellation (captured funds, open checkout attempts) is kept in the immutable record.
-- 3. Plan visits do not rematch to replacement providers, and a replacement reconciliation for a plan
--    visit is refused (DEC-2026-049 item 8): no accepted snapshot moves to another provider.
-- 4. Reads: job_cancellation_preview, job_cancellation_outcome (policy entitlement, refund
--    authorization and money movement kept apart), admin_cancellation_queue, and
--    admin_provider_quality_events (record and display only, E10).

-- 1. Cancellation evidence -------------------------------------------------------------------------

-- Owner maintenance from a direct database session (migrations, owner SQL, test fixtures). API
-- clients connect as authenticator and cannot set custom settings, so this never opens for them.
create function private.owner_maintenance() returns boolean
language sql stable set search_path = '' as $$
  select session_user::text <> 'authenticator'
    and coalesce(current_setting('mercurius.owner_maintenance', true), '') = 'on'
$$;

-- Evidence is '<request>:operation:<id>' or '<request>:decision:<id>', set transaction-locally by the
-- command that wrote the record. It must name this request, a record of the right kind created in
-- this transaction by the current actor, and is consumed on use.
create function private.guard_cancellation_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
declare parts text[] := string_to_array(coalesce(current_setting('mercurius.cancel_evidence', true), ''), ':');
  record_id uuid;
begin
  if private.owner_maintenance() then return new; end if;
  if cardinality(parts) = 3 and parts[1] = new.id::text
     and parts[3] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    record_id := parts[3]::uuid;
    if (parts[2] = 'operation' and exists(select 1 from public.job_operations o where o.id = record_id
          and o.job_id = new.id and o.kind = 'customer_cancel' and o.actor_id = auth.uid() and o.created_at = now()))
       or (parts[2] = 'decision' and exists(select 1 from public.money_provider_replacement_decisions d
          join public.job_operations o on o.id = d.operation_id where d.id = record_id and o.job_id = new.id
          and d.outcome = 'no_replacement' and d.actor_id = auth.uid() and d.created_at = now())) then
      perform set_config('mercurius.cancel_evidence', '', true);
      return new;
    end if;
  end if;
  raise exception 'Cancel this service through its cancellation command' using errcode = '42501';
end $$;
create trigger guard_cancellation_evidence before update of status on public.service_requests
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function private.guard_cancellation_evidence();

-- 2. Accepted recurring plans ----------------------------------------------------------------------

-- A plan is accepted once its terms are recorded or it has visits. Before that it is an ordinary
-- request and keeps one-time behavior.
create function private.is_accepted_recurring_plan(p_request public.service_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_request.id is not null and p_request.recurrence_parent_id is null
    and p_request.frequency is not null and p_request.frequency <> 'one-time'
    and (exists(select 1 from private.recurring_series_terms t where t.series_id = p_request.id)
      or exists(select 1 from public.service_requests v where v.recurrence_parent_id = p_request.id))
$$;

-- Plans change only through the existing plan controls (pause, resume, stop future visits; DEC-2026-049
-- item 4), which never change the plan's own status. Each visit is cancelled or replaced on its own.
create function private.guard_recurring_plan_exceptions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.owner_maintenance() or not private.is_accepted_recurring_plan(old) then return new; end if;
  raise exception 'A recurring plan is changed with Stop future visits; each visit is handled on its own'
    using errcode = '22023';
end $$;
create trigger guard_recurring_plan_exceptions before update of status on public.service_requests
  for each row when (new.recurrence_parent_id is null and new.frequency is not null and new.frequency <> 'one-time'
    and old.status is distinct from new.status and new.status in ('cancelled', 'pending', 'matched', 'quoted'))
  execute function private.guard_recurring_plan_exceptions();

-- 3. Plan visits keep their provider (DEC-2026-049 item 8) -------------------------------------------

create function private.guard_recurring_replacement_reconciliation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.money_obligations o join public.service_requests r on r.id = o.service_request_id
      where o.id = new.obligation_id and r.recurrence_parent_id is not null) then
    raise exception 'A plan visit is paid only to the plan''s provider; a replacement provider is not set up (DEC-2026-049 item 8)'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_recurring_replacement_reconciliation before insert on public.money_replacement_reconciliations
  for each row execute function private.guard_recurring_replacement_reconciliation();

-- 4. Shared assessment, refusal and stale state ----------------------------------------------------

-- A provider withdrawal (provider_cancel, or an operations no-show) is open while no replacement has
-- accepted and no decision has ended it.
create function private.provider_withdrawal_open(p_request public.service_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_request.matching_status, '') <> 'matched' and exists(
    select 1 from public.job_operations o where o.job_id = p_request.id
      and (o.kind = 'provider_cancel' or (o.kind = 'no_show' and coalesce(public.has_role(o.actor_id, 'admin'), false)))
      and not exists(select 1 from public.money_provider_replacement_decisions d
        where d.operation_id = o.id and d.outcome = 'no_replacement'))
$$;

-- The payment facts a cancellation must keep: captured funds and any checkout still open.
create function private.job_payment_state(p_request uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'obligation_id', o.id, 'snapshot_id', o.current_snapshot_id, 'captured', coalesce(o.captured, 0),
    'total', s.total, 'refunded', coalesce(o.refunded_service + o.refunded_tax + o.refunded_tip, 0),
    'legacy_payment_status', r.payment_status,
    'open_attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status, 'mode', a.mode,
        'amount', a.amount, 'expires_at', a.expires_at) order by a.attempt_number)
      from public.money_checkout_attempts a where a.obligation_id = o.id
        and a.status in ('prepared', 'session_created', 'reconcile')), '[]'::jsonb),
    'accepted_quote', r.quote_approved_at is not null)
  from public.service_requests r
  left join public.money_obligations o on o.service_request_id = r.id
  left join public.money_snapshots s on s.id = o.current_snapshot_id
  where r.id = p_request
$$;

-- The one CFG-006/007 assessment, used by record_job_operation and job_cancellation_preview.
create function private.job_operation_assessment(p_request public.service_requests, p_kind text, p_waived boolean,
  p_scheduled_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare hours numeric := extract(epoch from (p_request.scheduled_start_at - now())) / 3600;
  base jsonb := jsonb_build_object('policy', 'CFG-006/007', 'waived', p_waived, 'new_start', p_scheduled_at,
    'money_action', 'none', 'requires_operations', p_request.scheduled_start_at is null,
    'appointment', p_request.scheduled_start_at, 'hours_before', round(hours, 2));
begin
  if p_kind = 'customer_cancel' then
    return base || case
      when p_waived then jsonb_build_object('refund_percent', 100, 'basis', 'exception_accepted', 'requires_operations', false)
      -- DEC-2026-053 E12: the provider left and no replacement is in place.
      when private.provider_withdrawal_open(p_request) then
        jsonb_build_object('refund_percent', 100, 'basis', 'provider_withdrawal_open', 'requires_operations', false)
      -- DEC-2026-053 E1: no provider time was reserved.
      when p_request.scheduled_start_at is null then
        jsonb_build_object('refund_percent', 100, 'basis', 'no_appointment', 'requires_operations', false)
      when hours >= 72 then jsonb_build_object('refund_percent', 100, 'basis', 'notice_72_hours_or_more')
      when hours >= 24 then jsonb_build_object('refund_percent', 50, 'basis', 'notice_24_to_72_hours')
      else jsonb_build_object('refund_percent', 0, 'basis', 'notice_under_24_hours') end;
  elsif p_kind = 'reschedule_request' then
    return base || jsonb_build_object('fee', case when p_waived or hours >= 48 then 0 when hours >= 24 then 25 else null end,
      'requires_operations', true);
  elsif p_kind in ('provider_cancel', 'no_show') then
    return base || jsonb_build_object('next_action', 'rematch_first', 'refund_if_no_acceptable_replacement', 100,
      'quality_event', not p_waived, 'requires_operations', true,
      'replacement_providers', p_request.recurrence_parent_id is null);
  end if;
  return base;
end $$;

-- Why an actor may not record this operation now, or null. Shared by the command and the preview.
create function private.job_operation_refusal(p_request public.service_requests, p_kind text, p_waived boolean,
  p_admin boolean, p_owner boolean, p_vendor boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_request.id is null or not (p_admin or p_owner or p_vendor) then
    return jsonb_build_object('code', 'not_participant', 'errcode', '42501', 'message', 'Not a participant in this service');
  end if;
  if p_kind is null or p_kind not in ('customer_cancel', 'reschedule_request', 'provider_cancel', 'no_show',
      'partial_completion', 'customer_unavailable', 'unable_to_complete') then
    return jsonb_build_object('code', 'unknown', 'errcode', '22023', 'message', 'Unknown job operation');
  end if;
  if coalesce(p_waived, false) and not p_admin then
    return jsonb_build_object('code', 'waiver_admin_only', 'errcode', '42501', 'message', 'Only operations may accept an exception');
  end if;
  if (p_kind = 'customer_cancel' and not (p_owner or p_admin))
     or (p_kind in ('provider_cancel', 'partial_completion', 'customer_unavailable', 'unable_to_complete') and not (p_vendor or p_admin)) then
    return jsonb_build_object('code', 'actor', 'errcode', '42501', 'message', 'Actor cannot perform this operation');
  end if;
  if private.is_accepted_recurring_plan(p_request) then
    return jsonb_build_object('code', 'recurring_plan', 'errcode', '22023',
      'message', 'Changes are made on each visit. Mercurius can stop future visits on the plan.');
  end if;
  if p_request.status not in ('pending', 'matched', 'quoted', 'scheduled', 'in_progress') then
    return jsonb_build_object('code', 'closed', 'errcode', '22023', 'message', 'Service no longer accepts this operation');
  end if;
  -- DEC-2026-053 E1: once work has started the homeowner reports an issue and operations decides.
  if p_kind = 'customer_cancel' and p_request.status = 'in_progress' and not p_admin then
    return jsonb_build_object('code', 'work_started', 'errcode', '22023',
      'message', 'Work has started, so this can''t be cancelled here. Report an issue and Mercurius will decide what happens next.');
  end if;
  return null;
end $$;

-- What a preview showed; a different value at confirmation is a stale read.
create function private.job_operation_expected(p_request public.service_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', p_request.status, 'contractor_id', p_request.contractor_id,
    'scheduled_start_at', p_request.scheduled_start_at,
    'operation_seq', (select max(o.seq) from public.job_operations o where o.job_id = p_request.id))
$$;

-- 5. Exception command -----------------------------------------------------------------------------

-- Restated from 20261024002000 with the changes listed at the top. _expected is optional so older
-- clients still reach the command; actions the repaired rules refuse are refused for them too.
drop function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean);
create function public.record_job_operation(_job_id uuid, _operation_key uuid, _kind text, _reason text,
  _scheduled_at timestamptz default null, _waived boolean default false, _expected jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; prior public.job_operations; is_admin boolean; is_owner boolean; is_vendor boolean;
  refusal jsonb; assessment jsonb; payment jsonb; op_id uuid; next_offer uuid; recipient uuid; visit boolean;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_owner := coalesce(r.customer_id = auth.uid(), false);
  is_vendor := exists(select 1 from public.contractors where id = r.contractor_id and user_id = auth.uid());
  if r.id is null or not (is_admin or is_owner or is_vendor) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  if _waived is null or _operation_key is null or nullif(btrim(_reason), '') is null then
    raise exception 'Operation key and reason required' using errcode = '22023';
  end if;
  if _kind = 'appointment' then raise exception 'Record appointments with admin_record_appointment' using errcode = '22023'; end if;
  -- A retry of a recorded operation returns it, whatever has happened since.
  select * into prior from public.job_operations where job_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if (prior.policy_assessment->>'waived')::boolean is distinct from _waived or prior.actor_id <> auth.uid()
      or prior.kind <> _kind or prior.reason <> btrim(_reason)
      or (prior.policy_assessment->>'new_start')::timestamptz is distinct from _scheduled_at then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return prior.policy_assessment || jsonb_build_object('operation_id', prior.id);
  end if;
  if _expected is not null and _expected is distinct from private.job_operation_expected(r) then
    raise exception 'This service changed since you opened it. Review the current details and try again.' using errcode = '40001';
  end if;
  refusal := private.job_operation_refusal(r, _kind, _waived, is_admin, is_owner, is_vendor);
  if refusal is not null then raise exception '%', refusal->>'message' using errcode = refusal->>'errcode'; end if;
  if _kind = 'reschedule_request' and (_scheduled_at is null or _scheduled_at <= now()) then
    raise exception 'Proposed future appointment required' using errcode = '22023';
  end if;
  -- Lock order: request, then obligation (as checkout and payout do). The capture webhook takes only
  -- the obligation, so a capture in flight finishes first and is recorded below.
  perform 1 from public.money_obligations where service_request_id = r.id for share;
  payment := private.job_payment_state(r.id);
  visit := r.recurrence_parent_id is not null;
  assessment := private.job_operation_assessment(r, _kind, _waived, _scheduled_at)
    || jsonb_build_object('payment_at_operation', jsonb_build_object('captured', payment->'captured',
      'open_checkout', jsonb_array_length(payment->'open_attempts') > 0));
  insert into public.job_operations(job_id, operation_key, actor_id, kind, reason, before_value, policy_assessment)
    values (r.id, _operation_key, auth.uid(), _kind, btrim(_reason),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at,
        'matching_status', r.matching_status, 'commercial', payment),
      assessment) returning id into op_id;
  if _kind = 'customer_cancel' then
    perform set_config('mercurius.cancel_evidence', r.id::text || ':operation:' || op_id::text, true);
    perform public.transition_job_status(r.id, 'cancelled', btrim(_reason),
      jsonb_build_object('operation_key', _operation_key, 'operation_id', op_id, 'policy_assessment', assessment));
  elsif _kind = 'provider_cancel' or (_kind = 'no_show' and is_admin) then
    update public.job_match_attempts set outcome = 'withdrawn', withdrawn_at = now(), reason = btrim(_reason)
      where service_request_id = r.id and outcome = 'pending';
    -- A plan visit is not offered to other providers (DEC-2026-049 item 8); operations decides.
    update public.service_requests set contractor_id = null, status = 'pending',
      matching_status = case when visit then 'exhausted' else 'awaiting_match' end,
      assigned_at = null, match_expires_at = null where id = r.id;
    if not visit then next_offer := private.offer_next_for_request_internal(r.id); end if;
  end if;
  if _kind <> 'customer_cancel' then
    update public.service_requests set needs_admin_review = true where id = r.id;
    insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
      values (r.customer_id, 'Service operation: ' || replace(_kind, '_', ' '), btrim(_reason), 'schedule_exception', r.id::text,
        case when _kind in ('provider_cancel', 'no_show') and visit then
            'Plan visits are not given to replacement providers (DEC-2026-049 item 8). Record no replacement to refund in full, or add a new visit with the plan provider'
          when _kind in ('provider_cancel', 'no_show') then 'Find an acceptable replacement; assess full refund if none is available'
          else 'Review evidence, policy and proposed next step' end);
  end if;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', _kind,
    'operation_key', _operation_key, 'operation_id', op_id, 'reason', btrim(_reason), 'assessment', assessment));
  for recipient in select r.customer_id union select user_id from public.contractors where id = r.contractor_id
      union select user_id from public.user_roles where role = 'admin' loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info', 'Service update',
        replace(_kind, '_', ' ') || ': ' || btrim(_reason), '/notifications', r.id, r.contractor_id);
    end if;
  end loop;
  return assessment || jsonb_build_object('operation_id', op_id);
end $$;
revoke all on function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean, jsonb) from public, anon;
grant execute on function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean, jsonb) to authenticated;

-- 6. Restated with only the marked TRACE-131 changes ------------------------------------------------

-- Kernel (from 20260926003000): the five-minute same-actor window is replaced by same-transaction evidence.
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

  -- TRACE-131: cancellation needs evidence written in this transaction by the cancellation command
  -- (record_job_operation or record_provider_replacement_decision); the row trigger
  -- guard_cancellation_evidence checks the record itself for every writer.
  IF _to_status='cancelled' AND NOT private.owner_maintenance()
     AND split_part(coalesce(current_setting('mercurius.cancel_evidence', true), ''), ':', 1) IS DISTINCT FROM _job_id::text THEN
    PERFORM public.log_status_rejection(_job_id, j.status::text, _to_status::text, 'cancellation_command_required', _metadata);
    RAISE EXCEPTION 'Cancel this service through its cancellation command' USING ERRCODE='42501';
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

-- From 20260905013000: plan visits are not re-offered, and a no-replacement decision cancels with its evidence.
CREATE OR REPLACE FUNCTION public.record_provider_replacement_decision(p_operation uuid, p_key uuid, p_reason text)
 RETURNS money_provider_replacement_decisions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op public.job_operations; r public.service_requests;
  prior public.money_provider_replacement_decisions; result public.money_provider_replacement_decisions;
  offer uuid; decision_outcome text; evidence jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(),'admin'),false) then
    raise exception 'Operations authority required' using errcode='42501';
  end if;
  if p_key is null or nullif(btrim(p_reason),'') is null then
    raise exception 'Decision key and reason required';
  end if;
  select * into strict op from public.job_operations where id=p_operation;
  if op.kind not in ('provider_cancel','no_show') then raise exception 'Provider cancellation or no-show required'; end if;
  if op.policy_assessment->>'next_action' is distinct from 'rematch_first'
    or op.policy_assessment->>'refund_if_no_acceptable_replacement' is distinct from '100' then
    raise exception 'Approved provider assessment required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text,0));
  select * into strict r from public.service_requests where id=op.job_id for update;
  select * into prior from public.money_provider_replacement_decisions
    where operation_id=p_operation and decision_key=p_key;
  if found then
    if prior.actor_id<>auth.uid() or prior.reason<>btrim(p_reason) then
      raise exception 'Replacement decision idempotency conflict';
    end if;
    return prior;
  end if;
  -- The canonical admin no-show operation releases the original assignment.
  -- A participant report alone must not refund an assigned, unfinished job.
  if op.kind='no_show' and not coalesce(public.has_role(op.actor_id,'admin'),false) then
    raise exception 'Operations-confirmed no-show required';
  end if;
  if r.status not in ('pending','matched','quoted','scheduled') then
    raise exception 'Service no longer accepts replacement decisions';
  end if;
  -- TRACE-131: a plan visit is not offered to replacement providers (DEC-2026-049 item 8).
  if r.status='pending' and r.contractor_id is null and r.recurrence_parent_id is null then
    offer:=private.offer_next_for_request_internal(r.id);
    select * into strict r from public.service_requests where id=op.job_id;
  end if;
  if r.contractor_id is not null or exists(select 1 from public.job_match_attempts
      where service_request_id=r.id and outcome='pending') then
    decision_outcome:='replacement_active';
  elsif r.status='pending' and r.matching_status='awaiting_consent' then
    decision_outcome:='awaiting_consent';
  elsif r.status='pending' and r.matching_status='exhausted' then
    decision_outcome:='no_replacement';
  else
    raise exception 'Canonical replacement outcome required';
  end if;
  select jsonb_build_object('status',r.status,'matching_status',r.matching_status,
    'contractor_id',r.contractor_id,'offer_id',offer,'attempts',coalesce(jsonb_agg(
      jsonb_build_object('id',a.id,'contractor_id',a.contractor_id,'outcome',a.outcome,
        'offered_at',a.offered_at,'responded_at',a.responded_at) order by a.offered_at,a.id)
      filter(where a.id is not null),'[]'::jsonb)) into evidence
    from public.job_match_attempts a where a.service_request_id=r.id;
  insert into public.money_provider_replacement_decisions(operation_id,decision_key,actor_id,reason,outcome,matching_evidence)
    values(op.id,p_key,auth.uid(),btrim(p_reason),decision_outcome,evidence) returning * into result;
  if decision_outcome='no_replacement' then
    perform set_config('mercurius.cancel_evidence', r.id::text || ':decision:' || result.id::text, true);
    perform public.transition_job_status(r.id,'cancelled',btrim(p_reason),
      jsonb_build_object('replacement_decision_id',result.id,'operation_id',op.id,'policy','CFG-007'));
  end if;
  perform public.log_job_event(r.id,'status_changed',auth.uid(),jsonb_build_object(
    'action','replacement_decision','decision_id',result.id,'outcome',decision_outcome,'reason',btrim(p_reason)));
  return result;
end $function$;

-- 7. Reads -------------------------------------------------------------------------------------------

-- Preview of an exception before it is confirmed: the same refusal and assessment the command uses,
-- the state to send back as _expected, and (homeowner and operations only) the payment facts.
create function public.job_cancellation_preview(_job_id uuid, _kind text default 'customer_cancel',
  _waived boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; is_admin boolean; is_owner boolean; is_vendor boolean; refusal jsonb; payment jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_owner := coalesce(r.customer_id = auth.uid(), false);
  is_vendor := exists(select 1 from public.contractors where id = r.contractor_id and user_id = auth.uid());
  if r.id is null or not (is_admin or is_owner or is_vendor) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  refusal := private.job_operation_refusal(r, _kind, coalesce(_waived, false), is_admin, is_owner, is_vendor);
  payment := private.job_payment_state(r.id);
  return jsonb_build_object('job_id', r.id, 'kind', _kind, 'allowed', refusal is null,
    'refusal', refusal - 'errcode', 'expected', private.job_operation_expected(r),
    'plan', private.is_accepted_recurring_plan(r), 'visit', r.recurrence_parent_id is not null,
    'assessment', case when refusal is null then private.job_operation_assessment(r, _kind, coalesce(_waived, false), null) end,
    'payment', case when is_admin or is_owner then jsonb_build_object('captured', payment->'captured',
      'total', payment->'total', 'open_checkout', jsonb_array_length(payment->'open_attempts') > 0) end);
end $$;

-- The cancellation outcome in three separate layers, never inferred from the request status alone:
-- entitlement (what the policy gives back), authorization (reviewed refunds recorded) and movement
-- (what the payment provider has reported). "settled" needs a recorded provider refund event.
create function private.job_cancellation_state(p_request uuid, p_amounts boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; cancel_op public.job_operations; provider_op public.job_operations;
  decision public.money_provider_replacement_decisions; o public.money_obligations; s public.money_snapshots;
  pct integer; basis text; entitlement_state text; amount bigint := 0; captured bigint := 0; cancelled_at timestamptz;
  authorized bigint := 0; released bigint := 0; settled bigint := 0; in_flight bigint := 0; failed bigint := 0;
  unknown bigint := 0; not_sent bigint := 0; movement_state text; authorization_state text; items jsonb := '[]'::jsonb;
  open_attempts integer := 0; late_capture bigint := 0; withdrawal boolean;
begin
  select * into strict r from public.service_requests where id = p_request;
  select * into cancel_op from public.job_operations where job_id = r.id and kind = 'customer_cancel' order by seq desc limit 1;
  select * into provider_op from public.job_operations where job_id = r.id
    and (kind = 'provider_cancel' or (kind = 'no_show' and coalesce(public.has_role(actor_id, 'admin'), false)))
    order by seq desc limit 1;
  if provider_op.id is not null then
    select * into decision from public.money_provider_replacement_decisions where operation_id = provider_op.id
      order by created_at desc, id desc limit 1;
  end if;
  select * into o from public.money_obligations where service_request_id = r.id;
  if o.id is not null then
    select * into s from public.money_snapshots where id = o.current_snapshot_id;
    captured := o.captured;
    select count(*) into open_attempts from public.money_checkout_attempts
      where obligation_id = o.id and status in ('prepared', 'session_created', 'reconcile');
  end if;
  withdrawal := r.status <> 'cancelled' and private.provider_withdrawal_open(r);

  if r.status = 'cancelled' and decision.outcome = 'no_replacement' and (cancel_op.id is null or decision.created_at >= cancel_op.created_at) then
    pct := 100; basis := 'no_acceptable_replacement'; cancelled_at := decision.created_at;
  elsif r.status = 'cancelled' and cancel_op.id is not null then
    pct := (cancel_op.policy_assessment->>'refund_percent')::integer;
    basis := coalesce(cancel_op.policy_assessment->>'basis', case when (cancel_op.policy_assessment->>'waived')::boolean
      then 'exception_accepted' else 'cancellation_policy' end);
    cancelled_at := cancel_op.created_at;
  end if;

  if withdrawal then entitlement_state := 'awaiting_replacement_decision';
  elsif r.status <> 'cancelled' then entitlement_state := 'not_cancelled';
  elsif pct is null then entitlement_state := 'awaiting_operations';
  elsif captured = 0 and open_attempts = 0 then entitlement_state := 'no_payment';
  elsif captured = 0 then entitlement_state := 'payment_outcome_pending';
  elsif pct = 0 then entitlement_state := 'no_refund_under_policy';
  else entitlement_state := 'refund_due';
  end if;
  if pct is not null and captured > 0 then
    amount := case when s.id is not null and captured >= s.total
      then round(s.subtotal::numeric * pct / 100)::bigint + round(s.tax::numeric * pct / 100)::bigint + round(s.tip::numeric * pct / 100)::bigint
      else round(captured::numeric * pct / 100)::bigint end;
  end if;

  if o.id is not null then
    select coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is not null), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is not null
             and not exists(select 1 from public.money_refund_late_failures lf where lf.authorization_id = a.id
               and not exists(select 1 from public.money_refund_resettlements rs where rs.authorization_id = a.id))), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null and t.status = 'pending'), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and (
             (f.authorization_id is null and t.status = 'failed') or exists(select 1 from public.money_refund_late_failures lf
               where lf.authorization_id = a.id and not exists(select 1 from public.money_refund_resettlements rs where rs.authorization_id = a.id)))), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null and t.status = 'reconcile'), 0),
           coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null
             and (t.authorization_id is null or t.status = 'prepared')), 0)
      into authorized, released, settled, in_flight, failed, unknown, not_sent
      from public.money_refund_authorizations a
      left join public.money_refund_releases z on z.authorization_id = a.id
      left join public.money_refunds f on f.authorization_id = a.id
      left join public.money_refund_attempts t on t.authorization_id = a.id
      where a.obligation_id = o.id;
    -- Funds captured after the cancelling record was written: the record keeps what was captured then.
    if cancelled_at is not null then
      late_capture := greatest(captured - coalesce((case when basis = 'no_acceptable_replacement' then provider_op.before_value
        else cancel_op.before_value end)->'commercial'->>'captured', captured::text)::bigint, 0);
    end if;
  end if;

  authorization_state := case when authorized = 0 then 'none' when authorized < amount then 'partly_authorized' else 'authorized' end;
  movement_state := case when authorized = 0 then 'none'
    when failed > 0 then 'failed' when unknown > 0 then 'unknown' when in_flight > 0 then 'in_flight'
    when not_sent > 0 then 'not_sent' when settled >= amount and amount > 0 then 'settled'
    when settled > 0 then 'partly_settled' else 'none' end;

  if r.status = 'cancelled' and open_attempts > 0 then
    items := items || jsonb_build_object('code', 'checkout_open_after_cancellation', 'message',
      'A checkout was still open when this was cancelled. Watch for its outcome; a payment that arrives is refunded under the cancellation.');
  end if;
  if late_capture > 0 then
    items := items || jsonb_build_object('code', 'payment_after_cancellation', 'message',
      'A payment was recorded after the cancellation. Request the refund it is owed.');
  end if;
  if entitlement_state = 'refund_due' and authorized < amount then
    items := items || jsonb_build_object('code', 'refund_not_authorized', 'message',
      'The policy refund is not fully authorized. Request it through the reviewed refund command.');
  end if;
  if failed > 0 then items := items || jsonb_build_object('code', 'refund_failed', 'message', 'A refund failed at the payment provider.'); end if;
  if unknown > 0 then items := items || jsonb_build_object('code', 'refund_unknown', 'message', 'A refund''s outcome is unknown; read it back.'); end if;
  if withdrawal then
    items := items || jsonb_build_object('code', 'replacement_decision_needed', 'message',
      case when r.recurrence_parent_id is not null then 'The provider withdrew from this plan visit. Record no replacement to refund in full, or add a new visit with the plan provider.'
        else 'The provider withdrew. Find an acceptable replacement or record that there is none.' end);
  end if;

  return jsonb_build_object('job_id', r.id, 'status', r.status, 'cancelled', r.status = 'cancelled', 'cancelled_at', cancelled_at,
    'visit', r.recurrence_parent_id is not null,
    'entitlement', jsonb_build_object('state', entitlement_state, 'refund_percent', pct, 'basis', basis)
      || case when p_amounts then jsonb_build_object('amount', amount, 'captured', captured) else '{}'::jsonb end,
    'authorization', jsonb_build_object('state', authorization_state)
      || case when p_amounts then jsonb_build_object('amount', authorized, 'released', released) else '{}'::jsonb end,
    'movement', jsonb_build_object('state', movement_state)
      || case when p_amounts then jsonb_build_object('settled', settled, 'in_flight', in_flight, 'failed', failed,
        'unknown', unknown, 'not_sent', not_sent) else '{}'::jsonb end,
    'follow_up', case when p_amounts then items else '[]'::jsonb end);
end $$;

create function public.job_cancellation_outcome(_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; is_admin boolean; is_owner boolean; is_vendor boolean;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_owner := coalesce(r.customer_id = auth.uid(), false);
  is_vendor := exists(select 1 from public.contractors where id = r.contractor_id and user_id = auth.uid());
  if r.id is null or not (is_admin or is_owner or is_vendor) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  -- Providers see that a service ended, not the homeowner's money.
  if not (is_admin or is_owner) then
    return jsonb_build_object('job_id', r.id, 'status', r.status, 'cancelled', r.status = 'cancelled');
  end if;
  return private.job_cancellation_state(r.id, true);
end $$;

-- Operations follow-up: cancelled or withdrawn services with payment work outstanding.
create function public.admin_cancellation_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x.state || jsonb_build_object('service_type', x.service_type, 'customer_name', x.customer_name)
      order by x.updated_at desc), '[]'::jsonb) into items
    from (select r.id, r.service_type, r.updated_at, p.full_name as customer_name,
            private.job_cancellation_state(r.id, true) as state
          from public.service_requests r left join public.profiles p on p.user_id = r.customer_id
          where (r.status = 'cancelled' and exists(select 1 from public.money_obligations o where o.service_request_id = r.id))
             or exists(select 1 from public.job_operations j where j.job_id = r.id and j.kind in ('provider_cancel', 'no_show'))) x
    where jsonb_array_length(x.state->'follow_up') > 0;
  return jsonb_build_object('checked_at', now(), 'items', items);
end $$;

-- CFG-007 quality events, for display only (DEC-2026-053 E10): no score, rank, matching or penalty.
create function public.admin_provider_quality_events(_contractor_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('operation_id', o.id, 'job_id', o.job_id, 'service_type', r.service_type,
      'contractor_id', c.id, 'contractor_name', c.name, 'kind', o.kind, 'reason', o.reason, 'created_at', o.created_at,
      'classification', case when (o.policy_assessment->>'waived')::boolean then 'excused'
        when o.kind = 'no_show' and not coalesce(public.has_role(o.actor_id, 'admin'), false) then 'reported_unconfirmed'
        else 'recorded' end,
      'recorded_by', case when coalesce(public.has_role(o.actor_id, 'admin'), false) then 'operations'
        when o.actor_id = r.customer_id then 'homeowner' else 'provider' end)
      order by o.created_at desc, o.seq desc), '[]'::jsonb) into items
    from public.job_operations o
    join public.service_requests r on r.id = o.job_id
    join public.contractors c on c.id = (o.before_value->>'contractor_id')::uuid
    where o.kind in ('provider_cancel', 'no_show') and (_contractor_id is null or c.id = _contractor_id);
  return jsonb_build_object('checked_at', now(), 'items', items);
end $$;

revoke all on function public.job_cancellation_preview(uuid, text, boolean), public.job_cancellation_outcome(uuid),
  public.admin_cancellation_queue(), public.admin_provider_quality_events(uuid) from public, anon;
grant execute on function public.job_cancellation_preview(uuid, text, boolean), public.job_cancellation_outcome(uuid),
  public.admin_cancellation_queue(), public.admin_provider_quality_events(uuid) to authenticated;
revoke all on function private.owner_maintenance(), private.guard_cancellation_evidence(),
  private.is_accepted_recurring_plan(public.service_requests), private.guard_recurring_plan_exceptions(),
  private.guard_recurring_replacement_reconciliation(), private.provider_withdrawal_open(public.service_requests),
  private.job_payment_state(uuid), private.job_operation_assessment(public.service_requests, text, boolean, timestamptz),
  private.job_operation_refusal(public.service_requests, text, boolean, boolean, boolean, boolean),
  private.job_operation_expected(public.service_requests), private.job_cancellation_state(uuid, boolean)
  from public, anon, authenticated;
