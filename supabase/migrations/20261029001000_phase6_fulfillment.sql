-- Phase 6.7 / TRACE-128: provider fulfillment, completion evidence and homeowner confirmation.
--
-- Builds on the accepted Phase 4 lifecycle (private.transition_job_status, TRACE-097 completion
-- evidence, the Phase 5 confirmation receipt) and the 6.6 visit identities. Additive: one guard
-- trigger, new commands and reads. No existing function, table or grant is restated or removed.
--
-- 1. Work starts only on an accepted assignment, on every path. An open offer already sets
--    contractor_id, so the kernel's "vendor assigned" check alone let an operator move a pending,
--    offered or quoted request straight to in_progress. Starting (and restarting after rework) now
--    needs matching_status = 'matched' and a scheduled or rework state.
-- 2. start_job: the assigned provider (or an operator, with a reason) starts a scheduled service
--    once per operation key; a stale start is refused, a retry replays. It records the payment
--    state at start in the job event. It does not gate on payment: whether unpaid work may start
--    is an open owner decision (DEC-2026-050, proposed). Existing start behavior is unchanged.
-- 3. homeowner_confirm_completion / homeowner_dispute_completion: the homeowner's decision is bound
--    to the completion they reviewed (its vendor_completed_at). A rework or another decision in
--    between refuses the stale one; a retry of the same decision replays. Both delegate to the
--    existing commands, so the receipt, the 48-hour dispute window and the 72-hour review flag are
--    unchanged. Nothing confirms automatically.
-- 4. job_fulfillment: who started, completed, confirmed or disputed, and when, for each participant;
--    the approved clocks; open service exceptions; payout readiness for provider and operations
--    (read from the existing ACH payable check, never decided here).
-- 5. admin_fulfillment_queue and admin_record_fulfillment_follow_up: unanswered completions past
--    the 72-hour review time, open no-show / unable-to-complete / customer-unavailable /
--    partial-completion reports and completions without recorded evidence, each with a recorded
--    operator follow-up. A follow-up changes no state, charges, refunds or notifies nobody.
--
-- Not changed: payout and money kernels (money fingerprint), cancellation/refund economics (6.9),
-- dispute resolution (6.10), reviews (6.8), notification delivery, Cron, the recurring plan guard.

-- 1. Work starts only on an accepted assignment -------------------------------------------------

create function private.guard_fulfillment_start() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.contractor_id is null or new.matching_status is distinct from 'matched' then
    raise exception 'Work starts only after the assigned provider accepts this service' using errcode = '42501';
  end if;
  if old.status not in ('scheduled', 'vendor_completed', 'pending_review', 'disputed') then
    raise exception 'Work starts only from a scheduled service (now %)', old.status using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.guard_fulfillment_start() from public, anon, authenticated;
create trigger guard_fulfillment_start before update of status on public.service_requests
  for each row when (new.status = 'in_progress' and old.status is distinct from 'in_progress')
  execute function private.guard_fulfillment_start();

-- 2. Starting work ------------------------------------------------------------------------------

-- The payment position when work starts, for the audit record only. A visit uses its canonical
-- 6.6c state; a one-time request reports its obligation's capture and the legacy field.
create function private.fulfillment_payment_state(r public.service_requests) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; s public.money_snapshots; p jsonb;
begin
  if r.recurrence_parent_id is not null then
    p := private.recurring_visit_payment(r, now());
    return jsonb_build_object('state', p->>'state', 'reason', p->>'reason', 'obligation_id', p->>'obligation_id');
  end if;
  select * into o from public.money_obligations where service_request_id = r.id;
  if o.id is null then
    return jsonb_build_object('state', 'no_obligation', 'legacy_payment_status', r.payment_status::text);
  end if;
  select * into s from public.money_snapshots where id = o.current_snapshot_id;
  return jsonb_build_object('state', case when s.id is not null and o.captured >= s.total then 'paid'
      when o.captured > 0 then 'partial' else 'unpaid' end,
    'obligation_id', o.id, 'legacy_payment_status', r.payment_status::text);
end $$;
revoke all on function private.fulfillment_payment_state(public.service_requests) from public, anon, authenticated, service_role;

create function public.start_job(_job_id uuid, _operation_key uuid, _reason text default null) returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; prior public.job_events; is_admin boolean; is_vendor boolean; payment jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to start work' using errcode = '42501'; end if;
  if _job_id is null or _operation_key is null then raise exception 'Service and operation key required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_vendor := r.id is not null and exists(select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid());
  if r.id is null or not (is_admin or is_vendor) then
    raise exception 'Only the assigned provider or operations can start this service' using errcode = '42501';
  end if;
  select * into prior from public.job_events e
    where e.job_id = r.id and e.metadata->>'start_key' = _operation_key::text order by e.created_at limit 1;
  if prior.id is not null then
    if prior.actor_id is distinct from auth.uid() then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('outcome', 'replayed', 'status', r.status, 'started_at', prior.created_at);
  end if;
  if is_admin and not is_vendor and nullif(btrim(_reason), '') is null then
    raise exception 'Operations must give a reason to start work' using errcode = '22023';
  end if;
  if r.recurrence_parent_id is null and r.frequency is not null and r.frequency <> 'one-time' then
    raise exception 'Work is recorded on each recurring visit, not on the plan' using errcode = '22023';
  end if;
  if r.status <> 'scheduled' then
    raise exception 'This service is no longer waiting to start (now %). Refresh to see its current state.',
      replace(r.status::text, '_', ' ') using errcode = '40001';
  end if;
  payment := private.fulfillment_payment_state(r);
  perform public.transition_job_status(r.id, 'in_progress', nullif(btrim(_reason), ''),
    jsonb_build_object('start_key', _operation_key, 'source', 'start_job', 'payment_at_start', payment));
  return jsonb_build_object('outcome', 'started', 'status', 'in_progress', 'started_at', now());
end $$;
revoke all on function public.start_job(uuid, uuid, text) from public, anon;
grant execute on function public.start_job(uuid, uuid, text) to authenticated;

-- 3. The homeowner's decision on a completion ---------------------------------------------------

create function public.homeowner_confirm_completion(_job_id uuid, _completed_at timestamptz) returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests;
begin
  if auth.uid() is null then raise exception 'Only the homeowner can confirm completion' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null or r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can confirm completion' using errcode = '42501';
  end if;
  if r.status in ('homeowner_confirmed', 'completed', 'review_requested', 'reviewed', 'closed')
     and r.vendor_completed_at is not distinct from _completed_at and r.homeowner_confirmed_at >= r.vendor_completed_at then
    return jsonb_build_object('outcome', 'replayed', 'status', r.status, 'confirmed_at', r.homeowner_confirmed_at);
  end if;
  if r.status <> 'vendor_completed' then
    raise exception 'This completion is no longer waiting for your confirmation. Refresh to see its current state.' using errcode = '40001';
  end if;
  if r.vendor_completed_at is distinct from _completed_at then
    raise exception 'The provider submitted new completion proof. Review it before you confirm.' using errcode = '40001';
  end if;
  perform public.homeowner_confirm_job(r.id);
  select * into r from public.service_requests where id = _job_id;
  return jsonb_build_object('outcome', 'confirmed', 'status', r.status, 'confirmed_at', r.homeowner_confirmed_at);
end $$;
revoke all on function public.homeowner_confirm_completion(uuid, timestamptz) from public, anon;
grant execute on function public.homeowner_confirm_completion(uuid, timestamptz) to authenticated;

create function public.homeowner_dispute_completion(_job_id uuid, _completed_at timestamptz, _reason text) returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; d public.disputes;
begin
  if auth.uid() is null then raise exception 'Only the homeowner can file this dispute' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if r.id is null or r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can file this dispute' using errcode = '42501';
  end if;
  if nullif(btrim(_reason), '') is null then raise exception 'Dispute reason required' using errcode = '22023'; end if;
  select * into d from public.disputes where job_id = r.id and status <> 'resolved' order by created_at desc limit 1;
  if d.id is not null and d.homeowner_id = auth.uid() and d.reason = btrim(_reason)
     and r.vendor_completed_at is not distinct from _completed_at then
    return jsonb_build_object('outcome', 'replayed', 'status', r.status, 'dispute_id', d.id);
  end if;
  if d.id is null and r.status <> 'vendor_completed' then
    raise exception 'This completion is no longer waiting for your decision. Refresh to see its current state.' using errcode = '40001';
  end if;
  if d.id is null and r.vendor_completed_at is distinct from _completed_at then
    raise exception 'The provider submitted new completion proof. Review it before you report an issue.' using errcode = '40001';
  end if;
  -- An open dispute, the 48-hour window and the ticket are the existing command's rules.
  return jsonb_build_object('outcome', 'disputed', 'status', 'disputed',
    'dispute_id', public.homeowner_raise_dispute(r.id, _reason));
end $$;
revoke all on function public.homeowner_dispute_completion(uuid, timestamptz, text) from public, anon;
grant execute on function public.homeowner_dispute_completion(uuid, timestamptz, text) to authenticated;

-- 4. Fulfillment readback -----------------------------------------------------------------------

create function private.fulfillment_actor(p_actor text) returns text
language sql immutable set search_path = '' as $$
  select case p_actor when 'vendor' then 'provider' when 'homeowner' then 'homeowner'
    when 'admin' then 'operations' when 'internal' then 'operations' end
$$;
revoke all on function private.fulfillment_actor(text) from public, anon, authenticated, service_role;

create function public.job_fulfillment(_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; role text; started public.job_events; completed public.job_events;
  attempt record; d public.disputes; o public.money_obligations; payable jsonb; blocker text; payout jsonb;
  confirmed boolean; ops jsonb;
begin
  select * into r from public.service_requests where id = _job_id;
  role := case when r.id is null or auth.uid() is null then null
    when coalesce(public.has_role(auth.uid(), 'admin'), false) then 'admin'
    when r.customer_id = auth.uid() then 'homeowner'
    when exists(select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid()) then 'vendor' end;
  if role is null then raise exception 'Not a participant in this service' using errcode = '42501'; end if;
  if r.recurrence_parent_id is null and r.frequency is not null and r.frequency <> 'one-time' then
    return jsonb_build_object('role', role, 'status', r.status, 'plan', true);
  end if;

  select * into started from public.job_events e
    where e.job_id = r.id and e.event_type = 'status_changed' and e.metadata->>'to' = 'in_progress'
    order by e.created_at desc limit 1;
  select * into completed from public.job_events e
    where e.job_id = r.id and e.event_type = 'job_completed_by_vendor' order by e.created_at desc limit 1;
  select x.attempt, count(*)::int as photos, max(x.minimum_photos) as minimum, max(x.recorded_at) as recorded_at into attempt
    from public.job_completion_evidence x where x.job_id = r.id
    group by x.attempt order by x.attempt desc limit 1;
  select * into d from public.disputes where job_id = r.id order by created_at desc limit 1;
  confirmed := r.homeowner_confirmed_at is not null and r.vendor_completed_at is not null
    and r.homeowner_confirmed_at >= r.vendor_completed_at
    and r.status in ('homeowner_confirmed', 'completed', 'review_requested', 'reviewed', 'closed', 'disputed', 'resolved');

  select coalesce(jsonb_agg(jsonb_build_object('kind', j.kind, 'at', j.created_at, 'reason', j.reason,
      'by', case when j.actor_id = r.customer_id then 'homeowner'
        when coalesce(public.has_role(j.actor_id, 'admin'), false) then 'operations' else 'provider' end)
      order by j.created_at), '[]') into ops
    from public.job_operations j where j.job_id = r.id
      and j.kind in ('no_show', 'unable_to_complete', 'customer_unavailable', 'partial_completion', 'provider_cancel');

  if role in ('vendor', 'admin') then
    select * into o from public.money_obligations where service_request_id = r.id;
    if o.id is null then
      payout := jsonb_build_object('state', 'no_payment_record');
    else
      begin
        payable := private.money_ach_payable(o.id);
        blocker := payable->>'blocker';
      exception when others then
        blocker := 'unavailable';
      end;
      payout := jsonb_build_object('state', case
          when blocker is null then 'eligible'
          when blocker = 'awaiting_confirmation' then 'awaiting_confirmation'
          when blocker = 'confirmation_window' then 'confirmation_window'
          when blocker = 'payment_incomplete' then 'payment_incomplete'
          when blocker = 'payout_onboarding' then 'onboarding'
          when blocker = 'already_paid' then 'paid'
          when blocker = 'no_payable' then 'nothing_payable'
          when blocker = 'unavailable' then 'unavailable'
          else 'held' end,
        'eligible_at', case when confirmed then r.homeowner_confirmed_at + interval '48 hours' end)
        || case when role = 'admin' then jsonb_build_object('blocker', blocker, 'obligation_id', o.id) else '{}' end;
    end if;
  end if;

  return jsonb_build_object(
    'role', role, 'status', r.status, 'plan', false, 'visit', r.recurrence_parent_id is not null,
    'started', case when started.id is not null then jsonb_build_object('at', started.created_at,
      'by', private.fulfillment_actor(started.metadata->>'actor'),
      'rework', started.metadata->>'from' in ('vendor_completed', 'pending_review', 'disputed'))
      || case when role = 'admin' then jsonb_build_object('reason', started.metadata->>'reason',
        'payment_at_start', started.metadata->'payment_at_start') else '{}' end end,
    'completion', case when r.vendor_completed_at is not null then jsonb_build_object(
      'at', r.vendor_completed_at, 'attempt', attempt.attempt, 'photos', attempt.photos, 'minimum', attempt.minimum,
      'by', private.fulfillment_actor(completed.metadata->>'actor'), 'recorded', attempt.attempt is not null) end,
    'confirmation', case when confirmed then jsonb_build_object('at', r.homeowner_confirmed_at, 'by', 'homeowner') end,
    'dispute', case when d.id is not null then jsonb_build_object('at', d.created_at, 'status', d.status,
      'resolved_at', d.resolved_at) end,
    'dispute_window_ends_at', r.vendor_completed_at + interval '48 hours',
    'review_at', case when r.status = 'vendor_completed'
      then coalesce(r.confirmation_sent_at, r.vendor_completed_at) + interval '72 hours' end,
    'operations', ops,
    'payout', payout);
end $$;
revoke all on function public.job_fulfillment(uuid) from public, anon;
grant execute on function public.job_fulfillment(uuid) to authenticated;

-- 5. Operations queue and follow-up -------------------------------------------------------------

-- Open items, each hidden once an operator records a follow-up at or after it opened. The 72-hour
-- review time is the approved Phase 4 clock, read here; nothing is decided by it.
create function private.fulfillment_queue_items(p_at timestamptz)
returns table(request_id uuid, kind text, since timestamptz, detail text)
language sql stable security definer set search_path = '' as $$
  with items as (
    select r.id, 'confirmation_overdue'::text as kind,
        coalesce(r.confirmation_sent_at, r.vendor_completed_at) + interval '72 hours' as since, null::text as detail
      from public.service_requests r
     where r.status = 'vendor_completed' and coalesce(r.confirmation_sent_at, r.vendor_completed_at) + interval '72 hours' <= p_at
    union all
    select * from (select distinct on (j.job_id) j.job_id, 'fulfillment_exception', j.created_at, j.kind
      from public.job_operations j join public.service_requests r on r.id = j.job_id
     where j.kind in ('no_show', 'unable_to_complete', 'customer_unavailable', 'partial_completion')
       and r.status in ('pending', 'matched', 'quoted', 'scheduled', 'in_progress') and j.created_at <= p_at
     order by j.job_id, j.created_at desc) latest
    union all
    select r.id, 'evidence_unverified', r.vendor_completed_at, null
      from public.service_requests r
     where r.status in ('vendor_completed', 'pending_review', 'disputed') and r.vendor_completed_at is not null
       and not exists(select 1 from public.job_completion_evidence e where e.job_id = r.id)
  )
  select i.id, i.kind, i.since, i.detail from items i
   where not exists(select 1 from public.job_events e where e.job_id = i.id
     and e.metadata->>'action' = 'fulfillment_follow_up' and e.metadata->>'item' = i.kind and e.created_at >= i.since)
$$;
revoke all on function private.fulfillment_queue_items(timestamptz) from public, anon, authenticated, service_role;

create function public.admin_fulfillment_queue() returns jsonb
language plpgsql stable security definer set search_path = 'public', 'private', 'pg_temp' as $$
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read the fulfillment queue' using errcode = '42501';
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('request_id', i.request_id, 'kind', i.kind, 'since', i.since, 'detail', i.detail,
        'service_type', r.service_type, 'status', r.status, 'series_id', r.recurrence_parent_id)
      order by i.since, i.request_id)
      from private.fulfillment_queue_items(now()) i join public.service_requests r on r.id = i.request_id), '[]'));
end $$;
revoke all on function public.admin_fulfillment_queue() from public, anon;
grant execute on function public.admin_fulfillment_queue() to authenticated;

create function public.admin_record_fulfillment_follow_up(_job_id uuid, _operation_key uuid, _item text, _reason text) returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare prior public.job_events; open_item record;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can record a fulfillment follow-up' using errcode = '42501';
  end if;
  if _job_id is null or _operation_key is null or nullif(btrim(_reason), '') is null
     or _item not in ('confirmation_overdue', 'fulfillment_exception', 'evidence_unverified') then
    raise exception 'Service, operation key, item and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  perform 1 from public.service_requests where id = _job_id for update;
  select * into prior from public.job_events e
    where e.job_id = _job_id and e.metadata->>'follow_up_key' = _operation_key::text order by e.created_at limit 1;
  if prior.id is not null then
    if prior.actor_id is distinct from auth.uid() or prior.metadata->>'item' is distinct from _item
       or prior.metadata->>'reason' is distinct from btrim(_reason) then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('outcome', 'replayed', 'recorded_at', prior.created_at);
  end if;
  select * into open_item from private.fulfillment_queue_items(now()) i where i.request_id = _job_id and i.kind = _item;
  if open_item.request_id is null then
    raise exception 'This item is no longer open. Refresh the queue.' using errcode = '40001';
  end if;
  perform public.log_job_event(_job_id, 'status_changed', auth.uid(), jsonb_build_object('action', 'fulfillment_follow_up',
    'item', _item, 'detail', open_item.detail, 'item_since', open_item.since, 'follow_up_key', _operation_key, 'reason', btrim(_reason)));
  return jsonb_build_object('outcome', 'recorded', 'recorded_at', now());
end $$;
revoke all on function public.admin_record_fulfillment_follow_up(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_record_fulfillment_follow_up(uuid, uuid, text, text) to authenticated;
