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

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.transition_job_status('53000000-0000-4000-8000-000000000001','disputed','Bypass')$$,'42501',null,'generic transition cannot bypass dispute ticket');
select lives_ok($$select public.homeowner_raise_dispute('53000000-0000-4000-8000-000000000001','Synthetic issue')$$,'owner files before 48h');
select throws_ok($$select public.homeowner_raise_dispute('53000000-0000-4000-8000-000000000001','Duplicate')$$,'22023',null,'duplicate filing rejected');
select throws_ok($$update public.disputes set status='resolved' where job_id='53000000-0000-4000-8000-000000000001'$$,'42501',null,'direct dispute updates denied');
reset role;
select ok((select ticket_id is not null from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'canonical ticket linked');
update public.service_requests set vendor_completed_at=now()-interval '48 hours' where id='53000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.homeowner_raise_dispute('53000000-0000-4000-8000-000000000002','Late')$$,'22023',null,'filing rejected exactly at vendor completion plus 48h');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.homeowner_raise_dispute('53000000-0000-4000-8000-000000000003','Impersonation')$$,'42501',null,'admin cannot impersonate homeowner filing');
select throws_ok($$select public.admin_resolve_dispute((select id from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'resolved','')$$,'22023',null,'resolution requires reason');
select throws_ok($$select public.transition_job_status('53000000-0000-4000-8000-000000000001','resolved','Bypass')$$,'42501',null,'generic status cannot clear an open dispute');
select lives_ok($$select public.admin_resolve_dispute((select id from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'resolved','Original resolution')$$,'admin resolution recorded');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.appeal_dispute_resolution((select id from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'Appeal evidence')$$,'homeowner appeals through ticket');
select lives_ok($$select public.appeal_dispute_resolution((select id from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'Appeal evidence')$$,'appeal retry returns same ticket');
reset role;
select is((select count(*) from public.dispute_appeals),1::bigint,'one appeal per resolution');
select is((select resolution_notes from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'Original resolution','appeal preserves original resolution');
select ok((select disputed from public.service_requests where id='53000000-0000-4000-8000-000000000001'),'appeal restores disputed flag for Phase 5 hold contract');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.admin_resolve_dispute((select id from public.disputes where job_id='53000000-0000-4000-8000-000000000001'),'resolved','Appeal resolution')$$,'admin resolves appeal without rewriting original audit');
reset role;
select is((select t.status from public.support_tickets t join public.dispute_appeals a on a.ticket_id=t.id),'resolved','resolved appeal ticket leaves active queue');
select * from finish();
rollback;
