begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('91000000-0000-4000-8000-000000000001','{}'),
 ('91000000-0000-4000-8000-000000000002','{}'),
 ('91000000-0000-4000-8000-000000000003','{}'),
 ('91000000-0000-4000-8000-000000000004','{}');
insert into public.user_roles(user_id,role) values
 ('91000000-0000-4000-8000-000000000002','admin'),
 ('91000000-0000-4000-8000-000000000003','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Synthetic actor'),
 ('91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002','Synthetic reviewer');
insert into public.contractors(id,name,is_active) values
 ('92000000-0000-4000-8000-000000000001','Cancelled provider',true),
 ('92000000-0000-4000-8000-000000000002','Replacement provider',false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('93000000-0000-4000-8000-000000000001','Replacement provider','Test','Fixture','replacement@example.invalid','synthetic',
 '92000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"91000000-0000-4000-8000-000000000002"}',true);
select public.vendor_begin_review('92000000-0000-4000-8000-000000000002',(select id from public.vendor_application_versions where application_id='93000000-0000-4000-8000-000000000001'));
do $$ declare kind text; begin
  foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
    perform public.vendor_record_evidence('92000000-0000-4000-8000-000000000002',kind,'synthetic-rule','private-replacement-'||kind,now()-interval '1 hour',now()+interval '1 year');
  end loop;
end $$;
select public.vendor_decide_onboarding('92000000-0000-4000-8000-000000000002',1,'activate','Synthetic review','activate');

insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,scheduled_start_at)
 values('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',
 '92000000-0000-4000-8000-000000000001','Synthetic','Paid replacement','scheduled',now()+interval '3 days');
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,captured)
 values('95000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',11700);
insert into public.money_snapshots(id,obligation_id,revision,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at)
 values('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001',1,10000,0,0,0,10000,700,1000,0,11700,'usd',
 'synthetic-v1','CFG-005','synthetic','91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Synthetic paid agreement',now()+interval '1 day');
update public.money_obligations set current_snapshot_id='96000000-0000-4000-8000-000000000001' where id='95000000-0000-4000-8000-000000000001';
insert into public.money_checkout_attempts(id,obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,stripe_payment_id,status,expires_at,completed_at)
 values('97000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
 '91000000-0000-4000-8000-000000000001','full',11700,'usd','paid-replacement','paid-replacement','pi_paid_replacement','captured',now()+interval '1 day',now());

select public.record_job_operation('94000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','provider_cancel','Provider cancelled');
create temp table f(key text primary key,id uuid);
insert into f select 'operation',id from public.job_operations where operation_key='98000000-0000-4000-8000-000000000001';
update public.service_requests set contractor_id='92000000-0000-4000-8000-000000000002',status='scheduled',matching_status='matched'
 where id='94000000-0000-4000-8000-000000000001';
insert into public.job_match_attempts(service_request_id,contractor_id,attempt_number,outcome,responded_at,accepted_at)
 select '94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002',1,'accepted',now(),now()
 where not exists(select 1 from public.job_match_attempts where service_request_id='94000000-0000-4000-8000-000000000001' and contractor_id='92000000-0000-4000-8000-000000000002');
update public.job_match_attempts set outcome='accepted',responded_at=now(),accepted_at=now()
 where service_request_id='94000000-0000-4000-8000-000000000001' and contractor_id='92000000-0000-4000-8000-000000000002';
insert into f values('decision',(public.record_provider_replacement_decision(
 (select id from f where key='operation'),'98000000-0000-4000-8000-000000000002','Replacement accepted')).id);
reset role;

create function pg_temp.reconcile_command() returns jsonb language sql as $$
 select jsonb_build_object('operation','replacement_reconciliation',
  'provider_operation',(select id from f where key='operation'),
  'replacement_decision',(select id from f where key='decision'),
  'obligation','95000000-0000-4000-8000-000000000001'::uuid,
  'snapshot','96000000-0000-4000-8000-000000000001'::uuid,'captured',11700,
  'original_contractor','92000000-0000-4000-8000-000000000001'::uuid,
  'replacement_contractor','92000000-0000-4000-8000-000000000002'::uuid,
  'source_hash','legacy-snapshot:96000000-0000-4000-8000-000000000001',
  'reason','Assign paid agreement to accepted replacement') $$;
select throws_ok($$select public.money_reconcile_replacement((select id from f where key='operation'),(select id from f where key='decision'),
 '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Assign paid agreement to accepted replacement')$$,
 '42501','Separate authenticated approval of exact financial command required','A supplied reviewer UUID is not approval');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"91000000-0000-4000-8000-000000000003"}',true);
select public.money_approve_review('91000000-0000-4000-8000-000000000002',pg_temp.reconcile_command(),'Independent replacement payee review');
reset role;
insert into f values('reconciliation',(public.money_reconcile_replacement((select id from f where key='operation'),(select id from f where key='decision'),
 '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Assign paid agreement to accepted replacement')).id);
select is((select replacement_contractor_id from public.money_replacement_reconciliations where id=(select id from f where key='reconciliation')),
 '92000000-0000-4000-8000-000000000002'::uuid,'Immutable reconciliation assigns proceeds to accepted replacement');
select is((select contractor_id from public.money_obligations where id='95000000-0000-4000-8000-000000000001'),
 '92000000-0000-4000-8000-000000000001'::uuid,'Original obligation party remains unchanged');
select is((select captured from public.money_obligations where id='95000000-0000-4000-8000-000000000001'),11700::bigint,'Captured customer amount remains unchanged');
select is((public.money_reconcile_replacement((select id from f where key='operation'),(select id from f where key='decision'),
 '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Assign paid agreement to accepted replacement')).id,
 (select id from f where key='reconciliation'),'Exact retry returns the same reconciliation');
select throws_ok($$update public.money_replacement_reconciliations set reason='changed'$$,'55000','Immutable financial evidence; append a correction','Payee evidence is immutable');
select ok(not has_function_privilege('authenticated','public.money_reconcile_replacement(uuid,uuid,uuid,uuid,text)','EXECUTE'),'Browser cannot reassign provider proceeds');

update public.service_requests set status='completed',homeowner_confirmed_at=now()-interval '49 hours'
 where id='94000000-0000-4000-8000-000000000001';
insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
 select id,customer_id,contractor_id,homeowner_confirmed_at from public.service_requests where id='94000000-0000-4000-8000-000000000001';
select is(public.money_payable('95000000-0000-4000-8000-000000000001'),9500::bigint,'Replacement completion earns 85 percent service plus all tips');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"91000000-0000-4000-8000-000000000003"}',true);
select public.money_approve_review('91000000-0000-4000-8000-000000000002',jsonb_build_object(
 'operation','ach','period',current_date,'obligations',array['95000000-0000-4000-8000-000000000001'::uuid],
 'bank_ref','private-form','reason','Synthetic replacement ACH'),'Independent ACH review');
reset role;
insert into f values('batch',public.money_prepare_ach(current_date,array['95000000-0000-4000-8000-000000000001'::uuid],
 '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','private-form','Synthetic replacement ACH'));
select is((select contractor_id from public.money_ach_items where batch_id=(select id from f where key='batch')),
 '92000000-0000-4000-8000-000000000002'::uuid,'ACH statement names the replacement provider');
select is((select bank_evidence_id from public.money_ach_items where batch_id=(select id from f where key='batch')),
 (select id from public.vendor_compliance_evidence where contractor_id='92000000-0000-4000-8000-000000000002' and kind='bank_authorization'),'ACH binds replacement bank authorization');
select throws_ok($$select public.money_reconcile_replacement((select id from f where key='operation'),(select id from f where key='decision'),
 '91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','Changed intent')$$,
 '42501','Separate authenticated approval of exact financial command required','Changed reconciliation intent needs a new exact approval');
select is((select count(*) from public.money_ach_items),1::bigint,'Only one provider statement exists for the obligation');

select * from finish();
rollback;
