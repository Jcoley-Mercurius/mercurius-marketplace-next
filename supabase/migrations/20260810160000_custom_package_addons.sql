-- Extend the existing managed package_addons table for vendor-created custom
-- extras. Managed rows keep template_addon_id; custom rows store their own
-- small display payload and never alter base package/tier pricing.
ALTER TABLE public.package_addons
  ALTER COLUMN template_addon_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.package_addons'::regclass
      AND conname = 'package_addons_custom_fields_check'
  ) THEN
    ALTER TABLE public.package_addons
      ADD CONSTRAINT package_addons_custom_fields_check CHECK (
        template_addon_id IS NOT NULL
        OR (
          nullif(btrim(name), '') IS NOT NULL
          AND char_length(btrim(name)) <= 80
          AND price > 0
          AND (description IS NULL OR char_length(description) <= 160)
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.package_addons.name IS
  'Vendor-facing name for a custom add-on; null for managed template add-ons.';
COMMENT ON COLUMN public.package_addons.description IS
  'Optional short description for a custom add-on.';

GRANT SELECT ON public.package_addons TO anon;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'package_addons'
      AND policyname = 'Anyone can read public custom package addons'
  ) THEN
    CREATE POLICY "Anyone can read public custom package addons"
      ON public.package_addons FOR SELECT TO anon, authenticated
      USING (
        template_addon_id IS NULL
        AND is_offered IS TRUE
        AND EXISTS (
          SELECT 1
          FROM public.vendor_packages vp
          JOIN public.contractors c ON c.id = vp.contractor_id
          WHERE vp.id = package_addons.package_id
            AND vp.is_active IS TRUE
            AND vp.needs_review IS NOT TRUE
            AND c.is_active IS TRUE
            AND c.marketing_enabled IS NOT FALSE
            AND (
              vp.pricing_mode = 'custom_quote'
              OR (
                vp.pricing_mode = 'deposit_quote'
                AND vp.deposit_amount IS NOT NULL
                AND vp.deposit_amount > 0
              )
              OR (
                vp.pricing_mode = 'fixed'
                AND EXISTS (
                  SELECT 1 FROM public.package_tiers pt
                  WHERE pt.package_id = vp.id
                )
                AND NOT EXISTS (
                  SELECT 1 FROM public.package_tiers pt
                  WHERE pt.package_id = vp.id
                    AND (pt.price IS NULL OR pt.price <= 0)
                )
              )
            )
        )
      );
  END IF;
END
$$;
