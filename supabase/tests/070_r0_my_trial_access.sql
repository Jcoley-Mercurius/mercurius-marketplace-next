-- TRACE-103: a homeowner reads only their own R0 trial admission, and reading grants nothing.
-- Synthetic users/coverage only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('e7000000-0000-4000-8000-000000000001','{}'),
 ('e7000000-0000-4000-8000-000000000002','{}'),
 ('e7000000-0000-4000-8000-000000000003','{}');
-- The signup trigger gives each new account the homeowner role; the operator is admin only.
insert into public.user_roles(user_id,role) values ('e7000000-0000-4000-8000-000000000003','admin');
delete from public.user_roles where user_id='e7000000-0000-4000-8000-000000000003' and role='homeowner';
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist)
 values ('00070','Synthetic',true,false),('00071','Synthetic',true,false);
insert into private.r0_lee_zips values ('00070'),('00071');
insert into private.r0_trial_operators(user_id,reason)
 values ('e7000000-0000-4000-8000-000000000003','Synthetic owner authorization');

create function pg_temp.as_user(p_actor uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_actor)::text,true);
 set local role authenticated;
end $$;
create function pg_temp.access(p_actor uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform pg_temp.as_user(p_actor);
 result := public.r0_my_trial_access();
 reset role;
 return result;
end $$;
create function pg_temp.set_access(p_homeowner uuid,p_zip text,p_service text,p_allowed boolean)
returns void language plpgsql as $$
begin
 perform pg_temp.as_user('e7000000-0000-4000-8000-000000000003');
 perform public.r0_set_trial_admission(p_homeowner,p_zip,p_service,p_allowed,'Synthetic review');
 reset role;
end $$;
create function pg_temp.submit_lawn(p_actor uuid) returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform pg_temp.as_user(p_actor);
 result := public.submit_service_requests('r0-access-key-000001',jsonb_build_object(
  'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00070'),
  'selections',jsonb_build_array(jsonb_build_object('service_id','lawn-mowing','frequency','one-time'))));
 reset role;
 return result;
end $$;
create function pg_temp.states(p_actor uuid) returns text language sql as $$
 select coalesce(string_agg(c->>'zip_code'||':'||(c->>'service_id')||':'||(c->>'state'),',' order by c->>'zip_code', c->>'service_id'),'')
 from jsonb_array_elements(pg_temp.access(p_actor)->'cells') c $$;

-- Privilege boundary.
select ok(has_function_privilege('authenticated','public.r0_my_trial_access()','EXECUTE'),
 'a signed-in account can read its own access');
select ok(not has_function_privilege('anon','public.r0_my_trial_access()','EXECUTE'),
 'anonymous visitors cannot call the readback');
select ok(not has_function_privilege('service_role','public.r0_my_trial_access()','EXECUTE'),
 'the service key cannot call the readback');
select is((select provolatile from pg_proc where oid='public.r0_my_trial_access()'::regprocedure),'s'::"char",
 'the readback is declared read-only (stable)');
select throws_ok($$select public.r0_my_trial_access()$$,'42501','Authentication required',
 'no identity, no answer');

-- Default closed: a homeowner account alone has no cells.
select is(pg_temp.access('e7000000-0000-4000-8000-000000000001'),
 '{"homeowner": true, "cells": []}'::jsonb,'a new homeowner has no admission');
select is(pg_temp.access('e7000000-0000-4000-8000-000000000003')->>'homeowner','false',
 'the homeowner flag reflects the role');

-- Grant, and the readback shows only the caller's own cells.
select pg_temp.set_access('e7000000-0000-4000-8000-000000000001','00070','lawn-mowing',true);
select pg_temp.set_access('e7000000-0000-4000-8000-000000000001','00071','ac-maintenance',true);
select pg_temp.set_access('e7000000-0000-4000-8000-000000000002','00070','deep-cleaning',true);
select is(pg_temp.states('e7000000-0000-4000-8000-000000000001'),
 '00070:lawn-mowing:active,00071:ac-maintenance:active','admitted cells read back as active');
select is(pg_temp.states('e7000000-0000-4000-8000-000000000002'),
 '00070:deep-cleaning:active','another homeowner sees only their own cell');
select is((select c->>'service_name' from jsonb_array_elements(pg_temp.access('e7000000-0000-4000-8000-000000000001')->'cells') c
  where c->>'service_id'='lawn-mowing'),
 (select name from public.services_catalog where id='lawn-mowing'),'the service name comes from the catalog');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(pg_temp.access('e7000000-0000-4000-8000-000000000001')->'cells') c,
  jsonb_object_keys(c) k),
 array['changed_at','service_id','service_name','state','zip_code'],
 'no operator identity, reason or homeowner id is exposed');

-- Unavailable: area or service no longer active. Revoked: history kept, state explains.
update public.coverage_areas set is_active=false where zip_code='00071';
select is(pg_temp.states('e7000000-0000-4000-8000-000000000001'),
 '00070:lawn-mowing:active,00071:ac-maintenance:unavailable','an inactive area reads as unavailable');
update public.coverage_areas set is_active=true where zip_code='00071';
update public.services_catalog set is_active=false where id='ac-maintenance';
select is(pg_temp.states('e7000000-0000-4000-8000-000000000001'),
 '00070:lawn-mowing:active,00071:ac-maintenance:unavailable','an inactive service reads as unavailable');
update public.services_catalog set is_active=true where id='ac-maintenance';
delete from private.r0_lee_zips where zip_code='00071';
select is(pg_temp.states('e7000000-0000-4000-8000-000000000001'),
 '00070:lawn-mowing:active,00071:ac-maintenance:unavailable','a ZIP outside the Lee boundary reads as unavailable');
insert into private.r0_lee_zips values ('00071');
select pg_temp.set_access('e7000000-0000-4000-8000-000000000001','00070','lawn-mowing',false);
select is(pg_temp.states('e7000000-0000-4000-8000-000000000001'),
 '00070:lawn-mowing:revoked,00071:ac-maintenance:active','a revoked cell reads as revoked');

-- Reading grants nothing: the request command still refuses the revoked cell.
select throws_ok($$select pg_temp.submit_lawn('e7000000-0000-4000-8000-000000000001')$$,
 '42501','Trial invitation required for this service and area',
 'the readback does not open the revoked cell');
reset role;
select is((select count(*) from private.r0_trial_admission_events
  where homeowner_id='e7000000-0000-4000-8000-000000000001'),3::bigint,
 'reading access writes no admission event');

select * from finish();
rollback;
