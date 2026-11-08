-- Phase 6 O-10 repair (TRACE-150; DEC-2026-063, approved 2026-11-08 with O-11 and P-3; plan §9 as
-- reviewed by Codex at ff98673). One-time fixed requests offered at terms other than those priced
-- at submission.
--
--   * Submission-bound terms are kept where they apply (CS-3). The same provider's newer revision
--     of the submitted offering is offered AT the submitted row, level and price (P-2), so it stays
--     on CS-3's bound path and needs no new consent.
--   * Any other fixed one-time offer binds that provider's complete commercial terms when the offer
--     is created (public.job_offer_terms, append-only): offering revision, level, the provider's own
--     required add-ons, included scope, policy notes, the answers it relies on, and what is excluded
--     (the request's earlier add-ons are not carried; no promotion). Candidates whose terms can't be
--     priced exactly from the request's answers are skipped (P-3: required scope).
--   * The provider accepts first; the request then waits in matching_status 'awaiting_terms'
--     (request status stays 'matched'). Only the homeowner's keyed acceptance of that exact offer,
--     terms row and consent hash schedules it; declining withdraws the offer and matching continues
--     without offering the same commercial content again. Provider acceptance is never consent.
--   * Catalog edits never reprice the bound terms; live eligibility refusals still block by name.
--   * Payment (money_source): bound terms need the accepted response for the current consent hash.
--     A fixed one-time request with a submission record or any offer that has neither binding is
--     refused by name (P-4, narrowed: the earlier live-price rule remains only for rows with neither,
--     which product commands don't create; TRACE-126 stays open for that residue).
--   * Activation gate 'offer_terms' in private.money_feature_gates, OFF by default and opened only by
--     the owner. While off, no offer at other terms is created and no request can enter
--     'awaiting_terms'; such candidates are skipped and a request left with none is recorded for
--     recovery (admin_retry_offer_terms_matching after activation). Offer creation and the entry
--     into 'awaiting_terms' share-lock the gate row, so switching it off serializes with both.
--   * While terms are pending, the request can't be scheduled, started, quoted, rescheduled or moved
--     to another status except by cancellation; a provider withdrawal re-matches as an ordinary
--     offer (P-9), not an E5/E6 replacement. Disclosure is unchanged: the accepted provider stays the
--     assigned provider (as for an open offer) until the homeowner answers; a decline unassigns it.
--   * E6 replacements of another provider carry bound terms too; the homeowner's replacement answer
--     records the terms response (P-5).
--
-- Not changed: quotes, recurring visits (CS-4), promotions (the gate stays closed), fee, tax (set at
-- the two-person snapshot review), tips, capture, payout, refunds, runtime dual-authorization.
--
-- Lock order on the bound-terms path: request advisory lock -> service_requests row -> gate row
-- (FOR SHARE) -> package_promotions table SHARE (money_source only) -> provider -> job_offer_terms row
-- -> terms tier -> terms package -> the lineage's live revision -> the terms package's questions ->
-- services_catalog -> coverage_areas -> provider ZIP.
--
-- Additive: two public tables, two private tables, one gate row and its audit, one widened check
-- constraint, two guard triggers, new helpers and commands, restated functions with unchanged
-- signatures and grants. Writes no request, offer or money data.

-- 1. Activation gate and its audit ---------------------------------------------------------------
insert into private.money_feature_gates(name, enabled, reason)
  values ('offer_terms', false, 'DEC-2026-063: off until the owner activates offers at other terms after release');

create table private.money_feature_gate_events (
  id bigint generated always as identity primary key,
  name text not null,
  enabled boolean not null,
  reason text,
  changed_by uuid,
  db_user text not null default current_user,
  created_at timestamptz not null default now()
);
alter table private.money_feature_gate_events enable row level security;
revoke all on private.money_feature_gate_events from public, anon, authenticated, service_role;

create function private.record_money_feature_gate_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.enabled is not distinct from old.enabled and new.reason is not distinct from old.reason then
    return new;
  end if;
  if new.name = 'offer_terms' and tg_op = 'UPDATE' and nullif(btrim(new.reason), '') is null then
    raise exception 'Changing the offer_terms gate needs a reason' using errcode = '22023';
  end if;
  insert into private.money_feature_gate_events(name, enabled, reason, changed_by)
    values (new.name, new.enabled, new.reason, new.changed_by);
  return new;
end $$;
create trigger record_money_feature_gate_event after insert or update on private.money_feature_gates
  for each row execute function private.record_money_feature_gate_event();
insert into private.money_feature_gate_events(name, enabled, reason)
  select name, enabled, reason from private.money_feature_gates where name = 'offer_terms';

create function private.gate_history_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Gate history is append-only' using errcode = '42501';
end $$;
create trigger gate_history_append_only before update or delete on private.money_feature_gate_events
  for each row execute function private.gate_history_append_only();

-- Whether offers at other terms are active. p_lock share-locks the gate row so a switch-off waits
-- for, or is waited on by, the transaction that creates an offer or enters 'awaiting_terms'.
create function private.offer_terms_active(p_lock boolean) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare on_ boolean;
begin
  if p_lock then
    select g.enabled into on_ from private.money_feature_gates g where g.name = 'offer_terms' for share;
  else
    select g.enabled into on_ from private.money_feature_gates g where g.name = 'offer_terms';
  end if;
  return coalesce(on_, false);
end $$;

-- 2. Matching state ------------------------------------------------------------------------------
alter table public.service_requests drop constraint service_requests_matching_status_check;
alter table public.service_requests add constraint service_requests_matching_status_check check
  (matching_status in ('awaiting_match', 'offered', 'matched', 'quote_pending', 'sourcing', 'exhausted', 'awaiting_consent',
    'awaiting_homeowner', 'awaiting_terms'));

-- 3. Bound terms and the homeowner's answers ---------------------------------------------------------
create table public.job_offer_terms (
  id uuid primary key,
  request_id uuid not null references public.service_requests(id),
  offer_id uuid not null unique references public.job_match_attempts(id),
  contractor_id uuid not null references public.contractors(id),
  package_id uuid not null references public.vendor_packages(id),
  package_tier_id uuid not null references public.package_tiers(id),
  terms jsonb not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  consent_hash text not null check (consent_hash ~ '^[0-9a-f]{64}$'),
  level_cents bigint not null check (level_cents > 0),
  addon_cents bigint not null check (addon_cents >= 0),
  total_cents bigint not null check (total_cents = level_cents + addon_cents),
  created_at timestamptz not null default now()
);
create index job_offer_terms_request on public.job_offer_terms(request_id, created_at);

create table public.job_offer_terms_responses (
  id uuid primary key default gen_random_uuid(),
  terms_id uuid not null unique references public.job_offer_terms(id),
  request_id uuid not null references public.service_requests(id),
  offer_id uuid not null references public.job_match_attempts(id),
  consent_hash text not null,
  content_hash text not null,
  response_key uuid not null,
  actor_id uuid not null references auth.users(id),
  accepted boolean not null,
  via text not null default 'terms' check (via in ('terms', 'replacement')),
  reason text check (reason is null or length(btrim(reason)) between 1 and 2000),
  before_value jsonb not null,
  created_at timestamptz not null default now(),
  unique (request_id, response_key)
);
create index job_offer_terms_responses_declined on public.job_offer_terms_responses(request_id, content_hash) where not accepted;

alter table public.job_offer_terms enable row level security;
alter table public.job_offer_terms_responses enable row level security;
revoke all on public.job_offer_terms, public.job_offer_terms_responses from public, anon, authenticated;
grant select on public.job_offer_terms, public.job_offer_terms_responses to authenticated;
grant all on public.job_offer_terms, public.job_offer_terms_responses to service_role;
-- The homeowner, the offered provider and operations read them; nobody writes them from a client.
create policy "Offer participants read bound terms" on public.job_offer_terms for select to authenticated using (
  coalesce(public.has_role(auth.uid(), 'admin'), false)
  or exists(select 1 from public.service_requests r where r.id = job_offer_terms.request_id and r.customer_id = auth.uid())
  or exists(select 1 from public.contractors c where c.id = job_offer_terms.contractor_id and c.user_id = auth.uid()));
create policy "Offer participants read terms answers" on public.job_offer_terms_responses for select to authenticated using (
  coalesce(public.has_role(auth.uid(), 'admin'), false)
  or exists(select 1 from public.service_requests r where r.id = job_offer_terms_responses.request_id and r.customer_id = auth.uid())
  or exists(select 1 from public.job_offer_terms t join public.contractors c on c.id = t.contractor_id
    where t.id = job_offer_terms_responses.terms_id and c.user_id = auth.uid()));

create function private.offer_terms_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.owner_maintenance() then return coalesce(new, old); end if;
  raise exception 'Bound terms and answers are append-only; changed terms need a new offer' using errcode = '42501';
end $$;
create trigger job_offer_terms_append_only before update or delete on public.job_offer_terms
  for each row execute function private.offer_terms_append_only();
create trigger job_offer_terms_responses_append_only before update or delete on public.job_offer_terms_responses
  for each row execute function private.offer_terms_append_only();

-- Requests left without an offer because candidates at other terms were skipped while the gate was
-- off, and the operator retries after activation (recovery).
create table private.offer_terms_blocks (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.service_requests(id),
  candidates jsonb not null,
  created_at timestamptz not null default now()
);
create table private.offer_terms_retries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests(id),
  retry_key uuid not null,
  actor_id uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (request_id, retry_key)
);
alter table private.offer_terms_blocks enable row level security;
alter table private.offer_terms_retries enable row level security;
revoke all on private.offer_terms_blocks, private.offer_terms_retries from public, anon, authenticated, service_role;
create trigger offer_terms_blocks_append_only before update or delete on private.offer_terms_blocks
  for each row execute function private.offer_terms_append_only();
create trigger offer_terms_retries_append_only before update or delete on private.offer_terms_retries
  for each row execute function private.offer_terms_append_only();

-- 4. Building and checking bound terms --------------------------------------------------------------

-- The identity-bound consent hash: what the homeowner's answer names. A new offer, terms row or
-- request gives a new hash even when the commercial content is the same.
create function private.offer_terms_consent_hash(p_request uuid, p_offer uuid, p_terms uuid, p_content_hash text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object('version', 'offer-consent-v1', 'request', p_request, 'offer', p_offer,
    'terms', p_terms, 'content', p_content_hash)::text, 'UTF8')), 'hex')
$$;

-- The complete commercial terms of one provider's offering for this request, priced from that
-- offering's own content with the request's answers: the level, the offering's required add-ons and
-- nothing the homeowner chose elsewhere. {ok:false, reason:'scope'} when the offering can't be
-- priced exactly for the request (no single level for the answers, a required question unanswered,
-- another service or cadence): such candidates are skipped (P-3). Reads only; the caller locks.
-- content_hash covers only the commercial content (no request, offer or row identity), so the same
-- terms offered again compare equal (the declined-terms check).
create function private.offer_terms_build(r public.service_requests, p_contractor uuid, p_package uuid, p_tier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.vendor_packages; t public.package_tiers; priced jsonb; omitted jsonb; terms jsonb;
  level_cents bigint; total_cents bigint; provider_name text; service_name text;
begin
  select * into p from public.vendor_packages where id = p_package;
  select * into t from public.package_tiers where id = p_tier;
  if p.id is null or t.id is null or t.package_id <> p.id or p.contractor_id is distinct from p_contractor
    or p.pricing_mode <> 'fixed' or p.service_id is distinct from r.service_catalog_id
    or r.frequency is null or t.frequency is distinct from r.frequency then
    return jsonb_build_object('ok', false, 'reason', 'scope');
  end if;
  priced := private.price_selection(private.package_content(p.id), r.frequency, t.id::text, r.package_question_answers, '[]'::jsonb);
  if priced->>'status' is distinct from 'exact' or priced->>'tier_id' is distinct from t.id::text
    or jsonb_typeof(priced->'total_cents') is distinct from 'number' then
    return jsonb_build_object('ok', false, 'reason', 'scope');
  end if;
  if exists(select 1 from public.package_qualifying_questions x where x.package_id = p.id and x.is_required
      and nullif(btrim(r.package_question_answers->x.question_key->>'answer'), '') is null) then
    return jsonb_build_object('ok', false, 'reason', 'scope');
  end if;
  level_cents := (priced#>>'{lines,0,amount_cents}')::bigint;
  total_cents := (priced->>'total_cents')::bigint;
  if level_cents is null or level_cents <= 0 or total_cents < level_cents then
    return jsonb_build_object('ok', false, 'reason', 'scope');
  end if;
  -- What the request priced earlier and these terms don't carry (DEC-2026-063 P-3).
  select coalesce(jsonb_agg(jsonb_build_object('id', l->>'id', 'name', l->>'name', 'quantity', (l->>'quantity')::integer,
      'amount_cents', (l->>'amount_cents')::bigint, 'required_by_earlier_offering', coalesce((l->>'required')::boolean, false))
      order by l->>'id'), '[]'::jsonb)
    into omitted
    from jsonb_array_elements(case when r.pricing_inputs->>'version' = 'pricing-v2'
      then coalesce(r.pricing_inputs->'lines', '[]'::jsonb) else '[]'::jsonb end) l
    where l->>'kind' = 'addon';
  select c.name into provider_name from public.contractors c where c.id = p.contractor_id;
  select s.name into service_name from public.services_catalog s where s.id = r.service_catalog_id;
  terms := jsonb_build_object(
    'version', 'offer-terms-v1',
    'provider', jsonb_build_object('id', p.contractor_id, 'name', provider_name),
    'service', jsonb_build_object('id', r.service_catalog_id, 'name', service_name),
    'zip_code', r.zip_code,
    'frequency', r.frequency,
    'offering', jsonb_build_object('package_id', p.id, 'lineage_id', coalesce(p.lineage_id, p.id),
      'revision', private.package_revision_hash(p.id), 'name', p.name, 'description', p.description,
      'policy_notes', p.policy_notes),
    'level', jsonb_build_object('id', t.id, 'name', t.name),
    'scope', jsonb_build_object('included', coalesce(priced->'included_scope', '[]'::jsonb),
      'answers', coalesce(r.package_question_answers, '{}'::jsonb)),
    'lines', priced->'lines',
    'amounts', jsonb_build_object('level_cents', level_cents, 'addon_cents', total_cents - level_cents,
      'total_cents', total_cents, 'currency', 'usd'),
    'exclusions', jsonb_build_object(
      'earlier_addons_not_included', omitted,
      'promotion', 'none',
      'tax', 'Any tax is confirmed by Mercurius before payment and shown at checkout',
      'tip', 'Optional; chosen at checkout'),
    'submission', case when r.pricing_inputs->>'version' = 'pricing-v2' then jsonb_build_object(
      'package_id', r.pricing_inputs->>'package_id', 'tier_id', r.pricing_inputs->>'tier_id',
      'total_cents', r.pricing_inputs->'total_cents') end);
  return jsonb_build_object('ok', true, 'terms', terms,
    'content_hash', encode(sha256(convert_to(terms::text, 'UTF8')), 'hex'),
    'level_cents', level_cents, 'addon_cents', total_cents - level_cents, 'total_cents', total_cents);
end $$;

-- Are these bound terms still acceptable and payable? Null when they are; else a named code. The
-- terms are validated (both hashes, the offer, the revision), never trusted, and then the live checks
-- CS-3 applies (R-1 through bound_offering_problem). Computes no amount; the caller locks.
create function private.offer_terms_problem(r public.service_requests, offer public.job_match_attempts, t public.job_offer_terms)
returns text language plpgsql stable security definer set search_path = '' as $$
declare p public.vendor_packages; tr public.package_tiers; code text;
begin
  if r.id is null or offer.id is null or t.id is null then return 'terms_missing'; end if;
  if t.request_id <> r.id or t.offer_id <> offer.id or offer.service_request_id <> r.id then return 'terms_mismatch'; end if;
  if encode(sha256(convert_to(t.terms::text, 'UTF8')), 'hex') is distinct from t.content_hash
    or private.offer_terms_consent_hash(r.id, offer.id, t.id, t.content_hash) is distinct from t.consent_hash
    or (t.terms#>>'{amounts,total_cents}')::bigint is distinct from t.total_cents
    or (t.terms#>>'{amounts,level_cents}')::bigint is distinct from t.level_cents then
    return 'terms_inconsistent';
  end if;
  if offer.offer_path is distinct from 'fixed' or offer.contractor_id is distinct from t.contractor_id
    or offer.package_id is distinct from t.package_id or offer.package_tier_id is distinct from t.package_tier_id
    or offer.promotion_id is not null or offer.base_price is null or offer.base_price * 100 is distinct from t.level_cents
    or offer.effective_price is null or offer.effective_price * 100 is distinct from t.total_cents then
    return 'offer_mismatch';
  end if;
  select * into p from public.vendor_packages where id = t.package_id;
  select * into tr from public.package_tiers where id = t.package_tier_id;
  if p.id is null or tr.id is null then return 'package_unavailable'; end if;
  if private.package_revision_hash(p.id) is distinct from t.terms#>>'{offering,revision}'
    or tr.price is null or tr.price * 100 is distinct from t.level_cents then
    return 'terms_inconsistent';
  end if;
  if r.service_catalog_id is distinct from t.terms#>>'{service,id}' or r.zip_code is distinct from t.terms->>'zip_code'
    or r.frequency is distinct from t.terms->>'frequency'
    or coalesce(r.package_question_answers, '{}'::jsonb) is distinct from t.terms#>'{scope,answers}'
    or r.promotion_id is not null or r.current_quote_id is not null or r.recurrence_parent_id is not null then
    return 'scope_changed';
  end if;
  -- Once offered, the request carries these terms.
  if r.contractor_id is distinct from t.contractor_id or r.package_id is distinct from t.package_id
    or r.package_tier_id is distinct from t.package_tier_id or r.total_amount is null
    or r.total_amount * 100 is distinct from t.total_cents then
    return 'terms_mismatch';
  end if;
  -- Live eligibility: refused, never substituted.
  code := case
    when not exists(select 1 from public.contractors c where c.id = t.contractor_id and c.is_active and c.marketing_enabled) then 'provider_inactive'
    when not exists(select 1 from public.services_catalog c where c.id = r.service_catalog_id and c.is_active) then 'service_inactive'
    when not exists(select 1 from public.coverage_areas c where c.zip_code = r.zip_code and c.is_active) then 'coverage_inactive'
    when not exists(select 1 from public.contractor_service_zips z where z.contractor_id = t.contractor_id and z.zip_code = r.zip_code) then 'provider_zip'
    else private.bound_offering_problem(p.id, tr.id, r.frequency, t.contractor_id, r.service_catalog_id)
  end;
  if code is not null then return code; end if;
  if tr.rule_question_key is not null then
    if coalesce(r.package_question_answers->tr.rule_question_key->>'answer','') !~ '^-?[0-9]+([.][0-9]+)?$'
      or (tr.rule_min is not null and (r.package_question_answers->tr.rule_question_key->>'answer')::numeric < tr.rule_min)
      or (tr.rule_max is not null and (r.package_question_answers->tr.rule_question_key->>'answer')::numeric > tr.rule_max) then
      return 'answers_mismatch';
    end if;
  end if;
  if private.pricing_tier_matches(private.pricing_tier_json(tr), r.package_question_answers) is not true then
    return 'answers_mismatch';
  end if;
  if exists(select 1 from public.package_qualifying_questions x where x.package_id = p.id and x.is_required
    and nullif(btrim(r.package_question_answers->x.question_key->>'answer'),'') is null) then
    return 'answers_missing';
  end if;
  return null;
end $$;

-- How a fixed one-time candidate would be offered (one-time frequency; plan templates and visits keep
-- their earlier rules) (matching and offer creation use the same rule):
--   'unchanged'  not a fixed one-time offer (quotes, visits): earlier behavior;
--   'submission' the package and level priced at submission (CS-3);
--   'lineage'    the same provider's live revision of the submitted offering, offered AT the
--                submitted row, level and prices (P-2; R-1), so it stays on CS-3's path;
--   'terms'      other terms, bound with {built} and needing the homeowner's acceptance;
--   'blocked'    with reason 'promotion' (never moved to other terms), 'inactive' (the gate is off),
--                'scope' (can't be priced exactly for this request) or 'declined' (the homeowner
--                declined the same commercial content on this request).
create function private.one_time_offer_basis(r public.service_requests, p_contractor uuid, p_package uuid, p_tier uuid,
  p_path text, p_promotion uuid, p_active boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pi jsonb := r.pricing_inputs; bound_pkg public.vendor_packages; cand public.vendor_packages;
  projected public.service_requests; built jsonb; submitted boolean;
begin
  if r.id is null or r.recurrence_parent_id is not null or coalesce(r.frequency, 'one-time') <> 'one-time'
    or p_path is distinct from 'fixed' or r.current_quote_id is not null then
    return jsonb_build_object('basis', 'unchanged');
  end if;
  submitted := pi->>'version' = 'pricing-v2' and pi->>'status' = 'exact' and nullif(pi->>'tier_id', '') is not null;
  if submitted and pi->>'package_id' = p_package::text and pi->>'tier_id' = p_tier::text then
    return jsonb_build_object('basis', 'submission');
  end if;
  -- Promotions and a homeowner's promotion choice never move to other terms (DEC-2026-063).
  if p_promotion is not null or r.promotion_id is not null
    or exists(select 1 from private.promotion_redemptions x where x.service_request_id = r.id and x.status in ('reserved', 'finalized'))
    or exists(select 1 from private.promotion_selections x where x.service_request_id = r.id) then
    return jsonb_build_object('basis', 'blocked', 'reason', 'promotion');
  end if;
  if submitted then
    select * into bound_pkg from public.vendor_packages where id = (pi->>'package_id')::uuid;
    select * into cand from public.vendor_packages where id = p_package;
    if bound_pkg.id is not null and cand.id is not null and cand.contractor_id = bound_pkg.contractor_id
      and coalesce(cand.lineage_id, cand.id) = coalesce(bound_pkg.lineage_id, bound_pkg.id) then
      projected := r;
      projected.contractor_id := bound_pkg.contractor_id; projected.package_id := bound_pkg.id;
      projected.package_tier_id := (pi->>'tier_id')::uuid; projected.frequency := pi->>'frequency';
      projected.pricing_mode := 'fixed'; projected.quote_only := false;
      projected.total_amount := (pi->>'total_cents')::numeric / 100;
      if private.one_time_bound_problem(projected, null) is null then
        return jsonb_build_object('basis', 'lineage', 'package_id', bound_pkg.id, 'tier_id', (pi->>'tier_id')::uuid,
          'base_price', (pi#>>'{lines,0,amount_cents}')::numeric / 100, 'effective_price', (pi->>'total_cents')::numeric / 100);
      end if;
    end if;
  end if;
  if not p_active then return jsonb_build_object('basis', 'blocked', 'reason', 'inactive'); end if;
  built := private.offer_terms_build(r, p_contractor, p_package, p_tier);
  if not (built->>'ok')::boolean then return jsonb_build_object('basis', 'blocked', 'reason', 'scope'); end if;
  if exists(select 1 from public.job_offer_terms_responses x where x.request_id = r.id and not x.accepted
      and x.content_hash = built->>'content_hash') then
    return jsonb_build_object('basis', 'blocked', 'reason', 'declined');
  end if;
  return jsonb_build_object('basis', 'terms', 'built', built);
end $$;

-- The bound terms of the request's current accepted offer, if any.
create function private.offer_terms_current(r public.service_requests) returns public.job_offer_terms
language sql stable security definer set search_path = '' as $$
  select t.* from public.job_match_attempts a join public.job_offer_terms t on t.offer_id = a.id
  where a.service_request_id = r.id and a.outcome = 'accepted' and a.contractor_id = r.contractor_id
  order by a.accepted_at desc nulls last, a.id desc limit 1
$$;

-- 5. Matching ------------------------------------------------------------------------------------------
-- Restated from 20261018006000 (TRACE-116). Changes marked O-10; the rest is unchanged.
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
      (select bp.contractor_id from public.vendor_packages bp where bp.id = (r.pricing_inputs ->> 'package_id')::uuid) as contractor_id,
      (select coalesce(bp.lineage_id, bp.id) from public.vendor_packages bp where bp.id = (r.pricing_inputs ->> 'package_id')::uuid) as lineage_id,
      (r.recurrence_parent_id is null and coalesce(r.frequency, 'one-time') = 'one-time') as one_time,
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
    candidate.effective_price + case when bound.package_id is null or candidate.package_id = bound.package_id
      then coalesce(bound.addon_cents, 0) / 100.0 else 0 end,
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
      and private.package_revision_hash(bound.package_id) = bound.revision)
      -- O-10 (DEC-2026-063): a request priced with add-ons but no promotion may also be offered the
      -- same provider's live revision of the priced offering (offered at the submitted terms, P-2)
      -- and, once offers at other terms are active, another fixed offering at its own bound terms
      -- (the earlier add-ons aren't carried; the homeowner accepts before scheduling or payment).
      or (bound.one_time and bound.promotion_contractor is null and candidate.path = 'fixed' and candidate.promotion_id is null
        and candidate.package_id <> bound.package_id
        and ((candidate.contractor_id = bound.contractor_id
            and (select coalesce(cp.lineage_id, cp.id) from public.vendor_packages cp where cp.id = candidate.package_id) = bound.lineage_id)
          or private.money_gate('offer_terms'))))
$function$;

-- Restated from 20261105001000. Changes marked O-10; the rest is unchanged.
CREATE OR REPLACE FUNCTION private.create_job_offer_internal(_request_id uuid, _contractor_id uuid, _package_id uuid DEFAULT NULL::uuid, _package_tier_id uuid DEFAULT NULL::uuid, _force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  candidate record;
  req public.service_requests;
  basis jsonb;
  active boolean;
  terms_id uuid;
  current_offer uuid;
  offer_id uuid;
  next_attempt integer;
  deadline timestamptz := now() + interval '4 hours';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.service_requests WHERE id=_request_id
    AND status IN ('pending','matched') AND matching_status <> 'matched' FOR UPDATE) THEN
    RAISE EXCEPTION 'Request is no longer open for matching' USING ERRCODE='22023';
  END IF;

  IF NOT private.fallback_permitted(_request_id,_contractor_id) THEN
    RAISE EXCEPTION 'Homeowner consent is required before provider fallback' USING ERRCODE='42501';
  END IF;

  -- O-10: a request whose provider accepted bound terms waits for the homeowner. Only an operator
  -- force offer supersedes those terms (the homeowner's answer to them is then stale).
  SELECT * INTO req FROM public.service_requests WHERE id=_request_id;
  IF req.matching_status = 'awaiting_terms' THEN
    IF NOT _force THEN
      RAISE EXCEPTION 'The homeowner must answer this provider''s terms first' USING ERRCODE='22023';
    END IF;
    UPDATE public.job_match_attempts
    SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
        reason = 'Withdrawn by admin force offer', updated_at = now()
    WHERE service_request_id = _request_id AND outcome = 'accepted' AND contractor_id = req.contractor_id;
    PERFORM set_config('mercurius.offer_terms', _request_id::text, true);
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at <= now();

  SELECT id INTO current_offer
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id AND outcome = 'pending'
  ORDER BY offered_at DESC
  LIMIT 1;

  IF current_offer IS NOT NULL AND NOT _force THEN
    RETURN current_offer;
  END IF;

  IF current_offer IS NOT NULL THEN
    UPDATE public.job_match_attempts
    SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
        reason = 'Withdrawn by admin force offer', updated_at = now()
    WHERE id = current_offer;
  END IF;

  SELECT eligible.* INTO candidate
  FROM private.find_eligible_packages_core(_request_id) eligible
  WHERE eligible.contractor_id = _contractor_id
    AND (_package_id IS NULL OR eligible.package_id = _package_id)
    AND (_package_tier_id IS NULL OR eligible.package_tier_id = _package_tier_id)
  ORDER BY eligible.rank_order
  LIMIT 1;

  IF candidate.contractor_id IS NULL THEN
    RAISE EXCEPTION 'Selected contractor/package is no longer eligible for this request';
  END IF;

  IF NOT _force AND EXISTS (
    SELECT 1 FROM public.job_match_attempts previous
    WHERE previous.service_request_id = _request_id
      AND previous.contractor_id = _contractor_id
      AND previous.outcome IN ('declined', 'expired', 'withdrawn')
  ) THEN
    RAISE EXCEPTION 'This contractor already closed an offer for this request';
  END IF;

  -- O-10 (DEC-2026-063): how this fixed one-time candidate is offered. The gate row and the
  -- candidate's provider, level and offering are share-locked first, so the terms bound here are
  -- exactly the revision read, and a switch-off waits for this offer (or refuses it).
  active := private.offer_terms_active(true);
  PERFORM 1 FROM public.contractors WHERE id = candidate.contractor_id FOR SHARE;
  PERFORM 1 FROM public.package_tiers WHERE id = candidate.package_tier_id FOR SHARE;
  PERFORM 1 FROM public.vendor_packages WHERE id = candidate.package_id FOR SHARE;
  SELECT * INTO req FROM public.service_requests WHERE id=_request_id;
  basis := private.one_time_offer_basis(req, candidate.contractor_id, candidate.package_id, candidate.package_tier_id,
    candidate.path, candidate.promotion_id, active);
  IF basis->>'basis' = 'blocked' THEN
    RAISE EXCEPTION '%', CASE basis->>'reason'
        WHEN 'inactive' THEN 'Offers at terms other than the submitted ones are not active yet'
        WHEN 'declined' THEN 'The homeowner declined these terms'
        WHEN 'promotion' THEN 'A promotion can''t move to another offering'
        ELSE 'This offering can''t be priced for this request''s answers' END
      USING ERRCODE='22023', DETAIL='offer_terms:' || (basis->>'reason');
  ELSIF basis->>'basis' = 'lineage' THEN
    -- P-2: the same provider's live revision; offered at the submitted row, level and prices.
    candidate.package_id := (basis->>'package_id')::uuid;
    candidate.package_tier_id := (basis->>'tier_id')::uuid;
    candidate.base_price := (basis->>'base_price')::numeric;
    candidate.effective_price := (basis->>'effective_price')::numeric;
  ELSIF basis->>'basis' = 'terms' THEN
    candidate.base_price := (basis#>>'{built,level_cents}')::numeric / 100;
    candidate.effective_price := (basis#>>'{built,total_cents}')::numeric / 100;
  END IF;

  SELECT COALESCE(max(attempt_number), 0) + 1 INTO next_attempt
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id;

  INSERT INTO public.job_match_attempts (
    service_request_id, contractor_id, package_id, package_tier_id,
    promotion_id, frequency, offer_path, base_price, effective_price,
    score, score_breakdown, rank_order, attempt_number, offered_at,
    expires_at, outcome
  ) VALUES (
    _request_id, candidate.contractor_id, candidate.package_id,
    candidate.package_tier_id, candidate.promotion_id, candidate.frequency,
    candidate.path, candidate.base_price, candidate.effective_price,
    candidate.total_score, candidate.score_breakdown, candidate.rank_order,
    next_attempt, now(), deadline, 'pending'
  )
  RETURNING id INTO offer_id;

  IF basis->>'basis' = 'terms' THEN
    terms_id := gen_random_uuid();
    INSERT INTO public.job_offer_terms(id, request_id, offer_id, contractor_id, package_id, package_tier_id, terms,
      content_hash, consent_hash, level_cents, addon_cents, total_cents)
    VALUES (terms_id, _request_id, offer_id, candidate.contractor_id, candidate.package_id, candidate.package_tier_id,
      basis#>'{built,terms}', basis#>>'{built,content_hash}',
      private.offer_terms_consent_hash(_request_id, offer_id, terms_id, basis#>>'{built,content_hash}'),
      (basis#>>'{built,level_cents}')::bigint, (basis#>>'{built,addon_cents}')::bigint, (basis#>>'{built,total_cents}')::bigint);
  END IF;

  UPDATE public.service_requests
  SET contractor_id = candidate.contractor_id,
      assigned_at = now(),
      match_expires_at = deadline,
      match_attempt_count = next_attempt,
      matching_status = 'offered',
      needs_admin_review = false,
      status = 'matched',
      package_id = candidate.package_id,
      package_tier_id = candidate.package_tier_id,
      promotion_id = candidate.promotion_id,
      frequency = candidate.frequency,
      pricing_mode = CASE WHEN candidate.path = 'fixed' THEN 'fixed' ELSE 'custom_quote' END,
      quote_only = candidate.path = 'quote',
      base_amount = candidate.base_price,
      resolved_price = candidate.effective_price,
      total_amount = candidate.effective_price,
      updated_at = now()
  WHERE id = _request_id;

  INSERT INTO public.job_events(job_id, event_type, actor_id, metadata)
  VALUES (_request_id, 'match_offered', auth.uid(),
    jsonb_build_object('offer_id', offer_id, 'contractor_id', candidate.contractor_id,
      'expires_at', deadline, 'path', candidate.path, 'rank', candidate.rank_order, 'ranking_version','balanced-v2',
      'terms_basis', basis->>'basis', 'terms_id', terms_id));

  INSERT INTO public.notifications(user_id,type,severity,title,body,link,related_request_id,related_contractor_id)
    SELECT user_id,'job_offer','warning','New job offer — respond within four hours',
      'Accept or decline this exclusive offer before its four-hour deadline.','/vendor/jobs',_request_id,candidate.contractor_id
    FROM public.contractors WHERE id=candidate.contractor_id AND user_id IS NOT NULL;
  RETURN offer_id;
END;
$function$;

-- Restated from 20261102001000. Changes marked O-10; the rest is unchanged.
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
  active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  SELECT * INTO r FROM public.service_requests request WHERE request.id = _request_id;
  IF r.status NOT IN ('pending', 'matched') OR r.matching_status IN ('matched', 'awaiting_homeowner', 'awaiting_terms') THEN
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

  -- O-10: the gate is read once, share-locked, for the whole selection; candidates that can't be
  -- offered (other terms while the gate is off, unpriceable scope, a declined content, a promotion)
  -- are skipped and the next one is tried.
  active := private.offer_terms_active(true);

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
    AND private.one_time_offer_basis(r, eligible.contractor_id, eligible.package_id, eligible.package_tier_id,
      eligible.path, eligible.promotion_id, active)->>'basis' <> 'blocked'
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
    -- O-10 recovery: a one-time request left without an offer while the gate is off is recorded, so
    -- operations can retry it after activation. A request priced with add-ons doesn't even list
    -- other-terms candidates while the gate is off, so every such exhaustion is recorded; the
    -- candidates skipped only because of the gate are listed when known.
    IF NOT active AND r.id IS NOT NULL AND r.recurrence_parent_id IS NULL AND coalesce(r.frequency, 'one-time') = 'one-time' THEN
      INSERT INTO private.offer_terms_blocks(request_id, candidates)
      SELECT _request_id, coalesce(jsonb_agg(jsonb_build_object('contractor_id', e.contractor_id, 'package_id', e.package_id,
          'package_tier_id', e.package_tier_id) ORDER BY e.rank_order), '[]'::jsonb)
      FROM private.find_eligible_packages_core(_request_id) e
      WHERE NOT EXISTS (SELECT 1 FROM public.job_match_attempts previous
          WHERE previous.service_request_id = _request_id AND previous.contractor_id = e.contractor_id
            AND previous.outcome IN ('accepted', 'declined', 'expired', 'withdrawn'))
        AND private.one_time_offer_basis(r, e.contractor_id, e.package_id, e.package_tier_id, e.path, e.promotion_id, false)->>'reason' = 'inactive';
    END IF;
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

-- 6. Acceptance ----------------------------------------------------------------------------------------
-- Restated from 20261116001000 (CS-3). Changes marked O-10; the rest is unchanged.
CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  offer record;
  still_eligible boolean;
  prior_status public.request_status;
  homeowner uuid;
  r public.service_requests;
  replacement boolean;
  recipient uuid;
  offer_row public.job_match_attempts;
  projected public.service_requests;
  visit_problem text;
  one_time_bound boolean;
  terms_row public.job_offer_terms;
  terms_problem text;
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

  replacement := r.recurrence_parent_id IS NULL AND private.provider_withdrawal_open(r);
  -- CS-3 (D-1, R-2): an offer of the package and level priced at submission, for a one-time fixed
  -- request without a promotion or quote, is accepted at those bound terms. Any other offer keeps
  -- the earlier check.
  one_time_bound := r.recurrence_parent_id IS NULL AND NOT replacement AND offer.offer_path = 'fixed'
    AND r.current_quote_id IS NULL AND r.promotion_id IS NULL AND offer.promotion_id IS NULL
    AND r.pricing_inputs->>'version' = 'pricing-v2' AND r.pricing_inputs->>'status' = 'exact'
    AND offer.package_id IS NOT NULL AND offer.package_tier_id IS NOT NULL
    AND r.pricing_inputs->>'package_id' = offer.package_id::text
    AND nullif(r.pricing_inputs->>'tier_id', '') = offer.package_tier_id::text
    AND NOT EXISTS (SELECT 1 FROM private.promotion_redemptions x WHERE x.service_request_id = r.id AND x.status IN ('reserved', 'finalized'))
    AND NOT EXISTS (SELECT 1 FROM private.promotion_selections x WHERE x.service_request_id = r.id);
  -- O-10: an offer created at bound terms (another provider, package or level).
  SELECT * INTO terms_row FROM public.job_offer_terms WHERE offer_id = offer.id;

  IF r.recurrence_parent_id IS NOT NULL AND (private.recurring_visit_terms(r.id)).id IS NOT NULL THEN
    -- CS-4 (D-2, R-1): a visit is accepted at the plan terms bound to its creation, judged by the same
    -- rule as its payment, plus the provider's matching eligibility (onboarding, compliance, listing
    -- exclusion) as before. Locks follow the header's order.
    PERFORM 1 FROM public.contractors WHERE id = r.contractor_id FOR SHARE;
    PERFORM 1 FROM public.package_tiers WHERE id = r.package_tier_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages WHERE id = r.package_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages v WHERE v.is_active
      AND v.lineage_id = (SELECT coalesce(b.lineage_id, b.id) FROM public.vendor_packages b WHERE b.id = r.package_id) FOR SHARE;
    PERFORM 1 FROM public.services_catalog WHERE id = r.service_catalog_id FOR SHARE;
    PERFORM 1 FROM public.coverage_areas WHERE zip_code = r.zip_code FOR SHARE;
    PERFORM 1 FROM public.contractor_service_zips WHERE contractor_id = r.contractor_id AND zip_code = r.zip_code FOR SHARE;
    -- Judged as acceptance leaves the visit: the fields the update below copies from the offer.
    SELECT * INTO offer_row FROM public.job_match_attempts WHERE id = offer.id;
    projected := r;
    projected.contractor_id := offer.contractor_id; projected.package_id := offer.package_id;
    projected.package_tier_id := offer.package_tier_id; projected.promotion_id := offer.promotion_id;
    projected.frequency := offer.frequency;
    projected.pricing_mode := CASE WHEN offer.offer_path = 'fixed' THEN 'fixed' ELSE 'custom_quote' END;
    projected.quote_only := offer.offer_path = 'quote';
    projected.base_amount := offer.base_price; projected.resolved_price := offer.effective_price;
    projected.total_amount := offer.effective_price;
    visit_problem := private.recurring_visit_offer_problem(projected, offer_row);
    IF visit_problem IS NULL AND NOT private.vendor_matching_eligible(offer.contractor_id) THEN
      visit_problem := 'provider_not_matchable';
    END IF;
    IF visit_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023', DETAIL='recurring_visit:' || visit_problem;
    END IF;
  ELSIF terms_row.id IS NOT NULL THEN
    -- O-10: accepted only while offers at other terms are active (gate share-locked, so a switch-off
    -- serializes with this acceptance), at exactly the bound terms, with the live checks.
    IF NOT private.offer_terms_active(true) THEN
      RAISE EXCEPTION 'Offers at other terms are paused; Mercurius will follow up' USING ERRCODE='22023', DETAIL='offer_terms:inactive';
    END IF;
    PERFORM 1 FROM public.contractors WHERE id = offer.contractor_id FOR SHARE;
    PERFORM 1 FROM public.job_offer_terms WHERE id = terms_row.id FOR SHARE;
    PERFORM 1 FROM public.package_tiers WHERE id = terms_row.package_tier_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages WHERE id = terms_row.package_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages v WHERE v.is_active
      AND (v.lineage_id = (SELECT coalesce(b.lineage_id, b.id) FROM public.vendor_packages b WHERE b.id = terms_row.package_id)
        OR v.id = terms_row.package_id) FOR SHARE;
    PERFORM 1 FROM public.package_qualifying_questions WHERE package_id = terms_row.package_id FOR SHARE;
    PERFORM 1 FROM public.services_catalog WHERE id = r.service_catalog_id FOR SHARE;
    PERFORM 1 FROM public.coverage_areas WHERE zip_code = r.zip_code FOR SHARE;
    PERFORM 1 FROM public.contractor_service_zips WHERE contractor_id = offer.contractor_id AND zip_code = r.zip_code FOR SHARE;
    SELECT * INTO offer_row FROM public.job_match_attempts WHERE id = offer.id;
    terms_problem := private.offer_terms_problem(r, offer_row, terms_row);
    IF terms_problem IS NULL AND NOT private.vendor_matching_eligible(offer.contractor_id) THEN
      terms_problem := 'provider_not_matchable';
    END IF;
    IF terms_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023', DETAIL='offer_terms:' || terms_problem;
    END IF;
  ELSIF one_time_bound THEN
    -- Same lock order as money_source's bound one-time path.
    PERFORM 1 FROM public.contractors WHERE id = offer.contractor_id FOR SHARE;
    PERFORM 1 FROM public.package_tiers WHERE id = offer.package_tier_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages WHERE id = offer.package_id FOR SHARE;
    PERFORM 1 FROM public.vendor_packages v WHERE v.is_active
      AND (v.lineage_id = (SELECT coalesce(b.lineage_id, b.id) FROM public.vendor_packages b WHERE b.id = offer.package_id)
        OR v.id = offer.package_id) FOR SHARE;
    PERFORM 1 FROM public.package_qualifying_questions WHERE package_id = offer.package_id FOR SHARE;
    PERFORM 1 FROM public.services_catalog WHERE id = r.service_catalog_id FOR SHARE;
    PERFORM 1 FROM public.coverage_areas WHERE zip_code = r.zip_code FOR SHARE;
    PERFORM 1 FROM public.contractor_service_zips WHERE contractor_id = offer.contractor_id AND zip_code = r.zip_code FOR SHARE;
    SELECT * INTO offer_row FROM public.job_match_attempts WHERE id = offer.id;
    projected := r;
    projected.contractor_id := offer.contractor_id; projected.package_id := offer.package_id;
    projected.package_tier_id := offer.package_tier_id; projected.promotion_id := offer.promotion_id;
    projected.frequency := offer.frequency; projected.pricing_mode := 'fixed'; projected.quote_only := false;
    projected.base_amount := offer.base_price; projected.resolved_price := offer.effective_price;
    projected.total_amount := offer.effective_price;
    visit_problem := private.one_time_bound_problem(projected, offer_row);
    IF visit_problem IS NULL AND NOT private.vendor_matching_eligible(offer.contractor_id) THEN
      visit_problem := 'provider_not_matchable';
    END IF;
    IF visit_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023', DETAIL='one_time:' || visit_problem;
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM private.find_eligible_packages_core(_job_id) eligible
      WHERE eligible.contractor_id = offer.contractor_id
        AND eligible.package_id = offer.package_id
        AND (offer.package_tier_id IS NULL OR eligible.package_tier_id = offer.package_tier_id)
    ) INTO still_eligible;

    IF NOT still_eligible THEN
      RAISE EXCEPTION 'Provider is no longer eligible' USING ERRCODE='22023';
    END IF;
  END IF;

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

  IF terms_row.id IS NOT NULL THEN
    -- O-10 (DEC-2026-063): the provider's acceptance is not the homeowner's consent. Nothing is
    -- scheduled or payable until the homeowner accepts these exact terms.
    PERFORM set_config('mercurius.offer_terms', _job_id::text, true);
    UPDATE public.service_requests
    SET contractor_id = offer.contractor_id, match_expires_at = NULL, matching_status = 'awaiting_terms',
        status = 'matched', updated_at = now()
    WHERE id = _job_id;
    PERFORM set_config('mercurius.offer_terms', '', true);
    PERFORM public.log_job_event(_job_id,'status_changed',auth.uid(),
      jsonb_build_object('action','provider_accepted_terms','offer_id',offer.id,'terms_id',terms_row.id,
        'contractor_id',offer.contractor_id,'policy','DEC-2026-063'));
    PERFORM public.notify_user(homeowner,'job_status','info','Review this provider''s terms',
      'A provider accepted your request at the terms shown. Nothing is scheduled or charged until you accept them.',
      '/dashboard',_job_id,offer.contractor_id);
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
$function$
;

-- 7. Payment source ------------------------------------------------------------------------------------
-- Restated from 20261116001000 (CS-3). Changes marked O-10; other paths are unchanged.
CREATE OR REPLACE FUNCTION private.money_source(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
  priced jsonb; addon_cents bigint := 0; wanted jsonb; promo private.promotion_redemptions; offer private.promotion_offers;
  choice private.promotion_selections; visit_check jsonb; bound boolean; one_time_problem text;
  terms_row public.job_offer_terms; terms_offer public.job_match_attempts; terms_answer public.job_offer_terms_responses;
begin
  select * into strict r from public.service_requests where id=p_request;
  -- CS-3 (D-1, R-2, R-4, R-5): a one-time fixed request whose accepted package and level are the
  -- ones priced at submission is priced from those bound rows. Any other one-time request keeps the
  -- earlier check unchanged.
  bound := r.recurrence_parent_id is null and r.current_quote_id is null
    and r.pricing_inputs->>'version' = 'pricing-v2' and r.pricing_inputs->>'status' = 'exact'
    and r.package_id is not null and r.package_tier_id is not null
    and r.pricing_inputs->>'package_id' = r.package_id::text
    and nullif(r.pricing_inputs->>'tier_id','') = r.package_tier_id::text;
  -- O-10 (DEC-2026-063): otherwise, the bound terms of the accepted offer, if it has them.
  if not bound and r.recurrence_parent_id is null and r.current_quote_id is null and coalesce(r.frequency, 'one-time') = 'one-time' then
    select a.* into terms_offer from public.job_match_attempts a
      where a.service_request_id = r.id and a.outcome = 'accepted' and a.contractor_id = r.contractor_id
      order by a.accepted_at desc nulls last, a.id desc limit 1;
    if terms_offer.id is not null then
      select * into terms_row from public.job_offer_terms where offer_id = terms_offer.id;
    end if;
  end if;
  -- CS-4/CS-3: a recurring visit and a bound one-time request take no table lock on qualifying
  -- questions (a package save writes them after locking its package; bound rows are immutable and
  -- share-locked below). Other paths keep both table locks.
  if r.recurrence_parent_id is not null or bound or terms_row.id is not null then
    lock table public.package_promotions in share mode;
  else
    lock table public.package_promotions,public.package_qualifying_questions in share mode;
  end if;
  if r.customer_id is null or r.contractor_id is null or r.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    raise exception 'Scheduled commercial parties required';
  end if;
  request_context:=private.money_source_context(r);
  -- TRACE-125 (DEC-2026-049 item 6): a recurring visit is priced from the plan terms bound to its
  -- creation and its own accepted offer, never from the current tier or add-on prices; the evidence
  -- carries only those immutable terms, so later catalog edits leave the source hash unchanged. Rows
  -- the live eligibility check reads are share-locked, as for one-time requests.
  if r.recurrence_parent_id is not null then
    perform 1 from public.job_match_attempts where service_request_id=r.id and outcome='accepted' for share;
    -- CS-4 lock order: provider before package rows (package writers lock the provider first), tier
    -- before package (a maintenance tier edit locks its tier and then its package), then the
    -- offering's live revision.
    perform 1 from public.contractors where id=r.contractor_id for share;
    perform 1 from public.package_tiers where id=r.package_tier_id for share;
    perform 1 from public.vendor_packages where id=r.package_id for share;
    perform 1 from public.vendor_packages v where v.is_active
      and v.lineage_id=(select coalesce(b.lineage_id,b.id) from public.vendor_packages b where b.id=r.package_id) for share;
    perform 1 from public.services_catalog where id=r.service_catalog_id for share;
    perform 1 from public.coverage_areas where zip_code=r.zip_code for share;
    perform 1 from public.contractor_service_zips where contractor_id=r.contractor_id and zip_code=r.zip_code for share;
    visit_check:=private.recurring_visit_source_check(r);
    if not (visit_check->>'ok')::boolean then
      raise exception '%', visit_check#>>'{problem,message}'
        using detail='recurring_visit:'||(visit_check->>'code'), hint=visit_check#>>'{problem,recovery}';
    end if;
    price:=(visit_check->>'service_cents')::bigint; addon_cents:=(visit_check->>'addon_cents')::bigint;
    evidence:=jsonb_build_object('kind','offering','context',request_context,'recurring_terms',visit_check->'terms',
      'visit_offer',visit_check->'visit_offer','service',price);
    if addon_cents>0 then evidence:=evidence||jsonb_build_object('addons',addon_cents,'pricing',visit_check#>'{terms,pricing,lines}'); end if;
    return evidence||jsonb_build_object('version','commercial-v1:'||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
  end if;
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
    if bound then
      -- CS-3 lock order (plan §7.2, as CS-4): provider -> bound tier -> bound package -> the
      -- offering's live revision -> the bound package's questions and add-ons -> catalog ->
      -- coverage -> provider ZIP.
      perform 1 from public.contractors where id=r.contractor_id for share;
      select * into strict t from public.package_tiers where id=r.package_tier_id for share;
      select * into strict p from public.vendor_packages where id=r.package_id for share;
      perform 1 from public.vendor_packages v where v.is_active
        and (v.lineage_id=coalesce(p.lineage_id,p.id) or v.id=p.id) for share;
      perform 1 from public.package_qualifying_questions where package_id=p.id for share;
      perform 1 from public.package_addons where package_id=p.id for share;
      perform 1 from public.services_catalog where id=r.service_catalog_id for share;
      perform 1 from public.coverage_areas where zip_code=r.zip_code for share;
      perform 1 from public.contractor_service_zips where contractor_id=r.contractor_id and zip_code=r.zip_code for share;
      one_time_problem := private.one_time_bound_problem(r, null);
      if one_time_problem is not null then
        raise exception '%', case
          when one_time_problem='answers_mismatch' then 'Offering answers do not match selected tier'
          when one_time_problem='answers_missing' then 'Required offering answers missing'
          when one_time_problem='terms_inconsistent' and exists(select 1 from jsonb_array_elements(coalesce(r.pricing_inputs->'lines','[]'::jsonb)) l where l->>'kind'='addon')
            then 'Offering add-ons changed since the request; a new request or quote is required'
          when one_time_problem in ('terms_inconsistent','terms_missing') then 'Offering changed since the request; a new request or quote is required'
          else 'Selected offering is not eligible' end
          using detail='one_time:'||one_time_problem;
      end if;
      price:=private.money_minor_units(t.price);
      -- DEC-2026-041 item 2: add-ons are priced again from the bound package content with the same
      -- calculation and must give the exact result recorded at submission.
      if exists(select 1 from jsonb_array_elements(coalesce(r.pricing_inputs->'lines','[]'::jsonb)) l where l->>'kind'='addon') then
        select coalesce(jsonb_agg(jsonb_build_object('id', l->>'id', 'quantity', (l->>'quantity')::integer) order by l->>'id'), '[]'::jsonb)
          into wanted from jsonb_array_elements(r.pricing_inputs->'lines') l where l->>'kind'='addon';
        priced:=private.price_selection(private.package_content(p.id), r.frequency, t.id::text, r.package_question_answers, wanted);
        if priced->>'status' is distinct from 'exact' or (priced->>'total_cents')::bigint is distinct from (r.pricing_inputs->>'total_cents')::bigint
          or (priced#>>'{lines,0,amount_cents}')::bigint is distinct from price then
          raise exception 'Offering add-ons do not price the same as the request' using detail='one_time:addons_mismatch';
        end if;
        select coalesce(sum((l->>'amount_cents')::bigint),0) into addon_cents from jsonb_array_elements(priced->'lines') l where l->>'kind'='addon';
      end if;
      if r.promotion_id is not null or exists(select 1 from public.package_promotions where package_id=p.id and is_enabled and starts_at<=now() and ends_at>now()) then
        raise exception 'Promotion allocation integration required';
      end if;
      -- R-4: evidence from immutable bound fields only (commercial-v2), so a replacement of the
      -- offering (which pauses the bound row) leaves the source hash unchanged.
      evidence:=jsonb_build_object('kind','offering','context',request_context,'bound',jsonb_build_object(
        'package',p.id,'lineage',coalesce(p.lineage_id,p.id),'revision',r.pricing_inputs->>'package_revision',
        'tier',t.id,'frequency',t.frequency,'level_cents',price,'total_cents',(r.pricing_inputs->>'total_cents')::bigint),
        'service',price);
      if addon_cents>0 then evidence:=evidence||jsonb_build_object('addons',addon_cents,'pricing',priced->'lines'); end if;
    elsif terms_row.id is not null then
      -- O-10: priced only from the bound terms the homeowner accepted (this offer, this terms row,
      -- this consent hash). Catalog edits never reprice them; live refusals block by name.
      perform 1 from public.contractors where id=r.contractor_id for share;
      perform 1 from public.job_offer_terms where id=terms_row.id for share;
      select * into strict t from public.package_tiers where id=terms_row.package_tier_id for share;
      select * into strict p from public.vendor_packages where id=terms_row.package_id for share;
      perform 1 from public.vendor_packages v where v.is_active
        and (v.lineage_id=coalesce(p.lineage_id,p.id) or v.id=p.id) for share;
      perform 1 from public.package_qualifying_questions where package_id=p.id for share;
      perform 1 from public.services_catalog where id=r.service_catalog_id for share;
      perform 1 from public.coverage_areas where zip_code=r.zip_code for share;
      perform 1 from public.contractor_service_zips where contractor_id=r.contractor_id and zip_code=r.zip_code for share;
      select * into terms_answer from public.job_offer_terms_responses where terms_id=terms_row.id;
      if terms_answer.id is null or not terms_answer.accepted or terms_answer.consent_hash is distinct from terms_row.consent_hash
        or terms_answer.offer_id is distinct from terms_offer.id or terms_answer.actor_id is distinct from r.customer_id then
        raise exception 'The homeowner hasn''t accepted this provider''s terms' using detail='offer_terms:consent_missing';
      end if;
      one_time_problem := private.offer_terms_problem(r, terms_offer, terms_row);
      if one_time_problem is not null then
        raise exception '%', case
          when one_time_problem='answers_mismatch' then 'Offering answers do not match selected tier'
          when one_time_problem='answers_missing' then 'Required offering answers missing'
          when one_time_problem in ('terms_inconsistent','terms_mismatch','offer_mismatch','scope_changed','terms_missing')
            then 'Offering changed since the terms were accepted; a new offer is required'
          else 'Selected offering is not eligible' end
          using detail='offer_terms:'||one_time_problem;
      end if;
      if exists(select 1 from public.package_promotions where package_id=p.id and is_enabled and starts_at<=now() and ends_at>now()) then
        raise exception 'Promotion allocation integration required';
      end if;
      price:=terms_row.level_cents; addon_cents:=terms_row.addon_cents;
      evidence:=jsonb_build_object('kind','offering','context',request_context,'offer_terms',jsonb_build_object(
        'terms_id',terms_row.id,'offer_id',terms_offer.id,'response_id',terms_answer.id,'content_hash',terms_row.content_hash,
        'consent_hash',terms_row.consent_hash,'level_cents',terms_row.level_cents,'addon_cents',terms_row.addon_cents,
        'total_cents',terms_row.total_cents),'service',price);
      if addon_cents>0 then evidence:=evidence||jsonb_build_object('addons',addon_cents,'pricing',terms_row.terms->'lines'); end if;
    else
    -- O-10 P-4 (narrowed): a fixed one-time request with a submission record or any offer is priced
    -- only from bound terms. The earlier live-price rule below remains only for a row with neither,
    -- which product commands don't create (TRACE-126 stays open for that residue).
    if coalesce(r.frequency, 'one-time') = 'one-time' and (r.pricing_inputs->>'version' = 'pricing-v2'
      or exists(select 1 from public.job_match_attempts a where a.service_request_id=r.id)) then
      raise exception 'This request''s agreed price wasn''t recorded; a new request or quote is required' using detail='one_time:terms_missing';
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
    end if;

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
  return evidence||jsonb_build_object('version',case when bound or terms_row.id is not null then 'commercial-v2:' else 'commercial-v1:' end
    ||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $function$
;

-- 8. E6 replacement answers (P-5) ----------------------------------------------------------------------
-- Restated from 20261102001000. Changes marked O-10; the rest is unchanged.
create or replace function public.homeowner_respond_replacement(_proposal_id uuid, _response_key uuid, _accept boolean,
  _expected jsonb, _reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.job_replacement_proposals; r public.service_requests; prior public.job_replacement_responses;
  response public.job_replacement_responses; attempt public.job_match_attempts; eligible boolean; recipient uuid;
  t public.job_offer_terms; problem text;
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
  -- O-10 (P-5): a replacement of another provider carries bound terms; the answer names them.
  select * into t from public.job_offer_terms where offer_id = attempt.id;
  -- The service must still be open: a cancellation or withdrawal since the proposal makes it stale.
  if r.status not in ('matched', 'quoted') or (private.current_replacement_proposal(r)).id is distinct from p.id
     or attempt.id is distinct from p.match_attempt_id
     or r.contractor_id is distinct from p.contractor_id or not private.provider_withdrawal_open(r)
     or _expected is distinct from jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id, 'starts_at', p.starts_at)
       || (case when t.id is not null then jsonb_build_object('terms_id', t.id, 'consent_hash', t.consent_hash) else '{}'::jsonb end) then
    raise exception 'This proposal changed since you opened it. Review the current details.' using errcode = '40001';
  end if;
  if _accept then
    if p.starts_at <= now() then raise exception 'That time has passed. Mercurius will propose another time.' using errcode = '22023'; end if;
    if private.request_agreed_terms(r) is distinct from p.terms then
      raise exception 'This proposal changed since you opened it. Review the current details.' using errcode = '40001';
    end if;
    if t.id is not null then
      perform 1 from public.contractors where id = t.contractor_id for share;
      perform 1 from public.job_offer_terms where id = t.id for share;
      perform 1 from public.package_tiers where id = t.package_tier_id for share;
      perform 1 from public.vendor_packages where id = t.package_id for share;
      perform 1 from public.vendor_packages v where v.is_active
        and (v.lineage_id = (select coalesce(b.lineage_id, b.id) from public.vendor_packages b where b.id = t.package_id)
          or v.id = t.package_id) for share;
      perform 1 from public.package_qualifying_questions where package_id = t.package_id for share;
      perform 1 from public.services_catalog where id = r.service_catalog_id for share;
      perform 1 from public.coverage_areas where zip_code = r.zip_code for share;
      perform 1 from public.contractor_service_zips where contractor_id = t.contractor_id and zip_code = r.zip_code for share;
      problem := private.offer_terms_problem(r, attempt, t);
      eligible := problem is null and private.vendor_matching_eligible(t.contractor_id);
    else
    select exists(select 1 from private.find_eligible_packages_core(r.id) e
      where e.contractor_id = attempt.contractor_id and e.package_id = attempt.package_id
        and (attempt.package_tier_id is null or e.package_tier_id = attempt.package_tier_id)) into eligible;
    end if;
    if not eligible then
      raise exception 'This provider can''t take the service right now. Mercurius will follow up.' using errcode = '22023';
    end if;
  end if;
  insert into public.job_replacement_responses(proposal_id, job_id, response_key, actor_id, accepted, reason, before_value)
    values (p.id, r.id, _response_key, auth.uid(), _accept, nullif(btrim(_reason), ''),
      jsonb_build_object('status', r.status, 'contractor_id', r.contractor_id, 'scheduled_start_at', r.scheduled_start_at,
        'matching_status', r.matching_status))
    returning * into response;
  if t.id is not null then
    insert into public.job_offer_terms_responses(terms_id, request_id, offer_id, consent_hash, content_hash, response_key,
        actor_id, accepted, via, reason, before_value)
      values (t.id, r.id, attempt.id, t.consent_hash, t.content_hash, _response_key, auth.uid(), _accept, 'replacement',
        nullif(btrim(_reason), ''), jsonb_build_object('proposal_id', p.id, 'status', r.status, 'matching_status', r.matching_status));
  end if;
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

-- Restated from 20261102001000. Change (O-10, P-5): the proposal shows the replacement's bound terms and
-- the homeowner's expected answer names them.
create or replace function private.job_replacement_state(p_request public.service_requests, p_admin boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare w public.job_operations; p public.job_replacement_proposals; answer public.job_replacement_responses;
  open boolean; deadline timestamptz; state text; provider text; t public.job_offer_terms;
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
    -- O-10 (P-5): the replacement offer's bound terms, which the homeowner's answer names.
    select * into t from public.job_offer_terms where offer_id = p.match_attempt_id;
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
      'terms', case when t.id is not null then jsonb_build_object('id', t.id, 'total_cents', t.total_cents, 'terms', t.terms) end,
      'answer', case when answer.id is not null then jsonb_build_object('accepted', answer.accepted, 'at', answer.created_at,
        'reason', answer.reason) end) end,
    'expected', case when state = 'awaiting_homeowner' then jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id,
      'starts_at', p.starts_at) || (case when t.id is not null then jsonb_build_object('terms_id', t.id, 'consent_hash', t.consent_hash)
        else '{}'::jsonb end) end,
    'admin_expected', case when p_admin and state in ('awaiting_homeowner', 'awaiting_proposal')
      then jsonb_build_object('contractor_id', p_request.contractor_id, 'proposal_id', (private.current_replacement_proposal(p_request)).id) end);
end $$;

-- Restated from 20261024002000. Adds: who asked for a time and the fee consequence, the homeowner's

-- 9. The homeowner's answer ---------------------------------------------------------------------------
-- _expected = {terms_id, consent_hash} as the homeowner's screen loaded them. One answer per terms
-- row; a retry with the same key and intent returns it; anything that changed since the screen loaded
-- (another offer, a withdrawal, a cancellation, a force offer) is refused as stale and writes nothing.
-- Accepting runs the live checks under the bound-terms locks; a refusal names its reason and writes
-- nothing, so the homeowner can still decline. Declining runs no eligibility check.
create function public.homeowner_respond_offer_terms(_terms_id uuid, _response_key uuid, _accept boolean,
  _expected jsonb, _reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.job_offer_terms; r public.service_requests; prior public.job_offer_terms_responses;
  response public.job_offer_terms_responses; attempt public.job_match_attempts; problem text; recipient uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated actor required' using errcode = '42501'; end if;
  if _terms_id is null or _response_key is null or _accept is null then
    raise exception 'Terms, answer and response key required' using errcode = '22023';
  end if;
  select * into t from public.job_offer_terms where id = _terms_id;
  if t.id is null then raise exception 'Only the homeowner can answer these terms' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(t.request_id::text, 0));
  select * into r from public.service_requests where id = t.request_id for update;
  if r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can answer these terms' using errcode = '42501';
  end if;
  select * into prior from public.job_offer_terms_responses where request_id = r.id and response_key = _response_key;
  if prior.id is not null then
    if prior.terms_id <> t.id or prior.accepted <> _accept or prior.via <> 'terms'
      or prior.reason is distinct from nullif(btrim(_reason), '') then
      raise exception 'Response key reused with different intent' using errcode = '22023';
    end if;
    return to_jsonb(prior) - 'before_value' || jsonb_build_object('replayed', true);
  end if;
  if exists(select 1 from public.job_offer_terms_responses where terms_id = t.id) then
    raise exception 'You already answered these terms' using errcode = '22023';
  end if;
  select * into attempt from public.job_match_attempts where id = t.offer_id;
  if r.status <> 'matched' or r.matching_status <> 'awaiting_terms' or attempt.outcome is distinct from 'accepted'
    or (private.offer_terms_current(r)).id is distinct from t.id
    or _expected is distinct from jsonb_build_object('terms_id', t.id, 'consent_hash', t.consent_hash) then
    raise exception 'These terms changed since you opened them. Review the current terms.' using errcode = '40001';
  end if;
  if _accept then
    -- Bound-terms lock order (header).
    perform 1 from public.contractors where id = t.contractor_id for share;
    perform 1 from public.job_offer_terms where id = t.id for share;
    perform 1 from public.package_tiers where id = t.package_tier_id for share;
    perform 1 from public.vendor_packages where id = t.package_id for share;
    perform 1 from public.vendor_packages v where v.is_active
      and (v.lineage_id = (select coalesce(b.lineage_id, b.id) from public.vendor_packages b where b.id = t.package_id)
        or v.id = t.package_id) for share;
    perform 1 from public.package_qualifying_questions where package_id = t.package_id for share;
    perform 1 from public.services_catalog where id = r.service_catalog_id for share;
    perform 1 from public.coverage_areas where zip_code = r.zip_code for share;
    perform 1 from public.contractor_service_zips where contractor_id = t.contractor_id and zip_code = r.zip_code for share;
    problem := private.offer_terms_problem(r, attempt, t);
    if problem is null and not private.vendor_matching_eligible(t.contractor_id) then problem := 'provider_not_matchable'; end if;
    if problem is not null then
      raise exception 'This provider can''t take the service at these terms right now. You can decline them; Mercurius will follow up.'
        using errcode = '22023', detail = 'offer_terms:' || problem;
    end if;
  end if;
  insert into public.job_offer_terms_responses(terms_id, request_id, offer_id, consent_hash, content_hash, response_key,
      actor_id, accepted, via, reason, before_value)
    values (t.id, r.id, attempt.id, t.consent_hash, t.content_hash, _response_key, auth.uid(), _accept, 'terms',
      nullif(btrim(_reason), ''), jsonb_build_object('status', r.status, 'matching_status', r.matching_status,
        'contractor_id', r.contractor_id, 'total_amount', r.total_amount))
    returning * into response;
  perform set_config('mercurius.offer_terms', r.id::text, true);
  if _accept then
    update public.service_requests set status = 'scheduled', matching_status = 'matched', updated_at = now() where id = r.id;
    perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('from', 'matched', 'to', 'scheduled',
      'reason', 'homeowner_accepted_terms', 'terms_id', t.id, 'response_id', response.id, 'policy', 'DEC-2026-063'));
  else
    update public.job_match_attempts set outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = 'Homeowner declined the terms', updated_at = now() where id = attempt.id;
    update public.service_requests set contractor_id = null, status = 'pending', matching_status = 'awaiting_match',
      assigned_at = null, match_expires_at = null, updated_at = now() where id = r.id;
    perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('from', 'matched', 'to', 'pending',
      'reason', 'homeowner_declined_terms', 'terms_id', t.id, 'response_id', response.id, 'policy', 'DEC-2026-063'));
  end if;
  perform set_config('mercurius.offer_terms', '', true);
  for recipient in select user_id from public.contractors where id = t.contractor_id loop
    if recipient is not null then
      perform public.notify_user(recipient, 'job_status', 'info',
        case when _accept then 'Homeowner accepted your terms' else 'Homeowner declined your terms' end,
        case when _accept then 'The homeowner accepted the terms you accepted. The service is scheduled.'
          else 'The homeowner declined these terms. The request is no longer assigned to you.' end,
        '/vendor/jobs', r.id, t.contractor_id);
    end if;
  end loop;
  if not _accept then perform private.offer_next_for_request_internal(r.id); end if;
  return to_jsonb(response) - 'before_value' || jsonb_build_object('replayed', false);
end $$;

-- 10. Server-side restrictions while terms are pending -------------------------------------------------
-- Entering 'awaiting_terms' takes a provider's acceptance of bound terms (the command marks this
-- transaction for the request) while the gate is on, share-locking the gate row. While pending, the
-- request changes only through the commands that answer, withdraw, supersede or cancel it; every
-- scheduling, start, quote, appointment and status path is refused here, whichever command it uses.
create function private.guard_offer_terms_pending() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sanctioned boolean := coalesce(current_setting('mercurius.offer_terms', true), '') = new.id::text;
begin
  if private.owner_maintenance() then return new; end if;
  if new.matching_status = 'awaiting_terms' and old.matching_status is distinct from 'awaiting_terms' then
    if not sanctioned then
      raise exception 'Only a provider''s acceptance of bound terms waits for the homeowner' using errcode = '42501';
    end if;
    if not private.offer_terms_active(true) then
      raise exception 'Offers at other terms are paused; Mercurius will follow up' using errcode = '22023', detail = 'offer_terms:inactive';
    end if;
    return new;
  end if;
  if old.matching_status = 'awaiting_terms' then
    if sanctioned or new.status = 'cancelled' then return new; end if;
    if (to_jsonb(new) - array['updated_at', 'needs_admin_review']) = (to_jsonb(old) - array['updated_at', 'needs_admin_review']) then
      return new;
    end if;
    raise exception 'The homeowner must accept this provider''s terms first' using errcode = '42501',
      detail = 'offer_terms:awaiting_homeowner';
  end if;
  return new;
end $$;
create trigger guard_offer_terms_pending before update on public.service_requests
  for each row when (old.matching_status = 'awaiting_terms' or new.matching_status = 'awaiting_terms')
  execute function private.guard_offer_terms_pending();

-- Operations recorded while terms are pending: only cancellation and the provider's withdrawal.
-- A withdrawal before the homeowner agreed is an ordinary re-match, not an E5/E6 replacement (P-9):
-- the accepted offer is withdrawn here and provider_withdrawal_open ignores this operation.
create function private.guard_offer_terms_operation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests;
begin
  select * into r from public.service_requests where id = new.job_id;
  if r.matching_status is distinct from 'awaiting_terms' or private.owner_maintenance() then return new; end if;
  if new.kind not in ('customer_cancel', 'provider_cancel') then
    raise exception 'The homeowner must accept this provider''s terms first' using errcode = '42501',
      detail = 'offer_terms:awaiting_homeowner';
  end if;
  if new.kind = 'provider_cancel' then
    update public.job_match_attempts set outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = new.reason, updated_at = now()
    where service_request_id = r.id and outcome = 'accepted' and contractor_id = r.contractor_id;
    perform set_config('mercurius.offer_terms', r.id::text, true);
  end if;
  return new;
end $$;
create trigger guard_offer_terms_operation before insert on public.job_operations
  for each row execute function private.guard_offer_terms_operation();

-- Restated from 20261101001000. Change: a provider withdrawal recorded while the homeowner had not
-- yet accepted bound terms doesn't open the replacement flow (P-9).
create or replace function private.provider_withdrawal_open(p_request public.service_requests) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_request.matching_status, '') <> 'matched' and exists(
    select 1 from public.job_operations o where o.job_id = p_request.id
      and (o.kind = 'provider_cancel' or (o.kind = 'no_show' and coalesce(public.has_role(o.actor_id, 'admin'), false)))
      and coalesce(o.before_value->>'matching_status', '') <> 'awaiting_terms'
      and not exists(select 1 from public.money_provider_replacement_decisions d
        where d.operation_id = o.id and d.outcome = 'no_replacement'))
$$;

-- 11. Operations: unanswered and blocked requests, and recovery ---------------------------------------
-- Unanswered terms after 24 hours (O-11: nothing changes automatically), terms the homeowner can no
-- longer accept, and requests left without an offer while the gate was off.
create function public.admin_offer_terms_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return jsonb_build_object('active', private.offer_terms_active(false), 'items', coalesce((
    select jsonb_agg(item order by item->>'since') from (
      select jsonb_build_object('kind', case when z.problem is not null then 'not_acceptable' else 'unanswered' end,
          'request_id', r.id, 'terms_id', t.id, 'contractor_id', t.contractor_id, 'since', a.accepted_at,
          'problem', z.problem, 'total_cents', t.total_cents) as item
        from public.service_requests r
        join public.job_match_attempts a on a.service_request_id = r.id and a.outcome = 'accepted' and a.contractor_id = r.contractor_id
        join public.job_offer_terms t on t.offer_id = a.id
        cross join lateral (select private.offer_terms_problem(r, a, t) as problem) z
        where r.status = 'matched' and r.matching_status = 'awaiting_terms'
          and not exists(select 1 from public.job_offer_terms_responses x where x.terms_id = t.id)
          and (z.problem is not null or a.accepted_at <= now() - interval '24 hours')
      union all
      select jsonb_build_object('kind', 'blocked_inactive', 'request_id', b.request_id, 'since', b.created_at,
          'candidates', b.candidates)
        from (select distinct on (request_id) * from private.offer_terms_blocks order by request_id, created_at desc, id desc) b
        join public.service_requests r on r.id = b.request_id
        where r.status = 'pending' and r.matching_status = 'exhausted'
          and not exists(select 1 from private.offer_terms_retries x where x.request_id = b.request_id and x.created_at >= b.created_at)
    ) q), '[]'::jsonb));
end $$;

-- After activation, an operator restarts matching for a request that was left without an offer
-- while the gate was off. Keyed and replay-safe.
create function public.admin_retry_offer_terms_matching(_request_id uuid, _retry_key uuid, _reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; prior private.offer_terms_retries; next_offer uuid; result jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _request_id is null or _retry_key is null or nullif(btrim(_reason), '') is null then
    raise exception 'Request, retry key and reason required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));
  select * into r from public.service_requests where id = _request_id for update;
  if r.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  select * into prior from private.offer_terms_retries where request_id = r.id and retry_key = _retry_key;
  if prior.id is not null then
    if prior.reason <> btrim(_reason) or prior.actor_id <> auth.uid() then
      raise exception 'Retry key reused with different intent' using errcode = '22023';
    end if;
    return prior.result || jsonb_build_object('replayed', true);
  end if;
  if not private.offer_terms_active(true) then
    raise exception 'Offers at other terms are not active yet' using errcode = '22023', detail = 'offer_terms:inactive';
  end if;
  if r.status <> 'pending' or r.matching_status <> 'exhausted' or r.recurrence_parent_id is not null
    or not exists(select 1 from private.offer_terms_blocks b where b.request_id = r.id
      and not exists(select 1 from private.offer_terms_retries x where x.request_id = r.id and x.created_at >= b.created_at)) then
    raise exception 'This request isn''t waiting on offers at other terms' using errcode = '22023';
  end if;
  update public.service_requests set matching_status = 'awaiting_match', updated_at = now() where id = r.id;
  next_offer := private.offer_next_for_request_internal(r.id);
  select jsonb_build_object('request_id', s.id, 'offer_id', next_offer, 'status', s.status, 'matching_status', s.matching_status)
    into result from public.service_requests s where s.id = r.id;
  insert into private.offer_terms_retries(request_id, retry_key, actor_id, reason, result)
    values (r.id, _retry_key, auth.uid(), btrim(_reason), result);
  perform public.log_job_event(r.id, 'status_changed', auth.uid(), jsonb_build_object('action', 'offer_terms_retry',
    'reason', btrim(_reason), 'offer_id', next_offer, 'policy', 'DEC-2026-063'));
  return result || jsonb_build_object('replayed', false);
end $$;

-- 12. Privileges --------------------------------------------------------------------------------------
revoke all on function private.offer_terms_active(boolean), private.offer_terms_consent_hash(uuid, uuid, uuid, text),
  private.offer_terms_build(public.service_requests, uuid, uuid, uuid),
  private.offer_terms_problem(public.service_requests, public.job_match_attempts, public.job_offer_terms),
  private.one_time_offer_basis(public.service_requests, uuid, uuid, uuid, text, uuid, boolean),
  private.offer_terms_current(public.service_requests), private.guard_offer_terms_pending(),
  private.guard_offer_terms_operation(), private.record_money_feature_gate_event(),
  private.gate_history_append_only(), private.offer_terms_append_only()
  from public, anon, authenticated, service_role;
revoke all on function public.homeowner_respond_offer_terms(uuid, uuid, boolean, jsonb, text),
  public.admin_offer_terms_queue(), public.admin_retry_offer_terms_matching(uuid, uuid, text) from public, anon;
grant execute on function public.homeowner_respond_offer_terms(uuid, uuid, boolean, jsonb, text),
  public.admin_offer_terms_queue(), public.admin_retry_offer_terms_matching(uuid, uuid, text) to authenticated;
