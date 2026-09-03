-- Update tier thresholds: Platinum now starts at 10,000; Gold extends to 9,999
CREATE OR REPLACE FUNCTION public.tier_for_points(_pts integer)
RETURNS public.loyalty_tier
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _pts >= 10000 THEN 'platinum'::public.loyalty_tier
    WHEN _pts >= 2500 THEN 'gold'::public.loyalty_tier
    WHEN _pts >= 500  THEN 'silver'::public.loyalty_tier
    ELSE 'bronze'::public.loyalty_tier
  END
$$;
