begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','{"full_name":"Synthetic owner"}'),
 ('51000000-0000-4000-8000-000000000002','{"full_name":"Synthetic vendor"}');
insert into public.user_roles(user_id,role) values ('51000000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','Synthetic offer provider',true,true);
insert into public.coverage_areas(zip_code,city) values ('00000','Synthetic test area');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('52000000-0000-4000-8000-000000000001','00000');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select '55000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',id,
 'Synthetic quote service','custom_quote','one-time',true from public.services_catalog order by id limit 1;
insert into public.service_requests(id,customer_id,service_type,address,service_catalog_id,frequency,zip_code)
 select ('53000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'51000000-0000-4000-8000-000000000001',
 'Synthetic service','Synthetic address',(select service_id from public.vendor_packages where id='55000000-0000-4000-8000-000000000001'),
 'one-time','00000' from generate_series(1,4)n;
select private.create_job_offer_internal(id,'52000000-0000-4000-8000-000000000001',null,null,false)
 from public.service_requests where id::text like '53000000-%';
select is((select count(*) from public.job_match_attempts where service_request_id::text like '53000000-%' and expires_at=offered_at+interval '4 hours'),4::bigint,'each offer has its own four-hour deadline');
select private.create_job_offer_internal('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',null,null,false);
select is((select count(*) from public.job_match_attempts where service_request_id='53000000-0000-4000-8000-000000000001' and outcome='pending'),1::bigint,'repeated create preserves exclusive offer');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.transition_job_status('53000000-0000-4000-8000-000000000001','scheduled')$$,'42501','Vendor acceptance is required for scheduling','homeowner cannot bypass vendor acceptance');
select throws_ok($$select public.create_job_offer('53000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001')$$,'42501','Admin access required','missing legacy single-role claim cannot bypass admin authorization');
select throws_ok($$select public.vendor_accept_job('53000000-0000-4000-8000-000000000001')$$,'P0001','No open offer is available to accept','homeowner cannot accept for vendor');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.transition_job_status('53000000-0000-4000-8000-000000000001','in_progress')$$,'42501','Accept the offer before starting work','vendor must accept before starting work');
select lives_ok($$select public.vendor_accept_job('53000000-0000-4000-8000-000000000001')$$,'eligible vendor accepts quote-only offer');
select is((select status::text from public.service_requests where id='53000000-0000-4000-8000-000000000001'),'scheduled','vendor acceptance immediately schedules without added payment prerequisites');
select throws_ok($$select public.vendor_accept_job('53000000-0000-4000-8000-000000000001')$$,'P0001','No open offer is available to accept','duplicate acceptance rejected');
reset role;

update public.service_requests set status='cancelled' where id='53000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_accept_job('53000000-0000-4000-8000-000000000002')$$,'22023','Offer is no longer actionable','stale offer cannot resurrect cancellation on acceptance');
select throws_ok($$select public.vendor_decline_job('53000000-0000-4000-8000-000000000002')$$,'22023','Offer is no longer actionable','stale decline cannot resurrect cancellation');
reset role;
update public.job_match_attempts set expires_at=now() where service_request_id in
 ('53000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000003');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.expire_stale_matches(),2,'expiry occurs at exact four-hour deadline');
select is(public.expire_stale_matches(),0,'duplicate expiry has no effects');
select is((select status::text from public.service_requests where id='53000000-0000-4000-8000-000000000002'),'cancelled','expiry preserves cancelled state');
select is((select status::text from public.service_requests where id='53000000-0000-4000-8000-000000000001'),'scheduled','expiry preserves accepted scheduled state');
select is((select matching_status from public.service_requests where id='53000000-0000-4000-8000-000000000003'),'exhausted','expired provider is not reoffered and pool exhausts');
select is((select outcome from public.job_match_attempts where service_request_id='53000000-0000-4000-8000-000000000004'),'pending','unexpired offer survives');
reset role;
select * from finish();
rollback;
