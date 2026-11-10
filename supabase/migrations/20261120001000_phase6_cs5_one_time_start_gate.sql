-- Phase 6 CS-5 one-time extension (TRACE-145; DEC-2026-050 A as approved by DEC-2026-060 D-4;
-- governance/PHASE-6-BOUND-TERMS-PLAN.md §5; Codex A1 review §6 item 3).
--
-- A one-time job starts only when it is paid: captured >= the reviewed snapshot total, the same rule
-- 20261113001000 applies to recurring visits. Every other state is refused with its reason.
-- Operations may record a payment exception, with a reason, for a job that is ready but unpaid,
-- processing, failed or of unknown outcome; never for a held, terms-blocked or unreviewed job.
-- Payout still requires full capture (unchanged).
--
-- * private.one_time_job_payment classifies a one-time job into the six approved states with the same
--   order and the same shared G6 classification (private.money_payment_exceptions) as
--   private.recurring_visit_payment. "Terms blocked" uses the existing lock-free source checks of the
--   commercial source: the accepted quote's validity (as money_source), CS-3's
--   private.one_time_bound_problem for the submitted offering, O-10's private.offer_terms_problem for
--   accepted terms, and terms_missing otherwise (as money_source, which refuses such a request by name).
--   money_source itself is not called: it takes table share locks, which a start must not take.
-- * The start guard trigger gates every path to in_progress (provider start, operator start,
--   admin status change, rework restart) for one-time jobs as it already does for visits.
-- * admin_start_visit_payment_exception accepts one-time jobs too (same keyed, append-only,
--   same-transaction exception row). It now takes the request advisory lock, then the row, before it
--   reads the payment state (the lifecycle order; start_job re-takes both re-entrantly).
-- * fulfillment_payment_state reports the six states for one-time jobs (recorded at start).
--
-- Additive. Recurring-visit wording and behavior are unchanged. No money function changes: the
-- functions here only read obligations, snapshots, attempts and the shared exception classification.

-- 1. Terms check for a one-time job's commercial source (null when the source can be priced). ------
create function private.one_time_source_problem(r public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
declare q public.request_quotes; offer public.job_match_attempts; t public.job_offer_terms;
begin
  if r.id is null or r.recurrence_parent_id is not null then raise exception 'One-time job required'; end if;
  if r.current_quote_id is not null then
    select * into q from public.request_quotes where id = r.current_quote_id;
    if q.id is null or q.request_id <> r.id or q.revision <> r.quote_revision or q.status <> 'accepted'
      or r.quote_status is distinct from 'accepted' or q.decision_actor is distinct from r.customer_id
      or q.decided_at is null or q.decided_at < q.sent_at or q.decided_at >= q.expires_at then
      return 'quote_not_accepted';
    end if;
    return null;
  end if;
  if r.quote_only is true or r.pricing_mode is distinct from 'fixed' or r.quote_status is not null then
    return 'quote_terms';
  end if;
  -- CS-3: the submitted offering, when the accepted package and level are the ones priced at submission
  -- (the same condition as money_source).
  if r.pricing_inputs->>'version' = 'pricing-v2' and r.pricing_inputs->>'status' = 'exact'
     and r.package_id is not null and r.package_tier_id is not null
     and r.pricing_inputs->>'package_id' = r.package_id::text
     and nullif(r.pricing_inputs->>'tier_id', '') = r.package_tier_id::text then
    return private.one_time_bound_problem(r, null);
  end if;
  -- O-10: the bound terms of the accepted offer.
  select a.* into offer from public.job_match_attempts a
    where a.service_request_id = r.id and a.outcome = 'accepted' and a.contractor_id = r.contractor_id
    order by a.accepted_at desc nulls last, a.id desc limit 1;
  if offer.id is not null then
    select * into t from public.job_offer_terms where offer_id = offer.id;
    if t.id is not null then return private.offer_terms_problem(r, offer, t); end if;
  end if;
  return 'terms_missing';
end $$;
revoke all on function private.one_time_source_problem(public.service_requests) from public, anon, authenticated, service_role;

-- 2. A one-time job's payment state, in the order and with the meanings of recurring_visit_payment. ---
create function private.one_time_job_payment(v public.service_requests, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; s public.money_snapshots; a public.money_checkout_attempts;
  x_kind text; problem text; state text; reason text;
begin
  if v.id is null or v.recurrence_parent_id is not null then raise exception 'One-time job required'; end if;
  select * into o from public.money_obligations where service_request_id = v.id;
  if o.id is not null then
    select * into s from public.money_snapshots where id = o.current_snapshot_id;
    select * into a from public.money_checkout_attempts where obligation_id = o.id order by created_at desc, attempt_number desc, id desc limit 1;
    select e.kind into x_kind from private.money_payment_exceptions(p_at) e where e.obligation_id = o.id;
  end if;
  if s.id is not null and o.captured >= s.total then state := 'paid';
  elsif v.status = 'cancelled' then state := 'cancelled';
  elsif v.contractor_id is null or v.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    state := 'not_accepted';
  elsif x_kind = 'payment_unresolved' then state := 'unknown';
  elsif o.captured > 0 then state := 'unknown'; reason := 'partial_capture';
  elsif a.status in ('prepared', 'session_created') and a.expires_at > p_at then state := 'processing';
  elsif coalesce(o.dispute_open, false) or coalesce(o.refunded_service + o.refunded_tax + o.refunded_tip, 0) > 0 then
    state := 'review_pending'; reason := 'held';
  else
    problem := private.one_time_source_problem(v);
    if problem is not null then state := 'review_pending'; reason := 'source_blocked';
    elsif s.id is null then state := 'review_pending'; reason := 'no_snapshot';
    elsif s.expires_at <= p_at + interval '31 minutes' then state := 'review_pending'; reason := 'snapshot_expired';
    elsif x_kind = 'payment_failed' then state := 'failed';
    else state := 'ready';
    end if;
  end if;
  return jsonb_build_object('state', state, 'reason', reason, 'obligation_id', o.id,
    'snapshot_id', case when s.id is not null and state in ('ready', 'failed', 'processing', 'paid', 'unknown') then s.id end,
    'amount_cents', s.total, 'attempt_status', a.status, 'problem', problem);
end $$;
revoke all on function private.one_time_job_payment(public.service_requests, timestamptz) from public, anon, authenticated, service_role;

-- 3. The refusal a provider or operator sees, or null when the job may start. ------------------------
create function private.one_time_start_payment_block(r public.service_requests) returns text
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb; state text; reason text;
begin
  p := private.one_time_job_payment(r, now());
  state := p->>'state'; reason := p->>'reason';
  if state = 'paid' then return null; end if;
  if state in ('ready', 'processing', 'failed', 'unknown') and private.visit_start_exception_now(r.id) then
    return null;
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

-- 4. Start guard: restated from 20261113001000; one-time jobs are now gated as well. -----------------
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
  elsif coalesce(new.frequency, 'one-time') = 'one-time' then
    -- CS-5 one-time extension. A recurring plan is never worked itself (its own guard refuses it).
    blocked := private.one_time_start_payment_block(new);
  end if;
  if blocked is not null then raise exception '%', blocked using errcode = '22023'; end if;
  return new;
end $$;
revoke all on function private.guard_fulfillment_start() from public, anon, authenticated;

-- 5. Payment state recorded at start: the six states for one-time jobs too. ------------------------
create or replace function private.fulfillment_payment_state(r public.service_requests) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p jsonb;
begin
  if r.recurrence_parent_id is not null then
    p := private.recurring_visit_payment(r, now());
    return jsonb_build_object('state', p->>'state', 'reason', p->>'reason', 'obligation_id', p->>'obligation_id');
  end if;
  p := private.one_time_job_payment(r, now());
  return jsonb_build_object('state', p->>'state', 'reason', p->>'reason', 'obligation_id', p->>'obligation_id',
    'legacy_payment_status', r.payment_status::text);
end $$;
revoke all on function private.fulfillment_payment_state(public.service_requests) from public, anon, authenticated, service_role;

-- 6. Operator exception: restated from 20261113001000 for recurring visits and one-time jobs. -------
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
  if state not in ('ready', 'processing', 'failed', 'unknown', 'paid') then
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
