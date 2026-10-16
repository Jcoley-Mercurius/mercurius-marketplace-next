-- TRACE-110: an operator drafts a price for a specific vendor and publishes it with a
-- reason, and "Every two months" becomes a cadence (owner decision 2026-10-16,
-- DEC-2026-035; MPS §4 "Configure provider offerings: supervised").
--
-- Cadence. 'every-two-months' is a new cadence beside the existing ones. 'bi-monthly'
-- keeps its meaning, every two weeks, as almost every screen already labels it. Like the
-- other cadences it is priced and charged per visit; each occurrence keeps its own
-- commercial identity (TRACE-059). The custom-package guardrail band uses the catalog
-- monthly reference for it, as it does for every two weeks. Request preview and
-- submission accept it. The legacy visit generator (generate_recurring_visits /
-- top_up_recurring_visits) still schedules only weekly and monthly; it is unchanged.
--
-- Drafts. Before this, an operator could correct the prices of an existing package
-- (TRACE-109) but could not add a price for a vendor. A draft lives in a private table:
-- it is not a vendor package, so vendors and customers never see it, and the vendor's own
-- editor cannot publish it. Publishing (operator, reason required) creates an ordinary
-- custom fixed package with one price per cadence, the shape the vendor's simple editor
-- saves, records the new prices in the TRACE-109 price history with the reason, and
-- notifies the linked vendor. The package is then the vendor's to manage as usual. The
-- existing guardrail decides the review flag; publishing is not an approval, so a price
-- outside the band waits in Package Reviews. Publishing is refused while the vendor
-- already has an active package for the same service with a price at one of the same
-- cadences; correct that package instead.

-- Cadence constraints, widened (existing rows already satisfy them).
alter table public.vendor_packages drop constraint vendor_packages_default_frequency_check;
alter table public.vendor_packages add constraint vendor_packages_default_frequency_check
  check (default_frequency in ('one-time', 'weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly'));
alter table public.package_tiers drop constraint package_tiers_frequency_check;
alter table public.package_tiers add constraint package_tiers_frequency_check
  check (frequency in ('one-time', 'weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly'));
alter table public.money_recurring_occurrence_identities
  drop constraint money_recurring_occurrence_identities_frequency_check;
alter table public.money_recurring_occurrence_identities
  add constraint money_recurring_occurrence_identities_frequency_check
  check (frequency in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly'));

-- Guardrail band: unchanged except that every two months uses the monthly reference.
CREATE OR REPLACE FUNCTION public.custom_package_price_needs_review(_package_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  package_record public.vendor_packages%ROWTYPE;
  tier_record record;
  template_min numeric;
  template_max numeric;
  reference_price numeric;
  min_allowed numeric;
  max_allowed numeric;
BEGIN
  SELECT *
  INTO package_record
  FROM public.vendor_packages
  WHERE id = _package_id;

  IF package_record.id IS NULL
    OR package_record.template_id IS NOT NULL
    OR package_record.pricing_mode <> 'fixed' THEN
    RETURN false;
  END IF;

  FOR tier_record IN
    SELECT price, frequency
    FROM public.package_tiers
    WHERE package_id = _package_id
  LOOP
    template_min := NULL;
    template_max := NULL;
    reference_price := NULL;

    IF tier_record.frequency = 'one-time' THEN
      SELECT min(ptt.min_price), max(ptt.max_price)
      INTO template_min, template_max
      FROM public.pricing_templates pt
      JOIN public.pricing_template_tiers ptt ON ptt.template_id = pt.id
      WHERE pt.service_id = package_record.service_id
        AND pt.is_active = true
        AND ptt.min_price > 0
        AND ptt.max_price >= ptt.min_price;
    END IF;

    IF template_min IS NOT NULL AND template_max IS NOT NULL THEN
      min_allowed := template_min;
      max_allowed := template_max;
    ELSE
      SELECT CASE
        WHEN tier_record.frequency = 'weekly'
          THEN COALESCE(sc.weekly_price, sc.monthly_price, sc.one_time_price)
        WHEN tier_record.frequency IN ('monthly', 'bi-monthly', 'every-two-months')
          THEN COALESCE(sc.monthly_price, sc.one_time_price)
        WHEN tier_record.frequency = 'quarterly'
          THEN COALESCE(sc.one_time_price, sc.monthly_price)
        ELSE COALESCE(sc.one_time_price, sc.monthly_price)
      END
      INTO reference_price
      FROM public.services_catalog sc
      WHERE sc.id = package_record.service_id;

      IF reference_price IS NOT NULL AND reference_price > 0 THEN
        min_allowed := greatest(1, round(reference_price * 0.25, 2));
        max_allowed := round(reference_price * 4, 2);
      ELSE
        min_allowed := 20;
        max_allowed := 5000;
      END IF;
    END IF;

    IF tier_record.price IS NULL
      OR tier_record.price < min_allowed
      OR tier_record.price > max_allowed THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

-- Request preview and submission: unchanged except that the cadence list accepts
-- 'every-two-months' (definitions as applied by 20260928000000 / 20260927020000).
CREATE OR REPLACE FUNCTION public.preview_service_request_selections(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or wanted_frequency not in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly', 'one-time') then
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

    if not exists (
      select 1 from private.find_eligible_packages_with_answers(
        null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
      where private.vendor_matching_eligible(eligible.contractor_id)
    ) then
      outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'no_eligible_provider'));
      continue;
    end if;

    select array_agg(eligible.package_id) into candidate_packages
    from private.find_eligible_packages_with_answers(
      null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
    where private.vendor_matching_eligible(eligible.contractor_id)
      and (selected_provider is null or eligible.contractor_id = selected_provider)
      and (wanted_package is null or eligible.package_id = wanted_package);

    select eligible.* into candidate
    from private.find_eligible_packages_with_answers(
      null, service.id, wanted_frequency, zip, selected_provider, rule_answers) eligible
    where private.vendor_matching_eligible(eligible.contractor_id)
      and (selected_provider is null or eligible.contractor_id = selected_provider)
      and (wanted_package is null or eligible.package_id = wanted_package)
    order by (eligible.path = 'fixed') desc, eligible.effective_price asc nulls last, eligible.rank_order
    limit 1;
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
$function$

;

CREATE OR REPLACE FUNCTION private.submit_service_requests_core(p_submission_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  digest bytea;
  prior public.service_request_submissions;
  submission uuid;
  location jsonb;
  zip text;
  street text;
  city_name text;
  state_code text;
  window_start date;
  window_text text;
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
  labelled_answers jsonb;
  missing_answers text[];
  expected jsonb;
  request_id uuid;
  candidate record;
  chosen_mode text;
  chosen_package uuid;
  chosen_tier uuid;
  chosen_total numeric;
  chosen_base numeric;
  chosen_promotion uuid;
  tier_price record;
  outcome jsonb;
  outcomes jsonb := '[]'::jsonb;
  created jsonb := '[]'::jsonb;
  refused boolean := false;
  result jsonb;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_submission_key is null or p_submission_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Invalid submission key' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid submission' using errcode = '22023';
  end if;

  -- Serialize one actor's key, then replay or refuse before re-evaluating anything.
  digest := sha256(convert_to(p_payload::text, 'UTF8'));
  perform pg_advisory_xact_lock(hashtextextended(
    'service_request_submission:' || actor::text || ':' || p_submission_key, 0));
  select * into prior from public.service_request_submissions
  where customer_id = actor and submission_key = p_submission_key;
  if found then
    if prior.payload_hash <> digest then
      raise exception 'Submission key reused with a different request' using errcode = '22023';
    end if;
    return prior.result || jsonb_build_object('reused', true);
  end if;

  location := p_payload -> 'location';
  if jsonb_typeof(location) is distinct from 'object' then
    raise exception 'Service location required' using errcode = '22023';
  end if;
  zip := btrim(coalesce(location ->> 'zip_code', ''));
  if zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
    raise exception 'Enter a valid five-digit ZIP code' using errcode = '22023';
  end if;
  zip := left(zip, 5);
  street := btrim(coalesce(location ->> 'address', ''));
  city_name := btrim(coalesce(location ->> 'city', ''));
  state_code := upper(btrim(coalesce(location ->> 'state', '')));
  if street = '' or length(street) > 200 or city_name = '' or length(city_name) > 100
    or state_code !~ '^[A-Z]{2}$' then
    raise exception 'Service address required' using errcode = '22023';
  end if;

  if nullif(p_payload ->> 'preferred_date', '') is not null then
    begin
      window_start := (p_payload ->> 'preferred_date')::date;
    exception when others then
      raise exception 'Invalid preferred date' using errcode = '22023';
    end;
    if window_start < (now() at time zone 'America/New_York')::date then
      raise exception 'The preferred start date cannot be in the past' using errcode = '22023';
    end if;
  end if;
  window_text := nullif(btrim(coalesce(p_payload ->> 'preferred_time', '')), '');
  if length(window_text) > 200 then
    raise exception 'Invalid preferred time' using errcode = '22023';
  end if;

  selections := p_payload -> 'selections';
  if jsonb_typeof(selections) is distinct from 'array' then
    raise exception 'Choose at least one service' using errcode = '22023';
  end if;
  selection_count := jsonb_array_length(selections);
  if selection_count < 1 or selection_count > 20 then
    raise exception 'Choose between 1 and 20 services' using errcode = '22023';
  end if;

  -- Geography alone does not establish supply, but no request exists outside it.
  select * into area from public.coverage_areas where zip_code = zip;
  if not coalesce(area.is_active, false) then
    return jsonb_build_object(
      'status', 'refused',
      'coverage', case when area.has_waitlist then 'waitlist' else 'uncovered' end,
      'outcomes', '[]'::jsonb, 'requests', '[]'::jsonb, 'reused', false);
  end if;

  begin
    for idx in 0 .. selection_count - 1 loop
      selection := selections -> idx;
      if jsonb_typeof(selection) is distinct from 'object' then
        raise exception 'Invalid service selection' using errcode = '22023';
      end if;
      wanted_frequency := selection ->> 'frequency';
      if wanted_frequency is null
        or wanted_frequency not in ('weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly', 'one-time') then
        raise exception 'Invalid service frequency' using errcode = '22023';
      end if;
      if coalesce(selection ->> 'service_id', '') !~ '^[a-z0-9-]{1,100}$' then
        raise exception 'Invalid service' using errcode = '22023';
      end if;
      if (selection ->> 'service_id') = any(seen_services) then
        raise exception 'Each service can be selected once' using errcode = '22023';
      end if;
      seen_services := seen_services || (selection ->> 'service_id');
      if length(coalesce(selection ->> 'description', '')) > 5000 then
        raise exception 'Service description is too long' using errcode = '22023';
      end if;
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
      expected := selection -> 'expected';

      outcome := jsonb_build_object('selection_index', idx, 'service_id', selection ->> 'service_id');

      select * into service from public.services_catalog
      where id = selection ->> 'service_id' and is_active = true;
      if not found then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'service_not_offered'));
        continue;
      end if;
      if selected_provider is not null and not exists (select 1 from public.contractors where id = selected_provider) then
        refused := true;
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
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'invalid_package'));
          continue;
        end if;
        -- Rule tiers need their answers to be found at all, so report missing answers first.
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = offering.id and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required', 'questions', to_jsonb(missing_answers)));
          continue;
        end if;
      end if;

      -- The eligibility core reads the request row, so evaluate a provisional row and roll
      -- the whole plan back below if any selection is refused.
      insert into public.service_requests (
        customer_id, service_type, service_catalog_id, address, city, state, zip_code,
        preferred_date, preferred_time, description, frequency, preferred_contractor_id,
        contractor_id, package_id, package_tier_id, package_question_answers,
        pricing_mode, quote_only, total_amount, status, matching_status)
      values (
        actor, service.name, service.id, street, city_name, state_code, zip,
        window_start, window_text, nullif(btrim(coalesce(selection ->> 'description', '')), ''),
        wanted_frequency, selected_provider, null, wanted_package, wanted_tier, provisional_answers,
        'custom_quote', true, null, 'pending', 'awaiting_match')
      returning id into request_id;

      if not exists (select 1 from private.find_eligible_packages_core(request_id)) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'unavailable', 'reason', 'no_eligible_provider'));
        continue;
      end if;

      select eligible.* into candidate
      from private.find_eligible_packages_core(request_id) eligible
      where (selected_provider is null or eligible.contractor_id = selected_provider)
        and (wanted_package is null or eligible.package_id = wanted_package)
      order by (eligible.path = 'fixed') desc, eligible.effective_price asc nulls last, eligible.rank_order
      limit 1;
      if candidate.contractor_id is null then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome',
          case when wanted_package is not null then 'package_unavailable' else 'preferred_provider_unavailable' end));
        continue;
      end if;

      chosen_base := null;
      chosen_promotion := null;
      if candidate.path = 'fixed' then
        chosen_mode := 'fixed';
        chosen_package := candidate.package_id;
        chosen_tier := candidate.package_tier_id;
        chosen_total := candidate.effective_price;
        chosen_base := candidate.base_price;
        chosen_promotion := candidate.promotion_id;
        -- The core returns the lowest eligible tier; an explicitly chosen tier must itself
        -- match this frequency and the qualifying answers.
        if wanted_tier is not null and wanted_tier <> candidate.package_tier_id then
          select resolved.* into tier_price
          from public.package_tiers tier
          cross join lateral public.resolve_package_tier_price(tier.package_id, tier.id) resolved
          where tier.id = wanted_tier and tier.package_id = candidate.package_id
            and tier.frequency = wanted_frequency and tier.price > 0
            and (tier.rule_question_key is null or (
              coalesce(provisional_answers -> tier.rule_question_key ->> 'answer', '') ~ '^-?[0-9]+([.][0-9]+)?$'
              and (tier.rule_min is null or (provisional_answers -> tier.rule_question_key ->> 'answer')::numeric >= tier.rule_min)
              and (tier.rule_max is null or (provisional_answers -> tier.rule_question_key ->> 'answer')::numeric <= tier.rule_max)));
          if not found or coalesce(tier_price.effective_price, 0) <= 0 then
            refused := true;
            outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'package_unavailable'));
            continue;
          end if;
          chosen_tier := wanted_tier;
          chosen_total := tier_price.effective_price;
          chosen_base := tier_price.base_price;
          chosen_promotion := tier_price.promotion_id;
        end if;
      else
        chosen_mode := case when offering.id is not null then offering.pricing_mode else 'custom_quote' end;
        chosen_package := offering.id;
        chosen_tier := null;
        chosen_total := null;
      end if;

      if chosen_package is not null then
        select array_agg(question.question_key order by question.sort_order) into missing_answers
        from public.package_qualifying_questions question
        where question.package_id = chosen_package and question.is_required is not false
          and coalesce(provisional_answers -> question.question_key ->> 'answer', '') = '';
        if missing_answers is not null then
          refused := true;
          outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'answers_required', 'questions', to_jsonb(missing_answers)));
          continue;
        end if;
      end if;
      select coalesce(jsonb_object_agg(question.question_key, jsonb_build_object(
          'question', question.question_label,
          'answer', provisional_answers -> question.question_key ->> 'answer',
          'unit', nullif(question.unit, ''))), '{}'::jsonb)
      into labelled_answers
      from public.package_qualifying_questions question
      where question.package_id = chosen_package
        and coalesce(provisional_answers -> question.question_key ->> 'answer', '') <> '';

      -- The homeowner must have seen this pricing mode and amount; a mismatch is re-shown.
      if jsonb_typeof(expected) = 'object' and (
        (chosen_mode = 'fixed') is distinct from (expected ->> 'pricing_mode' = 'fixed')
        or (chosen_mode = 'fixed' and (jsonb_typeof(expected -> 'total') <> 'number'
          or round((expected ->> 'total')::numeric, 2) <> round(chosen_total, 2)))) then
        refused := true;
        outcomes := outcomes || (outcome || jsonb_build_object('outcome', 'price_changed',
          'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
          'total', chosen_total));
        continue;
      end if;

      update public.service_requests
      set pricing_mode = chosen_mode,
          quote_only = chosen_mode <> 'fixed',
          total_amount = chosen_total,
          base_amount = case when chosen_promotion is not null then chosen_base end,
          promotion_id = chosen_promotion,
          package_id = chosen_package,
          package_tier_id = chosen_tier,
          package_question_answers = labelled_answers
      where id = request_id;

      outcomes := outcomes || (outcome || jsonb_build_object(
        'outcome', case when chosen_mode = 'fixed' then 'eligible_fixed' else 'eligible_quote' end,
        'pricing_mode', case when chosen_mode = 'fixed' then 'fixed' else 'quote' end,
        'total', chosen_total));
      created := created || jsonb_build_object(
        'selection_index', idx, 'request_id', request_id, 'service_id', service.id,
        'pricing_mode', chosen_mode, 'quote_only', chosen_mode <> 'fixed',
        'total_amount', chosen_total, 'package_id', chosen_package, 'package_tier_id', chosen_tier);
    end loop;

    if refused then
      raise exception 'Submission refused' using errcode = 'MR095';
    end if;
  exception when sqlstate 'MR095' then
    -- Local variables survive the rollback of the provisional rows.
    return jsonb_build_object('status', 'refused', 'coverage', 'covered',
      'outcomes', outcomes, 'requests', '[]'::jsonb, 'reused', false);
  end;

  result := jsonb_build_object('status', 'submitted', 'coverage', 'covered',
    'outcomes', outcomes, 'requests', created);
  insert into public.service_request_submissions (customer_id, submission_key, payload_hash, result)
  values (actor, p_submission_key, digest, result)
  returning id into submission;
  insert into public.service_request_submission_items (submission_id, selection_index, service_request_id)
  select submission, (item ->> 'selection_index')::integer, (item ->> 'request_id')::uuid
  from jsonb_array_elements(created) item;

  return result || jsonb_build_object('reused', false);
end
$function$

;

-- Operator drafts ------------------------------------------------------------------

-- Cadence order and labels, as the vendor editor shows them.
create function private.pricing_cadence_rank(p_frequency text) returns integer
language sql immutable set search_path = '' as $$
  select array_position(array['one-time', 'weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly'], p_frequency)
$$;

create function private.pricing_cadence_label(p_frequency text) returns text
language sql immutable set search_path = '' as $$
  select case p_frequency
    when 'one-time' then 'One-time' when 'weekly' then 'Weekly' when 'bi-monthly' then 'Every two weeks'
    when 'monthly' then 'Monthly' when 'every-two-months' then 'Every two months' when 'quarterly' then 'Quarterly'
  end
$$;

create table private.operator_package_drafts (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  service_id text not null references public.services_catalog(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  -- [{frequency, price}] in cadence order, one price per cadence.
  prices jsonb not null check (jsonb_typeof(prices) = 'array' and jsonb_array_length(prices) between 1 and 6),
  status text not null default 'draft' check (status in ('draft', 'published', 'discarded')),
  package_id uuid references public.vendor_packages(id) on delete set null,
  publish_reason text check (publish_reason is null or length(btrim(publish_reason)) between 1 and 500),
  created_by uuid not null,
  updated_by uuid not null,
  closed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'draft') = (closed_at is null)),
  check ((status = 'published') = (package_id is not null or publish_reason is not null))
);
create index operator_package_drafts_contractor_idx
  on private.operator_package_drafts(contractor_id, updated_at desc) where status = 'draft';
alter table private.operator_package_drafts enable row level security;
revoke all on private.operator_package_drafts from public, anon, authenticated, service_role;

-- Validates [{frequency, price}] for a service and returns it in cadence order. A service
-- with a cadence list offers only those cadences, as in the vendor editor.
create function private.operator_draft_prices(p_prices jsonb, p_service text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  offered text[];
  entry jsonb;
  cadence text;
  amount numeric;
  seen text[] := '{}';
  result jsonb := '[]'::jsonb;
begin
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception 'Enter at least one price';
  end if;
  select coalesce(sc.available_frequencies, '{}') into offered
    from public.services_catalog sc where sc.id = p_service;
  for entry in select value from jsonb_array_elements(p_prices) loop
    cadence := entry->>'frequency';
    if private.pricing_cadence_rank(cadence) is null then raise exception 'Unknown cadence'; end if;
    if cadence = any(seen) then raise exception 'Enter one price per cadence'; end if;
    if cardinality(offered) > 0 and not cadence = any(offered) then
      raise exception '% is not offered for this service in the catalog', private.pricing_cadence_label(cadence);
    end if;
    amount := private.price_amount(entry->'price');
    if amount is null then raise exception 'Each price must be a positive amount in whole cents'; end if;
    seen := seen || cadence;
    result := result || jsonb_build_object('frequency', cadence, 'price', amount);
  end loop;
  return (select jsonb_agg(value order by private.pricing_cadence_rank(value->>'frequency'))
            from jsonb_array_elements(result));
end $$;

create function private.operator_package_draft_json(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_draft.id, 'contractor_id', p_draft.contractor_id,
    'contractor_name', (select c.name from public.contractors c where c.id = p_draft.contractor_id),
    'service_id', p_draft.service_id,
    'service_name', (select s.name from public.services_catalog s where s.id = p_draft.service_id),
    'name', p_draft.name, 'description', p_draft.description, 'prices', p_draft.prices,
    'status', p_draft.status, 'package_id', p_draft.package_id,
    'created_by_email', (select u.email from auth.users u where u.id = p_draft.created_by),
    'created_at', p_draft.created_at, 'updated_at', p_draft.updated_at)
$$;

-- Creates a draft (p_draft null) or replaces an open draft's content against the
-- updated_at the operator read. A draft stays with the vendor it was started for.
create function public.admin_save_package_draft(
  p_draft uuid, p_expected_updated_at timestamptz, p_contractor uuid, p_service text,
  p_name text, p_description text, p_prices jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  draft private.operator_package_drafts;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_description text := nullif(btrim(coalesce(p_description, '')), '');
  draft_prices jsonb;
begin
  actor := public.vendor_require_operator();
  if not exists (select 1 from public.contractors c where c.id = p_contractor) then
    raise exception 'Vendor not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.services_catalog s where s.id = p_service and s.is_active) then
    raise exception 'Choose an active catalog service';
  end if;
  if length(clean_name) = 0 then raise exception 'Package name required'; end if;
  if length(clean_name) > 120 then raise exception 'Package name too long'; end if;
  if length(clean_description) > 1000 then raise exception 'Description too long'; end if;
  draft_prices := private.operator_draft_prices(p_prices, p_service);

  if p_draft is null then
    insert into private.operator_package_drafts(contractor_id, service_id, name, description, prices, created_by, updated_by)
      values (p_contractor, p_service, clean_name, clean_description, draft_prices, actor, actor)
      returning * into draft;
  else
    select * into draft from private.operator_package_drafts where id = p_draft for update;
    if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
    if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
    if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
      raise exception 'Draft changed since it was read; reload before saving' using errcode = '40001';
    end if;
    if draft.contractor_id <> p_contractor then raise exception 'A draft stays with the vendor it was started for'; end if;
    update private.operator_package_drafts
       set service_id = p_service, name = clean_name, description = clean_description, prices = draft_prices,
           updated_by = actor, updated_at = now()
     where id = p_draft returning * into draft;
  end if;
  return private.operator_package_draft_json(draft);
end $$;

-- Open drafts, newest first; one vendor's or every vendor's.
create function public.admin_package_drafts(p_contractor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(private.operator_package_draft_json(d) order by d.updated_at desc, d.id)
    from private.operator_package_drafts d
   where d.status = 'draft' and (p_contractor is null or d.contractor_id = p_contractor)), '[]'::jsonb);
end $$;

create function public.admin_discard_package_draft(p_draft uuid, p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  draft private.operator_package_drafts;
begin
  actor := public.vendor_require_operator();
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
    raise exception 'Draft changed since it was read; reload before discarding' using errcode = '40001';
  end if;
  update private.operator_package_drafts
     set status = 'discarded', closed_by = actor, closed_at = now(), updated_by = actor, updated_at = now()
   where id = p_draft returning * into draft;
  return private.operator_package_draft_json(draft);
end $$;

create function public.admin_publish_package_draft(p_draft uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  reason text := btrim(coalesce(p_reason, ''));
  draft private.operator_package_drafts;
  service public.services_catalog;
  draft_prices jsonb;
  entry jsonb;
  clash text;
  primary_cadence text;
  new_package uuid;
  new_tier uuid;
  tier_order integer := 0;
  changes jsonb := '[]'::jsonb;
  review boolean;
  vendor_user uuid;
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Publish reason required'; end if;
  if length(reason) > 500 then raise exception 'Publish reason too long'; end if;

  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_expected_updated_at is null or draft.updated_at <> p_expected_updated_at then
    raise exception 'Draft changed since it was read; reload before publishing' using errcode = '40001';
  end if;
  select * into service from public.services_catalog s where s.id = draft.service_id;
  if not service.is_active then raise exception 'Choose an active catalog service'; end if;
  -- Re-checked: the catalog's cadence list may have changed since the draft was saved.
  draft_prices := private.operator_draft_prices(draft.prices, draft.service_id);

  -- Serialize with other publishes for this vendor, then refuse a duplicate live cadence.
  perform 1 from public.contractors c where c.id = draft.contractor_id for update;
  select string_agg(distinct private.pricing_cadence_label(t.frequency), ', ') into clash
    from public.vendor_packages p join public.package_tiers t on t.package_id = p.id
   where p.contractor_id = draft.contractor_id and p.service_id = draft.service_id and p.is_active
     and t.frequency in (select value->>'frequency' from jsonb_array_elements(draft_prices));
  if clash is not null then
    raise exception 'This vendor already has an active % price for this service; correct that package instead', clash
      using errcode = '23505';
  end if;

  primary_cadence := coalesce(
    (select value->>'frequency' from jsonb_array_elements(draft_prices) where value->>'frequency' = service.default_frequency),
    draft_prices->0->>'frequency');
  insert into public.vendor_packages(contractor_id, service_id, name, description, pricing_mode, default_frequency, is_active, needs_review)
    values (draft.contractor_id, draft.service_id, draft.name, draft.description, 'fixed', primary_cadence, true, false)
    returning id into new_package;
  for entry in select value from jsonb_array_elements(draft_prices) loop
    insert into public.package_tiers(package_id, name, price, frequency, includes, sort_order)
      values (new_package, private.pricing_cadence_label(entry->>'frequency'), (entry->>'price')::numeric,
              entry->>'frequency', '{}', tier_order)
      returning id into new_tier;
    changes := changes || jsonb_build_object('kind', 'tier', 'id', new_tier,
      'name', private.pricing_cadence_label(entry->>'frequency'), 'frequency', entry->>'frequency',
      'from', null, 'to', (entry->>'price')::numeric);
    tier_order := tier_order + 1;
  end loop;
  -- The review-flag trigger leaves an operator's write as given, so set it here.
  update public.vendor_packages set needs_review = public.custom_package_price_needs_review(new_package)
   where id = new_package returning needs_review into review;

  update private.operator_package_drafts
     set status = 'published', package_id = new_package, publish_reason = reason,
         closed_by = actor, closed_at = now(), updated_by = actor, updated_at = now()
   where id = p_draft;
  insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor)
    values (new_package, draft.contractor_id, draft.name, changes, reason, actor);

  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;
  if vendor_user is not null then
    perform public.notify_user(vendor_user, 'pricing', 'info', 'Mercurius added a price',
      draft.name || ': ' || reason, '/vendor/packages', null, draft.contractor_id);
  end if;

  return jsonb_build_object('package_id', new_package, 'needs_review', review, 'vendor_notified', vendor_user is not null);
end $$;

revoke all on function
  private.pricing_cadence_rank(text),
  private.pricing_cadence_label(text),
  private.operator_draft_prices(jsonb, text),
  private.operator_package_draft_json(private.operator_package_drafts),
  public.admin_save_package_draft(uuid, timestamptz, uuid, text, text, text, jsonb),
  public.admin_package_drafts(uuid),
  public.admin_discard_package_draft(uuid, timestamptz),
  public.admin_publish_package_draft(uuid, timestamptz, text)
from public, anon, authenticated, service_role;
grant execute on function
  public.admin_save_package_draft(uuid, timestamptz, uuid, text, text, text, jsonb),
  public.admin_package_drafts(uuid),
  public.admin_discard_package_draft(uuid, timestamptz),
  public.admin_publish_package_draft(uuid, timestamptz, text)
to authenticated;
