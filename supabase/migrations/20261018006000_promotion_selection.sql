-- TRACE-116 (DEC-2026-042): how a homeowner applies a funded offer, and what keeps the chosen
-- price true through matching, recurring visits, cleanup and checkout. Additive: new tables
-- and functions; restated functions are marked "TRACE-116" where they change.
--
-- 1. Explicit selection (DEC-2026-042). A homeowner chooses one displayed public offer, or
--    enters a code, for a priced service; nothing is applied, replaced or switched on their
--    behalf. Code-only offers never appear in the public list. When several offers qualify
--    for the same selection, each shows its actual saving on that service and those add-ons;
--    the greatest is labelled, never chosen. One promotion per booking; no Credits ledger
--    exists, so there is nothing to stack or compare yet (DEC-2026-038). Every offer, list
--    and choice is closed while private.money_feature_gates 'promotions_checkout' is closed.
-- 2. Server-side commitment. Submission reserves the chosen offer in the same transaction as
--    the request (eligibility, dates, limits and budget under the offer lock); a different
--    discount or offer revision than the homeowner saw refuses the whole submission with
--    'promotion_changed'. The redemption snapshots the offer revision, funding, discount,
--    commission base and the 7.5% commission (20261018003000/20261018005000).
-- 3. Homeowner confirmation. private.promotion_selections records the homeowner's choice:
--    applied (a redemption), needs_homeowner (the system released it), or declined (the
--    homeowner confirmed the price without an offer). money_source refuses a request whose
--    offer no longer applies or whose confirmed price changed, so an undiscounted amount is
--    never charged without the homeowner's confirmation and no other offer is substituted.
--    The homeowner can replace or remove the offer until checkout starts.
-- 4. Matching keeps the priced selection (DEC-2026-042 item 2). A request whose priced
--    selection carries add-ons, or that holds a promotion, is matched only to the package,
--    price level and package revision it was priced from, at that total including add-ons.
--    If that provider cannot take it, matching stops for operator review; add-ons are never
--    dropped and another provider's package is never substituted. Recurring visits of such
--    a request carry the same priced selection. Add-ons without a chosen offering are refused.
-- 5. Cleanup. promotion_release_unpaid releases, exactly once, a reservation whose terms
--    expired unpaid or whose offer ended or changed before payment, under the same request
--    and obligation locks as checkout; paid or paying bookings are never touched. Runs are
--    logged; overlapping runs skip. Scheduling is a separate owner-authorized step
--    (scripts/install-promotion-sweep.sql); this migration installs no schedule.
-- 6. Retried in-app approval sends of the same draft revision reuse the unread notice.

-- 1. Records ------------------------------------------------------------------------------------

create table private.promotion_selections (
  service_request_id uuid primary key references public.service_requests(id),
  customer_id uuid not null,
  state text not null check (state in ('applied', 'needs_homeowner', 'declined')),
  redemption_id uuid references private.promotion_redemptions(id),
  -- The service amount the homeowner confirmed: after the discount when applied.
  confirmed_service_cents bigint not null check (confirmed_service_cents > 0),
  reason text check (reason is null or length(reason) <= 200),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check ((state = 'applied') = (redemption_id is not null))
);
alter table private.promotion_selections enable row level security;
revoke all on private.promotion_selections from public, anon, authenticated, service_role;

create table private.promotion_selection_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  service_request_id uuid not null references public.service_requests(id),
  kind text not null check (kind in ('applied', 'replaced', 'declined', 'released')),
  offer_id uuid references private.promotion_offers(id),
  redemption_id uuid references private.promotion_redemptions(id),
  service_cents bigint,
  discount_cents bigint,
  actor uuid,
  reason text,
  created_at timestamptz not null default now()
);
alter table private.promotion_selection_events enable row level security;
revoke all on private.promotion_selection_events from public, anon, authenticated, service_role;

-- Code lookups per homeowner, to limit guessing.
create table private.promotion_code_checks (
  id bigint generated always as identity primary key,
  actor uuid not null,
  matched boolean not null,
  checked_at timestamptz not null default now()
);
create index promotion_code_checks_actor_idx on private.promotion_code_checks(actor, checked_at);
alter table private.promotion_code_checks enable row level security;
revoke all on private.promotion_code_checks from public, anon, authenticated, service_role;

create table private.promotion_sweep_runs (
  id uuid primary key default gen_random_uuid(),
  outcome text not null check (outcome in ('completed', 'skipped')),
  released integer not null default 0 check (released >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now()
);
alter table private.promotion_sweep_runs enable row level security;
revoke all on private.promotion_sweep_runs from public, anon, authenticated, service_role;

-- 2. One eligibility evaluation ---------------------------------------------------------------

-- Evaluates an offer for a priced selection from trusted values. Context keys: customer_id,
-- contractor_id, lineage_id, service_id, zip_code, eligible_cents, request_id (null before
-- submission), replacing (true when the request's own redemption is being replaced, so it
-- neither blocks nor counts against limits). Reasons and their order are those of
-- promotion_reserve (20261018005000). Returns {eligible, reason, discount_cents, economics}.
create function private.promotion_evaluate(p_offer private.promotion_offers, p_ctx jsonb, p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  eligible bigint := nullif(p_ctx ->> 'eligible_cents', '')::bigint;
  customer uuid := nullif(p_ctx ->> 'customer_id', '')::uuid;
  contractor uuid := nullif(p_ctx ->> 'contractor_id', '')::uuid;
  lineage uuid := nullif(p_ctx ->> 'lineage_id', '')::uuid;
  request uuid := nullif(p_ctx ->> 'request_id', '')::uuid;
  replacing boolean := coalesce((p_ctx ->> 'replacing')::boolean, false);
  discount bigint;
  used integer;
  committed bigint;
  reason text;
begin
  reason := case
    when p_offer.status <> 'approved' then 'offer_not_approved'
    when (p_offer.funding = 'vendor' and p_offer.vendor_approved_hash is distinct from p_offer.content_hash)
      or (p_offer.funding = 'platform' and p_offer.authorized_hash is distinct from p_offer.content_hash) then 'offer_revision_not_approved'
    when now() < p_offer.starts_at then 'not_started'
    when now() >= p_offer.ends_at then 'expired'
    when contractor is null then 'provider_not_confirmed'
    when p_offer.contractor_id is not null and p_offer.contractor_id <> contractor then 'other_provider'
    when cardinality(p_offer.package_lineage_ids) > 0 and (lineage is null or not lineage = any(p_offer.package_lineage_ids)) then 'package_not_included'
    when cardinality(p_offer.service_ids) > 0 and not coalesce(p_ctx ->> 'service_id', '') = any(p_offer.service_ids) then 'service_not_included'
    when cardinality(p_offer.zip_codes) > 0 and not coalesce(p_ctx ->> 'zip_code', '') = any(p_offer.zip_codes) then 'area_not_included'
    when eligible is null or eligible <= 0 then 'no_exact_service_amount'
    when eligible < p_offer.min_spend_cents then 'below_minimum_spend'
    when p_offer.code_hash is not null and p_offer.code_hash is distinct from private.promotion_code_hash(p_code) then 'code_required'
    when p_offer.first_booking_only and private.promotion_has_completed_service(customer, request) then 'not_first_booking'
    when p_offer.first_booking_only and exists (select 1 from private.promotion_redemptions x
      where x.customer_id = customer and x.first_booking and x.status in ('reserved', 'finalized')
        and x.service_request_id is distinct from request) then 'first_booking_already_reserved'
    when request is not null and not replacing and exists (select 1 from private.promotion_redemptions x
      where x.service_request_id = request and x.status in ('reserved', 'finalized')) then 'promotion_already_applied'
  end;
  if reason is null then
    discount := private.promotion_discount(p_offer, eligible);
    if discount >= eligible then reason := 'discount_exceeds_service'; end if;
  end if;
  if reason is null then
    select count(*), coalesce(sum(x.platform_subsidy_cents), 0) into used, committed
      from private.promotion_redemptions x
     where x.offer_id = p_offer.id and x.status in ('reserved', 'finalized')
       and (not replacing or x.service_request_id is distinct from request);
    if p_offer.max_redemptions is not null and used >= p_offer.max_redemptions then
      reason := 'redemption_limit_reached';
    elsif p_offer.funding = 'platform' and committed + discount > p_offer.budget_cents then
      reason := 'budget_exhausted';
    end if;
  end if;
  if reason is not null then
    return jsonb_build_object('eligible', false, 'reason', reason);
  end if;
  return jsonb_build_object('eligible', true, 'discount_cents', discount,
    'economics', private.promotion_economics(eligible, discount, p_offer.funding));
end $$;

-- The trusted pricing context of a request: its provider (the matched one, else the provider
-- of the package it was priced from), package lineage, area and exact service amount.
create function private.promotion_request_context(p_request public.service_requests, p_replacing boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id', p_request.id, 'customer_id', p_request.customer_id,
    'contractor_id', coalesce(p_request.contractor_id, p.contractor_id), 'lineage_id', p.lineage_id,
    'service_id', p_request.service_catalog_id, 'zip_code', p_request.zip_code, 'replacing', p_replacing,
    'eligible_cents', case when p_request.pricing_inputs ->> 'version' = 'pricing-v2' and p_request.pricing_inputs ->> 'status' = 'exact'
                           then (p_request.pricing_inputs ->> 'total_cents')::bigint
                           when p_request.pricing_mode = 'fixed' and p_request.total_amount > 0 then round(p_request.total_amount * 100)::bigint end)
  from (select 1) one left join public.vendor_packages p on p.id = p_request.package_id
$$;

-- Restates 20261018005000 (TRACE-116): the same checks through promotion_evaluate, and an
-- unmatched request is evaluated for the provider of the package it was priced from, so a
-- homeowner's choice can be reserved when the request is submitted.
create or replace function private.promotion_reserve(p_offer uuid, p_request uuid, p_code text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  offer private.promotion_offers;
  r public.service_requests;
  prior private.promotion_redemptions;
  redemption private.promotion_redemptions;
  ctx jsonb;
  verdict jsonb;
  split jsonb;
begin
  if p_key is null or p_key !~ '^[A-Za-z0-9_:-]{8,128}$' then raise exception 'Invalid idempotency key' using errcode = '22023'; end if;
  -- The offer lock serializes limits and budget across requests.
  select * into offer from private.promotion_offers where id = p_offer for update;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  select * into r from public.service_requests where id = p_request for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;

  select * into prior from private.promotion_redemptions where idempotency_key = p_key;
  if found then
    if prior.offer_id <> p_offer or prior.service_request_id <> p_request then
      raise exception 'Idempotency key reused for another redemption' using errcode = '22023';
    end if;
    return jsonb_build_object('status', prior.status, 'redemption', to_jsonb(prior), 'reused', true);
  end if;

  ctx := private.promotion_request_context(r, false);
  verdict := private.promotion_evaluate(offer, ctx, p_code);
  if not (verdict ->> 'eligible')::boolean then
    return jsonb_build_object('status', 'ineligible', 'reason', verdict ->> 'reason');
  end if;

  split := verdict -> 'economics';
  insert into private.promotion_redemptions(offer_id, offer_revision, offer_hash, service_request_id, customer_id, contractor_id,
      idempotency_key, funding, eligible_cents, discount_cents, homeowner_service_cents, commission_rate_bps,
      commission_base_cents, commission_cents, vendor_proceeds_cents, platform_subsidy_cents, first_booking)
    values (offer.id, offer.revision, offer.content_hash, r.id, r.customer_id, (ctx ->> 'contractor_id')::uuid, p_key, offer.funding,
      (split ->> 'eligible_cents')::bigint, (split ->> 'discount_cents')::bigint, (split ->> 'homeowner_service_cents')::bigint,
      (split ->> 'commission_rate_bps')::integer, (split ->> 'commission_base_cents')::bigint, (split ->> 'commission_cents')::bigint,
      (split ->> 'vendor_proceeds_cents')::bigint, (split ->> 'platform_subsidy_cents')::bigint, offer.first_booking_only)
    returning * into redemption;
  return jsonb_build_object('status', 'reserved', 'redemption', to_jsonb(redemption), 'reused', false);
end $$;

-- What a homeowner sees of an eligible offer: no funding, approval or usage details.
create function private.promotion_option_json(p_offer private.promotion_offers, p_verdict jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'offer_id', p_offer.id, 'fingerprint', p_offer.content_hash, 'label', p_offer.label, 'terms', p_offer.terms,
    'ends_at', p_offer.ends_at, 'timezone', p_offer.timezone, 'first_booking_only', p_offer.first_booking_only,
    'requires_code', p_offer.code_hash is not null, 'kind', p_offer.kind, 'percent_bps', p_offer.percent_bps,
    'amount_cents', p_offer.amount_cents, 'max_discount_cents', p_offer.max_discount_cents,
    'service_cents', (p_verdict #>> '{economics,eligible_cents}')::bigint,
    'discount_cents', (p_verdict ->> 'discount_cents')::bigint,
    'total_after_cents', (p_verdict #>> '{economics,homeowner_service_cents}')::bigint)
$$;

-- Marks the greatest saving among two or more options with different savings ("Best
-- savings"); ties at the top are all marked. Nothing is selected.
create function private.promotion_mark_best(p_options jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(o || jsonb_build_object('best',
      jsonb_array_length(p_options) > 1 and stats.top > stats.bottom and (o ->> 'discount_cents')::bigint = stats.top)
    order by (o ->> 'discount_cents')::bigint desc, o ->> 'label', o ->> 'offer_id'), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) o,
    (select max((x ->> 'discount_cents')::bigint) top, min((x ->> 'discount_cents')::bigint) bottom
       from jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) x) stats
$$;

-- Public offers (and code offers for an entered code) live now, evaluated for a context.
-- Returns {options, code}. A code lookup is limited to 10 unmatched codes per hour per
-- homeowner; past that no code is evaluated.
create function private.promotion_options_for(p_actor uuid, p_ctx jsonb, p_code text, p_exclude uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  code text := nullif(btrim(coalesce(p_code, '')), '');
  entered_hash text;
  offer private.promotion_offers;
  verdict jsonb;
  options jsonb := '[]'::jsonb;
  code_offers integer := 0;
  code_eligible uuid;
  code_reason text;
  code_result jsonb;
begin
  if code is not null then
    if length(code) > 24 then
      code := null; code_result := jsonb_build_object('status', 'not_found');
    elsif (select count(*) from private.promotion_code_checks c
           where c.actor = p_actor and not c.matched and c.checked_at > now() - interval '1 hour') >= 10 then
      code := null; code_result := jsonb_build_object('status', 'too_many_attempts');
    else
      entered_hash := private.promotion_code_hash(code);
    end if;
  end if;
  for offer in
    select o.* from private.promotion_offers o
     where o.status = 'approved' and now() >= o.starts_at and now() < o.ends_at
       and (o.code_hash is null or o.code_hash = entered_hash)
       and o.id is distinct from p_exclude
     order by o.id
  loop
    verdict := private.promotion_evaluate(offer, p_ctx, code);
    if offer.code_hash is not null then
      code_offers := code_offers + 1;
      if (verdict ->> 'eligible')::boolean then code_eligible := coalesce(code_eligible, offer.id);
      else code_reason := coalesce(code_reason, verdict ->> 'reason'); end if;
    end if;
    if (verdict ->> 'eligible')::boolean then options := options || private.promotion_option_json(offer, verdict); end if;
  end loop;
  if entered_hash is not null then
    insert into private.promotion_code_checks(actor, matched) values (p_actor, code_offers > 0);
    code_result := case
      when code_offers = 0 then jsonb_build_object('status', 'not_found')
      when code_eligible is not null then jsonb_build_object('status', 'eligible', 'offer_id', code_eligible)
      else jsonb_build_object('status', 'ineligible', 'reason', code_reason) end;
  end if;
  return jsonb_build_object('options', private.promotion_mark_best(options), 'code', code_result);
end $$;

-- 3. Intake: offers for the homeowner's plan ------------------------------------------------------

-- p_payload: the final preview payload ({location, selections}) plus optional codes
-- {"<selection index>": "CODE"}. Each exactly priced selection gets the eligible offers with
-- their savings on that selection; nothing is reserved here.
create function public.homeowner_promotion_options(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  codes jsonb;
  preview jsonb;
  outcome jsonb;
  idx integer;
  pkg public.vendor_packages;
  ctx jsonb;
  found_options jsonb;
  result jsonb := '[]'::jsonb;
  code text;
begin
  if actor is null or not public.has_role(actor, 'homeowner') then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  if not private.money_gate('promotions_checkout') then
    return jsonb_build_object('available', false, 'reason', 'not_open', 'credits', null, 'selections', '[]'::jsonb);
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'Invalid offer request' using errcode = '22023'; end if;
  codes := coalesce(p_payload -> 'codes', '{}'::jsonb);
  if jsonb_typeof(codes) <> 'object' or (select count(*) from jsonb_object_keys(codes)) > 20
     or exists (select 1 from jsonb_each(codes) c where jsonb_typeof(c.value) <> 'string' or c.key !~ '^[0-9]{1,2}$') then
    raise exception 'Invalid promotion code' using errcode = '22023';
  end if;
  if not private.r0_trial_admitted_for_payload(actor, p_payload) then
    return jsonb_build_object('available', false, 'reason', 'not_admitted', 'credits', null, 'selections', '[]'::jsonb);
  end if;
  preview := public.preview_service_request_selections(jsonb_build_object('stage', 'final',
    'location', p_payload -> 'location', 'selections', p_payload -> 'selections'));
  for outcome in select value from jsonb_array_elements(coalesce(preview -> 'outcomes', '[]'::jsonb)) loop
    idx := (outcome ->> 'selection_index')::integer;
    code := codes ->> idx::text;
    if outcome ->> 'outcome' <> 'eligible_fixed' or jsonb_typeof(outcome -> 'total') <> 'number'
       or outcome ->> 'package_id' is null or coalesce((outcome ->> 'promotion')::boolean, false) then
      result := result || jsonb_build_object('selection_index', idx, 'service_id', outcome ->> 'service_id',
        'status', 'not_priced', 'options', '[]'::jsonb,
        'code', case when nullif(btrim(coalesce(code, '')), '') is not null then jsonb_build_object('status', 'not_applicable') end);
      continue;
    end if;
    select * into pkg from public.vendor_packages where id = (outcome ->> 'package_id')::uuid;
    ctx := jsonb_build_object('customer_id', actor, 'contractor_id', pkg.contractor_id, 'lineage_id', pkg.lineage_id,
      'service_id', outcome ->> 'service_id', 'zip_code', left(btrim(p_payload #>> '{location,zip_code}'), 5),
      'eligible_cents', round((outcome ->> 'total')::numeric * 100)::bigint);
    found_options := private.promotion_options_for(actor, ctx, code, null);
    result := result || jsonb_build_object('selection_index', idx, 'service_id', outcome ->> 'service_id',
      'status', 'priced', 'service_cents', (ctx ->> 'eligible_cents')::bigint,
      'options', found_options -> 'options', 'code', found_options -> 'code');
  end loop;
  -- No Credits ledger exists (DEC-2026-038): nothing to compare or stack.
  return jsonb_build_object('available', true, 'credits', null, 'selections', result);
end $$;

-- 4. Submission: reserve the chosen offer with the request -----------------------------------------

-- Restates 20260928232242 (R0 admission wrapper). TRACE-116: refuses add-ons without a chosen
-- offering; reserves each selection's chosen offer in the same transaction and refuses the
-- whole plan ('promotion_changed') when the offer or its saving differs from what was shown.
create or replace function public.submit_service_requests(p_submission_key text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
  selection jsonb;
  promo jsonb;
  created jsonb;
  reserved jsonb;
  changed jsonb := '[]'::jsonb;
  any_promo boolean := false;
  idx integer;
  request uuid;
  reason text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.has_role(actor, 'homeowner') then
    raise exception 'Homeowner authorization required' using errcode = '42501';
  end if;
  if not private.r0_trial_admitted_for_payload(actor, p_payload) then
    raise exception 'Trial invitation required for this service and area'
      using errcode = '42501';
  end if;

  -- TRACE-116: shape checks the core does not make.
  if jsonb_typeof(p_payload) = 'object' and jsonb_typeof(p_payload -> 'selections') = 'array' then
    for selection in select value from jsonb_array_elements(p_payload -> 'selections') loop
      continue when jsonb_typeof(selection) <> 'object';
      -- Add-ons belong to one offering: an automatically matched provider is never handed
      -- add-ons it may not offer, and the price shown never silently drops them.
      if jsonb_typeof(selection -> 'addons') = 'array' and jsonb_array_length(selection -> 'addons') > 0
         and nullif(selection ->> 'package_id', '') is null then
        raise exception 'Add-ons can be chosen only with a specific provider''s offering. Choose an offering or remove the add-ons'
          using errcode = '22023';
      end if;
      promo := selection -> 'promotion';
      continue when promo is null or jsonb_typeof(promo) = 'null';
      if jsonb_typeof(promo) <> 'object'
         or coalesce(promo ->> 'offer_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(promo ->> 'fingerprint', '') !~ '^[0-9a-f]{64}$'
         or coalesce(promo ->> 'expected_discount_cents', '') !~ '^[1-9][0-9]{0,8}$'
         or (promo ? 'code' and jsonb_typeof(promo -> 'code') not in ('string', 'null'))
         or length(coalesce(promo ->> 'code', '')) > 24 then
        raise exception 'Invalid offer selection' using errcode = '22023';
      end if;
      any_promo := true;
    end loop;
  end if;
  if any_promo and not private.money_gate('promotions_checkout') then
    raise exception 'Offers are not available yet. Remove the offer and submit again' using errcode = '22023';
  end if;

  begin
    result := private.submit_service_requests_homeowner_checked(p_submission_key, p_payload);
    -- A replay returns the recorded result: its reservations were made with it.
    if any_promo and result ->> 'status' = 'submitted' and not coalesce((result ->> 'reused')::boolean, false) then
      for created in select value from jsonb_array_elements(result -> 'requests') loop
        idx := (created ->> 'selection_index')::integer;
        promo := p_payload -> 'selections' -> idx -> 'promotion';
        continue when promo is null or jsonb_typeof(promo) = 'null';
        request := (created ->> 'request_id')::uuid;
        reason := null;
        if not exists (select 1 from private.promotion_offers o where o.id = (promo ->> 'offer_id')::uuid) then
          reason := 'offer_unavailable';
        else
          reserved := private.promotion_reserve((promo ->> 'offer_id')::uuid, request, promo ->> 'code',
            'intake:' || md5(actor::text || ':' || p_submission_key) || ':' || idx);
          reason := case
            when reserved ->> 'status' <> 'reserved' then coalesce(reserved ->> 'reason', 'offer_unavailable')
            when reserved #>> '{redemption,offer_hash}' <> promo ->> 'fingerprint' then 'offer_changed'
            when (reserved #>> '{redemption,discount_cents}')::bigint <> (promo ->> 'expected_discount_cents')::bigint then 'discount_changed'
          end;
        end if;
        if reason is not null then
          changed := changed || jsonb_build_object('selection_index', idx, 'service_id', created ->> 'service_id',
            'outcome', 'promotion_changed', 'reason', reason, 'pricing_mode', 'fixed', 'total', created -> 'total_amount');
        else
          insert into private.promotion_selections(service_request_id, customer_id, state, redemption_id, confirmed_service_cents, updated_by)
            values (request, actor, 'applied', (reserved #>> '{redemption,id}')::uuid,
              (reserved #>> '{redemption,homeowner_service_cents}')::bigint, actor);
          insert into private.promotion_selection_events(service_request_id, kind, offer_id, redemption_id, service_cents, discount_cents, actor)
            values (request, 'applied', (promo ->> 'offer_id')::uuid, (reserved #>> '{redemption,id}')::uuid,
              (reserved #>> '{redemption,eligible_cents}')::bigint, (reserved #>> '{redemption,discount_cents}')::bigint, actor);
        end if;
      end loop;
      if jsonb_array_length(changed) > 0 then
        raise exception 'Offer changed' using errcode = 'MR116';
      end if;
    end if;
  exception when sqlstate 'MR116' then
    -- Nothing is kept: the requests, the submission record and any reservation roll back.
    return jsonb_build_object('status', 'refused', 'coverage', 'covered',
      'outcomes', changed, 'requests', '[]'::jsonb, 'reused', false);
  end;
  return result;
end $$;

-- 5. After submission: the homeowner sees, replaces or removes the offer -----------------------------

-- Why a request's offer can no longer change: null while it can.
create function private.promotion_request_locked(p_request public.service_requests) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_request.status::text not in ('pending', 'matched', 'scheduled') then 'request_not_open'
    when exists (select 1 from public.money_obligations o where o.service_request_id = p_request.id
      and (o.captured > 0 or exists (select 1 from public.money_checkout_attempts a where a.obligation_id = o.id
        and a.status in ('prepared', 'session_created', 'reconcile', 'captured')))) then 'checkout_started'
    when (private.promotion_request_context(p_request, true) ->> 'eligible_cents') is null then 'no_exact_price'
  end
$$;

-- Whether a reserved or committed redemption still applies to its request, as money_source
-- checks it until the homeowner commits: null when it does, else the reason.
create function private.promotion_redemption_problem(p_redemption private.promotion_redemptions, p_request public.service_requests)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when p_redemption.status = 'finalized' then null
    -- Promotions closed again after opening: the homeowner can still remove the offer.
    when not private.money_gate('promotions_checkout') then 'offers_paused'
    when o.status <> 'approved' or o.content_hash <> p_redemption.offer_hash then 'offer_changed'
    when now() >= o.ends_at then 'expired'
    when p_redemption.first_booking and private.promotion_has_completed_service(p_request.customer_id, p_request.id) then 'not_first_booking'
    when (private.promotion_request_context(p_request, true) ->> 'eligible_cents')::bigint is distinct from p_redemption.eligible_cents then 'price_changed'
    when (private.promotion_request_context(p_request, true) ->> 'contractor_id')::uuid is distinct from p_redemption.contractor_id then 'other_provider'
  end
  from private.promotion_offers o where o.id = p_redemption.offer_id
$$;

-- The request's offer and the alternatives for its own price. p_code also looks up a code
-- offer, under the same attempt limit as the intake.
create function public.homeowner_request_promotion(p_request uuid, p_code text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  r public.service_requests;
  choice private.promotion_selections;
  x private.promotion_redemptions;
  offer private.promotion_offers;
  locked text;
  ctx jsonb;
  applied jsonb;
  found_options jsonb;
begin
  select * into r from public.service_requests where id = p_request;
  if actor is null or not found or r.customer_id <> actor then raise exception 'Request not found' using errcode = 'P0002'; end if;
  select * into choice from private.promotion_selections where service_request_id = r.id;
  select * into x from private.promotion_redemptions where service_request_id = r.id and status in ('reserved', 'finalized');
  -- Closed: nothing to show unless this request already holds an offer or a choice, which
  -- the homeowner can still see and remove (alternatives are not listed).
  if not private.money_gate('promotions_checkout') and choice.service_request_id is null and x.id is null then
    return jsonb_build_object('available', false, 'credits', null);
  end if;
  ctx := private.promotion_request_context(r, true);
  locked := private.promotion_request_locked(r);
  if x.id is not null then
    select * into offer from private.promotion_offers where id = x.offer_id;
    applied := jsonb_build_object('offer_id', offer.id, 'label', offer.label, 'terms', offer.terms, 'ends_at', offer.ends_at,
      'timezone', offer.timezone, 'service_cents', x.eligible_cents, 'discount_cents', x.discount_cents,
      'total_after_cents', x.homeowner_service_cents, 'committed', x.status = 'finalized',
      'problem', private.promotion_redemption_problem(x, r));
  end if;
  if locked is null and private.money_gate('promotions_checkout') then
    found_options := private.promotion_options_for(actor, ctx, p_code, x.offer_id);
  end if;
  return jsonb_build_object('available', true, 'credits', null, 'offers_open', private.money_gate('promotions_checkout'),
    'state', choice.state, 'reason', choice.reason, 'confirmed_service_cents', choice.confirmed_service_cents,
    'service_cents', (ctx ->> 'eligible_cents')::bigint, 'editable', locked is null, 'locked_reason', locked,
    'applied', applied, 'options', coalesce(found_options -> 'options', '[]'::jsonb), 'code', found_options -> 'code');
end $$;

-- Applies p_offer (with p_code for a code offer) to the request, replacing any reserved
-- offer, or with p_offer null confirms the price without an offer. p_expected_cents is the
-- service amount the homeowner is confirming (after the discount for an offer). Nothing
-- changes when the offer or the amount differs from what the homeowner saw.
create function public.homeowner_choose_request_promotion(p_request uuid, p_offer uuid, p_fingerprint text, p_code text,
  p_expected_cents bigint, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  r public.service_requests;
  current_x private.promotion_redemptions;
  offer private.promotion_offers;
  locked text;
  ctx jsonb;
  verdict jsonb;
  reserved jsonb;
  service bigint;
begin
  if actor is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  -- Removing an offer is always possible; applying one needs the promotions gate open.
  if p_offer is not null and not private.money_gate('promotions_checkout') then
    raise exception 'Offers are not available yet' using errcode = '22023';
  end if;
  -- Same lock order as checkout, snapshot publication, matching and the sweep.
  perform pg_advisory_xact_lock(hashtextextended(p_request::text, 0));
  select * into r from public.service_requests where id = p_request for update;
  if not found or r.customer_id <> actor then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform 1 from public.money_obligations where service_request_id = r.id for update;
  locked := private.promotion_request_locked(r);
  if locked is not null then
    raise exception '%', case locked when 'checkout_started' then 'Checkout has started; the offer can no longer change'
      when 'no_exact_price' then 'This request has no exact price, so no offer applies'
      else 'This request can no longer change' end using errcode = '55000';
  end if;
  ctx := private.promotion_request_context(r, true);
  service := (ctx ->> 'eligible_cents')::bigint;
  select * into current_x from private.promotion_redemptions where service_request_id = r.id and status in ('reserved', 'finalized') for update;
  if current_x.status = 'finalized' then
    raise exception 'This booking''s offer is already committed' using errcode = '55000';
  end if;

  if p_offer is null then
    if p_expected_cents is distinct from service then
      return jsonb_build_object('status', 'changed', 'reason', 'price_changed', 'service_cents', service);
    end if;
    if current_x.id is not null then
      update private.promotion_redemptions set status = 'released', released_at = now(), release_reason = 'Removed by the homeowner'
       where id = current_x.id and status = 'reserved';
    end if;
    insert into private.promotion_selections(service_request_id, customer_id, state, redemption_id, confirmed_service_cents, reason, updated_by, updated_at)
      values (r.id, actor, 'declined', null, service, null, actor, now())
      on conflict (service_request_id) do update set state = 'declined', redemption_id = null,
        confirmed_service_cents = excluded.confirmed_service_cents, reason = null, updated_by = actor, updated_at = now();
    insert into private.promotion_selection_events(service_request_id, kind, offer_id, redemption_id, service_cents, actor)
      values (r.id, 'declined', current_x.offer_id, current_x.id, service, actor);
    return jsonb_build_object('status', 'declined', 'service_cents', service);
  end if;

  select * into offer from private.promotion_offers where id = p_offer;
  if not found then return jsonb_build_object('status', 'ineligible', 'reason', 'offer_unavailable'); end if;
  -- A retry of the choice already made.
  if current_x.offer_id = p_offer and current_x.offer_hash = p_fingerprint and current_x.homeowner_service_cents = p_expected_cents
     and private.promotion_redemption_problem(current_x, r) is null then
    return jsonb_build_object('status', 'applied', 'reused', true, 'discount_cents', current_x.discount_cents,
      'total_after_cents', current_x.homeowner_service_cents);
  end if;
  if offer.content_hash is distinct from p_fingerprint then
    return jsonb_build_object('status', 'changed', 'reason', 'offer_changed');
  end if;
  verdict := private.promotion_evaluate(offer, ctx, p_code);
  if not (verdict ->> 'eligible')::boolean then
    return jsonb_build_object('status', 'ineligible', 'reason', verdict ->> 'reason');
  end if;
  if (verdict #>> '{economics,homeowner_service_cents}')::bigint is distinct from p_expected_cents then
    return jsonb_build_object('status', 'changed', 'reason', 'price_changed',
      'discount_cents', (verdict ->> 'discount_cents')::bigint, 'total_after_cents', (verdict #>> '{economics,homeowner_service_cents}')::bigint);
  end if;
  if current_x.id is not null then
    update private.promotion_redemptions set status = 'released', released_at = now(), release_reason = 'Replaced by the homeowner'
     where id = current_x.id and status = 'reserved';
  end if;
  reserved := private.promotion_reserve(p_offer, r.id, p_code, p_key);
  if reserved ->> 'status' <> 'reserved' or coalesce((reserved ->> 'reused')::boolean, false)
     or (reserved #>> '{redemption,homeowner_service_cents}')::bigint <> p_expected_cents then
    -- A limit or budget was taken in between: undo the release with everything else.
    raise exception 'The offer changed while it was being applied; review it again' using errcode = '40001';
  end if;
  insert into private.promotion_selections(service_request_id, customer_id, state, redemption_id, confirmed_service_cents, reason, updated_by, updated_at)
    values (r.id, actor, 'applied', (reserved #>> '{redemption,id}')::uuid, p_expected_cents, null, actor, now())
    on conflict (service_request_id) do update set state = 'applied', redemption_id = excluded.redemption_id,
      confirmed_service_cents = excluded.confirmed_service_cents, reason = null, updated_by = actor, updated_at = now();
  insert into private.promotion_selection_events(service_request_id, kind, offer_id, redemption_id, service_cents, discount_cents, actor)
    values (r.id, case when current_x.id is not null then 'replaced' else 'applied' end, p_offer, (reserved #>> '{redemption,id}')::uuid,
      service, (reserved #>> '{redemption,discount_cents}')::bigint, actor);
  return jsonb_build_object('status', 'applied', 'reused', false, 'discount_cents', (reserved #>> '{redemption,discount_cents}')::bigint,
    'total_after_cents', p_expected_cents);
end $$;

-- 6. Checkout source --------------------------------------------------------------------------------

-- Restates 20261018005000 (TRACE-112/114); TRACE-116 adds the homeowner's choice.
create or replace function private.money_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
  priced jsonb; addon_cents bigint := 0; wanted jsonb; promo private.promotion_redemptions; offer private.promotion_offers;
  choice private.promotion_selections;
begin
  lock table public.package_promotions,public.package_qualifying_questions in share mode;
  select * into strict r from public.service_requests where id=p_request;
  if r.customer_id is null or r.contractor_id is null or r.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    raise exception 'Scheduled commercial parties required';
  end if;
  request_context:=private.money_source_context(r);
  if r.current_quote_id is not null then
    select * into strict q from public.request_quotes where id=r.current_quote_id for share;
    if q.request_id<>r.id or q.revision<>r.quote_revision or q.status<>'accepted' or r.quote_status is distinct from 'accepted'
      or q.decision_actor is distinct from r.customer_id or q.decided_at is null or q.decided_at<q.sent_at or q.decided_at>=q.expires_at then
      raise exception 'Current homeowner-accepted quote required';
    end if;
    if not exists(select 1 from public.money_quote_contexts where quote_id=q.id and money_quote_contexts.context=request_context-'contractor') then
      raise exception 'Quote scope unverified or changed; send a new revision';
    end if;
    -- Existing admin/homeowner UI calls amount the total. Never silently add tax,
    -- tips or extras on top of that accepted amount. Its allocation is reviewed.
    price:=private.money_minor_units(q.amount);
    evidence:=jsonb_build_object('kind','quote','context',request_context,'quote',to_jsonb(q),'total',price);
  else
    if r.quote_only is true or r.pricing_mode is distinct from 'fixed' or r.quote_status is not null then
      raise exception 'Versioned quote required';
    end if;
    select * into strict p from public.vendor_packages where id=r.package_id for share;
    select * into strict t from public.package_tiers where id=r.package_tier_id for share;
    if p.contractor_id<>r.contractor_id or p.service_id is distinct from r.service_catalog_id
      or t.package_id<>p.id or p.pricing_mode<>'fixed' or not p.is_active or p.needs_review is true
      or r.frequency is null or t.frequency is distinct from r.frequency
      or not exists(select 1 from public.resolve_package_tier_price(p.id,t.id)) then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractors where id=p.contractor_id and is_active and marketing_enabled for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.services_catalog where id=p.service_id and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.coverage_areas where zip_code=r.zip_code and is_active for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    perform 1 from public.contractor_service_zips where contractor_id=p.contractor_id and zip_code=r.zip_code for share;
    if not found then raise exception 'Selected offering is not eligible'; end if;
    if t.rule_question_key is not null then
      if coalesce(r.package_question_answers->t.rule_question_key->>'answer','') !~ '^-?[0-9]+([.][0-9]+)?$' then
        raise exception 'Offering answers do not match selected tier';
      end if;
      if (t.rule_min is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric<t.rule_min)
        or (t.rule_max is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric>t.rule_max) then
        raise exception 'Offering answers do not match selected tier';
      end if;
    end if;
    -- TRACE-112: every rule condition of the tier must hold, as at submission.
    if private.pricing_tier_matches(private.pricing_tier_json(t), r.package_question_answers) is not true then
      raise exception 'Offering answers do not match selected tier';
    end if;
    -- DEC-2026-041 item 2: add-ons are part of the commercial source. The request is priced
    -- again from the package content with the same calculation, and must give the same exact
    -- result it was submitted with, from the same package revision. Required and selected
    -- add-ons, their quantities and the level amount are all checked here, never in a browser.
    if r.pricing_inputs->>'version' = 'pricing-v2'
      and exists(select 1 from jsonb_array_elements(coalesce(r.pricing_inputs->'lines','[]'::jsonb)) l where l->>'kind'='addon') then
      if r.pricing_inputs->>'status' is distinct from 'exact' or (r.pricing_inputs->>'package_id')::uuid is distinct from p.id
        or r.pricing_inputs->>'package_revision' is distinct from private.package_revision_hash(p.id) then
        raise exception 'Offering add-ons changed since the request; a new request or quote is required';
      end if;
      select coalesce(jsonb_agg(jsonb_build_object('id', l->>'id', 'quantity', (l->>'quantity')::integer) order by l->>'id'), '[]'::jsonb)
        into wanted from jsonb_array_elements(r.pricing_inputs->'lines') l where l->>'kind'='addon';
      perform 1 from public.package_addons a where a.package_id=p.id for share;
      priced:=private.price_selection(private.package_content(p.id), r.frequency, t.id::text, r.package_question_answers, wanted);
      if priced->>'status' is distinct from 'exact' or (priced->>'total_cents')::bigint is distinct from (r.pricing_inputs->>'total_cents')::bigint
        or (priced#>>'{lines,0,amount_cents}')::bigint is distinct from private.money_minor_units(t.price) then
        raise exception 'Offering add-ons do not price the same as the request';
      end if;
      select coalesce(sum((l->>'amount_cents')::bigint),0) into addon_cents from jsonb_array_elements(priced->'lines') l where l->>'kind'='addon';
    end if;
    perform 1 from public.package_qualifying_questions where package_id=p.id for share;
    if exists(select 1 from public.package_qualifying_questions x where x.package_id=p.id and x.is_required
      and nullif(btrim(r.package_question_answers->x.question_key->>'answer'),'') is null) then
      raise exception 'Required offering answers missing';
    end if;
    -- Legacy package_promotions overlays never have funding or allocation authority: a
    -- request with one stops here, as before.
    if r.promotion_id is not null or exists(select 1 from public.package_promotions where package_id=p.id and is_enabled and starts_at<=now() and ends_at>now()) then
      raise exception 'Promotion allocation integration required';
    end if;
    select coalesce(jsonb_agg(to_jsonb(q2) order by q2.id),'[]') into questions from public.package_qualifying_questions q2 where q2.package_id=p.id;
    price:=private.money_minor_units(t.price);
    evidence:=jsonb_build_object('kind','offering','context',request_context,'package',to_jsonb(p),'tier',to_jsonb(t),'questions',questions,'service',price);
    if addon_cents>0 then evidence:=evidence||jsonb_build_object('addons',addon_cents,'pricing',priced->'lines'); end if;

    -- DEC-2026-038/041: a funded offer reserved for this request (TRACE-114). Checkout carries
    -- it only once the two-person finance review has opened the promotions gate. Until the
    -- homeowner commits (the first checkout attempt), it is checked again here: the same
    -- approved offer revision, within its dates, the same eligible amount and, for a
    -- first-booking offer, still no completed Marketplace service.
    select * into promo from private.promotion_redemptions where service_request_id=r.id and status in ('reserved','finalized') for share;
    if found then
      if not private.money_gate('promotions_checkout') then raise exception 'Promotion allocation integration required'; end if;
      if promo.eligible_cents<>price+addon_cents or promo.contractor_id<>r.contractor_id or promo.customer_id<>r.customer_id then
        raise exception 'Promotion no longer matches this request; it must be applied again';
      end if;
      if promo.status='reserved' then
        select * into offer from private.promotion_offers where id=promo.offer_id for share;
        if offer.status<>'approved' or offer.content_hash<>promo.offer_hash or now()<offer.starts_at or now()>=offer.ends_at
          or (promo.first_booking and private.promotion_has_completed_service(r.customer_id,r.id)) then
          raise exception 'Promotion no longer applies; it must be applied again' using errcode='40001';
        end if;
      end if;
      evidence:=evidence||jsonb_build_object('discount',promo.discount_cents,'promotion',jsonb_build_object(
        'redemption_id',promo.id,'offer_id',promo.offer_id,'offer_revision',promo.offer_revision,'funding',promo.funding,
        'eligible_cents',promo.eligible_cents,'discount_cents',promo.discount_cents,'commission_rate_bps',promo.commission_rate_bps,
        'commission_base_cents',promo.commission_base_cents,'commission_cents',promo.commission_cents,
        'platform_subsidy_cents',promo.platform_subsidy_cents,'first_booking',promo.first_booking,
        'terms',(select o.label||': '||o.terms from private.promotion_offers o where o.id=promo.offer_id)));
    end if;
    -- TRACE-116 (DEC-2026-042): the homeowner's choice governs. An offer the system released,
    -- or one other than the homeowner applied, is never replaced by another or dropped
    -- silently; a price confirmed without an offer must still be the price.
    select * into choice from private.promotion_selections where service_request_id=r.id;
    if choice.service_request_id is not null then
      if choice.state='needs_homeowner' or (choice.state='applied' and promo.id is distinct from choice.redemption_id) then
        raise exception 'The homeowner''s offer no longer applies; the homeowner must choose again' using errcode='40001';
      end if;
      if (choice.state='declined' and price+addon_cents<>choice.confirmed_service_cents)
        or (choice.state='applied' and promo.homeowner_service_cents<>choice.confirmed_service_cents) then
        raise exception 'The price changed since the homeowner confirmed it; the homeowner must confirm again' using errcode='40001';
      end if;
    end if;
  end if;
  return evidence||jsonb_build_object('version','commercial-v1:'||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $$;

-- 7. Cleanup of unpaid reservations ----------------------------------------------------------------

-- Restates 20261018005000 (TRACE-116). Releases, exactly once, reserved promotions of unpaid
-- requests whose current terms expired, or whose offer ended, changed or was retired, before
-- payment. Each candidate is re-checked under the request lock and the obligation row lock
-- that checkout and snapshot publication take, so a checkout that started first keeps its
-- reservation and a release that landed first is seen by checkout. A captured payment or an
-- open checkout attempt is never released here. The homeowner's selection becomes
-- needs_homeowner: money_source then refuses until the homeowner chooses again.
create or replace function private.promotion_release_unpaid() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
  x private.promotion_redemptions;
  o public.money_obligations;
  s public.money_snapshots;
  offer private.promotion_offers;
  why text;
  released integer := 0;
begin
  for candidate in
    select x2.id, x2.service_request_id from private.promotion_redemptions x2
      join private.promotion_offers o2 on o2.id = x2.offer_id
      left join public.money_obligations ob on ob.service_request_id = x2.service_request_id
      left join public.money_snapshots sn on sn.id = ob.current_snapshot_id
     where x2.status = 'reserved'
       and (sn.expires_at <= now() or now() >= o2.ends_at or o2.status <> 'approved' or o2.content_hash <> x2.offer_hash)
     order by x2.service_request_id, x2.id
     limit 500
  loop
    perform pg_advisory_xact_lock(hashtextextended(candidate.service_request_id::text, 0));
    select * into o from public.money_obligations where service_request_id = candidate.service_request_id for update;
    select * into x from private.promotion_redemptions where id = candidate.id for update;
    continue when x.status <> 'reserved';
    continue when o.id is not null and (o.captured > 0 or exists (select 1 from public.money_checkout_attempts a
      where a.obligation_id = o.id and a.status in ('prepared', 'session_created', 'reconcile', 'captured')));
    select * into s from public.money_snapshots where id = o.current_snapshot_id;
    select * into offer from private.promotion_offers where id = x.offer_id;
    why := case
      when s.id is not null and s.expires_at <= now() then 'Terms expired unpaid'
      when now() >= offer.ends_at then 'Offer ended before payment'
      when offer.status <> 'approved' or offer.content_hash <> x.offer_hash then 'Offer changed or withdrawn before payment'
    end;
    continue when why is null;
    update private.promotion_redemptions set status = 'released', released_at = now(), release_reason = why
     where id = x.id and status = 'reserved';
    update private.promotion_selections set state = 'needs_homeowner', redemption_id = null, reason = why, updated_by = null, updated_at = now()
     where service_request_id = x.service_request_id and redemption_id = x.id;
    insert into private.promotion_selection_events(service_request_id, kind, offer_id, redemption_id, service_cents, discount_cents, reason)
      values (x.service_request_id, 'released', x.offer_id, x.id, x.eligible_cents, x.discount_cents, why);
    released := released + 1;
  end loop;
  return released;
end $$;

-- The scheduled entry point. Overlapping runs skip rather than wait; each run is logged.
create function private.run_promotion_release_sweep() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare started timestamptz := clock_timestamp(); n integer; run uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('private.promotion_release_unpaid', 0)) then
    insert into private.promotion_sweep_runs(outcome, released, started_at) values ('skipped', 0, started) returning id into run;
    return jsonb_build_object('outcome', 'skipped', 'run_id', run);
  end if;
  n := private.promotion_release_unpaid();
  insert into private.promotion_sweep_runs(outcome, released, started_at, finished_at)
    values ('completed', n, started, clock_timestamp()) returning id into run;
  return jsonb_build_object('outcome', 'completed', 'released', n, 'run_id', run);
end $$;

-- Operator monitoring: recent runs, reservations the next run would release, and
-- reservations held by an open checkout.
create function public.admin_promotion_reservation_health() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return jsonb_build_object(
    'gate_open', private.money_gate('promotions_checkout'),
    'scheduled', exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
      and (select count(*) > 0 from cron.job where command ilike '%run_promotion_release_sweep%' and active),
    'last_run', (select jsonb_build_object('outcome', r.outcome, 'released', r.released, 'finished_at', r.finished_at)
      from private.promotion_sweep_runs r where r.outcome = 'completed' order by r.finished_at desc limit 1),
    'runs_24h', (select count(*) from private.promotion_sweep_runs r where r.started_at > now() - interval '24 hours'),
    'reserved', (select count(*) from private.promotion_redemptions where status = 'reserved'),
    'releasable', (select count(*) from private.promotion_redemptions x join private.promotion_offers o on o.id = x.offer_id
      left join public.money_obligations ob on ob.service_request_id = x.service_request_id
      left join public.money_snapshots sn on sn.id = ob.current_snapshot_id
      where x.status = 'reserved' and (sn.expires_at <= now() or now() >= o.ends_at or o.status <> 'approved' or o.content_hash <> x.offer_hash)
        and coalesce(ob.captured, 0) = 0 and not exists (select 1 from public.money_checkout_attempts a where a.obligation_id = ob.id
          and a.status in ('prepared', 'session_created', 'reconcile', 'captured'))),
    'held_by_checkout', (select count(*) from private.promotion_redemptions x join public.money_obligations ob on ob.service_request_id = x.service_request_id
      where x.status = 'reserved' and exists (select 1 from public.money_checkout_attempts a where a.obligation_id = ob.id
        and a.status in ('prepared', 'session_created', 'reconcile'))),
    'needs_homeowner', (select count(*) from private.promotion_selections where state = 'needs_homeowner'));
end $$;

-- 8. Matching keeps the priced selection ------------------------------------------------------------

-- Restates 20260905016000 (TRACE-116). A request bound to its priced selection (add-on lines,
-- or an active promotion) has one candidate at most: the package and price level it was
-- priced from, at the same package revision, whose effective price includes the add-ons.
-- Preview and submission call this before any priced selection exists, so they are unchanged.
create or replace function private.find_eligible_packages_core(_request_id uuid DEFAULT NULL::uuid, _service_id text DEFAULT NULL::text,
  _frequency text DEFAULT NULL::text, _zip_code text DEFAULT NULL::text, _preferred_contractor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(contractor_id uuid, contractor_name text, package_id uuid, package_tier_id uuid, promotion_id uuid, frequency text, path text,
   base_price numeric, effective_price numeric, median_fixed_price numeric, fixed_score numeric, profile_score numeric, verification_score numeric,
   price_band_score numeric, response_score numeric, freshness_score numeric, total_score numeric, preferred boolean, score_breakdown jsonb, rank_order integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bound as (
    select (r.pricing_inputs ->> 'package_id')::uuid as package_id,
      nullif(r.pricing_inputs ->> 'tier_id', '')::uuid as tier_id,
      r.pricing_inputs ->> 'package_revision' as revision,
      coalesce((r.pricing_inputs ->> 'total_cents')::bigint - (r.pricing_inputs #>> '{lines,0,amount_cents}')::bigint, 0) as addon_cents,
      (select x.contractor_id from private.promotion_redemptions x
        where x.service_request_id = r.id and x.status in ('reserved', 'finalized')) as promotion_contractor
    from public.service_requests r
    where _request_id is not null and r.id = _request_id
      and r.pricing_inputs ->> 'version' = 'pricing-v2' and r.pricing_inputs ->> 'status' = 'exact'
      and (exists (select 1 from jsonb_array_elements(coalesce(r.pricing_inputs -> 'lines', '[]'::jsonb)) l where l ->> 'kind' = 'addon')
        or exists (select 1 from private.promotion_redemptions x where x.service_request_id = r.id and x.status in ('reserved', 'finalized')))
  )
  select candidate.contractor_id, candidate.contractor_name, candidate.package_id, candidate.package_tier_id, candidate.promotion_id,
    candidate.frequency, candidate.path, candidate.base_price,
    candidate.effective_price + coalesce(bound.addon_cents, 0) / 100.0,
    candidate.median_fixed_price, candidate.fixed_score, candidate.profile_score, candidate.verification_score,
    candidate.price_band_score, candidate.response_score, candidate.freshness_score, candidate.total_score, candidate.preferred,
    candidate.score_breakdown, candidate.rank_order
  from private.find_eligible_packages_without_onboarding(
    _request_id,
    _service_id,
    _frequency,
    _zip_code,
    _preferred_contractor_id
  ) candidate
  left join bound on true
  where private.vendor_matching_eligible(candidate.contractor_id)
    and (bound.package_id is null or (candidate.package_id = bound.package_id
      and candidate.package_tier_id is not distinct from bound.tier_id
      and candidate.path = 'fixed'
      and (bound.promotion_contractor is null or candidate.contractor_id = bound.promotion_contractor)
      and private.package_revision_hash(bound.package_id) = bound.revision))
$function$;

-- Restates 20260904004000 (latest definition). TRACE-116: a visit of a recurring request
-- priced with add-ons carries the same priced selection, so its add-ons are matched and
-- charged as on the first visit (never dropped at matching).
CREATE OR REPLACE FUNCTION public.create_service_occurrence(_template_id uuid, _occurrence_key uuid, _scheduled_at timestamp with time zone, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE r public.service_requests; existing public.service_requests; new_id uuid;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF _occurrence_key IS NULL OR _scheduled_at IS NULL OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Occurrence, appointment and reason required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_template_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_template_id FOR UPDATE;
  IF r.id IS NULL OR r.frequency IS NULL OR r.frequency='one-time' THEN RAISE EXCEPTION 'Recurring template required' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing FROM public.service_requests WHERE recurrence_parent_id=r.id AND occurrence_key=_occurrence_key;
  IF existing.id IS NOT NULL THEN
    IF existing.scheduled_start_at IS DISTINCT FROM _scheduled_at THEN RAISE EXCEPTION 'Occurrence key reused with different appointment' USING ERRCODE='22023'; END IF;
    RETURN existing.id;
  END IF;
  INSERT INTO public.service_requests(customer_id,service_type,service_catalog_id,address,city,state,zip_code,
    description,frequency,package_id,package_tier_id,package_question_answers,preferred_contractor_id,
    recurrence_parent_id,occurrence_key,scheduled_start_at,preferred_date,timezone,pricing_inputs)
    VALUES(r.customer_id,r.service_type,r.service_catalog_id,r.address,r.city,r.state,r.zip_code,
      r.description,r.frequency,r.package_id,r.package_tier_id,r.package_question_answers,r.contractor_id,
      r.id,_occurrence_key,_scheduled_at,(_scheduled_at AT TIME ZONE 'America/New_York')::date,'America/New_York',
      -- TRACE-116: the template's priced selection, only when it carries add-ons.
      CASE WHEN r.pricing_inputs->>'version'='pricing-v2' AND r.pricing_inputs->>'status'='exact'
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(r.pricing_inputs->'lines','[]'::jsonb)) l WHERE l->>'kind'='addon')
        THEN r.pricing_inputs END) RETURNING id INTO new_id;
  PERFORM public.log_job_event(new_id,'status_changed',auth.uid(),jsonb_build_object('action','occurrence_created','template_id',r.id,'reason',btrim(_reason),'scheduled_at',_scheduled_at));
  -- Each visit must receive its own provider acceptance and completion evidence.
  IF NOT EXISTS(SELECT 1 FROM private.find_eligible_packages_core(new_id)) THEN
    RAISE EXCEPTION 'Not available yet in your area' USING ERRCODE='22023';
  END IF;
  PERFORM private.offer_next_for_request_internal(new_id);
  RETURN new_id;
END;
$function$;

-- 9. Approval sends: a retry reuses the unread notice -----------------------------------------------

-- Restates 20261018004000. TRACE-116: sending the same revision again while its in-app notice
-- is still unread in the vendor's inbox records nothing and sends no second notice.
CREATE OR REPLACE FUNCTION public.admin_send_package_draft(p_draft uuid, p_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := public.vendor_require_operator();
  draft private.operator_package_drafts;
  vendor_user uuid;
  link jsonb;
  notification uuid;
  resend boolean;
  notice uuid;
  reason text;
begin
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_revision is null or p_revision <> draft.content_hash then
    raise exception 'Draft changed since it was read; reload before sending' using errcode = '40001';
  end if;
  if draft.approval_state = 'approved' then raise exception 'The vendor already approved this revision'; end if;
  -- The catalog may have changed since the draft was saved.
  perform private.pricing_normalize_content(draft.content, draft.service_id);

  link := private.package_draft_vendor_link(draft.contractor_id);
  resend := draft.approval_state = 'sent' and draft.sent_hash = draft.content_hash;

  if coalesce((link ->> 'email_on_file')::boolean, false) then
    -- DEC-2026-041 item 6: notice only. Approval still needs the bound vendor account.
    insert into private.package_draft_email_notices(draft_id, revision) values (draft.id, draft.content_hash)
      on conflict (draft_id, revision) do nothing returning id into notice;
    update private.operator_package_drafts
       set approval_state = 'sent', sent_hash = draft.content_hash, sent_at = now(), sent_by = actor,
           notification_id = null, change_request = null
     where id = draft.id returning * into draft;
    perform private.record_package_draft_event(draft.id, case when resend then 'resent' else 'sent' end, actor, 'operator',
      draft.content_hash, null, jsonb_build_object('channel', 'email'),
      'No vendor account is bound; notice queued for the contact email on file. Email is not approval.');
    return jsonb_build_object('status', 'sent', 'channel', 'email', 'email_queued', notice is not null,
      'draft', private.operator_package_draft_json(draft));
  end if;

  if not coalesce((link ->> 'vendor_role')::boolean, false) then
    reason := (link ->> 'blocker') || case when not (link ->> 'linked')::boolean then ' and no contact email is on file' else '' end;
    perform private.record_package_draft_event(draft.id, 'send_blocked', actor, 'operator', draft.content_hash, null, null, reason);
    return jsonb_build_object('status', 'blocked', 'reason', reason, 'draft', private.operator_package_draft_json(draft));
  end if;
  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;

  -- TRACE-116: the vendor already has this revision's notice, unread.
  if resend and exists (select 1 from public.notifications n where n.id = draft.notification_id
      and n.user_id = vendor_user and n.read_at is null) then
    return jsonb_build_object('status', 'sent', 'channel', 'in_app', 'already_in_inbox', true,
      'draft', private.operator_package_draft_json(draft));
  end if;

  insert into public.notifications(user_id, type, severity, title, body, link, related_contractor_id)
    values (vendor_user, 'pricing', 'info', 'A price is waiting for your approval',
      draft.name || ': review the price Mercurius prepared and approve it or ask for changes.',
      '/vendor/packages#price-approvals', draft.contractor_id)
    returning id into notification;
  update private.operator_package_drafts
     set approval_state = 'sent', sent_hash = draft.content_hash, sent_at = now(), sent_by = actor,
         notification_id = notification, change_request = null
   where id = draft.id returning * into draft;
  perform private.record_package_draft_event(draft.id, case when resend then 'resent' else 'sent' end, actor, 'operator',
    draft.content_hash, null, jsonb_build_object('notification_id', notification), null);
  return jsonb_build_object('status', 'sent', 'channel', 'in_app', 'draft', private.operator_package_draft_json(draft));
end $function$;

-- Grants ----------------------------------------------------------------------------------------

revoke all on function
  private.promotion_evaluate(private.promotion_offers, jsonb, text),
  private.promotion_request_context(public.service_requests, boolean),
  private.promotion_option_json(private.promotion_offers, jsonb), private.promotion_mark_best(jsonb),
  private.promotion_options_for(uuid, jsonb, text, uuid),
  private.promotion_request_locked(public.service_requests),
  private.promotion_redemption_problem(private.promotion_redemptions, public.service_requests),
  private.run_promotion_release_sweep(),
  public.homeowner_promotion_options(jsonb), public.homeowner_request_promotion(uuid, text),
  public.homeowner_choose_request_promotion(uuid, uuid, text, text, bigint, text),
  public.admin_promotion_reservation_health()
from public, anon, authenticated, service_role;
grant execute on function
  public.homeowner_promotion_options(jsonb), public.homeowner_request_promotion(uuid, text),
  public.homeowner_choose_request_promotion(uuid, uuid, text, text, bigint, text),
  public.admin_promotion_reservation_health()
to authenticated;
