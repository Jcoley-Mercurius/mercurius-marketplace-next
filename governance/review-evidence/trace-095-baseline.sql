-- TRACE-095 baseline probes: run against main (2ed8036, without migration 20260927000000). Synthetic, rolled back.
-- After the migration, B1 and B4 fail with 42501 (no INSERT) and B3 with 42501 (zip_code not editable).
begin;
insert into auth.users(id) values ('e1000000-0000-4000-8000-000000000001');
insert into public.coverage_areas(zip_code,city,is_active) values ('00040','Synthetic',true);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
-- B1 forged lifecycle/price/ZIP insert
insert into public.service_requests(id,customer_id,service_type,address,status,total_amount,pricing_mode,quote_only,zip_code,contractor_id)
 values('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Forged','x','completed',1,'fixed',false,'00049',null)
 returning 'B1 forged insert accepted: status='||status||' total='||total_amount||' zip='||zip_code;
-- B2 no eligible supply: a covered-ZIP request with no provider is still created
insert into public.service_requests(id,customer_id,service_type,service_catalog_id,address,frequency,zip_code,pricing_mode,quote_only)
 values('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','Tree','tree-trimming','x','one-time','00040','custom_quote',true)
 returning 'B2 unavailable configuration inserted as active request';
select 'B2 matching result: '||coalesce(public.start_request_matching('e3000000-0000-4000-8000-000000000002')::text,'null');
select 'B2 matching_status: '||matching_status||' status: '||status from public.service_requests where id='e3000000-0000-4000-8000-000000000002';
-- B3 post-submit ZIP move
update public.service_requests set zip_code='00049' where id='e3000000-0000-4000-8000-000000000002' returning 'B3 pending request moved to ZIP '||zip_code;
-- B4 duplicate submission: identical rows accepted twice (no retry identity)
insert into public.service_requests(customer_id,service_type,address,zip_code) values
 ('e1000000-0000-4000-8000-000000000001','Dup','x','00040'),('e1000000-0000-4000-8000-000000000001','Dup','x','00040');
select 'B4 identical submissions stored: '||count(*) from public.service_requests where service_type='Dup';
-- B5 photo-failure rollback path used by the intake page
delete from public.service_requests where id='e3000000-0000-4000-8000-000000000002';
rollback;
