-- Phase 6.6c / TRACE-125: recurring visit payment timing, accepted-price integrity and payment
-- exceptions (DEC-2026-049 items 5–6, owner decision 2026-10-27; items 7–8 stay blocked).
--
-- A visit's commercial source is the immutable plan terms bound to that visit's creation (the
-- `created` row of recurring_visit_generations), checked against the visit's own accepted offer:
-- later package, tier, add-on or question edits change neither the amount nor the source hash, so
-- a published visit snapshot stays payable at the agreed amount. Live eligibility refusals
-- (provider, service, coverage, provider ZIP, package offered and not under review) still block,
-- with a named exception and recovery; nothing is substituted or repriced. One-time requests and
-- quotes keep the money_source path unchanged (the DEC-2026-034 exposure there is a separate
-- corrective issue).
--
-- Nothing here publishes a snapshot, creates an obligation, invoice or checkout attempt, charges,
-- cancels, notifies or schedules. Publication stays the two-person finance process; payment stays
-- the homeowner's explicit checkout. The payment-exception classification of DEC-2026-045 G6 moves
-- into one shared read used by the quote queue (unchanged output) and the recurring payment queue.

-- 1. The accepted terms bound to a visit's creation --------------------------------------------

-- Never the plan's latest acceptance: the terms row recorded on the generation that created the
-- visit. No row (a null record) when the visit has none.
create function private.recurring_visit_terms(p_visit uuid) returns private.recurring_series_terms
language sql stable security definer set search_path = '' as $$
  select t.* from private.recurring_visit_generations g
    join public.service_requests v on v.id = g.occurrence_id and v.recurrence_parent_id = g.series_id
    join private.recurring_series_terms t on t.id = g.terms_id and t.series_id = g.series_id
   where g.occurrence_id = p_visit and g.outcome = 'created'
$$;
revoke all on function private.recurring_visit_terms(uuid) from public, anon, authenticated, service_role;

-- What operations reads for each exception: what is wrong and what recovery it needs.
create function private.recurring_visit_payment_problem(p_code text) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_code is null then null else jsonb_build_object('code', p_code) || case p_code
    when 'terms_missing' then jsonb_build_object(
      'message', 'No accepted plan terms are bound to this visit''s creation.',
      'recovery', 'It can''t be paid on any other terms. Handle the visit individually (cancel it under the per-visit policy); a new visit needs the plan accepted again.')
    when 'terms_inconsistent' then jsonb_build_object(
      'message', 'This visit''s price level, property, answers or add-ons no longer match the plan terms it was created from.',
      'recovery', 'Nothing is substituted. Restore the visit''s recorded details, or handle the visit individually and add a new one.')
    when 'offer_mismatch' then jsonb_build_object(
      'message', 'The provider''s acceptance of this visit doesn''t match the plan terms (price, package or price level).',
      'recovery', 'The visit can''t be paid at another price. Handle it individually and add a new visit on the plan terms.')
    when 'replacement_provider' then jsonb_build_object(
      'message', 'This visit is assigned to a provider other than the plan''s provider. Paying a replacement provider for a visit isn''t set up.',
      'recovery', 'Keep the visit unpaid and handle it individually; only the plan provider''s accepted visits can be paid.')
    when 'quote_terms' then jsonb_build_object(
      'message', 'This visit is priced by quote. Paying quoted plan visits isn''t set up.',
      'recovery', 'Handle the visit individually; no quote is applied to it.')
    when 'promotion_decision' then jsonb_build_object(
      'message', 'A promotion is attached to this visit or its package. Promotions on plan visits aren''t set up.',
      'recovery', 'End the package promotion or handle the visit individually; the price is not changed.')
    when 'provider_inactive' then jsonb_build_object(
      'message', 'The plan''s provider isn''t active or listed.',
      'recovery', 'Resolve the provider''s status. The visit keeps its accepted price; no other provider is used.')
    when 'service_inactive' then jsonb_build_object(
      'message', 'This service isn''t active in the catalog.',
      'recovery', 'Reactivate the service or handle the visit individually.')
    when 'coverage_inactive' then jsonb_build_object(
      'message', 'The visit''s ZIP code isn''t an active service area.',
      'recovery', 'Restore the service area or handle the visit individually.')
    when 'provider_zip' then jsonb_build_object(
      'message', 'The plan''s provider no longer serves the visit''s ZIP code.',
      'recovery', 'Restore the provider''s service area or handle the visit individually; no other provider is used.')
    when 'package_in_review' then jsonb_build_object(
      'message', 'The plan''s package is held in Package Reviews.',
      'recovery', 'Approve or correct it in Package Reviews. The visit keeps its accepted price.')
    when 'package_unavailable' then jsonb_build_object(
      'message', 'The plan''s package or price level is no longer offered (paused, replaced or removed).',
      'recovery', 'Restore the package, or handle the visit individually; new terms need the plan accepted again.')
    else jsonb_build_object('message', 'This visit can''t be paid yet.', 'recovery', 'Review the visit.') end end
$$;
revoke all on function private.recurring_visit_payment_problem(text) from public, anon, authenticated, service_role;

-- 2. One commercial-source check for a visit ----------------------------------------------------

-- The single rule set for a visit's source. money_source takes its locks and calls it; the
-- readback and queue call it without locks (money_source itself locks tables, which a stable read
-- cannot). Price comes from the bound terms only; the current tier and add-on prices are never read.
create function private.recurring_visit_source_check(r public.service_requests) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t private.recurring_series_terms; offer public.job_match_attempts; p public.vendor_packages;
  tier public.package_tiers; code text; price bigint; total bigint; addon_cents bigint;
begin
  if r.id is null or r.recurrence_parent_id is null then raise exception 'Recurring visit required'; end if;
  t := private.recurring_visit_terms(r.id);
  select a.* into offer from public.job_match_attempts a
    where a.service_request_id = r.id and a.outcome = 'accepted'
    order by a.accepted_at desc nulls last, a.attempt_number desc limit 1;
  select * into p from public.vendor_packages where id = t.package_id;
  select * into tier from public.package_tiers where id = t.package_tier_id;
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
    when p.needs_review is true then 'package_in_review'
    when p.id is null or tier.id is null or tier.package_id <> p.id or p.contractor_id <> t.contractor_id
      or p.service_id is distinct from t.service_catalog_id or p.pricing_mode <> 'fixed' or not p.is_active
      or tier.frequency is distinct from t.frequency
      or not exists(select 1 from public.resolve_package_tier_price(p.id, tier.id)) then 'package_unavailable'
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
end $$;
revoke all on function private.recurring_visit_source_check(public.service_requests) from public, anon, authenticated, service_role;

-- 3. Checkout source ------------------------------------------------------------------------------

-- Restates 20261018006000 (TRACE-112/114/116). TRACE-125 adds the recurring visit branch; the
-- one-time and quote paths below it are unchanged.
create or replace function private.money_source(p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.service_requests; q public.request_quotes; p public.vendor_packages;
  t public.package_tiers; evidence jsonb; request_context jsonb; price bigint; questions jsonb;
  priced jsonb; addon_cents bigint := 0; wanted jsonb; promo private.promotion_redemptions; offer private.promotion_offers;
  choice private.promotion_selections; visit_check jsonb;
begin
  lock table public.package_promotions,public.package_qualifying_questions in share mode;
  select * into strict r from public.service_requests where id=p_request;
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
    -- Tier before package: a tier edit locks its tier and then (review trigger) its package.
    perform 1 from public.package_tiers where id=r.package_tier_id for share;
    perform 1 from public.vendor_packages where id=r.package_id for share;
    perform 1 from public.contractors where id=r.contractor_id for share;
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
end $$;



-- 4. Payment exceptions: one classification -----------------------------------------------------

-- DEC-2026-045 G6, moved out of admin_quote_queue so that every queue and readback uses the same
-- rule. Unchanged except one tie-break: attempts created at the same instant (one transaction) are
-- ordered by attempt_number, so "latest" never depends on random ids. For each obligation's latest checkout attempt: a confirmed failure is a session
-- the payment webhook recorded as expired while unpaid (aged 24 hours after the webhook); an
-- unresolved outcome is an attempt in reconcile, an open reconciliation flag, or a session past its
-- expiry with no recorded result. A browser return is never a result.
create function private.money_payment_exceptions(p_at timestamptz)
returns table(obligation_id uuid, request_id uuid, kind text, since timestamptz, due_at timestamptz, detail jsonb)
language sql stable security definer set search_path = '' as $$
  select o.id, o.service_request_id,
    case when a.status = 'expired' then 'payment_failed' else 'payment_unresolved' end,
    case when a.status = 'expired' then coalesce((select min(e.received_at) from public.money_webhook_events e
        where e.event_type = 'checkout_expired' and e.payload ->> 'attempt_id' = a.id::text), a.expires_at)
      else least(a.expires_at, a.created_at) end,
    case when a.status = 'expired' then coalesce((select min(e.received_at) from public.money_webhook_events e
        where e.event_type = 'checkout_expired' and e.payload ->> 'attempt_id' = a.id::text), a.expires_at) + interval '24 hours' end,
    jsonb_build_object('attempt_id', a.id, 'attempt_status', a.status, 'failure_code', a.failure_code, 'amount_cents', a.amount,
      'reconciliation_open', o.reconciliation_open)
  from public.money_obligations o
  join lateral (select * from public.money_checkout_attempts x where x.obligation_id = o.id
    order by x.created_at desc, x.attempt_number desc, x.id desc limit 1) a on true
  left join public.money_snapshots s on s.id = o.current_snapshot_id
  where (a.status = 'expired' and o.captured < coalesce(s.total, a.amount + o.captured))
    or a.status = 'reconcile' or o.reconciliation_open
    or (a.status in ('prepared', 'session_created') and a.expires_at <= p_at)
$$;
revoke all on function private.money_payment_exceptions(timestamptz) from public, anon, authenticated, service_role;

-- 5. A visit's payment state ----------------------------------------------------------------------

-- Canonical obligation, snapshot and checkout state; legacy invoices are not read. `action` is
-- 'pay' only for a current, unexpired, unpaid snapshot of a visit whose source still checks out and
-- whose homeowner can check out; 'continue' only for this obligation's own open checkout session
-- (money_prepare_checkout returns that same attempt). Nothing here prepares a checkout.
create function private.recurring_visit_payment(v public.service_requests, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; s public.money_snapshots; a public.money_checkout_attempts;
  x_kind text; x_since timestamptz; x_due timestamptz; x_detail jsonb;
  t private.recurring_series_terms; source_check jsonb; accepted timestamptz; state text; reason text; action text;
begin
  t := private.recurring_visit_terms(v.id);
  select max(coalesce(m.accepted_at, m.responded_at)) into accepted from public.job_match_attempts m
    where m.service_request_id = v.id and m.outcome = 'accepted';
  select * into o from public.money_obligations where service_request_id = v.id;
  if o.id is not null then
    select * into s from public.money_snapshots where id = o.current_snapshot_id;
    select * into a from public.money_checkout_attempts where obligation_id = o.id order by created_at desc, attempt_number desc, id desc limit 1;
    select e.kind, e.since, e.due_at, e.detail into x_kind, x_since, x_due, x_detail
      from private.money_payment_exceptions(p_at) e where e.obligation_id = o.id;
  end if;
  if s.id is not null and o.captured >= s.total then state := 'paid';
  elsif v.status = 'cancelled' then state := 'cancelled';
  elsif v.contractor_id is null or v.status not in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed') then
    state := 'not_accepted';
  elsif x_kind = 'payment_unresolved' then state := 'unknown';
  elsif o.captured > 0 then state := 'unknown'; reason := 'partial_capture';
  elsif a.status in ('prepared', 'session_created') and a.expires_at > p_at then state := 'processing';
  elsif s.id is null then state := 'review_pending'; reason := 'no_snapshot';
  elsif s.expires_at <= p_at + interval '31 minutes' then state := 'review_pending'; reason := 'snapshot_expired';
  elsif o.dispute_open or o.refunded_service + o.refunded_tax + o.refunded_tip > 0 then state := 'review_pending'; reason := 'held';
  else
    source_check := private.recurring_visit_source_check(v);
    if not (source_check->>'ok')::boolean then state := 'review_pending'; reason := 'source_blocked';
    elsif x_kind = 'payment_failed' then state := 'failed';
    else state := 'ready';
    end if;
  end if;
  if state in ('ready', 'failed') and private.r0_trial_admitted(v.customer_id, v.zip_code, v.service_catalog_id) then action := 'pay';
  elsif state = 'processing' then action := 'continue';
  end if;
  -- A visit still waiting for review also names any exception its source has now.
  if state = 'review_pending' and source_check is null then source_check := private.recurring_visit_source_check(v); end if;
  return jsonb_build_object('state', state, 'reason', reason, 'action', action,
    'snapshot_id', case when s.id is not null and state in ('ready', 'failed', 'processing', 'paid', 'unknown') then s.id end,
    'amount_cents', coalesce(s.total, case when t.visit_total > 0 and t.visit_total * 100 = trunc(t.visit_total * 100)
      then private.money_minor_units(t.visit_total) end),
    'accepted_at', accepted, 'attempt_status', a.status,
    'exception', case when x_kind is not null then jsonb_build_object('kind', x_kind, 'since', x_since, 'due_at', x_due, 'detail', x_detail) end,
    'problem', case when source_check is not null and not (source_check->>'ok')::boolean then source_check->'problem' end);
end $$;
revoke all on function private.recurring_visit_payment(public.service_requests, timestamptz) from public, anon, authenticated, service_role;

-- 6. Operations queue -------------------------------------------------------------------------------

-- DEC-2026-049 item 5 (owner decision 2026-10-27): an accepted, unpaid visit appears at its
-- appointment minus 24 hours, or at its acceptance when that is later; `review_missing` (no
-- current, unexpired snapshot, or its source no longer checks out, with the exception and recovery)
-- and `ready_unpaid` (payable or in checkout). Confirmed failures and unresolved outcomes are the
-- shared G6 items and appear at once. Read-only: nothing publishes, charges, cancels or notifies.
-- `aged` on a review or ready item means the appointment time has passed.
create function private.recurring_payment_queue(p_at timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  with visits as (
    select v.id, v.recurrence_parent_id, v.service_type, v.scheduled_start_at, private.recurring_visit_payment(v, p_at) as pay
    from public.service_requests v
    where v.recurrence_parent_id is not null and v.status <> 'cancelled' and v.contractor_id is not null
      and v.status in ('scheduled','in_progress','pending_review','vendor_completed','homeowner_confirmed','completed','review_requested','reviewed','closed')
  ), items as (
    select case when pay->>'state' = 'review_pending' then 'review_missing' else 'ready_unpaid' end as kind, x.*,
      greatest(x.scheduled_start_at - interval '24 hours', (x.pay->>'accepted_at')::timestamptz) as since,
      x.scheduled_start_at as due_at
    from visits x where x.pay->>'state' in ('review_pending', 'ready', 'processing')
      and p_at >= greatest(x.scheduled_start_at - interval '24 hours', (x.pay->>'accepted_at')::timestamptz)
    union all
    select x.pay#>>'{exception,kind}', x.*, (x.pay#>>'{exception,since}')::timestamptz, (x.pay#>>'{exception,due_at}')::timestamptz
    from visits x where x.pay->>'state' in ('failed', 'unknown') and jsonb_typeof(x.pay->'exception') = 'object'
    union all
    select 'payment_unresolved', x.*, (x.pay->>'accepted_at')::timestamptz, null
    from visits x where x.pay->>'state' = 'unknown' and x.pay->>'reason' = 'partial_capture'
  )
  select jsonb_build_object('checked_at', p_at, 'items', coalesce(jsonb_agg(jsonb_build_object(
      'kind', i.kind, 'request_id', i.id, 'series_id', i.recurrence_parent_id, 'service_type', i.service_type,
      'since', i.since, 'due_at', i.due_at, 'aged', i.due_at is not null and p_at >= i.due_at, 'exception_id', null,
      'detail', jsonb_build_object('starts_at', i.scheduled_start_at, 'state', i.pay->>'state', 'reason', i.pay->>'reason',
        'accepted_at', i.pay->'accepted_at', 'snapshot_id', i.pay->'snapshot_id', 'amount_cents', i.pay->'amount_cents',
        'attempt_status', i.pay->'attempt_status', 'problem', i.pay->'problem', 'exception', i.pay#>'{exception,detail}'))
    order by (i.due_at is not null and p_at >= i.due_at) desc, coalesce(i.due_at, i.since) nulls last, i.id), '[]'::jsonb))
  from items i
$$;
revoke all on function private.recurring_payment_queue(timestamptz) from public, anon, authenticated, service_role;

create function public.admin_recurring_payment_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read the recurring payment queue' using errcode = '42501';
  end if;
  return private.recurring_payment_queue(now());
end $$;
revoke all on function public.admin_recurring_payment_queue() from public, anon;
grant execute on function public.admin_recurring_payment_queue() to authenticated;

-- Restates 20261022001000 (DEC-2026-045 G4–G6). Only the payment items change source: they come
-- from the shared classification above, with the same kinds, clocks and detail.
create or replace function public.admin_quote_queue() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Only admins can read the quote queue' using errcode = '42501';
  end if;
  with open_quote_work as (
    select r.* from public.service_requests r
    where r.contractor_id is not null and r.matching_status = 'matched' and r.status in ('matched', 'quoted', 'scheduled')
      and (coalesce(r.quote_only, false) or r.pricing_mode is distinct from 'fixed')
  ), missing as (
    select r.id, r.service_type, greatest(
        (select max(coalesce(a.accepted_at, a.responded_at)) from public.job_match_attempts a
          where a.service_request_id = r.id and a.contractor_id = r.contractor_id and a.outcome = 'accepted'),
        case when not exists (select 1 from public.job_match_attempts a where a.service_request_id = r.id
          and a.contractor_id = r.contractor_id and a.outcome = 'accepted') then r.assigned_at end,
        (select max(q.decided_at) from public.request_quotes q where q.request_id = r.id and q.status = 'declined'),
        (select max(q.expires_at) from public.request_quotes q where q.request_id = r.id and q.status = 'expired'),
        (select max(p.decided_at) from public.request_quote_proposals p where p.request_id = r.id and p.status = 'returned')) as since
    from open_quote_work r
    where r.quote_status is distinct from 'submitted' and r.quote_status is distinct from 'accepted'
      and not exists (select 1 from public.request_quote_proposals p where p.request_id = r.id and p.status = 'pending')
  ), items as (
    select 'proposal_missing' as kind, m.id as request_id, m.service_type, m.since, m.since + interval '24 hours' as due_at,
      null::uuid as exception_id, '{}'::jsonb as detail
    from missing m where m.since is not null and now() >= m.since + interval '24 hours'
    union all
    select 'proposal_review', p.request_id, r.service_type, p.created_at, p.created_at + interval '4 hours', null,
      jsonb_build_object('proposal_id', p.id, 'subtotal_cents', p.subtotal_cents)
    from public.request_quote_proposals p join public.service_requests r on r.id = p.request_id
    where p.status = 'pending' and now() >= p.created_at + interval '4 hours'
    union all
    select 'quote_decision', q.request_id, r.service_type, q.sent_at, q.sent_at + interval '12 hours', null,
      jsonb_build_object('quote_id', q.id, 'revision', q.revision, 'expires_at', q.expires_at, 'deadline_passed', now() >= q.expires_at)
    from public.request_quotes q join public.service_requests r on r.current_quote_id = q.id
    where q.status = 'submitted' and now() >= q.sent_at + interval '12 hours'
    union all
    select 'deposit_review', r.id, r.service_type, r.created_at, null, null, '{}'::jsonb
    from public.service_requests r
    where r.status in ('pending', 'matched', 'quoted', 'scheduled') and r.quote_status is distinct from 'accepted'
      and (coalesce(r.quote_only, false) or r.pricing_mode is distinct from 'fixed')
      and private.quote_deposit_required(r)
      and not exists (select 1 from public.request_quote_exceptions x where x.request_id = r.id and x.kind = 'deposit_review'
        and x.closed_at is not null)
    union all
    select 'provider_review', r.id, r.service_type, null, null, null, jsonb_build_object('contractor_id', r.contractor_id)
    from public.service_requests r
    where r.contractor_id is not null
      and (r.status in ('scheduled', 'in_progress', 'pending_review', 'vendor_completed', 'disputed')
        or (r.status in ('matched', 'quoted') and r.matching_status = 'matched'))
      and not private.quote_provider_eligible(r.contractor_id)
      and not exists (select 1 from public.request_quote_exceptions x where x.request_id = r.id and x.kind = 'provider_review'
        and x.subject = r.contractor_id::text and x.closed_at is not null)
    union all
    select 'accepted_change', x.request_id, r.service_type, x.opened_at, null, x.id, jsonb_build_object('reason', x.reason, 'quote_id', x.subject)
    from public.request_quote_exceptions x join public.service_requests r on r.id = x.request_id
    where x.kind = 'accepted_change' and x.closed_at is null
    union all
    -- TRACE-125: the shared G6 classification (private.money_payment_exceptions), same items.
    select x.kind, x.request_id, r.service_type, x.since, x.due_at, null, x.detail
    from private.money_payment_exceptions(now()) x
    join public.service_requests r on r.id = x.request_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', i.kind, 'request_id', i.request_id, 'service_type', i.service_type,
      'since', i.since, 'due_at', i.due_at, 'aged', i.due_at is not null and now() >= i.due_at,
      'exception_id', i.exception_id, 'detail', i.detail)
    order by (i.due_at is not null and now() >= i.due_at) desc, coalesce(i.due_at, i.since) nulls last, i.request_id), '[]'::jsonb)
    into result from items i;
  return jsonb_build_object('checked_at', now(), 'items', result);
end $$;


-- Restates 20261026002000 (TRACE-124). Adds each visit's payment_state; `payment` is unchanged
-- except that 'paid' now needs the whole snapshot total captured.
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
        else coalesce((select case when o.captured > 0 and o.captured >= s2.total then 'paid' when o.current_snapshot_id is not null then 'awaiting_payment' end
          from public.money_obligations o left join public.money_snapshots s2 on s2.id = o.current_snapshot_id
          where o.service_request_id = v.id), 'none') end,
      -- TRACE-125: the visit's own payment state and action; operations also see the exception.
      'payment_state', case when is_provider and not is_admin then null
        when is_admin then pay.value else pay.value - 'problem' - 'exception' end,
      'on_cadence', case when is_admin and a.id is not null then private.recurring_cadence_index(a.local_start::date, s.frequency,
        (v.scheduled_start_at at time zone 'America/New_York')::date) is not null end,
      'replaces', case when is_admin then (select jsonb_build_object('cadence_date', x.cadence_date, 'anchor_id', x.anchor_id,
        'current_anchor', x.anchor_id = a.id) from private.recurring_cadence_resolutions x where x.occurrence_id = v.id) end)
      order by v.scheduled_start_at, v.id)
      from public.service_requests v cross join lateral (select private.recurring_visit_payment(v, now()) as value) pay
      where v.recurrence_parent_id = s.id), '[]'::jsonb),
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
