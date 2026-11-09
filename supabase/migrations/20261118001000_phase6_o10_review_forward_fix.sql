-- Forward fix for Codex's review of #154 (O-10 + CS-3 at main 762d6a4; TRACE-150, DEC-2026-063).
-- Additive; 20261116001000 and 20261117001000 are applied on hosted and are not edited.
--
--   1. A homeowner's recorded decline survives a failed automatic re-match. Declining (the terms
--      answer, or an E6 replacement answer) writes the answer, withdraws the offer and unassigns the
--      provider, then runs matching in a subtransaction. If matching raises (for example a provider
--      save that replaced the revision matching had just selected, finding F-O10-1), only the matching
--      work is rolled back: the decline stands, the provider stays unassigned, the declined offer stays
--      withdrawn and answered (never actionable again), and the request is recorded for operations
--      (private.offer_terms_rematch_failures, needs_admin_review). admin_offer_terms_queue lists it as
--      'rematch_failed' and admin_retry_offer_terms_matching retries it (keyed, with a reason), whether
--      or not the offer_terms gate is on.
--   2. P-4 completed: a fixed one-time request (no quote, not a recurring visit) is priced only from
--      bound terms: the submission record (CS-3) or the offer's terms the homeowner accepted (O-10).
--      With neither, preview, publication and checkout refuse it by name (one_time:terms_missing).
--      The current-catalog-price path is removed for one-time requests; it remains only for a fixed
--      request that is neither one-time nor a recurring visit (no product command prices one).
--   3. Required scope (DEC-2026-063 P-3: "Skip candidates unable to meet required scope"). Exact
--      pricing and answered questions are necessary but no longer sufficient. A candidate at other
--      terms is offered only when the request's required work is established from authoritative
--      records, else it is skipped as 'required_work' (offer_terms_required_work):
--        a. the submission record exists (pricing-v2, exact) - it is the only record of the work asked for;
--        b. level: a submitted level from a pricing template needs the same template level; a custom
--           submitted level must name its included work (else nothing establishes it);
--        c. included work: every item the submitted offering and level included is included by the
--           candidate (the catalog's own normalized comparison, as price_selection uses);
--        d. required add-ons: each add-on the submitted offering required is met by a candidate line
--           of the same template add-on (at least the same quantity), or named in its included work.
--      Optional add-ons the candidate doesn't meet are still omitted and disclosed (P-3, unchanged).
--      The terms (offer-terms-v2) carry this evidence under scope.required_work.
--
-- Not changed: the gate (offer_terms stays off), quotes, recurring visits (CS-4), CS-3's bound path,
-- promotions, fee, tax, tips, capture, payout, refunds, runtime dual-authorization, grants of
-- existing functions. Writes no request, offer or money data.

-- 1. Declines whose re-match failed ---------------------------------------------------------------
create table private.offer_terms_rematch_failures (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.service_requests(id),
  terms_id uuid references public.job_offer_terms(id),
  via text not null check (via in ('terms', 'replacement')),
  last_attempt integer not null,
  sqlstate text not null,
  message text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index offer_terms_rematch_failures_request on private.offer_terms_rematch_failures(request_id, created_at);
alter table private.offer_terms_rematch_failures enable row level security;
revoke all on private.offer_terms_rematch_failures from public, anon, authenticated, service_role;
create trigger offer_terms_rematch_failures_append_only before update or delete on private.offer_terms_rematch_failures
  for each row execute function private.offer_terms_append_only();

-- Runs matching after a homeowner's decline. The decline, the withdrawn offer and the unassignment
-- were written before this call and are kept whatever matching does: a failure rolls back only the
-- matching work (this block's subtransaction), records it for operations and returns null.
create function private.offer_terms_rematch(p_request uuid, p_terms uuid, p_via text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare next_offer uuid; code text; msg text; det text; recipient uuid;
begin
  begin
    next_offer := private.offer_next_for_request_internal(p_request);
    return next_offer;
  exception when others then
    get stacked diagnostics code = returned_sqlstate, msg = message_text, det = pg_exception_detail;
  end;
  update public.service_requests set contractor_id = null, assigned_at = null, match_expires_at = null,
      status = 'pending', matching_status = 'awaiting_match', needs_admin_review = true, updated_at = now()
    where id = p_request;
  insert into private.offer_terms_rematch_failures(request_id, terms_id, via, last_attempt, sqlstate, message, detail)
    values (p_request, p_terms, p_via,
      coalesce((select max(a.attempt_number) from public.job_match_attempts a where a.service_request_id = p_request), 0),
      code, msg, nullif(det, ''));
  perform public.log_job_event(p_request, 'status_changed', auth.uid(), jsonb_build_object('action', 'offer_terms_rematch_failed',
    'terms_id', p_terms, 'via', p_via, 'sqlstate', code, 'policy', 'DEC-2026-063'));
  for recipient in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify_user(recipient, 'job_status', 'warning', 'Matching after a decline needs attention',
      'The homeowner''s decline is recorded, but finding the next provider failed. Retry matching from Offers at other terms.',
      '/admin/requests', p_request, null);
  end loop;
  return null;
end $$;

-- A recorded re-match failure is still open while the request waits unassigned with nothing offered
-- or retried since.
-- (Any later matching run, including a retry, either offers (a later attempt) or moves the request
-- to another matching state.)
create function private.offer_terms_rematch_open(r public.service_requests, f private.offer_terms_rematch_failures)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.id = f.request_id and r.status = 'pending' and r.matching_status = 'awaiting_match' and r.contractor_id is null
    and not exists(select 1 from public.job_match_attempts a where a.service_request_id = r.id and a.attempt_number > f.last_attempt)
$$;

-- 3. Required scope -----------------------------------------------------------------------------------
-- Whether a candidate's priced selection (p_priced, from price_selection with no add-ons chosen)
-- meets the work the request requires, judged only from authoritative records: the submission record
-- (pricing-v2), the submitted package's level and add-on rows (immutable once in use, 6.11A) and their
-- pricing-template links, and the candidate's own level, lines and included work.
-- {ok, missing: [...], omitted: [...], evidence: {...}}. Reads only; the caller locks.
create function private.offer_terms_required_work(r public.service_requests, p_tier uuid, p_priced jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare pi jsonb := r.pricing_inputs; st public.package_tiers; ct public.package_tiers; line jsonb;
  submitted_scope text[]; offered_scope text[]; missing jsonb := '[]'::jsonb; omitted jsonb := '[]'::jsonb;
  addons jsonb := '[]'::jsonb; template_addon uuid; met_line text; required boolean;
begin
  if pi->>'version' is distinct from 'pricing-v2' or pi->>'status' is distinct from 'exact'
    or nullif(pi->>'package_id', '') is null or nullif(pi->>'tier_id', '') is null then
    return jsonb_build_object('ok', false, 'missing', jsonb_build_array(jsonb_build_object('kind', 'submission')),
      'omitted', '[]'::jsonb);
  end if;
  select * into st from public.package_tiers where id = (pi->>'tier_id')::uuid and package_id = (pi->>'package_id')::uuid;
  select * into ct from public.package_tiers where id = p_tier;
  if st.id is null or ct.id is null then
    return jsonb_build_object('ok', false, 'missing', jsonb_build_array(jsonb_build_object('kind', 'submission')),
      'omitted', '[]'::jsonb);
  end if;
  select coalesce(array_agg(distinct lower(btrim(x)) order by lower(btrim(x))), '{}') into submitted_scope
    from jsonb_array_elements_text(coalesce(pi->'included_scope', '[]'::jsonb)) x where nullif(btrim(x), '') is not null;
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into offered_scope
    from jsonb_array_elements_text(coalesce(p_priced->'included_scope', '[]'::jsonb)) x where nullif(btrim(x), '') is not null;
  -- b. The level.
  if st.template_tier_id is not null then
    if ct.template_tier_id is distinct from st.template_tier_id then
      missing := missing || jsonb_build_object('kind', 'level', 'template_tier_id', st.template_tier_id, 'name', st.name);
    end if;
  elsif cardinality(submitted_scope) = 0 then
    missing := missing || jsonb_build_object('kind', 'level', 'template_tier_id', null, 'name', st.name);
  end if;
  -- c. The included work.
  missing := missing || coalesce((select jsonb_agg(jsonb_build_object('kind', 'included', 'item', item) order by item)
    from unnest(submitted_scope) item where not item = any(offered_scope)), '[]'::jsonb);
  -- d. Add-ons: required ones must be met; optional ones not met are omitted and disclosed (P-3).
  for line in select value from jsonb_array_elements(coalesce(pi->'lines', '[]'::jsonb)) where value->>'kind' = 'addon'
      order by value->>'id' loop
    required := coalesce((line->>'required')::boolean, false);
    template_addon := null; met_line := null;
    select a.template_addon_id into template_addon from public.package_addons a
      where a.id::text = line->>'id' and a.package_id = (pi->>'package_id')::uuid;
    if template_addon is not null then
      select l->>'id' into met_line from jsonb_array_elements(coalesce(p_priced->'lines', '[]'::jsonb)) l
        join public.package_addons ca on ca.id::text = l->>'id'
        where l->>'kind' = 'addon' and ca.template_addon_id = template_addon
          and coalesce((l->>'quantity')::integer, 0) >= coalesce((line->>'quantity')::integer, 1)
        order by l->>'id' limit 1;
    end if;
    if met_line is not null or lower(btrim(line->>'name')) = any(offered_scope) then
      addons := addons || jsonb_build_object('id', line->>'id', 'name', line->>'name', 'required', required,
        'met_by', case when met_line is not null then 'line' else 'included_scope' end, 'line_id', met_line);
    elsif required then
      missing := missing || jsonb_build_object('kind', 'required_addon', 'id', line->>'id', 'name', line->>'name',
        'template_addon_id', template_addon);
    else
      omitted := omitted || jsonb_build_object('id', line->>'id', 'name', line->>'name', 'quantity', (line->>'quantity')::integer,
        'amount_cents', (line->>'amount_cents')::bigint, 'required_by_earlier_offering', false);
    end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(missing) = 0, 'missing', missing, 'omitted', omitted,
    'evidence', jsonb_build_object('level', jsonb_build_object('name', st.name, 'template_tier_id', st.template_tier_id),
      'included', to_jsonb(submitted_scope), 'addons', addons));
end $$;

-- Restated from 20261117001000. Change (finding 3): required work (offer_terms_required_work), and terms offer-terms-v2.
create or replace function private.offer_terms_build(r public.service_requests, p_contractor uuid, p_package uuid, p_tier uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.vendor_packages; t public.package_tiers; priced jsonb; omitted jsonb; terms jsonb;
  level_cents bigint; total_cents bigint; provider_name text; service_name text; required jsonb;
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
  -- Finding 3 (P-3, required scope): the request's required work must be established from the
  -- records; exact pricing and answered questions alone don't establish it.
  required := private.offer_terms_required_work(r, t.id, priced);
  if not (required->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'required_work', 'missing', required->'missing');
  end if;
  -- What the request priced earlier and these terms don't carry: optional add-ons only (P-3).
  omitted := required->'omitted';
  select c.name into provider_name from public.contractors c where c.id = p.contractor_id;
  select s.name into service_name from public.services_catalog s where s.id = r.service_catalog_id;
  terms := jsonb_build_object(
    'version', 'offer-terms-v2',
    'provider', jsonb_build_object('id', p.contractor_id, 'name', provider_name),
    'service', jsonb_build_object('id', r.service_catalog_id, 'name', service_name),
    'zip_code', r.zip_code,
    'frequency', r.frequency,
    'offering', jsonb_build_object('package_id', p.id, 'lineage_id', coalesce(p.lineage_id, p.id),
      'revision', private.package_revision_hash(p.id), 'name', p.name, 'description', p.description,
      'policy_notes', p.policy_notes),
    'level', jsonb_build_object('id', t.id, 'name', t.name),
    'scope', jsonb_build_object('included', coalesce(priced->'included_scope', '[]'::jsonb),
      'answers', coalesce(r.package_question_answers, '{}'::jsonb), 'required_work', required->'evidence'),
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

-- Restated from 20261117001000. Change (finding 3): a candidate refused by offer_terms_build keeps its reason ('scope' or 'required_work').
create or replace function private.one_time_offer_basis(r public.service_requests, p_contractor uuid, p_package uuid, p_tier uuid,
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
  if not (built->>'ok')::boolean then
    return jsonb_build_object('basis', 'blocked', 'reason', coalesce(built->>'reason', 'scope'), 'missing', built->'missing');
  end if;
  if exists(select 1 from public.job_offer_terms_responses x where x.request_id = r.id and not x.accepted
      and x.content_hash = built->>'content_hash') then
    return jsonb_build_object('basis', 'blocked', 'reason', 'declined');
  end if;
  return jsonb_build_object('basis', 'terms', 'built', built);
end $$;

-- Restated from 20261117001000. Change (finding 3): the 'required_work' refusal is named.
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
        WHEN 'required_work' THEN 'This offering doesn''t establish the work this request requires'
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

-- 2. Payment source --------------------------------------------------------------------------------
-- Restated from 20261117001000. Change (finding 2): a fixed one-time request with neither binding is refused by name.
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
    -- O-10 P-4, completed (review of #154, finding 2): a fixed one-time request is priced only from
    -- bound terms (above). With neither binding it is refused by name, never priced from the current
    -- catalog. The rule below remains only for a fixed request that is neither one-time nor a
    -- recurring visit, which no product command prices.
    if coalesce(r.frequency, 'one-time') = 'one-time' then
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

-- 1 (continued). The homeowner's answers ---------------------------------------------------------------
-- Restated from 20261117001000. Change (finding 1): a decline's re-match runs in private.offer_terms_rematch.
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
    -- Finding 1: a failed re-match never undoes the recorded decline.
    perform private.offer_terms_rematch(r.id, t.id, 'replacement');
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

-- Restated from 20261117001000. Change (finding 1): a decline's re-match runs in private.offer_terms_rematch.
create or replace function public.homeowner_respond_offer_terms(_terms_id uuid, _response_key uuid, _accept boolean,
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
  -- Finding 1: the decline, the withdrawn offer and the unassignment are kept whatever matching does.
  if not _accept then perform private.offer_terms_rematch(r.id, t.id, 'terms'); end if;
  return to_jsonb(response) - 'before_value' || jsonb_build_object('replayed', false);
end $$;

-- Restated from 20261117001000. Change (finding 1): declines whose re-match failed are listed; and a gate
-- block counts as retried only by a retry made after it (strictly later), because a retry of a failed
-- re-match can itself record a block in its own transaction (same now()), which must stay listed.
create or replace function public.admin_offer_terms_queue() returns jsonb
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
          and not exists(select 1 from private.offer_terms_retries x where x.request_id = b.request_id and x.created_at > b.created_at)
      union all
      -- Finding 1: a decline is recorded but matching after it failed; nothing has run since.
      select jsonb_build_object('kind', 'rematch_failed', 'request_id', f.request_id, 'terms_id', f.terms_id, 'since', f.created_at,
          'via', f.via, 'problem', f.sqlstate || ': ' || f.message)
        from (select distinct on (request_id) * from private.offer_terms_rematch_failures order by request_id, created_at desc, id desc) f
        join public.service_requests r on r.id = f.request_id
        where private.offer_terms_rematch_open(r, f)
    ) q), '[]'::jsonb));
end $$;

-- Restated from 20261117001000. Change (finding 1): also retries a decline whose re-match failed, gate on or off;
-- a gate block is retried only by a retry made after it (see admin_offer_terms_queue).
create or replace function public.admin_retry_offer_terms_matching(_request_id uuid, _retry_key uuid, _reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.service_requests; prior private.offer_terms_retries; next_offer uuid; result jsonb;
  failure private.offer_terms_rematch_failures;
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
  -- Finding 1: a decline whose re-match failed is retried whether or not the gate is on (matching
  -- itself still skips offers at other terms while it is off).
  select * into failure from private.offer_terms_rematch_failures where request_id = r.id order by created_at desc, id desc limit 1;
  if failure.id is null or not private.offer_terms_rematch_open(r, failure) then
    if not private.offer_terms_active(true) then
      raise exception 'Offers at other terms are not active yet' using errcode = '22023', detail = 'offer_terms:inactive';
    end if;
    if r.status <> 'pending' or r.matching_status <> 'exhausted' or r.recurrence_parent_id is not null
      or not exists(select 1 from private.offer_terms_blocks b where b.request_id = r.id
        and not exists(select 1 from private.offer_terms_retries x where x.request_id = r.id and x.created_at > b.created_at)) then
      raise exception 'This request isn''t waiting on offers at other terms' using errcode = '22023';
    end if;
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

-- Privileges --------------------------------------------------------------------------------------------
-- New helpers are internal; restated functions keep their grants (create or replace keeps them).
revoke all on function private.offer_terms_rematch(uuid, uuid, text),
  private.offer_terms_rematch_open(public.service_requests, private.offer_terms_rematch_failures),
  private.offer_terms_required_work(public.service_requests, uuid, jsonb)
  from public, anon, authenticated, service_role;
