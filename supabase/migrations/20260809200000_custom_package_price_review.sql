-- Soft-launch price guardrail for vendor-created custom fixed packages.
--
-- Rule (mirrored in src/lib/vendorPricing.ts):
--   1. For one-time services with active managed-template tiers, use the
--      broadest configured template min/max range for that service.
--   2. Otherwise use 25%–400% of the service catalog guidance for the chosen
--      cadence (with documented cadence fallbacks).
--   3. If neither source exists, use an absolute $20–$5,000 fallback.
-- Any out-of-band tier flags the entire package. Public package queries already
-- exclude needs_review packages, while is_active remains unchanged so pause
-- controls continue to behave normally.

CREATE OR REPLACE FUNCTION public.custom_package_price_needs_review(_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  package_record public.vendor_packages%ROWTYPE;
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

  IF package_record.default_frequency = 'one-time' THEN
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
      WHEN package_record.default_frequency = 'weekly'
        THEN COALESCE(sc.weekly_price, sc.monthly_price, sc.one_time_price)
      WHEN package_record.default_frequency IN ('monthly', 'bi-monthly')
        THEN COALESCE(sc.monthly_price, sc.one_time_price)
      WHEN package_record.default_frequency = 'quarterly'
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

  RETURN EXISTS (
    SELECT 1
    FROM public.package_tiers tier
    WHERE tier.package_id = _package_id
      AND (
        tier.price IS NULL
        OR tier.price < min_allowed
        OR tier.price > max_allowed
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_custom_package_price_review_from_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_package_id uuid;
BEGIN
  target_package_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.package_id
    ELSE NEW.package_id
  END;

  UPDATE public.vendor_packages
  SET needs_review = public.custom_package_price_needs_review(target_package_id)
  WHERE id = target_package_id
    AND template_id IS NULL
    AND pricing_mode = 'fixed';

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_custom_package_review_from_tier ON public.package_tiers;
CREATE TRIGGER trg_refresh_custom_package_review_from_tier
AFTER INSERT OR UPDATE OR DELETE ON public.package_tiers
FOR EACH ROW EXECUTE FUNCTION public.refresh_custom_package_price_review_from_tier();

CREATE OR REPLACE FUNCTION public.refresh_custom_package_price_review_from_package()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.vendor_packages
  SET needs_review = public.custom_package_price_needs_review(NEW.id)
  WHERE id = NEW.id
    AND template_id IS NULL
    AND pricing_mode = 'fixed';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_custom_package_review_from_package ON public.vendor_packages;
CREATE TRIGGER trg_refresh_custom_package_review_from_package
AFTER UPDATE OF service_id, default_frequency, pricing_mode, template_id
ON public.vendor_packages
FOR EACH ROW EXECUTE FUNCTION public.refresh_custom_package_price_review_from_package();

-- Vendors may correct a flagged price, which clears the flag automatically.
-- They may not clear it manually while the saved tiers remain out of band.
-- Admin and service-role operations can explicitly clear a reviewed exception.
CREATE OR REPLACE FUNCTION public.enforce_custom_package_price_review_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.template_id IS NULL
    AND NEW.pricing_mode = 'fixed'
    AND COALESCE(auth.role(), '') <> 'service_role'
    AND NOT COALESCE(public.has_role(auth.uid(), 'admin'), false) THEN
    NEW.needs_review := public.custom_package_price_needs_review(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_custom_package_price_review_flag ON public.vendor_packages;
CREATE TRIGGER trg_enforce_custom_package_price_review_flag
BEFORE UPDATE OF needs_review ON public.vendor_packages
FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_package_price_review_flag();

-- Apply the same launch guardrail to existing custom fixed packages.
UPDATE public.vendor_packages package
SET needs_review = public.custom_package_price_needs_review(package.id)
WHERE package.template_id IS NULL
  AND package.pricing_mode = 'fixed'
  AND package.needs_review IS DISTINCT FROM public.custom_package_price_needs_review(package.id);

COMMENT ON FUNCTION public.custom_package_price_needs_review(uuid) IS
  'Returns whether a self-serve custom fixed package falls outside the soft-launch pricing sanity band.';
