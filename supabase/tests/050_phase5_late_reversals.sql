begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-083 synthetic fixtures only. Covers a settled refund Stripe later fails: the reviewed record
-- that holds what Stripe returned as owed to the customer, the reviewed resend that pays it and the
-- reviewed release that reverses the refund; and a bank return after a provider's repayment: the
-- reviewed reversal that sends the repayment back.
insert into auth.users(id,email,email_confirmed_at) values
 ('a8310000-0000-4000-8000-000000000001','lr-homeowner@example.invalid',now()),
 ('a8310000-0000-4000-8000-000000000002','lr-operator-a@example.invalid',now()),
 ('a8310000-0000-4000-8000-000000000003','lr-operator-b@example.invalid',now()),
 ('a8310000-0000-4000-8000-000000000004','lr-plain-admin@example.invalid',now()),
 ('a8310000-0000-4000-8000-000000000005','lr-operator-c@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a8310000-0000-4000-8000-000000000002','admin'),('a8310000-0000-4000-8000-000000000003','admin'),
 ('a8310000-0000-4000-8000-000000000004','admin'),('a8310000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a8310000-0000-4000-8000-000000000002','a8310000-0000-4000-8000-000000000003','Synthetic test'),
 ('a8310000-0000-4000-8000-000000000003','a8310000-0000-4000-8000-000000000002','Synthetic test'),
 ('a8310000-0000-4000-8000-000000000005','a8310000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a8320000-0000-4000-8000-000000000001','Synthetic late reversal payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a8330000-0000-4000-8000-000000000001','Synthetic late reversal payee','Test','Payout','lr-payee-1@example.invalid','synthetic','a8320000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,3,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id='a8330000-0000-4000-8000-000000000001';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a8310000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a8320000-0000-4000-8000-000000000001';

create temp table f(key text primary key,id uuid);
grant select,insert on f to authenticated;
create function pg_temp.id(label text) returns uuid language sql as $$ select id from f where key=label $$;
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true) $$;
-- Operators: A requests and runs, B approves, C reads back and may request.
create function pg_temp.op(p text) returns text language sql immutable as $$
 select case p when 'A' then 'a8310000-0000-4000-8000-000000000002' when 'B' then 'a8310000-0000-4000-8000-000000000003'
   when 'C' then 'a8310000-0000-4000-8000-000000000005' when 'admin' then 'a8310000-0000-4000-8000-000000000004' end $$;
-- Runs one gateway call as an operator and restores the caller.
create function pg_temp.call(p_user text,p_sql text) returns jsonb language plpgsql as $$
declare previous text; result jsonb;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user(pg_temp.op(p_user));
  execute p_sql into result;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return result;
end $$;
create function pg_temp.kernel_approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user(pg_temp.op('B'));
  perform public.money_approve_review(pg_temp.op('A')::uuid,command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order whose homeowner confirmed completion that many hours ago.
create function pg_temp.new_order(label text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a8310000-0000-4000-8000-000000000001','a8320000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),pg_temp.op('A')::uuid,pg_temp.op('B')::uuid);
  perform pg_temp.as_user('a8310000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label,attempt.obligation_id);
  perform public.money_receive_event('evt_lr_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_lr_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_lr_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a8310000-0000-4000-8000-000000000001','a8320000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- Operator B approves and the requester runs it.
create function pg_temp.review(p_request uuid,p_runner text default 'A') returns jsonb language plpgsql as $$
begin
  perform pg_temp.call('B',format('select public.money_operator_approve_review(%L,%L)',p_request,'Synthetic second-person review'));
  return pg_temp.call(p_runner,format('select public.money_operator_execute_review(%L)',p_request));
end $$;
-- A reviewed refund authored by A and approved by B, through the kernel.
create function pg_temp.authorize(label text,p_service bigint,p_key text) returns uuid language plpgsql as $$
declare command jsonb:=jsonb_build_object('operation','refund','obligation',pg_temp.id(label),'payment','pi_lr_'||label,
  'service',p_service,'tax',0,'tip',0,'key',p_key,'policy','Synthetic policy','reason','Synthetic refund');
  result uuid;
begin
  perform pg_temp.kernel_approve(command);
  result:=public.money_authorize_refund(pg_temp.id(label),'pi_lr_'||label,p_service,0,0,p_key,pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Synthetic policy','Synthetic refund');
  insert into f values(p_key,result);
  return result;
end $$;
-- Stripe's refund event for a refund of this authorization.
create function pg_temp.event(p_key text,p_ref text,p_event text) returns text language plpgsql as $$
begin
  perform public.money_receive_event(p_event,'refund',jsonb_build_object('authorization_id',pg_temp.id(p_key),'refund_id',p_ref,
    'payment_id',(select payment_id from public.money_refund_authorizations where id=pg_temp.id(p_key)),
    'amount',(select service+tax+tip from public.money_refund_authorizations where id=pg_temp.id(p_key)),'currency','usd'));
  return public.money_process_event(p_event);
end $$;
-- What refund-invoice records when it sends: the prepared attempt, then Stripe's response.
create function pg_temp.sent(p_key text,p_ref text,p_status text) returns void language plpgsql as $$
begin
  perform public.money_prepare_refund(pg_temp.id(p_key),pg_temp.op('A')::uuid);
  perform public.money_record_refund_result(pg_temp.id(p_key),p_ref,p_status,(select service+tax+tip from public.money_refund_authorizations where id=pg_temp.id(p_key)));
end $$;
-- Sent, then settled by Stripe's refund event.
create function pg_temp.settle(p_key text,p_ref text) returns text language plpgsql as $$
begin
  perform pg_temp.sent(p_key,p_ref,'pending');
  return pg_temp.event(p_key,p_ref,'evt_lr_'||p_ref);
end $$;
-- An operator readback of the refund at Stripe, by operator C.
create function pg_temp.read(p_key text,p_ref text,p_status text) returns jsonb language sql as $$
 select public.money_record_refund_readback(pg_temp.id(p_key),'a8310000-0000-4000-8000-000000000005',p_ref,p_status,
   case when p_ref is null then null else (select service+tax+tip from public.money_refund_authorizations where id=pg_temp.id(p_key)) end) $$;
-- A late refund request by an operator.
create function pg_temp.late(p_user text,p_action text,p_key text,p_request_key text) returns uuid language sql as $$
 select (pg_temp.call(p_user,format('select public.money_operator_request_late_refund(%L,%L,%L,%L,%L)',p_action,pg_temp.id(p_key),
   'Synthetic late '||p_action,case when p_action='resend' then null else 'Stripe readback shows the settled refund failed' end,p_request_key))->>'request_id')::uuid $$;
-- A settled refund of 2000 that Stripe later failed, recorded through a reviewed request.
create function pg_temp.late_failed(label text) returns void language plpgsql as $$
begin
  perform pg_temp.authorize(label,2000,'lr-'||label);
  if pg_temp.settle('lr-'||label,'re_lr_'||label||'_1')<>'processed' then raise exception 'Fixture refund failed'; end if;
  perform pg_temp.read('lr-'||label,'re_lr_'||label||'_1','failed');
  perform pg_temp.review(pg_temp.late('A','failure','lr-'||label,'k-lf-'||label));
end $$;
create function pg_temp.ops() returns jsonb language sql as $$ select pg_temp.call('C','select public.money_finance_operations()') $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(pg_temp.ops()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.late_of(p_key text) returns jsonb language sql as $$
 select v from jsonb_array_elements(pg_temp.ops()->'late_refunds') v where v->>'authorization_id'=pg_temp.id(p_key)::text $$;
create function pg_temp.returns_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(pg_temp.ops()->'repayment_returns'->'payouts') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.recon(label text) returns jsonb language sql security definer as $$
 select private.money_obligation_reconciliation(pg_temp.id(label),now()) $$;
create function pg_temp.exceptions(p_kind text) returns jsonb language sql as $$
 select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements(pg_temp.call('C','select public.money_finance_reconciliation()')->'exceptions') e
 where e->>'kind'=p_kind $$;
create function pg_temp.payable(label text) returns jsonb language sql security definer as $$
 select private.money_ach_payable(pg_temp.id(label)) $$;
create function pg_temp.journal(p_key text) returns jsonb language sql security definer as $$
 select lines from public.money_journals where business_key=p_key $$;
create function pg_temp.attempt(p_key text) returns text language sql security definer as $$
 select status from public.money_refund_attempts where authorization_id=pg_temp.id(p_key) $$;
-- ACH: a batch request, the newest statement item of a payout, its latest attempt and an outcome.
create function pg_temp.batch(p_period date,labels text[],p_key text) returns uuid language sql as $$
 select (pg_temp.call('A',format('select public.money_operator_request_ach(%L,%L,%L,%L,%L)',p_period,array(select pg_temp.id(l) from unnest(labels) l),
   'BANK-BATCH-'||p_key,'Synthetic weekly ACH',p_key))->>'request_id')::uuid $$;
create function pg_temp.item_id(label text) returns uuid language sql security definer as $$
 select i.id from public.money_ach_items i where i.obligation_id=pg_temp.id(label)
 and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) $$;
create function pg_temp.attempt_of(label text) returns uuid language sql security definer as $$
 select a.id from public.money_ach_attempts a where a.item_id=pg_temp.item_id(label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.record(label text,p_status text,p_ref text,p_key text) returns jsonb language sql as $$
 select pg_temp.call('A',format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.attempt_of(label),p_status,p_ref,'Synthetic bank evidence '||p_status,p_key)) $$;
create function pg_temp.paid(label text,p_period date) returns void language plpgsql as $$
begin
  perform pg_temp.review(pg_temp.batch(p_period,array[label],'lr-'||label||'-'||p_period));
  perform pg_temp.record(label,'submitted','LR-'||upper(label),'k-'||label||'-sub');
  perform pg_temp.record(label,'settled',null,'k-'||label||'-set');
end $$;
create function pg_temp.recover(label text,p_kind text,p_amount bigint,p_key text) returns uuid language sql as $$
 select (pg_temp.call('A',format('select public.money_operator_request_payout_recovery(%L,%L,%s,%L,%L,%L)',pg_temp.id(label),p_kind,p_amount,
   'Synthetic recovery','Bank credit from the provider',p_key))->>'request_id')::uuid $$;
create function pg_temp.reverse(label text,p_amount bigint,p_key text) returns uuid language sql as $$
 select (pg_temp.call('A',format('select public.money_operator_request_repayment_reversal(%L,%s,%L,%L,%L)',pg_temp.id(label),p_amount,
   'Transfer returned after the provider repaid','Bank debit to the provider returning the repayment',p_key))->>'request_id')::uuid $$;
-- A paid payout the provider owed on after a refund, repaid in full, whose transfer the bank then returned.
create function pg_temp.returned_after_repayment(label text,p_period date) returns void language plpgsql as $$
begin
  perform pg_temp.paid(label,p_period);
  perform pg_temp.authorize(label,2000,'lr-'||label);
  if pg_temp.settle('lr-'||label,'re_lr_'||label||'_1')<>'processed' then raise exception 'Fixture refund failed'; end if;
  perform pg_temp.review(pg_temp.recover(label,'repayment',1700,'k-repay-'||label));
  perform pg_temp.record(label,'returned',null,'k-'||label||'-ret');
end $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text) to authenticated;

-- Used by scripts/phase5-late-reversal-concurrency.mjs, whose ACH weeks start at +280 days.
select pg_temp.new_order('race_late',49);
select pg_temp.late_failed('race_late');
select pg_temp.new_order('race_late2',49);
select pg_temp.late_failed('race_late2');
select pg_temp.new_order('race_settle',49);
select pg_temp.late_failed('race_settle');
select pg_temp.review(pg_temp.late('A','resend','lr-race_settle','k-rs-race_settle'));
select pg_temp.sent('lr-race_settle','re_lr_race_settle_2','pending');
select pg_temp.new_order('race_rev',49);
select pg_temp.returned_after_repayment('race_rev',current_date+280);
-- END CONCURRENCY SETUP

-- Grants: the two requests are the browser path; the kernels, helpers and evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_request_late_refund(text,uuid,text,text,text)','execute'),true,'Signed-in users may call the late refund request');
select is(has_function_privilege('authenticated','public.money_operator_request_repayment_reversal(uuid,bigint,text,text,text)','execute'),true,'Signed-in users may call the reversal request');
select is(has_function_privilege('anon','public.money_operator_request_late_refund(text,uuid,text,text,text)','execute'),false,'Anonymous callers cannot request a late refund step');
select is(has_function_privilege('anon','public.money_operator_request_repayment_reversal(uuid,bigint,text,text,text)','execute'),false,'Anonymous callers cannot request a reversal');
select is(has_function_privilege('authenticated','public.money_record_refund_late_failure(uuid,text,text,uuid,uuid,text,text)','execute'),false,'The late failure kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_resend_late_refund(uuid,text,text,uuid,uuid,text)','execute'),false,'The late resend kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_release_late_refund(uuid,text,text,uuid,uuid,text,text)','execute'),false,'The late release kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_record_repayment_reversal(uuid,bigint,bigint,text,uuid,uuid,text,text)','execute'),false,'The reversal kernel stays service-only');
select is(has_function_privilege('service_role','public.money_release_late_refund(uuid,text,text,uuid,uuid,text,text)','execute'),true,'The service role runs the kernels');
select is(has_function_privilege('authenticated','private.money_refund_delivered(uuid)','execute'),false,'Private helpers stay closed');
select is(has_function_privilege('authenticated','private.money_process_refund_resettlement(text)','execute'),false,'The resettlement handler stays closed');
select is(has_table_privilege('authenticated','public.money_refund_late_failures','select'),false,'Browser roles cannot read late failures');
select is(has_table_privilege('authenticated','public.money_refund_resettlements','select'),false,'Browser roles cannot read resettlements');
select is(has_table_privilege('service_role','public.money_repayment_reversals','update'),false,'Reversals cannot be edited through the service role');

-- 1. A settled refund, before anything failed: nothing to record, and no signal to show.
select pg_temp.new_order('late',49);
select pg_temp.authorize('late',2000,'lr-late');
select is(pg_temp.settle('lr-late','re_lr_late_1'),'processed','Stripe settles the refund');
select is(pg_temp.attempt('lr-late'),'pending','The attempt keeps what the send recorded; the event settles the refund');
select is(pg_temp.late_of('lr-late'),null,'A delivered refund with no failure signal is not listed');
select throws_ok($$select pg_temp.late('A','failure','lr-late','k-lf-early')$$,'55000','Finance review not actionable: readback_required','Recording a late failure needs a readback');

-- Stripe's refund.updated to failed arrives as the webhook's no-effect observation: a signal only.
select public.money_receive_event('evt_lr_late_obs','observation',jsonb_build_object('object_id','re_lr_late_1','source_type','refund.updated','status','failed'));
select is(public.money_process_event('evt_lr_late_obs'),'processed','The observation is kept without effect');
select is(pg_temp.late_of('lr-late')->>'state','failure_signal','The refund is listed with the signal');
select is(pg_temp.late_of('lr-late')->'signal'->>'status','failed','The signal names Stripe''s status');
select is(pg_temp.late_of('lr-late')->>'failure_blocker','readback_required','The signal alone is not evidence');
select is((select e->>'source' from jsonb_array_elements(pg_temp.exceptions('refund_failed_late')) e where e->>'authorization_id'=pg_temp.id('lr-late')::text),'stripe_event','Reconciliation lists the unrecorded failure');
select is(pg_temp.attempt('lr-late'),'pending','Nothing changed on the attempt');

-- The readback proves it. The refund still stands until two operators record the failure.
select is(pg_temp.read('lr-late','re_lr_late_1','failed')->>'attempt_status','succeeded','A readback of a settled refund does not change the attempt');
select is(pg_temp.late_of('lr-late')->'failure_blocker','null'::jsonb,'The readback allows recording the failure');
select is((select e->>'source' from jsonb_array_elements(pg_temp.exceptions('refund_failed_late')) e where e->>'authorization_id'=pg_temp.id('lr-late')::text),'readback','The exception now cites the readback');
select is(pg_temp.recon('late')->'issues','[]'::jsonb,'Before it is recorded the ledger reconciles as refunded');

-- The one-operator paths of TRACE-077/082 stay closed to a settled refund.
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_resend_refund(%L,%L)',pg_temp.id('lr-late'),'Retry'))$$,'55000','Refund resend not allowed: refund_settled','The one-operator resend refuses a settled refund');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_reissue_refund(%L,%L)',pg_temp.id('lr-late'),'Retry'))$$,'55000','Refund reissue not allowed: refund_settled','The reissue refuses a settled refund');
select throws_ok($$select pg_temp.call('C',format('select public.money_operator_request_refund_release(%L,%L,%L,%L)',pg_temp.id('lr-late'),'Reason','Evidence','k-082-rel'))$$,'55000','Finance review not actionable: refund_settled','The TRACE-082 release refuses a settled refund');

-- The request's own checks.
select throws_ok($$select pg_temp.late('A','bogus','lr-late','k-lf-bogus')$$,'22023','Late refund step must be failure, resend or release','An unknown step is refused');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_late_refund(%L,%L,%L,%L,%L)','failure',pg_temp.id('lr-late'),' ','Evidence','k-lf-x'))$$,'22023','Reason of up to 1000 characters required','A request needs a reason');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_late_refund(%L,%L,%L,%L,%L)','failure',pg_temp.id('lr-late'),'Reason',null,'k-lf-x'))$$,'22023','Evidence of up to 1000 characters required','Recording a failure needs evidence');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_late_refund(%L,%L,%L,%L,%L)','release',pg_temp.id('lr-late'),'Reason',null,'k-lf-x'))$$,'22023','Evidence of up to 1000 characters required','A release needs evidence');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_late_refund(%L,%L,%L,%L,%L)','failure',gen_random_uuid(),'Reason','Evidence','k-lf-x'))$$,'P0002','Refund authorization not found','An unknown refund is refused');
select throws_ok($$select pg_temp.late('admin','failure','lr-late','k-lf-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request');

-- Recording the failure: any finance operator requests, a second approves.
insert into f select 'lf-late',pg_temp.late('C','failure','lr-late','k-lf-late');
select is(pg_temp.request_of(pg_temp.id('lf-late'))->>'state','awaiting_approval','The request awaits approval');
select is(pg_temp.request_of(pg_temp.id('lf-late'))->'details',jsonb_build_object('authorization_id',pg_temp.id('lr-late'),'payment_id','pi_lr_late',
  'service',2000,'tax',0,'tip',0,'amount',2000,'provider_reference','re_lr_late_1','attempt_status','succeeded','provider_status','failed','restores_provider',null),
  'The request shows the refund, the Stripe refund that failed and its status');
select is(pg_temp.late_of('lr-late')->>'open_failure_request_id',pg_temp.id('lf-late')::text,'The refund row links the open request');
select throws_ok($$select pg_temp.call('C',format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('lf-late'),'Self'))$$,'42501','A different finance operator must approve this command','The requester cannot approve it');
select throws_ok($$select pg_temp.call('C',format('select public.money_operator_execute_review(%L)',pg_temp.id('lf-late')))$$,'42501','Separate authenticated approval of exact financial command required','It cannot run unapproved');
select lives_ok($$select pg_temp.call('A',format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('lf-late'),'Read re_lr_late_1 at Stripe'))$$,'Operator A approves');
select is((pg_temp.call('C',format('select public.money_operator_execute_review(%L)',pg_temp.id('lf-late')))->>'replay')::boolean,false,'The requester runs it');
select is((pg_temp.call('C',format('select public.money_operator_execute_review(%L)',pg_temp.id('lf-late')))->>'replay')::boolean,true,'Running again replays');

-- The refund stands; what Stripe returned is owed to the customer.
select ok((select (x.authorization_id,x.obligation_id,x.amount,x.requested_by,x.approved_by)=(pg_temp.id('lr-late'),pg_temp.id('late'),2000::bigint,pg_temp.op('C')::uuid,pg_temp.op('A')::uuid)
  from public.money_refund_late_failures x where x.failed_reference='re_lr_late_1'),'The late failure records the refund, amount and both operators');
select is((select readback_id from public.money_refund_late_failures where failed_reference='re_lr_late_1'),
  (select id from public.money_refund_readbacks where authorization_id=pg_temp.id('lr-late') order by readback_sequence desc limit 1),'It names the readback that proved it');
select is(pg_temp.journal('refund-late-failure:re_lr_late_1'),jsonb_build_array(jsonb_build_object('account','stripe_clearing','debit',2000,'credit',0),
  jsonb_build_object('account','customer_refund_payable','debit',0,'credit',2000)),'Stripe clearing takes the money back and the customer is owed it');
select is(pg_temp.attempt('lr-late'),'failed','The attempt now reads failed');
select is((select refunded_service from public.money_obligations where id=pg_temp.id('late')),2000::bigint,'The refund still counts on the invoice');
select is(pg_temp.recon('late')->'issues','[]'::jsonb,'The ledger reconciles');
select is(pg_temp.recon('late')->'refunds',jsonb_build_object('service',2000,'tax',0,'tip',0,'settled',1,'pending',0,'released',0,
  'late_failed',1,'reversed',0,'customer_owed',2000),'Reconciliation reads the refund settled and 2000 owed to the customer');
select is((pg_temp.payable('late')->>'amount')::bigint,7800::bigint,'The provider''s share stays charged: the payout is 9500 less 1700');
select is((select e->>'amount' from jsonb_array_elements(pg_temp.exceptions('customer_refund_owed')) e where e->>'authorization_id'=pg_temp.id('lr-late')::text),'2000','Reconciliation lists the refund owed to the customer');
select is(pg_temp.exceptions('refund_failed_late'),'[]'::jsonb,'The recorded failure is no longer an unrecorded signal');
select is((pg_temp.call('C','select public.money_finance_reconciliation()')->'totals'->>'customer_refunds_owed')::bigint,8000::bigint,'The totals add what customers are owed, with the three concurrency fixtures');
select is((pg_temp.call('C',format('select public.money_operator_record_readback(%L,%s,%L,%L,%L)',pg_temp.id('late'),11700,'usd','Stripe balance for pi_lr_late','k-rb-late'))->>'matched')::boolean,true,
  'A payment readback expects Stripe to hold what the late failure returned');
select is((public.money_prepare_refund(pg_temp.id('lr-late'),pg_temp.op('A')::uuid)).status,'failed','refund-invoice reports the failure instead of already refunded');
select is(pg_temp.read('lr-late','re_lr_late_1','failed')->>'attempt_status','failed','A later readback keeps it failed');
select is(public.money_refund_readback_target(pg_temp.id('lr-late'),pg_temp.op('C')::uuid)->'late_failure_open','true'::jsonb,'The readback target shows the open failure');
select is(pg_temp.late_of('lr-late')->>'state','customer_owed','Operations list the refund as owed to the customer');
select is(pg_temp.late_of('lr-late')->'resend_blocker','null'::jsonb,'It can be resent');
select is(pg_temp.late_of('lr-late')->'release_blocker','null'::jsonb,'It can be released');
select throws_ok($$select pg_temp.late('A','failure','lr-late','k-lf-late-again')$$,'55000','Finance review not actionable: late_failure_open','A second failure cannot be recorded while one is open');

-- A release requested now goes stale once the refund is resent.
insert into f select 'rel-stale',pg_temp.late('C','release','lr-late','k-rel-late-stale');
select lives_ok($$select pg_temp.call('A',format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('rel-stale'),'Approve'))$$,'Operator A approves a release');

-- Resend: two operators, a new send generation under a new key.
insert into f select 'rs-late',pg_temp.late('A','resend','lr-late','k-rs-late');
select is((select evidence from public.money_review_requests where id=pg_temp.id('rs-late')),null,'A resend takes a reason only');
select is((pg_temp.review(pg_temp.id('rs-late'))->>'replay')::boolean,false,'The resend runs');
select ok((select (a.status,a.idempotency_key,a.provider_reference) is not distinct from ('prepared','mercurius:refund-v1:'||pg_temp.id('lr-late')||':g2',null::text)
  from public.money_refund_attempts a where a.authorization_id=pg_temp.id('lr-late')),'The attempt is prepared under generation 2');
select ok((select (x.previous_key,x.failed_reference,x.actor,x.approved_by,x.readback_id)=('mercurius:refund-v1:'||pg_temp.id('lr-late'),'re_lr_late_1',pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,
    (select readback_id from public.money_refund_late_failures where failed_reference='re_lr_late_1'))
  from public.money_refund_reissues x where x.authorization_id=pg_temp.id('lr-late')),'The generation names the failed refund, both operators and the evidence');
select is(pg_temp.request_of(pg_temp.id('rel-stale'))->>'blocker','refund_changed','The earlier release is bound to the send it was approved against');
select throws_ok($$select pg_temp.call('C',format('select public.money_operator_execute_review(%L)',pg_temp.id('rel-stale')))$$,'55000','Finance review not actionable: refund_changed','It cannot run');
select throws_ok($$select pg_temp.late('A','resend','lr-late','k-rs-late-2')$$,'55000','Finance review not actionable: refund_in_flight','No second resend while one is out');
select is(public.money_refund_readback_target(pg_temp.id('lr-late'),pg_temp.op('C')::uuid)->'failed_references','["re_lr_late_1"]'::jsonb,'A readback skips the refund that failed');
select throws_ok($$select pg_temp.read('lr-late','re_lr_late_1','failed')$$,'55000','This Stripe refund failed on an earlier send of this refund; read back the current send','The failed refund can never be the new send''s');
select is((public.money_prepare_refund(pg_temp.id('lr-late'),pg_temp.op('A')::uuid)).status,'prepared','refund-invoice may send the new generation');

-- The resend settles: what was held is paid to the customer.
select pg_temp.sent('lr-late','re_lr_late_2','pending');
select is(pg_temp.attempt('lr-late'),'pending','Stripe accepts the new refund');
select is(pg_temp.request_of(pg_temp.id('rel-stale'))->>'blocker','refund_changed','The release stays stale');
select is(pg_temp.event('lr-late','re_lr_late_2','evt_lr_late_2'),'processed','Stripe''s event for the new refund processes');
select ok((select (x.authorization_id,x.failed_reference,x.event_id)=(pg_temp.id('lr-late'),'re_lr_late_1','evt_lr_late_2') from public.money_refund_resettlements x where x.provider_ref='re_lr_late_2'),
  'The resettlement pays the late failure');
select is(pg_temp.journal('refund-resettlement:re_lr_late_2'),jsonb_build_array(jsonb_build_object('account','customer_refund_payable','debit',2000,'credit',0),
  jsonb_build_object('account','stripe_clearing','debit',0,'credit',2000)),'The payable is paid out of Stripe clearing');
select is(pg_temp.attempt('lr-late'),'succeeded','The attempt reads succeeded');
select is(pg_temp.recon('late')->'issues','[]'::jsonb,'The ledger reconciles');
select is((pg_temp.recon('late')->'refunds'->>'customer_owed')::bigint,0::bigint,'Nothing is owed to the customer');
select is(pg_temp.late_of('lr-late')->>'state','redelivered','Operations show it delivered again');
select is(pg_temp.late_of('lr-late')->>'delivered_reference','re_lr_late_2','The new refund is the one that delivered it');
select is(pg_temp.late_of('lr-late')->>'failure_blocker','readback_required','The first refund''s failed readback does not prove the new one failed');
select is(pg_temp.request_of(pg_temp.id('rel-stale'))->>'blocker','no_late_failure','The old release has nothing to release');
select is(public.money_process_event('evt_lr_late_2'),'processed','Processing the event again replays');
select is(pg_temp.event('lr-late','re_lr_late_2','evt_lr_late_2_dup'),'processed','A duplicate delivery of the event is a no-op');
select is(pg_temp.event('lr-late','re_lr_late_1','evt_lr_late_1_dup'),'processed','A late duplicate of the first settlement is a no-op');
select is((select count(*)::integer from public.money_journals where obligation_id=pg_temp.id('late') and kind in ('refund','refund_resettlement')),2,'Each refund posted once');
select is(pg_temp.recon('late')->'issues','[]'::jsonb,'Still reconciled');

-- It fails late again; this time the operators release it.
select pg_temp.read('lr-late','re_lr_late_2','canceled');
insert into f select 'lf-late-2',pg_temp.late('A','failure','lr-late','k-lf-late-2');
select is(pg_temp.request_of(pg_temp.id('lf-late-2'))->'details'->>'provider_reference','re_lr_late_2','The second failure names the refund that delivered it');
select lives_ok($$select pg_temp.review(pg_temp.id('lf-late-2'))$$,'The second failure is recorded');
select is((pg_temp.recon('late')->'refunds'->>'customer_owed')::bigint,2000::bigint,'It is owed to the customer again');
insert into f select 'rel-late',pg_temp.late('A','release','lr-late','k-rel-late');
select is(pg_temp.request_of(pg_temp.id('rel-late'))->'details'->>'restores_provider','1700','The release shows the provider share it restores');
select is((pg_temp.review(pg_temp.id('rel-late'))->>'replay')::boolean,false,'The release runs');
select is(pg_temp.journal('refund-reversal:'||pg_temp.id('lr-late')),jsonb_build_array(jsonb_build_object('account','customer_refund_payable','debit',2000,'credit',0),
  jsonb_build_object('account','platform_revenue','debit',0,'credit',300),jsonb_build_object('account','provider_payable','debit',0,'credit',1700)),
  'The refund is reversed: the fee and the provider share are restored');
select is((select refunded_service+refunded_tax+refunded_tip from public.money_obligations where id=pg_temp.id('late')),0::bigint,'The refund no longer counts on the invoice');
select ok((select (z.amount,z.failed_reference,z.requested_by,z.approved_by)=(2000::bigint,'re_lr_late_2',pg_temp.op('A')::uuid,pg_temp.op('B')::uuid)
  from public.money_refund_releases z where z.authorization_id=pg_temp.id('lr-late')),'The release is recorded with the refund that failed');
select is(pg_temp.recon('late')->'issues','[]'::jsonb,'The ledger reconciles');
select is(pg_temp.recon('late')->'refunds',jsonb_build_object('service',0,'tax',0,'tip',0,'settled',0,'pending',0,'released',1,
  'late_failed',2,'reversed',1,'customer_owed',0),'Reconciliation reads it released and reversed');
select is((pg_temp.payable('late')->>'amount')::bigint,9500::bigint,'The provider''s full proceeds are payable again');
select is(private.money_refund_blocker(pg_temp.id('late'),'pi_lr_late',10000,0,0),null,'The whole service can be refunded again');
select is((public.money_prepare_refund(pg_temp.id('lr-late'),pg_temp.op('A')::uuid)).status,'failed','refund-invoice finds nothing to send');
select throws_ok($$update public.money_refund_attempts set status='prepared' where authorization_id=pg_temp.id('lr-late')$$,'55000','A released refund cannot be sent again','No writer can send it again');
select is(pg_temp.late_of('lr-late')->>'state','released','Operations show it released');
select is((select r->'reversed' from jsonb_array_elements(pg_temp.ops()->'refund_releases') r where r->>'authorization_id'=pg_temp.id('lr-late')::text),'true'::jsonb,'Recent releases mark it reversed');
select throws_ok($$select pg_temp.late('A','resend','lr-late','k-rs-late-3')$$,'55000','Finance review not actionable: refund_released','A released refund cannot be resent');
select throws_ok($$select pg_temp.late('A','release','lr-late','k-rel-late-2')$$,'55000','Finance review not actionable: completed','It cannot be released twice');
select is(pg_temp.event('lr-late','re_lr_late_3','evt_lr_late_3'),'failed','A refund event for a released refund does not process');
select is((select count(*)::integer from public.money_refund_resettlements where authorization_id=pg_temp.id('lr-late')),1,'Nothing was resettled');

-- 2. A resend that fails before it settles, a second resend on the readback, and an uncertain send.
select pg_temp.new_order('resendfail',49);
select pg_temp.late_failed('resendfail');
select pg_temp.review(pg_temp.late('A','resend','lr-resendfail','k-rs-rf-1'));
select pg_temp.sent('lr-resendfail','re_lr_resendfail_2','failed');
select is(pg_temp.attempt('lr-resendfail'),'failed','Stripe fails the new refund');
select is(pg_temp.late_of('lr-resendfail')->>'resend_blocker','readback_required','A second resend needs a readback of the new refund');
select is(pg_temp.late_of('lr-resendfail')->>'release_blocker','readback_required','So does a release');
select pg_temp.read('lr-resendfail','re_lr_resendfail_2','failed');
select is(pg_temp.late_of('lr-resendfail')->'resend_blocker','null'::jsonb,'The readback allows a second resend');
select lives_ok($$select pg_temp.review(pg_temp.late('A','resend','lr-resendfail','k-rs-rf-2'))$$,'The second resend runs');
select is((select string_agg(failed_reference,',' order by generation) from public.money_refund_reissues where authorization_id=pg_temp.id('lr-resendfail')),
  're_lr_resendfail_1,re_lr_resendfail_2','Each generation keeps the refund that failed');
select is((select idempotency_key from public.money_refund_attempts where authorization_id=pg_temp.id('lr-resendfail')),'mercurius:refund-v1:'||pg_temp.id('lr-resendfail')||':g3','Generation 3 is prepared');
-- The third send's outcome is unknown: after 23 hours refund-invoice stops, and a day later Stripe has no refund.
update public.money_refund_attempts set prepared_at=now()-interval '23 hours 30 minutes' where authorization_id=pg_temp.id('lr-resendfail');
select is((public.money_prepare_refund(pg_temp.id('lr-resendfail'),pg_temp.op('A')::uuid)).status,'reconcile','An unsent generation becomes uncertain');
select is(pg_temp.late_of('lr-resendfail')->>'release_blocker','readback_required','An uncertain send needs a readback');
select pg_temp.read('lr-resendfail',null,null);
select is(pg_temp.late_of('lr-resendfail')->>'release_blocker','readback_too_early','Inside Stripe''s 24-hour idempotency window a readback finding nothing is not enough');
update public.money_refund_attempts set prepared_at=now()-interval '25 hours' where authorization_id=pg_temp.id('lr-resendfail');
select is(pg_temp.late_of('lr-resendfail')->'release_blocker','null'::jsonb,'Stripe has no refund a day later: it can be released');
select is(pg_temp.late_of('lr-resendfail')->'resend_blocker','null'::jsonb,'Or resent');
select lives_ok($$select pg_temp.review(pg_temp.late('A','release','lr-resendfail','k-rel-rf'))$$,'The release runs');
select is((select failed_reference from public.money_refund_releases where authorization_id=pg_temp.id('lr-resendfail')),'re_lr_resendfail_1','With no Stripe refund, the release names the open late failure');
select is(pg_temp.recon('resendfail')->'issues','[]'::jsonb,'The ledger reconciles');

-- 3. A chargeback on the payment stops a resend, which could repay the customer twice.
select pg_temp.new_order('cb',49);
select pg_temp.late_failed('cb');
select public.money_receive_event('evt_lr_cb_open','dispute','{"dispute_id":"dp_lr_cb","payment_id":"pi_lr_cb","amount":2000,"currency":"usd","state":"open"}');
select is(public.money_process_event('evt_lr_cb_open'),'processed','The customer disputes the payment');
select is(pg_temp.late_of('lr-cb')->>'resend_blocker','chargeback_open','A resend waits for the chargeback');
select throws_ok($$select pg_temp.late('A','resend','lr-cb','k-rs-cb')$$,'55000','Finance review not actionable: chargeback_open','The request is refused');

-- 4. Releases against a payout the bank has paid, and one it has not.
select pg_temp.new_order('owed',49);
select pg_temp.new_order('repaid',49);
select pg_temp.new_order('before',49);
select pg_temp.new_order('unpaid',49);
select pg_temp.authorize('before',2000,'lr-before');
select pg_temp.settle('lr-before','re_lr_before_1');
select pg_temp.authorize('unpaid',2000,'lr-unpaid');
select pg_temp.settle('lr-unpaid','re_lr_unpaid_1');
select pg_temp.review(pg_temp.batch(current_date,array['owed','repaid','before','unpaid'],'lr-w1'));
select pg_temp.record('owed','submitted','LR-OWED','k-owed-sub');
select pg_temp.record('owed','settled',null,'k-owed-set');
select pg_temp.record('repaid','submitted','LR-REPAID','k-repaid-sub');
select pg_temp.record('repaid','settled',null,'k-repaid-set');
select pg_temp.record('before','submitted','LR-BEFORE','k-before-sub');
select pg_temp.record('before','settled',null,'k-before-set');
select pg_temp.record('unpaid','submitted','LR-UNPAID','k-unpaid-sub');
select is((select amount from public.money_ach_items where obligation_id=pg_temp.id('before')),7800::bigint,'A payout after a refund pays the reduced proceeds');

-- A refund after the payout: the provider owes their share. A late failure leaves that owed.
select pg_temp.late_failed('owed');
select is(private.money_payout_owed(pg_temp.id('owed')),1700::bigint,'The refund stands, so the provider still owes their share');
select is(pg_temp.recon('owed')->'issues','[]'::jsonb,'The ledger reconciles');
select lives_ok($$select pg_temp.review(pg_temp.late('A','release','lr-owed','k-rel-owed'))$$,'The release runs on the paid payout');
select is(private.money_payout_owed(pg_temp.id('owed')),0::bigint,'Restoring the share clears what the provider owed');
select is(pg_temp.recon('owed')->'issues','[]'::jsonb,'The ledger reconciles');
select is(pg_temp.returns_of('owed'),null,'Nothing was repaid, so nothing goes back');

-- The same, after the provider repaid: the release leaves the repayment owed back.
select pg_temp.late_failed('repaid');
select pg_temp.review(pg_temp.recover('repaid','repayment',1700,'k-repay-repaid'));
select is(private.money_payout_owed(pg_temp.id('repaid')),0::bigint,'The provider repaid their share');
select lives_ok($$select pg_temp.review(pg_temp.late('A','release','lr-repaid','k-rel-repaid'))$$,'The release runs');
select is(private.money_repayment_returnable(pg_temp.id('repaid')),1700::bigint,'The repayment is now owed back');
select is((pg_temp.returns_of('repaid')->>'returnable')::bigint,1700::bigint,'Operations list it');
select is(pg_temp.recon('repaid')->'issues','[]'::jsonb,'The ledger reconciles');
select lives_ok($$select pg_temp.review(pg_temp.reverse('repaid',1700,'k-rev-repaid'))$$,'Mercurius sends it back');
select is(private.money_repayment_returnable(pg_temp.id('repaid')),0::bigint,'Nothing more is owed back');
select is(pg_temp.recon('repaid')->'issues','[]'::jsonb,'The ledger reconciles');

-- A refund before the payout: the payout paid the reduced proceeds, and a release would leave the
-- provider short on a payout that cannot be paid again.
select pg_temp.review(pg_temp.late('A','failure','lr-before','k-lf-before')) from (select pg_temp.read('lr-before','re_lr_before_1','failed')) x;
select is(pg_temp.late_of('lr-before')->>'release_blocker','payout_paid','A release that would underpay a paid payout is refused');
select throws_ok($$select pg_temp.late('A','release','lr-before','k-rel-before')$$,'55000','Finance review not actionable: payout_paid','The request is refused');
select is(pg_temp.late_of('lr-before')->'resend_blocker','null'::jsonb,'It can still be resent');

-- A payout the bank has not paid: the release waits for the outcome, as a refund does.
select pg_temp.review(pg_temp.late('A','failure','lr-unpaid','k-lf-unpaid')) from (select pg_temp.read('lr-unpaid','re_lr_unpaid_1','failed')) x;
select is(pg_temp.late_of('lr-unpaid')->>'release_blocker','on_ach_statement','A release waits for the bank outcome');

-- Stripe's refund events can arrive out of order. A readback showing the refund failed, taken before
-- its stale settlement event processed, still proves the settled refund failed: failed is final.
select pg_temp.new_order('order',49);
select pg_temp.authorize('order',2000,'lr-order');
select pg_temp.sent('lr-order','re_lr_order_1','pending');
select pg_temp.read('lr-order','re_lr_order_1','failed');
select is(pg_temp.attempt('lr-order'),'failed','Before the event the readback marks the attempt failed');
select is(pg_temp.event('lr-order','re_lr_order_1','evt_lr_order_1'),'processed','The stale settlement event still settles the refund');
select is(pg_temp.late_of('lr-order')->>'state','failure_signal','The settled refund is listed as failed at Stripe');
select lives_ok($$select pg_temp.review(pg_temp.late('A','failure','lr-order','k-lf-order'))$$,'The earlier readback is enough to record the failure');
select is((pg_temp.recon('order')->'refunds'->>'customer_owed')::bigint,2000::bigint,'What Stripe returned is owed to the customer');
select is(pg_temp.recon('order')->'issues','[]'::jsonb,'The ledger reconciles');

-- The kernels' own checks.
select pg_temp.new_order('kernel',49);
select pg_temp.authorize('kernel',2000,'lr-kernel');
select pg_temp.settle('lr-kernel','re_lr_kernel_1');
select throws_ok($$select public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Reason','Evidence')$$,'42501',null,'The kernel refuses a command nobody approved');
select pg_temp.kernel_approve(private.money_refund_late_command('refund_late_failure',pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),'Reason','Evidence'));
select throws_ok($$select public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Reason','Evidence')$$,'55000','Refund late failure not allowed: readback_required','The kernel refuses without the readback');
select pg_temp.read('lr-kernel','re_lr_kernel_1','failed');
select throws_ok($$select public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('A')::uuid,'Reason','Evidence')$$,'42501',null,'The kernel refuses one operator as both');
select is(public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Reason','Evidence'),'re_lr_kernel_1','With the readback the kernel records it');
select is(public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Reason','Evidence'),'re_lr_kernel_1','The same call replays');
select pg_temp.kernel_approve(private.money_refund_late_command('refund_late_failure',pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),'Reason','Other'));
select throws_ok($$select public.money_record_refund_late_failure(pg_temp.id('lr-kernel'),'re_lr_kernel_1','mercurius:refund-v1:'||pg_temp.id('lr-kernel'),
  pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Reason','Other')$$,'P0001','Refund late failure idempotency conflict','A different record of the same failure conflicts');
select throws_ok($$update public.money_refund_late_failures set reason='x'$$,'55000',null,'Late failures are immutable');
select throws_ok($$delete from public.money_refund_resettlements$$,'55000',null,'Resettlements cannot be deleted');
select throws_ok($$insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(pg_temp.id('kernel'),'bad','bad',
  '[{"account":"customer_refund_payable","debit":1,"credit":0},{"account":"nowhere","debit":0,"credit":1}]','x')$$,'P0001','Invalid posting','Journals still refuse unknown accounts');

-- 5. A bank return after the provider repaid: the repayment is reversed.
select pg_temp.new_order('ret',49);
select pg_temp.paid('ret',current_date+14);
select pg_temp.authorize('ret',2000,'lr-ret');
select pg_temp.settle('lr-ret','re_lr_ret_1');
select pg_temp.review(pg_temp.recover('ret','repayment',1700,'k-repay-ret'));
select is(private.money_repayment_returnable(pg_temp.id('ret')),0::bigint,'Before the return the provider owed what they repaid');
select throws_ok($$select pg_temp.reverse('ret',100,'k-rev-early')$$,'55000','Finance review not actionable: nothing_returnable','Nothing can go back yet');
select pg_temp.record('ret','returned',null,'k-ret-ret');
select is(private.money_repayment_returnable(pg_temp.id('ret')),1700::bigint,'After the return the whole repayment is owed back');
select is((select e->>'amount' from jsonb_array_elements(pg_temp.exceptions('repayment_returnable')) e where e->>'obligation_id'=pg_temp.id('ret')::text),'1700','Reconciliation lists it');
select is(pg_temp.returns_of('ret')-'reversals'-'open_request_id'-'obligation_id'-'invoice_number',jsonb_build_object('payee_name','Synthetic late reversal payee',
  'returnable',1700,'repaid',1700,'reversed',0,'paid',0,'proceeds',7800),'Operations show the repayment, what the bank kept and the proceeds');
select is(private.money_payout_received(pg_temp.id('ret')),-1700::bigint,'Before the reversal the provider is 1700 out of pocket');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_repayment_reversal(%L,%s,%L,%L,%L)',pg_temp.id('ret'),0,'Reason','Evidence','k-rev-0'))$$,
  '22023','Reversal amount in cents required','A reversal needs an amount');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_request_repayment_reversal(%L,%s,%L,%L,%L)',pg_temp.id('ret'),100,'Reason',null,'k-rev-0'))$$,
  '22023','Evidence of up to 1000 characters required','A reversal needs evidence');
select throws_ok($$select pg_temp.reverse('ret',1701,'k-rev-over')$$,'55000','Finance review not actionable: exceeds_returnable','No more than the repayment goes back');
insert into f select 'rev-1',pg_temp.reverse('ret',700,'k-rev-1');
insert into f select 'rev-2',pg_temp.reverse('ret',1000,'k-rev-2');
select is(pg_temp.request_of(pg_temp.id('rev-1'))->'details',jsonb_build_object('amount',700,'returnable',1700,'returnable_now',1700,
  'payee_name','Synthetic late reversal payee'),'The request shows the amount and what is returnable');
select ok(pg_temp.returns_of('ret')->>'open_request_id' in (pg_temp.id('rev-1')::text,pg_temp.id('rev-2')::text),'The payout links an open request');
select lives_ok($$select pg_temp.call('B',format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('rev-2'),'Approve'))$$,'The second request is approved too');
select is((pg_temp.review(pg_temp.id('rev-1'))->>'replay')::boolean,false,'The first reversal runs');
select is(pg_temp.request_of(pg_temp.id('rev-2'))->>'blocker','returnable_changed','The other, approved against 1700, is stale');
select throws_ok($$select pg_temp.call('A',format('select public.money_operator_execute_review(%L)',pg_temp.id('rev-2')))$$,'55000','Finance review not actionable: returnable_changed','It cannot run');
select ok((select (v.amount,v.returnable_before,v.contractor_id,v.requested_by,v.approved_by)=(700::bigint,1700::bigint,'a8320000-0000-4000-8000-000000000001'::uuid,pg_temp.op('A')::uuid,pg_temp.op('B')::uuid)
  from public.money_repayment_reversals v where v.business_key='k-rev-1'),'The reversal records the amount, the payee and both operators');
select is(pg_temp.journal('repayment-reversal:'||(select id from public.money_repayment_reversals where business_key='k-rev-1')),
  jsonb_build_array(jsonb_build_object('account','provider_payable','debit',700,'credit',0),jsonb_build_object('account','bank','debit',0,'credit',700)),
  'The bank pays the provider out of what Mercurius owes them');
select lives_ok($$select pg_temp.review(pg_temp.reverse('ret',1000,'k-rev-3'))$$,'A new request returns the rest');
select is(private.money_repayment_returnable(pg_temp.id('ret')),0::bigint,'The repayment is all back');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.exceptions('repayment_returnable')) e where e->>'obligation_id'=pg_temp.id('ret')::text),0,'No repayment is owed back on this payout');
select is(private.money_payout_received(pg_temp.id('ret')),0::bigint,'The provider is back to having received nothing');
select is(pg_temp.recon('ret')->'issues','["statement_stale"]'::jsonb,'Only the returned statement, older than the refund, reads stale until it is replaced (TRACE-080)');
select is(pg_temp.recon('ret')->'payout'->'recovery'->>'repayment_reversed','1700','Reconciliation reads the reversal');
select throws_ok($$select pg_temp.reverse('ret',100,'k-rev-4')$$,'55000','Finance review not actionable: nothing_returnable','Nothing more can go back');
select pg_temp.kernel_approve(private.money_repayment_reversal_command(pg_temp.id('ret'),100,0,'Kernel','Kernel','k-rev-kernel'));
select throws_ok($$select public.money_record_repayment_reversal(pg_temp.id('ret'),100,0,'k-rev-kernel',pg_temp.op('A')::uuid,pg_temp.op('B')::uuid,'Kernel','Kernel')$$,
  '55000','Repayment reversal not allowed: nothing_returnable','The kernel checks too');

-- The replacement pays the proceeds and nothing more; the payout reconciles.
select pg_temp.review((pg_temp.call('A',format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',pg_temp.attempt_of('ret'),
  'Returned transfer','Bank shows the return','k-w-ret'))->>'request_id')::uuid);
select pg_temp.review(pg_temp.batch(current_date+21,array['ret'],'lr-w-ret'));
select is((select amount from public.money_ach_items where id=pg_temp.item_id('ret')),7800::bigint,'The replacement pays the proceeds');
select pg_temp.record('ret','submitted','LR-RET-2','k-ret2-sub');
select pg_temp.record('ret','settled',null,'k-ret2-set');
select is(pg_temp.recon('ret')->'issues','[]'::jsonb,'The payout reconciles');
select is(private.money_account_net(pg_temp.id('ret'),'provider_payable'),0::bigint,'Nothing is owed either way');

-- The reversal is a bank movement a statement line pairs with by hand.
select is((select string_agg(amount::text||':'||direction||':'||coalesce(bank_reference,'-'),',' order by amount) from private.money_bank_movements() where kind='reversal' and obligation_id=pg_temp.id('ret')),
  '700:debit:-,1000:debit:-','Each reversal is a debit with no bank reference');
insert into f select 'stmt',(pg_temp.call('A',format('select public.money_operator_import_bank_statement(%L,%L,%L,null,%L)',private.money_bank_day(now())-1,private.money_bank_day(now())+1,
  jsonb_build_array(jsonb_build_object('posted_on',to_char(private.money_bank_day(now()),'YYYY-MM-DD'),'direction','debit','amount',700,'reference','LR-REV-700')),'k-lr-stmt'))->>'statement_id')::uuid;
select is(private.money_bank_line_suggestion((select id from public.money_bank_statement_lines where statement_id=pg_temp.id('stmt')))->>'action','match_reversal','A debit line suggests the reversal');
select lives_ok($$select pg_temp.call('A',format('select public.money_operator_match_bank_line(%L,%L,%L)',(select id from public.money_bank_statement_lines where statement_id=pg_temp.id('stmt')),
  (select movement from private.money_bank_movements() where kind='reversal' and amount=700 and obligation_id=pg_temp.id('ret')),'Returned repayment'))$$,'The operator matches it');
select is((select state from private.money_bank_line_states() where line_id=(select id from public.money_bank_statement_lines where statement_id=pg_temp.id('stmt'))),'matched','The line is matched');

select * from finish();
rollback;
