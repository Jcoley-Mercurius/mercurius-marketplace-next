-- Phase 6 corrective slice CS-3 (TRACE-126; DEC-2026-060 D-1 (a); R-1 confirmed by the owner,
-- DEC-2026-062; plan R-2, R-4, R-5). A one-time fixed request whose accepted package and level are
-- the ones priced at submission (pricing_inputs, pricing-v2) is accepted and checked out at that
-- bound level and price after an ordinary catalog revision, while its provider still offers that
-- service at that cadence through a live revision of the same offering that is not held in Package
-- Reviews. Price, level, questions and add-ons come from the bound rows; nothing is repriced or
-- substituted. Pausing, archiving or removing the offering, holding its live revision in Package
-- Reviews, and the provider, service, coverage, provider-ZIP and answer refusals still block.
--
-- Not changed: one-time requests offered or accepted at any other package or level (another
-- provider, or a newer revision), which keep the earlier check (plan R-3 is open); requests without
-- a pricing-v2 record; quotes; promotions (refusals, allocation and the closed gate); recurring
-- visits (CS-4); fees, tax, tips, capture, payout and refunds; published snapshots and checkout.
--
-- Lock order on the bound one-time path (acceptance, preview, publication, checkout), as CS-4's:
--   request advisory lock -> service_requests row (FOR UPDATE) -> package_promotions table SHARE
--   (money_source only; qualifying questions are not table-locked on this path) -> provider row ->
--   bound tier -> bound package -> the lineage's live revision -> the bound package's questions
--   (and add-ons, money_source) -> services_catalog -> coverage_areas -> provider ZIP, each FOR SHARE.
--
-- Evidence (R-4): the bound path's source is built from immutable bound fields and versioned
-- commercial-v2; every other path keeps commercial-v1 byte-identical.
--
-- Additive: one new private helper; two functions restated with unchanged signatures and grants.
-- No table, column, grant or data change.

-- 1. Is a one-time request at the terms bound at its submission still acceptable and payable? ----
-- Null when it is; else a named code. The bound record is pricing_inputs (pricing-v2, exact), which
-- names the package, level, revision hash and total priced at submission; since 6.11A those rows are
-- immutable once in use, and the recorded revision hash is validated, not trusted. Live checks are
-- those money_source applied before (provider, service, coverage, provider ZIP, level answers,
-- required answers), with "package offered" read per R-1 (DEC-2026-062) through
-- bound_offering_problem. With an offer (acceptance), the offer must be the bound package and level
-- at the bound prices. No amount is computed or substituted here.
create function private.one_time_bound_problem(r public.service_requests, offer public.job_match_attempts)
returns text language plpgsql stable security definer set search_path = '' as $$
declare pi jsonb := r.pricing_inputs; p public.vendor_packages; t public.package_tiers; code text;
  level_cents bigint; total_cents bigint;
begin
  if r.id is null or r.recurrence_parent_id is not null then raise exception 'One-time request required'; end if;
  if r.pricing_mode is distinct from 'fixed' or r.quote_only is true or r.current_quote_id is not null or r.quote_status is not null then
    return 'quote_terms';
  end if;
  if pi->>'version' is distinct from 'pricing-v2' or pi->>'status' is distinct from 'exact' or pi->>'package_id' is null
    or nullif(pi->>'tier_id', '') is null or pi->>'package_revision' is null or jsonb_typeof(pi->'total_cents') is distinct from 'number'
    or jsonb_typeof(pi#>'{lines,0,amount_cents}') is distinct from 'number' then
    return 'terms_missing';
  end if;
  level_cents := (pi#>>'{lines,0,amount_cents}')::bigint;
  total_cents := (pi->>'total_cents')::bigint;
  if offer.id is not null and (offer.offer_path is distinct from 'fixed' or offer.contractor_id is distinct from r.contractor_id
    or offer.package_id::text is distinct from pi->>'package_id' or offer.package_tier_id::text is distinct from pi->>'tier_id'
    or offer.base_price is null or offer.base_price * 100 is distinct from level_cents
    or offer.effective_price is null or offer.effective_price * 100 is distinct from total_cents) then
    return 'offer_mismatch';
  end if;
  select * into p from public.vendor_packages where id = (pi->>'package_id')::uuid;
  select * into t from public.package_tiers where id = (pi->>'tier_id')::uuid;
  if p.id is null or t.id is null then return 'package_unavailable'; end if;
  if r.package_id is distinct from p.id or r.package_tier_id is distinct from t.id or r.contractor_id is distinct from p.contractor_id
    or r.frequency is distinct from pi->>'frequency' or private.package_revision_hash(p.id) is distinct from pi->>'package_revision'
    or t.price is null or t.price * 100 is distinct from level_cents or level_cents <= 0 or total_cents < level_cents
    or (r.promotion_id is null and (r.total_amount is null or r.total_amount * 100 is distinct from total_cents)) then
    return 'terms_inconsistent';
  end if;
  -- Live eligibility: refused, never substituted.
  code := case
    when not exists(select 1 from public.contractors c where c.id = r.contractor_id and c.is_active and c.marketing_enabled) then 'provider_inactive'
    when not exists(select 1 from public.services_catalog c where c.id = r.service_catalog_id and c.is_active) then 'service_inactive'
    when not exists(select 1 from public.coverage_areas c where c.zip_code = r.zip_code and c.is_active) then 'coverage_inactive'
    when not exists(select 1 from public.contractor_service_zips z where z.contractor_id = r.contractor_id and z.zip_code = r.zip_code) then 'provider_zip'
    else private.bound_offering_problem(p.id, t.id, r.frequency, r.contractor_id, r.service_catalog_id)
  end;
  if code is not null then return code; end if;
  -- The bound level's conditions and the bound package's required questions, as before.
  if t.rule_question_key is not null then
    if coalesce(r.package_question_answers->t.rule_question_key->>'answer','') !~ '^-?[0-9]+([.][0-9]+)?$'
      or (t.rule_min is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric < t.rule_min)
      or (t.rule_max is not null and (r.package_question_answers->t.rule_question_key->>'answer')::numeric > t.rule_max) then
      return 'answers_mismatch';
    end if;
  end if;
  if private.pricing_tier_matches(private.pricing_tier_json(t), r.package_question_answers) is not true then
    return 'answers_mismatch';
  end if;
  if exists(select 1 from public.package_qualifying_questions x where x.package_id = p.id and x.is_required
    and nullif(btrim(r.package_question_answers->x.question_key->>'answer'),'') is null) then
    return 'answers_missing';
  end if;
  return null;
end $$;
revoke all on function private.one_time_bound_problem(public.service_requests, public.job_match_attempts) from public, anon, authenticated, service_role;

-- 2. Commercial source: the bound one-time path ----------------------------------------------
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
  -- CS-4/CS-3: a recurring visit and a bound one-time request take no table lock on qualifying
  -- questions (a package save writes them after locking its package; bound rows are immutable and
  -- share-locked below). Other paths keep both table locks.
  if r.recurrence_parent_id is not null or bound then
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
    else
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
  return evidence||jsonb_build_object('version',case when bound then 'commercial-v2:' else 'commercial-v1:' end
    ||encode(sha256(convert_to(evidence::text,'UTF8')),'hex'));
end $function$
;

-- 3. Acceptance: the bound one-time path -------------------------------------------------------
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
