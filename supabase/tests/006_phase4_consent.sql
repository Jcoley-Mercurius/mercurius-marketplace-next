begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','{"full_name":"Synthetic owner"}'),
 ('71000000-0000-4000-8000-000000000002','{"full_name":"Synthetic vendor"}');
insert into public.user_roles(user_id,role) values ('71000000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','Synthetic offer provider',true,true);
insert into public.coverage_areas(zip_code,city) values ('00000','Synthetic test area');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('72000000-0000-4000-8000-000000000001','00000');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select '75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',id,
 'Synthetic quote service','custom_quote','one-time',true from public.services_catalog order by id limit 1;
insert into public.service_requests(id,customer_id,service_type,address,service_catalog_id,frequency,zip_code)
 select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'71000000-0000-4000-8000-000000000001',
 'Synthetic service','Synthetic address',(select service_id from public.vendor_packages where id='75000000-0000-4000-8000-000000000001'),
 'one-time','00000' from generate_series(1,4)n;

insert into auth.users(id,raw_user_meta_data) values ('71000000-0000-4000-8000-000000000003','{"full_name":"Synthetic admin"}');
insert into public.user_roles(user_id,role) values ('71000000-0000-4000-8000-000000000003','admin');
insert into public.contractors(id,name,is_active,marketing_enabled) values ('72000000-0000-4000-8000-000000000002','Synthetic preferred provider',false,true);
update public.service_requests set preferred_contractor_id='72000000-0000-4000-8000-000000000002' where id='73000000-0000-4000-8000-000000000001';
select is(private.offer_next_for_request_internal('73000000-0000-4000-8000-000000000001'),null::uuid,'ineligible selected provider does not silently fall back');
select is((select matching_status from public.service_requests where id='73000000-0000-4000-8000-000000000001'),'awaiting_consent','request explains required homeowner decision');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.consent_to_provider_fallback('73000000-0000-4000-8000-000000000001')$$,'42501',null,'admin cannot impersonate fallback consent');
select throws_ok($$select public.create_job_offer('73000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',null,null,true,'Operator override')$$,'42501',null,'reason does not bypass homeowner fallback consent');
select throws_ok($$select public.admin_assign_contractor('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001')$$,'22023','Assignment reason required','legacy admin assignment cannot bypass reason');
select lives_ok($$select public.admin_assign_contractor('73000000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','Synthetic operator reason')$$,'reason-bearing eligible assignment succeeds');
select throws_ok($$select public.vendor_accept_job('73000000-0000-4000-8000-000000000002')$$,'P0001',null,'admin cannot impersonate provider acceptance');
reset role;
select is((select metadata->>'reason' from public.job_events where job_id='73000000-0000-4000-8000-000000000002' and metadata->>'action'='admin_offer_override'),'Synthetic operator reason','assignment reason preserved');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.consent_to_provider_fallback('73000000-0000-4000-8000-000000000001')$$,'owner consents and matching resumes');
select lives_ok($$select public.consent_to_provider_fallback('73000000-0000-4000-8000-000000000001')$$,'consent retry preserves one offer');
reset role;
select is((select count(*) from public.job_events where job_id='73000000-0000-4000-8000-000000000001' and metadata->>'action'='provider_fallback_consented'),1::bigint,'consent audit exactly once');
select is((select count(*) from public.job_match_attempts where service_request_id='73000000-0000-4000-8000-000000000001' and outcome='pending'),1::bigint,'one exclusive fallback offer');
update public.job_match_attempts set expires_at=now() where service_request_id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_accept_job('73000000-0000-4000-8000-000000000002')$$,'22023','Offer has expired','expired acceptance returns an error rather than false success');
reset role;
select is((select status::text from public.service_requests where id='73000000-0000-4000-8000-000000000002'),'matched','failed acceptance never schedules');
select * from finish();
rollback;
