-- TRACE-123 (Phase 6.6, first sub-slice): recurring visit identities and duplicate-safe,
-- auditable visit creation. Additive except where noted; no money, charge, invoice,
-- scheduler or notification-delivery effect.
--
-- A recurring request accepted by a provider is the plan (series); each visit is its own
-- service request (DEC-2026-010) with its own offer, acceptance, completion evidence and,
-- through TRACE-059, its own commercial identity. This migration:
--
-- 1. private.recurring_series_terms: the terms a provider accepted for the plan, recorded at
--    acceptance (provider, package, price level, package revision, visit price and total,
--    property and answers). Visits are created only on those terms.
-- 2. private.recurring_visit_generations: an append-only record of every attempt to add a
--    visit: created, existing (a retry or a second operator reached the same visit) or
--    blocked (with a reason code and no visit).
-- 3. admin_create_recurring_visit: operations adds one visit at an explicit Eastern wall
--    time. The visit identity is derived from the plan and the Eastern calendar date, so
--    the same intended visit is never created twice, whatever key a caller sends. The visit
--    is offered only to the plan's provider, package and price level; nothing is substituted.
--    No cadence is computed here: anchoring, horizon, month-end, missed visits, pause/end
--    and when a visit is payable are owner decisions (DEC-2026-049, proposed).
-- 4. recurring_series: the plan, its terms, visits and creation history for participants.
-- 5. create_service_occurrence is retired (caller-chosen keys could create two visits for
--    the same date, and a missing provider raised without a record).
-- 6. A plan itself is never started or completed: work is recorded on each visit.
-- 7. The legacy job_visits triggers stop: they added shadow "visits" to a request that had no
--    acceptance, evidence or payment identity of their own. Existing rows and the functions stay.

-- 1. Accepted plan terms ------------------------------------------------------------------

create table private.recurring_series_terms (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  series_id uuid not null references public.service_requests(id),
  accepted_offer_id uuid not null unique references public.job_match_attempts(id),
  customer_id uuid not null,
  contractor_id uuid not null references public.contractors(id),
  service_catalog_id text,
  frequency text not null check (frequency in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly')),
  pricing_mode text not null,
  package_id uuid,
  package_tier_id uuid,
  package_revision text,
  visit_price numeric,
  visit_total numeric,
  pricing_inputs jsonb,
  address text,
  city text,
  state text,
  zip_code text,
  package_question_answers jsonb,
  accepted_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index recurring_series_terms_series on private.recurring_series_terms(series_id, seq);

-- 2. Visit creation history ---------------------------------------------------------------

create table private.recurring_visit_generations (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  series_id uuid not null references public.service_requests(id),
  terms_id uuid references private.recurring_series_terms(id),
  operation_key uuid not null,
  actor_id uuid not null,
  reason text not null check (length(btrim(reason)) > 0),
  starts_at timestamptz not null,
  local_start timestamp not null,
  visit_key uuid not null,
  outcome text not null check (outcome in ('created', 'existing', 'blocked')),
  block_code text check (block_code in ('series_not_active', 'terms_missing', 'quote_terms', 'promotion_decision',
    'homeowner_not_admitted', 'terms_changed', 'provider_ineligible', 'visit_date_taken')),
  occurrence_id uuid references public.service_requests(id),
  created_at timestamptz not null default now(),
  unique (series_id, operation_key),
  check ((outcome = 'blocked') = (block_code is not null)),
  check (outcome = 'blocked' or occurrence_id is not null)
);
create unique index recurring_visit_generations_one_created on private.recurring_visit_generations(series_id, visit_key)
  where outcome = 'created';
create index recurring_visit_generations_series on private.recurring_visit_generations(series_id, seq);

create function private.recurring_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Recurring plan history is append-only' using errcode = '55000';
end $$;
create trigger append_only before update or delete on private.recurring_series_terms
  for each row execute function private.recurring_append_only();
create trigger append_only before update or delete on private.recurring_visit_generations
  for each row execute function private.recurring_append_only();

alter table private.recurring_series_terms enable row level security;
alter table private.recurring_visit_generations enable row level security;
revoke all on private.recurring_series_terms, private.recurring_visit_generations from public, anon, authenticated;
revoke all on function private.recurring_append_only() from public, anon, authenticated;

-- A visit's identity: the plan and the Eastern calendar date of the visit.
create function private.recurring_visit_key(p_series uuid, p_visit_date date) returns uuid
language sql immutable set search_path = '' as $$
  select md5('mercurius-recurring-visit:' || p_series::text || ':' || p_visit_date::text)::uuid
$$;
revoke all on function private.recurring_visit_key(uuid, date) from public, anon, authenticated;

-- Terms are recorded when the plan's provider accepts it (vendor_accept_job sets scheduled).
create function private.record_recurring_series_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare offer public.job_match_attempts;
begin
  select a.* into offer from public.job_match_attempts a
    where a.service_request_id = new.id and a.contractor_id = new.contractor_id and a.outcome = 'accepted'
    order by a.accepted_at desc nulls last, a.offered_at desc limit 1;
  if offer.id is null then return new; end if;
  insert into private.recurring_series_terms(series_id, accepted_offer_id, customer_id, contractor_id, service_catalog_id,
    frequency, pricing_mode, package_id, package_tier_id, package_revision, visit_price, visit_total, pricing_inputs,
    address, city, state, zip_code, package_question_answers, accepted_at)
  values (new.id, offer.id, new.customer_id, new.contractor_id, new.service_catalog_id,
    new.frequency, coalesce(new.pricing_mode, 'custom_quote'), new.package_id, new.package_tier_id,
    case when new.package_id is not null then private.package_revision_hash(new.package_id) end,
    offer.base_price, offer.effective_price,
    case when new.pricing_inputs->>'version' = 'pricing-v2' and new.pricing_inputs->>'status' = 'exact'
      and exists(select 1 from jsonb_array_elements(coalesce(new.pricing_inputs->'lines', '[]'::jsonb)) l where l->>'kind' = 'addon')
      then new.pricing_inputs end,
    new.address, new.city, new.state, new.zip_code, new.package_question_answers, coalesce(offer.accepted_at, now()))
  on conflict (accepted_offer_id) do nothing;
  return new;
end $$;
revoke all on function private.record_recurring_series_terms() from public, anon, authenticated;
create trigger record_recurring_series_terms after update of status on public.service_requests
  for each row when (new.status = 'scheduled' and old.status is distinct from 'scheduled'
    and new.recurrence_parent_id is null and new.frequency is not null and new.frequency <> 'one-time'
    and new.contractor_id is not null)
  execute function private.record_recurring_series_terms();

-- 6. A plan is not a visit: work, evidence and confirmation belong to each visit.
create function private.guard_recurring_series_work() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Work is recorded on each recurring visit, not on the plan' using errcode = '22023';
end $$;
revoke all on function private.guard_recurring_series_work() from public, anon, authenticated;
create trigger guard_recurring_series_work before update of status on public.service_requests
  for each row when (new.recurrence_parent_id is null and new.frequency is not null and new.frequency <> 'one-time'
    and old.status is distinct from new.status
    and new.status in ('in_progress', 'pending_review', 'vendor_completed', 'homeowner_confirmed', 'completed',
      'disputed', 'resolved', 'review_requested', 'reviewed'))
  execute function private.guard_recurring_series_work();

-- 7. Legacy shadow visits stop being generated (rows and functions are kept).
drop trigger if exists trg_generate_recurring_visits on public.service_requests;
drop trigger if exists trg_top_up_recurring_visits on public.job_visits;

-- 3. Creating a visit -------------------------------------------------------------------

create function public.admin_create_recurring_visit(_series_id uuid, _operation_key uuid, _starts_at timestamptz,
  _local_start timestamp, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; t private.recurring_series_terms; prior private.recurring_visit_generations;
  existing public.service_requests; offer public.job_match_attempts; p public.vendor_packages; tier public.package_tiers;
  visit uuid; code text; outcome text; occurrence uuid; generation uuid; offer_id uuid; message text; label text;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _series_id is null or _operation_key is null or _starts_at is null or _local_start is null
    or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, visit time, Eastern time, operation key and reason required' using errcode = '22023';
  end if;
  -- The same lock as matching on the plan: one visit decision per plan at a time.
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from private.recurring_visit_generations where series_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.actor_id <> auth.uid() or prior.reason <> btrim(_reason) or prior.starts_at <> _starts_at
      or prior.local_start <> _local_start then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('generation_id', prior.id, 'outcome', prior.outcome, 'code', prior.block_code,
      'occurrence_id', prior.occurrence_id, 'visit_key', prior.visit_key, 'starts_at', prior.starts_at,
      'local_start', prior.local_start, 'timezone', 'America/New_York', 'replayed', true);
  end if;

  if r.recurrence_parent_id is not null or r.occurrence_key is not null or r.frequency is null or r.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  if date_trunc('minute', _starts_at) <> _starts_at or (_starts_at at time zone 'America/New_York') <> _local_start then
    raise exception 'The visit time does not match the Eastern Time entered' using errcode = '22023';
  end if;
  if _starts_at <= now() then raise exception 'Choose a future visit time' using errcode = '22023'; end if;

  visit := private.recurring_visit_key(r.id, _local_start::date);
  select * into t from private.recurring_series_terms
    where series_id = r.id and contractor_id is not distinct from r.contractor_id order by seq desc limit 1;

  -- Business conditions that prevent a visit are recorded, not raised, so operations can see and resolve them.
  select * into existing from public.service_requests where recurrence_parent_id = r.id and occurrence_key = visit;
  if existing.id is not null then
    if existing.scheduled_start_at = _starts_at and existing.status <> 'cancelled' then
      outcome := 'existing'; occurrence := existing.id;
    else
      code := 'visit_date_taken'; occurrence := existing.id;
    end if;
  elsif r.status <> 'scheduled' or r.contractor_id is null then code := 'series_not_active';
  elsif t.id is null then code := 'terms_missing';
  elsif t.pricing_mode <> 'fixed' or r.quote_only is true or r.current_quote_id is not null then code := 'quote_terms';
  elsif r.promotion_id is not null or exists(select 1 from private.promotion_redemptions x
      where x.service_request_id = r.id and x.status in ('reserved', 'finalized')) then code := 'promotion_decision';
  elsif not private.r0_trial_admitted(r.customer_id, r.zip_code, r.service_catalog_id) then code := 'homeowner_not_admitted';
  else
    select * into p from public.vendor_packages where id = t.package_id;
    select * into tier from public.package_tiers where id = t.package_tier_id;
    if p.id is null or tier.id is null or not p.is_active or p.needs_review is true
      or private.package_revision_hash(p.id) is distinct from t.package_revision
      or tier.price is distinct from t.visit_price or tier.frequency is distinct from t.frequency
      or r.package_id is distinct from t.package_id or r.package_tier_id is distinct from t.package_tier_id
      or r.frequency is distinct from t.frequency
      or row(r.address, r.city, r.state, r.zip_code, r.service_catalog_id) is distinct from row(t.address, t.city, t.state, t.zip_code, t.service_catalog_id)
      or r.package_question_answers is distinct from t.package_question_answers then
      code := 'terms_changed';
    end if;
  end if;

  if code is null and outcome is null then
    begin
      insert into public.service_requests(customer_id, service_type, service_catalog_id, address, city, state, zip_code,
        description, frequency, package_id, package_tier_id, package_question_answers, preferred_contractor_id,
        recurrence_parent_id, occurrence_key, scheduled_start_at, preferred_date, timezone, pricing_inputs)
      values (r.customer_id, r.service_type, r.service_catalog_id, r.address, r.city, r.state, r.zip_code,
        r.description, r.frequency, t.package_id, t.package_tier_id, r.package_question_answers, t.contractor_id,
        r.id, visit, _starts_at, _local_start::date, 'America/New_York', t.pricing_inputs)
      returning id into occurrence;
      -- Only the plan's provider, package and price level; a refusal is recorded below, never substituted.
      offer_id := private.create_job_offer_internal(occurrence, t.contractor_id, t.package_id, t.package_tier_id, false);
      select * into offer from public.job_match_attempts where id = offer_id;
      if offer.contractor_id is distinct from t.contractor_id or offer.package_id is distinct from t.package_id
        or offer.package_tier_id is distinct from t.package_tier_id or offer.base_price is distinct from t.visit_price
        or offer.effective_price is distinct from t.visit_total then
        raise exception 'recurring terms changed' using errcode = 'MR661';
      end if;
    exception
      when sqlstate 'MR661' then code := 'terms_changed'; occurrence := null;
      when others then
        get stacked diagnostics message = message_text;
        if message in ('Selected contractor/package is no longer eligible for this request',
          'Homeowner consent is required before provider fallback') then
          code := 'provider_ineligible'; occurrence := null;
        else
          raise;
        end if;
    end;
  end if;

  outcome := coalesce(outcome, case when code is null then 'created' else 'blocked' end);
  if code is not null and code <> 'visit_date_taken' then occurrence := null; end if;
  insert into private.recurring_visit_generations(series_id, terms_id, operation_key, actor_id, reason, starts_at,
    local_start, visit_key, outcome, block_code, occurrence_id)
  values (r.id, t.id, _operation_key, auth.uid(), btrim(_reason), _starts_at, _local_start, visit, outcome, code, occurrence)
  returning id into generation;

  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'recurring_visit',
    'outcome', outcome, 'code', code, 'occurrence_id', occurrence, 'operation_key', _operation_key,
    'reason', btrim(_reason), 'scheduled_at', _starts_at));
  if outcome = 'created' then
    perform public.log_job_event(occurrence, 'status_changed', auth.uid(), jsonb_build_object('action', 'occurrence_created',
      'template_id', r.id, 'reason', btrim(_reason), 'scheduled_at', _starts_at, 'generation_id', generation));
    label := to_char(_local_start, 'Dy, Mon FMDD, YYYY, FMHH12:MI AM') || ' '
      || case when _local_start - (_starts_at at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end;
    perform public.notify_user(r.customer_id, 'job_status', 'info', 'Recurring visit added',
      label || ' (Eastern Time). The provider accepts each visit separately. ' || btrim(_reason), '/dashboard', occurrence, t.contractor_id);
  end if;
  return jsonb_build_object('generation_id', generation, 'outcome', outcome, 'code', code, 'occurrence_id', occurrence,
    'visit_key', visit, 'starts_at', _starts_at, 'local_start', _local_start, 'timezone', 'America/New_York', 'replayed', false);
end $$;
revoke all on function public.admin_create_recurring_visit(uuid, uuid, timestamptz, timestamp, text) from public, anon;
grant execute on function public.admin_create_recurring_visit(uuid, uuid, timestamptz, timestamp, text) to authenticated;

-- 4. Readback -----------------------------------------------------------------------------

-- The plan, its current terms, its visits and their creation history. Accepts the plan or one
-- of its visits. Homeowner, the plan's current provider and operations only; payment state is
-- not shown to the provider.
create function public.recurring_series(_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; s public.service_requests; t private.recurring_series_terms;
  viewer uuid := auth.uid(); is_admin boolean; is_owner boolean; is_provider boolean; result jsonb;
begin
  if viewer is null then raise exception 'Not a participant in this service' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _series_id;
  if r.id is not null then
    select * into s from public.service_requests where id = coalesce(r.recurrence_parent_id, r.id);
  end if;
  is_admin := coalesce(public.has_role(viewer, 'admin'), false);
  is_owner := s.customer_id = viewer;
  is_provider := exists(select 1 from public.contractors c where c.id = s.contractor_id and c.user_id = viewer);
  if s.id is null or not (is_admin or coalesce(is_owner, false) or is_provider) then
    raise exception 'Not a participant in this service' using errcode = '42501';
  end if;
  if s.recurrence_parent_id is not null or s.frequency is null or s.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  select * into t from private.recurring_series_terms
    where series_id = s.id and contractor_id is not distinct from s.contractor_id order by seq desc limit 1;

  select jsonb_build_object(
    'series_id', s.id, 'timezone', 'America/New_York', 'frequency', s.frequency, 'status', s.status,
    'has_provider', s.contractor_id is not null,
    'terms', case when t.id is null then null else jsonb_build_object(
      'provider', (select c.name from public.contractors c where c.id = t.contractor_id),
      'package', (select p.name from public.vendor_packages p where p.id = t.package_id),
      'price_level', (select x.name from public.package_tiers x where x.id = t.package_tier_id),
      'pricing_mode', t.pricing_mode, 'frequency', t.frequency, 'visit_price', t.visit_price, 'visit_total', t.visit_total,
      'has_addons', t.pricing_inputs is not null, 'accepted_at', t.accepted_at) end,
    'visits', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'visit_key', v.occurrence_key, 'starts_at', v.scheduled_start_at,
      'local_start', to_char(v.scheduled_start_at at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24:MI:SS'),
      'status', v.status, 'matching_status', v.matching_status,
      'offer', (select a.outcome from public.job_match_attempts a where a.service_request_id = v.id order by a.attempt_number desc limit 1),
      'plan_provider', v.contractor_id is not distinct from s.contractor_id,
      'provider_completed_at', v.vendor_completed_at, 'homeowner_confirmed_at', v.homeowner_confirmed_at,
      'payment', case when is_provider and not is_admin then null
        else coalesce((select case when o.captured > 0 then 'paid' when o.current_snapshot_id is not null then 'awaiting_payment' end
          from public.money_obligations o where o.service_request_id = v.id), 'none') end)
      order by v.scheduled_start_at, v.id)
      from public.service_requests v where v.recurrence_parent_id = s.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'at', g.created_at, 'outcome', g.outcome, 'code', g.block_code, 'starts_at', g.starts_at,
      'local_start', g.local_start, 'occurrence_id', g.occurrence_id, 'actor', 'operations', 'reason', g.reason,
      'operation_key', case when g.actor_id = viewer then g.operation_key end) order by g.seq)
      from private.recurring_visit_generations g where g.series_id = s.id), '[]'::jsonb))
  into result;
  return result;
end $$;
revoke all on function public.recurring_series(uuid) from public, anon;
grant execute on function public.recurring_series(uuid) to authenticated;

-- 5. The caller-keyed path is retired (same signature and grants) ---------------------------

-- Restates 20261018006000. Replaced by admin_create_recurring_visit (TRACE-123).
create or replace function public.create_service_occurrence(_template_id uuid, _occurrence_key uuid,
  _scheduled_at timestamptz, _reason text)
returns uuid language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
begin
  raise exception 'Create recurring visits with admin_create_recurring_visit' using errcode = '22023';
end $$;
