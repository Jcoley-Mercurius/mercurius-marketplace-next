-- TRACE-124 (Phase 6.6b): recurring cadence anchors, proposed visits and plan pause/resume/stop.
-- Owner decision DEC-2026-049 items 1–4 and 9 (Josh, 2026-10-26). Additive; no money, charge,
-- invoice, refund, payout, scheduler or notification-delivery effect.
--
-- 1. private.recurring_series_anchors: the agreed Eastern date and time the cadence counts from,
--    with operator, basis, reason and the anchor it replaces (append-only, one linear chain).
--    Recording an anchor creates nothing and confirms no appointment.
-- 2. private.recurring_series_lifecycle: pause, resume and stop future visits (append-only, one
--    linear chain). The plan's own request status is never changed by these actions.
-- 3. private.recurring_cadence_resolutions: a cadence date explicitly skipped, or replaced by an
--    off-cadence visit of the same plan, recorded under the anchor in force (append-only).
-- 4. private.recurring_cadence_preview: proposed visits as of an instant. A read: no visit,
--    offer, notice or money record.
-- 5. Visit creation moves into private.create_recurring_visit_core; admin_create_recurring_visit
--    (manual, unchanged signature) and admin_create_cadence_visit (from a current proposal) both
--    use it, so every path keeps the 6.6a lock, replay, terms and eligibility checks and records
--    series_paused / series_ended while the plan is paused or stopped.
-- 6. recurring_series gains the plan state and anchor for participants, and the cadence, its
--    history and the proposals for operations.

-- 1. Anchors --------------------------------------------------------------------------------

create table private.recurring_series_anchors (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  series_id uuid not null references public.service_requests(id),
  replaces_anchor_id uuid references private.recurring_series_anchors(id),
  operation_key uuid not null,
  actor_id uuid not null,
  starts_at timestamptz not null,
  local_start timestamp not null,
  basis text not null check (length(btrim(basis)) > 0),
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (series_id, operation_key),
  -- One successor per anchor (and one first anchor): a re-anchor from a stale read cannot fork.
  unique nulls not distinct (series_id, replaces_anchor_id)
);
create index recurring_series_anchors_series on private.recurring_series_anchors(series_id, seq);

-- 2. Lifecycle ------------------------------------------------------------------------------

create table private.recurring_series_lifecycle (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  series_id uuid not null references public.service_requests(id),
  previous_id uuid references private.recurring_series_lifecycle(id),
  operation_key uuid not null,
  actor_id uuid not null,
  action text not null,
  from_state text not null,
  to_state text not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (series_id, operation_key),
  unique nulls not distinct (series_id, previous_id),
  check ((action, from_state, to_state) in (('pause', 'active', 'paused'), ('resume', 'paused', 'active'),
    ('stop', 'active', 'ended'), ('stop', 'paused', 'ended')))
);
create index recurring_series_lifecycle_series on private.recurring_series_lifecycle(series_id, seq);

-- 3. Skipped and replaced cadence dates -------------------------------------------------------

create table private.recurring_cadence_resolutions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  series_id uuid not null references public.service_requests(id),
  anchor_id uuid not null references private.recurring_series_anchors(id),
  cadence_date date not null,
  kind text not null check (kind in ('skipped', 'replaced')),
  occurrence_id uuid references public.service_requests(id),
  operation_key uuid not null,
  actor_id uuid not null,
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (series_id, operation_key),
  unique (anchor_id, cadence_date),
  check ((kind = 'replaced') = (occurrence_id is not null))
);
-- One visit satisfies at most one cadence date.
create unique index recurring_cadence_resolutions_one_visit on private.recurring_cadence_resolutions(occurrence_id)
  where occurrence_id is not null;
create index recurring_cadence_resolutions_series on private.recurring_cadence_resolutions(series_id, seq);

create trigger append_only before update or delete on private.recurring_series_anchors
  for each row execute function private.recurring_append_only();
create trigger append_only before update or delete on private.recurring_series_lifecycle
  for each row execute function private.recurring_append_only();
create trigger append_only before update or delete on private.recurring_cadence_resolutions
  for each row execute function private.recurring_append_only();
alter table private.recurring_series_anchors enable row level security;
alter table private.recurring_series_lifecycle enable row level security;
alter table private.recurring_cadence_resolutions enable row level security;
revoke all on private.recurring_series_anchors, private.recurring_series_lifecycle, private.recurring_cadence_resolutions
  from public, anon, authenticated;

-- 4. Visit creation records its source; pause and stop are recorded refusals -------------------

alter table private.recurring_visit_generations
  add column source text not null default 'manual' check (source in ('manual', 'cadence')),
  add column anchor_id uuid references private.recurring_series_anchors(id),
  add column cadence_date date,
  add constraint recurring_visit_generations_cadence_source
    check ((source = 'cadence') = (anchor_id is not null and cadence_date is not null));
alter table private.recurring_visit_generations drop constraint recurring_visit_generations_block_code_check,
  add constraint recurring_visit_generations_block_code_check check (block_code in ('series_not_active', 'terms_missing',
    'quote_terms', 'promotion_decision', 'homeowner_not_admitted', 'terms_changed', 'provider_ineligible', 'visit_date_taken',
    'series_paused', 'series_ended'));

-- Cadence arithmetic -------------------------------------------------------------------------

-- 'active' until a lifecycle action says otherwise.
create function private.recurring_plan_state(p_series uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce((select l.to_state from private.recurring_series_lifecycle l where l.series_id = p_series
    order by l.seq desc limit 1), 'active')
$$;

-- The n-th cadence date (n = 0 is the anchor). Weeks add calendar days; months are always counted
-- from the anchor, so a 31st clamps to a shorter month's last day without drifting afterwards.
create function private.recurring_cadence_date(p_anchor date, p_frequency text, p_n integer) returns date
language sql immutable set search_path = '' as $$
  select case p_frequency
    when 'weekly' then p_anchor + 7 * p_n
    when 'bi-monthly' then p_anchor + 14 * p_n
    when 'monthly' then (p_anchor + make_interval(months => p_n))::date
    when 'every-two-months' then (p_anchor + make_interval(months => 2 * p_n))::date
    when 'quarterly' then (p_anchor + make_interval(months => 3 * p_n))::date
  end
$$;

-- The index of a cadence date, or null when the date is not one.
create function private.recurring_cadence_index(p_anchor date, p_frequency text, p_date date) returns integer
language plpgsql immutable set search_path = '' as $$
declare step integer; months integer;
begin
  if p_anchor is null or p_date is null or p_date < p_anchor then return null; end if;
  if p_frequency in ('weekly', 'bi-monthly') then
    step := case p_frequency when 'weekly' then 7 else 14 end;
    return case when (p_date - p_anchor) % step = 0 then (p_date - p_anchor) / step end;
  end if;
  step := case p_frequency when 'monthly' then 1 when 'every-two-months' then 2 when 'quarterly' then 3 end;
  if step is null then return null; end if;
  months := (extract(year from p_date)::int - extract(year from p_anchor)::int) * 12
    + extract(month from p_date)::int - extract(month from p_anchor)::int;
  if months % step <> 0 or private.recurring_cadence_date(p_anchor, p_frequency, months / step) <> p_date then return null; end if;
  return months / step;
end $$;

-- The instants an Eastern wall time names: none (spring-forward gap), one, or two (fall-back).
create function private.eastern_instants(p_local timestamp) returns table(abbreviation text, starts_at timestamptz)
language sql stable set search_path = '' as $$
  select x.abbreviation, x.starts_at from (values
    ('EDT', (p_local + interval '4 hours') at time zone 'UTC'),
    ('EST', (p_local + interval '5 hours') at time zone 'UTC')) x(abbreviation, starts_at)
  where (x.starts_at at time zone 'America/New_York') = p_local
  order by x.starts_at
$$;

-- Proposed visits as of p_at (a read with no side effects). Dates from today through today + 60
-- Eastern days, at least 24 hours away, not already handled (a visit on that date, whatever its
-- status, or a skip/replacement under the current anchor), and only as many as bring future
-- non-cancelled visits (off-cadence ones included) up to two. 'next' is the first such date
-- regardless of the horizon, for the empty state.
create function private.recurring_cadence_preview(p_series uuid, p_at timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare r public.service_requests; a private.recurring_series_anchors; plan_state text; today date; horizon date;
  upcoming integer; capacity integer; unavailable text; anchor_date date; n integer; d date; wall timestamp;
  choices jsonb; lead_at timestamptz; item jsonb; first_open jsonb; proposals jsonb := '[]'; guard integer := 0;
begin
  select * into r from public.service_requests where id = p_series;
  plan_state := private.recurring_plan_state(p_series);
  select * into a from private.recurring_series_anchors where series_id = p_series order by seq desc limit 1;
  today := (p_at at time zone 'America/New_York')::date;
  horizon := today + 60;
  select count(*) into upcoming from public.service_requests v
    where v.recurrence_parent_id = p_series and v.status <> 'cancelled' and v.scheduled_start_at > p_at;
  capacity := greatest(0, 2 - upcoming);
  unavailable := case when plan_state = 'ended' then 'ended' when plan_state = 'paused' then 'paused' when a.id is null then 'no_anchor'
    when r.status is distinct from 'scheduled' or r.contractor_id is null then 'not_active' end;

  if unavailable is null then
    anchor_date := a.local_start::date;
    -- Start just before today: date(n) <= anchor + n * (7, 14, 31, 62 or 93) days.
    n := greatest(0, (today - anchor_date) / case r.frequency when 'weekly' then 7 when 'bi-monthly' then 14
      when 'monthly' then 31 when 'every-two-months' then 62 else 93 end - 1);
    loop
      d := private.recurring_cadence_date(anchor_date, r.frequency, n);
      exit when d is null or (first_open is not null and (d > horizon or jsonb_array_length(proposals) >= capacity));
      guard := guard + 1;
      exit when guard > 2000;
      if d >= today
        and not exists(select 1 from public.service_requests v
          where v.recurrence_parent_id = p_series and v.occurrence_key = private.recurring_visit_key(p_series, d))
        and not exists(select 1 from private.recurring_cadence_resolutions x where x.anchor_id = a.id and x.cadence_date = d) then
        wall := d + a.local_start::time;
        select coalesce(jsonb_agg(jsonb_build_object('abbreviation', e.abbreviation, 'starts_at', e.starts_at) order by e.starts_at), '[]'),
          min(e.starts_at)
          into choices, lead_at from private.eastern_instants(wall) e;
        -- A time the clocks skip has no instant; its lead is measured from the EST reading (after the gap).
        lead_at := coalesce(lead_at, (wall + interval '5 hours') at time zone 'UTC');
        if lead_at >= p_at + interval '24 hours' then
          item := jsonb_build_object('cadence_date', d, 'index', n, 'local_start', to_char(wall, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'kind', case jsonb_array_length(choices) when 0 then 'nonexistent' when 1 then 'ok' else 'ambiguous' end,
            'choices', choices, 'starts_at', case when jsonb_array_length(choices) = 1 then choices->0->'starts_at' end,
            'opens_on', greatest(today, d - 60));
          if first_open is null then first_open := item; end if;
          if d <= horizon and jsonb_array_length(proposals) < capacity then proposals := proposals || item; end if;
        end if;
      end if;
      n := n + 1;
    end loop;
  end if;

  return jsonb_build_object('as_of', p_at, 'today', today, 'horizon_end', horizon, 'state', plan_state, 'unavailable', unavailable,
    'anchor_id', a.id, 'upcoming', upcoming, 'capacity', capacity, 'proposals', proposals, 'next', first_open);
end $$;

revoke all on function private.recurring_plan_state(uuid), private.recurring_cadence_date(date, text, integer),
  private.recurring_cadence_index(date, text, date), private.eastern_instants(timestamp),
  private.recurring_cadence_preview(uuid, timestamptz) from public, anon, authenticated;

-- 5. Visit creation ---------------------------------------------------------------------------

-- The 6.6a command body (20261026001000), now shared by the manual and cadence paths. Changes:
-- the source, anchor and cadence date are recorded and are part of a replay's intent; a paused
-- or stopped plan is a recorded refusal (series_paused / series_ended).
create function private.create_recurring_visit_core(_series_id uuid, _operation_key uuid, _starts_at timestamptz,
  _local_start timestamp, _reason text, _source text, _anchor_id uuid, _cadence_date date)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; t private.recurring_series_terms; prior private.recurring_visit_generations;
  existing public.service_requests; offer public.job_match_attempts; p public.vendor_packages; tier public.package_tiers;
  visit uuid; code text; outcome text; occurrence uuid; generation uuid; offer_id uuid; message text; label text; plan_state text;
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
      or prior.local_start <> _local_start or prior.source <> _source or prior.anchor_id is distinct from _anchor_id
      or prior.cadence_date is distinct from _cadence_date then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('generation_id', prior.id, 'outcome', prior.outcome, 'code', prior.block_code,
      'occurrence_id', prior.occurrence_id, 'visit_key', prior.visit_key, 'starts_at', prior.starts_at,
      'local_start', prior.local_start, 'timezone', 'America/New_York', 'source', prior.source,
      'cadence_date', prior.cadence_date, 'replayed', true);
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
  plan_state := private.recurring_plan_state(r.id);

  -- Business conditions that prevent a visit are recorded, not raised, so operations can see and resolve them.
  select * into existing from public.service_requests where recurrence_parent_id = r.id and occurrence_key = visit;
  if existing.id is not null then
    if existing.scheduled_start_at = _starts_at and existing.status <> 'cancelled' then
      outcome := 'existing'; occurrence := existing.id;
    else
      code := 'visit_date_taken'; occurrence := existing.id;
    end if;
  -- Pause and stop are restrictions on top of every other condition; they never make a plan active.
  elsif plan_state = 'ended' then code := 'series_ended';
  elsif plan_state = 'paused' then code := 'series_paused';
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
    local_start, visit_key, outcome, block_code, occurrence_id, source, anchor_id, cadence_date)
  values (r.id, t.id, _operation_key, auth.uid(), btrim(_reason), _starts_at, _local_start, visit, outcome, code, occurrence,
    _source, _anchor_id, _cadence_date)
  returning id into generation;

  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'recurring_visit',
    'outcome', outcome, 'code', code, 'occurrence_id', occurrence, 'operation_key', _operation_key,
    'reason', btrim(_reason), 'scheduled_at', _starts_at, 'source', _source, 'cadence_date', _cadence_date));
  if outcome = 'created' then
    perform public.log_job_event(occurrence, 'status_changed', auth.uid(), jsonb_build_object('action', 'occurrence_created',
      'template_id', r.id, 'reason', btrim(_reason), 'scheduled_at', _starts_at, 'generation_id', generation));
    label := to_char(_local_start, 'Dy, Mon FMDD, YYYY, FMHH12:MI AM') || ' '
      || case when _local_start - (_starts_at at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end;
    perform public.notify_user(r.customer_id, 'job_status', 'info', 'Recurring visit added',
      label || ' (Eastern Time). The provider accepts each visit separately. ' || btrim(_reason), '/dashboard', occurrence, t.contractor_id);
  end if;
  return jsonb_build_object('generation_id', generation, 'outcome', outcome, 'code', code, 'occurrence_id', occurrence,
    'visit_key', visit, 'starts_at', _starts_at, 'local_start', _local_start, 'timezone', 'America/New_York',
    'source', _source, 'cadence_date', _cadence_date, 'replayed', false);
end $$;
revoke all on function private.create_recurring_visit_core(uuid, uuid, timestamptz, timestamp, text, text, uuid, date)
  from public, anon, authenticated;

-- Manual (off-cadence or make-up) visits: unchanged signature and grants; no horizon or lead-time
-- limit beyond a future time.
create or replace function public.admin_create_recurring_visit(_series_id uuid, _operation_key uuid, _starts_at timestamptz,
  _local_start timestamp, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
begin
  return private.create_recurring_visit_core(_series_id, _operation_key, _starts_at, _local_start, _reason, 'manual', null, null);
end $$;

-- A visit from a current cadence proposal. The proposal is recomputed under the plan lock: the
-- anchor must still be current and the date still proposed (horizon, two-visit capacity, not
-- handled), at least 24 hours away. A proposal keeps the anchor's Eastern wall time; on a
-- daylight-saving date the operator picks EDT/EST (time repeated) or another time that day
-- (time skipped). A paused or stopped plan is recorded as refused, as on the manual path.
create function public.admin_create_cadence_visit(_series_id uuid, _operation_key uuid, _anchor_id uuid, _cadence_date date,
  _starts_at timestamptz, _local_start timestamp, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; a private.recurring_series_anchors; item jsonb;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _series_id is null or _operation_key is null or _anchor_id is null or _cadence_date is null or _starts_at is null
    or _local_start is null or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, cadence, visit time, Eastern time, operation key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;
  if exists(select 1 from private.recurring_visit_generations g where g.series_id = r.id and g.operation_key = _operation_key) then
    return private.create_recurring_visit_core(_series_id, _operation_key, _starts_at, _local_start, _reason, 'cadence', _anchor_id, _cadence_date);
  end if;
  if not exists(select 1 from private.recurring_series_anchors x where x.id = _anchor_id and x.series_id = r.id) then
    raise exception 'Cadence anchor not found for this plan' using errcode = '22023';
  end if;
  if private.recurring_plan_state(r.id) = 'active' then
    select * into a from private.recurring_series_anchors where series_id = r.id order by seq desc limit 1;
    if a.id <> _anchor_id then
      raise exception 'The cadence changed since you loaded it' using errcode = '40001';
    end if;
    if _local_start::date <> _cadence_date then
      raise exception 'A proposed visit stays on its cadence date' using errcode = '22023';
    end if;
    select x.value into item from jsonb_array_elements(private.recurring_cadence_preview(r.id, now())->'proposals') x
      where (x.value->>'cadence_date')::date = _cadence_date;
    if item is null then
      raise exception 'This proposed visit is no longer current' using errcode = '40001';
    end if;
    if item->>'kind' <> 'nonexistent' and _local_start <> (item->>'local_start')::timestamp then
      raise exception 'A proposed visit keeps the plan''s Eastern time; add a different time manually' using errcode = '22023';
    end if;
    if _starts_at < now() + interval '24 hours' then
      raise exception 'A proposed visit must be at least 24 hours away' using errcode = '22023';
    end if;
  end if;
  return private.create_recurring_visit_core(_series_id, _operation_key, _starts_at, _local_start, _reason, 'cadence', _anchor_id, _cadence_date);
end $$;
revoke all on function public.admin_create_cadence_visit(uuid, uuid, uuid, date, timestamptz, timestamp, text) from public, anon;
grant execute on function public.admin_create_cadence_visit(uuid, uuid, uuid, date, timestamptz, timestamp, text) to authenticated;

-- Anchor ------------------------------------------------------------------------------------

-- Records the agreed first-visit (or new) Eastern date and time the cadence counts from.
-- _expected_anchor_id is the anchor the operator loaded (null for none); anything else is stale.
-- Future proposals change; visits, earlier anchors and skip/replacement decisions are kept.
create function public.admin_record_recurring_anchor(_series_id uuid, _operation_key uuid, _expected_anchor_id uuid,
  _starts_at timestamptz, _local_start timestamp, _basis text, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; a private.recurring_series_anchors; prior private.recurring_series_anchors; created uuid;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _series_id is null or _operation_key is null or _starts_at is null or _local_start is null
    or nullif(btrim(_basis), '') is null or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, anchor time, Eastern time, operation key, basis and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from private.recurring_series_anchors where series_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.actor_id <> auth.uid() or prior.starts_at <> _starts_at or prior.local_start <> _local_start
      or prior.basis <> btrim(_basis) or prior.reason <> btrim(_reason) or prior.replaces_anchor_id is distinct from _expected_anchor_id then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('anchor_id', prior.id, 'starts_at', prior.starts_at, 'local_start', prior.local_start,
      'replaces_anchor_id', prior.replaces_anchor_id, 'replayed', true);
  end if;

  if r.recurrence_parent_id is not null or r.occurrence_key is not null or r.frequency is null or r.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  if date_trunc('minute', _starts_at) <> _starts_at or (_starts_at at time zone 'America/New_York') <> _local_start then
    raise exception 'The anchor time does not match the Eastern Time entered' using errcode = '22023';
  end if;
  if private.recurring_plan_state(r.id) = 'ended' then
    raise exception 'Future visits for this plan were stopped' using errcode = '22023';
  end if;
  select * into a from private.recurring_series_anchors where series_id = r.id order by seq desc limit 1;
  if a.id is distinct from _expected_anchor_id then
    raise exception 'The cadence changed since you loaded it' using errcode = '40001';
  end if;
  if a.starts_at = _starts_at then
    raise exception 'That is already the plan''s anchor' using errcode = '22023';
  end if;

  insert into private.recurring_series_anchors(series_id, replaces_anchor_id, operation_key, actor_id, starts_at, local_start, basis, reason)
  values (r.id, a.id, _operation_key, auth.uid(), _starts_at, _local_start, btrim(_basis), btrim(_reason))
  returning id into created;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'recurring_anchor',
    'anchor_id', created, 'replaces_anchor_id', a.id, 'scheduled_at', _starts_at, 'operation_key', _operation_key,
    'reason', btrim(_reason)));
  return jsonb_build_object('anchor_id', created, 'starts_at', _starts_at, 'local_start', _local_start,
    'replaces_anchor_id', a.id, 'replayed', false);
end $$;
revoke all on function public.admin_record_recurring_anchor(uuid, uuid, uuid, timestamptz, timestamp, text, text) from public, anon;
grant execute on function public.admin_record_recurring_anchor(uuid, uuid, uuid, timestamptz, timestamp, text, text) to authenticated;

-- Skip or replace a cadence date -------------------------------------------------------------

-- 'skipped': the date gets no visit. 'replaced': an off-cadence, non-cancelled visit of the same
-- plan stands in for the date; its appointment, provider, price and identity are not touched.
-- A date already holding a visit, or already resolved under the current anchor, is refused; one
-- visit replaces at most one date. Decisions under earlier anchors stay recorded and do not
-- apply to the current anchor's dates.
create function public.admin_resolve_cadence_date(_series_id uuid, _operation_key uuid, _anchor_id uuid, _cadence_date date,
  _kind text, _occurrence_id uuid, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; a private.recurring_series_anchors; v public.service_requests;
  prior private.recurring_cadence_resolutions; created uuid;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _series_id is null or _operation_key is null or _anchor_id is null or _cadence_date is null
    or _kind is null or _kind not in ('skipped', 'replaced') or (_kind = 'replaced') <> (_occurrence_id is not null)
    or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, cadence date, decision, operation key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from private.recurring_cadence_resolutions where series_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.actor_id <> auth.uid() or prior.anchor_id <> _anchor_id or prior.cadence_date <> _cadence_date
      or prior.kind <> _kind or prior.occurrence_id is distinct from _occurrence_id or prior.reason <> btrim(_reason) then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('resolution_id', prior.id, 'kind', prior.kind, 'cadence_date', prior.cadence_date,
      'occurrence_id', prior.occurrence_id, 'replayed', true);
  end if;

  if r.recurrence_parent_id is not null or r.occurrence_key is not null or r.frequency is null or r.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  if _kind = 'skipped' and private.recurring_plan_state(r.id) = 'ended' then
    raise exception 'Future visits for this plan were stopped' using errcode = '22023';
  end if;
  select * into a from private.recurring_series_anchors where series_id = r.id order by seq desc limit 1;
  if a.id is distinct from _anchor_id then
    raise exception 'The cadence changed since you loaded it' using errcode = '40001';
  end if;
  if private.recurring_cadence_index(a.local_start::date, r.frequency, _cadence_date) is null then
    raise exception 'That date is not a cadence date of this plan' using errcode = '22023';
  end if;
  if exists(select 1 from public.service_requests x
      where x.recurrence_parent_id = r.id and x.occurrence_key = private.recurring_visit_key(r.id, _cadence_date)) then
    raise exception 'This cadence date already has a visit' using errcode = '22023';
  end if;
  if exists(select 1 from private.recurring_cadence_resolutions x where x.anchor_id = a.id and x.cadence_date = _cadence_date) then
    raise exception 'This cadence date was already skipped or replaced' using errcode = '22023';
  end if;
  if _kind = 'replaced' then
    select * into v from public.service_requests where id = _occurrence_id;
    if v.id is null or v.recurrence_parent_id is distinct from r.id then
      raise exception 'The replacement must be a visit of this plan' using errcode = '22023';
    end if;
    if v.status = 'cancelled' then
      raise exception 'A cancelled visit cannot replace a cadence date' using errcode = '22023';
    end if;
    if exists(select 1 from private.recurring_cadence_resolutions x where x.occurrence_id = v.id) then
      raise exception 'This visit already replaces a cadence date' using errcode = '22023';
    end if;
    if private.recurring_cadence_index(a.local_start::date, r.frequency, (v.scheduled_start_at at time zone 'America/New_York')::date) is not null then
      raise exception 'This visit is on a cadence date of its own' using errcode = '22023';
    end if;
  end if;

  insert into private.recurring_cadence_resolutions(series_id, anchor_id, cadence_date, kind, occurrence_id, operation_key, actor_id, reason)
  values (r.id, a.id, _cadence_date, _kind, _occurrence_id, _operation_key, auth.uid(), btrim(_reason))
  returning id into created;
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'recurring_cadence_' || _kind,
    'resolution_id', created, 'anchor_id', a.id, 'cadence_date', _cadence_date, 'occurrence_id', _occurrence_id,
    'operation_key', _operation_key, 'reason', btrim(_reason)));
  return jsonb_build_object('resolution_id', created, 'kind', _kind, 'cadence_date', _cadence_date,
    'occurrence_id', _occurrence_id, 'replayed', false);
end $$;
revoke all on function public.admin_resolve_cadence_date(uuid, uuid, uuid, date, text, uuid, text) from public, anon;
grant execute on function public.admin_resolve_cadence_date(uuid, uuid, uuid, date, text, uuid, text) to authenticated;

-- Pause, resume, stop future visits ----------------------------------------------------------

-- Operations only. _expected_state is the state the operator loaded; anything else is stale.
-- Only new visit creation is affected: existing visits, their offers, the plan's request status,
-- terms and eligibility are untouched, and resuming re-enables nothing the other checks refuse.
create function public.admin_set_recurring_plan_state(_series_id uuid, _operation_key uuid, _action text,
  _expected_state text, _reason text)
returns jsonb
language plpgsql security definer set search_path = 'public', 'private', 'pg_temp' as $$
declare r public.service_requests; prior private.recurring_series_lifecycle; current_state text; target text;
  previous uuid; created uuid; remaining integer;
begin
  if auth.uid() is null or not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _series_id is null or _operation_key is null or _action is null or _action not in ('pause', 'resume', 'stop')
    or _expected_state is null or nullif(btrim(_reason), '') is null then
    raise exception 'Plan, action, expected state, operation key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_series_id::text, 0));
  select * into r from public.service_requests where id = _series_id for update;
  if r.id is null then raise exception 'Service not found' using errcode = '22023'; end if;

  select * into prior from private.recurring_series_lifecycle where series_id = r.id and operation_key = _operation_key;
  if prior.id is not null then
    if prior.actor_id <> auth.uid() or prior.action <> _action or prior.from_state <> _expected_state
      or prior.reason <> btrim(_reason) then
      raise exception 'Operation key reused with different intent' using errcode = '22023';
    end if;
    return jsonb_build_object('lifecycle_id', prior.id, 'action', prior.action, 'from_state', prior.from_state,
      'to_state', prior.to_state, 'replayed', true);
  end if;

  if r.recurrence_parent_id is not null or r.occurrence_key is not null or r.frequency is null or r.frequency = 'one-time' then
    raise exception 'Recurring plan required' using errcode = '22023';
  end if;
  current_state := private.recurring_plan_state(r.id);
  if current_state <> _expected_state then
    raise exception 'The plan changed since you loaded it' using errcode = '40001';
  end if;
  target := case
    when _action = 'pause' and current_state = 'active' then 'paused'
    when _action = 'resume' and current_state = 'paused' then 'active'
    when _action = 'stop' and current_state in ('active', 'paused') then 'ended' end;
  if target is null then
    raise exception '%', case when current_state = 'ended' then 'Future visits for this plan were already stopped'
      else 'This plan is already ' || current_state end using errcode = '22023';
  end if;

  select id into previous from private.recurring_series_lifecycle where series_id = r.id order by seq desc limit 1;
  insert into private.recurring_series_lifecycle(series_id, previous_id, operation_key, actor_id, action, from_state, to_state, reason)
  values (r.id, previous, _operation_key, auth.uid(), _action, current_state, target, btrim(_reason))
  returning id into created;
  select count(*) into remaining from public.service_requests v
    where v.recurrence_parent_id = r.id and v.status not in ('cancelled', 'completed', 'homeowner_confirmed', 'resolved', 'review_requested', 'reviewed', 'closed');
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'recurring_plan_' || _action,
    'lifecycle_id', created, 'from_state', current_state, 'to_state', target, 'operation_key', _operation_key,
    'reason', btrim(_reason), 'visits_in_place', remaining));
  return jsonb_build_object('lifecycle_id', created, 'action', _action, 'from_state', current_state, 'to_state', target,
    'visits_in_place', remaining, 'replayed', false);
end $$;
revoke all on function public.admin_set_recurring_plan_state(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_recurring_plan_state(uuid, uuid, text, text, text) to authenticated;

-- 6. Readback ---------------------------------------------------------------------------------

-- Restates 20261026001000. Adds the plan state and current anchor for every participant, and for
-- operations the cadence (proposals as of now), anchors, lifecycle, skip/replacement decisions,
-- each visit's cadence position and each attempt's source.
create or replace function public.recurring_series(_series_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; s public.service_requests; t private.recurring_series_terms;
  a private.recurring_series_anchors; viewer uuid := auth.uid(); is_admin boolean; is_owner boolean; is_provider boolean;
  result jsonb;
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
  select * into a from private.recurring_series_anchors where series_id = s.id order by seq desc limit 1;

  select jsonb_build_object(
    'series_id', s.id, 'timezone', 'America/New_York', 'frequency', s.frequency, 'status', s.status,
    'has_provider', s.contractor_id is not null,
    'plan_state', private.recurring_plan_state(s.id),
    'anchor', case when a.id is null then null else jsonb_build_object('starts_at', a.starts_at,
      'local_start', to_char(a.local_start, 'YYYY-MM-DD"T"HH24:MI:SS')) end,
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
      'offer', (select x.outcome from public.job_match_attempts x where x.service_request_id = v.id order by x.attempt_number desc limit 1),
      'plan_provider', v.contractor_id is not distinct from s.contractor_id,
      'provider_completed_at', v.vendor_completed_at, 'homeowner_confirmed_at', v.homeowner_confirmed_at,
      'payment', case when is_provider and not is_admin then null
        else coalesce((select case when o.captured > 0 then 'paid' when o.current_snapshot_id is not null then 'awaiting_payment' end
          from public.money_obligations o where o.service_request_id = v.id), 'none') end,
      'on_cadence', case when is_admin and a.id is not null then private.recurring_cadence_index(a.local_start::date, s.frequency,
        (v.scheduled_start_at at time zone 'America/New_York')::date) is not null end,
      'replaces', case when is_admin then (select jsonb_build_object('cadence_date', x.cadence_date, 'anchor_id', x.anchor_id,
        'current_anchor', x.anchor_id = a.id) from private.recurring_cadence_resolutions x where x.occurrence_id = v.id) end)
      order by v.scheduled_start_at, v.id)
      from public.service_requests v where v.recurrence_parent_id = s.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object(
      'id', g.id, 'at', g.created_at, 'outcome', g.outcome, 'code', g.block_code, 'starts_at', g.starts_at,
      'local_start', g.local_start, 'occurrence_id', g.occurrence_id, 'actor', 'operations', 'reason', g.reason,
      'source', g.source, 'cadence_date', g.cadence_date,
      'operation_key', case when g.actor_id = viewer then g.operation_key end) order by g.seq)
      from private.recurring_visit_generations g where g.series_id = s.id), '[]'::jsonb))
  into result;

  if is_admin then
    result := result || jsonb_build_object(
      'anchor_id', a.id,
      'cadence', private.recurring_cadence_preview(s.id, now()),
      'anchors', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'starts_at', x.starts_at,
        'local_start', to_char(x.local_start, 'YYYY-MM-DD"T"HH24:MI:SS'), 'basis', x.basis, 'reason', x.reason,
        'replaces_anchor_id', x.replaces_anchor_id, 'actor', 'operations',
        'operation_key', case when x.actor_id = viewer then x.operation_key end) order by x.seq)
        from private.recurring_series_anchors x where x.series_id = s.id), '[]'::jsonb),
      'lifecycle', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'action', x.action,
        'from_state', x.from_state, 'to_state', x.to_state, 'reason', x.reason, 'actor', 'operations',
        'operation_key', case when x.actor_id = viewer then x.operation_key end) order by x.seq)
        from private.recurring_series_lifecycle x where x.series_id = s.id), '[]'::jsonb),
      'resolutions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'anchor_id', x.anchor_id,
        'current_anchor', x.anchor_id = a.id, 'cadence_date', x.cadence_date, 'kind', x.kind, 'occurrence_id', x.occurrence_id,
        'reason', x.reason, 'actor', 'operations',
        'operation_key', case when x.actor_id = viewer then x.operation_key end) order by x.seq)
        from private.recurring_cadence_resolutions x where x.series_id = s.id), '[]'::jsonb));
  end if;
  return result;
end $$;
