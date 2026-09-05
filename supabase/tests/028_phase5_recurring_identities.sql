begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','{}'),
 ('a1000000-0000-4000-8000-000000000002','{}'),
 ('a1000000-0000-4000-8000-000000000003','{}');
insert into public.user_roles(user_id,role) values
 ('a1000000-0000-4000-8000-000000000002','admin'),
 ('a1000000-0000-4000-8000-000000000003','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003','Synthetic finance actor'),
 ('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','Synthetic finance reviewer');
insert into public.contractors(id,name,is_active,marketing_enabled)
 values('a2000000-0000-4000-8000-000000000001','Synthetic recurring provider',true,true);
insert into public.coverage_areas(zip_code,city) values('00009','Synthetic');
insert into public.contractor_service_zips(contractor_id,zip_code)
 values('a2000000-0000-4000-8000-000000000001','00009');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
 (select id from public.services_catalog where is_active order by id limit 1),'Synthetic weekly offering','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name)
 values('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','weekly',100,'Weekly visit');

insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,status,
 service_catalog_id,frequency,pricing_mode,package_id,package_tier_id,scheduled_start_at,preferred_date,timezone)
 select 'a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
 'a2000000-0000-4000-8000-000000000001','Synthetic recurring','Synthetic address','Synthetic','FL','00009','scheduled',
 service_id,'weekly','fixed','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
 now()+interval '7 days',current_date+7,'America/New_York'
 from public.vendor_packages where id='a3000000-0000-4000-8000-000000000001';
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,status,
 service_catalog_id,frequency,pricing_mode,package_id,package_tier_id,scheduled_start_at,preferred_date,timezone,
 recurrence_parent_id,occurrence_key)
 select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,customer_id,contractor_id,service_type,address,city,state,zip_code,status,
 service_catalog_id,frequency,pricing_mode,package_id,package_tier_id,scheduled_start_at+(n-1)*interval '7 days',
 preferred_date+(n-1)*7,timezone,id,('a6000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
 from public.service_requests cross join generate_series(2,3)n where id='a5000000-0000-4000-8000-000000000001';

create temp table f(key text primary key,id uuid,terms jsonb);
grant select,insert,update on f to authenticated;
create function pg_temp.terms(request uuid) returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',0,'total',11700,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005','tax_evidence','synthetic-tax-decision',
 'reason','Synthetic recurring occurrence','expires_at',now()+interval '1 day') $$;
create function pg_temp.publish(request uuid) returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request); prior text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000003"}',true);
 perform public.money_approve_review('a1000000-0000-4000-8000-000000000002',
   jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent occurrence review');
 perform set_config('request.jwt.claims',coalesce(prior,''),true);
 return public.money_publish_snapshot(request,terms,'a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003');
end $$;

select throws_ok($$select pg_temp.publish('a5000000-0000-4000-8000-000000000001')$$,
 'P0001','Recurring template cannot receive a commercial snapshot','Recurring template cannot be charged as a visit');
insert into f(key,id) values
 ('visit-1',pg_temp.publish('a5000000-0000-4000-8000-000000000002')),
 ('visit-2',pg_temp.publish('a5000000-0000-4000-8000-000000000003'));
select is((select count(*) from public.money_recurring_occurrence_identities),2::bigint,'Each visit has one commercial identity');
select is((select i.obligation_id from public.money_recurring_occurrence_identities i where i.occurrence_request_id='a5000000-0000-4000-8000-000000000002'),
 (select o.id from public.money_obligations o where o.service_request_id='a5000000-0000-4000-8000-000000000002'),
 'Visit 1 identity binds its occurrence obligation');
select is((select i.obligation_id from public.money_recurring_occurrence_identities i where i.occurrence_request_id='a5000000-0000-4000-8000-000000000003'),
 (select o.id from public.money_obligations o where o.service_request_id='a5000000-0000-4000-8000-000000000003'),
 'Visit 2 identity binds its occurrence obligation');
select is((select i.snapshot_id from public.money_recurring_occurrence_identities i where i.occurrence_request_id='a5000000-0000-4000-8000-000000000002'),
 (select id from f where key='visit-1'),'Visit 1 identity binds its published snapshot');
select is((select i.snapshot_id from public.money_recurring_occurrence_identities i where i.occurrence_request_id='a5000000-0000-4000-8000-000000000003'),
 (select id from f where key='visit-2'),'Visit 2 identity binds its published snapshot');
select isnt((select obligation_id from public.money_recurring_occurrence_identities where occurrence_request_id='a5000000-0000-4000-8000-000000000002'),
 (select obligation_id from public.money_recurring_occurrence_identities where occurrence_request_id='a5000000-0000-4000-8000-000000000003'),
 'Visits have separate obligations');
select isnt((select id from f where key='visit-1'),(select id from f where key='visit-2'),'Visits have separate snapshots');
select is(pg_temp.publish('a5000000-0000-4000-8000-000000000002'),(select id from f where key='visit-1'),'Publication retry reuses the same visit snapshot');
select is((select count(*) from public.money_recurring_occurrence_identities),2::bigint,'Publication retry does not duplicate identity');
select throws_ok($$update public.money_recurring_occurrence_identities set scheduled_at=now()$$,
 '55000','Immutable financial evidence; append a correction','Occurrence identity cannot be rewritten');
select throws_ok($$update public.money_recurring_occurrence_identities set obligation_id='a5000000-0000-4000-8000-000000000001'$$,
 '55000','Immutable financial evidence; append a correction','Occurrence identity obligation cannot be rewritten');
select throws_ok($$update public.money_recurring_occurrence_identities set snapshot_id='a5000000-0000-4000-8000-000000000001'$$,
 '55000','Immutable financial evidence; append a correction','Occurrence identity snapshot cannot be rewritten');
select throws_ok($$update public.money_recurring_occurrence_identities set source_hash='rewritten'$$,
 '55000','Immutable financial evidence; append a correction','Occurrence identity source hash cannot be rewritten');
select ok(not has_table_privilege('authenticated','public.money_recurring_occurrence_identities','INSERT'),
 'Browser cannot invent a recurring payment identity');

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
insert into f(key,id) values
 ('attempt-1',(public.money_prepare_checkout((select id from f where key='visit-1'),'full')).id),
 ('attempt-2',(public.money_prepare_checkout((select id from f where key='visit-2'),'full')).id);
reset role;
select isnt((select id from f where key='attempt-1'),(select id from f where key='attempt-2'),'Visits have separate checkout attempts');
select is((select count(distinct obligation_id) from public.money_checkout_attempts),2::bigint,'No checkout obligation is shared across visits');

select public.money_receive_event('evt_recurring_renewal','observation',
 jsonb_build_object('object_id','in_synthetic_renewal','source_type','invoice.paid'));
select is(public.money_process_event('evt_recurring_renewal'),'processed','Subscription renewal is retained as a no-effect observation');
select is((select count(*) from public.money_journals),0::bigint,'Subscription observation cannot fund either occurrence');
select is((select sum(captured) from public.money_obligations),0::numeric,'No occurrence is marked paid by subscription renewal');

select * from finish();
rollback;
