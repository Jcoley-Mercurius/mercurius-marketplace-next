-- TRACE-114 (DEC-2026-038): funded promotion offers and the approved promotional commission
-- (pricing review 2026-10-18, PR-10). Additive. Nothing here is wired into request
-- submission, checkout, refunds or payout: checkout keeps refusing every promotion
-- (DEC-2026-015 §3) until refund allocation and redemption restoration have approved rules
-- and the money path carries the rate (R1 gate). Legacy package_promotions overlays are
-- unchanged and never qualify for commission relief.
--
-- Economics (owner decision, DEC-2026-038). Ordinary commission is 15% of the eligible
-- service amount. A booking with one valid applied promotion pays 7.5% on its commissionable
-- amount, first booking or repeat; relief is never applied twice.
--   Vendor-funded discount D on eligible amount E: homeowner pays E - D; commission is 7.5%
--   of E - D; vendor proceeds E - D - commission; no platform subsidy.
--   Mercurius-funded discount D: homeowner pays E - D; commission is 7.5% of E; vendor
--   proceeds E - commission; platform subsidy D, recorded apart from commission revenue.
--   Promotional package: no discount; 7.5% of the package's actual approved price.
-- Amounts are whole cents; a percentage rounds half away from zero, as money_payable does.
--
-- Offers. One funder per offer (no blended funding). Each has a stable id and a revision
-- fingerprint over its terms; changing amount, scope, dates, limits, code or funding returns
-- it to draft. A vendor-funded offer is live only after the bound vendor account approves
-- that revision; a Mercurius-funded offer only after an operator authorizes it with a reason
-- and a budget. Scope: vendor, package lineages, services and ZIPs (empty means all within
-- the funder's reach), optional first-booking condition, optional code (stored as a hash),
-- minimum eligible spend, percentage cap, redemption limit, dates with the campaign
-- timezone recorded. Example amounts in tests are fixtures, not campaigns.
--
-- Redemptions. private.promotion_reserve evaluates an offer for a request from trusted
-- records (request, package lineage, ZIP, provider, the customer's earlier requests), never
-- from the browser: one promotion per request, limits and budget enforced under a lock on
-- the offer, idempotent by key, with the rate, base, discount, funding, subsidy and offer
-- revision snapshotted. finalize and release follow; releasing a finalized redemption
-- (restoring eligibility after a cancellation) is refused because no approved rule exists.
-- "First booking" here means the customer has no other request that was not cancelled;
-- that definition is an implementation choice for review. Credits: no Credits ledger exists
-- in this schema, so there is nothing to stack; when Credits arrive, they must check
-- promotion_redemptions (no stacking initially) and never offset commission.

create table private.promotion_offers (
  id uuid primary key default gen_random_uuid(),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft', 'awaiting_vendor', 'approved', 'retired')),
  funding text not null check (funding in ('vendor', 'platform')),
  contractor_id uuid references public.contractors(id) on delete restrict,
  kind text not null check (kind in ('percent', 'amount', 'package_price')),
  percent_bps integer check (percent_bps between 1 and 8000),
  amount_cents bigint check (amount_cents between 1 and 100000000),
  max_discount_cents bigint check (max_discount_cents between 1 and 100000000),
  min_spend_cents bigint not null default 0 check (min_spend_cents between 0 and 100000000),
  package_lineage_ids uuid[] not null default '{}',
  service_ids text[] not null default '{}',
  zip_codes text[] not null default '{}',
  first_booking_only boolean not null default false,
  code_hash text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (length(btrim(label)) between 1 and 48),
  terms text not null check (length(btrim(terms)) between 1 and 600),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'America/New_York',
  max_redemptions integer check (max_redemptions > 0),
  budget_cents bigint check (budget_cents between 1 and 1000000000),
  content_hash text not null,
  vendor_approved_hash text,
  vendor_approved_by uuid,
  vendor_approved_at timestamptz,
  vendor_note text check (vendor_note is null or length(vendor_note) <= 1000),
  authorized_hash text,
  authorized_by uuid,
  authorized_at timestamptz,
  authorization_reason text check (authorization_reason is null or length(btrim(authorization_reason)) between 1 and 500),
  notification_id uuid,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by uuid,
  retire_reason text check (retire_reason is null or length(btrim(retire_reason)) between 1 and 500),
  check (ends_at > starts_at),
  check (funding <> 'vendor' or contractor_id is not null),
  check (funding <> 'platform' or budget_cents is not null),
  check ((kind = 'percent') = (percent_bps is not null)),
  check ((kind = 'amount') = (amount_cents is not null)),
  check (kind = 'percent' or max_discount_cents is null),
  check (kind <> 'package_price' or (funding = 'vendor' and cardinality(package_lineage_ids) = 1)),
  check (status <> 'approved' or (funding = 'vendor' and vendor_approved_hash = content_hash)
                              or (funding = 'platform' and authorized_hash = content_hash)),
  check ((status = 'retired') = (retired_at is not null))
);
alter table private.promotion_offers enable row level security;
revoke all on private.promotion_offers from public, anon, authenticated, service_role;

create table private.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references private.promotion_offers(id),
  offer_revision integer not null,
  offer_hash text not null,
  service_request_id uuid not null references public.service_requests(id),
  customer_id uuid not null,
  contractor_id uuid not null,
  idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9_:-]{8,128}$'),
  status text not null default 'reserved' check (status in ('reserved', 'finalized', 'released')),
  funding text not null check (funding in ('vendor', 'platform')),
  eligible_cents bigint not null check (eligible_cents > 0),
  discount_cents bigint not null check (discount_cents >= 0 and discount_cents < eligible_cents),
  homeowner_service_cents bigint not null,
  commission_rate_bps integer not null check (commission_rate_bps = 750),
  commission_base_cents bigint not null,
  commission_cents bigint not null,
  vendor_proceeds_cents bigint not null,
  platform_subsidy_cents bigint not null check (platform_subsidy_cents >= 0),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  released_at timestamptz,
  release_reason text,
  check (homeowner_service_cents = eligible_cents - discount_cents),
  check (vendor_proceeds_cents = commission_base_cents - commission_cents),
  check ((status = 'finalized') = (finalized_at is not null)),
  check ((status = 'released') = (released_at is not null))
);
-- One promotion per request.
create unique index promotion_redemptions_one_per_request on private.promotion_redemptions(service_request_id)
  where status in ('reserved', 'finalized');
create index promotion_redemptions_offer_idx on private.promotion_redemptions(offer_id) where status in ('reserved', 'finalized');
alter table private.promotion_redemptions enable row level security;
revoke all on private.promotion_redemptions from public, anon, authenticated, service_role;

create table private.promotion_offer_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  offer_id uuid not null references private.promotion_offers(id),
  kind text not null check (kind in ('saved', 'sent', 'vendor_approved', 'vendor_declined', 'authorized', 'retired', 'send_blocked')),
  actor uuid not null,
  actor_role text not null check (actor_role in ('operator', 'vendor')),
  revision integer not null,
  content_hash text not null,
  changes jsonb,
  note text,
  created_at timestamptz not null default now()
);
alter table private.promotion_offer_events enable row level security;
revoke all on private.promotion_offer_events from public, anon, authenticated, service_role;

-- Economics -------------------------------------------------------------------------------

-- The split of an eligible service amount. p_funding null: no promotion, 15%.
create function private.promotion_economics(p_eligible bigint, p_discount bigint, p_funding text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare rate integer; base bigint; commission bigint; discount bigint := coalesce(p_discount, 0);
begin
  if p_eligible is null or p_eligible <= 0 or discount < 0 or discount >= p_eligible
     or (p_funding is null and discount <> 0) or (p_funding is not null and p_funding not in ('vendor', 'platform')) then
    raise exception 'Invalid promotion amounts' using errcode = '22023';
  end if;
  rate := case when p_funding is null then 1500 else 750 end;
  base := case when p_funding = 'vendor' then p_eligible - discount else p_eligible end;
  commission := round(base * rate / 10000.0)::bigint;
  return jsonb_build_object(
    'eligible_cents', p_eligible, 'discount_cents', discount, 'funding', p_funding,
    'homeowner_service_cents', p_eligible - discount,
    'commission_rate_bps', rate, 'commission_base_cents', base, 'commission_cents', commission,
    'vendor_proceeds_cents', base - commission,
    'platform_subsidy_cents', case when p_funding = 'platform' then discount else 0 end);
end $$;

create function private.promotion_discount(p_offer private.promotion_offers, p_eligible bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case p_offer.kind
    when 'percent' then least(round(p_eligible * p_offer.percent_bps / 10000.0)::bigint,
                              coalesce(p_offer.max_discount_cents, p_eligible))
    when 'amount' then p_offer.amount_cents
    else 0 end
$$;

create function private.promotion_offer_hash(p_offer private.promotion_offers) returns text
language sql immutable set search_path = '' as $$
  select private.pricing_content_hash(jsonb_build_object('funding', p_offer.funding, 'contractor_id', p_offer.contractor_id,
    'kind', p_offer.kind, 'percent_bps', p_offer.percent_bps, 'amount_cents', p_offer.amount_cents,
    'max_discount_cents', p_offer.max_discount_cents, 'min_spend_cents', p_offer.min_spend_cents,
    'package_lineage_ids', to_jsonb(p_offer.package_lineage_ids), 'service_ids', to_jsonb(p_offer.service_ids),
    'zip_codes', to_jsonb(p_offer.zip_codes), 'first_booking_only', p_offer.first_booking_only,
    'code_hash', p_offer.code_hash, 'label', p_offer.label, 'terms', p_offer.terms,
    'starts_at', p_offer.starts_at, 'ends_at', p_offer.ends_at, 'timezone', p_offer.timezone,
    'max_redemptions', p_offer.max_redemptions, 'budget_cents', p_offer.budget_cents))
$$;

create function private.promotion_code_hash(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(btrim(coalesce(p_code, '')), '') is null then null
    else encode(sha256(convert_to(upper(btrim(p_code)), 'UTF8')), 'hex') end
$$;

-- Usage of an offer: active redemptions and platform subsidy committed.
create function private.promotion_usage(p_offer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reserved', count(*) filter (where r.status = 'reserved'),
    'finalized', count(*) filter (where r.status = 'finalized'),
    'released', count(*) filter (where r.status = 'released'),
    'subsidy_committed_cents', coalesce(sum(r.platform_subsidy_cents) filter (where r.status in ('reserved', 'finalized')), 0),
    'vendor_discount_cents', coalesce(sum(r.discount_cents) filter (where r.status in ('reserved', 'finalized') and r.funding = 'vendor'), 0),
    'commission_relief_cents', coalesce(sum(round(r.commission_base_cents * 1500 / 10000.0)::bigint - r.commission_cents)
      filter (where r.status in ('reserved', 'finalized')), 0))
  from private.promotion_redemptions r where r.offer_id = p_offer
$$;

create function private.promotion_offer_json(p_offer private.promotion_offers, p_for_vendor boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_offer.id, 'revision', p_offer.revision, 'fingerprint', p_offer.content_hash, 'status', p_offer.status,
    'live', p_offer.status = 'approved' and now() >= p_offer.starts_at and now() < p_offer.ends_at,
    'funding', p_offer.funding, 'contractor_id', p_offer.contractor_id,
    'contractor_name', (select c.name from public.contractors c where c.id = p_offer.contractor_id),
    'kind', p_offer.kind, 'percent_bps', p_offer.percent_bps, 'amount_cents', p_offer.amount_cents,
    'max_discount_cents', p_offer.max_discount_cents, 'min_spend_cents', p_offer.min_spend_cents,
    'package_lineage_ids', to_jsonb(p_offer.package_lineage_ids),
    'package_names', coalesce((select jsonb_agg(p.name order by p.name) from public.vendor_packages p
      where p.id = any(p_offer.package_lineage_ids)), '[]'::jsonb),
    'service_ids', to_jsonb(p_offer.service_ids), 'zip_codes', to_jsonb(p_offer.zip_codes),
    'first_booking_only', p_offer.first_booking_only, 'requires_code', p_offer.code_hash is not null,
    'label', p_offer.label, 'terms', p_offer.terms, 'starts_at', p_offer.starts_at, 'ends_at', p_offer.ends_at,
    'timezone', p_offer.timezone, 'max_redemptions', p_offer.max_redemptions, 'budget_cents', p_offer.budget_cents,
    'vendor_approved_at', p_offer.vendor_approved_at, 'vendor_note', p_offer.vendor_note,
    'authorized_at', p_offer.authorized_at, 'updated_at', p_offer.updated_at,
    'usage', private.promotion_usage(p_offer.id),
    -- A worked example on $100.00 eligible service, from the same calculation.
    'example', case when p_offer.kind = 'package_price' then private.promotion_economics(10000, 0, p_offer.funding)
      else private.promotion_economics(10000, least(private.promotion_discount(p_offer, 10000), 9999), p_offer.funding) end)
  || case when p_for_vendor then '{}'::jsonb else jsonb_build_object(
    'authorization_reason', p_offer.authorization_reason,
    'created_by_email', (select u.email from auth.users u where u.id = p_offer.created_by)) end
$$;

create function private.record_promotion_event(p_offer private.promotion_offers, p_kind text, p_actor uuid, p_role text,
  p_changes jsonb, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into private.promotion_offer_events(offer_id, kind, actor, actor_role, revision, content_hash, changes, note)
  values (p_offer.id, p_kind, p_actor, p_role, p_offer.revision, p_offer.content_hash, p_changes, p_note)
$$;

-- Operator commands -----------------------------------------------------------------------

-- Creates (p_offer null) or edits a draft or approved offer against the updated_at read.
-- A change to the terms is a new revision and needs approval again.
create function public.admin_save_promotion_offer(p_offer uuid, p_expected_updated_at timestamptz, p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  offer private.promotion_offers;
  previous private.promotion_offers;
  funding text := p_terms ->> 'funding';
  kind text := p_terms ->> 'kind';
  contractor uuid;
  lineages uuid[];
  services text[];
  zips text[];
  starts timestamptz;
  ends timestamptz;
  code text := p_terms ->> 'code';
  next_hash text;
begin
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then raise exception 'Offer terms required' using errcode = '22023'; end if;
  if funding not in ('vendor', 'platform') then raise exception 'Choose who funds the offer' using errcode = '22023'; end if;
  if kind not in ('percent', 'amount', 'package_price') then raise exception 'Choose the kind of offer' using errcode = '22023'; end if;
  begin
    contractor := nullif(p_terms ->> 'contractor_id', '')::uuid;
    lineages := coalesce(array(select jsonb_array_elements_text(coalesce(p_terms -> 'package_lineage_ids', '[]'::jsonb))::uuid), '{}');
    starts := (p_terms ->> 'starts_at')::timestamptz;
    ends := (p_terms ->> 'ends_at')::timestamptz;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid offer identifiers or dates' using errcode = '22023';
  end;
  services := coalesce(array(select jsonb_array_elements_text(coalesce(p_terms -> 'service_ids', '[]'::jsonb))), '{}');
  zips := coalesce(array(select jsonb_array_elements_text(coalesce(p_terms -> 'zip_codes', '[]'::jsonb))), '{}');
  if starts is null or ends is null or ends <= starts then raise exception 'The offer needs a start and a later end' using errcode = '22023'; end if;
  if coalesce(p_terms ->> 'timezone', 'America/New_York') not in (select name from pg_catalog.pg_timezone_names) then
    raise exception 'Unknown timezone' using errcode = '22023';
  end if;
  if funding = 'vendor' and contractor is null then raise exception 'A vendor-funded offer names its vendor' using errcode = '22023'; end if;
  if contractor is not null and not exists (select 1 from public.contractors c where c.id = contractor) then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(lineages) l where not exists (select 1 from public.vendor_packages p
      where p.id = l and p.lineage_id = l and (contractor is null or p.contractor_id = contractor))) then
    raise exception 'Choose packages of this vendor' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(services) s where not exists (select 1 from public.services_catalog c where c.id = s)) then
    raise exception 'Choose catalog services' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(zips) z where not exists (select 1 from public.coverage_areas a where a.zip_code = z and a.is_active)) then
    raise exception 'Choose covered ZIP codes' using errcode = '22023';
  end if;
  if kind = 'package_price' and (funding <> 'vendor' or cardinality(lineages) <> 1) then
    raise exception 'A promotional package is one vendor-funded package' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_terms ->> 'label', ''))) not between 1 and 48 then
    raise exception 'A label of up to 48 characters is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_terms ->> 'terms', ''))) not between 1 and 600 then
    raise exception 'Terms of up to 600 characters are required' using errcode = '22023';
  end if;
  if kind = 'percent' and coalesce(p_terms ->> 'percent_bps', '') !~ '^[0-9]{1,4}$' then
    raise exception 'A percentage is between 0.01%% and 80%%' using errcode = '22023';
  end if;
  if kind = 'percent' and (p_terms ->> 'percent_bps')::integer not between 1 and 8000 then
    raise exception 'A percentage is between 0.01%% and 80%%' using errcode = '22023';
  end if;
  if kind = 'amount' and coalesce(p_terms ->> 'amount_cents', '') !~ '^[1-9][0-9]{0,7}$' then
    raise exception 'A discount amount is whole cents above zero' using errcode = '22023';
  end if;
  if funding = 'platform' and coalesce(p_terms ->> 'budget_cents', '') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'A Mercurius-funded offer needs a budget' using errcode = '22023';
  end if;
  if code is not null and btrim(code) !~ '^[A-Za-z0-9-]{4,24}$' then
    raise exception 'A code is 4 to 24 letters, numbers or dashes' using errcode = '22023';
  end if;

  if p_offer is not null then
    select * into previous from private.promotion_offers where id = p_offer for update;
    if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
    if previous.status = 'retired' then raise exception 'A retired offer cannot change'; end if;
    if p_expected_updated_at is null or previous.updated_at <> p_expected_updated_at then
      raise exception 'Offer changed since it was read; reload before saving' using errcode = '40001';
    end if;
    if previous.funding <> funding and exists (select 1 from private.promotion_redemptions r where r.offer_id = p_offer) then
      raise exception 'An offer with redemptions keeps its funding; retire it and start another' using errcode = '22023';
    end if;
  end if;

  offer := previous;
  offer.funding := funding; offer.contractor_id := contractor; offer.kind := kind;
  offer.percent_bps := case when kind = 'percent' then (p_terms ->> 'percent_bps')::integer end;
  offer.amount_cents := case when kind = 'amount' then (p_terms ->> 'amount_cents')::bigint end;
  offer.max_discount_cents := case when kind = 'percent' then nullif(p_terms ->> 'max_discount_cents', '')::bigint end;
  offer.min_spend_cents := coalesce(nullif(p_terms ->> 'min_spend_cents', '')::bigint, 0);
  offer.package_lineage_ids := lineages; offer.service_ids := services; offer.zip_codes := zips;
  offer.first_booking_only := coalesce((p_terms ->> 'first_booking_only')::boolean, false);
  offer.code_hash := case when p_terms ? 'code' then private.promotion_code_hash(code) else previous.code_hash end;
  offer.label := btrim(coalesce(p_terms ->> 'label', '')); offer.terms := btrim(coalesce(p_terms ->> 'terms', ''));
  offer.starts_at := starts; offer.ends_at := ends; offer.timezone := coalesce(p_terms ->> 'timezone', 'America/New_York');
  offer.max_redemptions := nullif(p_terms ->> 'max_redemptions', '')::integer;
  offer.budget_cents := nullif(p_terms ->> 'budget_cents', '')::bigint;
  next_hash := private.promotion_offer_hash(offer);

  if p_offer is null then
    insert into private.promotion_offers(funding, contractor_id, kind, percent_bps, amount_cents, max_discount_cents, min_spend_cents,
        package_lineage_ids, service_ids, zip_codes, first_booking_only, code_hash, label, terms, starts_at, ends_at, timezone,
        max_redemptions, budget_cents, content_hash, created_by, updated_by)
      values (offer.funding, offer.contractor_id, offer.kind, offer.percent_bps, offer.amount_cents, offer.max_discount_cents,
        offer.min_spend_cents, offer.package_lineage_ids, offer.service_ids, offer.zip_codes, offer.first_booking_only,
        offer.code_hash, offer.label, offer.terms, offer.starts_at, offer.ends_at, offer.timezone, offer.max_redemptions,
        offer.budget_cents, next_hash, actor, actor)
      returning * into offer;
  elsif next_hash = previous.content_hash then
    return private.promotion_offer_json(previous, false);
  else
    update private.promotion_offers set
        funding = offer.funding, contractor_id = offer.contractor_id, kind = offer.kind, percent_bps = offer.percent_bps,
        amount_cents = offer.amount_cents, max_discount_cents = offer.max_discount_cents, min_spend_cents = offer.min_spend_cents,
        package_lineage_ids = offer.package_lineage_ids, service_ids = offer.service_ids, zip_codes = offer.zip_codes,
        first_booking_only = offer.first_booking_only, code_hash = offer.code_hash, label = offer.label, terms = offer.terms,
        starts_at = offer.starts_at, ends_at = offer.ends_at, timezone = offer.timezone, max_redemptions = offer.max_redemptions,
        budget_cents = offer.budget_cents, content_hash = next_hash, revision = previous.revision + 1, status = 'draft',
        vendor_approved_hash = null, vendor_approved_by = null, vendor_approved_at = null,
        authorized_hash = null, authorized_by = null, authorized_at = null, authorization_reason = null,
        updated_by = actor, updated_at = now()
      where id = p_offer returning * into offer;
  end if;
  perform private.record_promotion_event(offer, 'saved', actor, 'operator',
    case when previous.id is not null then private.pricing_content_changes(to_jsonb(previous) - 'updated_at' - 'updated_by',
      to_jsonb(offer) - 'updated_at' - 'updated_by') end, null);
  return private.promotion_offer_json(offer, false);
end $$;

create function public.admin_send_promotion_for_vendor_approval(p_offer uuid, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  offer private.promotion_offers;
  link jsonb;
  vendor_user uuid;
  notification uuid;
begin
  select * into offer from private.promotion_offers where id = p_offer for update;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if offer.funding <> 'vendor' then raise exception 'Only a vendor-funded offer needs vendor approval'; end if;
  if offer.status not in ('draft', 'awaiting_vendor') then raise exception 'This offer is not waiting to be sent'; end if;
  if p_fingerprint is distinct from offer.content_hash then
    raise exception 'Offer changed since it was read; reload before sending' using errcode = '40001';
  end if;
  link := private.package_draft_vendor_link(offer.contractor_id);
  if not coalesce((link ->> 'vendor_role')::boolean, false) then
    perform private.record_promotion_event(offer, 'send_blocked', actor, 'operator', null, link ->> 'blocker');
    return jsonb_build_object('status', 'blocked', 'reason', link ->> 'blocker', 'offer', private.promotion_offer_json(offer, false));
  end if;
  select c.user_id into vendor_user from public.contractors c where c.id = offer.contractor_id;
  insert into public.notifications(user_id, type, severity, title, body, link, related_contractor_id)
    values (vendor_user, 'pricing', 'info', 'An offer is waiting for your approval',
      offer.label || ': review the offer you would fund and approve it or decline.', '/vendor/packages#offer-approvals', offer.contractor_id)
    returning id into notification;
  update private.promotion_offers set status = 'awaiting_vendor', notification_id = notification, vendor_note = null
   where id = p_offer returning * into offer;
  perform private.record_promotion_event(offer, 'sent', actor, 'operator', jsonb_build_object('notification_id', notification), null);
  return jsonb_build_object('status', 'sent', 'offer', private.promotion_offer_json(offer, false));
end $$;

-- An operator authorizes Mercurius funding for the revision read, with a reason.
create function public.admin_authorize_platform_promotion(p_offer uuid, p_fingerprint text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  offer private.promotion_offers;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if length(reason) = 0 then raise exception 'Authorization reason required'; end if;
  if length(reason) > 500 then raise exception 'Authorization reason too long'; end if;
  select * into offer from private.promotion_offers where id = p_offer for update;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if offer.funding <> 'platform' then raise exception 'Only a Mercurius-funded offer is authorized by an operator'; end if;
  if offer.status <> 'draft' then raise exception 'This offer is not waiting for authorization'; end if;
  if p_fingerprint is distinct from offer.content_hash then
    raise exception 'Offer changed since it was read; reload before authorizing' using errcode = '40001';
  end if;
  update private.promotion_offers set status = 'approved', authorized_hash = content_hash, authorized_by = actor,
      authorized_at = now(), authorization_reason = reason
   where id = p_offer returning * into offer;
  perform private.record_promotion_event(offer, 'authorized', actor, 'operator', null, reason);
  return private.promotion_offer_json(offer, false);
end $$;

create function public.admin_retire_promotion_offer(p_offer uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  offer private.promotion_offers;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if length(reason) = 0 then raise exception 'Retire reason required'; end if;
  select * into offer from private.promotion_offers where id = p_offer for update;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  if offer.status = 'retired' then return private.promotion_offer_json(offer, false); end if;
  update private.promotion_offers set status = 'retired', retired_at = now(), retired_by = actor, retire_reason = left(reason, 500)
   where id = p_offer returning * into offer;
  perform private.record_promotion_event(offer, 'retired', actor, 'operator', null, reason);
  return private.promotion_offer_json(offer, false);
end $$;

create function public.admin_promotion_offers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(private.promotion_offer_json(o, false) order by o.status = 'retired', o.updated_at desc)
    from private.promotion_offers o), '[]'::jsonb);
end $$;

create function public.admin_promotion_offer_events(p_offer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'actor_role', e.actor_role,
      'actor_email', (select u.email from auth.users u where u.id = e.actor), 'revision', e.revision,
      'changes', e.changes, 'note', e.note, 'created_at', e.created_at) order by e.sequence)
    from private.promotion_offer_events e where e.offer_id = p_offer), '[]'::jsonb);
end $$;

-- Vendor commands -------------------------------------------------------------------------

create function public.vendor_promotion_offers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'vendor') then
    raise exception 'Vendor account required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.promotion_offer_json(o, true) order by o.updated_at desc)
    from private.promotion_offers o join public.contractors c on c.id = o.contractor_id and c.user_id = auth.uid()
   where o.status <> 'draft' or o.vendor_note is not null), '[]'::jsonb);
end $$;

create function private.require_offer_vendor(p_offer uuid) returns private.promotion_offers
language plpgsql security definer set search_path = '' as $$
declare offer private.promotion_offers;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'vendor') then
    raise exception 'Vendor account required' using errcode = '42501';
  end if;
  select o.* into offer from private.promotion_offers o
    join public.contractors c on c.id = o.contractor_id and c.user_id = auth.uid()
   where o.id = p_offer and o.funding = 'vendor' for update of o;
  if not found then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  return offer;
end $$;

create function public.vendor_approve_promotion_offer(p_offer uuid, p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare offer private.promotion_offers;
begin
  offer := private.require_offer_vendor(p_offer);
  if offer.status = 'approved' and offer.vendor_approved_hash = p_fingerprint then
    return private.promotion_offer_json(offer, true);
  end if;
  if offer.status <> 'awaiting_vendor' or p_fingerprint is distinct from offer.content_hash then
    raise exception 'This offer changed since you opened it; reload to review the current version' using errcode = '40001';
  end if;
  update private.promotion_offers set status = 'approved', vendor_approved_hash = content_hash,
      vendor_approved_by = auth.uid(), vendor_approved_at = now()
   where id = p_offer returning * into offer;
  perform private.record_promotion_event(offer, 'vendor_approved', auth.uid(), 'vendor', null, null);
  return private.promotion_offer_json(offer, true);
end $$;

create function public.vendor_decline_promotion_offer(p_offer uuid, p_fingerprint text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  offer private.promotion_offers;
  note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  offer := private.require_offer_vendor(p_offer);
  if note is null then raise exception 'Say why, or what would work'; end if;
  if offer.status <> 'awaiting_vendor' or p_fingerprint is distinct from offer.content_hash then
    raise exception 'This offer changed since you opened it; reload to review the current version' using errcode = '40001';
  end if;
  update private.promotion_offers set status = 'draft', vendor_note = left(note, 1000)
   where id = p_offer returning * into offer;
  perform private.record_promotion_event(offer, 'vendor_declined', auth.uid(), 'vendor', null, note);
  return private.promotion_offer_json(offer, true);
end $$;

-- Redemption lifecycle (not wired to any flow; see header) ------------------------------------

-- Evaluates an offer for a request from trusted records and reserves it. Returns
-- {status: reserved|ineligible, reason, redemption}. Idempotent by p_key.
create function private.promotion_reserve(p_offer uuid, p_request uuid, p_code text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  offer private.promotion_offers;
  r public.service_requests;
  prior private.promotion_redemptions;
  redemption private.promotion_redemptions;
  lineage uuid;
  eligible bigint;
  discount bigint;
  split jsonb;
  usage jsonb;
  ineligible text;
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

  select p.lineage_id into lineage from public.vendor_packages p where p.id = r.package_id;
  eligible := case when r.pricing_inputs ->> 'version' = 'pricing-v2' and r.pricing_inputs ->> 'status' = 'exact'
                   then (r.pricing_inputs ->> 'total_cents')::bigint
                   when r.pricing_mode = 'fixed' and r.total_amount > 0 then round(r.total_amount * 100)::bigint end;
  ineligible := case
    when offer.status <> 'approved' then 'offer_not_approved'
    when (offer.funding = 'vendor' and offer.vendor_approved_hash is distinct from offer.content_hash)
      or (offer.funding = 'platform' and offer.authorized_hash is distinct from offer.content_hash) then 'offer_revision_not_approved'
    when now() < offer.starts_at then 'not_started'
    when now() >= offer.ends_at then 'expired'
    when r.contractor_id is null then 'provider_not_confirmed'
    when offer.contractor_id is not null and offer.contractor_id <> r.contractor_id then 'other_provider'
    when cardinality(offer.package_lineage_ids) > 0 and (lineage is null or not lineage = any(offer.package_lineage_ids)) then 'package_not_included'
    when cardinality(offer.service_ids) > 0 and not coalesce(r.service_catalog_id, '') = any(offer.service_ids) then 'service_not_included'
    when cardinality(offer.zip_codes) > 0 and not coalesce(r.zip_code, '') = any(offer.zip_codes) then 'area_not_included'
    when eligible is null then 'no_exact_service_amount'
    when eligible < offer.min_spend_cents then 'below_minimum_spend'
    when offer.code_hash is not null and offer.code_hash is distinct from private.promotion_code_hash(p_code) then 'code_required'
    when offer.first_booking_only and exists (select 1 from public.service_requests other
      where other.customer_id = r.customer_id and other.id <> r.id and other.status::text <> 'cancelled') then 'not_first_booking'
    when exists (select 1 from private.promotion_redemptions x where x.service_request_id = r.id and x.status in ('reserved', 'finalized'))
      then 'promotion_already_applied'
  end;
  if ineligible is null then
    discount := private.promotion_discount(offer, eligible);
    if discount >= eligible then ineligible := 'discount_exceeds_service'; end if;
  end if;
  if ineligible is null then
    usage := private.promotion_usage(offer.id);
    if offer.max_redemptions is not null
      and (usage ->> 'reserved')::integer + (usage ->> 'finalized')::integer >= offer.max_redemptions then
      ineligible := 'redemption_limit_reached';
    elsif offer.funding = 'platform' and (usage ->> 'subsidy_committed_cents')::bigint + discount > offer.budget_cents then
      ineligible := 'budget_exhausted';
    end if;
  end if;
  if ineligible is not null then
    return jsonb_build_object('status', 'ineligible', 'reason', ineligible);
  end if;

  split := private.promotion_economics(eligible, discount, offer.funding);
  insert into private.promotion_redemptions(offer_id, offer_revision, offer_hash, service_request_id, customer_id, contractor_id,
      idempotency_key, funding, eligible_cents, discount_cents, homeowner_service_cents, commission_rate_bps,
      commission_base_cents, commission_cents, vendor_proceeds_cents, platform_subsidy_cents)
    values (offer.id, offer.revision, offer.content_hash, r.id, r.customer_id, r.contractor_id, p_key, offer.funding,
      eligible, discount, (split ->> 'homeowner_service_cents')::bigint, (split ->> 'commission_rate_bps')::integer,
      (split ->> 'commission_base_cents')::bigint, (split ->> 'commission_cents')::bigint,
      (split ->> 'vendor_proceeds_cents')::bigint, (split ->> 'platform_subsidy_cents')::bigint)
    returning * into redemption;
  return jsonb_build_object('status', 'reserved', 'redemption', to_jsonb(redemption), 'reused', false);
end $$;

-- Commits a reservation when the booking agreement is committed. The offer revision must be
-- the one reserved; later offer changes never reprice a finalized redemption.
create function private.promotion_finalize(p_redemption uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare redemption private.promotion_redemptions; offer private.promotion_offers;
begin
  select * into redemption from private.promotion_redemptions where id = p_redemption for update;
  if not found then raise exception 'Redemption not found' using errcode = 'P0002'; end if;
  if redemption.status = 'finalized' then return to_jsonb(redemption); end if;
  if redemption.status <> 'reserved' then raise exception 'A released redemption cannot be finalized'; end if;
  select * into offer from private.promotion_offers where id = redemption.offer_id;
  if offer.content_hash <> redemption.offer_hash or offer.status <> 'approved' then
    raise exception 'The offer changed since it was reserved; reserve again' using errcode = '40001';
  end if;
  update private.promotion_redemptions set status = 'finalized', finalized_at = now()
   where id = p_redemption returning * into redemption;
  return to_jsonb(redemption);
end $$;

-- Frees a reservation that was never finalized. Restoring a finalized redemption (for
-- example after a cancellation) has no approved rule, so it is refused.
create function private.promotion_release(p_redemption uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare redemption private.promotion_redemptions;
begin
  select * into redemption from private.promotion_redemptions where id = p_redemption for update;
  if not found then raise exception 'Redemption not found' using errcode = 'P0002'; end if;
  if redemption.status = 'released' then return to_jsonb(redemption); end if;
  if redemption.status = 'finalized' then
    raise exception 'Restoring a promotion after a finalized booking has no approved rule' using errcode = '0A000';
  end if;
  update private.promotion_redemptions set status = 'released', released_at = now(),
      release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'released'), 500)
   where id = p_redemption returning * into redemption;
  return to_jsonb(redemption);
end $$;

-- A worked example for an operator or the offer's vendor, from the same calculation.
create function public.promotion_offer_example(p_offer uuid, p_eligible_cents bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare offer private.promotion_offers; discount bigint;
begin
  select o.* into offer from private.promotion_offers o where o.id = p_offer;
  if not found or not (public.has_role(auth.uid(), 'admin') or (public.has_role(auth.uid(), 'vendor')
      and exists (select 1 from public.contractors c where c.id = offer.contractor_id and c.user_id = auth.uid()))) then
    raise exception 'Offer not found' using errcode = 'P0002';
  end if;
  if p_eligible_cents is null or p_eligible_cents <= 0 or p_eligible_cents > 100000000 then
    raise exception 'Enter an eligible amount' using errcode = '22023';
  end if;
  discount := private.promotion_discount(offer, p_eligible_cents);
  if p_eligible_cents < offer.min_spend_cents then
    return jsonb_build_object('eligible', false, 'reason', 'below_minimum_spend', 'ordinary', private.promotion_economics(p_eligible_cents, 0, null));
  end if;
  if discount >= p_eligible_cents then
    return jsonb_build_object('eligible', false, 'reason', 'discount_exceeds_service', 'ordinary', private.promotion_economics(p_eligible_cents, 0, null));
  end if;
  return jsonb_build_object('eligible', true, 'promotion', private.promotion_economics(p_eligible_cents, discount, offer.funding),
    'ordinary', private.promotion_economics(p_eligible_cents, 0, null));
end $$;

revoke all on function
  private.promotion_economics(bigint, bigint, text), private.promotion_discount(private.promotion_offers, bigint),
  private.promotion_offer_hash(private.promotion_offers), private.promotion_code_hash(text), private.promotion_usage(uuid),
  private.promotion_offer_json(private.promotion_offers, boolean),
  private.record_promotion_event(private.promotion_offers, text, uuid, text, jsonb, text),
  private.require_offer_vendor(uuid), private.promotion_reserve(uuid, uuid, text, text),
  private.promotion_finalize(uuid), private.promotion_release(uuid, text),
  public.admin_save_promotion_offer(uuid, timestamptz, jsonb), public.admin_send_promotion_for_vendor_approval(uuid, text),
  public.admin_authorize_platform_promotion(uuid, text, text), public.admin_retire_promotion_offer(uuid, text),
  public.admin_promotion_offers(), public.admin_promotion_offer_events(uuid), public.vendor_promotion_offers(),
  public.vendor_approve_promotion_offer(uuid, text), public.vendor_decline_promotion_offer(uuid, text, text),
  public.promotion_offer_example(uuid, bigint)
from public, anon, authenticated, service_role;
grant execute on function
  public.admin_save_promotion_offer(uuid, timestamptz, jsonb), public.admin_send_promotion_for_vendor_approval(uuid, text),
  public.admin_authorize_platform_promotion(uuid, text, text), public.admin_retire_promotion_offer(uuid, text),
  public.admin_promotion_offers(), public.admin_promotion_offer_events(uuid), public.vendor_promotion_offers(),
  public.vendor_approve_promotion_offer(uuid, text), public.vendor_decline_promotion_offer(uuid, text, text),
  public.promotion_offer_example(uuid, bigint)
to authenticated;
