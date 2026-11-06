-- Phase 6 corrective slice CS-4 (TRACE-127; DEC-2026-060 D-2 (a); R-1 confirmed by the owner,
-- DEC-2026-062). A recurring visit offered or accepted at the plan terms bound to its creation stays
-- acceptable and payable at those terms after an ordinary catalog revision, while its provider still
-- offers that service at that cadence through a live revision of the same offering that is not held in
-- Package Reviews. Price, level, questions and add-ons always come from the bound terms; nothing is
-- repriced or substituted. Pausing, archiving or removing the offering, or holding its live revision in
-- Package Reviews, still blocks. Provider, service, coverage and provider-ZIP refusals, quote-priced and
-- promotional visits (DEC-2026-049 item 7), replacement providers (item 8) and new-visit changed-terms
-- safeguards are unchanged. One-time requests and quotes are unchanged (CS-3).
--
-- Lock order for every reader of a visit's bound terms (acceptance, preview, publication, checkout):
--   request advisory lock -> service_requests row (FOR UPDATE, by the caller or vendor_accept_job)
--   -> package_promotions table SHARE (money_source visit path only; qualifying questions are not
--   locked on this path) -> accepted offer row (FOR SHARE) -> provider row -> bound tier -> bound
--   package -> the lineage's live revision -> services_catalog -> coverage_areas -> provider ZIP,
--   each FOR SHARE. Package writers lock the provider row before package rows (vendor_save_package,
--   vendor_set_package_active, admin_publish_package_draft) or a single package row only
--   (admin_suspend_package, admin_archive_package, admin_clear_package_review), so no cycle forms.
--
-- Additive: two new private helpers; four functions restated with unchanged signatures and grants.
-- No table, column, grant or data change.

-- 1. Is the offering bound to these terms still offered? ------------------------------------------
-- Null when it is; else 'package_in_review' or 'package_unavailable'. The bound package and level
-- (immutable once in use, TRACE-134) must be structurally intact; the offering's live revision must
-- belong to the same provider and service, be fixed-price, not archived, not held in Package Reviews,
-- and still offer a priced level at the cadence. The live revision's prices are never read as the
-- visit's price.
create function private.bound_offering_problem(p_package uuid, p_tier uuid, p_frequency text, p_contractor uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare p public.vendor_packages; t public.package_tiers; live public.vendor_packages;
begin
  select * into p from public.vendor_packages where id = p_package;
  select * into t from public.package_tiers where id = p_tier;
  if p.id is null or t.id is null or t.package_id <> p.id or p.contractor_id is distinct from p_contractor
    or p.service_id is distinct from p_service or p.pricing_mode is distinct from 'fixed'
    or t.frequency is distinct from p_frequency or t.price is null or t.price <= 0
    or coalesce(t.price_kind, 'exact') <> 'exact' or private.package_archived(p.id) then
    return 'package_unavailable';
  end if;
  select * into live from public.vendor_packages v
    where v.is_active and (v.lineage_id = coalesce(p.lineage_id, p.id) or v.id = p.id)
    order by (v.id = p.id) desc limit 1;
  if live.id is null then
    return case when p.needs_review is true then 'package_in_review' else 'package_unavailable' end;
  end if;
  if live.needs_review is true then return 'package_in_review'; end if;
  if live.contractor_id is distinct from p_contractor or live.service_id is distinct from p_service
    or live.pricing_mode is distinct from 'fixed' or private.package_archived(live.id)
    or not exists(select 1 from public.package_tiers x where x.package_id = live.id and x.frequency = p_frequency and x.price > 0
      and coalesce(x.price_kind, 'exact') = 'exact')
    or exists(select 1 from public.package_tiers x where x.package_id = live.id and (x.price is null or x.price <= 0)) then
    return 'package_unavailable';
  end if;
  return null;
end $$;
revoke all on function private.bound_offering_problem(uuid, uuid, text, uuid, text) from public, anon, authenticated, service_role;

-- 2. One rule set for a visit's terms against an offer ------------------------------------------------
-- The checks recurring_visit_source_check made (moved here unchanged except the offering check), so
-- that a pending offer (acceptance) and the accepted offer (payment) are judged by the same rule. Null
-- when the visit may proceed at its bound terms; else the exception code.
create function private.recurring_visit_offer_problem(r public.service_requests, offer public.job_match_attempts)
returns text language plpgsql stable security definer set search_path = '' as $$
declare t private.recurring_series_terms; code text; price bigint; total bigint; addon_cents bigint;
begin
  if r.id is null or r.recurrence_parent_id is null then raise exception 'Recurring visit required'; end if;
  t := private.recurring_visit_terms(r.id);
  code := case
    when t.id is null then 'terms_missing'
    -- DEC-2026-049 item 7 (not decided): quoted and promotional plan visits stay unpayable.
    when t.pricing_mode is distinct from 'fixed' or r.pricing_mode is distinct from 'fixed' or r.quote_only is true
      or r.current_quote_id is not null or r.quote_status is not null then 'quote_terms'
    when r.promotion_id is not null
      or exists(select 1 from private.promotion_redemptions x where x.service_request_id = r.id and x.status in ('reserved', 'finalized'))
      or exists(select 1 from private.promotion_selections x where x.service_request_id = r.id)
      or exists(select 1 from public.package_promotions x where x.package_id = t.package_id and x.is_enabled
        and x.starts_at <= now() and x.ends_at > now()) then 'promotion_decision'
    -- DEC-2026-049 item 8 (not decided): only the plan provider's own acceptance is supported.
    when r.contractor_id is distinct from t.contractor_id or offer.contractor_id is distinct from t.contractor_id then 'replacement_provider'
    when offer.id is null or offer.package_id is distinct from t.package_id or offer.package_tier_id is distinct from t.package_tier_id
      or offer.base_price is distinct from t.visit_price or offer.effective_price is distinct from t.visit_total then 'offer_mismatch'
    when r.customer_id is distinct from t.customer_id or r.package_id is distinct from t.package_id
      or r.package_tier_id is distinct from t.package_tier_id or r.frequency is distinct from t.frequency
      or row(r.address, r.city, r.state, r.zip_code, r.service_catalog_id) is distinct from row(t.address, t.city, t.state, t.zip_code, t.service_catalog_id)
      or r.package_question_answers is distinct from t.package_question_answers or r.pricing_inputs is distinct from t.pricing_inputs
      or t.visit_price is null or t.visit_total is null or t.visit_price <= 0 or t.visit_total < t.visit_price
      or t.visit_price * 100 <> trunc(t.visit_price * 100) or t.visit_total * 100 <> trunc(t.visit_total * 100) then 'terms_inconsistent'
    -- Live eligibility: refused, never substituted.
    when not exists(select 1 from public.contractors c where c.id = t.contractor_id and c.is_active and c.marketing_enabled) then 'provider_inactive'
    when not exists(select 1 from public.services_catalog c where c.id = t.service_catalog_id and c.is_active) then 'service_inactive'
    when not exists(select 1 from public.coverage_areas c where c.zip_code = r.zip_code and c.is_active) then 'coverage_inactive'
    when not exists(select 1 from public.contractor_service_zips z where z.contractor_id = t.contractor_id and z.zip_code = r.zip_code) then 'provider_zip'
    -- CS-4 (R-1): the offering is still offered; the bound rows themselves need not be live.
    else private.bound_offering_problem(t.package_id, t.package_tier_id, t.frequency, t.contractor_id, t.service_catalog_id)
  end;
  if code is null then
    price := private.money_minor_units(t.visit_price);
    total := private.money_minor_units(t.visit_total);
    addon_cents := total - price;
    if t.pricing_inputs is null then
      if addon_cents <> 0 then code := 'terms_inconsistent'; end if;
    elsif t.pricing_inputs->>'version' is distinct from 'pricing-v2' or t.pricing_inputs->>'status' is distinct from 'exact'
      or (t.pricing_inputs->>'total_cents')::bigint is distinct from total
      or (select coalesce(sum((l->>'amount_cents')::bigint), 0) from jsonb_array_elements(coalesce(t.pricing_inputs->'lines', '[]'::jsonb)) l
          where l->>'kind' = 'addon') is distinct from addon_cents then
      code := 'terms_inconsistent';
    end if;
  end if;
  return code;
end $$;
revoke all on function private.recurring_visit_offer_problem(public.service_requests, public.job_match_attempts) from public, anon, authenticated, service_role;

-- 3. Restated from 20261027001000: the rule set moved into recurring_visit_offer_problem; the output
-- (and so every visit source hash) is unchanged for a visit whose check passed before.
CREATE OR REPLACE FUNCTION private.recurring_visit_source_check(r service_requests)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t private.recurring_series_terms; offer public.job_match_attempts; code text; price bigint; total bigint; addon_cents bigint;
begin
  if r.id is null or r.recurrence_parent_id is null then raise exception 'Recurring visit required'; end if;
  t := private.recurring_visit_terms(r.id);
  select a.* into offer from public.job_match_attempts a
    where a.service_request_id = r.id and a.outcome = 'accepted'
    order by a.accepted_at desc nulls last, a.attempt_number desc limit 1;
  code := private.recurring_visit_offer_problem(r, offer);
  if code is null then
    price := private.money_minor_units(t.visit_price);
    total := private.money_minor_units(t.visit_total);
    addon_cents := total - price;
  end if;
  if code is not null then
    return jsonb_build_object('ok', false, 'code', code, 'problem', private.recurring_visit_payment_problem(code));
  end if;
  return jsonb_build_object('ok', true, 'service_cents', price, 'addon_cents', addon_cents,
    'terms', jsonb_build_object('terms_id', t.id, 'series', t.series_id, 'accepted_offer', t.accepted_offer_id,
      'contractor', t.contractor_id, 'package', t.package_id, 'tier', t.package_tier_id, 'package_revision', t.package_revision,
      'frequency', t.frequency, 'visit_price_cents', price, 'visit_total_cents', total, 'pricing', t.pricing_inputs,
      'accepted_at', t.accepted_at),
    'visit_offer', jsonb_build_object('id', offer.id, 'base_price_cents', private.money_minor_units(offer.base_price),
      'effective_price_cents', private.money_minor_units(offer.effective_price)));
end $function$;

-- 4. Restated from 20261027001000 (TRACE-125). CS-4 changes only the visit path's locks (see the
-- header); the visit evidence and every one-time and quote path are unchanged.
CREATE OR REPLACE FUNCTION private.money_source(p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
  priced jsonb; addon_cents bigint := 0; wanted jsonb; promo private.promotion_redemptions; offer private.promotion_offers;
  choice private.promotion_selections; visit_check jsonb;
begin
  select * into strict r from public.service_requests where id=p_request;
  -- CS-4: a recurring visit reads no qualifying-question rows, so its path takes no table lock on them
  -- (a package save writes them after locking its package). Other paths keep both table locks.
  if r.recurrence_parent_id is not null then
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
end $function$;

-- 5. Restated from 20261102001000. CS-4 changes only how a recurring visit with bound terms is judged
-- before acceptance; plans, one-time requests, legacy visits without bound terms and the replacement
-- path keep the find_eligible_packages_core check. Expiry, actionability, the advisory lock, the writes
-- and the notices are unchanged.
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
  replacement := r.recurrence_parent_id IS NULL AND private.provider_withdrawal_open(r);

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
$function$;
