-- DEC-2026-067 / TRACE-160: pilot standard commission 10% (promotional 5%), prospective only.
--
-- Record: governance/PILOT-COMMISSION-10.md. Supersedes the 15% standard of CFG-005/CFG-008 and
-- the fixed 7.5% of DEC-2026-038 for snapshots published after this migration; DEC-2026-038's rule
-- (a qualifying promotion halves the standard commission) is unchanged, so it now yields 5%.
--
-- Why a migration is needed. Before this migration the ordinary commission was not snapshotted:
-- private.money_split recomputed round(service * 15 / 100) from the live code on every capture,
-- refund, chargeback, payout and reconciliation. Editing that constant would have silently
-- repriced every historical booking. So:
--
--   1. private.money_commission_policies records each standard/promotional rate pair and the
--      moment it takes effect (append-only). The historical 15%/7.5% pair is recorded from
--      -infinity; the 10%/5% pair takes effect at now(), i.e. the commit of the hosted push.
--   2. public.money_snapshots gains commission_rate_bps. Existing rows read 1500 through a
--      metadata-only default: no row is updated, so the immutable_evidence trigger never fires,
--      and every existing snapshot keeps exactly its 15% economics for life. The default is then
--      dropped: a new snapshot gets its rate only from private.money_publish_snapshot, which
--      stamps the policy in force when the two-person review publishes it.
--   3. private.money_split uses the snapshot's stamped rate instead of the constant 15. For a
--      1500 stamp, round(service * 1500 / 10000) is the same rational as round(service * 15 / 100),
--      so every existing obligation computes exactly what it did before.
--   4. New promotion reservations use the policy's promotional rate (500). A reservation made
--      under the superseded rate (750; only possible while the promotions gate was open) is not
--      repriced: it is reported as `commission_changed`, released unpaid by the existing sweep
--      (the homeowner chooses again, DEC-2026-042), and refused at snapshot publication.
--   5. Reviewers' terms cannot carry a commission rate: the rate is policy, set by the server.
--   6. The finance reconciliation reports the current rates and when they took effect.
--
-- Not changed: what the homeowner pays; the commission base (final service subtotal after
-- discounts/adjustments, excluding tax and tips); round() half away from zero on whole cents;
-- refunds recomputed on the cumulative retained subtotal; tips 100% to the provider; processor
-- cost as a Mercurius cost; promotion eligibility, funding, stacking, refund allocation, release
-- and restoration; the closed promotions gate; every other function, table, trigger and grant.
--
-- Rollout: additive. The live application computes no commission itself (every amount comes
-- from these functions), so the deployed code keeps working on this schema before the merge.

set lock_timeout = '2s';

-- 1. Policy ----------------------------------------------------------------------------------------

create table private.money_commission_policies (
  id bigint generated always as identity primary key,
  standard_bps integer not null check (standard_bps between 1 and 10000),
  promotional_bps integer not null,
  effective_at timestamptz not null default now(),
  decision text not null check (length(btrim(decision)) between 1 and 500),
  created_at timestamptz not null default now(),
  -- DEC-2026-038: a qualifying promotion halves the standard commission.
  check (promotional_bps * 2 = standard_bps)
);
alter table private.money_commission_policies enable row level security;
revoke all on private.money_commission_policies from public, anon, authenticated, service_role;

create function private.money_commission_policy_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Commission policy history is append-only; record a new policy instead' using errcode = '42501';
end $$;
revoke all on function private.money_commission_policy_immutable() from public, anon, authenticated, service_role;
create trigger money_commission_policies_append_only before update or delete on private.money_commission_policies
  for each row execute function private.money_commission_policy_immutable();

insert into private.money_commission_policies(standard_bps, promotional_bps, effective_at, decision) values
  (1500, 750, '-infinity', 'CFG-005/CFG-008 15% standard; DEC-2026-038 7.5% promotional (historical; superseded prospectively by DEC-2026-067)'),
  (1000, 500, now(), 'DEC-2026-067 pilot standard 10%; DEC-2026-038 half-rate promotional 5%');

create function private.money_standard_commission_bps() returns integer
language sql stable security definer set search_path = '' as $$
  select p.standard_bps from private.money_commission_policies p
   where p.effective_at <= now() order by p.effective_at desc, p.id desc limit 1
$$;

create function private.money_promotional_commission_bps() returns integer
language sql stable security definer set search_path = '' as $$
  select p.promotional_bps from private.money_commission_policies p
   where p.effective_at <= now() order by p.effective_at desc, p.id desc limit 1
$$;

create function private.money_commission_effective_at() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select p.effective_at from private.money_commission_policies p
   where p.effective_at <= now() order by p.effective_at desc, p.id desc limit 1
$$;

revoke all on function private.money_standard_commission_bps(), private.money_promotional_commission_bps(),
  private.money_commission_effective_at() from public, anon, authenticated, service_role;

-- 2. The snapshot carries its standard rate ---------------------------------------------------------

-- Metadata-only default: existing rows read 1500 without being rewritten or updated.
alter table public.money_snapshots add column commission_rate_bps integer not null default 1500;
alter table public.money_snapshots alter column commission_rate_bps drop default;
alter table public.money_snapshots add constraint money_snapshots_commission_rate_bps_check
  check (commission_rate_bps in (1000, 1500));
-- Homeowners read their snapshots through column grants; the rate is not added to them.

-- 3. Promotional evidence may carry the historical 7.5% or the current 5% ---------------------------

alter table private.promotion_redemptions drop constraint promotion_redemptions_commission_rate_bps_check;
alter table private.promotion_redemptions add constraint promotion_redemptions_commission_rate_bps_check
  check (commission_rate_bps in (500, 750));
alter table public.money_snapshot_promotions drop constraint money_snapshot_promotions_commission_rate_bps_check;
alter table public.money_snapshot_promotions add constraint money_snapshot_promotions_commission_rate_bps_check
  check (commission_rate_bps in (500, 750));

-- 4. Publication stamps the policy rate --------------------------------------------------------------

-- Restates the definition 20260905010000 moved to `private` (unchanged since). Only the rate is added:
-- refused when the reviewers' terms name one, otherwise stamped from the policy in force.
create or replace function private.money_publish_snapshot(p_request uuid, p_terms jsonb, p_actor uuid, p_approver uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare r public.service_requests; o public.money_obligations; snapshot uuid; revision integer; rate integer;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','snapshot','request',p_request,'terms',p_terms));
  -- DEC-2026-067: the commission rate is Mercurius policy, never part of the reviewed terms.
  if p_terms ? 'commission_rate_bps' then
    raise exception 'The commission rate is set by Mercurius policy, not by the reviewed terms' using errcode='22023';
  end if;
  rate:=private.money_standard_commission_bps();
  if rate is null then raise exception 'No commission policy is in force' using errcode='55000'; end if;
  select * into strict r from public.service_requests where id=p_request for update;
  if r.customer_id is null or r.contractor_id is null then raise exception 'Confirmed commercial parties required'; end if;
  insert into public.money_obligations(service_request_id,customer_id,contractor_id)
    values(r.id,r.customer_id,r.contractor_id) on conflict(service_request_id) do nothing;
  select * into strict o from public.money_obligations where service_request_id=r.id for update;
  if o.customer_id <> r.customer_id or o.contractor_id <> r.contractor_id then raise exception 'Commercial party reconciliation required'; end if;
  if exists(select 1 from public.money_checkout_attempts where obligation_id=o.id)
    then raise exception 'Existing checkout requires reconciliation before repricing'; end if;
  select coalesce(max(s.revision),0)+1 into revision from public.money_snapshots s where obligation_id=o.id;
  insert into public.money_snapshots(obligation_id,revision,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,promotion_terms,created_by,approved_by,reason,expires_at,commission_rate_bps)
  values(o.id,revision,(p_terms->>'service')::bigint,(p_terms->>'addons')::bigint,(p_terms->>'discount')::bigint,(p_terms->>'adjustment')::bigint,
    (p_terms->>'subtotal')::bigint,(p_terms->>'tax')::bigint,(p_terms->>'tip')::bigint,(p_terms->>'deposit')::bigint,(p_terms->>'total')::bigint,
    p_terms->>'currency',p_terms->>'source_version',p_terms->>'policy_version',p_terms->>'tax_evidence',p_terms->>'promotion_terms',p_actor,p_approver,p_terms->>'reason',(p_terms->>'expires_at')::timestamptz,
    rate)
  returning id into snapshot;
  update public.money_obligations set current_snapshot_id=snapshot where id=o.id;
  return snapshot;
end $function$;

-- Restates 20261018005000's definition (unchanged since). Only the superseded-rate refusal is added,
-- after the identical-retry return, so a retry of an earlier publication still returns its snapshot.
create or replace function public.money_publish_snapshot(p_request uuid, p_terms jsonb, p_actor uuid, p_approver uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  -- DEC-2026-067: a promotion reserved under a superseded rate is never published at that rate
  -- and never silently repriced; it is released so the homeowner can apply the offer again.
  if source ? 'promotion' and (source->'promotion'->>'commission_rate_bps')::integer
      is distinct from private.money_promotional_commission_bps() then
    raise exception 'This offer was reserved under a superseded commission rate; release it so the homeowner can apply it again' using errcode='40001';
  end if;
  result:=private.money_publish_snapshot(p_request,p_terms,p_actor,p_approver);
  insert into public.money_commercial_sources(snapshot_id,source_kind,source_hash,evidence,reviewed_terms) values(result,source->>'kind',source->>'version',source,p_terms);
  if source ? 'promotion' then
    insert into public.money_snapshot_promotions(snapshot_id,redemption_id,funding,discount,commission_rate_bps,commission_base,commission,platform_subsidy)
      values(result,(source->'promotion'->>'redemption_id')::uuid,source->'promotion'->>'funding',(source->'promotion'->>'discount_cents')::bigint,
        (source->'promotion'->>'commission_rate_bps')::integer,(source->'promotion'->>'commission_base_cents')::bigint,
        (source->'promotion'->>'commission_cents')::bigint,(source->'promotion'->>'platform_subsidy_cents')::bigint);
  end if;
  return result;
end $function$;

-- 5. The split uses the snapshot's rate ---------------------------------------------------------------

-- Restates 20261018005000's definition. Only the ordinary branch changes: the stamped rate replaces
-- the constant 15. The promotional branch (stored commission and subsidy, scaled by the retained
-- share of the snapshot subtotal) is unchanged.
create or replace function private.money_split(p_obligation uuid, p_service bigint)
 returns table(fee bigint, subsidy bigint)
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare s public.money_snapshots; m public.money_snapshot_promotions;
begin
  select sn.* into s from public.money_obligations o join public.money_snapshots sn on sn.id = o.current_snapshot_id where o.id = p_obligation;
  select sp.* into m from public.money_snapshot_promotions sp where sp.snapshot_id = s.id;
  if m.snapshot_id is null then
    fee := round(p_service::numeric * s.commission_rate_bps / 10000); subsidy := 0;
  elsif p_service = s.subtotal then
    fee := m.commission; subsidy := m.platform_subsidy;
  else
    fee := round(m.commission::numeric * p_service / s.subtotal); subsidy := round(m.platform_subsidy::numeric * p_service / s.subtotal);
  end if;
  return next;
end $function$;

-- 6. Promotion economics and usage --------------------------------------------------------------------

-- Restates 20261018003000's definition. The rates come from the policy (so the function becomes
-- stable instead of immutable); the base, rounding and split are unchanged.
create or replace function private.promotion_economics(p_eligible bigint, p_discount bigint, p_funding text)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare rate integer; base bigint; commission bigint; discount bigint := coalesce(p_discount, 0);
begin
  if p_eligible is null or p_eligible <= 0 or discount < 0 or discount >= p_eligible
     or (p_funding is null and discount <> 0) or (p_funding is not null and p_funding not in ('vendor', 'platform')) then
    raise exception 'Invalid promotion amounts' using errcode = '22023';
  end if;
  rate := case when p_funding is null then private.money_standard_commission_bps() else private.money_promotional_commission_bps() end;
  if rate is null then raise exception 'No commission policy is in force' using errcode = '55000'; end if;
  base := case when p_funding = 'vendor' then p_eligible - discount else p_eligible end;
  commission := round(base * rate / 10000.0)::bigint;
  return jsonb_build_object(
    'eligible_cents', p_eligible, 'discount_cents', discount, 'funding', p_funding,
    'homeowner_service_cents', p_eligible - discount,
    'commission_rate_bps', rate, 'commission_base_cents', base, 'commission_cents', commission,
    'vendor_proceeds_cents', base - commission,
    'platform_subsidy_cents', case when p_funding = 'platform' then discount else 0 end);
end $function$;

-- Restates 20261018003000's definition. Relief is measured against the standard rate the
-- redemption's own promotional rate halved (750 against 1500, 500 against 1000), never against
-- today's standard, so historical relief stays what it was.
create or replace function private.promotion_usage(p_offer uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'reserved', count(*) filter (where r.status = 'reserved'),
    'finalized', count(*) filter (where r.status = 'finalized'),
    'released', count(*) filter (where r.status = 'released'),
    'subsidy_committed_cents', coalesce(sum(r.platform_subsidy_cents) filter (where r.status in ('reserved', 'finalized')), 0),
    'vendor_discount_cents', coalesce(sum(r.discount_cents) filter (where r.status in ('reserved', 'finalized') and r.funding = 'vendor'), 0),
    'commission_relief_cents', coalesce(sum(round(r.commission_base_cents * (r.commission_rate_bps * 2) / 10000.0)::bigint - r.commission_cents)
      filter (where r.status in ('reserved', 'finalized')), 0))
  from private.promotion_redemptions r where r.offer_id = p_offer
$function$;

-- 7. A reservation at a superseded rate goes back to the homeowner -----------------------------------

-- Restates 20261018006000's definition. Adds `commission_changed` after `offers_paused`.
create or replace function private.promotion_redemption_problem(p_redemption private.promotion_redemptions, p_request public.service_requests)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select case
    when p_redemption.status = 'finalized' then null
    -- Promotions closed again after opening: the homeowner can still remove the offer.
    when not private.money_gate('promotions_checkout') then 'offers_paused'
    -- DEC-2026-067: reserved under a superseded commission rate; the homeowner applies it again.
    when p_redemption.commission_rate_bps is distinct from private.money_promotional_commission_bps() then 'commission_changed'
    when o.status <> 'approved' or o.content_hash <> p_redemption.offer_hash then 'offer_changed'
    when now() >= o.ends_at then 'expired'
    when p_redemption.first_booking and private.promotion_has_completed_service(p_request.customer_id, p_request.id) then 'not_first_booking'
    when (private.promotion_request_context(p_request, true) ->> 'eligible_cents')::bigint is distinct from p_redemption.eligible_cents then 'price_changed'
    when (private.promotion_request_context(p_request, true) ->> 'contractor_id')::uuid is distinct from p_redemption.contractor_id then 'other_provider'
  end
  from private.promotion_offers o where o.id = p_redemption.offer_id
$function$;

-- Restates 20261018006000's definition. Also releases an unpaid reservation made under a superseded
-- commission rate, with the same locks, re-check and exactly-once update.
create or replace function private.promotion_release_unpaid()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  candidate record;
  x private.promotion_redemptions;
  o public.money_obligations;
  s public.money_snapshots;
  offer private.promotion_offers;
  why text;
  released integer := 0;
  promotional integer := private.money_promotional_commission_bps();
begin
  for candidate in
    select x2.id, x2.service_request_id from private.promotion_redemptions x2
      join private.promotion_offers o2 on o2.id = x2.offer_id
      left join public.money_obligations ob on ob.service_request_id = x2.service_request_id
      left join public.money_snapshots sn on sn.id = ob.current_snapshot_id
     where x2.status = 'reserved'
       and (sn.expires_at <= now() or now() >= o2.ends_at or o2.status <> 'approved' or o2.content_hash <> x2.offer_hash
         or x2.commission_rate_bps is distinct from promotional)
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
      when x.commission_rate_bps is distinct from promotional then 'Commission rate changed before payment'
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
end $function$;

-- 8. Finance reconciliation reports the rates in force ------------------------------------------------

-- Restates 20260923001000's definition. Only the rate keys change: `fee_percent` (read by the
-- deployed admin page) is the current standard instead of the constant 15, and the current
-- standard and promotional rates and their effective time are added. Each obligation's own
-- amounts still come from its snapshot through money_split.
create or replace function public.money_finance_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare at_value timestamptz:=now(); rows jsonb; listed integer:=200;
begin
  perform public.money_require_finance(auth.uid());
  select coalesce(jsonb_agg(x.row order by jsonb_array_length(x.row->'issues')>0 desc,(x.row->>'created_at')::timestamptz desc,x.id),'[]'::jsonb)
    into rows from (select o.id,private.money_obligation_reconciliation(o.id,at_value) row from public.money_obligations o) x;
  return jsonb_build_object(
    'evaluated_at',at_value,
    'fee_percent',round(private.money_standard_commission_bps()::numeric/100,2),
    'standard_commission_bps',private.money_standard_commission_bps(),
    'promotional_commission_bps',private.money_promotional_commission_bps(),
    'commission_effective_at',private.money_commission_effective_at(),
    'obligation_count',jsonb_array_length(rows),
    'listed_limit',listed,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('account',a.account,'debit',a.debit,'credit',a.credit) order by a.account)
      from (select l->>'account' account,sum((l->>'debit')::bigint)::bigint debit,sum((l->>'credit')::bigint)::bigint credit
        from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l group by 1) a),'[]'::jsonb),
    'totals',jsonb_build_object(
      'captured',(select coalesce(sum((v->'charges'->>'captured')::bigint),0) from jsonb_array_elements(rows) v),
      'refunded',(select coalesce(sum((v->'refunds'->>'service')::bigint+(v->'refunds'->>'tax')::bigint+(v->'refunds'->>'tip')::bigint),0) from jsonb_array_elements(rows) v),
      'platform_fee',(select coalesce(sum((v->'earnings'->>'platform_fee_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'tax',(select coalesce(sum((v->'earnings'->>'tax_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_payable',(select coalesce(sum((v->'payout'->>'payable_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'paid_out',(select coalesce(sum((v->'payout'->>'paid')::bigint-(v->'payout'->>'returned')::bigint),0) from jsonb_array_elements(rows) v),
      'processor_costs',(select coalesce(sum((v->>'processor_costs')::bigint),0) from jsonb_array_elements(rows) v),
      'chargeback_suspense',(select coalesce(sum((v->'chargebacks'->>'suspense_ledger')::bigint),0) from jsonb_array_elements(rows) v),
      'provider_owed',(select coalesce(sum((v->'payout'->'recovery'->>'owed')::bigint),0) from jsonb_array_elements(rows) v),
      'customer_refunds_owed',(select coalesce(sum((v->'refunds'->>'customer_owed')::bigint),0) from jsonb_array_elements(rows) v),
      'repayments_returnable',(select coalesce(sum((v->'payout'->'recovery'->>'repayment_returnable')::bigint),0) from jsonb_array_elements(rows) v),
      'with_issues',(select count(*) from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0)),
    'global_event_holds',private.money_unprocessed_events(null),
    'exceptions',coalesce((select jsonb_agg(e.item order by e.since,e.kind,e.reference) from (
      select 'ledger_mismatch' kind,v->>'obligation_id' reference,(v->>'created_at')::timestamptz since,
        jsonb_build_object('kind','ledger_mismatch','obligation_id',v->>'obligation_id','invoice_number',v->>'invoice_number','codes',v->'issues','since',v->>'created_at') item
        from jsonb_array_elements(rows) v where jsonb_array_length(v->'issues')>0
      union all
      select 'provider_event',e.event_id,e.received_at,jsonb_build_object('kind','provider_event','event_id',e.event_id,'event_type',e.event_type,
        'status',e.status,'attempts',e.attempt_count,'error_code',e.last_error,'holds_all_payouts',e.event_type='reconciliation_required',
        'obligation_id',(select a.obligation_id from public.money_checkout_attempts a
          where a.id::text=e.payload->>'attempt_id' or a.stripe_payment_id=e.payload->>'payment_id' limit 1),
        'since',e.received_at)
        from public.money_webhook_events e where e.status<>'processed'
          and not exists(select 1 from public.money_event_exclusions x where x.event_id=e.event_id)
      union all
      select 'checkout_reconcile',a.id::text,a.created_at,jsonb_build_object('kind','checkout_reconcile','obligation_id',a.obligation_id,
        'attempt_id',a.id,'mode',a.mode,'amount',a.amount,'error_code',a.failure_code,'since',a.created_at)
        from public.money_checkout_attempts a where a.status='reconcile'
      union all
      select 'refund_pending',a.id::text,a.created_at,jsonb_build_object('kind','refund_pending','obligation_id',a.obligation_id,
        'authorization_id',a.id,'payment_id',a.payment_id,'amount',a.service+a.tax+a.tip,
        'attempt_status',coalesce((select t.status from public.money_refund_attempts t where t.authorization_id=a.id),'not_started'),'since',a.created_at)
        from public.money_refund_authorizations a where not exists(select 1 from public.money_refunds f where f.authorization_id=a.id)
          and not exists(select 1 from public.money_refund_releases z where z.authorization_id=a.id)
      union all
      select 'reconciliation_open',o.id::text,coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at),
        jsonb_build_object('kind','reconciliation_open','obligation_id',o.id,
          'since',coalesce((select max(created_at) from public.money_reconciliation where obligation_id=o.id),o.created_at))
        from public.money_obligations o where o.reconciliation_open
      union all
      select 'chargeback',d.provider_id,d.created_at,jsonb_build_object('kind','chargeback','obligation_id',d.obligation_id,'dispute_id',d.provider_id,
        'payment_id',d.payment_id,'amount',d.amount,'status',d.status,'since',d.created_at)
        from public.money_disputes d where d.status='open' or (d.status='lost'
          and not exists(select 1 from public.money_chargeback_resolutions x where x.dispute_id=d.provider_id))
      union all
      select 'payout_hold',h.id::text,h.created_at,jsonb_build_object('kind','payout_hold','obligation_id',h.obligation_id,'hold_id',h.id,'since',h.created_at)
        from public.money_holds h where not exists(select 1 from public.money_hold_resolutions x where x.hold_id=h.id)
      union all
      select 'provider_owes',x.obligation_id,x.since,jsonb_build_object('kind','provider_owes','obligation_id',x.obligation_id,
        'invoice_number',x.invoice_number,'payee_name',x.payee_name,'amount',x.owed,'since',x.since)
        from (select v->>'obligation_id' obligation_id,v->>'invoice_number' invoice_number,v->'payee'->>'name' payee_name,
            (v->'payout'->'recovery'->>'owed')::bigint owed,
            (select max(j.created_at) from public.money_journals j where j.obligation_id=(v->>'obligation_id')::uuid) since
          from jsonb_array_elements(rows) v) x where x.owed>0
      union all
      select 'customer_refund_owed',f.failed_reference,f.created_at,jsonb_build_object('kind','customer_refund_owed','obligation_id',f.obligation_id,
        'authorization_id',f.authorization_id,'failed_reference',f.failed_reference,'amount',f.amount,'since',f.created_at)
        from public.money_refund_late_failures f
        where not exists(select 1 from public.money_refund_resettlements x where x.failed_reference=f.failed_reference)
          and not exists(select 1 from public.money_refund_releases z where z.authorization_id=f.authorization_id)
      union all
      -- A delivered refund that a readback or Stripe event shows failed, not yet recorded.
      select 'refund_failed_late',a.id::text,a.created_at,jsonb_build_object('kind','refund_failed_late','obligation_id',a.obligation_id,
        'authorization_id',a.id,'amount',a.service+a.tax+a.tip,
        'source',case when private.money_refund_late_failure_readback(a.id) is not null then 'readback' else 'stripe_event' end,'since',a.created_at)
        from public.money_refund_authorizations a
        where exists(select 1 from public.money_refunds f where f.authorization_id=a.id) and private.money_refund_delivered(a.id)
          and (private.money_refund_late_failure_readback(a.id) is not null or private.money_refund_late_signal(a.id) is not null)
      union all
      select 'repayment_returnable',x.obligation_id,x.since,jsonb_build_object('kind','repayment_returnable','obligation_id',x.obligation_id,
        'invoice_number',x.invoice_number,'payee_name',x.payee_name,'amount',x.returnable,'since',x.since)
        from (select v->>'obligation_id' obligation_id,v->>'invoice_number' invoice_number,v->'payee'->>'name' payee_name,
            (v->'payout'->'recovery'->>'repayment_returnable')::bigint returnable,
            (select max(j.created_at) from public.money_journals j where j.obligation_id=(v->>'obligation_id')::uuid) since
          from jsonb_array_elements(rows) v) x where x.returnable>0
      union all
      select 'bank_outcome',a.id::text,a.created_at,jsonb_build_object('kind','bank_outcome','obligation_id',i.obligation_id,'item_id',i.id,
        'attempt_number',a.attempt_number,'amount',i.amount,'status',a.status,'since',a.created_at)
        from public.money_ach_items i join lateral (select * from public.money_ach_attempts t where t.item_id=i.id order by t.attempt_number desc limit 1) a on true
        where a.status in ('unknown','failed','returned')
      union all
      select 'bank_line',s.line_id::text,l.created_at,jsonb_build_object('kind','bank_line','line_id',s.line_id,'statement_id',l.statement_id,
        'period_start',to_char(b.period_start,'YYYY-MM-DD'),'period_end',to_char(b.period_end,'YYYY-MM-DD'),'line_number',l.line_number,
        'direction',l.direction,'amount',l.amount,'state',s.state,
        'obligation_id',(select m.obligation_id from private.money_bank_movements() m where m.movement=s.movement),'since',l.created_at)
        from private.money_bank_line_states() s join public.money_bank_statement_lines l on l.id=s.line_id
        join public.money_bank_statements b on b.id=l.statement_id
        where s.state in ('unmatched','amount_mismatch')
      union all
      -- A recorded movement with no line, on a business day some imported statement period covers or
      -- that falls between two of them. Later movements wait for the next statement.
      select 'bank_unevidenced',u.movement,u.recorded_at,jsonb_build_object('kind','bank_unevidenced','movement',u.movement,
        'movement_kind',u.kind,'obligation_id',u.obligation_id,'direction',u.direction,'amount',u.amount,'since',u.recorded_at)
        from private.money_bank_unevidenced() u
        where private.money_bank_day(u.recorded_at) between (select min(period_start) from public.money_bank_statements)
          and (select max(period_end) from public.money_bank_statements)
    ) e),'[]'::jsonb),
    'obligations',coalesce((select jsonb_agg(l.v order by l.n) from (select v,n from jsonb_array_elements(rows) with ordinality x(v,n) order by n limit listed) l),'[]'::jsonb));
end $function$;
