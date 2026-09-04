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


update public.service_requests set status='scheduled',scheduled_start_at=now()+interval '72 hours',matching_status='matched';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.record_job_operation('53000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','customer_cancel','Synthetic cancellation',null,true)$$,'42501',null,'homeowner cannot self-approve waiver');
select is(public.record_job_operation('53000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','customer_cancel','Synthetic cancellation')->>'refund_percent','100','72h cancellation assesses full refund');
select is(public.record_job_operation('53000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','customer_cancel','Synthetic cancellation')->>'money_action','none','retry returns original assessment with no financial action');
reset role;
update public.service_requests set scheduled_start_at=now()+interval '24 hours' where id='53000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select is(public.record_job_operation('53000000-0000-4000-8000-000000000002','56000000-0000-4000-8000-000000000002','reschedule_request','Synthetic reschedule',now()+interval '3 days')->>'fee','25','24h reschedule assesses approved fee');
reset role;
select is((select scheduled_start_at from public.service_requests where id='53000000-0000-4000-8000-000000000002'),now()+interval '24 hours','reschedule request does not promise unapproved appointment');
select is((select count(*) from public.job_operations where job_id='53000000-0000-4000-8000-000000000001'),1::bigint,'one cancellation assessment on retry');
update public.service_requests set frequency='weekly' where id='53000000-0000-4000-8000-000000000003';
update public.vendor_packages set default_frequency='weekly';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.create_service_occurrence('53000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-000000000003',now()+interval '7 days','Next weekly visit')$$,'recurrence creates a separate visit');
select lives_ok($$select public.create_service_occurrence('53000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-000000000003',now()+interval '7 days','Next weekly visit')$$,'recurrence replay does not duplicate visit');
select lives_ok($$select public.record_job_operation('53000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-000000000004','customer_cancel','Cancel this visit only')$$,'admin can cancel one visit with recorded policy');
reset role;
select is((select count(*) from public.service_requests where recurrence_parent_id='53000000-0000-4000-8000-000000000003'),1::bigint,'one auditable child occurrence');
select is((select status::text from public.service_requests where recurrence_parent_id='53000000-0000-4000-8000-000000000003'),'matched','child remains independently offered when parent cancelled');
select * from finish();
rollback;
