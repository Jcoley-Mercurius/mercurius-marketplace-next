-- Phase 6 corrective slice CS-5 / TRACE-145: recurring visits start only when paid. Record:
-- governance/PHASE-6-CLOSURE-REPORT.md §8 CS-5; DEC-2026-050 recommendation A, approved by
-- DEC-2026-060 D-4.
--
-- A recurring visit starts only when it is paid (captured >= the reviewed snapshot total, the
-- canonical 6.6c state). Every other state is refused with its reason. Operations may record a
-- payment exception, with a reason, for a visit that is ready but unpaid, processing, failed or of
-- unknown outcome, never for a held, terms-blocked or unreviewed visit. Payout still requires full
-- capture (unchanged). One-time requests are not gated until TRACE-126 (CS-3) is fixed.
--
-- Enforced in the start guard trigger, so every path to in_progress is covered. Additive: start_job
-- keeps its signature; the exception is a separate operator command. No money function changes
-- (fingerprint 45 | 34c51131… before and after); the gate only reads private.recurring_visit_payment.

-- An operator's payment exception: who, why, the payment state, and the transaction it applies to.
-- Only admin_start_visit_payment_exception writes it, and the guard accepts only a row written in the
-- same transaction, so nothing else can claim an exception. Append-only.
create table private.visit_start_payment_exceptions (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.service_requests(id),
  actor_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  payment_state text not null check (payment_state in ('ready', 'processing', 'failed', 'unknown')),
  operation_key uuid not null unique,
  txid bigint not null default txid_current(),
  created_at timestamptz not null default now()
);
revoke all on table private.visit_start_payment_exceptions from public, anon, authenticated;
create function private.visit_start_payment_exceptions_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Payment exceptions are append-only' using errcode = '42501';
end $$;
revoke all on function private.visit_start_payment_exceptions_append_only() from public, anon, authenticated;
create trigger visit_start_payment_exceptions_append_only before update or delete on private.visit_start_payment_exceptions
  for each row execute function private.visit_start_payment_exceptions_append_only();

create function private.visit_start_exception_now(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.visit_start_payment_exceptions e where e.job_id = p_job and e.txid = txid_current()) $$;
revoke all on function private.visit_start_exception_now(uuid) from public, anon, authenticated, service_role;

-- The refusal a provider or operator sees, or null when the visit may start.
create function private.visit_start_payment_block(r public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb; state text; reason text;
begin
  p := private.recurring_visit_payment(r, now());
  state := p->>'state'; reason := p->>'reason';
  if state = 'paid' then return null; end if;
  if state in ('ready', 'processing', 'failed', 'unknown') and private.visit_start_exception_now(r.id) then
    return null;
  end if;
  return case
    when state = 'processing' then 'The homeowner''s payment for this visit is still processing. Wait for the outcome before you start work.'
    when state = 'ready' then 'This visit isn''t paid yet. Work can start once the homeowner pays for it.'
    when state = 'failed' then 'The homeowner''s payment for this visit didn''t go through. Work can start once it''s paid.'
    when state = 'unknown' then 'Mercurius is confirming this visit''s payment. Work can start once it''s confirmed.'
    when state = 'review_pending' and reason = 'held' then 'This visit''s payment is on hold. Mercurius will contact you before work starts.'
    when state = 'review_pending' then 'This visit''s price hasn''t been reviewed and paid yet. Work can start once it''s paid.'
    else 'Work can start only after this visit is paid.' end;
end $$;
revoke all on function private.visit_start_payment_block(public.service_requests) from public, anon, authenticated, service_role;

-- Restated from 20261029001000 with the payment gate added. Security definer so the gate can read
-- the private payment state whatever path sets the status.
create or replace function private.guard_fulfillment_start() returns trigger
language plpgsql security definer set search_path = '' as $$
declare blocked text;
begin
  if new.contractor_id is null or new.matching_status is distinct from 'matched' then
    raise exception 'Work starts only after the assigned provider accepts this service' using errcode = '42501';
  end if;
  if old.status not in ('scheduled', 'vendor_completed', 'pending_review', 'disputed') then
    raise exception 'Work starts only from a scheduled service (now %)', old.status using errcode = '22023';
  end if;
  if new.recurrence_parent_id is not null then
    blocked := private.visit_start_payment_block(new);
    if blocked is not null then raise exception '%', blocked using errcode = '22023'; end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_fulfillment_start() from public, anon, authenticated;

-- Operations records a payment exception and starts the visit in one step. The exception row keeps the
-- actor, reason and payment state; the start event records the payment state, the reason and
-- payment_exception. A paid visit simply starts. A retry with the same key replays through start_job.
create function public.admin_start_visit_payment_exception(_job_id uuid, _operation_key uuid, _reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_admin(); why text := btrim(coalesce(_reason, '')); r public.service_requests;
  state text; result jsonb;
begin
  if _job_id is null or _operation_key is null then raise exception 'Service and operation key required' using errcode = '22023'; end if;
  if length(why) = 0 then raise exception 'Enter the reason work may start before payment' using errcode = '22023'; end if;
  if length(why) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into r from public.service_requests where id = _job_id;
  if r.id is null or r.recurrence_parent_id is null then
    raise exception 'A payment exception applies only to a recurring visit' using errcode = '22023';
  end if;
  state := private.recurring_visit_payment(r, now())->>'state';
  if state not in ('ready', 'processing', 'failed', 'unknown', 'paid') then
    raise exception 'This visit can''t start before payment: it needs review, is held or its terms are blocked' using errcode = '22023';
  end if;
  if state <> 'paid' then
    insert into private.visit_start_payment_exceptions(job_id, actor_id, reason, payment_state, operation_key)
      values (r.id, actor, why, state, _operation_key) on conflict (operation_key) do nothing;
  end if;
  result := public.start_job(_job_id, _operation_key, why);
  return result || jsonb_build_object('payment_exception', state <> 'paid');
end $$;
revoke all on function public.admin_start_visit_payment_exception(uuid, uuid, text) from public, anon;
grant execute on function public.admin_start_visit_payment_exception(uuid, uuid, text) to authenticated;

-- start_job: restated from 20261029001000 with one added start-event key, payment_exception.
create or replace function public.start_job(_job_id uuid, _operation_key uuid, _reason text default null) returns jsonb
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
    jsonb_build_object('start_key', _operation_key, 'source', 'start_job', 'payment_at_start', payment,
      'payment_exception', private.visit_start_exception_now(r.id)));
  return jsonb_build_object('outcome', 'started', 'status', 'in_progress', 'started_at', now());
end $$;
