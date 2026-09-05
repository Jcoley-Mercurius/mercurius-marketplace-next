begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('c1000000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('c1000000-0000-4000-8000-000000000002','{"full_name":"Synthetic provider"}'),
 ('c1000000-0000-4000-8000-000000000003','{"full_name":"Synthetic operator"}');
insert into public.user_roles(user_id,role) values
 ('c1000000-0000-4000-8000-000000000002','vendor'),
 ('c1000000-0000-4000-8000-000000000003','admin');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled)
 values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
 'Synthetic cutover provider',true,true);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('c3000000-0000-4000-8000-000000000001','Synthetic cutover provider','Test','Provider',
 'provider@example.invalid','synthetic','c2000000-0000-4000-8000-000000000001');
insert into public.coverage_areas(zip_code,city) values('00011','Synthetic');
insert into public.contractor_service_zips(contractor_id,zip_code)
 values('c2000000-0000-4000-8000-000000000001','00011');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 select 'c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
 id,'Synthetic cutover service','custom_quote','one-time',true,false
 from public.services_catalog where is_active order by id limit 1;
insert into public.service_requests(id,customer_id,service_type,address,service_catalog_id,frequency,zip_code)
 select 'c5000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001',
 'Synthetic cutover service','Synthetic address',service_id,'one-time','00011'
 from public.vendor_packages where id='c4000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000003"}',true);
select public.vendor_begin_review('c2000000-0000-4000-8000-000000000001',
 (select id from public.vendor_application_versions where application_id='c3000000-0000-4000-8000-000000000001'));
do $$ declare kind text; begin
  foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
    perform public.vendor_record_evidence('c2000000-0000-4000-8000-000000000001',kind,
      'synthetic-category-v1','private-synthetic-'||kind,now()-interval '1 hour',now()+interval '1 year');
  end loop;
end $$;
select is(public.vendor_decide_onboarding('c2000000-0000-4000-8000-000000000001',1,
 'activate','Synthetic checklist reviewed','cutover-activate'),2,'Generic onboarding activates');

select is(public.vendor_category_evidence_current('c2000000-0000-4000-8000-000000000001'),false,
 'Missing category and jurisdiction requirements fail closed');
select throws_ok($$select public.vendor_record_cutover_decision('c2000000-0000-4000-8000-000000000001',
 'included','Synthetic beta inclusion')$$,'P0001','Included provider requirements incomplete or expired',
 'Provider cannot be included before scoped requirements');

insert into public.vendor_compliance_requirements(id,service_id,zip_code,kind,requirement_version,description,effective_at,created_by)
 select 'c6000000-0000-4000-8000-000000000001',service_id,'00011','license','synthetic-category-v1',
 'Synthetic license requirement',now()-interval '1 day','c1000000-0000-4000-8000-000000000003'
 from public.vendor_packages where id='c4000000-0000-4000-8000-000000000001';
select public.vendor_bind_requirement_evidence('c2000000-0000-4000-8000-000000000001',
 'c6000000-0000-4000-8000-000000000001',
 (select id from public.vendor_compliance_evidence where contractor_id='c2000000-0000-4000-8000-000000000001' and kind='license'));
select is(public.vendor_category_evidence_current('c2000000-0000-4000-8000-000000000001'),false,
 'Insurance remains independently required');

insert into public.vendor_compliance_requirements(id,service_id,zip_code,kind,requirement_version,description,effective_at,created_by)
 select 'c6000000-0000-4000-8000-000000000002',service_id,'00011','insurance','synthetic-category-v1',
 'Synthetic insurance requirement',now()-interval '1 day','c1000000-0000-4000-8000-000000000003'
 from public.vendor_packages where id='c4000000-0000-4000-8000-000000000001';
select public.vendor_bind_requirement_evidence('c2000000-0000-4000-8000-000000000001',
 'c6000000-0000-4000-8000-000000000002',
 (select id from public.vendor_compliance_evidence where contractor_id='c2000000-0000-4000-8000-000000000001' and kind='insurance'));
select is(public.vendor_category_evidence_current('c2000000-0000-4000-8000-000000000001'),true,
 'License and insurance evidence satisfy exact service and ZIP scope');
select lives_ok($$select public.vendor_record_cutover_decision('c2000000-0000-4000-8000-000000000001',
 'included','Synthetic beta inclusion')$$,'Reviewed provider receives immutable inclusion decision');
select lives_ok($$select public.vendor_finalize_cutover('Synthetic provider inventory reviewed')$$,
 'Complete provider inventory activates strict cutover');
select is((select enforced from public.vendor_cutover_control),true,'Strict cutover is active');
select is((select count(*) from private.find_eligible_packages_core('c5000000-0000-4000-8000-000000000001')),
 1::bigint,'Included provider remains matchable after strict cutover');

select is(public.vendor_decide_onboarding('c2000000-0000-4000-8000-000000000001',2,
 'suspend','Synthetic compliance hold','cutover-suspend'),3,'Provider suspension records');
select is((select count(*) from private.find_eligible_packages_core('c5000000-0000-4000-8000-000000000001')),
 0::bigint,'Strict cutover immediately excludes suspended provider');
select throws_ok($$update public.vendor_cutover_decisions set disposition='excluded'$$,
 '55000','Immutable financial evidence; append a correction','Cutover decision cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.vendor_compliance_requirements','INSERT'),
 'Browser cannot invent category requirements');
select ok(not has_table_privilege('authenticated','public.vendor_cutover_control','UPDATE'),
 'Browser cannot activate or disable cutover');

select * from finish();
rollback;
