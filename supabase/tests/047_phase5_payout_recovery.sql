begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-080 synthetic fixtures only. Covers a customer refund and a lost chargeback after the
-- provider's payout settled, a withdrawn transfer the bank later shows as paid, and the reviewed
-- repayments and write-offs that close what a provider owes. Nothing here nets other earnings or
-- holds other payouts.
insert into auth.users(id,email,email_confirmed_at) values
 ('a8010000-0000-4000-8000-000000000001','rec-homeowner@example.invalid',now()),
 ('a8010000-0000-4000-8000-000000000002','rec-operator-a@example.invalid',now()),
 ('a8010000-0000-4000-8000-000000000003','rec-operator-b@example.invalid',now()),
 ('a8010000-0000-4000-8000-000000000004','rec-plain-admin@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a8010000-0000-4000-8000-000000000002','admin'),('a8010000-0000-4000-8000-000000000003','admin'),
 ('a8010000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Synthetic test'),
 ('a8010000-0000-4000-8000-000000000003','a8010000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a8020000-0000-4000-8000-000000000001','Synthetic recovery payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a8030000-0000-4000-8000-000000000001','Synthetic recovery payee','Test','Payout','rec-payee-1@example.invalid','synthetic','a8020000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,3,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id='a8030000-0000-4000-8000-000000000001';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a8010000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a8020000-0000-4000-8000-000000000001';

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
  perform pg_temp.as_user('a8010000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a8010000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order whose homeowner confirmed completion that many hours ago.
create function pg_temp.new_order(label text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a8010000-0000-4000-8000-000000000001','a8020000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a8010000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-request',request),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_rec_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_rec_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_rec_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a8010000-0000-4000-8000-000000000001','a8020000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- Operator B approves and operator A (the requester) runs a request.
create function pg_temp.review(p_request uuid) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('a8010000-0000-4000-8000-000000000003');
  perform public.money_operator_approve_review(p_request,'Synthetic second-person review');
  perform pg_temp.as_user('a8010000-0000-4000-8000-000000000002');
  perform public.money_operator_execute_review(p_request);
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.batch(p_period date,labels text[],p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach(p_period,array(select pg_temp.id(l) from unnest(labels) l),'BANK-BATCH-'||p_key,'Synthetic weekly ACH',p_key)->>'request_id')::uuid $$;
-- The newest statement item of a payout and its latest attempt. Fixture lookups read as the owner.
create function pg_temp.item_id(label text) returns uuid language sql security definer as $$
 select i.id from public.money_ach_items i where i.obligation_id=pg_temp.id(label)
 and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) $$;
create function pg_temp.attempt_of(label text) returns uuid language sql security definer as $$
 select a.id from public.money_ach_attempts a where a.item_id=pg_temp.item_id(label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.record(label text,p_status text,p_ref text,p_key text) returns jsonb language sql as $$
 select public.money_operator_record_ach(pg_temp.attempt_of(label),p_status,p_ref,'Synthetic bank evidence '||p_status,p_key) $$;
create function pg_temp.withdraw(label text,p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach_withdrawal(pg_temp.attempt_of(label),'Synthetic withdrawal','Bank portal shows no transfer for this payout',p_key)->>'request_id')::uuid $$;
create function pg_temp.late(p_attempt uuid,p_ref text,p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach_late_settlement(p_attempt,p_ref,'Bank paid a withdrawn transfer','Statement line shows the payment to the provider',p_key)->>'request_id')::uuid $$;
create function pg_temp.recover(label text,p_kind text,p_amount bigint,p_key text) returns uuid language sql as $$
 select (public.money_operator_request_payout_recovery(pg_temp.id(label),p_kind,p_amount,'Synthetic recovery','Synthetic bank credit or finance decision',p_key)->>'request_id')::uuid $$;
create function pg_temp.settle_refund(label text,p_amount bigint) returns text language plpgsql security definer as $$
declare authorization_id uuid;
begin
  select id into strict authorization_id from public.money_refund_authorizations where obligation_id=pg_temp.id(label)
    and not exists(select 1 from public.money_refunds r where r.authorization_id=money_refund_authorizations.id);
  perform public.money_prepare_refund(authorization_id,'a8010000-0000-4000-8000-000000000002');
  perform public.money_receive_event('evt_rec_refund_'||label,'refund',jsonb_build_object('authorization_id',authorization_id,
    'refund_id','re_rec_'||label,'payment_id','pi_rec_'||label,'amount',p_amount,'currency','usd'));
  return public.money_process_event('evt_rec_refund_'||label);
end $$;
create function pg_temp.ops() returns jsonb language sql as $$ select public.money_finance_operations() $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.ready_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'ach'->'ready') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.owed_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'recoveries'->'owed') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.withdrawn_of(p_attempt uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'recoveries'->'withdrawn') v where v->>'attempt_id'=p_attempt::text $$;
create function pg_temp.item_of(label text,p_period date) returns jsonb language sql as $$
 select i from jsonb_array_elements((select b from jsonb_array_elements(public.money_finance_operations()->'ach'->'batches') b
   where b->>'period_start'=to_char(p_period,'YYYY-MM-DD'))->'items') i where i->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.row_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_reconciliation()->'obligations') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.owes_exception(label text) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.money_finance_reconciliation()->'exceptions') e
 where e->>'kind'='provider_owes' and e->>'obligation_id'=pg_temp.id(label)::text $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text),pg_temp.batch(date,text[],text),pg_temp.item_id(text),pg_temp.attempt_of(text),
  pg_temp.record(text,text,text,text),pg_temp.withdraw(text,text),pg_temp.review(uuid),pg_temp.late(uuid,text,text),
  pg_temp.recover(text,text,bigint,text) to authenticated;

select pg_temp.new_order('refpaid',49);
select pg_temp.new_order('cbpaid',50);
select pg_temp.new_order('sched',51);
select pg_temp.new_order('dup',52);
select pg_temp.new_order('late',53);
select pg_temp.new_order('latefail',54);
select pg_temp.new_order('lateretry',55);
select pg_temp.new_order('other',56);
-- Used only by scripts/phase5-payout-recovery-concurrency.mjs.
select pg_temp.new_order('race_recover',49);
select pg_temp.new_order('race_late',49);
select pg_temp.new_order('race_batch',49);
-- END CONCURRENCY SETUP

-- Grants: the requests are the browser path; the kernels, helpers and recovery evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_request_ach_late_settlement(uuid,text,text,text,text)','execute'),true,'Signed-in users may call the late settlement request');
select is(has_function_privilege('authenticated','public.money_operator_request_payout_recovery(uuid,text,bigint,text,text,text)','execute'),true,'Signed-in users may call the recovery request');
select is(has_function_privilege('anon','public.money_operator_request_payout_recovery(uuid,text,bigint,text,text,text)','execute'),false,'Anonymous callers cannot request a recovery');
select is(has_function_privilege('anon','public.money_operator_request_ach_late_settlement(uuid,text,text,text,text)','execute'),false,'Anonymous callers cannot request a late settlement');
select is(has_function_privilege('authenticated','public.money_record_payout_recovery(uuid,text,bigint,bigint,text,uuid,uuid,text,text)','execute'),false,'The recovery kernel is not a browser path');
select is(has_function_privilege('authenticated','public.money_record_ach_late_settlement(uuid,text,uuid,uuid,text,text)','execute'),false,'The late settlement kernel is not a browser path');
select is(has_function_privilege('service_role','public.money_record_payout_recovery(uuid,text,bigint,bigint,text,uuid,uuid,text,text)','execute'),true,'The recovery kernel is a service path');
select is(has_function_privilege('service_role','public.money_record_ach_late_settlement(uuid,text,uuid,uuid,text,text)','execute'),true,'The late settlement kernel is a service path');
select is(has_function_privilege('authenticated','private.money_payout_owed(uuid)','execute'),false,'The amount owed helper stays closed');
select is(has_function_privilege('authenticated','private.money_ach_exceeds_proceeds(uuid,bigint)','execute'),false,'The proceeds guard helper stays closed');
select is(has_function_privilege('authenticated','private.money_recovery_operations(uuid)','execute'),false,'The recovery readback helper stays closed');
select is(has_table_privilege('authenticated','public.money_payout_recoveries','select'),false,'Browser roles cannot read recoveries');
select is(has_table_privilege('authenticated','public.money_ach_late_settlements','select'),false,'Browser roles cannot read late settlements');
select is(has_table_privilege('service_role','public.money_payout_recoveries','update'),false,'Recoveries cannot be edited through the service role');
select is(has_table_privilege('service_role','public.money_ach_late_settlements','update'),false,'Late settlements cannot be edited through the service role');

-- One batch with every payout this suite pays, withdraws or leaves scheduled.
set local role authenticated;
select pg_temp.as_user('a8010000-0000-4000-8000-000000000002');
select pg_temp.review(pg_temp.batch(current_date,array['refpaid','cbpaid','sched','dup','late','latefail','lateretry'],'rec-w1'));
select lives_ok($$select pg_temp.record('refpaid','submitted','REC-REFPAID','k-refpaid-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('refpaid','settled',null,'k-refpaid-set')$$,'It settles');
select lives_ok($$select pg_temp.record('cbpaid','submitted','REC-CBPAID','k-cbpaid-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('cbpaid','settled',null,'k-cbpaid-set')$$,'It settles');
select lives_ok($$select pg_temp.record('sched','submitted','REC-SCHED','k-sched-sub')$$,'A transfer is submitted and stays open');
select lives_ok($$select pg_temp.record('latefail','submitted','REC-LATEFAIL','k-latefail-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('latefail','failed',null,'k-latefail-failed')$$,'It fails');
select lives_ok($$select pg_temp.record('lateretry','submitted','REC-LATERETRY','k-lateretry-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('lateretry','failed',null,'k-lateretry-failed')$$,'It fails');

-- Unchanged: a payout the bank has not paid still blocks refunds and chargeback allocation.
reset role;
select is(private.money_refund_blocker(pg_temp.id('sched'),'pi_rec_sched',2000,0,0),'on_ach_statement','A refund waits for the bank outcome of a submitted transfer');
select is(private.money_refund_blocker(pg_temp.id('dup'),'pi_rec_dup',2000,0,0),'on_ach_statement','A refund waits while a transfer is prepared');
select is(private.money_refund_blocker(pg_temp.id('latefail'),'pi_rec_latefail',2000,0,0),'on_ach_statement','A refund waits while a transfer is failed');
select throws_ok(format($$insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,created_by,approved_by,policy_evidence,reason,business_key)
  values(%L,'pi_rec_sched',2000,0,0,'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Policy','Reason','k-direct-sched')$$,pg_temp.id('sched')),
  'P0001','Bank statement reconciliation required before refund','The refund guard still refuses a direct write while the transfer is scheduled');
select public.money_receive_event('evt_rec_sched_lost','dispute','{"dispute_id":"dp_rec_sched","payment_id":"pi_rec_sched","amount":1000,"currency":"usd","state":"lost"}');
select is(public.money_process_event('evt_rec_sched_lost'),'processed','A lost chargeback arrives while the transfer is submitted');
select is(private.money_chargeback_state_blocker('dp_rec_sched'),'on_ach_statement','Its allocation waits for the bank outcome');
select pg_temp.kernel_approve(jsonb_build_object('operation','chargeback','dispute','dp_rec_sched','service',1000,'tax',0,'tip',0,'reason','Kernel'));
select throws_ok($$select public.money_resolve_chargeback_loss('dp_rec_sched',1000,0,0,'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Kernel')$$,
  'P0001','Scheduled funds need their bank outcome or a withdrawal first; no automatic clawback','Even the kernel waits for the bank outcome');
select is(private.money_ach_unpaid_statement(pg_temp.id('refpaid')),false,'A settled statement is paid');
select is(private.money_ach_unpaid_statement(pg_temp.id('sched')),true,'A submitted statement is not paid');
select is(private.money_ach_unpaid_statement(pg_temp.id('other')),false,'No statement is not an unpaid statement');

-- 1. A customer refund after the payout settled: allowed, and the provider's share becomes owed.
select is(private.money_refund_blocker(pg_temp.id('refpaid'),'pi_rec_refpaid',2000,0,0),null,'A refund is allowed once the payout settled');
set local role authenticated;
insert into f values('refund-req',(public.money_operator_request_refund(pg_temp.id('refpaid'),'pi_rec_refpaid',2000,0,0,'Ticket 12','Partial rework after payout','k-refund-paid')->>'request_id')::uuid);
select pg_temp.review(pg_temp.id('refund-req'));
reset role;
select is(pg_temp.settle_refund('refpaid',2000),'processed','The refund settles at Stripe');
select is(private.money_payout_owed(pg_temp.id('refpaid')),1700::bigint,'The provider owes their share: 2000 less the 300 fee reduction');
set local role authenticated;
select is(pg_temp.row_of('refpaid')->'payout'->>'funds_state','paid','The payout still reads paid');
select is((pg_temp.row_of('refpaid')->'payout'->'recovery'->>'owed')::bigint,1700::bigint,'Reconciliation reads what the provider owes');
select is((pg_temp.row_of('refpaid')->'payout'->>'payable')::bigint,-1700::bigint,'Payable goes negative by the amount owed');
select is((pg_temp.row_of('refpaid')->'payout'->>'payable_ledger')::bigint,-1700::bigint,'The provider payable ledger agrees');
select is(pg_temp.row_of('refpaid')->'issues','[]'::jsonb,'A settled statement is not stale after a refund, and the payout reconciles');
select is((pg_temp.owes_exception('refpaid')->>'amount')::bigint,1700::bigint,'Reconciliation lists the amount owed as an exception');
select is((pg_temp.owed_of('refpaid')->>'owed')::bigint,1700::bigint,'The recovery queue lists the payout');
select is((pg_temp.owed_of('refpaid')->>'paid')::bigint,9500::bigint,'It shows what was paid');
select is((pg_temp.owed_of('refpaid')->>'refunded')::bigint,2000::bigint,'It shows what the customer was refunded');
select is(pg_temp.owed_of('refpaid')->>'payee_name','Synthetic recovery payee','It names the provider');
-- Owner decision: an amount owed does not hold the provider's other payouts.
select is((pg_temp.ready_of('other')->>'amount')::bigint,9500::bigint,'The provider''s other payout stays ready');

-- Recovery requests: access and validation.
select pg_temp.as_user('a8010000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.recover('refpaid','repayment',100,'k-rec-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot request a recovery');
select pg_temp.as_user('a8010000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.recover('refpaid','repayment',100,'k-rec-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a recovery');
select pg_temp.as_user('a8010000-0000-4000-8000-000000000002');
select throws_ok($$select pg_temp.recover('refpaid','netting',100,'k-rec-kind')$$,'22023','Recovery must be a repayment or a write-off','Netting is not a recovery');
select throws_ok($$select pg_temp.recover('refpaid','repayment',0,'k-rec-zero')$$,'22023','Recovery amount in cents required','A recovery needs an amount');
select throws_ok(format('select public.money_operator_request_payout_recovery(%L,%L,%s,%L,%L,%L)',pg_temp.id('refpaid'),'repayment',100,' ','Evidence','k-rec-v'),'22023','Reason of up to 1000 characters required','A recovery needs a reason');
select throws_ok(format('select public.money_operator_request_payout_recovery(%L,%L,%s,%L,%L,%L)',pg_temp.id('refpaid'),'repayment',100,'Reason',' ','k-rec-v'),'22023','Evidence of up to 1000 characters required','A recovery needs evidence');
select throws_ok(format('select public.money_operator_request_payout_recovery(%L,%L,%s,%L,%L,%L)',gen_random_uuid(),'repayment',100,'Reason','Evidence','k-rec-v'),'P0002','Finance obligation not found','An unknown payout is refused');
select throws_ok($$select pg_temp.recover('refpaid','repayment',1701,'k-rec-over')$$,'55000','Finance review not actionable: exceeds_owed','A recovery cannot exceed what is owed');
select throws_ok($$select pg_temp.recover('other','write_off',100,'k-rec-none')$$,'55000','Finance review not actionable: nothing_owed','Nothing owed, nothing to recover');
select throws_ok($$select public.money_operator_request_review('payout_recovery',gen_random_uuid()::text,'Reason','k-generic','Evidence')$$,'22023','Unsupported finance review','The generic review request does not take recoveries');

-- A part repayment: request, second-person approval, requester runs it.
insert into f values('repay-1',(public.money_operator_request_payout_recovery(pg_temp.id('refpaid'),'repayment',1000,' Provider repaid part ',' Bank credit REC-CR-1 from provider ','k-repay-1')->>'request_id')::uuid);
select is((public.money_operator_request_payout_recovery(pg_temp.id('refpaid'),'repayment',1000,'Provider repaid part','Bank credit REC-CR-1 from provider','k-repay-1')->>'replay')::boolean,true,'The same recovery and key replays, trimmed');
select throws_ok(format('select public.money_operator_request_payout_recovery(%L,%L,%s,%L,%L,%L)',pg_temp.id('refpaid'),'repayment',900,'Provider repaid part','Bank credit REC-CR-1 from provider','k-repay-1'),
  '23505','Review request idempotency conflict','The same key with another amount conflicts');
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('repay-1')),
  private.money_payout_recovery_command(pg_temp.id('refpaid'),'repayment',1000,1700,'Provider repaid part','Bank credit REC-CR-1 from provider','k-repay-1'),
  'The stored command is the kernel object, bound to the amount owed and the key');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('repay-1'))->'details'->>'kind','repayment','The approver sees the kind');
select is((pg_temp.request_of(pg_temp.id('repay-1'))->'details'->>'owed')::bigint,1700::bigint,'The approver sees the amount owed it was requested against');
select is((pg_temp.request_of(pg_temp.id('repay-1'))->'details'->>'owed_now')::bigint,1700::bigint,'The approver sees the amount owed now');
select is((pg_temp.owed_of('refpaid')->>'open_request_id')::uuid,pg_temp.id('repay-1'),'The payout points to its open recovery request');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('repay-1'),'Self'),'42501','A different finance operator must approve this command','The requester cannot approve the recovery');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('repay-1')),'42501','Separate authenticated approval of exact financial command required','An unapproved recovery cannot run');
select pg_temp.review(pg_temp.id('repay-1'));
select is(pg_temp.request_of(pg_temp.id('repay-1'))->>'state','executed','The recovery reads back done');
reset role;
select is((select kind||'/'||amount||'/'||owed_before||'/'||contractor_id||'/'||requested_by||'/'||approved_by from public.money_payout_recoveries where business_key='k-repay-1'),
  'repayment/1000/1700/a8020000-0000-4000-8000-000000000001/a8010000-0000-4000-8000-000000000002/a8010000-0000-4000-8000-000000000003','The recovery names its kind, amounts, provider and both operators');
select is((select kind||':'||(lines->0->>'account')||':'||(lines->0->>'debit')||':'||(lines->1->>'account')||':'||(lines->1->>'credit') from public.money_journals
  where business_key='payout-recovery:'||(select id from public.money_payout_recoveries where business_key='k-repay-1')),
  'payout_repayment:bank:1000:provider_payable:1000','A repayment debits the bank and credits the provider payable');
select is(private.money_payout_owed(pg_temp.id('refpaid')),700::bigint,'The provider owes the rest');
select throws_ok(format('update public.money_payout_recoveries set amount=1 where business_key=%L','k-repay-1'),'55000','Immutable financial evidence; append a correction','A recovery cannot be edited');
set local role authenticated;
select is(pg_temp.row_of('refpaid')->'issues','[]'::jsonb,'The repayment reconciles in the bank and payable ledgers');
select is((pg_temp.row_of('refpaid')->'payout'->'recovery'->>'repaid')::bigint,1000::bigint,'Reconciliation reads the repayment');

-- A request goes stale when the amount owed changes before it runs.
insert into f values('writeoff-stale',pg_temp.recover('refpaid','write_off',700,'k-writeoff-stale'));
select pg_temp.as_user('a8010000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('writeoff-stale'),'Checked'),'The write-off is approved');
select pg_temp.as_user('a8010000-0000-4000-8000-000000000002');
select pg_temp.review(pg_temp.recover('refpaid','repayment',200,'k-repay-2'));
select is(pg_temp.request_of(pg_temp.id('writeoff-stale'))->>'blocker','owed_changed','A repayment first makes the write-off stale');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('writeoff-stale')),'55000','Finance review not actionable: owed_changed','The stale write-off cannot run');
-- Mercurius absorbs the rest.
select pg_temp.review(pg_temp.recover('refpaid','write_off',500,'k-writeoff'));
reset role;
select is(private.money_payout_owed(pg_temp.id('refpaid')),0::bigint,'Nothing is owed after a repayment and a write-off');
select is(private.money_account_net(pg_temp.id('refpaid'),'provider_recovery_loss'),500::bigint,'The write-off is Mercurius''s recovery loss');
set local role authenticated;
select is(pg_temp.row_of('refpaid')->'issues','[]'::jsonb,'Refund, repayments and write-off reconcile');
select is(pg_temp.owes_exception('refpaid'),null,'No exception once nothing is owed');
select is(jsonb_array_length(pg_temp.owed_of('refpaid')->'recoveries'),3,'The queue keeps the recent recoveries');
select is((pg_temp.owed_of('refpaid')->'recoveries'->0->>'by_me')::boolean,true,'A recovery I requested reads back as mine');
select throws_ok($$select pg_temp.recover('refpaid','repayment',1,'k-rec-after')$$,'55000','Finance review not actionable: nothing_owed','Nothing more can be recovered');

-- The kernel: a reused approval replays; a changed amount owed is refused.
reset role;
select is(public.money_record_payout_recovery(pg_temp.id('refpaid'),'repayment',1000,1700,'k-repay-1','a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003',
  'Provider repaid part','Bank credit REC-CR-1 from provider'),(select id from public.money_payout_recoveries where business_key='k-repay-1'),'A reused approval replays the recorded recovery');
select pg_temp.kernel_approve(private.money_payout_recovery_command(pg_temp.id('refpaid'),'repayment',1000,1700,'Provider repaid part','Bank credit REC-CR-1 from provider','k-kernel-new'));
select throws_ok(format('select public.money_record_payout_recovery(%L,%L,%s,%s,%L,%L,%L,%L,%L)',pg_temp.id('refpaid'),'repayment',1000,1700,'k-kernel-new',
  'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Provider repaid part','Bank credit REC-CR-1 from provider'),
  'P0001','Amount owed changed since the recovery was requested','The kernel refuses an approval for an amount owed that changed');
select throws_ok(format('select public.money_record_payout_recovery(%L,%L,%s,%s,%L,%L,%L,%L,%L)',pg_temp.id('refpaid'),'repayment',1000,1700,'k-kernel-other',
  'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Provider repaid part','Bank credit REC-CR-1 from provider'),
  '42501','Separate authenticated approval of exact financial command required','The kernel refuses an unapproved command');
select pg_temp.kernel_approve(private.money_payout_recovery_command(pg_temp.id('cbpaid'),'write_off',900,0,'Too much','Kernel evidence','k-kernel-none'));
select throws_ok(format('select public.money_record_payout_recovery(%L,%L,%s,%s,%L,%L,%L,%L,%L)',pg_temp.id('cbpaid'),'write_off',900,0,'k-kernel-none',
  'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Too much','Kernel evidence'),
  'P0001','Recovery must be more than zero and at most the amount owed','The kernel refuses a recovery when nothing is owed');

-- 2. A lost chargeback after the payout settled: allocation runs and the provider's share is owed.
select public.money_receive_event('evt_rec_cb_lost','dispute','{"dispute_id":"dp_rec_cb","payment_id":"pi_rec_cbpaid","amount":1000,"currency":"usd","state":"lost"}');
select is(public.money_process_event('evt_rec_cb_lost'),'processed','A lost chargeback arrives on a paid payout');
select is(private.money_chargeback_state_blocker('dp_rec_cb'),null,'Its allocation is allowed once the payout settled');
set local role authenticated;
select lives_ok($$select pg_temp.review((public.money_operator_request_chargeback('dp_rec_cb',1000,0,0,'Synthetic loss after payout','k-cb-paid')->>'request_id')::uuid)$$,'The chargeback allocation runs');
reset role;
select is(private.money_payout_owed(pg_temp.id('cbpaid')),850::bigint,'The provider owes their share: 1000 less the 150 fee reduction');
set local role authenticated;
select is((pg_temp.owed_of('cbpaid')->>'chargebacks_lost')::bigint,1000::bigint,'The queue shows the lost chargeback');
select is(pg_temp.row_of('cbpaid')->'issues','[]'::jsonb,'The chargeback after payout reconciles');
select pg_temp.review(pg_temp.recover('cbpaid','write_off',850,'k-cb-writeoff'));
reset role;
select is(private.money_payout_owed(pg_temp.id('cbpaid')),0::bigint,'Mercurius absorbs the chargeback share');

-- 3. A duplicate payment: a withdrawn transfer the bank paid after its replacement also settled.
set local role authenticated;
insert into f values('att-dup',pg_temp.attempt_of('dup'));
select pg_temp.review(pg_temp.withdraw('dup','k-w-dup'));
select pg_temp.review(pg_temp.batch(current_date+7,array['dup'],'rec-w2'));
select lives_ok($$select pg_temp.record('dup','submitted','REC-DUP-2','k-dup2-sub')$$,'The replacement is submitted');
select lives_ok($$select pg_temp.record('dup','settled',null,'k-dup2-set')$$,'The replacement settles');
select is((pg_temp.withdrawn_of(pg_temp.id('att-dup'))->>'amount')::bigint,9500::bigint,'The withdrawn transfer is offered for a late payment');
select throws_ok(format('select public.money_operator_request_ach_late_settlement(%L,%L,%L,%L,%L)',pg_temp.attempt_of('dup'),'REC-DUP-X','Reason','Evidence','k-late-live'),
  '55000','Finance review not actionable: not_withdrawn','Only a withdrawn transfer takes a late payment');
select throws_ok(format('select public.money_operator_request_ach_late_settlement(%L,%L,%L,%L,%L)',pg_temp.id('att-dup'),'REC-DUP-2','Reason','Evidence','k-late-used'),
  '55000','Finance review not actionable: bank_reference_used','A reference recorded for another transfer is refused');
select throws_ok(format('select public.money_operator_request_ach_late_settlement(%L,%L,%L,%L,%L)',pg_temp.id('att-dup'),' ','Reason','Evidence','k-late-blank'),
  '22023','Bank reference of up to 200 characters required','A late payment needs the bank reference');
select throws_ok(format('select public.money_operator_request_ach_late_settlement(%L,%L,%L,%L,%L)',gen_random_uuid(),'REC-DUP-1','Reason','Evidence','k-late-none'),
  'P0002','Bank attempt not found','An unknown transfer is refused');
insert into f values('late-dup',pg_temp.late(pg_temp.id('att-dup'),' REC-DUP-1 ','k-late-dup'));
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('late-dup')),
  private.money_ach_late_settlement_command(pg_temp.id('att-dup'),'REC-DUP-1','Bank paid a withdrawn transfer','Statement line shows the payment to the provider'),
  'The stored command is the kernel object, with the trimmed reference');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('late-dup'))->'details'->>'previous_status','prepared','The approver sees what was withdrawn');
select is(pg_temp.request_of(pg_temp.id('late-dup'))->'details'->'replacement'->>'status','settled','The approver sees the replacement already settled');
select is((pg_temp.request_of(pg_temp.id('late-dup'))->'details'->>'amount')::bigint,9500::bigint,'The approver sees the amount paid');
select is(pg_temp.request_of(pg_temp.id('late-dup'))->'details'->>'bank_reference_hint','UP-1','The approver sees only the reference hint');
select is((pg_temp.withdrawn_of(pg_temp.id('att-dup'))->>'open_request_id')::uuid,pg_temp.id('late-dup'),'The withdrawn transfer points to its open request');
select pg_temp.review(pg_temp.id('late-dup'));
select is(pg_temp.request_of(pg_temp.id('late-dup'))->>'state','executed','The late payment reads back done');
reset role;
select is((select status from public.money_ach_attempts where id=pg_temp.id('att-dup')),'withdrawn','The withdrawn attempt is not changed');
select is((select amount||'/'||bank_reference||'/'||requested_by||'/'||approved_by from public.money_ach_late_settlements where attempt_id=pg_temp.id('att-dup')),
  '9500/REC-DUP-1/a8010000-0000-4000-8000-000000000002/a8010000-0000-4000-8000-000000000003','The late payment names amount, reference and both operators');
select is((select kind||':'||(lines->0->>'account')||':'||(lines->0->>'debit')||':'||(lines->1->>'account')||':'||(lines->1->>'credit') from public.money_journals
  where business_key='ach-late-settlement:'||pg_temp.id('att-dup')),'ach_late_settlement:provider_payable:9500:bank:9500','The late payment posts like a settlement');
select is(private.money_payout_owed(pg_temp.id('dup')),9500::bigint,'The provider owes the duplicate payment');
select throws_ok(format('update public.money_ach_late_settlements set amount=1 where attempt_id=%L',pg_temp.id('att-dup')),'55000','Immutable financial evidence; append a correction','A late payment cannot be edited');
set local role authenticated;
select is((pg_temp.row_of('dup')->'payout'->>'paid')::bigint,19000::bigint,'Reconciliation counts both payments');
select is((pg_temp.row_of('dup')->'payout'->'recovery'->>'late_settled')::bigint,9500::bigint,'Reconciliation reads the late payment');
select is(pg_temp.row_of('dup')->'issues','[]'::jsonb,'The duplicate payment reconciles');
select is(pg_temp.withdrawn_of(pg_temp.id('att-dup')),null,'The transfer is no longer offered for a late payment');
select is(pg_temp.item_of('dup',current_date)->'late_settlement'->>'bank_reference_hint','UP-1','The withdrawn transfer shows its late payment');
select throws_ok($$select pg_temp.late(pg_temp.id('att-dup'),'REC-DUP-9','k-late-again')$$,'55000','Finance review not actionable: completed','A second late payment is refused');
select pg_temp.review(pg_temp.recover('dup','repayment',9500,'k-dup-repay'));
reset role;
select is(private.money_payout_owed(pg_temp.id('dup')),0::bigint,'The provider repaid the duplicate');
select is(public.money_record_ach_late_settlement(pg_temp.id('att-dup'),'REC-DUP-1','a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003',
  'Bank paid a withdrawn transfer','Statement line shows the payment to the provider'),(select id from public.money_ach_late_settlements where attempt_id=pg_temp.id('att-dup')),
  'The kernel replays a recorded late payment');
select pg_temp.kernel_approve(private.money_ach_late_settlement_command(pg_temp.attempt_of('dup'),'REC-DUP-2','Kernel','Kernel evidence'));
select throws_ok(format('select public.money_record_ach_late_settlement(%L,%L,%L,%L,%L,%L)',pg_temp.attempt_of('dup'),'REC-DUP-2',
  'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','Kernel','Kernel evidence'),
  'P0001','Only a withdrawn transfer takes a late settlement; record other outcomes on the transfer','The kernel refuses a transfer that was not withdrawn');

-- 4. A late payment with no replacement: the payout is paid and can never go on a statement again.
set local role authenticated;
insert into f values('att-late',pg_temp.attempt_of('late'));
select pg_temp.review(pg_temp.withdraw('late','k-w-late'));
select is((pg_temp.ready_of('late')->>'amount')::bigint,9500::bigint,'The withdrawn payout is ready for a replacement');
insert into f values('batch-late',pg_temp.batch(current_date+14,array['late'],'rec-w3-late'));
select pg_temp.review(pg_temp.late(pg_temp.id('att-late'),'REC-LATE-1','k-late-late'));
select is(pg_temp.ready_of('late'),null,'Once the bank shows it paid, the payout is not ready');
select is(pg_temp.request_of(pg_temp.id('batch-late'))->>'blocker','already_paid','A batch requested before the late payment goes stale');
select throws_ok($$select pg_temp.batch(current_date+14,array['late'],'rec-w3-again')$$,'55000','Finance review not actionable: already_paid','A new batch is refused');
select is(pg_temp.row_of('late')->'payout'->>'funds_state','paid','Reconciliation reads the payout as paid');
select is(pg_temp.row_of('late')->'issues','[]'::jsonb,'The late payment reconciles');
select is((pg_temp.row_of('late')->'payout'->'recovery'->>'owed')::bigint,0::bigint,'Nothing is owed: the provider was paid once');
reset role;
select pg_temp.kernel_approve(private.money_ach_command(current_date+14,array[pg_temp.id('late')],'BANK-DIRECT','Direct kernel'));
select throws_ok($$select public.money_prepare_ach(current_date+14,array[pg_temp.id('late')],'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003','BANK-DIRECT','Direct kernel')$$,
  'P0001','Transfer would pay the provider more than this payout''s proceeds; it may already be paid','Even the kernel cannot pay a paid payout again');

-- 5. A late payment while a replacement waits to be sent: the replacement cannot be sent.
set local role authenticated;
insert into f values('att-latefail',pg_temp.attempt_of('latefail'));
select pg_temp.review(pg_temp.withdraw('latefail','k-w-latefail'));
select pg_temp.review(pg_temp.batch(current_date+21,array['latefail'],'rec-w4'));
select is(pg_temp.item_of('latefail',current_date+21)->>'submit_blocker',null,'The replacement can be sent before the late payment is known');
select throws_ok($$select pg_temp.late(pg_temp.id('att-latefail'),'REC-OTHER','k-late-conflict')$$,'55000','Finance review not actionable: bank_reference_conflict','A failed transfer keeps its recorded reference');
select pg_temp.review(pg_temp.late(pg_temp.id('att-latefail'),'REC-LATEFAIL','k-late-latefail'));
select is(pg_temp.item_of('latefail',current_date+21)->>'submit_blocker','already_paid','The replacement now reads already paid');
select throws_ok($$select pg_temp.record('latefail','submitted','REC-LATEFAIL-2','k-latefail2-sub')$$,'55000','Bank outcome not recordable: already_paid','Its submission is refused');
reset role;
select throws_ok(format('select public.money_record_ach(%L,%L,%L,%L,%L,%L)',pg_temp.attempt_of('latefail'),'submitted','REC-LATEFAIL-3','a8010000-0000-4000-8000-000000000002','Evidence','k-kernel-latefail'),
  'P0001','Transfer would pay the provider more than this payout''s proceeds; it may already be paid','Even the kernel cannot record it as sent');
set local role authenticated;
select is(pg_temp.item_of('latefail',current_date+21)->>'withdraw_blocker',null,'The unsent replacement can be withdrawn');
select pg_temp.review(pg_temp.withdraw('latefail','k-w-latefail-2'));
select is(pg_temp.row_of('latefail')->'payout'->>'funds_state','paid','With every statement withdrawn, the late payment reads paid');
select is(pg_temp.row_of('latefail')->'issues','[]'::jsonb,'It reconciles');

-- 6. A late payment on a withdrawn transfer whose replacement failed: the replacement is not retried.
insert into f values('att-lateretry',pg_temp.attempt_of('lateretry'));
select pg_temp.review(pg_temp.withdraw('lateretry','k-w-lateretry'));
select pg_temp.review(pg_temp.batch(current_date+28,array['lateretry'],'rec-w5'));
select lives_ok($$select pg_temp.record('lateretry','submitted','REC-LATERETRY-2','k-lateretry2-sub')$$,'The replacement is submitted');
select lives_ok($$select pg_temp.record('lateretry','failed',null,'k-lateretry2-failed')$$,'The replacement fails');
select pg_temp.review(pg_temp.late(pg_temp.id('att-lateretry'),'REC-LATERETRY','k-late-lateretry'));
select is(pg_temp.item_of('lateretry',current_date+28)->>'retry_blocker','already_paid','The failed replacement reads already paid');
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.attempt_of('lateretry'),'Retry','k-retry-paid'),'55000','Finance review not actionable: already_paid','Its retry is refused');
reset role;
select pg_temp.kernel_approve(private.money_ach_retry_command(pg_temp.item_id('lateretry')));
select throws_ok(format('select public.money_retry_ach(%L,%L,%L)',pg_temp.item_id('lateretry'),'a8010000-0000-4000-8000-000000000002','a8010000-0000-4000-8000-000000000003'),
  'P0001','Transfer would pay the provider more than this payout''s proceeds; it may already be paid','Even the retry kernel cannot pay it again');

-- Totals, and nothing sensitive in the readbacks.
set local role authenticated;
select is((public.money_finance_reconciliation()->'totals'->>'provider_owed')::bigint,
  (select coalesce(sum((v->>'owed')::bigint),0)::bigint from jsonb_array_elements(pg_temp.ops()->'recoveries'->'owed') v),'Reconciliation and the recovery queue agree on what providers owe');
select is((pg_temp.ops()->'recoveries'->>'owed_total')::bigint,(public.money_finance_reconciliation()->'totals'->>'provider_owed')::bigint,'The queue total matches reconciliation');
select is(position('REC-DUP-1' in pg_temp.ops()::text),0,'No full late payment reference is returned');
select is(position('REC-LATEFAIL' in pg_temp.ops()::text),0,'No full bank transaction reference is returned');
select is(position('rec-homeowner@example.invalid' in pg_temp.ops()::text),0,'No customer identity is returned');
select is(position('REC-DUP-1' in public.money_finance_reconciliation()::text),0,'Reconciliation returns no bank reference');

select * from finish();
rollback;
