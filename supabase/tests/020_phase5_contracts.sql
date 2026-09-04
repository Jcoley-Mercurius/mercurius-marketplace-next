begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('51000000-0000-4000-8000-000000000002','{"full_name":"Synthetic other homeowner"}'),
 ('51000000-0000-4000-8000-000000000003','{"full_name":"Synthetic finance operator"}'),
 ('51000000-0000-4000-8000-000000000004','{"full_name":"Synthetic finance reviewer"}');
insert into public.user_roles(user_id,role) values
 ('51000000-0000-4000-8000-000000000003','admin'),('51000000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic test'),
 ('51000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000003','Synthetic test');
insert into public.contractors(id,name,is_active) values('52000000-0000-4000-8000-000000000001','Synthetic provider',false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('53000000-0000-4000-8000-000000000001','Synthetic provider','Test','Fixture','vendor@example.invalid','synthetic','52000000-0000-4000-8000-000000000001');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
 values('54000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
create temp table f(key text primary key,id uuid);
grant select on f to authenticated;
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000004"}',true);
  perform public.money_approve_review('51000000-0000-4000-8000-000000000003',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
select throws_ok($$select public.money_publish_snapshot('54000000-0000-4000-8000-000000000001',pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004')$$,'42501','Separate authenticated approval of exact financial command required','Supplying another admin UUID is not second-person approval');
select pg_temp.approve(jsonb_build_object('operation','snapshot','request','54000000-0000-4000-8000-000000000001','terms',pg_temp.terms()));
insert into f values('snapshot',public.money_publish_snapshot('54000000-0000-4000-8000-000000000001',pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004'));
insert into f select 'obligation',obligation_id from public.money_snapshots where id=(select id from f where key='snapshot');
select is((select invoice_number from public.money_snapshots where id=(select id from f where key='snapshot')) like 'M5-%',true,'Collision-safe invoice namespace');
select throws_ok($$update public.money_snapshots set tax=0$$,'55000','Immutable financial evidence; append a correction','Snapshots cannot be edited');
select throws_ok($$delete from public.money_snapshots$$,'55000','Immutable financial evidence; append a correction','Snapshots cannot be deleted');
select throws_ok($$select public.money_publish_snapshot('54000000-0000-4000-8000-000000000001',pg_temp.terms(),'51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000004')$$,'42501','Restricted finance authority required','Homeowner cannot author commercial amounts');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000002"}',true);
select is((select count(*) from public.money_snapshots),0::bigint,'Other homeowner cannot read snapshots');
select throws_ok($$select public.money_prepare_checkout((select id from f where key='snapshot'),'full')$$,'42501','Homeowner authorization required','Cross-account checkout denied');
select throws_ok($$insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(null,'x','x','[]','x')$$,'42501','permission denied for table money_journals','Browser cannot post ledger');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select is((select count(*) from public.money_snapshots),1::bigint,'Homeowner sees own immutable breakdown');
select throws_ok($$select tax_evidence from public.money_snapshots$$,'42501',null,'Homeowner cannot read internal tax evidence');
select throws_ok($$select approved_by from public.money_snapshots$$,'42501',null,'Homeowner cannot read finance approver identities');
select throws_ok($$select stripe_idempotency_key from public.money_checkout_attempts$$,'42501',null,'Homeowner cannot directly select provider idempotency keys');
select lives_ok($$select policy_version,total from public.money_snapshots$$,'Customer policy and price remain readable');
select lives_ok($$select public.money_prepare_checkout((select id from f where key='snapshot'),'deposit')$$,'Homeowner may authorize only server deposit amount');
select lives_ok($$select public.money_prepare_checkout((select id from f where key='snapshot'),'deposit')$$,'Repeated checkout returns existing attempt');
select throws_ok($$select public.money_prepare_checkout((select id from f where key='snapshot'),'full')$$,'P0001','Checkout already in progress','Cross-mode race cannot create second live payment');
reset role;
insert into f select 'deposit',id from public.money_checkout_attempts where snapshot_id=(select id from f where key='snapshot');
select is((select count(*) from public.money_checkout_attempts),1::bigint,'Exactly one durable checkout attempt');
select is((select amount from public.money_checkout_attempts where id=(select id from f where key='deposit')),3000::bigint,'Deposit amount comes from snapshot');
select public.money_receive_event('evt_deposit','capture',jsonb_build_object('attempt_id',(select id from f where key='deposit'),'payment_id','pi_deposit','amount',3000,'currency','usd'));
select is(public.money_process_event('evt_deposit'),'processed','Deposit capture processed');
select is(public.money_process_event('evt_deposit'),'processed','Duplicate delivery is safe');
select is((select count(*) from public.money_journals),1::bigint,'Deposit posts once as advance, no earnings yet');
select public.money_receive_event('evt_bad','capture',jsonb_build_object('attempt_id',(select id from f where key='deposit'),'payment_id','pi_other','amount',3001,'currency','usd'));
select is(public.money_process_event('evt_bad'),'failed','Mismatched capture fails transactionally');
select is((select status from public.money_webhook_events where event_id='evt_bad'),'failed','Failed receipt retained');
select is((select captured from public.money_obligations where id=(select id from f where key='obligation')),3000::bigint,'Failed event did not alter captured money');
select is((select count(*) from public.money_journals),1::bigint,'Failed processing creates no partial ledger');
select throws_ok($$select public.money_receive_event('evt_bad','capture','{"different":true}')$$,'P0001','Event identity conflict','Same event ID cannot change payload');
-- The deliberate mismatch above is retained for reconciliation; this fixture continues with the valid original payment.
select pg_temp.approve(jsonb_build_object('operation','event_exclusion','event','evt_bad','reason','Synthetic duplicate mismatch confirmed to have no effect','evidence','synthetic-provider-readback'));
select public.money_exclude_event('evt_bad','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic duplicate mismatch confirmed to have no effect','synthetic-provider-readback');
select is((select status from public.money_webhook_events where event_id='evt_bad'),'dead_letter','Excluded event retained, never relabelled processed');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.money_prepare_checkout((select id from f where key='snapshot'),'balance')$$,'Balance deducts previously captured deposit');
reset role;
insert into f select 'balance',id from public.money_checkout_attempts where snapshot_id=(select id from f where key='snapshot') and mode='balance';
select is((select amount from public.money_checkout_attempts where id=(select id from f where key='balance')),8700::bigint,'Balance excludes deposit already paid');
select public.money_receive_event('evt_balance','capture',jsonb_build_object('attempt_id',(select id from f where key='balance'),'payment_id','pi_balance','amount',8700,'currency','usd'));
select is(public.money_process_event('evt_balance'),'processed','Balance captured');
select is((select count(*) from public.money_journals where kind='earnings'),1::bigint,'One final earnings allocation, not one fee per installment');
select is((select (l->>'credit')::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where kind='earnings' and l->>'account'='provider_payable'),9500::bigint,'Provider receives 85 percent service plus all tips');
select is((select (l->>'credit')::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where kind='earnings' and l->>'account'='platform_revenue'),1500::bigint,'Platform excludes tax and tips');
select pg_temp.approve(jsonb_build_object('operation','refund','obligation',(select id from f where key='obligation'),'payment','pi_balance','service',2000,'tax',140,'tip',0,'key','refund-1','policy','synthetic-CFG-006-exception','reason','Documented synthetic adjustment'));
insert into f values('refund',public.money_authorize_refund((select id from f where key='obligation'),'pi_balance',2000,140,0,'refund-1','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','synthetic-CFG-006-exception','Documented synthetic adjustment'));
select is(public.money_authorize_refund((select id from f where key='obligation'),'pi_balance',2000,140,0,'refund-1','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','synthetic-CFG-006-exception','Documented synthetic adjustment'),(select id from f where key='refund'),'Refund authorization retry stable');
select pg_temp.approve(jsonb_build_object('operation','refund','obligation',(select id from f where key='obligation'),'payment','pi_balance','service',9000,'tax',0,'tip',0,'key','refund-too-much','policy','policy','reason','reason'));
select throws_ok($$select public.money_authorize_refund((select id from f where key='obligation'),'pi_balance',9000,0,0,'refund-too-much','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','policy','reason')$$,'P0001','Refund exceeds remaining components','Pending refund reserves allocation');
select public.money_receive_event('evt_refund','refund',jsonb_build_object('authorization_id',(select id from f where key='refund'),'refund_id','re_partial','payment_id','pi_balance','amount',2140,'currency','usd'));
select is(public.money_process_event('evt_refund'),'processed','Partial refund allocated to service and tax');
select is(public.money_process_event('evt_refund'),'processed','Refund event replay safe');
select is((select refunded_service from public.money_obligations where id=(select id from f where key='obligation')),2000::bigint,'Refund does not double count');
select is((select (l->>'debit')::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where kind='refund' and l->>'account'='platform_revenue'),300::bigint,'Refund fee recomputed against retained subtotal');
select is((select count(*) from public.money_refunds),1::bigint,'Refund provider identity unique');
select throws_ok($$insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values((select id from f where key='obligation'),'bad','bad','[{"account":"bank","debit":10,"credit":0},{"account":"provider_payable","debit":0,"credit":9}]','synthetic')$$,'P0001','Unbalanced journal','Unbalanced journal cannot commit');

-- Versioned onboarding, invitation and current-evidence gates.
select is((select count(*) from public.vendor_application_versions),1::bigint,'Application intake versioned');
update public.vendor_applications set business_name='Synthetic revised provider' where id='53000000-0000-4000-8000-000000000001';
select is((select count(*) from public.vendor_application_versions),2::bigint,'Application revision retains original');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select public.vendor_begin_review('52000000-0000-4000-8000-000000000001',(select id from public.vendor_application_versions order by revision desc limit 1));
select throws_ok($$select public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',1,'activate','review','activate-early')$$,'P0001','Activation checklist incomplete or expired','Cannot activate before vetting');
do $$ declare kind text; begin
  foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
    perform public.vendor_record_evidence('52000000-0000-4000-8000-000000000001',kind,'synthetic-requirement-v1','private-synthetic-'||kind,now()-interval '1 hour',now()+interval '1 year');
  end loop;
end $$;
select is(public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',1,'activate','All synthetic checks reviewed','activate-1'),2,'Recorded activation with evidence');
select is(public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',1,'activate','All synthetic checks reviewed','activate-1'),2,'Activation retry does not duplicate history');
select is(public.vendor_is_eligible('52000000-0000-4000-8000-000000000001'),true,'Current licensed and insured vendor eligible');
select is(public.vendor_evidence_current('52000000-0000-4000-8000-000000000001',now()+interval '1 year'),false,'Exact evidence expiry blocks eligibility');
select is((select is_active from public.contractors where id='52000000-0000-4000-8000-000000000001'),false,'Independent activation does not mutate legacy matching');
select is(public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',2,'suspend','Synthetic suspension','suspend-1'),3,'Suspension retained');
select is(public.vendor_is_eligible('52000000-0000-4000-8000-000000000001'),false,'Suspension overrides valid documents');
select is(public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',3,'renew','Synthetic renewal','renew-1'),4,'Renewal evidence recorded');
select is(public.vendor_is_eligible('52000000-0000-4000-8000-000000000001'),false,'Renewal does not lift suspension');
select is(public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',4,'activate','Reviewed reactivation','activate-2'),5,'Explicit reviewed reactivation');
insert into f values('revoke-before-send',public.vendor_prepare_invitation('52000000-0000-4000-8000-000000000001','revoke-before-send',now()+interval '1 day'));
select lives_ok($$select public.vendor_record_invitation((select id from f where key='revoke-before-send'),'revoked',null,'Synthetic cancellation before sending')$$,'Prepared invitation can be revoked without invented provider reference');
insert into f values('invite',public.vendor_prepare_invitation('52000000-0000-4000-8000-000000000001','invite-1',now()+interval '1 day'));
select is(public.vendor_prepare_invitation('52000000-0000-4000-8000-000000000001','invite-1',now()+interval '1 day'),(select id from f where key='invite'),'Invite retry preserves same attempt');
select public.vendor_record_invitation((select id from f where key='invite'),'submitted','synthetic-invite','Synthetic provider request');
select public.vendor_record_invitation((select id from f where key='invite'),'unknown','synthetic-invite','Synthetic timeout');
select throws_ok($$select public.vendor_prepare_invitation('52000000-0000-4000-8000-000000000001','invite-2',now()+interval '1 day')$$,'23505',null,'Unknown invite cannot create concurrent resend');
select public.vendor_record_invitation((select id from f where key='invite'),'delivered','synthetic-invite','Synthetic provider readback');
select public.vendor_record_invitation((select id from f where key='invite'),'accepted','synthetic-invite','Synthetic Auth acceptance');
select is((select count(*) from public.vendor_onboarding_events),4::bigint,'Invite acceptance does not add activation event');

-- Owner bank ACH: eligibility is explicit; no provider calls occur.
select throws_ok($$select public.money_payable((select id from f where key='obligation'))$$,'P0001','Verified lifecycle confirmation required','Vendor completion alone cannot release funds');
-- Privileged synthetic historical receipt; public homeowner capture is exercised in 024.
update public.service_requests set status='completed',homeowner_confirmed_at=now()-interval '48 hours' where id='54000000-0000-4000-8000-000000000001';
insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
 values('54000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001',now()-interval '48 hours');
select is(public.money_payable((select id from f where key='obligation')),7800::bigint,'Eligible exactly at 48h, retained subtotal and full tip');
insert into f values('hold',public.money_place_hold((select id from f where key='obligation'),'dispute-test','51000000-0000-4000-8000-000000000003','Dispute','synthetic-ticket'));
select throws_ok($$select public.money_payable((select id from f where key='obligation'))$$,'P0001','Unresolved payout hold','Dispute stays held after 48h');
select public.money_resolve_hold((select id from f where key='hold'),'51000000-0000-4000-8000-000000000003','Resolved','synthetic-resolution');
select is(public.money_payable((select id from f where key='obligation')),7800::bigint,'Resolution retains original confirmation clock');
select pg_temp.approve(jsonb_build_object('operation','ach','period',current_date,'obligations',array[(select id from f where key='obligation')],'bank_ref','private-bank-form','reason','Synthetic weekly ACH'));
insert into f values('batch',public.money_prepare_ach(current_date,array[(select id from f where key='obligation')],'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','private-bank-form','Synthetic weekly ACH'));
insert into f select 'ach-item',id from public.money_ach_items where batch_id=(select id from f where key='batch');
insert into f select 'ach-attempt',id from public.money_ach_attempts where item_id=(select id from f where key='ach-item');
select is((select amount from public.money_ach_items where id=(select id from f where key='ach-item')),7800::bigint,'Immutable weekly statement amount');
select is((select count(*) from public.money_journals where kind like 'ach_%'),0::bigint,'Prepared statement is not a settled payout');
select public.money_record_ach((select id from f where key='ach-attempt'),'submitted','bank-synthetic-1','51000000-0000-4000-8000-000000000003','Owner recorded bank submission','bank-submit-1');
select public.money_record_ach((select id from f where key='ach-attempt'),'unknown','bank-synthetic-1','51000000-0000-4000-8000-000000000003','Bank outcome unknown','bank-unknown-1');
select pg_temp.approve(jsonb_build_object('operation','ach_retry','item',(select id from f where key='ach-item')));
select throws_ok($$select public.money_retry_ach((select id from f where key='ach-item'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004')$$,'P0001','Bank outcome unresolved or already paid; do not resend','Unknown bank result cannot be retried');
select public.money_record_ach((select id from f where key='ach-attempt'),'failed','bank-synthetic-1','51000000-0000-4000-8000-000000000003','Bank confirmed failure','bank-failed-1');
insert into f values('ach-retry',public.money_retry_ach((select id from f where key='ach-item'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004'));
select is((select count(*) from public.money_ach_attempts),2::bigint,'Failure creates distinct retry linked to original statement');
select public.money_record_ach((select id from f where key='ach-retry'),'submitted','bank-synthetic-2','51000000-0000-4000-8000-000000000003','Owner retry submission','bank-submit-2');
select public.money_record_ach((select id from f where key='ach-retry'),'settled','bank-synthetic-2','51000000-0000-4000-8000-000000000003','Bank settlement evidence','bank-settle-2');
select public.money_record_ach((select id from f where key='ach-retry'),'settled','bank-synthetic-2','51000000-0000-4000-8000-000000000003','Bank settlement evidence','bank-settle-2');
select is((select count(*) from public.money_journals where kind='ach_settled'),1::bigint,'Bank settlement posts once');
select public.money_record_ach((select id from f where key='ach-retry'),'returned','bank-synthetic-2','51000000-0000-4000-8000-000000000003','Bank return evidence','bank-return-2');
select is((select count(*) from public.money_journals where kind='ach_returned'),1::bigint,'Bank return restores payable, retains history');
select public.money_receive_event('evt_won_first','dispute','{"dispute_id":"dp_synthetic","payment_id":"pi_balance","amount":1000,"currency":"usd","state":"won"}');
select is(public.money_process_event('evt_won_first'),'processed','Closed dispute accepted before opened event');
select public.money_receive_event('evt_open_late','dispute','{"dispute_id":"dp_synthetic","payment_id":"pi_balance","amount":1000,"currency":"usd","state":"open"}');
select is(public.money_process_event('evt_open_late'),'processed','Late dispute opened event is harmless');
select is((select status from public.money_disputes where provider_id='dp_synthetic'),'won','Late event cannot restore closed dispute');
select is((select count(*) from public.money_journals where kind='chargeback_suspense'),1::bigint,'One suspense debit despite out-of-order delivery');
select is((select dispute_open from public.money_obligations where id=(select id from f where key='obligation')),false,'Won dispute does not invent a new payout delay');
select public.money_record_processor_cost((select id from f where key='obligation'),'txn_synthetic',250,'synthetic-processor-statement');
select public.money_record_processor_cost((select id from f where key='obligation'),'txn_synthetic',250,'synthetic-processor-statement');
select is((select count(*) from public.money_journals where kind='processor_cost'),1::bigint,'Processor statement deduplicated');
select is(public.money_payable((select id from f where key='obligation')),7800::bigint,'Processor costs do not reduce provider payable');
select is(public.money_record_reconciliation((select id from f where key='obligation'),'reconcile-match',9560,'usd','synthetic-capture-refund-readback'),true,'Net provider readback matches captured less refunded');
select is(public.money_record_reconciliation((select id from f where key='obligation'),'reconcile-mismatch',9559,'usd','synthetic-mismatch-readback'),false,'Reconciliation detects one-cent drift');
select throws_ok($$select public.money_payable((select id from f where key='obligation'))$$,'P0001','Payment or dispute hold','Reconciliation drift holds payouts');
insert into f select 'stale-readback',id from public.money_reconciliation where observation_key='reconcile-match';
select pg_temp.approve(jsonb_build_object('operation','reconciliation_resolution','observation',(select id from f where key='stale-readback'),'reason','Synthetic stale resolution'));
select throws_ok($$select public.money_resolve_reconciliation((select id from f where key='stale-readback'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic stale resolution')$$,'P0001','Current matching provider readback required','Older matching observation cannot clear newer drift');
select public.money_record_reconciliation((select id from f where key='obligation'),'reconcile-current',9560,'usd','synthetic-current-readback');
insert into f select 'current-readback',id from public.money_reconciliation where observation_key='reconcile-current';
select pg_temp.approve(jsonb_build_object('operation','reconciliation_resolution','observation',(select id from f where key='current-readback'),'reason','Synthetic verified resolution'));
select lives_ok($$select public.money_resolve_reconciliation((select id from f where key='current-readback'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic verified resolution')$$,'Current separately reviewed readback clears reconciliation');
select is((select reconciliation_open from public.money_obligations where id=(select id from f where key='obligation')),false,'Resolved drift flag is cleared');
create function pg_temp.new_order(label text,mode text) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address) values(request,'51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','house-cleaning','Synthetic test address');
  perform pg_temp.approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=public.money_publish_snapshot(request,pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004');
  insert into f values(label||'-snapshot',snapshot);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
  attempt:=public.money_prepare_checkout(snapshot,mode);
  insert into f values(label||'-attempt',attempt.id),(label||'-obligation',attempt.obligation_id);
  perform public.money_receive_event('evt_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  perform set_config('request.jwt.claims',previous,true);
end $$;
select pg_temp.new_order('full','full');
select pg_temp.approve(jsonb_build_object('operation','refund','obligation',(select id from f where key='full-obligation'),'payment','pi_full','service',10000,'tax',700,'tip',1000,'key','full-refund','policy','CFG-006-full-refund','reason','Synthetic cancellation'));
insert into f values('full-refund',public.money_authorize_refund((select id from f where key='full-obligation'),'pi_full',10000,700,1000,'full-refund','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','CFG-006-full-refund','Synthetic cancellation'));
select public.money_receive_event('evt_full_refund','refund',jsonb_build_object('authorization_id',(select id from f where key='full-refund'),'refund_id','re_full','payment_id','pi_full','amount',11700,'currency','usd'));
select is(public.money_process_event('evt_full_refund'),'processed','Full refund processed with exact service/tax/tip allocation');
select is((select sum((l->>'credit')::bigint-(l->>'debit')::bigint)::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where j.obligation_id=(select id from f where key='full-obligation') and l->>'account'='provider_payable'),0::bigint,'Full refund leaves no provider payable');
select is((select sum((l->>'credit')::bigint-(l->>'debit')::bigint)::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where j.obligation_id=(select id from f where key='full-obligation') and l->>'account'='platform_revenue'),0::bigint,'Full refund reverses full platform fee');
select pg_temp.new_order('advance','deposit');
select pg_temp.approve(jsonb_build_object('operation','refund','obligation',(select id from f where key='advance-obligation'),'payment','pi_advance','service',3000,'tax',0,'tip',0,'key','advance-refund','policy','CFG-006-full-refund','reason','Synthetic deposit cancellation'));
insert into f values('advance-refund',public.money_authorize_refund((select id from f where key='advance-obligation'),'pi_advance',3000,0,0,'advance-refund','51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','CFG-006-full-refund','Synthetic deposit cancellation'));
select lives_ok($$select public.money_prepare_refund((select id from f where key='advance-refund'),'51000000-0000-4000-8000-000000000003')$$,'Refund attempt persisted before provider call');
select lives_ok($$select public.money_prepare_refund((select id from f where key='advance-refund'),'51000000-0000-4000-8000-000000000003')$$,'Retry obtains same local refund attempt');
select is((select count(*) from public.money_refund_attempts),1::bigint,'No duplicate refund attempt');
select public.money_record_refund_result((select id from f where key='advance-refund'),'re_advance','succeeded',3000);
select is((select status from public.money_refund_attempts where authorization_id=(select id from f where key='advance-refund')),'pending','Provider response alone does not claim ledger completion');
select public.money_receive_event('evt_advance_refund','refund',jsonb_build_object('authorization_id',(select id from f where key='advance-refund'),'refund_id','re_advance','payment_id','pi_advance','amount',3000,'currency','usd'));
select is(public.money_process_event('evt_advance_refund'),'processed','Deposit refund reconciles customer advance');
select is((select count(*) from public.money_journals where obligation_id=(select id from f where key='advance-obligation') and kind='earnings'),0::bigint,'Deposit refund never invents earned provider or platform money');
select is((public.money_prepare_refund((select id from f where key='advance-refund'),'51000000-0000-4000-8000-000000000003')).status,'succeeded','Retry after webhook returns reconciled result');
select pg_temp.new_order('loss','full');
select public.money_receive_event('evt_loss_open','dispute','{"dispute_id":"dp_loss","payment_id":"pi_loss","amount":1000,"currency":"usd","state":"open"}');
select is(public.money_process_event('evt_loss_open'),'processed','Chargeback holds unpaid funds');
select public.money_receive_event('evt_loss_closed','dispute','{"dispute_id":"dp_loss","payment_id":"pi_loss","amount":1000,"currency":"usd","state":"lost"}');
select is(public.money_process_event('evt_loss_closed'),'processed','Lost principal remains in suspense pending allocation');
select is((select dispute_open from public.money_obligations where id=(select id from f where key='loss-obligation')),true,'Lost chargeback remains held until reviewed');
select pg_temp.approve(jsonb_build_object('operation','chargeback','dispute','dp_loss','service',1000,'tax',0,'tip',0,'reason','Synthetic principal allocation'));
select lives_ok($$select public.money_resolve_chargeback_loss('dp_loss',1000,0,0,'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic principal allocation')$$,'Reviewed loss allocates principal without fabricating a refund');
select is((select service from public.money_retained_parts((select id from f where key='loss-obligation'))),9000::bigint,'Lost service principal reduces retained fee base');
select is((select refunded_service from public.money_obligations where id=(select id from f where key='loss-obligation')),0::bigint,'Chargeback is distinct from customer refund');
select is((select sum((l->>'debit')::bigint-(l->>'credit')::bigint)::bigint from public.money_journals j cross join lateral jsonb_array_elements(j.lines) l where obligation_id=(select id from f where key='loss-obligation') and l->>'account'='chargeback_suspense'),0::bigint,'Reviewed principal clears suspense');
select is((select count(*) from cron.job where active),0::bigint,'No active Cron jobs');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address) values('54000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','house-cleaning','Synthetic expiry address');
select pg_temp.approve(jsonb_build_object('operation','snapshot','request','54000000-0000-4000-8000-000000000002','terms',pg_temp.terms()));
insert into f values('expiry-snapshot',public.money_publish_snapshot('54000000-0000-4000-8000-000000000002',pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004'));
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
insert into f select 'expired-attempt',(public.money_prepare_checkout((select id from f where key='expiry-snapshot'),'full')).id;
select public.money_receive_event('evt_expiry','checkout_expired',jsonb_build_object('attempt_id',(select id from f where key='expired-attempt'),'session_id','cs_test_expiry'));
select is(public.money_process_event('evt_expiry'),'processed','Verified provider expiry releases attempt');
insert into f select 'replacement-attempt',(public.money_prepare_checkout((select id from f where key='expiry-snapshot'),'full')).id;
select isnt((select id from f where key='replacement-attempt'),(select id from f where key='expired-attempt'),'After verified expiry a fresh durable attempt is created');
select is((public.money_prepare_checkout((select id from f where key='expiry-snapshot'),'full')).id,(select id from f where key='replacement-attempt'),'Repeated replacement checkout reuses the new key');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
update public.vendor_applications set business_name='Synthetic reapplication' where id='53000000-0000-4000-8000-000000000001';
select is(public.vendor_is_eligible('52000000-0000-4000-8000-000000000001'),false,'Changed application invalidates old vetting evidence');
select lives_ok($$select public.vendor_begin_review('52000000-0000-4000-8000-000000000001',(select id from public.vendor_application_versions order by revision desc limit 1))$$,'New application version enters a new recorded review');
select is(public.vendor_evidence_current('52000000-0000-4000-8000-000000000001',now()),false,'Prior-version compliance cannot silently activate new application');
select * from finish();
rollback;
