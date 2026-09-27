-- TRACE-095: authoritative, duplicate-safe homeowner request submission (Phase 6 slice 6.1;
-- MPS §6.1/§6.2; CFG-001–003/009; DEC-2026-020).
--
-- Before this migration the intake page inserted service_requests rows directly from the
-- browser. The only database check was customer_id = auth.uid(): any status, price,
-- contractor, package, tier or ZIP was accepted, a failed price lookup was submitted as a
-- quote, and a configuration with no eligible provider still created an active request that
-- matching later marked exhausted. A homeowner could also move a pending request to another
-- ZIP after submission.
--
-- Now:
-- 1. submit_service_requests is the only homeowner write path. It derives the owner from
--    auth.uid(), re-checks the exact active coverage ZIP and each selection against
--    private.find_eligible_packages_core (service, frequency, qualifying answers, provider,
--    package and current onboarding eligibility), and derives pricing mode, tier, amount and
--    promotion on the server. A browser amount is only compared, never stored.
-- 2. A plan is all or nothing (DEC-2026-020). If any selection is unavailable, invalid,
--    stale or priced differently from what the homeowner saw, no request is created and every
--    selection's outcome is returned. Uncovered ZIPs and uncataloged services create nothing.
-- 3. A submission key binds a retry to its actor and exact payload. Repeating it returns the
--    stored result; reusing it with a different payload is refused. Each accepted selection
--    creates exactly one request.
-- 4. authenticated loses INSERT on service_requests, and homeowners can no longer change
--    zip_code on a pending request. Admin writes and security-definer functions are unchanged.
--
-- Matching, photos and checkout continue from the browser after submission, as before.
-- Selection ranking is unchanged: without an explicit offering the lowest eligible fixed price
-- is chosen (as the intake page did); quote-only supply creates a custom_quote request.

create table public.service_request_submissions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  submission_key text not null check (submission_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_hash bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (customer_id, submission_key)
);
comment on table public.service_request_submissions is
  'TRACE-095: one row per accepted homeowner submission; replays return the stored result.';

create table public.service_request_submission_items (
  submission_id uuid not null references public.service_request_submissions(id) on delete cascade,
  selection_index integer not null check (selection_index >= 0),
  service_request_id uuid not null unique references public.service_requests(id) on delete cascade,
  primary key (submission_id, selection_index)
);
comment on table public.service_request_submission_items is
  'TRACE-095: exactly one service request per accepted selection of a submission.';

alter table public.service_request_submissions enable row level security;
alter table public.service_request_submission_items enable row level security;
revoke all on public.service_request_submissions, public.service_request_submission_items
  from public, anon, authenticated;

create function public.submit_service_requests(p_submission_key text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.submit_service_requests(text, jsonb) from public, anon;
grant execute on function public.submit_service_requests(text, jsonb) to authenticated;
comment on function public.submit_service_requests(text, jsonb) is
  'TRACE-095: the homeowner request write path. Server-derived coverage, eligibility and price; all-or-nothing plans; key-bound replay.';

-- Close the direct browser write path now that the intake page uses the command above.
revoke insert on public.service_requests from authenticated;

-- A pending request's ZIP decided its coverage and eligibility; homeowners may still correct
-- descriptive address fields. Body otherwise unchanged from 20260903230000.
create or replace function public.enforce_homeowner_update_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  allowed_cols text[] := ARRAY[
    'description','preferred_date','preferred_time','address','city','state','notes','updated_at'
  ];
  old_j jsonb := to_jsonb(OLD);
  new_j jsonb := to_jsonb(NEW);
  k text;
BEGIN
  -- Bypass unless the invoking PostgREST role is authenticated.
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- Bypass for admins
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Only applies to the homeowner who owns the job
  IF auth.uid() IS NULL OR auth.uid() <> OLD.customer_id THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending'::public.request_status THEN
    PERFORM public.log_status_rejection(NEW.id, OLD.status::text, NEW.status::text,
      'homeowner_edit_after_pending', NULL);
    RAISE EXCEPTION 'This request can no longer be edited directly'
      USING ERRCODE = '42501';
  END IF;

  FOR k IN SELECT jsonb_object_keys(new_j) LOOP
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) AND NOT (k = ANY (allowed_cols)) THEN
      RAISE EXCEPTION 'Homeowners are not allowed to modify "%" on a service request', k
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
