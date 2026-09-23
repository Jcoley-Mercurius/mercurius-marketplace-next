begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-082 synthetic fixtures only. Covers a reviewed refund Stripe reports failed or canceled:
-- the one-operator resend under a new key, the reviewed release that takes it off the books, the
-- Stripe readback both need, and the guards that keep an earlier send's refund and a released
-- refund out of the ledger.
insert into auth.users(id,email,email_confirmed_at) values
 ('a8210000-0000-4000-8000-000000000001','frr-homeowner@example.invalid',now()),
 ('a8210000-0000-4000-8000-000000000002','frr-operator-a@example.invalid',now()),
 ('a8210000-0000-4000-8000-000000000003','frr-operator-b@example.invalid',now()),
 ('a8210000-0000-4000-8000-000000000004','frr-plain-admin@example.invalid',now()),
 ('a8210000-0000-4000-8000-000000000005','frr-operator-c@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a8210000-0000-4000-8000-000000000002','admin'),('a8210000-0000-4000-8000-000000000003','admin'),
 ('a8210000-0000-4000-8000-000000000004','admin'),('a8210000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a8210000-0000-4000-8000-000000000002','a8210000-0000-4000-8000-000000000003','Synthetic test'),
 ('a8210000-0000-4000-8000-000000000003','a8210000-0000-4000-8000-000000000002','Synthetic test'),
 ('a8210000-0000-4000-8000-000000000005','a8210000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a8220000-0000-4000-8000-000000000001','Synthetic failed refund payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a8230000-0000-4000-8000-000000000001','Synthetic failed refund payee','Test','Payout','frr-payee-1@example.invalid','synthetic','a8220000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,3,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id='a8230000-0000-4000-8000-000000000001';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a8210000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a8220000-0000-4000-8000-000000000001';

create temp table f(key text primary key,id uuid);
grant select,insert on f to authenticated;
create function pg_temp.id(label text) returns uuid language sql as $$ select id from f where key=label $$;
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true) $$;
create function pg_temp.kernel_approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('a8210000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a8210000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order whose homeowner confirmed completion 49 hours ago.
create function pg_temp.new_order(label text) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a8210000-0000-4000-8000-000000000001','a8220000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a8210000-0000-4000-8000-000000000002','a8210000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a8210000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label,attempt.obligation_id);
  perform public.money_receive_event('evt_frr_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_frr_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_frr_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-interval '49 hours' where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a8210000-0000-4000-8000-000000000001','a8220000-0000-4000-8000-000000000001',now()-interval '49 hours');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed refund authored by operator A and approved by operator B, through the kernel.
create function pg_temp.authorize(label text,p_service bigint,p_key text,p_payment text default null) returns uuid language plpgsql as $$
declare payment text:=coalesce(p_payment,'pi_frr_'||label);
  command jsonb:=jsonb_build_object('operation','refund','obligation',pg_temp.id(label),'payment',payment,
  'service',p_service,'tax',0,'tip',0,'key',p_key,'policy','Synthetic policy','reason','Synthetic refund');
  result uuid;
begin
  perform pg_temp.kernel_approve(command);
  result:=public.money_authorize_refund(pg_temp.id(label),payment,p_service,0,0,p_key,
    'a8210000-0000-4000-8000-000000000002','a8210000-0000-4000-8000-000000000003','Synthetic policy','Synthetic refund');
  insert into f values(p_key,result);
  return result;
end $$;
-- What refund-invoice records: the send's Stripe response, and an operator readback.
create function pg_temp.sent(p_key text,p_ref text,p_status text,p_amount bigint) returns void language sql as $$
 select public.money_record_refund_result(pg_temp.id(p_key),p_ref,p_status,p_amount) $$;
create function pg_temp.read(p_key text,p_ref text,p_status text,p_amount bigint) returns jsonb language sql as $$
 select public.money_record_refund_readback(pg_temp.id(p_key),'a8210000-0000-4000-8000-000000000005',p_ref,p_status,p_amount) $$;
create function pg_temp.ops() returns jsonb language sql as $$ select public.money_finance_operations() $$;
create function pg_temp.refund_of(p_key text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'refunds') v where v->>'authorization_id'=pg_temp.id(p_key)::text $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.release(p_key text,p_request_key text) returns uuid language sql as $$
 select (public.money_operator_request_refund_release(pg_temp.id(p_key),'Card closed; refund by check agreed',
   'Stripe shows the refund failed: expired_or_canceled_card',p_request_key)->>'request_id')::uuid $$;
create function pg_temp.recon(label text) returns jsonb language sql security definer as $$
 select private.money_obligation_reconciliation(pg_temp.id(label),now()) $$;
create function pg_temp.pending_exceptions(p_key text) returns bigint language sql as $$
 select count(*) from jsonb_array_elements(public.money_finance_reconciliation()->'exceptions') e
 where e->>'kind'='refund_pending' and e->>'authorization_id'=pg_temp.id(p_key)::text $$;
create function pg_temp.payout_blocker(label text) returns text language sql security definer as $$
 select private.money_ach_payable(pg_temp.id(label))->>'blocker' $$;
create function pg_temp.refund_blocker(label text,p_service bigint) returns text language sql security definer as $$
 select private.money_refund_blocker(pg_temp.id(label),'pi_frr_'||label,p_service,0,0) $$;
-- A scheduled visit paid as a deposit and then the balance, which the homeowner cancels 73 hours
-- ahead: a 100% policy refund split across the two payments.
create function pg_temp.cancelled_order(label text) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); obligation uuid:=gen_random_uuid(); snapshot uuid:=gen_random_uuid(); op_key uuid:=gen_random_uuid(); previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,scheduled_start_at)
    values(request,'a8210000-0000-4000-8000-000000000001','a8220000-0000-4000-8000-000000000001','Synthetic','Synthetic cancellation','scheduled',now()+interval '73 hours');
  insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,captured)
    values(obligation,request,'a8210000-0000-4000-8000-000000000001','a8220000-0000-4000-8000-000000000001',11700);
  insert into public.money_snapshots(id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at)
    values(snapshot,obligation,1,'M5-FRR-'||label,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','a8210000-0000-4000-8000-000000000002','a8210000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day');
  update public.money_obligations set current_snapshot_id=snapshot where id=obligation;
  insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,stripe_payment_id,status,expires_at,completed_at)
    values(obligation,snapshot,'a8210000-0000-4000-8000-000000000001','deposit',3000,'usd','frr-deposit-'||label,'frr-deposit-'||label,'pi_frr_'||label||'_deposit','captured',now()+interval '1 day',now()-interval '1 hour'),
      (obligation,snapshot,'a8210000-0000-4000-8000-000000000001','balance',8700,'usd','frr-balance-'||label,'frr-balance-'||label,'pi_frr_'||label,'captured',now()+interval '1 day',now());
  insert into f values(label,obligation);
  perform pg_temp.as_user('a8210000-0000-4000-8000-000000000001');
  set local role authenticated;
  perform public.record_job_operation(request,op_key,'customer_cancel','Synthetic '||label||' cancellation');
  reset role;
  insert into f select label||'-operation',id from public.job_operations where operation_key=op_key;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.cancel_line(label text,p_payment text) returns jsonb language sql security definer as $$
 select jsonb_build_object('service',p->'service','tax',p->'tax','tip',p->'tip')
 from private.money_cancellation_preview(pg_temp.id(label||'-operation'),p_payment) p $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text) to authenticated;

select pg_temp.new_order('fail');
select pg_temp.new_order('stale');
select pg_temp.new_order('dispute');
select pg_temp.authorize('fail',2000,'frr-fail');
select pg_temp.authorize('stale',1000,'frr-stale');
select pg_temp.authorize('dispute',500,'frr-dispute');
-- Refunds Stripe reported failed, with the readback that proves it, for the concurrency script.
create function pg_temp.failed_refund(label text) returns void language plpgsql as $$
begin
  perform pg_temp.new_order(label);
  perform pg_temp.authorize(label,1500,'frr-'||label);
  perform public.money_prepare_refund(pg_temp.id('frr-'||label),'a8210000-0000-4000-8000-000000000002');
  perform pg_temp.sent('frr-'||label,'re_frr_'||label,'failed',1500);
  perform pg_temp.read('frr-'||label,'re_frr_'||label,'canceled',1500);
end $$;
select pg_temp.failed_refund('race_resend');
select pg_temp.failed_refund('race_release');
select pg_temp.failed_refund('race_resend_first');
-- END CONCURRENCY SETUP

-- Grants: the two commands are the browser path; the kernel, helpers and evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_resend_refund(uuid,text)','execute'),true,'Signed-in users may call the refund resend');
select is(has_function_privilege('authenticated','public.money_operator_request_refund_release(uuid,text,text,text)','execute'),true,'Signed-in users may call the release request');
select is(has_function_privilege('anon','public.money_operator_resend_refund(uuid,text)','execute'),false,'Anonymous callers cannot resend refunds');
select is(has_function_privilege('anon','public.money_operator_request_refund_release(uuid,text,text,text)','execute'),false,'Anonymous callers cannot request a release');
select is(has_function_privilege('authenticated','public.money_release_refund(uuid,text,uuid,uuid,text,text)','execute'),false,'The release kernel stays service-only');
select is(has_function_privilege('service_role','public.money_release_refund(uuid,text,uuid,uuid,text,text)','execute'),true,'The service role runs the release kernel');
select is(has_function_privilege('authenticated','private.money_failed_refund_blocker(uuid)','execute'),false,'Private blockers stay closed');
select is(has_function_privilege('authenticated','private.money_refund_failure_readback(uuid)','execute'),false,'The readback proof stays closed');
select is(has_table_privilege('authenticated','public.money_refund_releases','select'),false,'Browser roles cannot read releases');

-- Before anything failed: the refund holds the payout, blocks chargebacks and reserves its amount.
select is(pg_temp.payout_blocker('fail'),'refund_hold','An unsettled refund holds the payout');
select is(pg_temp.refund_blocker('fail',8001),'refund_exceeds_components','The refund reserves its share of the service subtotal');
select is(pg_temp.recon('fail')->'refunds'->>'pending','1','Reconciliation counts it pending');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'55000','Refund resend not allowed: refund_not_sent','An unsent refund cannot be resent');
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Reason','Evidence','k-rel-unsent')$$,'55000','Finance review not actionable: refund_not_sent','An unsent refund cannot be released');
reset role;

-- The send reaches Stripe, which reports the refund pending and then failed.
select is((public.money_prepare_refund(pg_temp.id('frr-fail'),'a8210000-0000-4000-8000-000000000002')).status,'prepared','The refund is prepared under its first key');
select pg_temp.sent('frr-fail','re_frr_fail_1','pending',2000);
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'55000','Refund resend not allowed: refund_not_failed','A pending refund cannot be resent');
select is(pg_temp.refund_of('frr-fail')->'resend_blocker','null'::jsonb,'Operations offer no resend while the refund is pending');
reset role;
select pg_temp.sent('frr-fail','re_frr_fail_1','failed',2000);
select is((select status from public.money_refund_attempts where authorization_id=pg_temp.id('frr-fail')),'failed','The send response marks the attempt failed');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'55000','Refund resend not allowed: readback_required','The send response alone does not allow a resend');
select is(pg_temp.refund_of('frr-fail')->>'resend_blocker','readback_required','Operations show a readback is needed to resend');
select is(pg_temp.refund_of('frr-fail')->>'release_blocker','readback_required','Operations show a readback is needed to release');
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Reason','Evidence','k-rel-early')$$,'55000','Finance review not actionable: readback_required','The send response alone does not allow a release');
reset role;
-- A readback that does not show the refund failed is not proof.
select pg_temp.read('frr-fail','re_frr_fail_1','pending',2000);
set local role authenticated;
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'55000','Refund resend not allowed: refund_not_failed','A readback showing the refund pending is not proof it failed');
reset role;
select is((select status from public.money_refund_attempts where authorization_id=pg_temp.id('frr-fail')),'pending','A pending readback records the refund pending again');
select pg_temp.sent('frr-fail','re_frr_fail_1','failed',2000);
set local role authenticated;
select is(pg_temp.refund_of('frr-fail')->>'resend_blocker','readback_required','A later failed send response does not turn a pending readback into proof');
reset role;
select pg_temp.read('frr-fail','re_frr_fail_1','failed',2000);
set local role authenticated;
select is(pg_temp.refund_of('frr-fail')->'resend_blocker','null'::jsonb,'A readback showing the refund failed allows a resend');
select is(pg_temp.refund_of('frr-fail')->'release_blocker','null'::jsonb,'A readback showing the refund failed allows a release');
select is(pg_temp.refund_of('frr-fail')->>'attempt_status','failed','Operations show the refund failed');
reset role;
select is(pg_temp.payout_blocker('fail'),'refund_hold','A failed refund still holds the payout until it is resent or released');

-- Resend: one operator, the refund's author or approver.
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'42501','Restricted finance authority required','An admin without finance authority cannot resend');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'42501','Only the refund''s author or approver can resend it','A third operator cannot resend');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000003');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),' ')$$,'22023','Reason of up to 1000 characters required','A resend needs a reason');
select throws_ok($$select public.money_operator_resend_refund(gen_random_uuid(),'Retry')$$,'P0002','Refund authorization not found','An unknown refund is refused');
select is((public.money_operator_resend_refund(pg_temp.id('frr-fail'),' Customer updated card; Stripe shows re_frr_fail_1 failed ')->>'generation')::integer,2,'The approver resends it as generation 2');
select is((public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Customer updated card; Stripe shows re_frr_fail_1 failed')->>'replay')::boolean,true,'The same resend replays');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Other reason')$$,'23505','Refund resend idempotency conflict','A different resend from the same readback conflicts');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Customer updated card; Stripe shows re_frr_fail_1 failed')$$,'23505','Refund resend idempotency conflict','Another operator cannot replay someone else''s resend');
select is((select jsonb_build_object('status',r->'attempt_status','generation',r->'generation','reference',r->'provider_reference') from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('frr-fail')::text),
  jsonb_build_object('status','prepared','generation',2,'reference',null),'Operations show the resent refund ready to send, with no Stripe refund yet');
reset role;
select ok((select (a.status,a.idempotency_key,a.prepared_at,a.amount,a.provider_reference) is not distinct from ('prepared','mercurius:refund-v1:'||pg_temp.id('frr-fail')||':g2',now(),2000::bigint,null::text)
  from public.money_refund_attempts a where a.authorization_id=pg_temp.id('frr-fail')),'The attempt is prepared again under a new key for the same amount');
select ok((select (x.previous_key,x.failed_reference,x.actor,x.reason)=('mercurius:refund-v1:'||pg_temp.id('frr-fail'),'re_frr_fail_1','a8210000-0000-4000-8000-000000000003'::uuid,'Customer updated card; Stripe shows re_frr_fail_1 failed')
  from public.money_refund_reissues x where x.authorization_id=pg_temp.id('frr-fail')),'The resend records the old key, the failed refund, actor and reason');
select is((public.money_prepare_refund(pg_temp.id('frr-fail'),'a8210000-0000-4000-8000-000000000002')).status,'prepared','refund-invoice may send the new generation');
select is(public.money_refund_readback_target(pg_temp.id('frr-fail'),'a8210000-0000-4000-8000-000000000005')->'failed_references','["re_frr_fail_1"]'::jsonb,'The readback target lists the failed refund to skip');
select is(pg_temp.payout_blocker('fail'),'refund_hold','A resent refund still holds the payout');

-- The failed refund can never become the new send's refund.
select throws_ok($$select pg_temp.read('frr-fail','re_frr_fail_1','failed',2000)$$,'55000','This Stripe refund failed on an earlier send of this refund; read back the current send','A readback cannot record the earlier failed refund');
select throws_ok($$select pg_temp.sent('frr-fail','re_frr_fail_1','failed',2000)$$,'55000','This Stripe refund failed on an earlier send of this refund; read back the current send','A send response cannot record the earlier failed refund');
select is((select status from public.money_refund_attempts where authorization_id=pg_temp.id('frr-fail')),'prepared','The refused readback changed nothing');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Again')$$,'23505','Refund resend idempotency conflict','Until the next readback, another resend conflicts with the one made');
reset role;

-- The second send is canceled too. The earlier readback does not prove this one failed.
select pg_temp.sent('frr-fail','re_frr_fail_2','canceled',2000);
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select is(pg_temp.refund_of('frr-fail')->>'resend_blocker','readback_required','The first send''s readback does not prove the second failed');
reset role;
select pg_temp.read('frr-fail','re_frr_fail_2','canceled',2000);
set local role authenticated;
select is(pg_temp.refund_of('frr-fail')->'resend_blocker','null'::jsonb,'A readback of the second send showing canceled allows another resend');

-- Release: a reviewed request, bound to the refund that failed.
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),' ','Evidence','k-rel')$$,'22023','Reason of up to 1000 characters required','A release needs a reason');
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Reason',null,'k-rel')$$,'22023','Evidence of up to 1000 characters required','A release needs evidence');
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Reason','Evidence','')$$,'22023','Idempotency key required','A release needs a key');
select throws_ok($$select public.money_operator_request_refund_release(gen_random_uuid(),'Reason','Evidence','k-rel')$$,'P0002','Refund authorization not found','An unknown refund is refused');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.release('frr-fail','k-rel-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a release');
-- Any finance operator may request it, not only the refund's author or approver.
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
insert into f select 'rel-1',pg_temp.release('frr-fail','k-rel-1');
select is((public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Card closed; refund by check agreed','Stripe shows the refund failed: expired_or_canceled_card','k-rel-1')->>'replay')::boolean,true,'The same release request replays');
select throws_ok($$select public.money_operator_request_refund_release(pg_temp.id('frr-fail'),'Other reason','Evidence','k-rel-1')$$,'23505','Review request idempotency conflict','The same key with another reason conflicts');
select is(pg_temp.request_of(pg_temp.id('rel-1'))->>'state','awaiting_approval','The release awaits approval');
select is((pg_temp.request_of(pg_temp.id('rel-1'))->'details')-'refund_created_at',jsonb_build_object('authorization_id',pg_temp.id('frr-fail'),'payment_id','pi_frr_fail',
  'service',2000,'tax',0,'tip',0,'amount',2000,'provider_reference','re_frr_fail_2','provider_status','canceled'),'The request shows the refund, the failed Stripe refund and its status');
select is(pg_temp.refund_of('frr-fail')->>'open_release_request_id',pg_temp.id('rel-1')::text,'The refund row links its open release request');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('rel-1'),'Self review')$$,'42501','A different finance operator must approve this command','The requester cannot approve their own release');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('rel-1'))$$,'42501','Separate authenticated approval of exact financial command required','A release cannot run without approval');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select isnt(public.money_operator_approve_review(pg_temp.id('rel-1'),'Read re_frr_fail_2 at Stripe')->>'approval_id',null,'Operator A approves the release');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('rel-1'))$$,'42501','Only the requesting finance operator can execute this command','The approver cannot run the release');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
select is(pg_temp.request_of(pg_temp.id('rel-1'))->>'state','approved','The requester sees it approved');
select is((public.money_operator_execute_review(pg_temp.id('rel-1'))->>'replay')::boolean,false,'The requester runs the approved release');
select is((public.money_operator_execute_review(pg_temp.id('rel-1'))->>'replay')::boolean,true,'Running again replays');
select is(pg_temp.request_of(pg_temp.id('rel-1'))->>'state','executed','The request reads executed');
select is(pg_temp.refund_of('frr-fail'),null,'The released refund leaves the unsettled refund list');
select is((select jsonb_build_object('amount',r->'amount','reference',r->'provider_reference','by_me',r->'by_me') from jsonb_array_elements(pg_temp.ops()->'refund_releases') r where r->>'authorization_id'=pg_temp.id('frr-fail')::text),
  jsonb_build_object('amount',2000,'reference','re_frr_fail_2','by_me',true),'Operations list the release');
select is(pg_temp.pending_exceptions('frr-fail'),0::bigint,'A released refund is not a pending refund exception');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'42501','Only the refund''s author or approver can resend it','Operator C still cannot resend');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-fail'),'Retry')$$,'55000','Refund resend not allowed: refund_released','A released refund cannot be resent');
select throws_ok($$select pg_temp.release('frr-fail','k-rel-2')$$,'55000','Finance review not actionable: completed','A released refund cannot be released again');
reset role;
select ok((select (z.obligation_id,z.amount,z.failed_reference,z.requested_by,z.approved_by,z.reason,z.evidence)=(pg_temp.id('fail'),2000::bigint,'re_frr_fail_2',
    'a8210000-0000-4000-8000-000000000005'::uuid,'a8210000-0000-4000-8000-000000000002'::uuid,'Card closed; refund by check agreed','Stripe shows the refund failed: expired_or_canceled_card')
  from public.money_refund_releases z where z.authorization_id=pg_temp.id('frr-fail')),'The kernel records the release with both operators, the failed refund and the evidence');
select is((select readback_id from public.money_refund_releases where authorization_id=pg_temp.id('frr-fail')),
  (select id from public.money_refund_readbacks where authorization_id=pg_temp.id('frr-fail') order by readback_sequence desc limit 1),'The release names the readback that proved the failure');
select throws_ok($$update public.money_refund_releases set reason='x'$$,'55000',null,'Releases are immutable');
select throws_ok($$delete from public.money_refund_releases$$,'55000',null,'Releases cannot be deleted');

-- What the release changes: the payout, the caps and reconciliation. Nothing is posted.
select is(pg_temp.payout_blocker('fail'),null,'A released refund no longer holds the payout');
select lives_ok($$select public.money_payable(pg_temp.id('fail'))$$,'The ACH kernel''s payable check passes');
select is(pg_temp.refund_blocker('fail',10000),null,'The full service subtotal can be requested again');
select is(pg_temp.recon('fail')->'refunds',jsonb_build_object('service',0,'tax',0,'tip',0,'settled',0,'pending',0,'released',1),'Reconciliation counts the refund released, not pending');
select is(pg_temp.recon('fail')->'issues','[]'::jsonb,'Reconciliation finds no ledger issue');
select is((select count(*)::integer from public.money_journals where obligation_id=pg_temp.id('fail') and kind='refund'),0,'No refund journal is posted');
select is((select refunded_service+refunded_tax+refunded_tip from public.money_obligations where id=pg_temp.id('fail')),0::bigint,'No refund is counted on the invoice');
select is((public.money_prepare_refund(pg_temp.id('frr-fail'),'a8210000-0000-4000-8000-000000000002')).status,'failed','refund-invoice finds nothing to send');
select throws_ok($$update public.money_refund_attempts set status='prepared' where authorization_id=pg_temp.id('frr-fail')$$,'55000','A released refund cannot be sent again','No writer can prepare a released refund again');
-- A settled refund event for a released refund never posts; the event stays for reconciliation.
select public.money_receive_event('evt_frr_released','refund',jsonb_build_object('authorization_id',pg_temp.id('frr-fail'),
  'refund_id','re_frr_fail_3','payment_id','pi_frr_fail','amount',2000,'currency','usd'));
select is(public.money_process_event('evt_frr_released'),'failed','A refund event for a released refund does not process');
select is((select count(*)::integer from public.money_refunds where authorization_id=pg_temp.id('frr-fail')),0,'The released refund is never settled');
select is(pg_temp.payout_blocker('fail'),'provider_event_hold','The unprocessed event holds the payout');
select is((select count(*)::integer from jsonb_array_elements(public.money_finance_reconciliation()->'exceptions') e where e->>'event_id'='evt_frr_released'),1,'The event is listed for reconciliation');
-- A new reviewed refund for the full amount can be authorized and settles normally.
select pg_temp.authorize('fail',10000,'frr-fail-again');
select is((select count(*)::integer from public.money_refund_authorizations where obligation_id=pg_temp.id('fail')),2,'A new authorization sits beside the released one');

-- A release request goes stale when the refund is resent and fails again under another refund.
select public.money_prepare_refund(pg_temp.id('frr-stale'),'a8210000-0000-4000-8000-000000000002');
select pg_temp.sent('frr-stale','re_frr_stale_1','failed',1000);
select pg_temp.read('frr-stale','re_frr_stale_1','failed',1000);
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
insert into f select 'rel-stale',pg_temp.release('frr-stale','k-rel-stale');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('rel-stale'),'Read re_frr_stale_1')$$,'Operator B approves the first release');
select lives_ok($$select public.money_operator_resend_refund(pg_temp.id('frr-stale'),'Card updated')$$,'The approver resends before the release runs');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
select is(pg_temp.request_of(pg_temp.id('rel-stale'))->>'blocker','refund_not_failed','The release goes stale while the resend is out');
reset role;
select pg_temp.sent('frr-stale','re_frr_stale_2','failed',1000);
select pg_temp.read('frr-stale','re_frr_stale_2','failed',1000);
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
select is(pg_temp.request_of(pg_temp.id('rel-stale'))->>'blocker','refund_changed','A release approved for the first failure does not apply to the second');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('rel-stale'))$$,'55000','Finance review not actionable: refund_changed','The stale release cannot run');
select is((public.money_operator_request_refund_release(pg_temp.id('frr-stale'),'Card closed; refund by check agreed','Stripe shows the refund failed: expired_or_canceled_card','k-rel-stale')->>'replay')::boolean,true,'Replaying the key keeps the refund it was requested against');
reset role;
select is((select command->>'reference' from public.money_review_requests where business_key='k-rel-stale'),'re_frr_stale_1','The stale request still names the first failed refund');
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-stale'),'re_frr_stale_1','a8210000-0000-4000-8000-000000000005','a8210000-0000-4000-8000-000000000003',
  'Card closed; refund by check agreed','Stripe shows the refund failed: expired_or_canceled_card')$$,'P0001','Refund changed since the release was requested','The kernel refuses the old approval too');
select is((select count(*)::integer from public.money_refund_releases where authorization_id=pg_temp.id('frr-stale')),0,'Nothing was released');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000005');
insert into f select 'rel-stale-2',pg_temp.release('frr-stale','k-rel-stale-2');
select is(pg_temp.request_of(pg_temp.id('rel-stale-2'))->'details'->>'provider_reference','re_frr_stale_2','A new request names the second failed refund');
reset role;
select is((select string_agg(coalesce(failed_reference,'-'),',' order by generation) from public.money_refund_reissues where authorization_id=pg_temp.id('frr-stale')),'re_frr_stale_1','The resend history keeps the first failed refund');

-- A released refund no longer blocks chargeback allocation.
select public.money_prepare_refund(pg_temp.id('frr-dispute'),'a8210000-0000-4000-8000-000000000002');
select pg_temp.sent('frr-dispute','re_frr_dispute_1','failed',500);
select pg_temp.read('frr-dispute','re_frr_dispute_1','failed',500);
select public.money_receive_event('evt_frr_dispute_lost','dispute','{"dispute_id":"dp_frr_loss","payment_id":"pi_frr_dispute","amount":1000,"currency":"usd","state":"lost"}');
select is(public.money_process_event('evt_frr_dispute_lost'),'processed','The lost dispute is recorded');
select is(private.money_chargeback_state_blocker('dp_frr_loss'),'refund_pending','A failed refund still blocks chargeback allocation');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
insert into f select 'rel-dispute',pg_temp.release('frr-dispute','k-rel-dispute');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('rel-dispute'),'Read re_frr_dispute_1')$$,'Operator B approves the release');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select lives_ok($$select public.money_operator_execute_review(pg_temp.id('rel-dispute'))$$,'Operator A runs it');
reset role;
select is(private.money_chargeback_state_blocker('dp_frr_loss'),null,'A released refund no longer blocks chargeback allocation');
set local role authenticated;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
insert into f select 'chargeback',(public.money_operator_request_chargeback('dp_frr_loss',1000,0,0,'Chargeback lost on Stripe dp_frr_loss','k-frr-chargeback')->>'request_id')::uuid;
select pg_temp.as_user('a8210000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('chargeback'),'Read dp_frr_loss')$$,'Operator B approves the allocation');
select pg_temp.as_user('a8210000-0000-4000-8000-000000000002');
select lives_ok($$select public.money_operator_execute_review(pg_temp.id('chargeback'))$$,'The allocation runs past the released refund');
reset role;
select is((select dispute_open from public.money_obligations where id=pg_temp.id('dispute')),false,'The allocation clears the chargeback hold');

-- A released refund stops reserving its amount out of a later cancellation policy refund.
select pg_temp.cancelled_order('cancel');
select pg_temp.authorize('cancel',1000,'frr-cancel','pi_frr_cancel_deposit');
select is(pg_temp.cancel_line('cancel','pi_frr_cancel_deposit'),'{"service":2000,"tax":0,"tip":0}'::jsonb,'An unsettled refund on the deposit reserves part of it');
select is(pg_temp.cancel_line('cancel','pi_frr_cancel'),'{"service":7000,"tax":700,"tip":1000}'::jsonb,'The balance covers the rest of the policy refund less the unsettled refund');
select public.money_prepare_refund(pg_temp.id('frr-cancel'),'a8210000-0000-4000-8000-000000000002');
select pg_temp.sent('frr-cancel','re_frr_cancel_1','failed',1000);
select pg_temp.read('frr-cancel','re_frr_cancel_1','failed',1000);
select is(pg_temp.cancel_line('cancel','pi_frr_cancel_deposit'),'{"service":2000,"tax":0,"tip":0}'::jsonb,'A failed refund still counts until it is released');
select pg_temp.kernel_approve(private.money_refund_release_command(pg_temp.id('frr-cancel'),'re_frr_cancel_1','Card closed','Stripe shows failed'));
select lives_ok($$select public.money_release_refund(pg_temp.id('frr-cancel'),'re_frr_cancel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Card closed','Stripe shows failed')$$,'The kernel releases it with an approval of the exact command');
select is(public.money_release_refund(pg_temp.id('frr-cancel'),'re_frr_cancel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Card closed','Stripe shows failed'),pg_temp.id('frr-cancel'),'The same kernel call replays');
select is(pg_temp.cancel_line('cancel','pi_frr_cancel_deposit'),'{"service":3000,"tax":0,"tip":0}'::jsonb,'A released refund no longer reserves any of the deposit');
select is(pg_temp.cancel_line('cancel','pi_frr_cancel'),'{"service":7000,"tax":700,"tip":1000}'::jsonb,'The balance line starts after the whole deposit');

-- The kernel's own checks, behind the gateway's.
select pg_temp.new_order('kernel');
select pg_temp.authorize('kernel',700,'frr-kernel');
select public.money_prepare_refund(pg_temp.id('frr-kernel'),'a8210000-0000-4000-8000-000000000002');
select pg_temp.kernel_approve(private.money_refund_release_command(pg_temp.id('frr-kernel'),null,'Reason','Evidence'));
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),null,'a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Reason','Evidence')$$,'P0001','Only a refund Stripe reported failed or canceled can be released','The kernel refuses a refund that has not failed');
select pg_temp.sent('frr-kernel','re_frr_kernel_1','failed',700);
select pg_temp.kernel_approve(private.money_refund_release_command(pg_temp.id('frr-kernel'),'re_frr_kernel_1','Reason','Evidence'));
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),'re_frr_kernel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Reason','Evidence')$$,'P0001','A Stripe readback showing this refund failed or canceled is required','The kernel refuses a release without the readback');
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),'re_frr_kernel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000002','Reason','Evidence')$$,'42501',null,'The kernel refuses one operator as both requester and approver');
select pg_temp.read('frr-kernel','re_frr_kernel_1','failed',700);
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),'re_frr_kernel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Other reason','Evidence')$$,'42501',null,'The kernel refuses a command nobody approved');
select lives_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),'re_frr_kernel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Reason','Evidence')$$,'With the readback the kernel releases it');
select pg_temp.kernel_approve(private.money_refund_release_command(pg_temp.id('frr-kernel'),'re_frr_kernel_1','Reason','Other evidence'));
select throws_ok($$select public.money_release_refund(pg_temp.id('frr-kernel'),'re_frr_kernel_1','a8210000-0000-4000-8000-000000000002',
  'a8210000-0000-4000-8000-000000000003','Reason','Other evidence')$$,'P0001','Refund release idempotency conflict','A different release of the same refund conflicts');

select * from finish();
rollback;
