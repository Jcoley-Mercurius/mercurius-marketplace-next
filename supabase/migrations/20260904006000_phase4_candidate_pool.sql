-- CFG-003/009: every eligible provider participates, including a selected quote provider.
-- Preserve balanced-v1 scoring and deterministic tie breaks; reviewed offerings only.
CREATE OR REPLACE FUNCTION private.find_eligible_packages_core(
  _request_id uuid DEFAULT NULL,
  _service_id text DEFAULT NULL,
  _frequency text DEFAULT NULL,
  _zip_code text DEFAULT NULL,
  _preferred_contractor_id uuid DEFAULT NULL
)
RETURNS TABLE (
  contractor_id uuid,
  contractor_name text,
  package_id uuid,
  package_tier_id uuid,
  promotion_id uuid,
  frequency text,
  path text,
  base_price numeric,
  effective_price numeric,
  median_fixed_price numeric,
  fixed_score numeric,
  profile_score numeric,
  verification_score numeric,
  price_band_score numeric,
  response_score numeric,
  freshness_score numeric,
  total_score numeric,
  preferred boolean,
  score_breakdown jsonb,
  rank_order integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  resolved_service_id text := _service_id;
  resolved_frequency text := _frequency;
  resolved_zip text := _zip_code;
  resolved_preferred uuid := _preferred_contractor_id;
  resolved_preferred_package uuid;
  resolved_preferred_tier uuid;
  resolved_answers jsonb := '{}'::jsonb;
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
$$;
