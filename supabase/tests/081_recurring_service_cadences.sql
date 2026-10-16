begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-111, DEC-2026-036 (20261016003000): recurring cadences offered on routine-maintenance
-- services. Catalog rows only; no vendor, customer or price data. Cadences are added, never
-- removed, in the catalog's order; other services and defaults are unchanged.
create function pg_temp.offered(p_id text) returns text[] language sql as $$
 select available_frequencies from public.services_catalog where id = p_id $$;

select is(pg_temp.offered('house-cleaning'), array['weekly','bi-monthly','monthly','every-two-months','quarterly','one-time'],
 'house cleaning offers weekly, every two weeks, monthly and every two months');
select is(pg_temp.offered('lawn-mowing'), array['weekly','bi-monthly','monthly','one-time'], 'lawn care adds every two weeks');
select is(pg_temp.offered('pool-service'), array['weekly','bi-monthly','monthly','one-time'], 'pool service adds every two weeks');
select is(pg_temp.offered('dumpster-cleaning'), array['bi-monthly','monthly','every-two-months','quarterly','one-time'],
 'dumpster cleaning adds every two weeks and every two months');
select is(pg_temp.offered('trash-can-cleaning'), array['bi-monthly','monthly','every-two-months','quarterly','one-time'],
 'trash can cleaning keeps every two weeks and adds every two months');
select is(pg_temp.offered('pest-control'), array['monthly','every-two-months','quarterly','one-time'], 'pest control adds every two months');
select is(pg_temp.offered('floor-cleaning'), array['monthly','every-two-months','quarterly','one-time'], 'floor cleaning adds every two months');
select is(pg_temp.offered('shrub-hedge-trimming'), array['monthly','every-two-months','quarterly','one-time'], 'shrub trimming adds every two months');
select is(pg_temp.offered('window-cleaning'), array['monthly','every-two-months','quarterly','one-time'], 'window cleaning adds monthly and every two months');
select is(pg_temp.offered('irrigation-maintenance'), array['monthly','every-two-months','quarterly','one-time'], 'irrigation adds monthly and every two months');
select is(pg_temp.offered('mulching-bed-care'), array['monthly','every-two-months','quarterly','one-time'], 'bed care adds monthly and every two months');
select is(pg_temp.offered('lawn-fertilization'), array['every-two-months','quarterly','one-time'], 'fertilization adds every two months');

-- Project and seasonal services are unchanged.
select is(pg_temp.offered('roof-inspection'), array['one-time'], 'roof inspection stays one-time');
select is(pg_temp.offered('ac-maintenance'), array['quarterly','one-time'], 'AC maintenance is unchanged');
select is(pg_temp.offered('tree-trimming'), array['quarterly','one-time'], 'tree trimming is unchanged');
select is((select count(*)::int from public.services_catalog where 'every-two-months' = any(available_frequencies)), 10,
 'every two months is offered on the ten chosen services only');
select is((select count(*)::int from public.services_catalog where 'bi-monthly' = any(available_frequencies)), 5,
 'every two weeks is offered on five services');

-- Every service still offers its default cadence and every cadence is known.
select is((select count(*)::int from public.services_catalog
  where cardinality(available_frequencies) > 0 and not default_frequency = any(available_frequencies)), 0,
 'each service still offers its default cadence');
select is((select count(*)::int from public.services_catalog, unnest(available_frequencies) cadence
  where cadence not in ('one-time','weekly','bi-monthly','monthly','every-two-months','quarterly')), 0,
 'every offered cadence is a known cadence');

select * from finish();
rollback;
