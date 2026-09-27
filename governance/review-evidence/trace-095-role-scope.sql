-- D3 characterization, not acceptance: an identity without the homeowner role
-- can submit an active request. Synthetic fixtures only; always rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);
insert into auth.users(id,raw_user_meta_data) values
 ('c9800000-0000-4000-8000-000000000001','{"full_name":"Synthetic vendor-only caller"}');
insert into public.user_roles(user_id,role) values
 ('c9800000-0000-4000-8000-000000000001','vendor');
delete from public.user_roles where user_id='c9800000-0000-4000-8000-000000000001' and role='homeowner';
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values
 ('00098','Synthetic review area',true,false);
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('c9800000-0000-4000-8000-000000000002','Synthetic review provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('c9800000-0000-4000-8000-000000000002','00098');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('c9800000-0000-4000-8000-000000000003','c9800000-0000-4000-8000-000000000002','lawn-mowing','Synthetic review package','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name) values
 ('c9800000-0000-4000-8000-000000000004','c9800000-0000-4000-8000-000000000003','one-time',100,'Synthetic review tier');
select ok(not public.has_role('c9800000-0000-4000-8000-000000000001','homeowner'),'caller has no homeowner role');
select ok(public.has_role('c9800000-0000-4000-8000-000000000001','vendor'),'caller has vendor role');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c9800000-0000-4000-8000-000000000001"}',true);
select is(public.submit_service_requests('synthetic-review-key-00098',
 '{"location":{"address":"1 Synthetic Way","city":"Synthetic","state":"FL","zip_code":"00098"},"selections":[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}}]}'::jsonb)->>'status',
 'submitted','CHARACTERIZATION: vendor-only caller creates an active request');
reset role;
select is((select count(*) from public.service_requests where customer_id='c9800000-0000-4000-8000-000000000001'),1::bigint,'CHARACTERIZATION: request persisted within the rollback transaction');
select * from finish();
rollback;
