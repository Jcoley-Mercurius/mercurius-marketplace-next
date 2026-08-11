-- A custom fixed package may publish more than one cadence without creating a
-- parallel price store. vendor_packages.default_frequency remains the default
-- selection; each package tier now owns the cadence its price represents.

ALTER TABLE public.package_tiers
  ADD COLUMN IF NOT EXISTS frequency text;

UPDATE public.package_tiers tier
SET frequency = CASE
  WHEN package.default_frequency IN ('one-time', 'weekly', 'bi-monthly', 'monthly', 'quarterly')
    THEN package.default_frequency
  ELSE 'one-time'
END
FROM public.vendor_packages package
WHERE package.id = tier.package_id
  AND (
    tier.frequency IS NULL
    OR tier.frequency NOT IN ('one-time', 'weekly', 'bi-monthly', 'monthly', 'quarterly')
  );

ALTER TABLE public.package_tiers
  ALTER COLUMN frequency SET DEFAULT 'one-time',
  ALTER COLUMN frequency SET NOT NULL;

ALTER TABLE public.package_tiers
  DROP CONSTRAINT IF EXISTS package_tiers_frequency_check;
ALTER TABLE public.package_tiers
  ADD CONSTRAINT package_tiers_frequency_check
  CHECK (frequency IN ('one-time', 'weekly', 'bi-monthly', 'monthly', 'quarterly'));

CREATE INDEX IF NOT EXISTS idx_package_tiers_package_frequency
  ON public.package_tiers(package_id, frequency);

COMMENT ON COLUMN public.package_tiers.frequency IS
  'Cadence for this base-price tier. vendor_packages.default_frequency is the package default selection.';

-- Re-evaluate custom fixed prices against guidance for each tier cadence. Any
-- out-of-band tier keeps the whole package under review and therefore private.
CREATE OR REPLACE FUNCTION public.custom_package_price_needs_review(_package_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
        WHEN tier_record.frequency IN ('monthly', 'bi-monthly')
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
$$;

-- Recalculate existing custom packages after the cadence backfill.
UPDATE public.vendor_packages package
SET needs_review = public.custom_package_price_needs_review(package.id)
WHERE package.template_id IS NULL
  AND package.pricing_mode = 'fixed'
  AND package.needs_review IS DISTINCT FROM public.custom_package_price_needs_review(package.id);
