begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','{}'),
 ('81000000-0000-4000-8000-000000000002','{}'),
 ('81000000-0000-4000-8000-000000000003','{}');
insert into public.user_roles(user_id,role) values
 ('81000000-0000-4000-8000-000000000002','admin'),
 ('81000000-0000-4000-8000-000000000003','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic finance actor'),
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000002','Synthetic finance reviewer');
insert into public.contractors(id,name,is_active) values
 ('82000000-0000-4000-8000-000000000001','Synthetic cancellation provider',true);
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,scheduled_start_at) values
 ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic full cancellation','scheduled',now()+interval '73 hours'),
 ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic half cancellation','scheduled',now()+interval '25 hours'),
 ('83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic no-refund cancellation','scheduled',now()+interval '23 hours');
-- Real eligible fallback supply must produce consent/offers, never false exhaustion.
insert into auth.users(id,raw_user_meta_data) values ('81000000-0000-4000-8000-000000000004','{}');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000004','Synthetic fallback provider',true,true);
insert into public.coverage_areas(zip_code,city) values ('00000','Synthetic test area');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('82000000-0000-4000-8000-000000000002','00000');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select '89000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000002',id,
 'Synthetic fallback service','custom_quote','one-time',true from public.services_catalog order by id limit 1;
update public.service_requests set service_catalog_id=(select service_id from public.vendor_packages where id='89000000-0000-4000-8000-000000000001'),
 frequency='one-time',zip_code='00000',preferred_contractor_id='82000000-0000-4000-8000-000000000001' where id='83000000-0000-4000-8000-000000000003';

insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,captured) values
 ('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700),
 ('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700),
 ('84000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700);
insert into public.money_snapshots(id,obligation_id,revision,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at) values
 ('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day'),
 ('85000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day'),
 ('85000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day');
update public.money_obligations o set current_snapshot_id=s.id from public.money_snapshots s where s.obligation_id=o.id;
insert into public.money_checkout_attempts(id,obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,stripe_payment_id,status,expires_at,completed_at) values
 ('86000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-full','synthetic-full','pi_cancel_full','captured',now()+interval '1 day',now()),
 ('86000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-half','synthetic-half','pi_cancel_half','captured',now()+interval '1 day',now()),
 ('86000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-none','synthetic-none','pi_cancel_none','captured',now()+interval '1 day',now());

create temp table provider_fixture(key text primary key,id uuid);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002"}',true);
select public.record_job_operation('83000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000011','provider_cancel','Synthetic provider cancellation');
select public.record_job_operation('83000000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000012','no_show','Synthetic confirmed no-show');
reset role;
insert into provider_fixture select 'cancel',id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000011';
insert into provider_fixture select 'noshow',id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000012';
select throws_ok($$select public.money_preview_cancellation_refund((select id from provider_fixture where key='cancel'),'pi_cancel_full','81000000-0000-4000-8000-000000000002')$$,
 'P0001','Recorded no-replacement decision required for provider cancellation','A provider report alone cannot authorize refunds');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.record_provider_replacement_decision((select id from provider_fixture where key='cancel'),'88000000-0000-4000-8000-000000000001','Synthetic')$$,
 '42501','Operations authority required','Homeowner cannot decide replacement exhaustion');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002"}',true);
insert into provider_fixture values('decision',(public.record_provider_replacement_decision((select id from provider_fixture where key='cancel'),'88000000-0000-4000-8000-000000000001','Synthetic exhausted search')).id);
select is((select outcome from public.money_provider_replacement_decisions where id=(select id from provider_fixture where key='decision')),'no_replacement','Canonical exhausted search produces immutable no-replacement evidence');
select is((select status::text from public.service_requests where id='83000000-0000-4000-8000-000000000001'),'cancelled','Exhausted provider cancellation closes the request');
select is((public.record_provider_replacement_decision((select id from provider_fixture where key='cancel'),'88000000-0000-4000-8000-000000000001','Synthetic exhausted search')).id,
 (select id from provider_fixture where key='decision'),'Duplicate decision returns same receipt');
select throws_ok($$select public.record_provider_replacement_decision((select id from provider_fixture where key='cancel'),'88000000-0000-4000-8000-000000000001','Changed')$$,
 'P0001','Replacement decision idempotency conflict','Changed decision intent fails');
select throws_ok($$update public.money_provider_replacement_decisions set reason='Changed'$$,'55000','Immutable financial evidence; append a correction','Decision history is immutable');
select ok(not has_table_privilege('authenticated','public.money_provider_replacement_decisions','INSERT'),'Browser cannot insert an invented outcome');
select ok(not has_function_privilege('anon','public.record_provider_replacement_decision(uuid,uuid,text)','EXECUTE'),'Anonymous caller cannot decide replacement exhaustion');
-- Existing successful assignment must remain active, even with an old no-show report.
update public.service_requests set status='scheduled',contractor_id='82000000-0000-4000-8000-000000000001',matching_status='matched' where id='83000000-0000-4000-8000-000000000002';
select is((public.record_provider_replacement_decision((select id from provider_fixture where key='noshow'),'88000000-0000-4000-8000-000000000002','Synthetic replacement accepted')).outcome,
 'replacement_active','Accepted replacement prevents full-refund decision');
select throws_ok($$select public.money_preview_cancellation_refund((select id from provider_fixture where key='noshow'),'pi_cancel_half','81000000-0000-4000-8000-000000000002')$$,
 'P0001','Recorded no-replacement decision required for provider cancellation','Successful replacement cannot enable refund');
-- A subsequent canonical cancellation of that replacement produces a fresh operation.
select public.record_job_operation('83000000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000013','no_show','Synthetic replacement no-show');
insert into provider_fixture select 'final-noshow',id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000013';
select is((public.record_provider_replacement_decision((select id from provider_fixture where key='final-noshow'),'88000000-0000-4000-8000-000000000003','Synthetic no-show exhaustion')).outcome,
 'no_replacement','Operations-confirmed no-show uses canonical rematch exhaustion');
select public.record_job_operation('83000000-0000-4000-8000-000000000003','87000000-0000-4000-8000-000000000014','provider_cancel','Synthetic consent case');
insert into provider_fixture select 'consent',id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000014';
select is((public.record_provider_replacement_decision((select id from provider_fixture where key='consent'),'88000000-0000-4000-8000-000000000004','Synthetic consent pending')).outcome,
 'awaiting_consent','Pending homeowner consent is not exhausted supply');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000001"}',true);
select public.consent_to_provider_fallback('83000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002"}',true);
select is((public.record_provider_replacement_decision((select id from provider_fixture where key='consent'),'88000000-0000-4000-8000-000000000005','Synthetic offer pending')).outcome,
 'replacement_active','Pending exclusive offer prevents no-replacement decision');
select is((select count(*) from public.job_match_attempts where service_request_id='83000000-0000-4000-8000-000000000003' and outcome='pending'),1::bigint,'Replacement check preserves one exclusive offer');
create function pg_temp.provider_plan() returns jsonb language sql as $$
 select public.money_preview_cancellation_refund((select id from provider_fixture where key='cancel'),'pi_cancel_full','81000000-0000-4000-8000-000000000002') $$;
select is(pg_temp.provider_plan()->>'refund_percent','100','Provider cancellation receives full refund');
select is(pg_temp.provider_plan()->>'service','10000','Full service component');
select is(pg_temp.provider_plan()->>'tax','700','Full tax component');
select is(pg_temp.provider_plan()->>'tip','1000','Full tip component');
select throws_ok($$select public.money_authorize_cancellation_refund((select id from provider_fixture where key='cancel'),'pi_cancel_full','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic provider refund')$$,
 '42501','Separate authenticated approval of exact financial command required','Refund still requires separate finance approval');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000003"}',true);
select public.money_approve_review('81000000-0000-4000-8000-000000000002',jsonb_build_object(
 'operation','refund','obligation',p->>'obligation_id','payment','pi_cancel_full','service',(p->>'service')::bigint,'tax',(p->>'tax')::bigint,'tip',(p->>'tip')::bigint,
 'key',p->>'business_key','policy',p->>'policy_evidence','reason','Synthetic provider refund'),'Synthetic independent review') from pg_temp.provider_plan() p;
insert into provider_fixture values('refund',public.money_authorize_cancellation_refund((select id from provider_fixture where key='cancel'),'pi_cancel_full',
 '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic provider refund'));
select is(public.money_authorize_cancellation_refund((select id from provider_fixture where key='cancel'),'pi_cancel_full',
 '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic provider refund'),(select id from provider_fixture where key='refund'),'Refund retry is stable');
select is((select count(*) from public.money_operation_refund_sources),1::bigint,'Exactly one source-bound refund reservation');
select throws_ok($$select private.money_completion_source('84000000-0000-4000-8000-000000000002')$$,
 'P0001','Replacement commercial reconciliation required before payout','Replacement cannot pay the original captured agreement');
select throws_ok($$insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at)
 values('84000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-replacement','synthetic-replacement','prepared',now()+interval '1 day')$$,
 'P0001','Replacement commercial reconciliation required before checkout','Replacement cannot charge against the old agreement');
select throws_ok($$update public.service_requests set description='Changed captured scope' where id='83000000-0000-4000-8000-000000000003'$$,
 'P0001','Commercial checkout must be reconciled before changing source','Replacement exception cannot rewrite captured scope');
select * from finish();
rollback;