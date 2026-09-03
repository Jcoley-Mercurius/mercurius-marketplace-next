ALTER TABLE public.vendor_packages DROP CONSTRAINT IF EXISTS vendor_packages_default_frequency_check;
ALTER TABLE public.vendor_packages ADD CONSTRAINT vendor_packages_default_frequency_check
  CHECK (default_frequency IN ('weekly','monthly','bi-monthly','quarterly','one-time'));
UPDATE public.services_catalog
SET available_frequencies = ARRAY['monthly','bi-monthly','quarterly','one-time']
WHERE id = 'trash-can-cleaning';
UPDATE public.vendor_packages
SET default_frequency = 'bi-monthly'
WHERE id = 'a1b2c3d4-1001-4000-8000-000000000002';
