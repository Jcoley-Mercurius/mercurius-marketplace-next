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

insert into auth.users(id,raw_user_meta_data) values ('51000000-0000-4000-8000-000000000003','{"full_name":"Synthetic admin"}');
insert into public.user_roles(user_id,role) values ('51000000-0000-4000-8000-000000000003','admin');
update public.service_requests set contractor_id='52000000-0000-4000-8000-000000000001',status='vendor_completed',vendor_completed_at=now()-interval '47 hours';

update public.service_requests set status='completed',homeowner_confirmed_at=now();
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.submit_job_review('53000000-0000-4000-8000-000000000001',1,'Low rating')$$,'verified low rating accepted');
select lives_ok($$select public.submit_job_review('53000000-0000-4000-8000-000000000002',5,'High rating')$$,'verified high rating accepted');
select throws_ok($$select public.submit_job_review('53000000-0000-4000-8000-000000000001',5,'Duplicate')$$,'22023',null,'duplicate review rejected');
select lives_ok($$select public.revise_job_review((select id from public.reviews where service_request_id='53000000-0000-4000-8000-000000000001'),2,'Corrected comment','Correction')$$,'author can correct review preserving history');
reset role;
select is((select count(*) from public.reviews where visibility='eligible_for_google' and moderation_state='published'),2::bigint,'same public treatment for every star rating');
select is((select before_value->>'comment' from public.review_history limit 1),'Low rating','original content retained');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$delete from public.reviews$$,'42501',null,'admin cannot delete review history');
select lives_ok($$select public.moderate_job_review((select id from public.reviews where service_request_id='53000000-0000-4000-8000-000000000001'),'rejected','Unrelated content')$$,'reason-bearing moderation preserves original');
reset role;
set local role anon;
select is((select count(*) from public.reviews),1::bigint,'moderated content no longer public');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.appeal_job_review((select id from public.reviews where service_request_id='53000000-0000-4000-8000-000000000001'),'Content relates to service')$$,'author can appeal moderation');
reset role;
select is((select count(*) from public.support_tickets where issue_type='review_appeal'),1::bigint,'moderation appeal enters support queue');
update public.service_requests set homeowner_confirmed_at=null where id='53000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.submit_job_review('53000000-0000-4000-8000-000000000003',3,'Unconfirmed')$$,'22023',null,'unconfirmed relationship ineligible');
reset role;
select * from finish();
rollback;
