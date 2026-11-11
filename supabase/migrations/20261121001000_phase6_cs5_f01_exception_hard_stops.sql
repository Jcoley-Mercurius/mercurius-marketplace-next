-- Phase 6 CS5-F01 forward fix (TRACE-145; governance/PHASE-6-PR157-158-CODEX-REVIEW.md CS5-F01;
-- plan governance/PHASE-6-BOUND-TERMS-PLAN.md §5.2). Additive: 20261113001000 and 20261120001000 are
-- recorded applied and are not edited.
--
-- The approved policy (DEC-2026-050 A, DEC-2026-060 D-4): operations may record a payment exception for
-- a job or visit that is ready but unpaid, processing, failed or of unknown outcome; never for a held,
-- terms-blocked or unreviewed one. 20261113001000 and 20261120001000 decided eligibility from the display
-- state alone. Its priority (unknown and processing come before held, terms and snapshot) is right for the
-- queue and the refusal text, but it let an open checkout or an unresolved outcome hide a hold, blocked
-- terms or a missing or expired reviewed price, and the exception was then accepted.
--
-- * private.start_exception_hard_stop(r, p_at) checks the three exclusions independently of the display
--   state: a hold on the obligation (dispute or refund), the commercial source (the same lock-free checks
--   the classifiers call: recurring_visit_source_check for a visit, one_time_source_problem for a one-time
--   job), and the reviewed snapshot (present, and not expiring within the classifiers' 31-minute window).
--   Its codes and order are the classifiers' review_pending reasons, so a job that reaches the classifiers'
--   final branch gets the same answer from both (SQL 098 checks this parity on every fixture).
-- * admin_start_visit_payment_exception refuses an unpaid exception when a hard stop exists, before any
--   exception row is written. Restated from 20261120001000; lock order (request advisory lock, then the
--   row), authorization, reason, keyed append-only exception row and the start through start_job are
--   unchanged.
-- * visit_start_payment_block and one_time_start_payment_block (the start guard trigger's checks, on every
--   path to in_progress) honor a same-transaction exception only when no hard stop exists, checked again
--   at the start. A refused start shows the hard stop's existing refusal text.
--
-- Unchanged: the display state and its priority (queues, job pages, payment recorded at start), the paid
-- start (captured >= the snapshot total), the exception being scheduled-only (start_job), rework and
-- payout rules, prices and every money function (fingerprint list unchanged). No table locks are added:
-- the source checks stay lock-free reads, as in 20261120001000.

-- 1. The exclusions, independent of the display state. Null when an unpaid exception may apply. -------
create function private.start_exception_hard_stop(r public.service_requests, p_at timestamptz) returns text
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; s public.money_snapshots;
begin
  if r.id is null then raise exception 'Service required'; end if;
  if r.recurrence_parent_id is null and coalesce(r.frequency, 'one-time') <> 'one-time' then
    raise exception 'A recurring visit or a one-time job required';
  end if;
  select * into o from public.money_obligations where service_request_id = r.id;
  if o.id is not null then select * into s from public.money_snapshots where id = o.current_snapshot_id; end if;
  if coalesce(o.dispute_open, false) or coalesce(o.refunded_service + o.refunded_tax + o.refunded_tip, 0) > 0 then
    return 'held';
  end if;
  if r.recurrence_parent_id is not null then
    if not coalesce((private.recurring_visit_source_check(r)->>'ok')::boolean, false) then return 'source_blocked'; end if;
  elsif private.one_time_source_problem(r) is not null then
    return 'source_blocked';
  end if;
  if s.id is null then return 'no_snapshot'; end if;
  if s.expires_at <= p_at + interval '31 minutes' then return 'snapshot_expired'; end if;
  return null;
end $$;
revoke all on function private.start_exception_hard_stop(public.service_requests, timestamptz) from public, anon, authenticated, service_role;

-- 2. Recurring visit start check: restated from 20261113001000; an exception is honored only without a
--    hard stop. Refusal texts unchanged.
create or replace function private.visit_start_payment_block(r public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb; state text; reason text; stop text;
begin
  p := private.recurring_visit_payment(r, now());
  state := p->>'state'; reason := p->>'reason';
  if state = 'paid' then return null; end if;
  if state in ('ready', 'processing', 'failed', 'unknown') and private.visit_start_exception_now(r.id) then
    stop := private.start_exception_hard_stop(r, now());
    if stop is null then return null; end if;
    state := 'review_pending'; reason := stop;
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

-- 3. One-time job start check: restated from 20261120001000 the same way. Refusal texts unchanged.
create or replace function private.one_time_start_payment_block(r public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb; state text; reason text; stop text;
begin
  p := private.one_time_job_payment(r, now());
  state := p->>'state'; reason := p->>'reason';
  if state = 'paid' then return null; end if;
  if state in ('ready', 'processing', 'failed', 'unknown') and private.visit_start_exception_now(r.id) then
    stop := private.start_exception_hard_stop(r, now());
    if stop is null then return null; end if;
    state := 'review_pending'; reason := stop;
  end if;
  return case
    when state = 'processing' then 'The homeowner''s payment for this job is still processing. Wait for the outcome before you start work.'
    when state = 'ready' then 'This job isn''t paid yet. Work can start once the homeowner pays for it.'
    when state = 'failed' then 'The homeowner''s payment for this job didn''t go through. Work can start once it''s paid.'
    when state = 'unknown' then 'Mercurius is confirming this job''s payment. Work can start once it''s confirmed.'
    when state = 'review_pending' and reason = 'held' then 'This job''s payment is on hold. Mercurius will contact you before work starts.'
    when state = 'review_pending' and reason = 'source_blocked' then 'This job''s agreed terms can''t be confirmed, so it can''t be paid or started yet. Mercurius will contact you.'
    when state = 'review_pending' then 'This job''s price hasn''t been reviewed and paid yet. Work can start once it''s paid.'
    else 'Work can start only after this job is paid.' end;
end $$;
revoke all on function private.one_time_start_payment_block(public.service_requests) from public, anon, authenticated, service_role;

-- 4. Operator exception: restated from 20261120001000; an unpaid exception is refused when a hard stop
--    exists, before the exception row is written.
create or replace function public.admin_start_visit_payment_exception(_job_id uuid, _operation_key uuid, _reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_admin(); why text := btrim(coalesce(_reason, '')); r public.service_requests;
  state text; result jsonb; visit boolean;
begin
  if _job_id is null or _operation_key is null then raise exception 'Service and operation key required' using errcode = '22023'; end if;
  if length(why) = 0 then raise exception 'Enter the reason work may start before payment' using errcode = '22023'; end if;
  if length(why) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  -- Lifecycle lock order: request advisory lock, then the row, before the payment state is read.
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  visit := r.recurrence_parent_id is not null;
  if r.id is null or (not visit and coalesce(r.frequency, 'one-time') <> 'one-time') then
    raise exception 'A payment exception applies only to a recurring visit or a one-time job' using errcode = '22023';
  end if;
  state := case when visit then private.recurring_visit_payment(r, now())->>'state'
    else private.one_time_job_payment(r, now())->>'state' end;
  if state not in ('ready', 'processing', 'failed', 'unknown', 'paid')
     or (state <> 'paid' and private.start_exception_hard_stop(r, now()) is not null) then
    raise exception '%', case when visit then 'This visit can''t start before payment: it needs review, is held or its terms are blocked'
      else 'This job can''t start before payment: it needs review, is held or its terms are blocked' end using errcode = '22023';
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
