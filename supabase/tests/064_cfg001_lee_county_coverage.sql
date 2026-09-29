-- CFG-001 / DEC-2026-021: the committed Lee County ZIP allowlist and its request-flow boundary.
-- Synthetic identities only; no provider supply is created, so covered ZIPs reach eligibility
-- (unavailable) and uncovered ZIPs stop at geography.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table lee_zips(zip_code text primary key) on commit drop;
insert into lee_zips values
 ('33901'),('33903'),('33904'),('33905'),('33907'),('33908'),('33909'),('33912'),('33913'),('33914'),
 ('33916'),('33917'),('33919'),('33920'),('33922'),('33928'),('33931'),('33936'),('33956'),('33957'),
 ('33966'),('33967'),('33971'),('33972'),('33973'),('33974'),('33976'),('33990'),('33991'),('33993'),
 ('34134'),('34135'),('33965'),('33902'),('33906'),('33910'),('33915'),('33918'),('33921'),('33924'),
 ('33929'),('33932'),('33945'),('33970'),('33994'),('34133'),('34136');

select is((select count(*) from lee_zips),47::bigint,'the approved list has 47 Lee County ZIPs');
select is((select count(*) from public.coverage_areas c join lee_zips using (zip_code) where c.is_active and not c.has_waitlist and c.state='FL'),
  47::bigint,'every Lee County ZIP is active coverage without a waitlist');
select is((select count(*) from public.coverage_areas where is_active and zip_code ~ '^[1-9]' and zip_code not in (select zip_code from lee_zips)),
  0::bigint,'no real ZIP outside the Lee County list is active');
select is((select count(*) from public.coverage_areas where zip_code in ('33955','34110','34119','33935','33948','34102')),
  0::bigint,'neighboring-county ZIPs, including those with Lee County slivers, are not coverage');

insert into auth.users(id,raw_user_meta_data) values ('c6400000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}');

insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select 'c6400000-0000-4000-8000-000000000001',z.zip_code,'lawn-mowing',
 'c6400000-0000-4000-8000-000000000001' from lee_zips z;

create function pg_temp.submit(p_key text, p_zip text) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','c6400000-0000-4000-8000-000000000001')::text,true);
  set local role authenticated;
  r := public.submit_service_requests(p_key,jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code',p_zip),
    'preferred_time','Preferred window: synthetic',
    'selections','[{"service_id":"lawn-mowing","frequency":"one-time"}]'::jsonb));
  reset role;
  return r;
end $$;

-- Covered boundary ZIPs: north (33917, split with Charlotte), east (33936, split with Hendry),
-- south (34134, split with Collier), islands (33921, 33957) and core (33904).
select is(pg_temp.submit('synthetic-key-6400000001','33917')->>'coverage','covered','33917 North Fort Myers is covered');
select is(pg_temp.submit('synthetic-key-6400000002','33936')->>'coverage','covered','33936 Lehigh Acres is covered');
select is(pg_temp.submit('synthetic-key-6400000003','34134')->>'coverage','covered','34134 Bonita Springs is covered');
select is(pg_temp.submit('synthetic-key-6400000004','33921')->>'coverage','covered','33921 Boca Grande is covered');
select is(pg_temp.submit('synthetic-key-6400000005','33957')->>'coverage','covered','33957 Sanibel is covered');
select is(pg_temp.submit('synthetic-key-6400000006','33904')#>>'{outcomes,0,outcome}','unavailable','a covered ZIP without supply is unavailable, not uncovered');

-- Uncovered boundary ZIPs across each county line.
select is(pg_temp.submit('synthetic-key-6400000011','33955')->>'coverage','uncovered','33955 Punta Gorda (Charlotte) is uncovered');
select is(pg_temp.submit('synthetic-key-6400000012','33948')->>'coverage','uncovered','33948 Port Charlotte is uncovered');
select is(pg_temp.submit('synthetic-key-6400000013','34110')->>'coverage','uncovered','34110 Naples (Collier) is uncovered');
select is(pg_temp.submit('synthetic-key-6400000014','34119')->>'coverage','uncovered','34119 Naples (Collier) is uncovered');
select is(pg_temp.submit('synthetic-key-6400000015','33935')->>'coverage','uncovered','33935 LaBelle (Hendry) is uncovered');

select is((select count(*) from public.service_requests where customer_id='c6400000-0000-4000-8000-000000000001'),
  0::bigint,'no boundary submission without supply creates a request');

select * from finish();
rollback;
