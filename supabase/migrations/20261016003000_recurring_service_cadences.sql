-- TRACE-111: recurring cadences offered on routine-maintenance services (owner decision
-- 2026-10-16, DEC-2026-036). Vendors (and operators, DEC-2026-035) can price only the
-- cadences a catalog service offers; before this almost no service offered every two
-- weeks, and none every two months.
--
-- Cadences are only added, never removed, and merged into each service's current list,
-- so a cadence an operator set in the Service Catalog meanwhile is kept. The default
-- cadence, prices, pricing mode and every existing vendor package are unchanged. Lists
-- keep the catalog's order: recurring from most to least frequent, then one-time. A
-- service with no list already offers every cadence and is left alone.
--
-- Added per service (existing cadences in brackets):
--   house-cleaning          every two weeks, every two months [weekly, monthly, quarterly, one-time]
--   lawn-mowing             every two weeks                   [weekly, monthly, one-time]
--   pool-service            every two weeks                   [weekly, monthly, one-time]
--   dumpster-cleaning       every two weeks, every two months [monthly, quarterly, one-time]
--   trash-can-cleaning      every two months                  [monthly, every two weeks, quarterly, one-time]
--   pest-control            every two months                  [monthly, quarterly, one-time]
--   floor-cleaning          every two months                  [monthly, quarterly, one-time]
--   shrub-hedge-trimming    every two months                  [monthly, quarterly, one-time]
--   window-cleaning         monthly, every two months         [quarterly, one-time]
--   irrigation-maintenance  monthly, every two months         [quarterly, one-time]
--   mulching-bed-care       monthly, every two months         [quarterly, one-time]
--   lawn-fertilization      every two months                  [quarterly, one-time]
-- Project work, repairs and seasonal or annual services (roofing, painting, HVAC, tree
-- trimming, gutters, pressure washing and the like) are unchanged.

with additions(service_id, cadences) as (values
  ('house-cleaning',         array['bi-monthly', 'every-two-months']),
  ('lawn-mowing',            array['bi-monthly']),
  ('pool-service',           array['bi-monthly']),
  ('dumpster-cleaning',      array['bi-monthly', 'every-two-months']),
  ('trash-can-cleaning',     array['every-two-months']),
  ('pest-control',           array['every-two-months']),
  ('floor-cleaning',         array['every-two-months']),
  ('shrub-hedge-trimming',   array['every-two-months']),
  ('window-cleaning',        array['monthly', 'every-two-months']),
  ('irrigation-maintenance', array['monthly', 'every-two-months']),
  ('mulching-bed-care',      array['monthly', 'every-two-months']),
  ('lawn-fertilization',     array['every-two-months'])
)
update public.services_catalog service
   set available_frequencies = (
         select array_agg(cadence order by coalesce(array_position(
                  array['weekly', 'bi-monthly', 'monthly', 'every-two-months', 'quarterly', 'one-time'], cadence), 99), cadence)
           from (select distinct unnest(coalesce(service.available_frequencies, '{}') || additions.cadences) as cadence) merged),
       updated_at = now()
  from additions
 where service.id = additions.service_id
   -- An empty list already offers every cadence; adding to it would narrow it.
   and cardinality(coalesce(service.available_frequencies, '{}')) > 0
   and not (coalesce(service.available_frequencies, '{}') @> additions.cadences);
