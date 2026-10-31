-- Phase 6.9B / TRACE-132: exception resolutions under DEC-2026-053 E3, E5–E8 and E11 (amended wording
-- recorded 2026-10-31). Builds on 20261101001000 (6.9A). Additive. No money moves here: no charge,
-- refund, payout, collection or provider call, and no function in the money fingerprint is changed.
-- Fees stay "assessed, not charged" (F-1); a later waiver's extra refund is not executed (F-2).
--
-- 1. Reschedule (E3): every request records who asked and who bears any fee. A provider's request
--    carries no homeowner fee and needs the homeowner's explicit answer; operations may move the
--    appointment to a provider-proposed time only after the homeowner accepted it. The appointment
--    stays until operations records the change. A withdrawal or cancellation closes an open request.
-- 2. Replacement (E5/E6): a replacement provider's acceptance waits for the homeowner instead of
--    scheduling. Operations proposes the provider and an appointment time; the homeowner accepts or
--    declines both. Nothing inherits the earlier appointment. The replacement must keep the agreed
--    terms. Appointment minus 24 hours ends the automatic search; a withdrawal inside it goes to
--    operations. No attempt limit and no automatic acceptance.
-- 3. Recurring (E7): a plan visit is offered only to the plan's provider on the plan's terms, on
--    every offer path, so operations' explicit re-offer is a recommitment with the same eligibility,
--    terms and identity checks; nothing re-offers a withdrawn visit automatically.
-- 4. Plan stop (E8): the homeowner asks; operations previews each visit and uses Stop future visits.
--    Nothing is bulk-cancelled and the request is never read back as a cancellation.
-- 5. Later waiver (E11): an append-only adjustment beside the immutable operation; readbacks show the
--    original assessment, the adjustment, refunds so far and what remains. Extra refunds need their
--    own reviewed authorization (F-2, not built).

-- 0. Shape -------------------------------------------------------------------------------------------

-- A replacement provider accepted; the homeowner has not yet accepted the provider and a time.
alter table public.service_requests drop constraint service_requests_matching_status_check;
alter table public.service_requests add constraint service_requests_matching_status_check check
  (matching_status in ('awaiting_match', 'offered', 'matched', 'quote_pending', 'sourcing', 'exhausted', 'awaiting_consent',
    'awaiting_homeowner'));

-- The homeowner's answer to a provider's proposed time (one per request).
create table public.job_reschedule_responses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.service_requests(id),
  request_operation_id uuid not null unique references public.job_operations(id),
  response_key uuid not null,
  actor_id uuid not null references auth.users(id),
  accepted boolean not null,
  reason text check (reason is null or length(btrim(reason)) between 1 and 2000),
  before_value jsonb not null,
  created_at timestamptz not null default now(),
  seq bigint generated always as identity,
  unique (job_id, response_key)
);

-- Operations' proposal of a replacement provider and appointment time, and the homeowner's answer.
create table public.job_replacement_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.service_requests(id),
  proposal_key uuid not null,
  withdrawal_operation_id uuid not null references public.job_operations(id),
  match_attempt_id uuid not null references public.job_match_attempts(id),
  contractor_id uuid not null references public.contractors(id),
  starts_at timestamptz not null,
  local_start timestamp not null,
  original_start timestamptz,
  search_deadline timestamptz,
  after_search_deadline boolean not null,
  terms jsonb not null,
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  seq bigint generated always as identity,
  unique (job_id, proposal_key)
);
create table public.job_replacement_responses (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique references public.job_replacement_proposals(id),
  job_id uuid not null references public.service_requests(id),
  response_key uuid not null,
  actor_id uuid not null references auth.users(id),
  accepted boolean not null,
  reason text check (reason is null or length(btrim(reason)) between 1 and 2000),
  before_value jsonb not null,
  created_at timestamptz not null default now(),
  unique (job_id, response_key)
);

-- The homeowner's request to stop future visits. Closed once by operations without stopping;
-- stopping itself stays the plan lifecycle record (admin_set_recurring_plan_state).
create table public.recurring_plan_stop_requests (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.service_requests(id),
  request_key uuid not null,
  homeowner_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  plan_state text not null,
  -- The plan's latest lifecycle record when asked: a later Stop future visits answers the request.
  lifecycle_seq bigint,
  created_at timestamptz not null default now(),
  seq bigint generated always as identity,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  resolution text,
  unique (series_id, request_key),
  check ((closed_at is null) = (closed_by is null)),
  check (closed_at is null or length(btrim(coalesce(resolution, ''))) between 1 and 2000)
);
create unique index recurring_plan_stop_requests_one_open on public.recurring_plan_stop_requests(series_id) where closed_at is null;

-- A later waiver beside the immutable operation it revises. One waiver per operation.
create table public.job_operation_adjustments (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.job_operations(id),
  job_id uuid not null references public.service_requests(id),
  adjustment_key uuid not null,
  kind text not null check (kind in ('waiver')),
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  before_value jsonb not null,
  revised jsonb not null,
  created_at timestamptz not null default now(),
  unique (job_id, adjustment_key),
  unique (operation_id, kind)
);

-- Records and decisions are history: never updated or deleted. Reads go through the RPCs below.
create trigger immutable_reschedule_response before update or delete on public.job_reschedule_responses
  for each row execute function public.money_immutable();
create trigger immutable_replacement_proposal before update or delete on public.job_replacement_proposals
  for each row execute function public.money_immutable();
create trigger immutable_replacement_response before update or delete on public.job_replacement_responses
  for each row execute function public.money_immutable();
create trigger immutable_operation_adjustment before update or delete on public.job_operation_adjustments
  for each row execute function public.money_immutable();
create function private.guard_plan_stop_request() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Plan stop requests are kept as history' using errcode = '42501'; end if;
  if old.closed_at is not null
    or (to_jsonb(new) - array['closed_by', 'closed_at', 'resolution']) is distinct from (to_jsonb(old) - array['closed_by', 'closed_at', 'resolution']) then
    raise exception 'Plan stop requests are closed once and otherwise immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger preserve_plan_stop_request before update or delete on public.recurring_plan_stop_requests
  for each row execute function private.guard_plan_stop_request();

alter table public.job_reschedule_responses enable row level security;
alter table public.job_replacement_proposals enable row level security;
alter table public.job_replacement_responses enable row level security;
alter table public.recurring_plan_stop_requests enable row level security;
alter table public.job_operation_adjustments enable row level security;
revoke all on public.job_reschedule_responses, public.job_replacement_proposals, public.job_replacement_responses,
  public.recurring_plan_stop_requests, public.job_operation_adjustments from public, anon, authenticated;
grant select on public.job_reschedule_responses, public.job_replacement_proposals, public.job_replacement_responses,
  public.recurring_plan_stop_requests, public.job_operation_adjustments to service_role;

-- 1. Shared facts ------------------------------------------------------------------------------------

-- The latest provider withdrawal (provider_cancel, or an operations-confirmed no-show).
create function private.latest_withdrawal(p_request uuid) returns public.job_operations
language sql stable security definer set search_path = '' as $$
  select o.* from public.job_operations o where o.job_id = p_request
    and (o.kind = 'provider_cancel' or (o.kind = 'no_show' and coalesce(public.has_role(o.actor_id, 'admin'), false)))
  order by o.seq desc limit 1
$$;

-- E5: appointment minus 24 hours ends the normal (automatic) replacement search for a one-time
-- service whose provider withdrew. Without an appointment there is no deadline.
create function private.replacement_search_closed(p_request public.service_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_request.recurrence_parent_id is null and p_request.scheduled_start_at is not null
    and now() >= p_request.scheduled_start_at - interval '24 hours' and private.provider_withdrawal_open(p_request)
$$;

-- What the homeowner agreed to pay, independent of which provider's package carries it (E6).
create function private.request_agreed_terms(p_request public.service_requests) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('pricing_mode', p_request.pricing_mode, 'quote_only', p_request.quote_only,
    'frequency', p_request.frequency, 'promotion_id', p_request.promotion_id, 'resolved_price', p_request.resolved_price,
    'total_amount', p_request.total_amount, 'current_quote_id', p_request.current_quote_id,
    'quote_amount', p_request.quote_amount, 'quote_status', p_request.quote_status)
$$;

-- Who asked for a different time. Participants ask for themselves; operations says on whose behalf.
-- Returns 'homeowner', 'provider', null (operations did not say) or 'invalid'.
create function private.reschedule_initiator(p_admin boolean, p_owner boolean, p_vendor boolean, p_requested text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_requested is not null and p_requested not in ('homeowner', 'provider') then 'invalid'
    when p_admin then p_requested
    when p_owner and coalesce(p_requested, 'homeowner') = 'homeowner' then 'homeowner'
    when p_vendor and coalesce(p_requested, 'provider') = 'provider' then 'provider'
    else 'invalid' end
$$;

-- The open reschedule request: the latest one not answered by an appointment record and not closed
-- by a withdrawal or cancellation since. A newer request replaces an older one.
create function private.open_reschedule_request(p_request public.service_requests) returns public.job_operations
language sql stable security definer set search_path = '' as $$
  select j.* from public.job_operations j
  where j.job_id = p_request.id and j.kind = 'reschedule_request'
    and p_request.status in ('pending', 'matched', 'quoted', 'scheduled', 'in_progress')
    and not exists(select 1 from public.job_operations a where a.job_id = j.job_id and a.seq > j.seq
      and (a.kind in ('appointment', 'customer_cancel', 'provider_cancel')
        or (a.kind = 'no_show' and coalesce(public.has_role(a.actor_id, 'admin'), false))))
  order by j.seq desc limit 1
$$;

-- 2. Assessment (restated from 20261101001000 with the reschedule initiator) ---------------------------

drop function public.job_cancellation_preview(uuid, text, boolean);
drop function private.job_operation_assessment(public.service_requests, text, boolean, timestamptz);
create function private.job_operation_assessment(p_request public.service_requests, p_kind text, p_waived boolean,
  p_scheduled_at timestamptz, p_initiator text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare hours numeric := extract(epoch from (p_request.scheduled_start_at - now())) / 3600; fee integer;
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
    -- DEC-2026-053 E3: a provider's request carries no homeowner fee and needs the homeowner's answer;
    -- if the provider can't keep the appointment and no alternative is accepted, CFG-007 applies.
    if p_initiator = 'provider' then
      return base || jsonb_build_object('initiator', 'provider', 'fee', 0, 'fee_responsibility', 'none',
        'basis', 'provider_requested', 'requires_operations', true, 'requires_homeowner_acceptance', true,
        'if_not_honored', 'CFG-007');
    end if;
    -- CFG-006 / E2: the homeowner's fee is assessed, never charged here.
    fee := case when p_waived or hours >= 48 then 0 when hours >= 24 then 25 else null end;
    return base || jsonb_build_object('initiator', 'homeowner', 'fee', fee,
      'fee_responsibility', case when fee is null then 'operations_decides' when fee > 0 then 'homeowner' else 'none' end,
      'fee_state', case when fee > 0 then 'assessed_not_charged' end,
      'basis', case when p_waived then 'exception_accepted' when p_request.scheduled_start_at is null then 'no_appointment'
        when hours >= 48 then 'notice_48_hours_or_more' when hours >= 24 then 'notice_24_to_48_hours' else 'notice_under_24_hours' end,
      'requires_operations', true);
  elsif p_kind in ('provider_cancel', 'no_show') then
    return base || jsonb_build_object('next_action', 'rematch_first', 'refund_if_no_acceptable_replacement', 100,
      'quality_event', not p_waived, 'requires_operations', true,
      'replacement_providers', p_request.recurrence_parent_id is null,
      'search_deadline', case when p_request.recurrence_parent_id is null then p_request.scheduled_start_at - interval '24 hours' end,
      'inside_search_deadline', p_request.recurrence_parent_id is null and p_request.scheduled_start_at is not null
        and now() >= p_request.scheduled_start_at - interval '24 hours');
  end if;
  return base;
end $$;

-- 3. Exception command (restated from 20261101001000) ---------------------------------------------

-- Changes from 6.9A: _initiator for reschedule requests (E3); a withdrawal keeps the agreed terms in
-- its record (E6) and, inside 24 hours of the appointment, goes straight to operations (E5); the
-- plan-visit ticket names the explicit recommitment (E7).
drop function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean, jsonb);
create function public.record_job_operation(_job_id uuid, _operation_key uuid, _kind text, _reason text,
  _scheduled_at timestamptz default null, _waived boolean default false, _expected jsonb default null,
  _initiator text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; prior public.job_operations; is_admin boolean; is_owner boolean; is_vendor boolean;
  refusal jsonb; assessment jsonb; payment jsonb; op_id uuid; next_offer uuid; recipient uuid; visit boolean;
  initiator text; inside boolean;
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
  if _kind = 'reschedule_request' then
    initiator := private.reschedule_initiator(is_admin, is_owner, is_vendor, _initiator);
  end if;
  -- A retry of a recorded operation returns it, whatever has happened since.
  select * into prior from public.job_operations where job_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if (prior.policy_assessment->>'waived')::boolean is distinct from _waived or prior.actor_id <> auth.uid()
      or prior.kind <> _kind or prior.reason <> btrim(_reason)
      or (prior.policy_assessment->>'new_start')::timestamptz is distinct from _scheduled_at
      or (_kind = 'reschedule_request' and coalesce(prior.policy_assessment->>'initiator', 'homeowner') is distinct from initiator) then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return prior.policy_assessment || jsonb_build_object('operation_id', prior.id);
  end if;
  if _expected is not null and _expected is distinct from private.job_operation_expected(r) then
    raise exception 'This service changed since you opened it. Review the current details and try again.' using errcode = '40001';
  end if;
  refusal := private.job_operation_refusal(r, _kind, _waived, is_admin, is_owner, is_vendor);
  if refusal is not null then raise exception '%', refusal->>'message' using errcode = refusal->>'errcode'; end if;
  if _kind = 'reschedule_request' then
    if initiator = 'invalid' then raise exception 'You can ask for a different time only for yourself' using errcode = '42501'; end if;
    if initiator is null then
      raise exception 'Say whether the homeowner or the provider asked for the new time' using errcode = '22023';
    end if;
    if initiator = 'provider' and r.contractor_id is null then
      raise exception 'No provider is assigned to ask for a different time' using errcode = '22023';
    end if;
    if _scheduled_at is null or _scheduled_at <= now() then
      raise exception 'Proposed future appointment required' using errcode = '22023';
    end if;
  end if;
  -- Lock order: request, then obligation (as checkout and payout do). The capture webhook takes only
  -- the obligation, so a capture in flight finishes first and is recorded below.
  perform 1 from public.money_obligations where service_request_id = r.id for share;
  payment := private.job_payment_state(r.id);
  visit := r.recurrence_parent_id is not null;
  assessment := private.job_operation_assessment(r, _kind, _waived, _scheduled_at, initiator)
    || jsonb_build_object('payment_at_operation', jsonb_build_object('captured', payment->'captured',
      'open_checkout', jsonb_array_length(payment->'open_attempts') > 0));
  insert into public.job_operations(job_id, operation_key, actor_id, kind, reason, before_value, policy_assessment)
    values (r.id, _operation_key, auth.uid(), _kind, btrim(_reason),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at,
        'matching_status', r.matching_status, 'commercial', payment, 'terms', private.request_agreed_terms(r)),
      assessment) returning id into op_id;
  if _kind = 'customer_cancel' then
    perform set_config('mercurius.cancel_evidence', r.id::text || ':operation:' || op_id::text, true);
    perform public.transition_job_status(r.id, 'cancelled', btrim(_reason),
      jsonb_build_object('operation_key', _operation_key, 'operation_id', op_id, 'policy_assessment', assessment));
  elsif _kind = 'provider_cancel' or (_kind = 'no_show' and is_admin) then
    inside := coalesce((assessment->>'inside_search_deadline')::boolean, false);
    update public.job_match_attempts set outcome = 'withdrawn', withdrawn_at = now(), reason = btrim(_reason)
      where service_request_id = r.id and outcome = 'pending';
    -- A plan visit is not offered to other providers (DEC-2026-049 item 8; E7), and a withdrawal within
    -- 24 hours of the appointment goes to operations without an automatic offer (E5).
    update public.service_requests set contractor_id = null, status = 'pending',
      matching_status = case when visit or inside then 'exhausted' else 'awaiting_match' end,
      assigned_at = null, match_expires_at = null where id = r.id;
    if not (visit or inside) then next_offer := private.offer_next_for_request_internal(r.id); end if;
  end if;
  if _kind <> 'customer_cancel' then
    update public.service_requests set needs_admin_review = true where id = r.id;
    insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
      values (r.customer_id, 'Service operation: ' || replace(_kind, '_', ' '), btrim(_reason), 'schedule_exception', r.id::text,
        case when _kind in ('provider_cancel', 'no_show') and visit then
            'Plan visits are not given to replacement providers (DEC-2026-049 item 8). Record no replacement to refund in full, or arrange an explicit recommitment by the plan provider (operations re-offer on the plan''s terms)'
          when _kind in ('provider_cancel', 'no_show') and inside then
            'Withdrawal within 24 hours of the appointment: decide now. Propose a replacement the homeowner accepts, or record no replacement (full refund)'
          when _kind in ('provider_cancel', 'no_show') then 'Find an acceptable replacement; the homeowner accepts the provider and time. Assess full refund if none is available'
          when _kind = 'reschedule_request' and initiator = 'provider' then
            'The homeowner answers the provider''s proposed time. If they decline and the provider can''t keep the appointment, record the provider''s withdrawal (CFG-007)'
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
revoke all on function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean, jsonb, text) from public, anon;
grant execute on function public.record_job_operation(uuid, uuid, text, text, timestamptz, boolean, jsonb, text) to authenticated;

-- Restated from 20261101001000 with _initiator, so a reschedule preview shows the fee the command records.
create function public.job_cancellation_preview(_job_id uuid, _kind text default 'customer_cancel',
  _waived boolean default false, _initiator text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; is_admin boolean; is_owner boolean; is_vendor boolean; refusal jsonb; payment jsonb;
  initiator text;
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
  if refusal is null and _kind = 'reschedule_request' then
    initiator := private.reschedule_initiator(is_admin, is_owner, is_vendor, _initiator);
    if initiator = 'invalid' then
      refusal := jsonb_build_object('code', 'initiator', 'message', 'You can ask for a different time only for yourself');
    end if;
  end if;
  payment := private.job_payment_state(r.id);
  return jsonb_build_object('job_id', r.id, 'kind', _kind, 'allowed', refusal is null,
    'refusal', refusal - 'errcode', 'expected', private.job_operation_expected(r),
    'plan', private.is_accepted_recurring_plan(r), 'visit', r.recurrence_parent_id is not null,
    'assessment', case when refusal is null then private.job_operation_assessment(r, _kind, coalesce(_waived, false), null,
      coalesce(initiator, 'homeowner')) end,
    'payment', case when is_admin or is_owner then jsonb_build_object('captured', payment->'captured',
      'total', payment->'total', 'open_checkout', jsonb_array_length(payment->'open_attempts') > 0) end);
end $$;
revoke all on function public.job_cancellation_preview(uuid, text, boolean, text) from public, anon;
grant execute on function public.job_cancellation_preview(uuid, text, boolean, text) to authenticated;

-- 4. Reschedule answers and appointments (E3) -------------------------------------------------------

-- The homeowner answers a provider's proposed time. Acceptance agrees the time; operations then
-- records it as the appointment. A decline keeps the appointment; operations confirms the provider
-- keeps it or records the provider's withdrawal (CFG-007). _expected is what the homeowner saw.
create function public.respond_to_reschedule_request(_job_id uuid, _request_id uuid, _response_key uuid,
  _accept boolean, _expected jsonb, _reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; open_request public.job_operations; prior public.job_reschedule_responses;
  response public.job_reschedule_responses; recipient uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  if _job_id is null or _request_id is null or _response_key is null or _accept is null then
    raise exception 'Request, answer and response key required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null or r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can answer a provider''s proposed time' using errcode = '42501';
  end if;
  select * into prior from public.job_reschedule_responses where job_id = r.id and response_key = _response_key;
  if prior.id is not null then
    if prior.request_operation_id <> _request_id or prior.accepted <> _accept
      or prior.reason is distinct from nullif(btrim(_reason), '') then
      raise exception 'Response key reused with different intent' using errcode = '22023';
    end if;
    return to_jsonb(prior) - 'before_value' || jsonb_build_object('replayed', true);
  end if;
  open_request := private.open_reschedule_request(r);
  if open_request.id is distinct from _request_id then
    raise exception 'This request was answered or replaced since you opened it. Review the current details.' using errcode = '40001';
  end if;
  if coalesce(open_request.policy_assessment->>'initiator', 'homeowner') <> 'provider' then
    raise exception 'Only a provider''s proposed time needs your answer' using errcode = '22023';
  end if;
  if exists(select 1 from public.job_reschedule_responses where request_operation_id = open_request.id) then
    raise exception 'You already answered this request' using errcode = '22023';
  end if;
  if _expected is distinct from jsonb_build_object('request_id', open_request.id, 'appointment', r.scheduled_start_at,
      'contractor_id', r.contractor_id) then
    raise exception 'This service changed since you opened it. Review the current details.' using errcode = '40001';
  end if;
  if _accept and (open_request.policy_assessment->>'new_start')::timestamptz <= now() then
    raise exception 'That time has passed. Ask the provider for another time.' using errcode = '22023';
  end if;
  insert into public.job_reschedule_responses(job_id, request_operation_id, response_key, actor_id, accepted, reason, before_value)
    values (r.id, open_request.id, _response_key, auth.uid(), _accept, nullif(btrim(_reason), ''),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at,
        'requested_start', open_request.policy_assessment->'new_start'))
    returning * into response;
  update public.service_requests set needs_admin_review = true where id = r.id;
  insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
    values (r.customer_id, 'Provider''s proposed time ' || case when _accept then 'accepted' else 'declined' end,
      coalesce(nullif(btrim(_reason), ''), 'No reason given'), 'schedule_exception', r.id::text,
      case when _accept then 'The homeowner accepted the provider''s proposed time. Record it with Use requested time'
        else 'The homeowner declined. Keep the current appointment if the provider can honor it; otherwise record the provider''s withdrawal (CFG-007)' end);
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'reschedule_response',
    'request_id', open_request.id, 'accepted', _accept, 'response_key', _response_key));
  for recipient in select user_id from public.contractors where id = r.contractor_id
      union select user_id from public.user_roles where role = 'admin' loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info',
        case when _accept then 'Proposed time accepted' else 'Proposed time declined' end,
        case when _accept then 'The homeowner accepted the proposed time. The appointment changes when Mercurius records it.'
          else 'The homeowner declined the proposed time. The current appointment stays unless Mercurius changes it.' end,
        '/notifications', r.id, r.contractor_id);
    end if;
  end loop;
  return to_jsonb(response) - 'before_value' || jsonb_build_object('replayed', false);
end $$;

-- Restated from 20261024002000 with E3: the open request follows private.open_reschedule_request,
-- and a provider-proposed time becomes the appointment only after the homeowner accepted it.
create or replace function public.admin_record_appointment(_job_id uuid, _operation_key uuid, _starts_at timestamptz,
  _local_start timestamp, _expected_start timestamptz default null, _reason text default null)
returns jsonb language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; prior public.job_operations; open_request public.job_operations;
  outcome text; result jsonb; op_id uuid; label text; title text; recipient uuid; answer public.job_reschedule_responses;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _job_id is null or _operation_key is null or _starts_at is null or _local_start is null
    or nullif(btrim(_reason), '') is null then
    raise exception 'Appointment, Eastern time, operation key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from public.job_operations where job_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.kind <> 'appointment' or prior.actor_id <> auth.uid() or prior.reason <> btrim(_reason)
      or (prior.policy_assessment ->> 'new_start')::timestamptz is distinct from _starts_at
      or (prior.before_value ->> 'scheduled_start_at')::timestamptz is distinct from _expected_start then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return prior.policy_assessment || jsonb_build_object('operation_id', prior.id, 'replayed', true);
  end if;

  if r.status <> 'scheduled' or r.contractor_id is null then
    raise exception 'An appointment can be recorded only after a provider accepts and before work starts' using errcode = '22023';
  end if;
  if r.frequency is not null and r.frequency <> 'one-time' then
    raise exception 'Recurring visits are scheduled separately' using errcode = '22023';
  end if;
  if r.scheduled_start_at is distinct from _expected_start then
    raise exception 'The appointment changed since you loaded it' using errcode = '40001';
  end if;
  if date_trunc('minute', _starts_at) <> _starts_at
    or (_starts_at at time zone 'America/New_York') <> _local_start then
    raise exception 'The appointment does not match the Eastern Time entered' using errcode = '22023';
  end if;
  if _starts_at <= now() then raise exception 'Choose a future appointment time' using errcode = '22023'; end if;

  open_request := private.open_reschedule_request(r);
  if _starts_at = r.scheduled_start_at then
    if open_request.id is null then raise exception 'This appointment is already recorded' using errcode = '22023'; end if;
    outcome := 'kept';
  elsif r.scheduled_start_at is null then outcome := 'recorded';
  else outcome := 'changed';
  end if;
  -- DEC-2026-053 E3: a provider's proposed time is not an appointment until the homeowner accepts it.
  if outcome <> 'kept' and open_request.id is not null and open_request.policy_assessment->>'initiator' = 'provider' then
    select * into answer from public.job_reschedule_responses where request_operation_id = open_request.id;
    if not coalesce(answer.accepted, false) or (open_request.policy_assessment->>'new_start')::timestamptz <> _starts_at then
      raise exception 'The homeowner hasn''t accepted this time. Keep the current appointment, or ask the provider to propose a time the homeowner accepts.'
        using errcode = '22023';
    end if;
  end if;

  result := jsonb_build_object('policy', 'CFG-006/007', 'waived', false, 'money_action', 'none', 'requires_operations', false,
    'outcome', outcome, 'previous_start', r.scheduled_start_at, 'new_start', _starts_at, 'local_start', _local_start,
    'timezone', 'America/New_York', 'answers_request', open_request.id);
  insert into public.job_operations(job_id, operation_key, actor_id, kind, reason, before_value, policy_assessment)
    values (r.id, _operation_key, auth.uid(), 'appointment', btrim(_reason),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at), result)
    returning id into op_id;
  -- preferred_date/preferred_time stay the homeowner's request; the appointment is its own field.
  if outcome <> 'kept' then
    update public.service_requests set scheduled_start_at = _starts_at, timezone = 'America/New_York' where id = r.id;
  end if;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'appointment',
    'outcome', outcome, 'operation_key', _operation_key, 'reason', btrim(_reason),
    'previous_start', r.scheduled_start_at, 'new_start', _starts_at));

  label := to_char(_local_start, 'Dy, Mon FMDD, YYYY, FMHH12:MI AM') || ' '
    || case when _local_start - (_starts_at at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end;
  title := case outcome when 'recorded' then 'Appointment recorded' when 'changed' then 'Appointment changed'
    else 'Appointment unchanged' end;
  for recipient in select r.customer_id union select user_id from public.contractors where id = r.contractor_id loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info', title, label || ' (Eastern Time). ' || btrim(_reason),
        '/notifications', r.id, r.contractor_id);
    end if;
  end loop;
  return result || jsonb_build_object('operation_id', op_id, 'replayed', false);
end;
$$;

-- 5. Replacement (E5/E6) ------------------------------------------------------------------------------

-- Restated from 20260904000100. Changes: no new offer while a replacement awaits the homeowner;
-- a plan visit is offered only to its plan provider (E7); once the replacement search deadline has
-- passed nothing is offered automatically and operations decides (E5).
CREATE OR REPLACE FUNCTION private.offer_next_for_request_internal(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  pending_offer uuid;
  candidate record;
  r public.service_requests;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  SELECT * INTO r FROM public.service_requests request WHERE request.id = _request_id;
  IF r.status NOT IN ('pending', 'matched') OR r.matching_status IN ('matched', 'awaiting_homeowner') THEN
    RETURN NULL;
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at <= now();

  SELECT id INTO pending_offer
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id AND outcome = 'pending'
  LIMIT 1;
  IF pending_offer IS NOT NULL THEN RETURN pending_offer; END IF;

  -- TRACE-132 (E5): the automatic search ends 24 hours before the appointment the provider left.
  IF private.replacement_search_closed(r) THEN
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL, status = 'pending',
        matching_status = 'exhausted', needs_admin_review = true, updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  SELECT eligible.* INTO candidate
  FROM private.find_eligible_packages_core(_request_id) eligible
  WHERE NOT EXISTS (
    SELECT 1 FROM public.job_match_attempts previous
    WHERE previous.service_request_id = _request_id
      AND previous.contractor_id = eligible.contractor_id
      AND previous.outcome IN ('accepted', 'declined', 'expired', 'withdrawn')
  )
    -- TRACE-132 (E7): a plan visit stays with the plan's provider.
    AND (r.recurrence_parent_id IS NULL OR eligible.contractor_id = r.preferred_contractor_id)
  ORDER BY eligible.preferred DESC, eligible.rank_order
  LIMIT 1;

  IF candidate.contractor_id IS NOT NULL AND NOT private.fallback_permitted(_request_id,candidate.contractor_id) THEN
    UPDATE public.service_requests
    SET contractor_id = NULL,
        assigned_at = NULL,
        match_expires_at = NULL,
        status = 'pending',
        matching_status = 'awaiting_consent',
        needs_admin_review = true,
        updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  IF candidate.contractor_id IS NULL THEN
    UPDATE public.service_requests
    SET contractor_id = NULL,
        assigned_at = NULL,
        match_expires_at = NULL,
        status = 'pending',
        matching_status = 'exhausted',
        needs_admin_review = true,
        updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  RETURN private.create_job_offer_internal(
    _request_id, candidate.contractor_id, candidate.package_id,
    candidate.package_tier_id, false
  );
END;
$$;

-- Restated from 20260904005000. Change: a replacement provider's acceptance (a one-time service whose
-- provider withdrew) waits for the homeowner instead of scheduling; nothing is scheduled at the
-- earlier appointment (E5). Every other acceptance is unchanged.
CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  offer record;
  still_eligible boolean;
  prior_status public.request_status;
  homeowner uuid;
  r public.service_requests;
  replacement boolean;
  recipient uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND contractor.user_id = auth.uid()
  ORDER BY attempt.offered_at DESC
  LIMIT 1;

  IF offer.id IS NULL THEN
    RAISE EXCEPTION 'No open offer is available to accept';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_requests
    WHERE id=_job_id AND status IN ('matched','quoted') AND matching_status='offered'
      AND contractor_id=offer.contractor_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Offer is no longer actionable' USING ERRCODE='22023';
  END IF;

  SELECT * INTO r FROM public.service_requests WHERE id=_job_id;
  prior_status := r.status; homeowner := r.customer_id;
  IF offer.expires_at <= now() THEN
    RAISE EXCEPTION 'Offer has expired' USING ERRCODE='22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.find_eligible_packages_core(_job_id) eligible
    WHERE eligible.contractor_id = offer.contractor_id
      AND eligible.package_id = offer.package_id
      AND (offer.package_tier_id IS NULL OR eligible.package_tier_id = offer.package_tier_id)
  ) INTO still_eligible;

  IF NOT still_eligible THEN
    RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023';
  END IF;
  replacement := r.recurrence_parent_id IS NULL AND private.provider_withdrawal_open(r);

  UPDATE public.job_match_attempts
  SET outcome = 'accepted', accepted_at = now(), responded_at = now(),
      response_actor_id = auth.uid(), updated_at = now()
  WHERE id = offer.id;
  UPDATE public.job_match_attempts
  SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = COALESCE(reason, 'Another offer was accepted'), updated_at = now()
  WHERE service_request_id = _job_id AND outcome = 'pending' AND id <> offer.id;

  IF replacement THEN
    -- TRACE-132 (E5): the homeowner accepts the replacement provider and a time before anything is scheduled.
    UPDATE public.service_requests
    SET contractor_id = offer.contractor_id, match_expires_at = NULL, matching_status = 'awaiting_homeowner',
        needs_admin_review = true, updated_at = now()
    WHERE id = _job_id;
    PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
      jsonb_build_object('action','replacement_provider_accepted','offer_id',offer.id,'contractor_id',offer.contractor_id,
        'policy','DEC-2026-053 E5'));
    PERFORM public.notify_user(homeowner,'job_status','info','Replacement provider found',
      'Mercurius will send you the provider and an appointment time to accept. Nothing is scheduled until you accept both.',
      '/dashboard',_job_id,offer.contractor_id);
    FOR recipient IN SELECT user_id FROM public.user_roles WHERE role='admin' LOOP
      PERFORM public.notify_user(recipient,'job_status','warning','Replacement accepted the offer',
        'Propose the replacement and an appointment time for the homeowner to accept.','/admin/requests',_job_id,offer.contractor_id);
    END LOOP;
    RETURN;
  END IF;

  UPDATE public.service_requests
  SET contractor_id = offer.contractor_id,
      package_id = offer.package_id,
      package_tier_id = offer.package_tier_id,
      promotion_id = offer.promotion_id,
      frequency = offer.frequency,
      pricing_mode = CASE WHEN offer.offer_path = 'fixed' THEN 'fixed' ELSE 'custom_quote' END,
      quote_only = offer.offer_path = 'quote',
      base_amount = offer.base_price,
      resolved_price = offer.effective_price,
      total_amount = offer.effective_price,
      match_expires_at = NULL,
      matching_status = 'matched',
      status = 'scheduled',
      updated_at = now()
  WHERE id = _job_id;
  PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
    jsonb_build_object('from',prior_status,'to','scheduled','reason','vendor_accepted','offer_id',offer.id,'lifecycle_version','phase4-v1'));
  PERFORM public.notify_user(homeowner,'job_status','info','Provider accepted your service','Your service is scheduled. Review the appointment details and any pending price quote.','/dashboard',_job_id,offer.contractor_id);
END;
$$;

-- The accepted replacement attempt the homeowner would be agreeing to, or null.
create function private.replacement_attempt(p_request public.service_requests) returns public.job_match_attempts
language sql stable security definer set search_path = '' as $$
  select a.* from public.job_match_attempts a
  where a.service_request_id = p_request.id and a.contractor_id = p_request.contractor_id and a.outcome = 'accepted'
    and p_request.matching_status = 'awaiting_homeowner'
  order by a.accepted_at desc nulls last, a.id desc limit 1
$$;

-- The latest proposal for the current replacement attempt.
create function private.current_replacement_proposal(p_request public.service_requests) returns public.job_replacement_proposals
language sql stable security definer set search_path = '' as $$
  select p.* from public.job_replacement_proposals p
  where p.job_id = p_request.id and p.match_attempt_id = (private.replacement_attempt(p_request)).id
  order by p.seq desc limit 1
$$;

-- Operations proposes the replacement provider and an appointment time for the homeowner to accept.
-- The replacement must keep what the homeowner agreed to pay (E6). _expected is
-- {contractor_id, proposal_id} as operations loaded them.
create function public.admin_propose_replacement(_job_id uuid, _proposal_key uuid, _starts_at timestamptz,
  _local_start timestamp, _expected jsonb, _reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; prior public.job_replacement_proposals; current_proposal public.job_replacement_proposals;
  attempt public.job_match_attempts; withdrawal public.job_operations; proposal public.job_replacement_proposals;
  terms jsonb; agreed jsonb; deadline timestamptz; label text; provider text;
  keys text[] := array['pricing_mode', 'quote_only', 'frequency', 'promotion_id', 'resolved_price', 'total_amount',
    'current_quote_id', 'quote_amount', 'quote_status'];
  k text;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _job_id is null or _proposal_key is null or _starts_at is null or _local_start is null or nullif(btrim(_reason), '') is null then
    raise exception 'Appointment, Eastern time, proposal key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;
  select * into prior from public.job_replacement_proposals where job_id = r.id and proposal_key = _proposal_key;
  if prior.id is not null then
    if prior.actor_id <> auth.uid() or prior.starts_at <> _starts_at or prior.reason <> btrim(_reason) then
      raise exception 'Proposal key reused with different intent' using errcode = '22023';
    end if;
    return to_jsonb(prior) || jsonb_build_object('replayed', true);
  end if;

  attempt := private.replacement_attempt(r);
  if r.recurrence_parent_id is not null or r.status not in ('matched', 'quoted') or attempt.id is null
     or not private.provider_withdrawal_open(r) then
    raise exception 'A replacement can be proposed only after a replacement provider accepts the offer' using errcode = '22023';
  end if;
  current_proposal := private.current_replacement_proposal(r);
  if _expected is distinct from jsonb_build_object('contractor_id', r.contractor_id, 'proposal_id', current_proposal.id) then
    raise exception 'The replacement changed since you loaded it' using errcode = '40001';
  end if;
  if date_trunc('minute', _starts_at) <> _starts_at or (_starts_at at time zone 'America/New_York') <> _local_start then
    raise exception 'The appointment does not match the Eastern Time entered' using errcode = '22023';
  end if;
  if _starts_at <= now() then raise exception 'Choose a future appointment time' using errcode = '22023'; end if;

  withdrawal := private.latest_withdrawal(r.id);
  agreed := withdrawal.before_value->'terms';
  if agreed is null then
    raise exception 'The terms agreed before the withdrawal weren''t recorded. Record no replacement, or open a finance exception.'
      using errcode = '22023';
  end if;
  terms := private.request_agreed_terms(r);
  foreach k in array keys loop
    if terms->k is distinct from agreed->k then
      raise exception 'The replacement''s price or terms differ from what the homeowner agreed. A replacement works for the agreed amount (DEC-2026-053 E6); otherwise record no replacement.'
        using errcode = '22023';
    end if;
  end loop;

  deadline := (withdrawal.before_value->>'scheduled_start_at')::timestamptz - interval '24 hours';
  insert into public.job_replacement_proposals(job_id, proposal_key, withdrawal_operation_id, match_attempt_id, contractor_id,
    starts_at, local_start, original_start, search_deadline, after_search_deadline, terms, actor_id, reason)
  values (r.id, _proposal_key, withdrawal.id, attempt.id, r.contractor_id, _starts_at, _local_start,
    (withdrawal.before_value->>'scheduled_start_at')::timestamptz, deadline, coalesce(now() >= deadline, false), terms,
    auth.uid(), btrim(_reason))
  returning * into proposal;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'replacement_proposed',
    'proposal_id', proposal.id, 'contractor_id', r.contractor_id, 'starts_at', _starts_at, 'reason', btrim(_reason)));
  select name into provider from public.contractors where id = r.contractor_id;
  label := to_char(_local_start, 'Dy, Mon FMDD, YYYY, FMHH12:MI AM') || ' '
    || case when _local_start - (_starts_at at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end;
  perform public.notify_user(r.customer_id, 'job_status', 'warning', 'Accept your replacement provider',
    coalesce(provider, 'A replacement provider') || ' can do this service on ' || label
      || ' (Eastern Time). Accept or decline both in your service details. Nothing is scheduled until you accept.',
    '/dashboard', r.id, r.contractor_id);
  return to_jsonb(proposal) || jsonb_build_object('replayed', false);
end $$;

-- The homeowner explicitly accepts or declines the proposed replacement provider and time (E5).
-- Acceptance schedules the service with that provider at that time; a decline releases the
-- replacement and the search continues within its deadline. _expected is
-- {proposal_id, contractor_id, starts_at} as the homeowner saw them.
create function public.homeowner_respond_replacement(_proposal_id uuid, _response_key uuid, _accept boolean,
  _expected jsonb, _reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.job_replacement_proposals; r public.service_requests; prior public.job_replacement_responses;
  response public.job_replacement_responses; attempt public.job_match_attempts; eligible boolean; recipient uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  if _proposal_id is null or _response_key is null or _accept is null then
    raise exception 'Proposal, answer and response key required' using errcode = '22023';
  end if;
  select * into p from public.job_replacement_proposals where id = _proposal_id;
  if p.id is null then raise exception 'Only the homeowner can answer this proposal' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p.job_id::text, 0));
  select * into r from public.service_requests where id = p.job_id for update;
  if r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can answer this proposal' using errcode = '42501';
  end if;
  select * into prior from public.job_replacement_responses where job_id = r.id and response_key = _response_key;
  if prior.id is not null then
    if prior.proposal_id <> p.id or prior.accepted <> _accept or prior.reason is distinct from nullif(btrim(_reason), '') then
      raise exception 'Response key reused with different intent' using errcode = '22023';
    end if;
    return to_jsonb(prior) - 'before_value' || jsonb_build_object('replayed', true);
  end if;
  if exists(select 1 from public.job_replacement_responses where proposal_id = p.id) then
    raise exception 'You already answered this proposal' using errcode = '22023';
  end if;
  attempt := private.replacement_attempt(r);
  -- The service must still be open: a cancellation or withdrawal since the proposal makes it stale.
  if r.status not in ('matched', 'quoted') or (private.current_replacement_proposal(r)).id is distinct from p.id
     or attempt.id is distinct from p.match_attempt_id
     or r.contractor_id is distinct from p.contractor_id or not private.provider_withdrawal_open(r)
     or _expected is distinct from jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id, 'starts_at', p.starts_at) then
    raise exception 'This proposal changed since you opened it. Review the current details.' using errcode = '40001';
  end if;
  if _accept then
    if p.starts_at <= now() then raise exception 'That time has passed. Mercurius will propose another time.' using errcode = '22023'; end if;
    if private.request_agreed_terms(r) is distinct from p.terms then
      raise exception 'This proposal changed since you opened it. Review the current details.' using errcode = '40001';
    end if;
    select exists(select 1 from private.find_eligible_packages_core(r.id) e
      where e.contractor_id = attempt.contractor_id and e.package_id = attempt.package_id
        and (attempt.package_tier_id is null or e.package_tier_id = attempt.package_tier_id)) into eligible;
    if not eligible then
      raise exception 'This provider can''t take the service right now. Mercurius will follow up.' using errcode = '22023';
    end if;
  end if;
  insert into public.job_replacement_responses(proposal_id, job_id, response_key, actor_id, accepted, reason, before_value)
    values (p.id, r.id, _response_key, auth.uid(), _accept, nullif(btrim(_reason), ''),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at,
        'matching_status', r.matching_status))
    returning * into response;
  if _accept then
    update public.service_requests set status = 'scheduled', matching_status = 'matched', scheduled_start_at = p.starts_at,
      timezone = 'America/New_York', updated_at = now() where id = r.id;
  else
    update public.job_match_attempts set outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = 'Homeowner declined the replacement', updated_at = now() where id = attempt.id;
    update public.service_requests set contractor_id = null, status = 'pending', matching_status = 'awaiting_match',
      assigned_at = null, match_expires_at = null, needs_admin_review = true, updated_at = now() where id = r.id;
    perform private.offer_next_for_request_internal(r.id);
  end if;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'replacement_response',
    'proposal_id', p.id, 'accepted', _accept, 'response_key', _response_key));
  for recipient in select user_id from public.contractors where id = p.contractor_id
      union select user_id from public.user_roles where role = 'admin' loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info',
        case when _accept then 'Replacement accepted' else 'Replacement declined' end,
        case when _accept then 'The homeowner accepted the provider and appointment time. The service is scheduled.'
          else 'The homeowner declined the proposed replacement. Mercurius continues the search or records no replacement.' end,
        '/notifications', r.id, p.contractor_id);
    end if;
  end loop;
  return to_jsonb(response) - 'before_value' || jsonb_build_object('replayed', false);
end $$;

-- The replacement state for a service whose provider withdrew, or null.
create function private.job_replacement_state(p_request public.service_requests, p_admin boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w public.job_operations; p public.job_replacement_proposals; answer public.job_replacement_responses;
  open boolean; deadline timestamptz; state text; provider text;
begin
  w := private.latest_withdrawal(p_request.id);
  if w.id is null or p_request.recurrence_parent_id is not null then return null; end if;
  open := p_request.status in ('pending', 'matched', 'quoted') and private.provider_withdrawal_open(p_request);
  p := private.current_replacement_proposal(p_request);
  if p.id is null then
    select * into p from public.job_replacement_proposals where withdrawal_operation_id = w.id order by seq desc limit 1;
  end if;
  if p.id is not null then
    select * into answer from public.job_replacement_responses where proposal_id = p.id;
    select name into provider from public.contractors where id = p.contractor_id;
  end if;
  deadline := (w.before_value->>'scheduled_start_at')::timestamptz - interval '24 hours';
  state := case
    when not open and answer.accepted then 'accepted'
    when not open then 'closed'
    when p_request.matching_status = 'awaiting_homeowner' and p.id is not null and p.match_attempt_id = (private.replacement_attempt(p_request)).id
      and answer.id is null then 'awaiting_homeowner'
    when p_request.matching_status = 'awaiting_homeowner' then 'awaiting_proposal'
    when p_request.matching_status = 'exhausted' then 'search_ended'
    else 'searching' end;
  return jsonb_build_object('state', state, 'withdrawn_at', w.created_at, 'original_start', w.before_value->'scheduled_start_at',
    'search_deadline', deadline, 'search_closed', coalesce(now() >= deadline, false),
    'inside_search_deadline', coalesce((w.policy_assessment->>'inside_search_deadline')::boolean, false),
    'proposal', case when p.id is not null then jsonb_build_object('id', p.id, 'contractor_id', p.contractor_id,
      'provider_name', provider, 'starts_at', p.starts_at, 'created_at', p.created_at, 'reason', p.reason,
      'after_search_deadline', p.after_search_deadline,
      'answer', case when answer.id is not null then jsonb_build_object('accepted', answer.accepted, 'at', answer.created_at,
        'reason', answer.reason) end) end,
    'expected', case when state = 'awaiting_homeowner' then jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id,
      'starts_at', p.starts_at) end,
    'admin_expected', case when p_admin and state in ('awaiting_homeowner', 'awaiting_proposal')
      then jsonb_build_object('contractor_id', p_request.contractor_id, 'proposal_id', (private.current_replacement_proposal(p_request)).id) end);
end $$;

-- Restated from 20261024002000. Adds: who asked for a time and the fee consequence, the homeowner's
-- answer to a provider's proposed time, later fee waivers, and the replacement state; the open request
-- follows private.open_reschedule_request (a withdrawal or cancellation closes it).
create or replace function public.job_schedule(_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; vendor_user uuid; history jsonb; open_request jsonb; is_admin boolean; is_owner boolean;
  open_op public.job_operations; answer public.job_reschedule_responses;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  select user_id into vendor_user from public.contractors where id = r.contractor_id;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_owner := coalesce(r.customer_id = auth.uid(), false);
  -- coalesce: a job without a provider has a null vendor_user, which must not skip the refusal.
  if r.id is null or not (is_admin or is_owner or coalesce(vendor_user = auth.uid(), false)) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  with ops as (
    select j.*, case when j.actor_id = r.customer_id then 'homeowner'
        when coalesce(public.has_role(j.actor_id, 'admin'), false) then 'operations'
        when j.actor_id = vendor_user then 'provider' else 'previous_provider' end as actor_role
      from public.job_operations j where j.job_id = r.id and j.kind in ('appointment', 'reschedule_request')
  ), entries as (
    select o.created_at as at, o.seq as seq, 0::bigint as sub, jsonb_build_object(
      'id', o.id, 'kind', o.kind,
      'outcome', case when o.kind = 'reschedule_request' then 'requested'
        else coalesce(o.policy_assessment ->> 'outcome',
          case when o.before_value -> 'scheduled_start_at' = 'null'::jsonb then 'recorded' else 'changed' end) end,
      'actor', o.actor_role, 'at', o.created_at, 'reason', o.reason,
      'previous_start', o.before_value -> 'scheduled_start_at',
      'new_start', case when o.kind = 'appointment' then o.policy_assessment -> 'new_start' end,
      'requested_start', case when o.kind = 'reschedule_request' then o.policy_assessment -> 'new_start' end,
      'initiator', case when o.kind = 'reschedule_request' then coalesce(o.policy_assessment ->> 'initiator', o.actor_role) end,
      'fee', case when o.kind = 'reschedule_request' then o.policy_assessment -> 'fee' end,
      'fee_waived_later', exists(select 1 from public.job_operation_adjustments x where x.operation_id = o.id),
      'operation_key', case when o.actor_id = auth.uid() then o.operation_key end) as item
    from ops o
    union all
    select a.created_at, q.seq, 1 + a.seq, jsonb_build_object('id', a.id, 'kind', 'reschedule_response',
      'outcome', case when a.accepted then 'accepted' else 'declined' end, 'actor', 'homeowner', 'at', a.created_at,
      'reason', a.reason, 'previous_start', a.before_value -> 'scheduled_start_at', 'new_start', null,
      'requested_start', a.before_value -> 'requested_start',
      'operation_key', case when a.actor_id = auth.uid() then a.response_key end)
    from public.job_reschedule_responses a join public.job_operations q on q.id = a.request_operation_id where a.job_id = r.id
    union all
    select p.created_at, w.seq, 1 + 2 * p.seq, jsonb_build_object('id', p.id, 'kind', 'replacement_proposal', 'outcome', 'proposed',
      'actor', 'operations', 'at', p.created_at, 'reason', p.reason, 'previous_start', p.original_start, 'new_start', p.starts_at,
      'requested_start', null, 'provider_name', c.name,
      'operation_key', case when p.actor_id = auth.uid() then p.proposal_key end)
    from public.job_replacement_proposals p join public.contractors c on c.id = p.contractor_id
      join public.job_operations w on w.id = p.withdrawal_operation_id where p.job_id = r.id
    union all
    select x.created_at, w.seq, 2 + 2 * p.seq, jsonb_build_object('id', x.id, 'kind', 'replacement_response',
      'outcome', case when x.accepted then 'accepted' else 'declined' end, 'actor', 'homeowner', 'at', x.created_at,
      'reason', x.reason, 'previous_start', x.before_value -> 'scheduled_start_at',
      'new_start', case when x.accepted then p.starts_at end, 'requested_start', null, 'provider_name', c.name,
      'operation_key', case when x.actor_id = auth.uid() then x.response_key end)
    from public.job_replacement_responses x join public.job_replacement_proposals p on p.id = x.proposal_id
      join public.contractors c on c.id = p.contractor_id join public.job_operations w on w.id = p.withdrawal_operation_id
    where x.job_id = r.id
  )
  -- Entries in one transaction share a time; each answer sorts after the record it answers.
  select coalesce(jsonb_agg(e.item order by e.at, e.seq, e.sub), '[]'::jsonb) into history from entries e;

  open_op := private.open_reschedule_request(r);
  if open_op.id is not null then
    select * into answer from public.job_reschedule_responses where request_operation_id = open_op.id;
    open_request := jsonb_build_object('id', open_op.id,
      'actor', case when open_op.actor_id = r.customer_id then 'homeowner'
        when coalesce(public.has_role(open_op.actor_id, 'admin'), false) then 'operations'
        when open_op.actor_id = vendor_user then 'provider' else 'previous_provider' end,
      'at', open_op.created_at, 'reason', open_op.reason, 'requested_start', open_op.policy_assessment -> 'new_start',
      'initiator', coalesce(open_op.policy_assessment ->> 'initiator', 'homeowner'),
      'fee', open_op.policy_assessment -> 'fee',
      'fee_responsibility', open_op.policy_assessment -> 'fee_responsibility',
      'fee_waived_later', exists(select 1 from public.job_operation_adjustments x where x.operation_id = open_op.id),
      'requires_homeowner_acceptance', coalesce((open_op.policy_assessment ->> 'requires_homeowner_acceptance')::boolean, false),
      'answer', case when answer.id is not null then jsonb_build_object('accepted', answer.accepted, 'at', answer.created_at,
        'reason', answer.reason) end,
      'expected', jsonb_build_object('request_id', open_op.id, 'appointment', r.scheduled_start_at, 'contractor_id', r.contractor_id));
  end if;
  return jsonb_build_object('timezone', 'America/New_York', 'status', r.status, 'matching_status', r.matching_status,
    'has_provider', r.contractor_id is not null, 'recurring', coalesce(r.frequency, 'one-time') <> 'one-time',
    'appointment', r.scheduled_start_at, 'open_request', open_request, 'history', history,
    'replacement', private.job_replacement_state(r, is_admin));
end;
$$;

-- 6. Recurring visits keep the plan provider and terms (E7) ------------------------------------------

-- Every offer of a plan visit, on every path (visit creation, rematch, operations' re-offer), goes to the
-- plan's provider on the plan's package, level and price. With this, operations' explicit re-offer of a
-- withdrawn visit is a recommitment under the same eligibility (create_job_offer_internal and
-- vendor_accept_job), terms and identity checks; offer_next never re-offers a withdrawn provider.
create function private.guard_recurring_visit_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.service_requests; parent public.service_requests; t private.recurring_series_terms;
begin
  select * into v from public.service_requests where id = new.service_request_id;
  if v.recurrence_parent_id is null then return new; end if;
  select * into parent from public.service_requests where id = v.recurrence_parent_id;
  select * into t from private.recurring_series_terms
    where series_id = parent.id and contractor_id is not distinct from parent.contractor_id order by seq desc limit 1;
  if new.contractor_id is distinct from coalesce(t.contractor_id, v.preferred_contractor_id, parent.contractor_id) then
    raise exception 'A plan visit is offered only to the plan''s provider (DEC-2026-049 item 8)' using errcode = '42501';
  end if;
  -- Same signal create_recurring_visit_core already maps to its terms_changed refusal.
  if t.id is not null and (new.package_id is distinct from t.package_id or new.package_tier_id is distinct from t.package_tier_id
      or new.base_price is distinct from t.visit_price or new.effective_price is distinct from t.visit_total) then
    raise exception 'recurring terms changed' using errcode = 'MR661';
  end if;
  return new;
end $$;
create trigger guard_recurring_visit_offer before insert on public.job_match_attempts
  for each row execute function private.guard_recurring_visit_offer();

-- 7. Plan stop requests (E8) --------------------------------------------------------------------------

-- The homeowner asks Mercurius to stop future visits. Nothing is stopped or cancelled here.
create function public.homeowner_request_plan_stop(_series_id uuid, _request_key uuid, _reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; prior public.recurring_plan_stop_requests; open_request public.recurring_plan_stop_requests;
  created public.recurring_plan_stop_requests; plan_state text; recipient uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  if _series_id is null or _request_key is null or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, request key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null or r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can ask to stop this plan' using errcode = '42501';
  end if;
  select * into prior from public.recurring_plan_stop_requests where series_id = r.id and request_key = _request_key;
  if prior.id is not null then
    if prior.reason <> btrim(_reason) then raise exception 'Request key reused with different intent' using errcode = '22023'; end if;
    return jsonb_build_object('request_id', prior.id, 'state', 'requested', 'replayed', true);
  end if;
  if not private.is_accepted_recurring_plan(r) then
    raise exception 'This service isn''t an active plan' using errcode = '22023';
  end if;
  plan_state := private.recurring_plan_state(r.id);
  if plan_state = 'ended' then raise exception 'Future visits for this plan were already stopped' using errcode = '22023'; end if;
  select * into open_request from public.recurring_plan_stop_requests where series_id = r.id and closed_at is null;
  if open_request.id is not null then
    return jsonb_build_object('request_id', open_request.id, 'state', 'requested', 'replayed', true, 'existing', true);
  end if;
  insert into public.recurring_plan_stop_requests(series_id, request_key, homeowner_id, reason, plan_state, lifecycle_seq)
    values (r.id, _request_key, auth.uid(), btrim(_reason), plan_state,
      (select max(l.seq) from private.recurring_series_lifecycle l where l.series_id = r.id)) returning * into created;
  update public.service_requests set needs_admin_review = true where id = r.id;
  insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
    values (r.customer_id, 'Stop future visits requested', btrim(_reason), 'plan_stop_request', r.id::text,
      'Review each visit in place (preview), use Stop future visits, then handle each visit on its own. Nothing is cancelled by the request.');
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'plan_stop_requested',
    'request_id', created.id, 'reason', btrim(_reason), 'plan_state', plan_state));
  perform public.notify_user(r.customer_id, 'job_status', 'info', 'Stop request received',
    'Mercurius will stop future visits. Visits already in place stay until each one is handled; nothing is cancelled by this request.',
    '/dashboard', r.id, r.contractor_id);
  for recipient in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify_user(recipient, 'job_status', 'warning', 'Homeowner asked to stop future visits',
      btrim(_reason), '/admin/requests', r.id, r.contractor_id);
  end loop;
  return jsonb_build_object('request_id', created.id, 'state', 'requested', 'replayed', false);
end $$;

-- Operations closes a request without stopping the plan (for example, the homeowner withdrew it).
create function public.admin_close_plan_stop_request(_request_id uuid, _resolution text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.recurring_plan_stop_requests; r public.service_requests;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _request_id is null or nullif(btrim(_resolution), '') is null then
    raise exception 'Request and resolution required' using errcode = '22023';
  end if;
  select * into q from public.recurring_plan_stop_requests where id = _request_id;
  if q.id is null then raise exception 'Request not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(q.series_id::text, 0));
  select * into r from public.service_requests where id = q.series_id for update;
  select * into q from public.recurring_plan_stop_requests where id = _request_id;
  if q.closed_at is not null then
    if q.closed_by = auth.uid() and q.resolution = btrim(_resolution) then
      return jsonb_build_object('request_id', q.id, 'state', 'closed', 'replayed', true);
    end if;
    raise exception 'This request was already closed' using errcode = '22023';
  end if;
  if private.recurring_plan_state(q.series_id) = 'ended' then
    raise exception 'Future visits were already stopped; the request is complete' using errcode = '22023';
  end if;
  update public.recurring_plan_stop_requests set closed_by = auth.uid(), closed_at = now(), resolution = btrim(_resolution)
    where id = q.id;
  perform public.log_job_event(q.series_id, 'status_changed', auth.uid(), jsonb_build_object('action', 'plan_stop_request_closed',
    'request_id', q.id, 'resolution', btrim(_resolution)));
  perform public.notify_user(r.customer_id, 'job_status', 'info', 'Stop request closed',
    'Future visits were not stopped. ' || btrim(_resolution), '/dashboard', r.id, r.contractor_id);
  return jsonb_build_object('request_id', q.id, 'state', 'closed', 'replayed', false);
end $$;

-- What stopping would and would not change: the request, the plan state, and each visit still in
-- place with how it is handled and what cancelling it now would assess. Homeowner and operations.
create function public.recurring_plan_stop_preview(_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; is_admin boolean; is_owner boolean; q public.recurring_plan_stop_requests;
  plan_state text; visits jsonb; request_state text;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _series_id;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_owner := coalesce(r.customer_id = auth.uid(), false);
  if r.id is null or not (is_admin or is_owner) then raise exception 'Not a participant in this service' using errcode = '42501'; end if;
  if r.recurrence_parent_id is not null or r.frequency is null or r.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  plan_state := private.recurring_plan_state(r.id);
  select * into q from public.recurring_plan_stop_requests where series_id = r.id order by seq desc limit 1;
  if q.id is not null then
    request_state := case when q.closed_at is not null then 'closed'
      when plan_state = 'ended' and exists(select 1 from private.recurring_series_lifecycle l where l.series_id = r.id
        and l.action = 'stop' and l.seq > coalesce(q.lifecycle_seq, 0)) then 'stopped'
      else 'open' end;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'matching_status', v.matching_status,
      'scheduled_start_at', v.scheduled_start_at, 'provider_name', c.name,
      'offer_open', exists(select 1 from public.job_match_attempts a where a.service_request_id = v.id and a.outcome = 'pending'),
      'cancellation', case when refusal is null then jsonb_build_object('allowed', true,
          'refund_percent', assessment->'refund_percent', 'basis', assessment->'basis')
        else jsonb_build_object('allowed', false, 'message', refusal->>'message') end,
      'payment', case when is_admin then jsonb_build_object('captured', payment->'captured',
        'open_checkout', jsonb_array_length(payment->'open_attempts') > 0) end)
    order by v.scheduled_start_at nulls last, v.id), '[]'::jsonb) into visits
  from public.service_requests v
  left join public.contractors c on c.id = v.contractor_id
  cross join lateral (select private.job_operation_refusal(v, 'customer_cancel', false, is_admin, is_owner, false) as refusal,
    private.job_operation_assessment(v, 'customer_cancel', false, null) as assessment, private.job_payment_state(v.id) as payment) x
  where v.recurrence_parent_id = r.id
    and v.status not in ('cancelled', 'completed', 'homeowner_confirmed', 'resolved', 'review_requested', 'reviewed', 'closed');
  return jsonb_build_object('series_id', r.id, 'plan_state', plan_state, 'accepted', private.is_accepted_recurring_plan(r),
    'request', case when q.id is not null then jsonb_build_object('id', q.id, 'at', q.created_at, 'reason', q.reason,
      'state', request_state, 'closed_at', q.closed_at, 'resolution', q.resolution) end,
    'visits', visits, 'expected_state', plan_state);
end $$;

-- 8. Later waivers (E11) -----------------------------------------------------------------------------

-- Why operations may not accept a waiver for this record now, or null.
create function private.waiver_refusal(p_op public.job_operations, p_request public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_op.id is null then return 'Record not found'; end if;
  if p_op.kind not in ('customer_cancel', 'reschedule_request') then
    return 'Only a cancellation or a rescheduling fee can be waived later';
  end if;
  if coalesce((p_op.policy_assessment->>'waived')::boolean, false) then return 'This record already includes the exception'; end if;
  if exists(select 1 from public.job_operation_adjustments a where a.operation_id = p_op.id and a.kind = 'waiver') then
    return 'An exception was already accepted for this record';
  end if;
  if p_op.kind = 'customer_cancel' then
    if p_request.status <> 'cancelled'
       or (select o.id from public.job_operations o where o.job_id = p_request.id and o.kind = 'customer_cancel' order by o.seq desc limit 1) <> p_op.id then
      return 'Only the cancellation that ended this service can be waived';
    end if;
    if coalesce((p_op.policy_assessment->>'refund_percent')::integer, 100) >= 100 then
      return 'This cancellation already refunds in full';
    end if;
    if exists(select 1 from public.job_operations w join public.money_provider_replacement_decisions d on d.operation_id = w.id
        where w.job_id = p_request.id and d.outcome = 'no_replacement' and d.created_at >= p_op.created_at) then
      return 'This cancellation already refunds in full';
    end if;
  elsif coalesce((p_op.policy_assessment->>'fee')::integer, 0) = 0 then
    return 'No rescheduling fee was assessed';
  end if;
  return null;
end $$;

-- What the operator saw: a refund recorded since then changes what remains, so the read is stale.
create function private.waiver_expected(p_op public.job_operations) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('operation_id', p_op.id,
    'authorizations', (select count(*) from public.money_refund_authorizations a join public.money_obligations o on o.id = a.obligation_id
      where o.service_request_id = p_op.job_id),
    'refunds', (select count(*) from public.money_refunds f join public.money_refund_authorizations a on a.id = f.authorization_id
      join public.money_obligations o on o.id = a.obligation_id where o.service_request_id = p_op.job_id))
$$;

create function public.admin_waiver_preview(_operation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare op public.job_operations; r public.service_requests; refusal text; state jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into op from public.job_operations where id = _operation_id;
  select * into r from public.service_requests where id = op.job_id;
  refusal := private.waiver_refusal(op, r);
  if op.kind = 'customer_cancel' then state := private.job_cancellation_state(r.id, true); end if;
  return jsonb_build_object('operation_id', op.id, 'kind', op.kind, 'allowed', refusal is null, 'refusal', refusal,
    'original', case when op.id is not null then jsonb_build_object('refund_percent', op.policy_assessment->'refund_percent',
      'fee', op.policy_assessment->'fee', 'basis', op.policy_assessment->'basis', 'at', op.created_at) end,
    'revised', case when op.kind = 'customer_cancel' then jsonb_build_object('refund_percent', 100)
      when op.kind = 'reschedule_request' then jsonb_build_object('fee', 0) end,
    'refund', state, 'expected', case when op.id is not null then private.waiver_expected(op) end);
end $$;

-- Operations accepts a weather/emergency exception after the record (CFG-006, E11). The operation,
-- its assessment and every refund record stay as they are; this appends the revision. No money moves:
-- any additional refund needs its own reviewed authorization with duplicate protection (F-2).
create function public.admin_record_waiver_adjustment(_operation_id uuid, _adjustment_key uuid, _reason text, _expected jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare op public.job_operations; r public.service_requests; prior public.job_operation_adjustments;
  created public.job_operation_adjustments; refusal text; revised jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _operation_id is null or _adjustment_key is null or nullif(btrim(_reason), '') is null then
    raise exception 'Record, adjustment key and reason required' using errcode = '22023';
  end if;
  select * into op from public.job_operations where id = _operation_id;
  if op.id is null then raise exception 'Record not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(op.job_id::text, 0));
  select * into r from public.service_requests where id = op.job_id for update;
  perform 1 from public.money_obligations where service_request_id = r.id for share;
  select * into prior from public.job_operation_adjustments where job_id = r.id and adjustment_key = _adjustment_key;
  if prior.id is not null then
    if prior.operation_id <> op.id or prior.actor_id <> auth.uid() or prior.reason <> btrim(_reason) then
      raise exception 'Adjustment key reused with different intent' using errcode = '22023';
    end if;
    return to_jsonb(prior) - 'before_value' || jsonb_build_object('replayed', true);
  end if;
  refusal := private.waiver_refusal(op, r);
  if refusal is not null then raise exception '%', refusal using errcode = '22023'; end if;
  if _expected is distinct from private.waiver_expected(op) then
    raise exception 'Refunds changed since you loaded this. Review the current amounts and try again.' using errcode = '40001';
  end if;
  revised := case when op.kind = 'customer_cancel' then jsonb_build_object('refund_percent', 100, 'basis', 'exception_accepted_later')
    else jsonb_build_object('fee', 0, 'basis', 'exception_accepted_later') end;
  insert into public.job_operation_adjustments(operation_id, job_id, adjustment_key, kind, actor_id, reason, before_value, revised)
    values (op.id, r.id, _adjustment_key, 'waiver', auth.uid(), btrim(_reason),
      jsonb_build_object('assessment', op.policy_assessment,
        'refund', case when op.kind = 'customer_cancel' then private.job_cancellation_state(r.id, true) end),
      revised)
    returning * into created;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'waiver_adjustment',
    'operation_id', op.id, 'adjustment_id', created.id, 'reason', btrim(_reason)));
  perform public.notify_user(r.customer_id, 'job_status', 'info', 'Exception accepted',
    case when op.kind = 'customer_cancel'
      then 'Mercurius accepted an exception for this cancellation, so the full amount is owed back. Any additional refund is reviewed separately before it is sent. ' || btrim(_reason)
      else 'Mercurius accepted an exception, so the rescheduling fee no longer applies. ' || btrim(_reason) end,
    '/notifications', r.id, r.contractor_id);
  return to_jsonb(created) - 'before_value' || jsonb_build_object('replayed', false);
end $$;

-- Restated from 20261101001000 with E11: a later waiver revises the entitlement beside the original
-- assessment; the readback shows both, refunds so far and what remains (a supplemental refund beyond
-- the original assessment needs its own reviewed authorization, F-2). Everything else is unchanged.
create or replace function private.job_cancellation_state(p_request uuid, p_amounts boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; cancel_op public.job_operations; provider_op public.job_operations;
  decision public.money_provider_replacement_decisions; o public.money_obligations; s public.money_snapshots;
  pct integer; basis text; entitlement_state text; amount bigint := 0; captured bigint := 0; cancelled_at timestamptz;
  authorized bigint := 0; released bigint := 0; settled bigint := 0; in_flight bigint := 0; failed bigint := 0;
  unknown bigint := 0; not_sent bigint := 0; movement_state text; authorization_state text; items jsonb := '[]'::jsonb;
  open_attempts integer := 0; late_capture bigint := 0; withdrawal boolean;
  adj public.job_operation_adjustments; original_pct integer; original_basis text; original_amount bigint := 0;
  remaining_state text := 'none'; remaining bigint := 0;
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
    -- TRACE-132 (E11): a later waiver revises the entitlement; the original stays alongside it.
    select * into adj from public.job_operation_adjustments where operation_id = cancel_op.id and kind = 'waiver';
    if adj.id is not null then
      original_pct := pct; original_basis := basis;
      pct := (adj.revised->>'refund_percent')::integer; basis := adj.revised->>'basis';
    end if;
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
    original_amount := amount;
    if adj.id is not null then
      original_amount := case when s.id is not null and captured >= s.total
        then round(s.subtotal::numeric * original_pct / 100)::bigint + round(s.tax::numeric * original_pct / 100)::bigint
          + round(s.tip::numeric * original_pct / 100)::bigint
        else round(captured::numeric * original_pct / 100)::bigint end;
    end if;
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
  if entitlement_state = 'refund_due' and authorized < amount then
    remaining := amount - authorized;
    remaining_state := case when adj.id is not null and authorized >= original_amount then 'supplemental_review'
      when adj.id is not null then 'original_and_supplemental' else 'original_unauthorized' end;
  end if;

  if r.status = 'cancelled' and open_attempts > 0 then
    items := items || jsonb_build_object('code', 'checkout_open_after_cancellation', 'message',
      'A checkout was still open when this was cancelled. Watch for its outcome; a payment that arrives is refunded under the cancellation.');
  end if;
  if late_capture > 0 then
    items := items || jsonb_build_object('code', 'payment_after_cancellation', 'message',
      'A payment was recorded after the cancellation. Request the refund it is owed.');
  end if;
  if entitlement_state = 'refund_due' and authorized < original_amount then
    items := items || jsonb_build_object('code', 'refund_not_authorized', 'message',
      'The policy refund is not fully authorized. Request it through the reviewed refund command.');
  end if;
  if remaining_state in ('supplemental_review', 'original_and_supplemental') then
    items := items || jsonb_build_object('code', 'supplemental_refund_needs_review', 'message',
      'An exception accepted after the cancellation raised what is owed. The additional refund needs its own reviewed authorization, which is not available yet (separate finance scope).');
  end if;
  if failed > 0 then items := items || jsonb_build_object('code', 'refund_failed', 'message', 'A refund failed at the payment provider.'); end if;
  if unknown > 0 then items := items || jsonb_build_object('code', 'refund_unknown', 'message', 'A refund''s outcome is unknown; read it back.'); end if;
  if withdrawal then
    items := items || jsonb_build_object('code', 'replacement_decision_needed', 'message',
      case when r.recurrence_parent_id is not null then 'The provider withdrew from this plan visit. Record no replacement to refund in full, or arrange an explicit recommitment by the plan provider.'
        when r.matching_status = 'awaiting_homeowner' then 'A replacement provider accepted. Propose the provider and a time for the homeowner to accept.'
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
    'adjustment', case when adj.id is not null then jsonb_build_object('id', adj.id, 'kind', adj.kind, 'at', adj.created_at,
        'reason', adj.reason, 'original_percent', original_pct, 'original_basis', original_basis, 'operation_id', cancel_op.id)
      || case when p_amounts then jsonb_build_object('original_amount', original_amount) else '{}'::jsonb end end,
    'remaining', jsonb_build_object('state', remaining_state)
      || case when p_amounts then jsonb_build_object('amount', remaining) else '{}'::jsonb end,
    'cancel_operation_id', case when basis <> 'no_acceptable_replacement' then cancel_op.id end,
    'follow_up', case when p_amounts then items else '[]'::jsonb end);
end $$;

-- 9. Grants -----------------------------------------------------------------------------------------

revoke all on function public.respond_to_reschedule_request(uuid, uuid, uuid, boolean, jsonb, text),
  public.admin_propose_replacement(uuid, uuid, timestamptz, timestamp, jsonb, text),
  public.homeowner_respond_replacement(uuid, uuid, boolean, jsonb, text),
  public.homeowner_request_plan_stop(uuid, uuid, text), public.admin_close_plan_stop_request(uuid, text),
  public.recurring_plan_stop_preview(uuid), public.admin_waiver_preview(uuid),
  public.admin_record_waiver_adjustment(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.respond_to_reschedule_request(uuid, uuid, uuid, boolean, jsonb, text),
  public.admin_propose_replacement(uuid, uuid, timestamptz, timestamp, jsonb, text),
  public.homeowner_respond_replacement(uuid, uuid, boolean, jsonb, text),
  public.homeowner_request_plan_stop(uuid, uuid, text), public.admin_close_plan_stop_request(uuid, text),
  public.recurring_plan_stop_preview(uuid), public.admin_waiver_preview(uuid),
  public.admin_record_waiver_adjustment(uuid, uuid, text, jsonb) to authenticated;
revoke all on function private.latest_withdrawal(uuid), private.replacement_search_closed(public.service_requests),
  private.request_agreed_terms(public.service_requests), private.reschedule_initiator(boolean, boolean, boolean, text),
  private.open_reschedule_request(public.service_requests),
  private.job_operation_assessment(public.service_requests, text, boolean, timestamptz, text),
  private.replacement_attempt(public.service_requests), private.current_replacement_proposal(public.service_requests),
  private.job_replacement_state(public.service_requests, boolean), private.guard_recurring_visit_offer(),
  private.guard_plan_stop_request(), private.waiver_refusal(public.job_operations, public.service_requests),
  private.waiver_expected(public.job_operations)
  from public, anon, authenticated;
