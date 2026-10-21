-- DEC-2026-041 items 1-3 (TRACE-112/114): add-ons and funded promotions in the commercial
-- source, the money snapshot, payouts, refunds and reconciliation. Additive: new tables,
-- columns, functions and a gate; restated money functions keep ordinary bookings exact.
--
-- 1. Add-ons at checkout (item 2). money_source prices a request with add-ons again from the
--    package content and requires the same exact result from the same package revision; the
--    snapshot's add-on amount and discount must equal the source. Snapshots are still
--    published only through the two-person review (money_publish_snapshot actor + approver).
-- 2. Commission and subsidy (DEC-2026-038, item 1). private.money_split gives the platform
--    fee and platform subsidy for a retained service amount. Without a promotion it is
--    exactly the reviewed round(service * 15 / 100) and no subsidy, so every ordinary booking
--    is unchanged. With a promotion it is the snapshot's commission and subsidy, scaled by the
--    retained share of the subtotal: a refund or lost chargeback reverses vendor proceeds,
--    commission and subsidy proportionally, and a vendor-funded discount (not cash) adds no
--    refund entitlement. Provider proceeds = retained service + subsidy - fee + tip. The
--    subsidy is posted to its own account, promotion_subsidy, apart from commission revenue.
--    Existing cancellation charges and fee treatment are untouched; no new fee.
-- 3. Redemption lifecycle (items 1, 3). First booking means no previous completed Marketplace
--    service (pending, declined, expired or cancelled requests do not count); one active
--    first-booking redemption per homeowner (unique index); eligibility is checked again in
--    money_source until the homeowner commits. A reservation is committed at full capture,
--    released when its request is cancelled unpaid or its terms expire unpaid, restored after
--    a full refund before service with no retained charge, and otherwise restored only by a
--    documented operator exception. Restoring never extends dates or overrides eligibility:
--    it only stops counting the redemption against the offer's limits and the homeowner.
-- 4. Gate. Checkout keeps refusing promotions (DEC-2026-015 §3) until the owner opens
--    private.money_feature_gates 'promotions_checkout' after the two-person finance review.
--    Nothing here reserves an offer for a request: how a homeowner applies an offer is an
--    open owner decision.

-- 1. Gate -------------------------------------------------------------------------------------

create table private.money_feature_gates (
  name text primary key check (name ~ '^[a-z_]{1,60}$'),
  enabled boolean not null default false,
  reason text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
alter table private.money_feature_gates enable row level security;
revoke all on private.money_feature_gates from public, anon, authenticated, service_role;
insert into private.money_feature_gates(name, enabled, reason)
  values ('promotions_checkout', false, 'DEC-2026-015 §3 until the two-person finance review of DEC-2026-041');

create function private.money_gate(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select g.enabled from private.money_feature_gates g where g.name = p_name), false)
$$;

-- 2. Redemption lifecycle ------------------------------------------------------------------------

alter table private.promotion_redemptions
  add column first_booking boolean not null default false,
  add column restored_at timestamptz,
  add column restored_by uuid,
  add column restore_reason text check (restore_reason is null or length(btrim(restore_reason)) between 1 and 500);
alter table private.promotion_redemptions drop constraint promotion_redemptions_status_check;
alter table private.promotion_redemptions add constraint promotion_redemptions_status_check
  check (status in ('reserved', 'finalized', 'released', 'restored'));
-- A restored redemption was committed first, so it keeps its finalized_at. The unnamed
-- 20261018003000 check (finalized iff finalized_at) is found by its definition and replaced.
do $$
declare c text;
begin
  select conname into strict c from pg_constraint
   where conrelid = 'private.promotion_redemptions'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) = 'CHECK (((status = ''finalized''::text) = (finalized_at IS NOT NULL)))';
  execute format('alter table private.promotion_redemptions drop constraint %I', c);
end $$;
alter table private.promotion_redemptions add constraint promotion_redemptions_finalized_check
  check ((status in ('finalized', 'restored')) = (finalized_at is not null));
alter table private.promotion_redemptions add constraint promotion_redemptions_restored_check
  check ((status = 'restored') = (restored_at is not null and restore_reason is not null));
-- One active first-booking redemption per homeowner, under concurrency too.
create unique index promotion_redemptions_one_first_booking on private.promotion_redemptions(customer_id)
  where first_booking and status in ('reserved', 'finalized');

-- A completed Marketplace service: the homeowner confirmed completion (the statuses payouts use).
create function private.promotion_has_completed_service(p_customer uuid, p_except uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.service_requests s
    where s.customer_id = p_customer and s.id is distinct from p_except
      and s.status::text in ('homeowner_confirmed', 'completed', 'review_requested', 'reviewed', 'closed', 'resolved'))
$$;

-- Restates 20261018003000: first booking means no completed Marketplace service; one active
-- first-booking redemption per homeowner.
create or replace function private.promotion_reserve(p_offer uuid, p_request uuid, p_code text, p_key text) returns jsonb
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
    when offer.first_booking_only and private.promotion_has_completed_service(r.customer_id, r.id) then 'not_first_booking'
    when offer.first_booking_only and exists (select 1 from private.promotion_redemptions x
      where x.customer_id = r.customer_id and x.first_booking and x.status in ('reserved', 'finalized') and x.service_request_id <> r.id)
      then 'first_booking_already_reserved'
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
      commission_base_cents, commission_cents, vendor_proceeds_cents, platform_subsidy_cents, first_booking)
    values (offer.id, offer.revision, offer.content_hash, r.id, r.customer_id, r.contractor_id, p_key, offer.funding,
      eligible, discount, (split ->> 'homeowner_service_cents')::bigint, (split ->> 'commission_rate_bps')::integer,
      (split ->> 'commission_base_cents')::bigint, (split ->> 'commission_cents')::bigint,
      (split ->> 'vendor_proceeds_cents')::bigint, (split ->> 'platform_subsidy_cents')::bigint, offer.first_booking_only)
    returning * into redemption;
  return jsonb_build_object('status', 'reserved', 'redemption', to_jsonb(redemption), 'reused', false);
end $$;

-- 3. Snapshot economics and the split ------------------------------------------------------------

-- The promotion a published snapshot carries, from its redemption. Immutable evidence.
create table public.money_snapshot_promotions (
  snapshot_id uuid primary key references public.money_snapshots(id),
  redemption_id uuid not null references private.promotion_redemptions(id),
  funding text not null check (funding in ('vendor', 'platform')),
  discount bigint not null check (discount >= 0),
  commission_rate_bps integer not null check (commission_rate_bps = 750),
  commission_base bigint not null check (commission_base > 0),
  commission bigint not null check (commission >= 0),
  platform_subsidy bigint not null check (platform_subsidy >= 0),
  created_at timestamptz not null default now(),
  check (funding = 'platform' or platform_subsidy = 0)
);
alter table public.money_snapshot_promotions enable row level security;
revoke all on public.money_snapshot_promotions from public, anon, authenticated, service_role;
grant select on public.money_snapshot_promotions to service_role;
create trigger immutable_snapshot_promotion before update or delete on public.money_snapshot_promotions
  for each row execute function public.money_immutable();

-- Platform fee and platform subsidy for a retained service amount of an obligation's current
-- snapshot. Ordinary: exactly round(service * 15 / 100), no subsidy. Promotional: the
-- snapshot's commission and subsidy, in proportion to the retained share of its subtotal.
create function private.money_split(p_obligation uuid, p_service bigint)
returns table(fee bigint, subsidy bigint) language plpgsql stable security definer set search_path = '' as $$
declare s public.money_snapshots; m public.money_snapshot_promotions;
begin
  select sn.* into s from public.money_obligations o join public.money_snapshots sn on sn.id = o.current_snapshot_id where o.id = p_obligation;
  select sp.* into m from public.money_snapshot_promotions sp where sp.snapshot_id = s.id;
  if m.snapshot_id is null then
    fee := round(p_service::numeric * 15 / 100); subsidy := 0;
  elsif p_service = s.subtotal then
    fee := m.commission; subsidy := m.platform_subsidy;
  else
    fee := round(m.commission::numeric * p_service / s.subtotal); subsidy := round(m.platform_subsidy::numeric * p_service / s.subtotal);
  end if;
  return next;
end $$;

create function private.money_provider_proceeds(p_obligation uuid, p_service bigint, p_tip bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select p_service + s.subsidy - s.fee + p_tip from private.money_split(p_obligation, p_service) s
$$;

-- Statement items record any platform subsidy paid with the provider's proceeds.
alter table public.money_ach_items add column platform_subsidy bigint not null default 0 check (platform_subsidy >= 0);
alter table public.money_ach_items drop constraint money_ach_items_check;
alter table public.money_ach_items add constraint money_ach_items_check
  check (amount = service_retained + platform_subsidy - platform_fee + tip_retained);


-- Restates 20261018003000: a first-booking reservation stays valid only while the homeowner
-- has no completed service, is checked again here, and is never committed twice.
create or replace function private.promotion_finalize(p_redemption uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare redemption private.promotion_redemptions; offer private.promotion_offers;
begin
  select * into redemption from private.promotion_redemptions where id = p_redemption for update;
  if not found then raise exception 'Redemption not found' using errcode = 'P0002'; end if;
  if redemption.status = 'finalized' then return to_jsonb(redemption); end if;
  if redemption.status <> 'reserved' then raise exception 'A released or restored redemption cannot be finalized'; end if;
  select * into offer from private.promotion_offers where id = redemption.offer_id;
  if offer.content_hash <> redemption.offer_hash or offer.status <> 'approved' then
    raise exception 'The offer changed since it was reserved; reserve again' using errcode = '40001';
  end if;
  if redemption.first_booking and private.promotion_has_completed_service(redemption.customer_id, redemption.service_request_id) then
    raise exception 'No longer a first booking; reserve again' using errcode = '40001';
  end if;
  update private.promotion_redemptions set status = 'finalized', finalized_at = now()
   where id = p_redemption returning * into redemption;
  return to_jsonb(redemption);
end $$;

-- At full capture: the paid snapshot's redemption is committed on the snapshot's terms. The
-- offer and eligibility were checked until the homeowner committed (money_source); a later
-- campaign change never reprices an accepted booking.
create function private.promotion_commit(p_obligation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.money_snapshot_promotions;
begin
  select sp.* into m from public.money_obligations o join public.money_snapshot_promotions sp on sp.snapshot_id = o.current_snapshot_id
   where o.id = p_obligation;
  if not found then return; end if;
  update private.promotion_redemptions set status = 'finalized', finalized_at = now()
   where id = m.redemption_id and status = 'reserved';
  if not exists (select 1 from private.promotion_redemptions where id = m.redemption_id and status = 'finalized') then
    raise exception 'Paid promotion is not reserved; reconciliation required';
  end if;
end $$;

-- After a refund: a paid booking refunded in full before service, with nothing retained,
-- gets its promotion back. Partial refunds, retained charges and delivered service keep it.
create function private.promotion_restore_after_refund(p_obligation uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.money_obligations; ret record; r public.service_requests;
begin
  select * into o from public.money_obligations where id = p_obligation;
  select * into r from public.service_requests where id = o.service_request_id;
  if not exists (select 1 from private.promotion_redemptions x where x.service_request_id = r.id and x.status in ('reserved', 'finalized')) then
    return;
  end if;
  select * into ret from public.money_retained_parts(o.id);
  if o.captured - o.refunded_service - o.refunded_tax - o.refunded_tip <> 0 or coalesce(ret.service, 0) + coalesce(ret.tax, 0) + coalesce(ret.tip, 0) <> 0
    or exists (select 1 from public.money_completion_evidence e where e.obligation_id = o.id)
    or r.status::text in ('in_progress', 'pending_review', 'vendor_completed', 'homeowner_confirmed', 'completed', 'review_requested', 'reviewed', 'closed', 'resolved') then
    return;
  end if;
  update private.promotion_redemptions
     set status = 'restored', restored_at = now(), restore_reason = 'Full refund before service; no charge retained'
   where service_request_id = r.id and status = 'finalized';
  update private.promotion_redemptions
     set status = 'released', released_at = now(), release_reason = 'Full refund before payment completed'
   where service_request_id = r.id and status = 'reserved';
end $$;

-- An unpaid request ends: its reservation is released. A checkout in progress or a payment
-- keeps it (the capture commits it, or a refund restores it); the unpaid sweep covers the rest.
create function private.promotion_release_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status::text = 'cancelled' and old.status is distinct from new.status
     and not exists (select 1 from public.money_obligations o join public.money_checkout_attempts a on a.obligation_id = o.id
       where o.service_request_id = new.id and a.status in ('prepared', 'session_created', 'reconcile', 'captured')) then
    update private.promotion_redemptions
       set status = 'released', released_at = now(), release_reason = 'Request cancelled before payment'
     where service_request_id = new.id and status = 'reserved';
  end if;
  return new;
end $$;
create trigger trg_promotion_release_on_cancel after update of status on public.service_requests
  for each row execute function private.promotion_release_on_cancel();

-- Unpaid terms that expired: reservations whose request has no captured payment and whose
-- current snapshot expired with no open checkout are released. Idempotent; for the
-- lifecycle worker (not scheduled by this migration).
create function private.promotion_release_unpaid() returns integer
language plpgsql security definer set search_path = '' as $$
declare released integer;
begin
  with stale as (
    select x.id from private.promotion_redemptions x
      join public.money_obligations o on o.service_request_id = x.service_request_id
      join public.money_snapshots s on s.id = o.current_snapshot_id
     where x.status = 'reserved' and o.captured = 0 and s.expires_at <= now()
       and not exists (select 1 from public.money_checkout_attempts a
         where a.obligation_id = o.id and a.status in ('prepared', 'session_created', 'reconcile', 'captured')))
  update private.promotion_redemptions x set status = 'released', released_at = now(), release_reason = 'Terms expired unpaid'
    from stale where x.id = stale.id;
  get diagnostics released = row_count;
  return released;
end $$;

-- A documented operator exception: restore a finalized redemption the automatic rule does
-- not cover (partial refund, retained charge or delivered service). It never extends the
-- campaign's dates or eligibility; it only stops counting this redemption.
create function public.admin_restore_promotion(p_redemption uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.vendor_require_operator(); x private.promotion_redemptions; reason text := btrim(coalesce(p_reason, ''));
begin
  if length(reason) = 0 then raise exception 'Enter the reason for this exception' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into x from private.promotion_redemptions where id = p_redemption for update;
  if not found then raise exception 'Redemption not found' using errcode = 'P0002'; end if;
  if x.status = 'restored' then return to_jsonb(x); end if;
  if x.status <> 'finalized' then raise exception 'Only a committed promotion can be restored' using errcode = '55000'; end if;
  update private.promotion_redemptions set status = 'restored', restored_at = now(), restored_by = actor,
      restore_reason = 'Operator exception: ' || reason
   where id = x.id returning * into x;
  return to_jsonb(x);
end $$;


-- 4. Commercial source and snapshot (item 2) -----------------------------------------------------

-- Restates 20261018001000 (TRACE-112): add-ons verified; funded promotions carried behind the gate.
create or replace function private.money_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
  priced jsonb; addon_cents bigint := 0; wanted jsonb; promo private.promotion_redemptions; offer private.promotion_offers;
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
  end if;
  return evidence||jsonb_build_object('version','commercial-v1:'||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $$;

-- Restates 20260905010000: add-ons, discount and promotion terms must equal the source.
create or replace function public.money_publish_snapshot(p_request uuid, p_terms jsonb, p_actor uuid, p_approver uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source jsonb; existing uuid; result uuid;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','snapshot','request',p_request,'terms',p_terms));
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  perform 1 from public.service_requests where id=p_request for update;
  source:=private.money_source(p_request);
  if p_terms->>'source_version' is distinct from source->>'version' then raise exception 'Commercial source changed; review current terms'; end if;
  if source->>'kind'='quote' then
    if (p_terms->>'total')::numeric is distinct from (source->>'total')::numeric then raise exception 'Checkout total must equal accepted quote'; end if;
  elsif (p_terms->>'service')::numeric is distinct from (source->>'service')::numeric then
    raise exception 'Service amount must equal selected offering';
  -- DEC-2026-041 item 2: add-ons and a promotion discount come from the source, never from
  -- the reviewers' terms. A promotional snapshot carries no other adjustment, so its
  -- commission and subsidy apply to exactly the amounts the redemption recorded.
  elsif (p_terms->>'addons')::numeric is distinct from coalesce((source->>'addons')::numeric,0) then
    raise exception 'Add-on amount must equal the selected add-ons';
  elsif (p_terms->>'discount')::numeric is distinct from coalesce((source->>'discount')::numeric,0) then
    raise exception 'Discount must equal the applied promotion';
  elsif source ? 'promotion' and ((p_terms->>'adjustment')::numeric is distinct from 0
      or p_terms->>'promotion_terms' is distinct from source->'promotion'->>'terms') then
    raise exception 'A promotional snapshot carries the promotion''s terms and no adjustment';
  end if;
  -- Identical separately-approved publication retries return the same snapshot,
  -- including after a checkout started. Never create another invoice on a retry.
  select s.id into existing from public.money_snapshots s join public.money_obligations o on o.current_snapshot_id=s.id
    join public.money_commercial_sources c on c.snapshot_id=s.id
    where o.service_request_id=p_request and c.source_hash=source->>'version'
      and s.created_by=p_actor and s.approved_by=p_approver
      and c.reviewed_terms=p_terms;
  if existing is not null then return existing; end if;
  result:=private.money_publish_snapshot(p_request,p_terms,p_actor,p_approver);
  insert into public.money_commercial_sources(snapshot_id,source_kind,source_hash,evidence,reviewed_terms) values(result,source->>'kind',source->>'version',source,p_terms);
  if source ? 'promotion' then
    insert into public.money_snapshot_promotions(snapshot_id,redemption_id,funding,discount,commission_rate_bps,commission_base,commission,platform_subsidy)
      values(result,(source->'promotion'->>'redemption_id')::uuid,source->'promotion'->>'funding',(source->'promotion'->>'discount_cents')::bigint,
        (source->'promotion'->>'commission_rate_bps')::integer,(source->'promotion'->>'commission_base_cents')::bigint,
        (source->'promotion'->>'commission_cents')::bigint,(source->'promotion'->>'platform_subsidy_cents')::bigint);
  end if;
  return result;
end $function$
;

-- 5. Fee, subsidy and proceeds in the money path ------------------------------------------------

-- Restates public.money_check_journal (latest definition). Adds the promotion_subsidy account (DEC-2026-038/041): a Mercurius-funded discount, kept apart from commission revenue.
create or replace function public.money_check_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare line jsonb; debit numeric; credit numeric; balance numeric := 0;
begin
  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) < 2 then raise exception 'Invalid journal'; end if;
  for line in select * from jsonb_array_elements(new.lines) loop
    debit := (line->>'debit')::numeric; credit := (line->>'credit')::numeric;
    if debit is null or credit is null or debit < 0 or credit < 0 or trunc(debit) <> debit or trunc(credit) <> credit
      or (debit > 0) = (credit > 0) or greatest(debit,credit) > 9007199254740991
      or coalesce(line->>'account','') not in ('stripe_clearing','customer_advance','platform_revenue','tax_liability','provider_payable','processor_expense','chargeback_suspense','bank','provider_recovery_loss','customer_refund_payable','promotion_subsidy')
      then raise exception 'Invalid posting'; end if;
    balance := balance + debit - credit;
  end loop;
  if balance <> 0 then raise exception 'Unbalanced journal'; end if;
  return new;
end $function$
;

-- Restates public.money_process_payment_event (latest definition). Earnings and refunds use the snapshot's commission and subsidy (private.money_split); ordinary bookings keep 15% exactly. A full refund before service restores the promotion.
create or replace function public.money_process_payment_event(p_event text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.money_webhook_events; a public.money_checkout_attempts; o public.money_obligations; s public.money_snapshots;
  r public.money_refund_authorizations; platform bigint; provider bigint; old_fee bigint; new_fee bigint; lines jsonb; code text;
  subsidy bigint; old_split record; new_split record;
begin
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if e.status='processed' then return 'processed'; end if;
  if e.status='dead_letter' then return 'dead_letter'; end if;
  update public.money_webhook_events set status='processing',attempt_count=attempt_count+1 where event_id=p_event;
  begin
    if e.event_type='capture' then
      select * into strict a from public.money_checkout_attempts where id=(e.payload->>'attempt_id')::uuid;
      select * into strict o from public.money_obligations where id=a.obligation_id for update;
      select * into strict a from public.money_checkout_attempts where id=a.id for update;
      select * into strict s from public.money_snapshots where id=a.snapshot_id;
      if a.amount is distinct from (e.payload->>'amount')::bigint or a.currency is distinct from (e.payload->>'currency') or coalesce(e.payload->>'payment_id','') not like 'pi_%' then raise exception 'Capture mismatch'; end if;
      if a.status='captured' then
        if a.stripe_payment_id<>e.payload->>'payment_id' then raise exception 'Duplicate payment conflict'; end if;
      else
        if a.status='expired' then raise exception 'Capture on expired session requires reconciliation'; end if;
        if o.current_snapshot_id<>s.id or o.captured+a.amount>s.total then raise exception 'Capture requires reconciliation'; end if;
        insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'capture:'||(e.payload->>'payment_id'),'capture',jsonb_build_array(
          jsonb_build_object('account','stripe_clearing','debit',a.amount,'credit',0),jsonb_build_object('account','customer_advance','debit',0,'credit',a.amount)),e.event_id);
        update public.money_checkout_attempts set status='captured',stripe_payment_id=e.payload->>'payment_id',completed_at=now() where id=a.id;
        update public.money_obligations set captured=captured+a.amount where id=o.id;
        if o.captured+a.amount=s.total then
          select * into strict old_split from private.money_split(o.id,s.subtotal);
          platform:=old_split.fee; subsidy:=old_split.subsidy; provider:=s.subtotal+subsidy-platform+s.tip;
          lines:=jsonb_build_array(jsonb_build_object('account','customer_advance','debit',s.total,'credit',0));
          if subsidy>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','promotion_subsidy','debit',subsidy,'credit',0)); end if;
          if platform>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',0,'credit',platform)); end if;
          if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',0,'credit',provider)); end if;
          if s.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',0,'credit',s.tax)); end if;
          insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'earnings:'||s.id,'earnings',lines,e.event_id);
          -- The booking is paid: its promotion is committed on the terms of the snapshot.
          perform private.promotion_commit(o.id);
        end if;
      end if;
    elsif e.event_type='refund' then
      select * into strict r from public.money_refund_authorizations where id=(e.payload->>'authorization_id')::uuid;
      select * into strict o from public.money_obligations where id=r.obligation_id for update;
      select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
      if r.service+r.tax+r.tip is distinct from (e.payload->>'amount')::bigint or e.payload->>'currency' is distinct from s.currency or e.payload->>'payment_id' is distinct from r.payment_id or coalesce(e.payload->>'refund_id','') not like 're_%' then raise exception 'Refund mismatch'; end if;
      if exists(select 1 from public.money_refunds where authorization_id=r.id) then
        if not exists(select 1 from public.money_refunds where authorization_id=r.id and provider_ref=e.payload->>'refund_id') then raise exception 'Refund identity conflict'; end if;
      else
        select * into strict old_split from private.money_split(o.id,s.subtotal-o.refunded_service);
        select * into strict new_split from private.money_split(o.id,s.subtotal-o.refunded_service-r.service);
        old_fee:=old_split.fee; new_fee:=new_split.fee; subsidy:=old_split.subsidy-new_split.subsidy;
        platform:=old_fee-new_fee; provider:=r.service+subsidy-platform+r.tip;
        lines:=jsonb_build_array(jsonb_build_object('account','stripe_clearing','debit',0,'credit',r.service+r.tax+r.tip));
        if subsidy>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','promotion_subsidy','debit',0,'credit',subsidy)); end if;
        if platform>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',platform,'credit',0)); end if;
        if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',provider,'credit',0)); end if;
        if r.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',r.tax,'credit',0)); end if;
        if o.captured<s.total then
          lines:=jsonb_build_array(jsonb_build_object('account','customer_advance','debit',r.service,'credit',0),jsonb_build_object('account','stripe_clearing','debit',0,'credit',r.service));
        end if;
        insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(o.id,'refund:'||r.id,'refund',lines,e.event_id);
        insert into public.money_refunds(provider_ref,authorization_id,event_id) values(e.payload->>'refund_id',r.id,e.event_id);
        update public.money_obligations set refunded_service=refunded_service+r.service,refunded_tax=refunded_tax+r.tax,refunded_tip=refunded_tip+r.tip where id=o.id;
        -- DEC-2026-041 item 1: a full refund before service restores the promotion.
        perform private.promotion_restore_after_refund(o.id);
      end if;
    else raise exception 'Unsupported event requires reconciliation'; end if;
    update public.money_webhook_events set status='processed',processed_at=now(),last_error=null,next_retry_at=null where event_id=p_event;
    return 'processed';
  exception when others then
    get stacked diagnostics code = returned_sqlstate;
    update public.money_webhook_events set status=case when attempt_count>=5 then 'dead_letter' else 'failed' end,
      last_error=code,next_retry_at=now()+interval '5 minutes' where event_id=p_event;
    return 'failed';
  end;
end $function$
;

-- Restates private.money_payable (latest definition). Provider proceeds through private.money_provider_proceeds.
create or replace function private.money_payable(p_obligation uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.money_obligations; s public.money_snapshots; amount bigint; retained record; payee uuid;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
  payee:=private.money_effective_contractor(o.id);
  if o.captured<>s.total or o.dispute_open or o.reconciliation_open then raise exception 'Payment or dispute hold'; end if;
  if exists(select 1 from public.money_webhook_events e where e.status<>'processed'
    and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
    and (e.event_type='reconciliation_required' or e.payload->>'attempt_id' in(select id::text from public.money_checkout_attempts where obligation_id=o.id)
      or e.payload->>'payment_id' in(select stripe_payment_id from public.money_checkout_attempts where obligation_id=o.id))) then raise exception 'Unreconciled provider event hold'; end if;
  if not exists(select 1 from public.money_completion_evidence where obligation_id=o.id and homeowner_id=o.customer_id and confirmed_at+interval '48 hours'<=now()) then raise exception '48 hours after homeowner confirmation required'; end if;
  if exists(select 1 from public.money_holds h where obligation_id=o.id and not exists(select 1 from public.money_hold_resolutions r where r.hold_id=h.id)) then raise exception 'Unresolved payout hold'; end if;
  if exists(select 1 from public.money_refund_authorizations r where obligation_id=o.id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then raise exception 'Pending refund hold'; end if;
  if not private.vendor_payout_eligible(payee) then raise exception 'Vendor onboarding hold'; end if;
  select * into strict retained from public.money_retained_parts(o.id);
  amount:=private.money_provider_proceeds(o.id,retained.service,retained.tip);
  if amount<=0 then raise exception 'No provider payable'; end if;
  return amount;
end $function$
;

-- Restates private.money_payout_proceeds (latest definition). Provider proceeds through private.money_provider_proceeds.
create or replace function private.money_payout_proceeds(p_obligation uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select private.money_provider_proceeds(p_obligation,r.service,r.tip) from public.money_retained_parts(p_obligation) r),0)::bigint
$function$
;

-- Restates private.money_ach_payable (latest definition). Provider proceeds through private.money_provider_proceeds.
create or replace function private.money_ach_payable(p_obligation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.money_obligations; s public.money_snapshots; r public.service_requests;
  c public.money_lifecycle_confirmations; evidence public.money_completion_evidence;
  retained record; payee uuid; banks uuid[]; payable bigint;
begin
  select * into o from public.money_obligations where id=p_obligation;
  if not found then return jsonb_build_object('blocker','not_found'); end if;
  begin
    c:=private.money_completion_source(o.id);
  exception when others then
    return jsonb_build_object('blocker',case when sqlerrm like 'Replacement commercial reconciliation%'
      then 'replacement_reconciliation' else 'awaiting_confirmation' end);
  end;
  select * into strict r from public.service_requests where id=c.request_id;
  if r.disputed or r.status not in ('homeowner_confirmed','completed','review_requested','reviewed','closed','resolved')
    or exists(select 1 from public.disputes where job_id=r.id and status<>'resolved')
    or exists(select 1 from public.dispute_appeals a join public.disputes d on d.id=a.dispute_id
      left join public.support_tickets t on t.id=a.ticket_id where d.job_id=r.id and (t.id is null or t.status<>'resolved')) then
    return jsonb_build_object('blocker','dispute_hold');
  end if;
  -- money_record_completion refuses evidence that differs from the confirmation.
  select * into evidence from public.money_completion_evidence where obligation_id=o.id;
  if (evidence.obligation_id is not null and (evidence.homeowner_id,evidence.confirmed_at,evidence.source_ref)
      is distinct from (c.homeowner_id,c.confirmed_at,'phase4-confirmation:'||c.id))
    or exists(select 1 from public.money_completion_evidence x where x.source_ref='phase4-confirmation:'||c.id and x.obligation_id<>o.id) then
    return jsonb_build_object('blocker','confirmation_conflict');
  end if;
  select * into s from public.money_snapshots where id=o.current_snapshot_id;
  if s.id is null or o.captured<>s.total then return jsonb_build_object('blocker','payment_incomplete'); end if;
  if o.dispute_open then return jsonb_build_object('blocker','chargeback_hold'); end if;
  if o.reconciliation_open then return jsonb_build_object('blocker','reconciliation_hold'); end if;
  if private.money_unprocessed_events(o.id)>0 then return jsonb_build_object('blocker','provider_event_hold'); end if;
  if c.confirmed_at+interval '48 hours'>now() then return jsonb_build_object('blocker','confirmation_window'); end if;
  if exists(select 1 from public.money_holds h where h.obligation_id=o.id
    and not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)) then
    return jsonb_build_object('blocker','payout_hold');
  end if;
  if exists(select 1 from public.money_refund_authorizations a where a.obligation_id=o.id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id)) then
    return jsonb_build_object('blocker','refund_hold');
  end if;
  payee:=private.money_effective_contractor(o.id);
  if not private.vendor_payout_eligible(payee) then return jsonb_build_object('blocker','payout_onboarding'); end if;
  select * into strict retained from public.money_retained_parts(o.id);
  payable:=private.money_provider_proceeds(o.id,retained.service,retained.tip);
  if payable<=0 then return jsonb_build_object('blocker','no_payable'); end if;
  -- TRACE-080: never more than the proceeds in total; a paid payout is never paid again.
  if private.money_ach_exceeds_proceeds(o.id,payable) then return jsonb_build_object('blocker','already_paid'); end if;
  select array_agg(e.id order by e.id) into banks from public.vendor_compliance_evidence e
    where e.contractor_id=payee and e.kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  return jsonb_build_object('blocker',null,'amount',payable,'payee',payee,
    'bank_evidence',case when cardinality(banks)=1 then banks[1] end,'bank_count',coalesce(cardinality(banks),0),
    'eligible_at',c.confirmed_at+interval '48 hours');
end $function$
;

-- Restates private.money_ach_exceeds_proceeds (latest definition). Provider proceeds through private.money_provider_proceeds.
create or replace function private.money_ach_exceeds_proceeds(p_obligation uuid, p_amount bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.money_payout_received(p_obligation)+p_amount>(select private.money_provider_proceeds(p_obligation,r.service,r.tip)
    from public.money_retained_parts(p_obligation) r)
$function$
;

-- Restates private.money_prepare_ach (latest definition). Statement items record the snapshot's commission and any platform subsidy.
create or replace function private.money_prepare_ach(p_period date, p_obligations uuid[], p_actor uuid, p_approver uuid, p_bank_ref text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare batch uuid; obligation uuid; o public.money_obligations; s public.money_snapshots; item uuid;
  bank_evidence uuid; amount bigint; retained record; payee uuid; split record;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','ach','period',p_period,'obligations',p_obligations,'bank_ref',p_bank_ref,'reason',p_reason));
  if cardinality(p_obligations) is null or cardinality(p_obligations) not between 1 and 500 then raise exception 'Bounded batch required'; end if;
  perform 1 from public.vendor_onboarding where contractor_id in(
    select private.money_effective_contractor(id) from public.money_obligations where id=any(p_obligations)
  ) order by contractor_id for share;
  perform 1 from public.money_obligations where id=any(p_obligations) order by id for update;
  insert into public.money_ach_batches(period_start,period_end,created_by,approved_by,bank_authorization_ref,reason)
    values(p_period,p_period+7,p_actor,p_approver,p_bank_ref,p_reason) returning id into batch;
  for obligation in select distinct unnest(p_obligations) order by 1 loop
    select * into strict o from public.money_obligations where id=obligation;
    select * into strict s from public.money_snapshots where id=o.current_snapshot_id;
    payee:=private.money_effective_contractor(o.id);
    amount:=public.money_payable(o.id);
    select * into strict retained from public.money_retained_parts(o.id);
    select * into strict split from private.money_split(o.id,retained.service);
    select e.id into strict bank_evidence from public.vendor_compliance_evidence e where contractor_id=payee and kind='bank_authorization'
      and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
    insert into public.money_ach_items(batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,platform_subsidy,amount,confirmation_ref,bank_evidence_id)
      values(batch,o.id,payee,s.id,retained.service,retained.tip,split.fee,split.subsidy,amount,
        (select source_ref from public.money_completion_evidence where obligation_id=o.id),bank_evidence) returning id into item;
    insert into public.money_ach_attempts(item_id,attempt_number,created_by,approved_by) values(item,1,p_actor,p_approver);
  end loop;
  return batch;
end $function$
;

-- Restates private.money_refund_reversal (latest definition). A reversed refund restores the commission and subsidy shares it removed.
create or replace function private.money_refund_reversal(p_authorization uuid)
 RETURNS TABLE(lines jsonb, provider bigint, advance boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.money_refund_authorizations; ret record; old_fee bigint; new_fee bigint; amount bigint;
  old_split record; new_split record; subsidy bigint;
begin
  select * into strict r from public.money_refund_authorizations where id=p_authorization;
  amount:=r.service+r.tax+r.tip;
  advance:=exists(select 1 from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.business_key='refund:'||r.id and l->>'account'='customer_advance');
  lines:=jsonb_build_array(jsonb_build_object('account','customer_refund_payable','debit',amount,'credit',0));
  if advance then
    provider:=0;
    lines:=lines||jsonb_build_array(jsonb_build_object('account','customer_advance','debit',0,'credit',amount));
  else
    select * into strict ret from public.money_retained_parts(r.obligation_id);
    select * into strict old_split from private.money_split(r.obligation_id,ret.service);
    select * into strict new_split from private.money_split(r.obligation_id,ret.service+r.service);
    old_fee:=old_split.fee; new_fee:=new_split.fee; subsidy:=new_split.subsidy-old_split.subsidy;
    provider:=r.service+subsidy-(new_fee-old_fee)+r.tip;
    if new_fee>old_fee then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',0,'credit',new_fee-old_fee)); end if;
    if subsidy>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','promotion_subsidy','debit',subsidy,'credit',0)); end if;
    if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',0,'credit',provider)); end if;
    if r.tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',0,'credit',r.tax)); end if;
  end if;
  return next;
end $function$
;

-- Restates public.money_resolve_chargeback_loss (latest definition). A lost chargeback reverses commission and subsidy proportionally.
create or replace function public.money_resolve_chargeback_loss(p_dispute text, p_service bigint, p_tax bigint, p_tip bigint, p_actor uuid, p_approver uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.money_disputes; remaining record; old_fee bigint; new_fee bigint; provider bigint; lines jsonb;
  old_split record; new_split record; subsidy bigint;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','chargeback','dispute',p_dispute,'service',p_service,'tax',p_tax,'tip',p_tip,'reason',p_reason));
  select * into strict d from public.money_disputes where provider_id=p_dispute;
  perform 1 from public.money_obligations where id=d.obligation_id for update;
  select * into strict d from public.money_disputes where provider_id=p_dispute for update;
  if d.status<>'lost' then raise exception 'Confirmed chargeback loss required'; end if;
  if exists(select 1 from public.money_chargeback_resolutions where dispute_id=d.provider_id) then raise exception 'Chargeback already allocated'; end if;
  if private.money_ach_unpaid_statement(d.obligation_id) then raise exception 'Scheduled funds need their bank outcome or a withdrawal first; no automatic clawback'; end if;
  if exists(select 1 from public.money_refund_authorizations r where r.obligation_id=d.obligation_id and not exists(select 1 from public.money_refunds f where f.authorization_id=r.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=r.id)) then raise exception 'Pending refund must reconcile before chargeback allocation'; end if;
  select * into strict remaining from public.money_retained_parts(d.obligation_id);
  if p_service is null or p_tax is null or p_tip is null or least(p_service,p_tax,p_tip)<0 or p_service+p_tax+p_tip<>d.amount
    or p_service>remaining.service or p_tax>remaining.tax or p_tip>remaining.tip then raise exception 'Chargeback allocation exceeds retained components'; end if;
  select * into strict old_split from private.money_split(d.obligation_id,remaining.service);
  select * into strict new_split from private.money_split(d.obligation_id,remaining.service-p_service);
  old_fee:=old_split.fee; new_fee:=new_split.fee; subsidy:=old_split.subsidy-new_split.subsidy;
  provider:=p_service+subsidy-(old_fee-new_fee)+p_tip;
  lines:=jsonb_build_array(jsonb_build_object('account','chargeback_suspense','debit',0,'credit',d.amount));
  if subsidy>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','promotion_subsidy','debit',0,'credit',subsidy)); end if;
  if old_fee>new_fee then lines:=lines||jsonb_build_array(jsonb_build_object('account','platform_revenue','debit',old_fee-new_fee,'credit',0)); end if;
  if provider>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','provider_payable','debit',provider,'credit',0)); end if;
  if p_tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account','tax_liability','debit',p_tax,'credit',0)); end if;
  insert into public.money_chargeback_resolutions(dispute_id,service,tax,tip,actor,approver,reason) values(d.provider_id,p_service,p_tax,p_tip,p_actor,p_approver,p_reason);
  insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(d.obligation_id,'chargeback-loss:'||d.provider_id,'chargeback_loss',lines,p_reason);
  update public.money_obligations set dispute_open=exists(select 1 from public.money_disputes x where x.obligation_id=d.obligation_id and
    (x.status='open' or (x.status='lost' and not exists(select 1 from public.money_chargeback_resolutions r where r.dispute_id=x.provider_id)))) where id=d.obligation_id;
end $function$
;

-- Restates private.money_obligation_reconciliation (latest definition). Expected commission, subsidy and proceeds come from the snapshot's split; the subsidy ledger is reconciled.
create or replace function private.money_obligation_reconciliation(p_obligation uuid, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o public.money_obligations; s public.money_snapshots; r public.service_requests; ret record;
  c public.money_lifecycle_confirmations; item public.money_ach_items; attempt public.money_ach_attempts;
  readback public.money_reconciliation; payee uuid; payee_name text; full_capture boolean;
  attempts_captured bigint; ledger_captured bigint; settled record; refunds_settled integer; refund_journals integer;
  refund_clearing bigint; pending_refunds integer; released_refunds integer; earnings integer; fee bigint:=0; tax_expected bigint:=0;
  proceeds bigint:=0; subsidy bigint:=0; advance_expected bigint; paid bigint; returned bigint; suspense_expected bigint;
  clearing_expected bigint; processor bigint; disputed bigint; lost bigint; bank_status text; funds text;
  late bigint; repaid bigint; written_off bigint; reversed_repaid bigint; customer_owed bigint; late_failed integer;
  reversed_refunds integer; reversed_amount bigint;
  not_eligible text[]:='{}'; held text[]:='{}'; issues text[]:='{}'; eligible_at timestamptz;
begin
  select * into strict o from public.money_obligations where id=p_obligation;
  select * into s from public.money_snapshots where id=o.current_snapshot_id;
  select * into strict r from public.service_requests where id=o.service_request_id;
  payee:=private.money_effective_contractor(o.id);
  select name into payee_name from public.contractors where id=payee;
  full_capture:=s.id is not null and o.captured=s.total;

  -- Charges: counter, captured attempts and capture journals must agree.
  select coalesce(sum(amount),0) into attempts_captured from public.money_checkout_attempts
    where obligation_id=o.id and status='captured';
  select coalesce(sum((l->>'debit')::bigint),0) into ledger_captured
    from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.obligation_id=o.id and j.kind='capture' and l->>'account'='stripe_clearing';
  if attempts_captured<>o.captured then issues:=array_append(issues,'charge_attempts'); end if;
  if ledger_captured<>o.captured then issues:=array_append(issues,'charge_ledger'); end if;

  -- Refunds: counters equal provider-settled authorizations, each posted once.
  select coalesce(sum(a.service),0) service,coalesce(sum(a.tax),0) tax,coalesce(sum(a.tip),0) tip,count(*) n into settled
    from public.money_refund_authorizations a where a.obligation_id=o.id
      and exists(select 1 from public.money_refunds f where f.authorization_id=a.id)
      and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id);
  refunds_settled:=settled.n;
  select count(*) into pending_refunds from public.money_refund_authorizations a where a.obligation_id=o.id
    and not exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id);
  select count(*) into released_refunds from public.money_refund_releases z where z.obligation_id=o.id;
  select count(*),coalesce(sum(credit),0) into refund_journals,refund_clearing from (
    select j.id,sum((l->>'credit')::bigint) credit from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l
    where j.obligation_id=o.id and j.kind='refund' and l->>'account'='stripe_clearing' group by j.id) x;
  if (settled.service,settled.tax,settled.tip)<>(o.refunded_service,o.refunded_tax,o.refunded_tip) then issues:=array_append(issues,'refund_counters'); end if;
  -- A late refund released after it settled keeps its refund journal and is reversed against the
  -- customer refund payable; its amount leaves the counters.
  select count(*),coalesce(sum(z.amount),0) into reversed_refunds,reversed_amount from public.money_refund_releases z
    where z.obligation_id=o.id and exists(select 1 from public.money_refunds f where f.authorization_id=z.authorization_id);
  if refund_journals<>refunds_settled+reversed_refunds or refund_clearing<>o.refunded_service+o.refunded_tax+o.refunded_tip+reversed_amount then issues:=array_append(issues,'refund_ledger'); end if;
  if (select count(*) from public.money_journals where obligation_id=o.id and kind='refund_reversal')<>reversed_refunds then issues:=array_append(issues,'refund_ledger'); end if;
  -- Late failures: what Stripe returned is owed to the customer until a resend settles or a release reverses it.
  select count(*) into late_failed from public.money_refund_late_failures where obligation_id=o.id;
  customer_owed:=private.money_customer_refund_owed(o.id);
  if -private.money_account_net(o.id,'customer_refund_payable')<>customer_owed then issues:=array_append(issues,'customer_refund_payable'); end if;

  -- Earnings: one allocation once the full total is captured, none before.
  select count(*) into earnings from public.money_journals where obligation_id=o.id and kind='earnings';
  if earnings<>(case when full_capture then 1 else 0 end) then issues:=array_append(issues,'earnings_posting'); end if;
  if s.id is not null then
    select * into strict ret from public.money_retained_parts(o.id);
    if full_capture then
      select split.fee,split.subsidy into fee,subsidy from private.money_split(o.id,ret.service) split;
      tax_expected:=ret.tax;
      proceeds:=ret.service+subsidy-fee+ret.tip;
    end if;
  end if;
  advance_expected:=case when full_capture then 0 else o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip end;
  if -private.money_account_net(o.id,'platform_revenue')<>fee then issues:=array_append(issues,'platform_fee'); end if;
  if private.money_account_net(o.id,'promotion_subsidy')<>subsidy then issues:=array_append(issues,'promotion_subsidy'); end if;
  if -private.money_account_net(o.id,'tax_liability')<>tax_expected then issues:=array_append(issues,'tax_liability'); end if;
  if -private.money_account_net(o.id,'customer_advance')<>advance_expected then issues:=array_append(issues,'customer_advance'); end if;

  -- Payouts: recorded bank outcomes against the provider payable and bank accounts.
  select coalesce(sum(i.amount) filter (where e.status='settled'),0),coalesce(sum(i.amount) filter (where e.status='returned'),0)
    into paid,returned
    from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id join public.money_ach_events e on e.attempt_id=a.id
    where i.obligation_id=o.id;
  -- A late payment of a withdrawn transfer counts as paid; repayments and write-offs reduce what
  -- the provider owes.
  select coalesce(sum(amount),0) into late from public.money_ach_late_settlements where obligation_id=o.id;
  paid:=paid+late;
  select coalesce(sum(amount) filter (where kind='repayment'),0),coalesce(sum(amount) filter (where kind='write_off'),0)
    into repaid,written_off from public.money_payout_recoveries where obligation_id=o.id;
  select coalesce(sum(amount),0) into reversed_repaid from public.money_repayment_reversals where obligation_id=o.id;
  if -private.money_account_net(o.id,'provider_payable')<>proceeds-paid+returned+repaid+written_off-reversed_repaid then issues:=array_append(issues,'provider_payable'); end if;
  if private.money_account_net(o.id,'bank')<>returned-paid+repaid-reversed_repaid then issues:=array_append(issues,'bank_ledger'); end if;
  if private.money_account_net(o.id,'provider_recovery_loss')<>written_off then issues:=array_append(issues,'recovery_ledger'); end if;
  select * into item from public.money_ach_items where id=private.money_ach_live_item(o.id);
  if item.id is not null then
    select * into attempt from public.money_ach_attempts where item_id=item.id order by attempt_number desc limit 1;
    bank_status:=attempt.status;
    -- A settled statement records what was paid; a later refund or chargeback shows as an amount owed.
    if bank_status='settled' then
      null;
    elsif s.id is null then
      issues:=array_append(issues,'statement_stale');
    elsif item.snapshot_id<>s.id or item.service_retained<>ret.service or item.tip_retained<>ret.tip or item.contractor_id<>payee then
      issues:=array_append(issues,'statement_stale');
    end if;
  end if;

  -- Chargebacks and processor costs against Stripe clearing.
  select coalesce(sum(amount) filter (where status='open' or (status='lost' and not exists(
      select 1 from public.money_chargeback_resolutions x where x.dispute_id=d.provider_id))),0),
    coalesce(sum(amount) filter (where status in ('open','lost')),0),coalesce(sum(amount) filter (where status='lost'),0)
    into suspense_expected,disputed,lost from public.money_disputes d where d.obligation_id=o.id;
  processor:=private.money_account_net(o.id,'processor_expense');
  clearing_expected:=o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+customer_owed-disputed-processor;
  if private.money_account_net(o.id,'chargeback_suspense')<>suspense_expected then issues:=array_append(issues,'chargeback_suspense'); end if;
  if private.money_account_net(o.id,'stripe_clearing')<>clearing_expected then issues:=array_append(issues,'stripe_clearing'); end if;

  select * into readback from public.money_reconciliation where obligation_id=o.id order by observation_sequence desc limit 1;

  -- Funds state. The predicates mirror public.money_payable without writing completion evidence.
  if item.id is not null then
    funds:=case when bank_status in ('prepared','submitted','unknown') then 'scheduled'
      when bank_status='settled' then 'paid' else 'payout_failed' end;
  elsif late>0 then
    -- No live statement, but the bank paid a withdrawn transfer: the payout is paid.
    funds:='paid';
  else
    if not full_capture then not_eligible:=array_append(not_eligible,'payment_incomplete'); end if;
    begin
      c:=private.money_completion_source(o.id);
      eligible_at:=c.confirmed_at+interval '48 hours';
      if eligible_at>p_at then not_eligible:=array_append(not_eligible,'confirmation_window'); end if;
    exception when others then
      not_eligible:=array_append(not_eligible,case when sqlerrm like 'Replacement commercial reconciliation%'
        then 'replacement_reconciliation' else 'awaiting_confirmation' end);
    end;
    if r.status not in ('homeowner_confirmed','completed','review_requested','reviewed','closed','resolved')
      and not 'awaiting_confirmation'=any(not_eligible) then not_eligible:=array_append(not_eligible,'awaiting_confirmation'); end if;
    if full_capture and proceeds<=0 then not_eligible:=array_append(not_eligible,'no_payable'); end if;
    if r.disputed or exists(select 1 from public.disputes where job_id=r.id and status<>'resolved')
      or exists(select 1 from public.dispute_appeals a join public.disputes d on d.id=a.dispute_id
        left join public.support_tickets t on t.id=a.ticket_id where d.job_id=r.id and (t.id is null or t.status<>'resolved'))
      then held:=array_append(held,'dispute'); end if;
    if o.dispute_open then held:=array_append(held,'chargeback'); end if;
    if o.reconciliation_open then held:=array_append(held,'reconciliation'); end if;
    if private.money_unprocessed_events(o.id)>0 then held:=array_append(held,'provider_event'); end if;
    if exists(select 1 from public.money_holds h where h.obligation_id=o.id
      and not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)) then held:=array_append(held,'payout_hold'); end if;
    if pending_refunds>0 then held:=array_append(held,'pending_refund'); end if;
    if not private.vendor_payout_eligible(payee,p_at) then held:=array_append(held,'payout_onboarding'); end if;
    funds:=case when cardinality(not_eligible)>0 then 'not_eligible' when cardinality(held)>0 then 'held' else 'eligible' end;
  end if;

  return jsonb_build_object(
    'obligation_id',o.id,
    'service_request_id',o.service_request_id,
    'invoice_number',s.invoice_number,
    'created_at',o.created_at,
    'payee',jsonb_build_object('contractor_id',payee,'name',payee_name,'reassigned',payee<>o.contractor_id),
    'terms',case when s.id is null then null else jsonb_build_object('subtotal',s.subtotal,'tax',s.tax,'tip',s.tip,'deposit',s.deposit,'total',s.total) end,
    'charges',jsonb_build_object('captured',o.captured,'attempts_captured',attempts_captured,'ledger_captured',ledger_captured,'fully_captured',full_capture,
      'payments',coalesce((select jsonb_agg(jsonb_build_object('payment_id',a.stripe_payment_id,'mode',a.mode,'amount',a.amount) order by a.completed_at,a.id)
        from public.money_checkout_attempts a where a.obligation_id=o.id and a.status='captured'),'[]'::jsonb)),
    'refunds',jsonb_build_object('service',o.refunded_service,'tax',o.refunded_tax,'tip',o.refunded_tip,
      'settled',refunds_settled,'pending',pending_refunds,'released',released_refunds,
      'late_failed',late_failed,'reversed',reversed_refunds,'customer_owed',customer_owed),
    'earnings',jsonb_build_object('platform_fee',fee,'platform_fee_ledger',-private.money_account_net(o.id,'platform_revenue'),
      'tax',tax_expected,'tax_ledger',-private.money_account_net(o.id,'tax_liability'),'provider_proceeds',proceeds,
      'platform_subsidy',subsidy,'platform_subsidy_ledger',private.money_account_net(o.id,'promotion_subsidy')),
    'payout',jsonb_build_object('funds_state',funds,'not_eligible',to_jsonb(not_eligible),'held',to_jsonb(held),
      'eligible_at',case when item.id is null then eligible_at end,
      'paid',paid,'returned',returned,'payable',proceeds-paid+returned+repaid+written_off-reversed_repaid,
      'payable_ledger',-private.money_account_net(o.id,'provider_payable'),
      'recovery',jsonb_build_object('owed',private.money_payout_owed(o.id),'late_settled',late,'repaid',repaid,'written_off',written_off,
        'repayment_reversed',reversed_repaid,'repayment_returnable',private.money_repayment_returnable(o.id)),
      'withdrawn_statements',(select count(*) from public.money_ach_withdrawals w join public.money_ach_items i on i.id=w.item_id where i.obligation_id=o.id),
      'statement',case when item.id is null then null else jsonb_build_object('amount',item.amount,
        'period_start',(select period_start from public.money_ach_batches where id=item.batch_id),
        'attempt_number',attempt.attempt_number,'bank_status',bank_status) end),
    'chargebacks',jsonb_build_object('suspense',suspense_expected,'suspense_ledger',private.money_account_net(o.id,'chargeback_suspense'),
      'lost',lost),
    'processor_costs',processor,
    'readback',case when readback.id is null then jsonb_build_object('state','none') else jsonb_build_object(
      'state',case when readback.observed<>readback.expected or readback.currency<>'usd' then 'mismatch'
        when readback.expected<>o.captured-o.refunded_service-o.refunded_tax-o.refunded_tip+customer_owed then 'outdated' else 'matched' end,
      'observed',readback.observed,'expected',readback.expected,'recorded_at',readback.created_at) end,
    'reconciliation_open',o.reconciliation_open,
    'issues',to_jsonb(issues));
end $function$
;


revoke all on function
  private.money_gate(text), private.promotion_has_completed_service(uuid, uuid), private.promotion_commit(uuid),
  private.promotion_restore_after_refund(uuid), private.promotion_release_on_cancel(), private.promotion_release_unpaid(),
  public.admin_restore_promotion(uuid, text), private.money_split(uuid, bigint), private.money_provider_proceeds(uuid, bigint, bigint)
from public, anon, authenticated, service_role;
grant execute on function public.admin_restore_promotion(uuid, text) to authenticated;
