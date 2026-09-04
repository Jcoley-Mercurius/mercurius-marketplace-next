begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values ('91000000-0000-4000-8000-000000000001','{"full_name":"Synthetic owner"}');
insert into public.contractors(id,name,is_active,marketing_enabled)
 select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic tied provider',true,true from generate_series(1,7)n;
insert into public.coverage_areas(zip_code,city) values ('00000','Synthetic');
insert into public.contractor_service_zips(contractor_id,zip_code)
 select id,'00000' from public.contractors where id::text like '92000000-%' and id<>'92000000-0000-4000-8000-000000000006';
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select ('95000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (select id from public.services_catalog order by id limit 1),'Synthetic offering',case when n=1 then 'fixed' else 'custom_quote' end,'one-time',true from generate_series(1,7)n;
insert into public.package_tiers(package_id,frequency,price,name) values('95000000-0000-4000-8000-000000000001','one-time',100,'Synthetic tier');
update public.contractors set is_active=false where id='92000000-0000-4000-8000-000000000004';
update public.contractors set marketing_enabled=false where id='92000000-0000-4000-8000-000000000005';
update public.vendor_packages set needs_review=true where id='95000000-0000-4000-8000-000000000007';
insert into public.service_requests(id,customer_id,service_type,address,service_catalog_id,frequency,zip_code)
 values('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Synthetic','Synthetic',(select id from public.services_catalog order by id limit 1),'one-time','00000');
select is((select count(*) from private.find_eligible_packages_core('93000000-0000-4000-8000-000000000001')),3::bigint,'fixed and quote providers participate; inactive, nonmarketing, uncovered and unreviewed excluded');
select is((select contractor_id from private.find_eligible_packages_core('93000000-0000-4000-8000-000000000001') order by rank_order limit 1),'92000000-0000-4000-8000-000000000001'::uuid,'balanced fixed-price score remains first by default');
select is((select contractor_id from private.find_eligible_packages_core('93000000-0000-4000-8000-000000000001') where path='quote' order by rank_order limit 1),'92000000-0000-4000-8000-000000000002'::uuid,'equal quote scores break ties by stable provider ID');
update public.service_requests set preferred_contractor_id='92000000-0000-4000-8000-000000000003' where id='93000000-0000-4000-8000-000000000001';
select private.offer_next_for_request_internal('93000000-0000-4000-8000-000000000001');
select is((select contractor_id from public.job_match_attempts where outcome='pending'),'92000000-0000-4000-8000-000000000003'::uuid,'selected eligible quote provider receives first offer despite fixed supply');
update public.job_match_attempts set outcome='declined',responded_at=now() where outcome='pending';
update public.service_requests set status='pending',contractor_id=null,matching_status='awaiting_match' where id='93000000-0000-4000-8000-000000000001';
select is(private.offer_next_for_request_internal('93000000-0000-4000-8000-000000000001'),null::uuid,'selected provider decline pauses fallback for consent');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"91000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.consent_to_provider_fallback('93000000-0000-4000-8000-000000000001')$$,'consent resumes deterministic ranking');
reset role;
select is((select contractor_id from public.job_match_attempts where outcome='pending'),'92000000-0000-4000-8000-000000000001'::uuid,'highest-ranked remaining provider offered');
update public.job_match_attempts set expires_at=now() where outcome='pending';
select private.offer_next_for_request_internal('93000000-0000-4000-8000-000000000001');
select is((select contractor_id from public.job_match_attempts where outcome='pending'),'92000000-0000-4000-8000-000000000002'::uuid,'expired fixed offer advances to remaining quote provider');
select is((select count(*) from public.job_match_attempts where outcome='pending'),1::bigint,'pool advancement remains exclusive');
select ok((select bool_and(metadata->>'ranking_version'='balanced-v1') from public.job_events where event_type='match_offered' and job_id='93000000-0000-4000-8000-000000000001'),'offers retain ranking version');
select * from finish();
rollback;
