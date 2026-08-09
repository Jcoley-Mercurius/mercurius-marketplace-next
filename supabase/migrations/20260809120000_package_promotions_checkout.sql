-- Scheduled promotion overlays for vendor package tiers. Base tier prices remain
-- authoritative and are never rewritten by promotions.
CREATE TABLE IF NOT EXISTS public.package_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.vendor_packages(id) ON DELETE CASCADE,
  promotion_type text NOT NULL CHECK (promotion_type IN ('percent_off', 'fixed_price')),
  percent_off numeric,
  fixed_price numeric,
  label text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_promotions_valid_window CHECK (ends_at > starts_at),
  CONSTRAINT package_promotions_short_label CHECK (label IS NULL OR char_length(trim(label)) <= 48),
  CONSTRAINT package_promotions_type_value CHECK (
    (promotion_type = 'percent_off' AND percent_off > 0 AND percent_off <= 80 AND fixed_price IS NULL)
    OR
    (promotion_type = 'fixed_price' AND fixed_price > 0 AND percent_off IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_package_promotions_package
  ON public.package_promotions(package_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_promotions_one_enabled
  ON public.package_promotions(package_id)
  WHERE is_enabled = true;

CREATE OR REPLACE FUNCTION public.validate_package_promotion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  package_record public.vendor_packages%ROWTYPE;
  tier_count integer;
  invalid_tier_count integer;
  single_base_price numeric;
BEGIN
  IF NOT NEW.is_enabled THEN
    RETURN NEW;
  END IF;

  SELECT * INTO package_record
  FROM public.vendor_packages
  WHERE id = NEW.package_id;

  IF package_record.id IS NULL
    OR package_record.is_active IS NOT TRUE
    OR package_record.needs_review IS TRUE
    OR package_record.pricing_mode <> 'fixed' THEN
    RAISE EXCEPTION 'Promotions require an active, review-cleared fixed-price package';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE price IS NULL OR price <= 0), min(price)
  INTO tier_count, invalid_tier_count, single_base_price
  FROM public.package_tiers
  WHERE package_id = NEW.package_id;

  IF tier_count = 0 OR invalid_tier_count > 0 THEN
    RAISE EXCEPTION 'Promotions require valid positive prices on every package tier';
  END IF;

  IF NEW.promotion_type = 'fixed_price' THEN
    IF tier_count <> 1 THEN
      RAISE EXCEPTION 'Fixed promotional prices require a single-tier package';
    END IF;
    IF NEW.fixed_price >= single_base_price THEN
      RAISE EXCEPTION 'Fixed promotional price must be below the base price';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_package_promotion ON public.package_promotions;
CREATE TRIGGER trg_validate_package_promotion
BEFORE INSERT OR UPDATE ON public.package_promotions
FOR EACH ROW EXECUTE FUNCTION public.validate_package_promotion();

DROP TRIGGER IF EXISTS trg_package_promotions_updated ON public.package_promotions;
CREATE TRIGGER trg_package_promotions_updated
BEFORE UPDATE ON public.package_promotions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.package_promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public views promotions for eligible packages" ON public.package_promotions;
CREATE POLICY "Public views promotions for eligible packages"
ON public.package_promotions FOR SELECT TO public
USING (
  is_enabled = true
  AND package_id IN (
    SELECT vp.id
    FROM public.vendor_packages vp
    JOIN public.contractors c ON c.id = vp.contractor_id
    WHERE vp.is_active = true
      AND vp.needs_review IS NOT TRUE
      AND vp.pricing_mode = 'fixed'
      AND c.is_active = true
  )
);

DROP POLICY IF EXISTS "Vendors manage own package promotions" ON public.package_promotions;
CREATE POLICY "Vendors manage own package promotions"
ON public.package_promotions FOR ALL TO authenticated
USING (
  package_id IN (
    SELECT vp.id
    FROM public.vendor_packages vp
    JOIN public.contractors c ON c.id = vp.contractor_id
    WHERE c.user_id = auth.uid()
  )
)
WITH CHECK (
  package_id IN (
    SELECT vp.id
    FROM public.vendor_packages vp
    JOIN public.contractors c ON c.id = vp.contractor_id
    WHERE c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Admins manage package promotions" ON public.package_promotions;
CREATE POLICY "Admins manage package promotions"
ON public.package_promotions FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.pricing_server_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT now(); $$;

GRANT EXECUTE ON FUNCTION public.pricing_server_now() TO anon, authenticated;

-- This is the final authority used by checkout-request. It returns no row when
-- the package/tier is no longer publicly bookable and evaluates promotions with
-- database time, not a client timestamp.
CREATE OR REPLACE FUNCTION public.resolve_package_tier_price(
  p_package_id uuid,
  p_tier_id uuid
)
RETURNS TABLE (
  base_price numeric,
  effective_price numeric,
  promotion_id uuid,
  promotion_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible AS (
    SELECT
      pt.price AS base_price,
      (SELECT count(*) FROM public.package_tiers all_tiers WHERE all_tiers.package_id = vp.id) AS tier_count
    FROM public.vendor_packages vp
    JOIN public.contractors c ON c.id = vp.contractor_id AND c.is_active = true
    JOIN public.package_tiers pt ON pt.package_id = vp.id AND pt.id = p_tier_id
    WHERE vp.id = p_package_id
      AND vp.is_active = true
      AND vp.needs_review IS NOT TRUE
      AND vp.pricing_mode = 'fixed'
      AND pt.price > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.package_tiers invalid
        WHERE invalid.package_id = vp.id AND (invalid.price IS NULL OR invalid.price <= 0)
      )
  ), active_promotion AS (
    SELECT pp.*
    FROM public.package_promotions pp
    WHERE pp.package_id = p_package_id
      AND pp.is_enabled = true
      AND now() >= pp.starts_at
      AND now() < pp.ends_at
    LIMIT 1
  )
  SELECT
    e.base_price,
    CASE
      WHEN ap.promotion_type = 'percent_off'
        AND ap.percent_off > 0 AND ap.percent_off <= 80
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) > 0
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) < e.base_price
        THEN round(e.base_price * (1 - ap.percent_off / 100), 2)
      WHEN ap.promotion_type = 'fixed_price'
        AND e.tier_count = 1
        AND ap.fixed_price > 0 AND ap.fixed_price < e.base_price
        THEN ap.fixed_price
      ELSE e.base_price
    END AS effective_price,
    CASE
      WHEN ap.promotion_type = 'percent_off' AND ap.percent_off > 0 AND ap.percent_off <= 80
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) > 0
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) < e.base_price THEN ap.id
      WHEN ap.promotion_type = 'fixed_price' AND e.tier_count = 1 AND ap.fixed_price > 0 AND ap.fixed_price < e.base_price THEN ap.id
      ELSE NULL
    END AS promotion_id,
    CASE
      WHEN ap.promotion_type = 'percent_off' AND ap.percent_off > 0 AND ap.percent_off <= 80
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) > 0
        AND round(e.base_price * (1 - ap.percent_off / 100), 2) < e.base_price THEN ap.label
      WHEN ap.promotion_type = 'fixed_price' AND e.tier_count = 1 AND ap.fixed_price > 0 AND ap.fixed_price < e.base_price THEN ap.label
      ELSE NULL
    END AS promotion_label
  FROM eligible e
  LEFT JOIN active_promotion ap ON true;
$$;

REVOKE ALL ON FUNCTION public.resolve_package_tier_price(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_package_tier_price(uuid, uuid) TO anon, authenticated;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS base_amount numeric,
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.package_promotions(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS base_amount numeric,
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.package_promotions(id) ON DELETE SET NULL;
