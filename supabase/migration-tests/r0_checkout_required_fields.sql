-- Run with psql -v ON_ERROR_STOP=1 -f against a fully migrated synthetic DB.
-- Replays the forward fix over legacy rows; all fixtures and DDL roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('e6900000-0000-4000-8000-000000000001','{}'),
 ('e6900000-0000-4000-8000-000000000002','{}');
insert into public.contractors(id,name) values
 ('e6900000-0000-4000-8000-000000000010','Synthetic repair provider');
insert into public.vendor_packages(id,contractor_id,service_id,name)
 values ('e6900000-0000-4000-8000-000000000011',
 'e6900000-0000-4000-8000-000000000010','lawn-mowing','Synthetic repair package');
insert into public.service_requests(id,customer_id,service_type,address,city,state,
 zip_code,service_catalog_id,frequency,package_id)
values ('e6900000-0000-4000-8000-000000000020',
 'e6900000-0000-4000-8000-000000000001','Synthetic lawn','1 Synthetic Way','Synthetic','FL',
 '33901',null,'weekly','e6900000-0000-4000-8000-000000000011');
-- 21: repairable visit; 22: different address; 23: different customer;
-- 24: conflicting service; 25: financial history; 26: conflicting ZIP.
insert into public.service_requests(id,customer_id,service_type,address,city,state,
 zip_code,service_catalog_id,frequency,recurrence_parent_id,occurrence_key)
select ('e6900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=23 then 'e6900000-0000-4000-8000-000000000002'::uuid else customer_id end,
 service_type,case when n=22 then '2 Synthetic Way' else address end,city,state,
 case when n=26 then '33902' end,case when n=24 then 'conflicting-service' end,
 frequency,id,gen_random_uuid()
from public.service_requests cross join generate_series(21,26) n
where id='e6900000-0000-4000-8000-000000000020';
insert into public.money_obligations(service_request_id,customer_id,contractor_id)
values ('e6900000-0000-4000-8000-000000000025',
 'e6900000-0000-4000-8000-000000000001','e6900000-0000-4000-8000-000000000010');
-- An unlinked legacy template has no authoritative location/service to recover.
insert into public.service_requests(id,customer_id,service_type,address,city,state,frequency)
values ('e6900000-0000-4000-8000-000000000027',
 'e6900000-0000-4000-8000-000000000001','Unknown','3 Synthetic Way','Synthetic','FL','weekly');

\ir ../migrations/20260929000000_r0_checkout_required_fields.sql

select is((select service_catalog_id from public.service_requests
 where id='e6900000-0000-4000-8000-000000000020'),'lawn-mowing',
 'legacy template service is repaired from its linked package');
select is((select zip_code from public.service_requests
 where id='e6900000-0000-4000-8000-000000000021'),'33901',
 'matching legacy occurrence inherits the template ZIP');
select is((select service_catalog_id from public.service_requests
 where id='e6900000-0000-4000-8000-000000000021'),'lawn-mowing',
 'matching legacy occurrence inherits the repaired template service');
select ok((select zip_code is null from public.service_requests
 where id='e6900000-0000-4000-8000-000000000022'),
 'different address cannot inherit a template ZIP');
select ok((select zip_code is null from public.service_requests
 where id='e6900000-0000-4000-8000-000000000023'),
 'different homeowner cannot inherit a template cell');
select ok((select zip_code is null and service_catalog_id='conflicting-service'
 from public.service_requests where id='e6900000-0000-4000-8000-000000000024'),
 'conflicting occurrence service is preserved for reconciliation');
select ok((select zip_code is null and service_catalog_id is null
 from public.service_requests where id='e6900000-0000-4000-8000-000000000025'),
 'financially bound occurrence is preserved for reconciliation');
select ok((select zip_code='33902' and service_catalog_id is null
 from public.service_requests where id='e6900000-0000-4000-8000-000000000026'),
 'conflicting occurrence ZIP is preserved for reconciliation');
select ok((select zip_code is null and service_catalog_id is null
 from public.service_requests where id='e6900000-0000-4000-8000-000000000027'),
 'unlinked legacy template is preserved without guessing keys');
select is((select count(*) from public.service_requests
 where customer_id in ('e6900000-0000-4000-8000-000000000001',
 'e6900000-0000-4000-8000-000000000002')),8::bigint,'repair preserves every legacy row');
select ok(not has_function_privilege('anon','public.money_prepare_checkout(uuid,text)','EXECUTE'),
 'anonymous checkout stays revoked');
select ok(not has_function_privilege('service_role','public.money_prepare_checkout(uuid,text)','EXECUTE'),
 'service key cannot bypass homeowner checkout');
select * from finish();
rollback;
