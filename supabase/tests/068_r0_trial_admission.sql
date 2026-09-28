-- TRACE-101: admission is default closed at the real request and checkout commands.
-- Synthetic users/coverage only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('e6800000-0000-4000-8000-000000000001','{}'),
 ('e6800000-0000-4000-8000-000000000002','{}'),
 ('e6800000-0000-4000-8000-000000000003','{}');
insert into public.user_roles(user_id,role)
 values ('e6800000-0000-4000-8000-000000000003','admin');
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist)
 values ('00068','Synthetic',true,false),('00069','Synthetic',true,false);
insert into private.r0_lee_zips values ('00068'),('00069');
insert into public.contractors(id,name,is_active,marketing_enabled)
 values ('e6800000-0000-4000-8000-000000000010','Synthetic provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code)
 values ('e6800000-0000-4000-8000-000000000010','00068');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values ('e6800000-0000-4000-8000-000000000011','e6800000-0000-4000-8000-000000000010',
 'lawn-mowing','Synthetic fixed','fixed','one-time',true,false);
insert into public.package_tiers(package_id,frequency,price,name)
 values ('e6800000-0000-4000-8000-000000000011','one-time',100,'Synthetic basic');

create function pg_temp.plan(p_zip text default '00068', p_service text default 'lawn-mowing')
returns jsonb language sql as $$
 select jsonb_build_object('location',jsonb_build_object('address','1 Synthetic Way',
 'city','Synthetic','state','FL','zip_code',p_zip),
 'selections',jsonb_build_array(jsonb_build_object('service_id',p_service,
 'frequency','one-time','expected',jsonb_build_object('pricing_mode','fixed','total',100)))) $$;
create function pg_temp.submit(p_actor uuid,p_key text,p_payload jsonb)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_actor)::text,true);
 set local role authenticated;
 result:=public.submit_service_requests(p_key,p_payload);
 reset role;
 return result;
end $$;
create function pg_temp.set_access(p_actor uuid,p_homeowner uuid,p_zip text,p_service text,p_allowed boolean)
returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_actor)::text,true);
 set local role authenticated;
 perform public.r0_set_trial_admission(p_homeowner,p_zip,p_service,p_allowed,'Synthetic review');
 reset role;
end $$;

select ok(not has_table_privilege('authenticated','private.r0_trial_admissions','SELECT'),
 'browser cannot read private admissions');
select ok(not has_table_privilege('service_role','private.r0_trial_admissions','UPDATE'),
 'service key has no direct admission update');
select ok(not has_function_privilege('authenticated','private.r0_trial_admitted(uuid,text,text)','EXECUTE'),
 'browser cannot invoke private admission probe');
select is((select count(*) from private.r0_trial_operators),0::bigint,
 'new environment has no nominated admission operator');

select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0001',pg_temp.plan())$$,
 '42501','Trial invitation required for this service and area',
 'homeowner account alone cannot create a request');
select is((select count(*) from public.service_requests where customer_id='e6800000-0000-4000-8000-000000000001'),
 0::bigint,'closed gate creates no request');
select throws_ok($$select pg_temp.set_access('e6800000-0000-4000-8000-000000000003',
 'e6800000-0000-4000-8000-000000000001','00068','lawn-mowing',true)$$,
 '42501','Trial admission operator required','admin role alone cannot grant');
insert into private.r0_trial_operators(user_id,reason)
 values ('e6800000-0000-4000-8000-000000000003','Synthetic owner authorization');
select throws_ok($$select pg_temp.set_access('e6800000-0000-4000-8000-000000000002',
 'e6800000-0000-4000-8000-000000000001','00068','lawn-mowing',true)$$,
 '42501','Trial admission operator required','another homeowner cannot grant');
select throws_ok($$select pg_temp.set_access('e6800000-0000-4000-8000-000000000003',
 'e6800000-0000-4000-8000-000000000001','33955','lawn-mowing',true)$$,
 '22023','Covered, active service cell required','out-of-Lee cell cannot be granted');
select lives_ok($$select pg_temp.set_access('e6800000-0000-4000-8000-000000000003',
 'e6800000-0000-4000-8000-000000000001','00068','lawn-mowing',true)$$,
 'nominated operator grants one service/ZIP cell');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000002',
 'r0-admission-key-0002',pg_temp.plan())$$,
 '42501','Trial invitation required for this service and area',
 'another homeowner cannot use the grant');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0003',pg_temp.plan('00069'))$$,
 '42501','Trial invitation required for this service and area',
 'grant does not cover another active ZIP');
select is(pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0004',pg_temp.plan())->>'status','submitted',
 'admitted homeowner can submit in the allowed cell');

-- A minimally valid legacy snapshot proves that the outer checkout gate runs
-- before commercial-source validation. It is never charged or published.
update public.service_requests set contractor_id='e6800000-0000-4000-8000-000000000010',
 status='scheduled' where customer_id='e6800000-0000-4000-8000-000000000001';
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id)
select 'e6800000-0000-4000-8000-000000000020',id,customer_id,contractor_id
from public.service_requests where customer_id='e6800000-0000-4000-8000-000000000001';
insert into public.money_snapshots(id,obligation_id,revision,service,addons,discount,
 adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,
 tax_evidence,created_by,approved_by,reason,expires_at)
values ('e6800000-0000-4000-8000-000000000021',
 'e6800000-0000-4000-8000-000000000020',1,10000,0,0,0,10000,0,0,0,10000,
 'usd','synthetic','CFG-005','synthetic tax',
 'e6800000-0000-4000-8000-000000000003',
 'e6800000-0000-4000-8000-000000000002','Synthetic unpublishable snapshot',
 now()+interval '1 day');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0004',pg_temp.plan() || '{"location":{"zip_code":"00069"}}')$$,
 '42501','Trial invitation required for this service and area',
 'replay with changed cell cannot bypass admission');
select lives_ok($$select pg_temp.set_access('e6800000-0000-4000-8000-000000000003',
 'e6800000-0000-4000-8000-000000000001','00068','lawn-mowing',false)$$,
 'operator revokes one cell');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0004',pg_temp.plan())$$,
 '42501','Trial invitation required for this service and area',
 'revocation blocks exact-key replay');
update public.coverage_areas set is_active=false where zip_code='00068';
update public.services_catalog set is_active=false where id='lawn-mowing';
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0004',pg_temp.plan())$$,
 '42501','Trial invitation required for this service and area',
 'deactivated coverage and service cannot restore a revoked replay');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0005',pg_temp.plan())$$,
 '42501','Trial invitation required for this service and area',
 'revocation blocks a new request');
select throws_ok($$select pg_temp.submit('e6800000-0000-4000-8000-000000000001',
 'r0-admission-key-0006',pg_temp.plan('00069'))$$,
 '42501','Trial invitation required for this service and area',
 'revocation does not create another cell');
select set_config('request.jwt.claims',
 '{"role":"authenticated","sub":"e6800000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$select public.money_prepare_checkout(
 'e6800000-0000-4000-8000-000000000021','full')$$,
 '42501','Trial invitation required for checkout',
 'revocation blocks new checkout even for a prior request');
reset role;
select is((select count(*) from public.money_checkout_attempts),0::bigint,
 'checkout refusal creates no attempt');
select is((select count(*) from public.service_requests where customer_id='e6800000-0000-4000-8000-000000000001'),
 1::bigint,'revocation keeps existing request history');
select is((select count(*) from private.r0_trial_admission_events
 where homeowner_id='e6800000-0000-4000-8000-000000000001'),2::bigint,
 'grant and revocation each have an audit event');

select * from finish();
rollback;
