-- Phase 2 public Plan Builder projection.
-- Ranking and eligibility remain owned by the Phase 1 core function; this
-- wrapper exposes only fields that are safe and useful on provider cards.

CREATE OR REPLACE FUNCTION public.find_public_eligible_providers(
  _service_id text,
  _frequency text,
  _zip_code text
)
RETURNS TABLE (
  contractor_id uuid,
  contractor_name text,
  logo_url text,
  area_hint text,
  badges text[],
  package_id uuid,
  package_tier_id uuid,
  promotion_id uuid,
  frequency text,
  path text,
  base_price numeric,
  effective_price numeric,
  rank_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
  WITH eligible AS (
    SELECT *
    FROM private.find_eligible_packages_core(
      NULL,
      _service_id,
      _frequency,
      CASE WHEN _zip_code ~ '^\d{5}$' THEN _zip_code ELSE NULL END,
      NULL
    )
  ), best_per_contractor AS (
    SELECT DISTINCT ON (candidate.contractor_id) candidate.*
    FROM eligible candidate
    ORDER BY candidate.contractor_id, candidate.rank_order
  )
  SELECT
    candidate.contractor_id,
    candidate.contractor_name,
    contractor.logo_url,
    contractor.location AS area_hint,
    COALESCE(contractor.badges, '{}'::text[]) AS badges,
    candidate.package_id,
    candidate.package_tier_id,
    candidate.promotion_id,
    candidate.frequency,
    candidate.path,
    candidate.base_price,
    candidate.effective_price,
    row_number() OVER (ORDER BY candidate.rank_order)::integer AS rank_order
  FROM best_per_contractor candidate
  JOIN public.contractors contractor ON contractor.id = candidate.contractor_id
  ORDER BY candidate.rank_order;
$$;

REVOKE ALL ON FUNCTION public.find_public_eligible_providers(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_public_eligible_providers(text, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.find_public_eligible_providers(text, text, text) IS
  'Public-safe Phase 2 projection of Phase 1 eligibility and ranking. Returns no internal scores.';
