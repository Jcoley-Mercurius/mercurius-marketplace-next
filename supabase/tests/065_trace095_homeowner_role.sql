-- TRACE-095 / P6-R1: submission and replay require the homeowner role. Synthetic identities
-- and the synthetic 000xx ZIP only. Signup grants homeowner to every new user, so role-negative
-- identities have that grant removed explicitly.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('c6500000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('c6500000-0000-4000-8000-000000000002','{"full_name":"Synthetic homeowner and provider"}'),
 ('c6500000-0000-4000-8000-000000000003','{"full_name":"Synthetic homeowner and operator"}'),
 ('c6500000-0000-4000-8000-000000000004','{"full_name":"Synthetic no-role account"}'),
 ('c6500000-0000-4000-8000-000000000005','{"full_name":"Synthetic provider only"}'),
 ('c6500000-0000-4000-8000-000000000006','{"full_name":"Synthetic operator only"}'),
 ('c6500000-0000-4000-8000-000000000007','{"full_name":"Synthetic homeowner losing the role"}');
insert into public.user_roles(user_id,role) values
 ('c6500000-0000-4000-8000-000000000002','vendor'),('c6500000-0000-4000-8000-000000000003','admin'),
 ('c6500000-0000-4000-8000-000000000005','vendor'),('c6500000-0000-4000-8000-000000000006','admin');
delete from public.user_roles where role='homeowner' and user_id in
 ('c6500000-0000-4000-8000-000000000004','c6500000-0000-4000-8000-000000000005','c6500000-0000-4000-8000-000000000006');

insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00065','Synthetic covered',true,false);
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('c6500000-0000-4000-8000-000000000010','Synthetic fixed provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values ('c6500000-0000-4000-8000-000000000010','00065');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('c6500000-0000-4000-8000-000000000011','c6500000-0000-4000-8000-000000000010','lawn-mowing','Synthetic fixed','fixed','one-time',true,false);
insert into public.package_tiers(package_id,frequency,price,name) values
 ('c6500000-0000-4000-8000-000000000011','one-time',100,'Synthetic basic');

insert into private.r0_lee_zips values ('00065');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select id,'00065','lawn-mowing',id from auth.users
where id in ('c6500000-0000-4000-8000-000000000001','c6500000-0000-4000-8000-000000000002',
 'c6500000-0000-4000-8000-000000000003','c6500000-0000-4000-8000-000000000007');

create function pg_temp.submit(p_actor uuid, p_key text, p_payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_actor)::text,true);
  set local role authenticated;
  r := public.submit_service_requests(p_key,p_payload);
  reset role;
  return r;
end $$;
create function pg_temp.lawn() returns jsonb language sql as $$
  select jsonb_build_object('location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00065'),
    'selections',jsonb_build_array(jsonb_build_object('service_id','lawn-mowing','frequency','one-time',
      'expected',jsonb_build_object('pricing_mode','fixed','total',100)))) $$;
create function pg_temp.requests(p_actor uuid) returns bigint language sql as $$
  select count(*) from public.service_requests where customer_id=p_actor $$;
create function pg_temp.submissions(p_actor uuid) returns bigint language sql as $$
  select count(*) from public.service_request_submissions where customer_id=p_actor $$;

-- Privileges: the unchecked body is reachable only through the role-checked command.
select ok(not has_function_privilege('anon','public.submit_service_requests(text,jsonb)','EXECUTE'),'anonymous cannot execute the command');
select ok(has_function_privilege('authenticated','public.submit_service_requests(text,jsonb)','EXECUTE'),'authenticated may call the command');
select ok(not has_function_privilege('anon','private.submit_service_requests_core(text,jsonb)','EXECUTE'),'anonymous cannot execute the core');
select ok(not has_function_privilege('authenticated','private.submit_service_requests_core(text,jsonb)','EXECUTE'),'authenticated cannot execute the core');
select ok(not has_function_privilege('service_role','private.submit_service_requests_core(text,jsonb)','EXECUTE'),'service role cannot execute the core');
select ok((select prosecdef from pg_proc where oid='public.submit_service_requests(text,jsonb)'::regprocedure),'command is security definer');
select is((select proconfig from pg_proc where oid='public.submit_service_requests(text,jsonb)'::regprocedure),array['search_path=""'],'command pins an empty search path');

-- Homeowner and dual-role identities submit their own requests.
select is(pg_temp.submit('c6500000-0000-4000-8000-000000000001','role-key-000000000001',pg_temp.lawn())->>'status','submitted','homeowner submits');
select is(pg_temp.submit('c6500000-0000-4000-8000-000000000002','role-key-000000000002',pg_temp.lawn())->>'status','submitted','homeowner who is also a provider submits');
select is(pg_temp.submit('c6500000-0000-4000-8000-000000000003','role-key-000000000003',pg_temp.lawn())->>'status','submitted','homeowner who is also an operator submits');
create temp table forged as select pg_temp.submit('c6500000-0000-4000-8000-000000000001','role-key-000000000004',
  pg_temp.lawn() || '{"customer_id":"c6500000-0000-4000-8000-000000000002"}') as result;
select is((select r.customer_id::text from forged f join public.service_requests r on r.id=(f.result#>>'{requests,0,request_id}')::uuid),
  'c6500000-0000-4000-8000-000000000001','a forged customer_id in the payload is ignored');
select is(pg_temp.requests('c6500000-0000-4000-8000-000000000001'),2::bigint,'homeowner owns both of their requests');
select is(pg_temp.requests('c6500000-0000-4000-8000-000000000002'),1::bigint,'the other homeowner gained nothing from the forged owner');

-- Callers without the homeowner role are refused before anything is read or written.
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000004','role-key-000000000010',pg_temp.lawn())$$,
  '42501','Homeowner authorization required','authenticated account without any role is refused');
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000005','role-key-000000000011',pg_temp.lawn())$$,
  '42501','Homeowner authorization required','provider-only account is refused');
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000006','role-key-000000000012',pg_temp.lawn())$$,
  '42501','Homeowner authorization required','operator-only account is refused');
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000005','bad',null)$$,
  '42501','Homeowner authorization required','the role is checked before input validation');
select is(pg_temp.requests('c6500000-0000-4000-8000-000000000004')+pg_temp.requests('c6500000-0000-4000-8000-000000000005')
  +pg_temp.requests('c6500000-0000-4000-8000-000000000006'),0::bigint,'refused callers created no request');
select is(pg_temp.submissions('c6500000-0000-4000-8000-000000000004')+pg_temp.submissions('c6500000-0000-4000-8000-000000000005')
  +pg_temp.submissions('c6500000-0000-4000-8000-000000000006'),0::bigint,'refused callers stored no submission');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.submit_service_requests('role-key-000000000020',pg_temp.lawn())$$,
  '42501','Authentication required','session without a user is refused');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c6500000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select private.submit_service_requests_core('role-key-000000000021',pg_temp.lawn())$$,
  '42501',null,'a homeowner cannot call the core directly');
reset role;
set local role anon;
select throws_ok($$select public.submit_service_requests('role-key-000000000022','{}')$$,'42501',null,'anonymous RPC is refused');
reset role;

-- Ownership isolation under RLS.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c6500000-0000-4000-8000-000000000002"}',true);
select is((select count(*) from public.service_requests where customer_id='c6500000-0000-4000-8000-000000000001'),0::bigint,
  'another homeowner cannot read the submitted requests');
reset role;

-- Replay requires the role at replay time.
select is(pg_temp.submit('c6500000-0000-4000-8000-000000000007','role-key-000000000030',pg_temp.lawn())->>'reused','false','homeowner submits before losing the role');
delete from public.user_roles where user_id='c6500000-0000-4000-8000-000000000007' and role='homeowner';
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000007','role-key-000000000030',pg_temp.lawn())$$,
  '42501','Homeowner authorization required','replay of a stored submission is refused after role removal');
select throws_ok($$select pg_temp.submit('c6500000-0000-4000-8000-000000000007','role-key-000000000031',pg_temp.lawn())$$,
  '42501','Homeowner authorization required','a new submission is refused after role removal');
select is(pg_temp.requests('c6500000-0000-4000-8000-000000000007'),1::bigint,'the earlier request is preserved, not deleted');
insert into public.user_roles(user_id,role) values ('c6500000-0000-4000-8000-000000000007','homeowner');
select is(pg_temp.submit('c6500000-0000-4000-8000-000000000007','role-key-000000000030',pg_temp.lawn())->>'reused','true','with the role restored the same key replays');
select is(pg_temp.requests('c6500000-0000-4000-8000-000000000007'),1::bigint,'the replay created nothing new');

select * from finish();
rollback;
