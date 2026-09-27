-- TRACE-098: read-only intake eligibility preview (Phase 6 slice 6.2; MPS §6.1/§6.2;
-- CFG-001–003/009; DEC-2026-015/020).
--
-- Before this migration the intake could learn a selection's local outcome only by
-- submitting it. The public catalog prices each service with the lowest fixed tier anywhere
-- in the network, so the price shown before submission often belonged to a provider who
-- does not serve the homeowner's ZIP; the submission then refused it as price_changed or
-- package_unavailable. find_public_eligible_providers is ZIP-aware but cannot see answers,
-- so a package priced only by answer-based levels looked unavailable.
--
-- Now:
-- 1. private.find_eligible_packages_with_answers holds the unchanged eligibility body with one
--    extra argument: answers to evaluate price-level rules against. NULL leaves the rules
--    unevaluated, which only the availability preview below uses. The existing five-argument
--    private.find_eligible_packages_without_onboarding delegates to it with the answers it
--    always used ('{}' without a request, the request's own answers with one), so matching,
--    submission and the public provider list are unchanged.
-- 2. public.preview_service_request_selections evaluates a plan the way
--    submit_service_requests does, without writing anything and without an identity: exact
--    coverage, active catalog service, provider/offering validity, current eligibility
--    (including onboarding eligibility), required answers, offering mode and the amount the
--    submission would store. Stage 'availability' ignores answers and reports whether the
--    amount still depends on them; stage 'final' evaluates the answers given. It returns no
--    provider identity. Submission still re-checks everything; a preview is never a booking.

CREATE FUNCTION private.find_eligible_packages_with_answers(_request_id uuid, _service_id text, _frequency text, _zip_code text, _preferred_contractor_id uuid, _answers jsonb)
 RETURNS TABLE(contractor_id uuid, contractor_name text, package_id uuid, package_tier_id uuid, promotion_id uuid, frequency text, path text, base_price numeric, effective_price numeric, median_fixed_price numeric, fixed_score numeric, profile_score numeric, verification_score numeric, price_band_score numeric, response_score numeric, freshness_score numeric, total_score numeric, preferred boolean, score_breakdown jsonb, rank_order integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  resolved_service_id text := _service_id;
  resolved_frequency text := _frequency;
  resolved_zip text := _zip_code;
  resolved_preferred uuid := _preferred_contractor_id;
  resolved_preferred_package uuid;
  resolved_preferred_tier uuid;
  -- TRACE-098: NULL leaves price-level rules unevaluated (availability preview only).
  resolved_answers jsonb := _answers;
BEGIN
  IF _request_id IS NOT NULL THEN
    SELECT
      request.service_catalog_id,
      request.frequency,
      request.zip_code,
      COALESCE(_preferred_contractor_id, request.preferred_contractor_id, request.contractor_id),
      request.package_id,
      request.package_tier_id,
      COALESCE(request.package_question_answers, '{}'::jsonb)
    INTO resolved_service_id, resolved_frequency, resolved_zip, resolved_preferred,
      resolved_preferred_package, resolved_preferred_tier, resolved_answers
    FROM public.service_requests request
    WHERE request.id = _request_id;
  END IF;

  IF resolved_service_id IS NULL OR resolved_frequency IS NULL OR resolved_zip IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH profile AS (
    SELECT
      contractor.id AS contractor_id,
      LEAST(100,
        CASE WHEN btrim(contractor.name) <> '' THEN 8 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.location), '') <> '' THEN 8 ELSE 0 END
        + CASE WHEN cardinality(COALESCE(contractor.services, '{}'::text[])) > 0 THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.email), '') <> '' THEN 7 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.phone), '') <> '' THEN 7 ELSE 0 END
        + CASE WHEN COALESCE(contractor.years_experience, 0) > 0 THEN 10 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.verified_specialty), '') <> '' THEN 10 ELSE 0 END
        + CASE WHEN contractor.logo_url IS NOT NULL THEN 8 ELSE 0 END
        + LEAST(3, COALESCE(gallery.photo_count, 0)) * 4
        + CASE
            WHEN length(COALESCE(btrim(contractor.bio), '')) >= 80 THEN 10
            WHEN length(COALESCE(btrim(contractor.bio), '')) > 0 THEN 5
            ELSE 0
          END
        + CASE WHEN COALESCE(btrim(contractor.special_offer), '') <> '' THEN 5 ELSE 0 END
        + CASE WHEN COALESCE(btrim(contractor.our_promise), '') <> '' THEN 5 ELSE 0 END
      )::numeric AS strength,
      COALESCE(contractor.badges, '{}'::text[])
        && ARRAY['Licensed', 'Insured', 'Background Checked']::text[] AS has_badges
    FROM public.contractors contractor
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS photo_count
      FROM public.contractor_gallery gallery_row
      WHERE gallery_row.contractor_id = contractor.id
    ) gallery ON true
  ), response_history AS (
    SELECT
      attempt.contractor_id,
      count(*) FILTER (WHERE attempt.outcome = 'accepted')::numeric AS accepted,
      count(*) FILTER (WHERE attempt.outcome IN ('accepted', 'declined', 'expired'))::numeric AS decided
    FROM public.job_match_attempts attempt
    GROUP BY attempt.contractor_id
  ), fixed_raw AS (
    SELECT
      contractor.id AS contractor_id,
      contractor.name AS contractor_name,
      package.id AS package_id,
      tier.id AS package_tier_id,
      resolved.promotion_id,
      tier.frequency,
      'fixed'::text AS path,
      resolved.base_price,
      resolved.effective_price,
      package.updated_at,
      profile.strength,
      profile.has_badges,
      COALESCE(history.accepted, 0) AS accepted,
      COALESCE(history.decided, 0) AS decided
    FROM public.vendor_packages package
    JOIN public.contractors contractor ON contractor.id = package.contractor_id
    JOIN public.services_catalog service ON service.id = package.service_id AND service.is_active = true
    JOIN public.package_tiers tier
      ON tier.package_id = package.id
      AND tier.frequency = resolved_frequency
      AND tier.price > 0
    JOIN LATERAL public.resolve_package_tier_price(package.id, tier.id) resolved ON true
    JOIN profile ON profile.contractor_id = contractor.id
    LEFT JOIN response_history history ON history.contractor_id = contractor.id
    WHERE package.service_id = resolved_service_id
      AND package.pricing_mode = 'fixed'
      AND package.is_active = true
      AND package.needs_review IS NOT TRUE
      AND contractor.is_active IS TRUE
      AND contractor.marketing_enabled IS TRUE
      AND (
        tier.rule_question_key IS NULL
        OR resolved_answers IS NULL
        OR (
          COALESCE(resolved_answers -> tier.rule_question_key ->> 'answer', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          AND (tier.rule_min IS NULL OR (resolved_answers -> tier.rule_question_key ->> 'answer')::numeric >= tier.rule_min)
          AND (tier.rule_max IS NULL OR (resolved_answers -> tier.rule_question_key ->> 'answer')::numeric <= tier.rule_max)
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.coverage_areas area
        WHERE area.zip_code = resolved_zip AND area.is_active = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.contractor_service_zips service_zip
        WHERE service_zip.contractor_id = contractor.id
          AND service_zip.zip_code = resolved_zip
      )
  ), fixed_candidates AS (
    SELECT DISTINCT ON (raw.contractor_id, raw.package_id)
      raw.*
    FROM fixed_raw raw
    ORDER BY raw.contractor_id, raw.package_id, raw.effective_price, raw.package_tier_id
  ), quote_candidates AS (
    SELECT
      contractor.id AS contractor_id,
      contractor.name AS contractor_name,
      package.id AS package_id,
      NULL::uuid AS package_tier_id,
      NULL::uuid AS promotion_id,
      package.default_frequency AS frequency,
      'quote'::text AS path,
      NULL::numeric AS base_price,
      NULL::numeric AS effective_price,
      package.updated_at,
      profile.strength,
      profile.has_badges,
      COALESCE(history.accepted, 0) AS accepted,
      COALESCE(history.decided, 0) AS decided
    FROM public.vendor_packages package
    JOIN public.contractors contractor ON contractor.id = package.contractor_id
    JOIN public.services_catalog service ON service.id = package.service_id AND service.is_active = true
    JOIN profile ON profile.contractor_id = contractor.id
    LEFT JOIN response_history history ON history.contractor_id = contractor.id
    WHERE package.service_id = resolved_service_id
      AND package.pricing_mode IN ('custom_quote', 'deposit_quote')
      AND package.default_frequency = resolved_frequency
      AND package.is_active = true
      AND package.needs_review IS NOT TRUE
      AND contractor.is_active IS TRUE
      AND contractor.marketing_enabled IS TRUE
      AND EXISTS (
        SELECT 1
        FROM public.coverage_areas area
        WHERE area.zip_code = resolved_zip AND area.is_active = true
      )
      AND EXISTS (
        SELECT 1
        FROM public.contractor_service_zips service_zip
        WHERE service_zip.contractor_id = contractor.id
          AND service_zip.zip_code = resolved_zip
      )
  ), candidates AS (
    SELECT * FROM fixed_candidates
    UNION ALL
    SELECT * FROM quote_candidates
  ), price_stats AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY candidate.effective_price)::numeric AS median_price
    FROM candidates candidate
    WHERE candidate.path = 'fixed'
  ), scored AS (
    SELECT
      candidate.*,
      stats.median_price,
      CASE WHEN candidate.path = 'fixed' THEN 40 ELSE 0 END::numeric AS fixed_points,
      round(candidate.strength * 0.20, 2) AS profile_points,
      CASE WHEN candidate.has_badges THEN 15 ELSE 0 END::numeric AS verification_points,
      CASE
        WHEN candidate.path = 'fixed'
          AND stats.median_price IS NOT NULL
          AND candidate.effective_price <= stats.median_price * 1.25
          THEN 15
        ELSE 0
      END::numeric AS price_points,
      CASE
        WHEN candidate.decided > 0 THEN round((candidate.accepted / candidate.decided) * 10, 2)
        ELSE 0
      END::numeric AS response_points,
      CASE WHEN candidate.updated_at >= now() - interval '30 days' THEN 5 ELSE 0 END::numeric AS freshness_points,
      candidate.contractor_id = resolved_preferred AS is_preferred,
      candidate.contractor_id = resolved_preferred
        AND candidate.package_id = resolved_preferred_package
        AND (resolved_preferred_tier IS NULL OR candidate.package_tier_id = resolved_preferred_tier)
        AS is_selected_package
    FROM candidates candidate
    CROSS JOIN price_stats stats
  ), ranked AS (
    SELECT
      scored.*,
      scored.fixed_points + scored.profile_points + scored.verification_points
        + scored.price_points + scored.response_points + scored.freshness_points AS score_total
    FROM scored
  )
  SELECT
    ranked.contractor_id,
    ranked.contractor_name,
    ranked.package_id,
    ranked.package_tier_id,
    ranked.promotion_id,
    ranked.frequency,
    ranked.path,
    ranked.base_price,
    ranked.effective_price,
    ranked.median_price,
    ranked.fixed_points,
    ranked.profile_points,
    ranked.verification_points,
    ranked.price_points,
    ranked.response_points,
    ranked.freshness_points,
    ranked.score_total,
    ranked.is_preferred,
    jsonb_build_object(
      'fixed', ranked.fixed_points,
      'profile', ranked.profile_points,
      'verification', ranked.verification_points,
      'price_band', ranked.price_points,
      'response', ranked.response_points,
      'freshness', ranked.freshness_points
    ),
    row_number() OVER (
      ORDER BY ranked.is_selected_package DESC,
        ranked.is_preferred DESC,
        ranked.score_total DESC,
        ranked.effective_price ASC NULLS LAST,
        lower(ranked.contractor_name),
        ranked.contractor_id,
        ranked.package_id
    )::integer
  FROM ranked
  ORDER BY ranked.is_selected_package DESC,
    ranked.is_preferred DESC,
    ranked.score_total DESC,
    ranked.effective_price ASC NULLS LAST,
    lower(ranked.contractor_name),
    ranked.contractor_id,
    ranked.package_id;
END;
$function$;

revoke all on function private.find_eligible_packages_with_answers(uuid, text, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.find_eligible_packages_without_onboarding(
  _request_id uuid default null,
  _service_id text default null,
  _frequency text default null,
  _zip_code text default null,
  _preferred_contractor_id uuid default null
)
returns table(contractor_id uuid, contractor_name text, package_id uuid, package_tier_id uuid,
  promotion_id uuid, frequency text, path text, base_price numeric, effective_price numeric,
  median_fixed_price numeric, fixed_score numeric, profile_score numeric,
  verification_score numeric, price_band_score numeric, response_score numeric,
  freshness_score numeric, total_score numeric, preferred boolean, score_breakdown jsonb,
  rank_order integer)
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $function$
  select * from private.find_eligible_packages_with_answers(
    _request_id, _service_id, _frequency, _zip_code, _preferred_contractor_id, '{}'::jsonb)
$function$;

-- Public offering questions and scope, as the public catalog already reads them.
create function private.intake_package_questions(p_package uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'question_key', question.question_key, 'question_label', question.question_label,
      'input_type', question.input_type, 'unit', question.unit, 'options', question.options,
      'is_required', question.is_required, 'sort_order', question.sort_order)
    order by question.sort_order, question.question_key), '[]'::jsonb)
  from public.package_qualifying_questions question
  where question.package_id = p_package
$$;

create function private.intake_offering_scope(p_package uuid, p_tier uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'package_name', package.name, 'package_description', package.description,
    'tier_name', tier.name, 'tier_includes', coalesce(to_jsonb(tier.includes), '[]'::jsonb))
  from public.vendor_packages package
  left join public.package_tiers tier on tier.id = p_tier and tier.package_id = package.id
  where package.id = p_package
$$;

revoke all on function private.intake_package_questions(uuid) from public, anon, authenticated, service_role;
revoke all on function private.intake_offering_scope(uuid, uuid) from public, anon, authenticated, service_role;

create function public.preview_service_request_selections(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  stage text;
  zip text;
  area public.coverage_areas;
  selections jsonb;
  selection jsonb;
  selection_count integer;
  idx integer;
  seen_services text[] := '{}';
  service public.services_catalog;
  wanted_frequency text;
  selected_provider uuid;
  wanted_package uuid;
  wanted_tier uuid;
  offering public.vendor_packages;
  raw_answers jsonb;
  provisional_answers jsonb;
  rule_answers jsonb;
  missing_answers text[];
  candidate record;
  candidate_packages uuid[];
  chosen_mode text;
  chosen_package uuid;
  chosen_tier uuid;
  chosen_total numeric;
  chosen_promotion uuid;
  depends_on_answers boolean;
  tier_price record;
  outcome jsonb;
  outcomes jsonb := '[]'::jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid preview' using errcode = '22023';
  end if;
  stage := coalesce(p_payload ->> 'stage', 'final');
  if stage not in ('availability', 'final') then
    raise exception 'Invalid preview stage' using errcode = '22023';
  end if;
  zip := btrim(coalesce(p_payload #>> '{location,zip_code}', ''));
  if zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'Enter a valid five-digit ZIP code' using errcode = '22023';
  end if;
  zip := left(zip, 5);
  selections := p_payload -> 'selections';
  if jsonb_typeof(selections) is distinct from 'array' then
    raise exception 'Choose at least one service' using errcode = '22023';
  end if;
  selection_count := jsonb_array_length(selections);
  if selection_count < 1 or selection_count > 20 then
    raise exception 'Choose between 1 and 20 services' using errcode = '22023';
  end if;

  select * into area from public.coverage_areas where zip_code = zip;
  if not coalesce(area.is_active, false) then
    return jsonb_build_object('stage', stage,
      'coverage', case when area.has_waitlist then 'waitlist' else 'uncovered' end,
      'outcomes', '[]'::jsonb);
  end if;

  for idx in 0 .. selection_count - 1 loop
    -- Input checks mirror submit_service_requests so a preview never accepts what it refuses.
    selection := selections -> idx;
    if jsonb_typeof(selection) is distinct from 'object' then
      raise exception 'Invalid service selection' using errcode = '22023';
    end if;
    wanted_frequency := selection ->> 'frequency';
    if wanted_frequency is null
      or wanted_frequency not in ('weekly', 'bi-monthly', 'monthly', 'quarterly', 'one-time') then
      raise exception 'Invalid service frequency' using errcode = '22023';
    end if;
    if coalesce(selection ->> 'service_id', '') !~ '^[a-z0-9-]{1,100}$' then
      raise exception 'Invalid service' using errcode = '22023';
    end if;
    if (selection ->> 'service_id') = any(seen_services) then
      raise exception 'Each service can be selected once' using errcode = '22023';
    end if;
    seen_services := seen_services || (selection ->> 'service_id');
    begin
      selected_provider := nullif(selection ->> 'preferred_contractor_id', '')::uuid;
      wanted_package := nullif(selection ->> 'package_id', '')::uuid;
      wanted_tier := nullif(selection ->> 'tier_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid provider or offering identifier' using errcode = '22023';
    end;
    if wanted_tier is not null and wanted_package is null then
      raise exception 'A tier requires its offering' using errcode = '22023';
    end if;
    raw_answers := coalesce(selection -> 'answers', '{}'::jsonb);
    if jsonb_typeof(raw_answers) <> 'object'
      or (select count(*) from jsonb_object_keys(raw_answers)) > 50
      or exists (select 1 from jsonb_each(raw_answers) answer
        where jsonb_typeof(answer.value) not in ('string', 'number')
          or length(answer.value #>> '{}') > 200) then
      raise exception 'Invalid qualifying answers' using errcode = '22023';
    end if;
    select coalesce(jsonb_object_agg(answer.key, jsonb_build_object('answer', btrim(answer.value #>> '{}'))), '{}'::jsonb)
    into provisional_answers
    from jsonb_each(raw_answers) answer
    where btrim(answer.value #>> '{}') <> '';
    rule_answers := case when stage = 'final' then provisional_answers end;

    outcome := jsonb_build_object('selection_index', idx, 'service_id', selection ->> 'service_id');

    select * into service from public.services_catalog
    where id = selection ->> 'service_id' and is_active = true;
    if not found then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'service_not_offered'));
      continue;
    end if;
    if selected_provider is not null and not exists (select 1 from public.contractors where id = selected_provider) then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_provider'));
      continue;
    end if;
    offering := null;
    if wanted_package is not null then
      select * into offering from public.vendor_packages where id = wanted_package;
      if not found or offering.service_id <> service.id
        or (selected_provider is not null and offering.contractor_id <> selected_provider)
        or (wanted_tier is not null and not exists (select 1 from public.package_tiers
          where id = wanted_tier and package_id = wanted_package)) then
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package'));
        continue;
      end if;
      if stage = 'final' then
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = offering.id and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required',
            'questions', to_jsonb(missing_answers), 'package_id', offering.id,
            'question_details', private.intake_package_questions(offering.id)));
          continue;
        end if;
      end if;
    end if;

    -- Reuse one onboarding-filtered eligibility result for this selection.
    with eligible as materialized (
      select eligible.* from private.find_eligible_packages_with_answers(
        null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
      where private.vendor_matching_eligible(eligible.contractor_id)
    ), selected as materialized (
      select eligible.* from eligible
      where (selected_provider is null or eligible.contractor_id = selected_provider)
        and (wanted_package is null or eligible.package_id = wanted_package)
    )
    select chosen.*, pool.has_eligible, pool.package_ids into candidate
    from (
      select exists (select 1 from eligible) as has_eligible,
        (select array_agg(selected.package_id) from selected) as package_ids
    ) pool
    left join lateral (
      select selected.* from selected
      order by (selected.path = 'fixed') desc, selected.effective_price asc nulls last, selected.rank_order
      limit 1
    ) chosen on true;

    if not candidate.has_eligible then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'no_eligible_provider'));
      continue;
    end if;
    candidate_packages := candidate.package_ids;

    if candidate.contractor_id is null then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome',
        case when wanted_package is not null then 'package_unavailable' else 'preferred_provider_unavailable' end));
      continue;
    end if;

    chosen_promotion := null;
    depends_on_answers := false;
    if candidate.path = 'fixed' then
      chosen_mode := 'fixed';
      chosen_package := candidate.package_id;
      chosen_tier := candidate.package_tier_id;
      chosen_total := candidate.effective_price;
      chosen_promotion := candidate.promotion_id;
      if wanted_tier is not null and wanted_tier <> candidate.package_tier_id then
        select resolved.* into tier_price
        from public.package_tiers tier
        cross join lateral public.resolve_package_tier_price(tier.package_id, tier.id) resolved
        where tier.id = wanted_tier and tier.package_id = candidate.package_id
          and tier.frequency = wanted_frequency and tier.price > 0
          and (tier.rule_question_key is null or rule_answers is null or (
            coalesce(rule_answers -> tier.rule_question_key ->> 'answer', '') ~ '^-?[0-9]+([.][0-9]+)?$'
            and (tier.rule_min is null or (rule_answers -> tier.rule_question_key ->> 'answer')::numeric >= tier.rule_min)
            and (tier.rule_max is null or (rule_answers -> tier.rule_question_key ->> 'answer')::numeric <= tier.rule_max)));
        if not found or coalesce(tier_price.effective_price, 0) <= 0 then
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
          continue;
        end if;
        chosen_tier := wanted_tier;
        chosen_total := tier_price.effective_price;
        chosen_promotion := tier_price.promotion_id;
      end if;
      -- Without answers, an answer-based price level among the candidates may change the
      -- amount (or the offering) the submission will choose.
      if stage = 'availability' then
        depends_on_answers := exists (
          select 1 from public.package_tiers tier
          where tier.package_id = any(candidate_packages)
            and tier.frequency = wanted_frequency and tier.rule_question_key is not null);
      end if;
    else
      chosen_mode := case when offering.id is not null then offering.pricing_mode else 'custom_quote' end;
      chosen_package := offering.id;
      chosen_tier := null;
      chosen_total := null;
    end if;

    if stage = 'final' and chosen_package is not null then
      select array_agg(question.question_key order by question.sort_order) into missing_answers
      from public.package_qualifying_questions question
      where question.package_id = chosen_package and question.is_required is not false
        and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
      if missing_answers is not null then
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required',
          'questions', to_jsonb(missing_answers), 'package_id', chosen_package,
          'question_details', private.intake_package_questions(chosen_package)));
        continue;
      end if;
    end if;

    outcomes := outcomes || (outcome || jsonb_build_object(
      'outcome', case when chosen_mode = 'fixed' then 'eligible_fixed' else 'eligible_quote' end,
      'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
      'offering_mode', chosen_mode,
      'total', case when depends_on_answers then null else chosen_total end,
      'from_total', case when depends_on_answers then chosen_total end,
      'depends_on_answers', depends_on_answers,
      'promotion', chosen_promotion is not null,
      'package_id', chosen_package,
      'tier_id', chosen_tier,
      'question_details', case when chosen_package is not null
        then private.intake_package_questions(chosen_package) else '[]'::jsonb end,
      'scope', case when chosen_package is not null
        then private.intake_offering_scope(chosen_package, chosen_tier) end));
  end loop;

  return jsonb_build_object('stage', stage, 'coverage', 'covered', 'outcomes', outcomes);
end
$$;

revoke all on function public.preview_service_request_selections(jsonb) from public;
grant execute on function public.preview_service_request_selections(jsonb) to anon, authenticated;
comment on function public.preview_service_request_selections(jsonb) is
  'TRACE-098: read-only intake preview. Mirrors submit_service_requests eligibility and pricing for a ZIP and plan; writes nothing and returns no provider identity.';
