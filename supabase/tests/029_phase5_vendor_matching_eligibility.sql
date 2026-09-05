begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('b1000000-0000-4000-8000-000000000002','{"full_name":"Synthetic provider"}'),
 ('b1000000-0000-4000-8000-000000000003','{"full_name":"Synthetic operator"}');
insert into public.user_roles(user_id,role) values
 ('b1000000-0000-4000-8000-000000000002','vendor'),
 ('b1000000-0000-4000-8000-000000000003','admin');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled)
 values('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',
 'Synthetic eligibility provider',true,true);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('b3000000-0000-4000-8000-000000000001','Synthetic eligibility provider','Test','Provider',
 'provider@example.invalid','synthetic','b2000000-0000-4000-8000-000000000001');
insert into public.coverage_areas(zip_code,city) values('00010','Synthetic');
insert into public.contractor_service_zips(contractor_id,zip_code)
 values('b2000000-0000-4000-8000-000000000001','00010');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 select 'b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',
 id,'Synthetic eligible service','custom_quote','one-time',true,false
 from public.services_catalog where is_active order by id limit 1;
insert into public.service_requests(id,customer_id,service_type,address,service_catalog_id,frequency,zip_code)
 select 'b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
 'Synthetic eligibility service','Synthetic address',service_id,'one-time','00010'
 from public.vendor_packages where id='b4000000-0000-4000-8000-000000000001';

select is((select count(*) from private.find_eligible_packages_core('b5000000-0000-4000-8000-000000000001')),
 1::bigint,'Unmigrated active provider retains legacy matching during evidence cutover');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000003"}',true);
select public.vendor_begin_review('b2000000-0000-4000-8000-000000000001',
 (select id from public.vendor_application_versions where application_id='b3000000-0000-4000-8000-000000000001'));
select is((select count(*) from private.find_eligible_packages_core('b5000000-0000-4000-8000-000000000001')),
 0::bigint,'Review-state provider is removed once private onboarding becomes authoritative');

do $$ declare kind text; begin
  foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
    perform public.vendor_record_evidence('b2000000-0000-4000-8000-000000000001',kind,
      'synthetic-requirement-v1','private-synthetic-'||kind,now()-interval '1 hour',now()+interval '1 year');
  end loop;
end $$;
select is(public.vendor_decide_onboarding('b2000000-0000-4000-8000-000000000001',1,
 'activate','All synthetic requirements reviewed','eligibility-activate'),2,'Reviewed provider activates');
select is((select count(*) from private.find_eligible_packages_core('b5000000-0000-4000-8000-000000000001')),
 1::bigint,'Active provider with current private evidence enters candidate pool');

select lives_ok($$select private.create_job_offer_internal(
 'b5000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',null,null,false)$$,
 'Current eligible provider receives offer');
select is(public.vendor_decide_onboarding('b2000000-0000-4000-8000-000000000001',2,
 'suspend','Synthetic compliance hold','eligibility-suspend'),3,'Operations suspends provider');
select is((select count(*) from private.find_eligible_packages_core('b5000000-0000-4000-8000-000000000001')),
 0::bigint,'Suspended provider immediately leaves candidate pool');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_accept_job('b5000000-0000-4000-8000-000000000001')$$,
 '22023','Provider is no longer eligible','Acceptance rechecks current private eligibility');
reset role;
select is((select outcome from public.job_match_attempts where service_request_id='b5000000-0000-4000-8000-000000000001'),
 'pending','Failed acceptance preserves the offer for deterministic operations handling');
select is((select status::text from public.service_requests where id='b5000000-0000-4000-8000-000000000001'),
 'matched','Failed acceptance cannot schedule work');

select ok(not has_function_privilege('authenticated','private.vendor_matching_eligible(uuid)','EXECUTE'),
 'Browser cannot call the private eligibility bridge');
select ok(not has_function_privilege('service_role','private.find_eligible_packages_without_onboarding(uuid,text,text,text,uuid)','EXECUTE'),
 'Service role cannot bypass onboarding through the legacy candidate function');

select * from finish();
rollback;
