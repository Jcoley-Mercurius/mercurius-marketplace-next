-- Phase 6.11B / TRACE-134: vendor listing honesty. Record: governance/PHASE-6-VENDOR-OFFERINGS-BRIEF.md §9.
-- Additive; requires 20261104001000.
--
-- 1. DEC-2026-055 item 1: Special Offer no longer earns profile-strength points in matching. The
--    ranking is recorded as balanced-v2 on new offers (balanced-v1 offers keep their record). The
--    stored text is kept; operators still read it, and vendors can no longer overwrite it. Both
--    matching functions are restated with only that change.
-- 2. Legacy package promotions cannot be enabled on any path (F611-2): an overlay lowered the matched
--    and shown price that checkout refuses. Reviewed promotion offers (DEC-2026-038/041/042) and their
--    gate are unchanged. 0 enabled rows on hosted (2026-10-31).
-- 3. Public listings: Special Offer is not returned by r0_public_providers or readable anonymously
--    (operators read it through admin_vendor_special_offer); Services Offered come from live, review-cleared offerings.
-- 4. A version records when it was first published, so a never-published draft reads "Draft" and a
--    version taken out of public booking reads "Paused". Existing versions are treated as published.
--
-- Not changed: money and payout kernels, find_eligible_packages_core, resolve_package_tier_price,
-- money_source, eligibility, coverage, catalog and fees.



-- ── Special Offer kept for operators ─────────────────────────────────────────────────────────────

-- DEC-2026-055 item 1: the vendor no longer edits Special Offer, so its stored text stays as the
-- operator reads it. Restated with special_offer removed from the vendor's editable columns.
CREATE OR REPLACE FUNCTION public.enforce_contractor_update_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  allowed_cols text[] := array[
    'name','bio','location','phone','email','services','years_experience',
    'our_promise','tagline','website','video_url','logo_url','updated_at'
  ];
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  k text;
begin
  -- Bypass unless the invoking PostgREST role is authenticated.
  if current_setting('role', true) <> 'authenticated' then
    return new;
  end if;

  -- Bypass for admins
  if public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  -- Only applies to the vendor who owns this contractor row
  if auth.uid() is null or old.user_id is null or auth.uid() <> old.user_id then
    return new;
  end if;

  -- Ownership can never be changed by a vendor
  if new.user_id is distinct from old.user_id then
    raise exception 'Vendors cannot change ownership of a provider profile'
      using errcode = '42501';
  end if;

  for k in select jsonb_object_keys(new_j) loop
    if (old_j -> k) is distinct from (new_j -> k) and not (k = any (allowed_cols)) then
      raise exception 'Vendors are not allowed to modify "%" on a provider profile', k
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$function$;

-- Not readable by anonymous visitors. Signed-in reads stay for now: the deployed client still selects
-- the column (DEC-2026-037); revoking them is a follow-up once no deployed client does. Operators read
-- it through admin_vendor_special_offer, which this client uses.
revoke select (special_offer) on public.contractors from anon;

create or replace function public.admin_vendor_special_offer(p_contractor uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.vendor_require_operator();
  return (select c.special_offer from public.contractors c where c.id = p_contractor);
end $$;
revoke all on function public.admin_vendor_special_offer(uuid) from public, anon;
grant execute on function public.admin_vendor_special_offer(uuid) to authenticated;

-- ── Public provider listing ─────────────────────────────────────────────────────────────────────

-- Same signature. Special Offer is no longer returned (null). Services Offered are the catalog
-- services the provider currently offers through a live, review-cleared, unarchived offering: a
-- fixed price with valid exact levels, a Custom Quote, or a quote with a deposit (F611-4). A
-- service the provider lists without such an offering is not shown as offered; nothing becomes a
-- Custom Quote by itself (DEC-2026-051 item 2).
create or replace function public.r0_public_providers(p_contractor uuid default null)
returns table(id uuid, name text, logo_url text, bio text, location text, badges text[], services text[], years_experience integer,
  special_offer text, our_promise text, verified_specialty text, tagline text, video_url text, website text)
language sql
stable
security definer
set search_path = ''
as $function$
  select c.id, c.name, c.logo_url, c.bio, c.location, c.badges,
         coalesce(array(select distinct p.service_id from public.vendor_packages p
             join public.services_catalog s on s.id = p.service_id and s.is_active
            where p.contractor_id = c.id and p.is_active and p.needs_review is not true
              and not private.package_archived(p.id)
              and ((p.pricing_mode = 'fixed'
                    and exists (select 1 from public.package_tiers t where t.package_id = p.id and t.price > 0)
                    and not exists (select 1 from public.package_tiers t where t.package_id = p.id
                      and (t.price is null or t.price <= 0 or coalesce(t.price_kind, 'exact') <> 'exact')))
                or p.pricing_mode = 'custom_quote'
                or (p.pricing_mode = 'deposit_quote' and p.deposit_amount > 0))
            order by 1), '{}'::text[]),
         c.years_experience, null::text, c.our_promise, c.verified_specialty, c.tagline, c.video_url, c.website
    from public.contractors c
   where (p_contractor is null or c.id = p_contractor)
     and public.r0_provider_listable(c.id)
   order by c.name
$function$;

-- ── Legacy promotions closed ────────────────────────────────────────────────────────────────────

create or replace function private.package_promotion_legacy_closed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_enabled then
    raise exception 'Package promotions are closed; Mercurius offers use reviewed promotion offers' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.package_promotion_legacy_closed() from public, anon, authenticated;

create trigger trg_package_promotion_legacy_closed
  before insert or update on public.package_promotions
  for each row execute function private.package_promotion_legacy_closed();

-- ── First publication ───────────────────────────────────────────────────────────────────────────

-- Whether an existing paused version was ever live is not recorded; it reads "Paused", not "Draft".
-- A default fills existing rows without an UPDATE (archived rows refuse updates), then is dropped.
alter table public.vendor_packages add column first_published_at timestamptz default now();
alter table public.vendor_packages alter column first_published_at drop default;
grant select (first_published_at) on public.vendor_packages to anon, authenticated;

create or replace function private.vendor_package_first_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.first_published_at := old.first_published_at;
  else
    new.first_published_at := null;
  end if;
  if new.is_active and new.first_published_at is null then
    new.first_published_at := now();
  end if;
  return new;
end $$;
revoke all on function private.vendor_package_first_published() from public, anon, authenticated;

create trigger trg_vendor_package_first_published
  before insert or update on public.vendor_packages
  for each row execute function private.vendor_package_first_published();

-- ── Ranking without Special Offer (balanced-v2) ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION private.find_eligible_packages_with_answers(_request_id uuid, _service_id text, _frequency text, _zip_code text, _preferred_contractor_id uuid, _answers jsonb)
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
        -- TRACE-134 (DEC-2026-055 item 1, balanced-v2): Special Offer no longer earns profile points.
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
      COALESCE(history.decided, 0) AS decided,
      jsonb_array_length(private.pricing_tier_conditions(private.pricing_tier_json(tier))) > 0 AS conditioned
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
      -- TRACE-112: every condition of the level (its rule and rule_conditions) holds, or the
      -- answers are not being evaluated. A fixed package charges exact prices only.
      AND private.pricing_tier_matches(private.pricing_tier_json(tier), resolved_answers) IS NOT FALSE
      AND COALESCE(tier.price_kind, 'exact') = 'exact'
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
  ), fixed_counted AS (
    SELECT raw.*,
      count(*) OVER (PARTITION BY raw.package_id) AS matching_levels,
      bool_or(raw.conditioned) OVER (PARTITION BY raw.package_id) AS rule_based
    FROM fixed_raw raw
  ), fixed_candidates AS (
    -- TRACE-112: when several rule-based levels match the same answers, none is chosen.
    SELECT DISTINCT ON (raw.contractor_id, raw.package_id)
      raw.contractor_id, raw.contractor_name, raw.package_id, raw.package_tier_id, raw.promotion_id,
      raw.frequency, raw.path, raw.base_price, raw.effective_price, raw.updated_at, raw.strength,
      raw.has_badges, raw.accepted, raw.decided
    FROM fixed_counted raw
    WHERE NOT (resolved_answers IS NOT NULL AND raw.rule_based AND raw.matching_levels > 1)
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

CREATE OR REPLACE FUNCTION private.create_job_offer_internal(_request_id uuid, _contractor_id uuid, _package_id uuid DEFAULT NULL::uuid, _package_tier_id uuid DEFAULT NULL::uuid, _force boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
DECLARE
  candidate record;
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
      'expires_at', deadline, 'path', candidate.path, 'rank', candidate.rank_order, 'ranking_version','balanced-v2'));

  INSERT INTO public.notifications(user_id,type,severity,title,body,link,related_request_id,related_contractor_id)
    SELECT user_id,'job_offer','warning','New job offer — respond within four hours',
      'Accept or decline this exclusive offer before its four-hour deadline.','/vendor/jobs',_request_id,candidate.contractor_id
    FROM public.contractors WHERE id=candidate.contractor_id AND user_id IS NOT NULL;
  RETURN offer_id;
END;
$function$;
