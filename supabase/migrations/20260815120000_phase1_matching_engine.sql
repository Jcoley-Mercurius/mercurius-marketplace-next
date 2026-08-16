-- Phase 1 managed matching engine.
-- Reuses service_requests as the job record and job_match_attempts as the
-- exclusive offer ledger. Ranking rules come from matching.md.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS preferred_contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matching_status text NOT NULL DEFAULT 'awaiting_match';

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_matching_status_check;
ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_matching_status_check
  CHECK (matching_status IN ('awaiting_match', 'offered', 'matched', 'quote_pending', 'sourcing', 'exhausted'));

ALTER TABLE public.job_match_attempts
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.vendor_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_tier_id uuid REFERENCES public.package_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.package_promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS frequency text,
  ADD COLUMN IF NOT EXISTS offer_path text,
  ADD COLUMN IF NOT EXISTS base_price numeric,
  ADD COLUMN IF NOT EXISTS effective_price numeric,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rank_order integer,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS declined_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz,
  ADD COLUMN IF NOT EXISTS response_actor_id uuid;

ALTER TABLE public.job_match_attempts
  DROP CONSTRAINT IF EXISTS job_match_attempts_offer_path_check;
ALTER TABLE public.job_match_attempts
  ADD CONSTRAINT job_match_attempts_offer_path_check
  CHECK (offer_path IS NULL OR offer_path IN ('fixed', 'quote'));

ALTER TABLE public.job_match_attempts
  DROP CONSTRAINT IF EXISTS job_match_attempts_outcome_check;
ALTER TABLE public.job_match_attempts
  ADD CONSTRAINT job_match_attempts_outcome_check
  CHECK (outcome IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn', 'reassigned'))
  NOT VALID;

-- Preserve only the newest pending row if legacy data contains duplicates,
-- then enforce sequential exclusivity at the database level.
WITH duplicate_pending AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY service_request_id
      ORDER BY offered_at DESC, created_at DESC, id DESC
    ) AS position
  FROM public.job_match_attempts
  WHERE outcome = 'pending'
)
UPDATE public.job_match_attempts attempt
SET outcome = 'withdrawn',
    withdrawn_at = now(),
    responded_at = COALESCE(attempt.responded_at, now()),
    reason = COALESCE(attempt.reason, 'Closed while enabling sequential exclusive offers'),
    updated_at = now()
FROM duplicate_pending duplicate
WHERE attempt.id = duplicate.id
  AND duplicate.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_match_attempts_one_pending_per_request
  ON public.job_match_attempts(service_request_id)
  WHERE outcome = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_match_attempts_request_outcome
  ON public.job_match_attempts(service_request_id, outcome, offered_at DESC);
CREATE INDEX IF NOT EXISTS idx_contractor_service_zips_zip_contractor
  ON public.contractor_service_zips(zip_code, contractor_id);

-- Internal core has no authorization branch so lifecycle RPCs can reuse the
-- exact same eligibility and ranking query. It is not exposed through PostgREST.
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
    WHERE NOT EXISTS (SELECT 1 FROM fixed_candidates)
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

CREATE OR REPLACE FUNCTION public.find_eligible_packages(
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
BEGIN
  IF _request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_requests request
    WHERE request.id = _request_id
      AND (
        request.customer_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.contractors contractor
          WHERE contractor.user_id = auth.uid()
            AND (
              contractor.id = request.contractor_id
              OR EXISTS (
                SELECT 1 FROM public.job_match_attempts attempt
                WHERE attempt.service_request_id = request.id
                  AND attempt.contractor_id = contractor.id
              )
            )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized to inspect matching for this request' USING ERRCODE = '42501';
  END IF;

  IF _request_id IS NULL AND auth.uid() IS NULL
    AND current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM private.find_eligible_packages_core(
    _request_id, _service_id, _frequency, _zip_code, _preferred_contractor_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.create_job_offer_internal(
  _request_id uuid,
  _contractor_id uuid,
  _package_id uuid DEFAULT NULL,
  _package_tier_id uuid DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  candidate record;
  current_offer uuid;
  offer_id uuid;
  next_attempt integer;
  deadline timestamptz := now() + interval '4 hours';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at < now();

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
      'expires_at', deadline, 'path', candidate.path, 'rank', candidate.rank_order));

  RETURN offer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_job_offer(
  _request_id uuid,
  _contractor_id uuid,
  _package_id uuid DEFAULT NULL,
  _package_tier_id uuid DEFAULT NULL,
  _force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
    AND current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN private.create_job_offer_internal(
    _request_id, _contractor_id, _package_id, _package_tier_id, _force
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.offer_next_for_request_internal(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  pending_offer uuid;
  candidate record;
  candidate_count integer;
  request_status public.request_status;
  request_matching_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_request_id::text, 0));

  SELECT request.status, request.matching_status
  INTO request_status, request_matching_status
  FROM public.service_requests request
  WHERE request.id = _request_id;
  IF request_status NOT IN ('pending', 'matched') OR request_matching_status = 'matched' THEN
    RETURN NULL;
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'expired', responded_at = now(), updated_at = now(),
      reason = COALESCE(reason, 'Response window expired')
  WHERE service_request_id = _request_id
    AND outcome = 'pending'
    AND expires_at < now();

  SELECT id INTO pending_offer
  FROM public.job_match_attempts
  WHERE service_request_id = _request_id AND outcome = 'pending'
  LIMIT 1;
  IF pending_offer IS NOT NULL THEN RETURN pending_offer; END IF;

  SELECT count(*) INTO candidate_count
  FROM private.find_eligible_packages_core(_request_id);

  SELECT eligible.* INTO candidate
  FROM private.find_eligible_packages_core(_request_id) eligible
  WHERE NOT EXISTS (
    SELECT 1 FROM public.job_match_attempts previous
    WHERE previous.service_request_id = _request_id
      AND previous.contractor_id = eligible.contractor_id
      AND previous.outcome IN ('accepted', 'declined', 'expired', 'withdrawn')
  )
  ORDER BY eligible.rank_order
  LIMIT 1;

  IF candidate.contractor_id IS NULL THEN
    UPDATE public.service_requests
    SET contractor_id = NULL,
        assigned_at = NULL,
        match_expires_at = NULL,
        status = 'pending',
        matching_status = CASE WHEN candidate_count = 0 THEN 'sourcing' ELSE 'exhausted' END,
        needs_admin_review = true,
        updated_at = now()
    WHERE id = _request_id;
    RETURN NULL;
  END IF;

  RETURN private.create_job_offer_internal(
    _request_id, candidate.contractor_id, candidate.package_id,
    candidate.package_tier_id, false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.offer_next_for_request(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_requests request
    WHERE request.id = _request_id
      AND (
        request.customer_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
        OR EXISTS (
          SELECT 1 FROM public.job_match_attempts attempt
          JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
          WHERE attempt.service_request_id = request.id AND contractor.user_id = auth.uid()
        )
      )
  ) THEN
    RAISE EXCEPTION 'Not authorized to advance this request' USING ERRCODE = '42501';
  END IF;
  RETURN private.offer_next_for_request_internal(_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_request_matching(_request_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  request_status public.request_status;
  request_matching_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.service_requests request
    WHERE request.id = _request_id
      AND (request.customer_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR current_setting('request.jwt.claim.role', true) = 'service_role')
  ) THEN
    RAISE EXCEPTION 'Not authorized to start matching for this request' USING ERRCODE = '42501';
  END IF;
  SELECT request.status, request.matching_status
  INTO request_status, request_matching_status
  FROM public.service_requests request
  WHERE request.id = _request_id;
  IF request_status NOT IN ('pending', 'matched') OR request_matching_status = 'matched' THEN
    RETURN NULL;
  END IF;
  RETURN private.offer_next_for_request_internal(_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_contractor(_job_id uuid, _contractor_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  PERFORM private.create_job_offer_internal(_job_id, _contractor_id, NULL, NULL, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.vendor_decline_job(_job_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  offer record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND (contractor.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ORDER BY attempt.offered_at DESC
  LIMIT 1;

  IF offer.id IS NULL THEN
    RAISE EXCEPTION 'No open offer is available to decline';
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'declined', declined_at = now(), responded_at = now(),
      response_actor_id = auth.uid(), reason = COALESCE(_reason, 'Vendor declined'),
      updated_at = now()
  WHERE id = offer.id;

  UPDATE public.service_requests request
  SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
      status = 'pending', matching_status = 'awaiting_match',
      declined_contractor_ids = CASE
        WHEN offer.contractor_id = ANY(COALESCE(request.declined_contractor_ids, '{}'::uuid[]))
          THEN COALESCE(request.declined_contractor_ids, '{}'::uuid[])
        ELSE array_append(COALESCE(request.declined_contractor_ids, '{}'::uuid[]), offer.contractor_id)
      END,
      updated_at = now()
  WHERE request.id = _job_id;

  INSERT INTO public.job_events(job_id, event_type, actor_id, metadata)
  VALUES (_job_id, 'match_declined', auth.uid(),
    jsonb_build_object('offer_id', offer.id, 'contractor_id', offer.contractor_id,
      'reason', COALESCE(_reason, 'Vendor declined')));
  PERFORM private.offer_next_for_request_internal(_job_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.vendor_accept_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  offer record;
  still_eligible boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  SELECT attempt.* INTO offer
  FROM public.job_match_attempts attempt
  JOIN public.contractors contractor ON contractor.id = attempt.contractor_id
  WHERE attempt.service_request_id = _job_id
    AND attempt.outcome = 'pending'
    AND (contractor.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ORDER BY attempt.offered_at DESC
  LIMIT 1;

  IF offer.id IS NULL THEN
    RAISE EXCEPTION 'No open offer is available to accept';
  END IF;

  IF offer.expires_at < now() THEN
    UPDATE public.job_match_attempts
    SET outcome = 'expired', responded_at = now(), updated_at = now(),
        reason = COALESCE(reason, 'Response window expired')
    WHERE id = offer.id;
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match', updated_at = now()
    WHERE id = _job_id;
    PERFORM private.offer_next_for_request_internal(_job_id);
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM private.find_eligible_packages_core(_job_id) eligible
    WHERE eligible.contractor_id = offer.contractor_id
      AND eligible.package_id = offer.package_id
      AND (offer.package_tier_id IS NULL OR eligible.package_tier_id = offer.package_tier_id)
  ) INTO still_eligible;

  IF NOT still_eligible THEN
    UPDATE public.job_match_attempts
    SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
        reason = 'Eligibility changed before acceptance', updated_at = now()
    WHERE id = offer.id;
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match', updated_at = now()
    WHERE id = _job_id;
    PERFORM private.offer_next_for_request_internal(_job_id);
    RETURN;
  END IF;

  UPDATE public.job_match_attempts
  SET outcome = 'accepted', accepted_at = now(), responded_at = now(),
      response_actor_id = auth.uid(), updated_at = now()
  WHERE id = offer.id;
  UPDATE public.job_match_attempts
  SET outcome = 'withdrawn', withdrawn_at = now(), responded_at = now(),
      reason = COALESCE(reason, 'Another offer was accepted'), updated_at = now()
  WHERE service_request_id = _job_id AND outcome = 'pending' AND id <> offer.id;

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
END;
$$;

CREATE OR REPLACE FUNCTION public.release_job_match(
  _job_id uuid,
  _contractor_id uuid,
  _outcome text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
    AND current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.job_match_attempts
  SET outcome = CASE WHEN _outcome IN ('declined', 'expired', 'withdrawn') THEN _outcome ELSE 'withdrawn' END,
      responded_at = now(),
      declined_at = CASE WHEN _outcome = 'declined' THEN now() ELSE declined_at END,
      withdrawn_at = CASE WHEN _outcome NOT IN ('declined', 'expired') THEN now() ELSE withdrawn_at END,
      reason = _reason,
      updated_at = now()
  WHERE service_request_id = _job_id AND contractor_id = _contractor_id AND outcome = 'pending';
  UPDATE public.service_requests
  SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
      status = 'pending', matching_status = 'awaiting_match', updated_at = now()
  WHERE id = _job_id AND contractor_id = _contractor_id;
  PERFORM private.offer_next_for_request_internal(_job_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  stale_request_id uuid;
  expired_count integer := 0;
  row_count integer;
BEGIN
  IF auth.uid() IS NULL
    AND current_setting('request.jwt.claim.role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  FOR stale_request_id IN
    SELECT DISTINCT attempt.service_request_id
    FROM public.job_match_attempts attempt
    WHERE attempt.outcome = 'pending'
      AND attempt.expires_at < now()
      AND (
        public.has_role(auth.uid(), 'admin')
        OR current_setting('request.jwt.claim.role', true) = 'service_role'
        OR EXISTS (
          SELECT 1
          FROM public.contractors contractor
          WHERE contractor.id = attempt.contractor_id
            AND contractor.user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1
          FROM public.service_requests request
          WHERE request.id = attempt.service_request_id
            AND request.customer_id = auth.uid()
        )
      )
  LOOP
    UPDATE public.job_match_attempts
    SET outcome = 'expired', responded_at = now(), updated_at = now(),
        reason = COALESCE(reason, 'Response window expired')
    WHERE service_request_id = stale_request_id AND outcome = 'pending' AND expires_at < now();
    GET DIAGNOSTICS row_count = ROW_COUNT;
    expired_count := expired_count + row_count;
    UPDATE public.service_requests
    SET contractor_id = NULL, assigned_at = NULL, match_expires_at = NULL,
        status = 'pending', matching_status = 'awaiting_match',
        last_match_expired_at = now(), updated_at = now()
    WHERE id = stale_request_id;
    PERFORM private.offer_next_for_request_internal(stale_request_id);
  END LOOP;
  RETURN expired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.find_eligible_packages(uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_job_offer(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.offer_next_for_request(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_request_matching(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_matches() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_eligible_packages(uuid, text, text, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_job_offer(uuid, uuid, uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.offer_next_for_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_request_matching(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_matches() TO authenticated, service_role;

COMMENT ON FUNCTION public.find_eligible_packages(uuid, text, text, text, uuid) IS
  'Phase 1 balanced matching eligibility/ranking. marketing_enabled and exact active ZIP coverage are required.';
COMMENT ON FUNCTION public.start_request_matching(uuid) IS
  'Idempotent sequential-exclusive matching entry point. Creates at most one four-hour offer.';
