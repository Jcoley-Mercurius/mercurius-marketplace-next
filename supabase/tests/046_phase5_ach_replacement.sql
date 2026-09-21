begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-079 synthetic fixtures only. Covers withdrawing a prepared, failed or returned transfer
-- from its weekly ACH statement through a two-operator review, and the replacement statement the
-- next weekly batch prepares for it. A payout is on at most one live statement; every "already on
-- a statement" guard now means a live one.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7910000-0000-4000-8000-000000000001','rep-homeowner@example.invalid',now()),
 ('a7910000-0000-4000-8000-000000000002','rep-operator-a@example.invalid',now()),
 ('a7910000-0000-4000-8000-000000000003','rep-operator-b@example.invalid',now()),
 ('a7910000-0000-4000-8000-000000000004','rep-plain-admin@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7910000-0000-4000-8000-000000000002','admin'),('a7910000-0000-4000-8000-000000000003','admin'),
 ('a7910000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','Synthetic test'),
 ('a7910000-0000-4000-8000-000000000003','a7910000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a7920000-0000-4000-8000-000000000001','Synthetic replacement payee',true,false),
 ('a7920000-0000-4000-8000-000000000002','Synthetic bank change payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a7930000-0000-4000-8000-000000000001','Synthetic replacement payee','Test','Payout','rep-payee-1@example.invalid','synthetic','a7920000-0000-4000-8000-000000000001'),
 ('a7930000-0000-4000-8000-000000000002','Synthetic bank change payee','Test','Payout','rep-payee-2@example.invalid','synthetic','a7920000-0000-4000-8000-000000000002');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,3,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id in ('a7930000-0000-4000-8000-000000000001','a7930000-0000-4000-8000-000000000002');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a7910000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id in ('a7920000-0000-4000-8000-000000000001','a7920000-0000-4000-8000-000000000002');

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
  perform pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a7910000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order for one payee whose homeowner confirmed completion that many hours ago.
create function pg_temp.new_order(label text,confirmed_hours integer,payee uuid) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a7910000-0000-4000-8000-000000000001',payee,'house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a7910000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-request',request),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_rep_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_rep_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_rep_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a7910000-0000-4000-8000-000000000001',payee,now()-make_interval(hours=>confirmed_hours));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- Operator B approves and operator A (the requester) runs a request.
create function pg_temp.review(p_request uuid) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
  perform public.money_operator_approve_review(p_request,'Synthetic second-person review');
  perform pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
  perform public.money_operator_execute_review(p_request);
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.batch(p_period date,labels text[],p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach(p_period,array(select pg_temp.id(l) from unnest(labels) l),'BANK-BATCH-'||p_key,'Synthetic weekly ACH',p_key)->>'request_id')::uuid $$;
-- The newest statement item of a payout (the one no other item replaces) and its latest attempt.
-- Fixture lookups only: they read as the database owner so steps can run as a signed-in operator.
create function pg_temp.item_id(label text) returns uuid language sql security definer as $$
 select i.id from public.money_ach_items i where i.obligation_id=pg_temp.id(label)
 and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) $$;
create function pg_temp.attempt_of(label text) returns uuid language sql security definer as $$
 select a.id from public.money_ach_attempts a where a.item_id=pg_temp.item_id(label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.record(label text,p_status text,p_ref text,p_key text) returns jsonb language sql as $$
 select public.money_operator_record_ach(pg_temp.attempt_of(label),p_status,p_ref,'Synthetic bank evidence '||p_status,p_key) $$;
create function pg_temp.withdraw(label text,p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach_withdrawal(pg_temp.attempt_of(label),'Synthetic withdrawal','Bank portal shows no transfer for this payout',p_key)->>'request_id')::uuid $$;
create function pg_temp.ops() returns jsonb language sql as $$ select public.money_finance_operations() $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.ready_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'ach'->'ready') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.batch_of(p_period date) returns jsonb language sql as $$
 select b from jsonb_array_elements(public.money_finance_operations()->'ach'->'batches') b where b->>'period_start'=to_char(p_period,'YYYY-MM-DD') $$;
create function pg_temp.item_of(label text,p_period date) returns jsonb language sql as $$
 select i from jsonb_array_elements(pg_temp.batch_of(p_period)->'items') i where i->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.row_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_reconciliation()->'obligations') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.payable_ok(label text) returns boolean language plpgsql as $$
begin
  perform public.money_payable(pg_temp.id(label));
  return true;
exception when others then return false;
end $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text),pg_temp.batch(date,text[],text),pg_temp.item_id(text),pg_temp.attempt_of(text),
  pg_temp.record(text,text,text,text),pg_temp.withdraw(text,text),pg_temp.review(uuid) to authenticated;

select pg_temp.new_order('prep',49,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('fail',50,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('ret',51,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('sub',52,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('unk',53,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('paid',54,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('refund',55,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('cb',56,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('bank1',49,'a7920000-0000-4000-8000-000000000002');
select pg_temp.new_order('bank2',50,'a7920000-0000-4000-8000-000000000002');
-- Used only by scripts/phase5-ach-replacement-concurrency.mjs.
select pg_temp.new_order('race_submit',49,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('race_submit_first',49,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('race_twice',49,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('race_retry',49,'a7920000-0000-4000-8000-000000000001');
select pg_temp.new_order('race_replace',49,'a7920000-0000-4000-8000-000000000001');
-- END CONCURRENCY SETUP

-- Grants: the request is the browser path; the kernel, helpers and withdrawal evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_request_ach_withdrawal(uuid,text,text,text)','execute'),true,'Signed-in users may call the withdrawal request');
select is(has_function_privilege('anon','public.money_operator_request_ach_withdrawal(uuid,text,text,text)','execute'),false,'Anonymous callers cannot request a withdrawal');
select is(has_function_privilege('authenticated','public.money_withdraw_ach(uuid,text,uuid,uuid,text,text)','execute'),false,'The withdrawal kernel is not a browser path');
select is(has_function_privilege('service_role','public.money_withdraw_ach(uuid,text,uuid,uuid,text,text)','execute'),true,'The withdrawal kernel is a service path, like the other ACH kernels');
select is(has_function_privilege('authenticated','private.money_ach_withdrawal_blocker(uuid,text)','execute'),false,'The withdrawal blocker stays closed');
select is(has_function_privilege('authenticated','private.money_ach_on_statement(uuid)','execute'),false,'The statement test stays closed');
select is(has_function_privilege('authenticated','private.money_ach_live_item(uuid)','execute'),false,'The live statement lookup stays closed');
select is(has_table_privilege('authenticated','public.money_ach_withdrawals','select'),false,'Browser roles cannot read withdrawals');
select is(has_table_privilege('service_role','public.money_ach_withdrawals','update'),false,'Withdrawals cannot be edited through the service role');

-- Prepare one batch with every payout this suite takes through a bank state.
set local role authenticated;
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
insert into f values('w1',pg_temp.batch(current_date,array['prep','fail','ret','sub','unk','paid','refund','cb','bank1','bank2'],'rep-w1'));
select pg_temp.review(pg_temp.id('w1'));
select lives_ok($$select pg_temp.record('fail','submitted','REP-FAIL','k-fail-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('fail','failed',null,'k-fail-failed')$$,'The transfer fails');
select lives_ok($$select pg_temp.record('ret','submitted','REP-RET','k-ret-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('ret','settled',null,'k-ret-settled')$$,'The transfer settles');
select lives_ok($$select pg_temp.record('ret','returned',null,'k-ret-returned')$$,'The transfer is returned');
select lives_ok($$select pg_temp.record('sub','submitted','REP-SUB','k-sub-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('unk','submitted','REP-UNK','k-unk-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('unk','unknown',null,'k-unk-unknown')$$,'Its outcome is unknown');
select lives_ok($$select pg_temp.record('paid','submitted','REP-PAID','k-paid-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('paid','settled',null,'k-paid-settled')$$,'The transfer settles');
select lives_ok($$select pg_temp.record('bank2','submitted','REP-BANK2','k-bank2-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('bank2','failed',null,'k-bank2-failed')$$,'The transfer fails');
insert into f values('item-prep',pg_temp.item_id('prep')),('att-prep',pg_temp.attempt_of('prep'));

-- Characterized before this slice: a payout on a statement stays blocked for refunds, holds,
-- chargebacks and later batches, with no path off the statement.
reset role;
select is(private.money_refund_blocker(pg_temp.id('refund'),'pi_rep_refund',2000,0,0),'on_ach_statement','A refund is refused while the payout is on a statement');
select public.money_receive_event('evt_rep_cb_lost','dispute','{"dispute_id":"dp_rep_cb","payment_id":"pi_rep_cb","amount":1000,"currency":"usd","state":"lost"}');
select is(public.money_process_event('evt_rep_cb_lost'),'processed','A lost chargeback arrives for a scheduled payout');
select is(private.money_chargeback_state_blocker('dp_rep_cb'),'on_ach_statement','Its allocation is refused while the payout is on a statement');
set local role authenticated;
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('prep'),'Complaint','Synthetic ticket','k-hold-before')$$,'55000','Payout already on an ACH statement; a hold cannot stop it','A hold is refused while the payout is on a statement');
select throws_ok($$select pg_temp.batch(current_date+7,array['prep'],'rep-again')$$,'55000','Finance review not actionable: on_ach_statement','A second batch is refused while the payout is on a statement');
reset role;
select pg_temp.kernel_approve(private.money_ach_command(current_date+7,array[pg_temp.id('prep')],'BANK-DIRECT','Direct kernel'));
select throws_ok($$select public.money_prepare_ach(current_date+7,array[pg_temp.id('prep')],'a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','BANK-DIRECT','Direct kernel')$$,
  'P0001','Payout already on an ACH statement; withdraw its transfer before a replacement','Even the kernel cannot put a payout on a second live statement');
select throws_ok(format($$insert into public.money_ach_items(batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id,replaces_item_id)
  select batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id,%L from public.money_ach_items where id=%L$$,gen_random_uuid(),pg_temp.id('item-prep')),
  'P0001','Payout already on an ACH statement; withdraw its transfer before a replacement','A direct insert cannot add a second live statement');

-- Access and validation.
set local role authenticated;
select pg_temp.as_user('a7910000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.withdraw('prep','k-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot request a withdrawal');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.withdraw('prep','k-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a withdrawal');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
select throws_ok(format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',pg_temp.id('att-prep'),' ','Evidence','k-v'),'22023','Reason of up to 1000 characters required','A withdrawal needs a reason');
select throws_ok(format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',pg_temp.id('att-prep'),'Reason',' ','k-v'),'22023','Evidence of up to 1000 characters required','A withdrawal needs bank evidence');
select throws_ok(format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',pg_temp.id('att-prep'),'Reason','Evidence',''),'22023','Idempotency key required','A withdrawal needs a key');
select throws_ok(format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',gen_random_uuid(),'Reason','Evidence','k-v'),'P0002','Bank attempt not found','An unknown transfer is refused');
select throws_ok($$select public.money_operator_request_review('ach_withdrawal',gen_random_uuid()::text,'Reason','k-generic','Evidence')$$,'22023','Unsupported finance review','The generic review request does not take withdrawals');

-- The bank may hold a submitted, unknown or settled transfer, so none of them can be withdrawn.
select throws_ok($$select pg_temp.withdraw('sub','k-w-sub')$$,'55000','Finance review not actionable: bank_outcome_open','A submitted transfer cannot be withdrawn');
select throws_ok($$select pg_temp.withdraw('unk','k-w-unk')$$,'55000','Finance review not actionable: bank_outcome_open','A transfer with an unknown outcome cannot be withdrawn');
select throws_ok($$select pg_temp.withdraw('paid','k-w-paid')$$,'55000','Finance review not actionable: paid','A settled transfer cannot be withdrawn');
select is(pg_temp.item_of('sub',current_date)->>'withdraw_blocker',null,'A submitted transfer offers no withdrawal in the readback');
select is(pg_temp.item_of('paid',current_date) ? 'withdraw_blocker',true,'Every transfer reads back its withdrawal field');
select is(pg_temp.item_of('prep',current_date)->>'withdraw_blocker',null,'A prepared transfer can be withdrawn');
select is(pg_temp.item_of('fail',current_date)->>'withdraw_blocker',null,'A failed transfer can be withdrawn');
select is(pg_temp.item_of('ret',current_date)->>'withdraw_blocker',null,'A returned transfer can be withdrawn');

-- A prepared transfer: request, second-person approval, requester runs it.
insert into f values('wd-prep',(public.money_operator_request_ach_withdrawal(pg_temp.id('att-prep'),' Customer refund agreed before sending ',' Bank portal: no ACH line for this payee this week ','k-wd-prep')->>'request_id')::uuid);
select is((public.money_operator_request_ach_withdrawal(pg_temp.id('att-prep'),'Customer refund agreed before sending','Bank portal: no ACH line for this payee this week','k-wd-prep')->>'replay')::boolean,true,'The same withdrawal and key replays, trimmed');
select throws_ok(format('select public.money_operator_request_ach_withdrawal(%L,%L,%L,%L)',pg_temp.id('att-prep'),'Customer refund agreed before sending','Other evidence','k-wd-prep'),'23505','Review request idempotency conflict','The same key with other evidence conflicts');
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('wd-prep')),
  private.money_ach_withdrawal_command(pg_temp.id('att-prep'),'prepared','Customer refund agreed before sending','Bank portal: no ACH line for this payee this week'),
  'The stored command is the kernel object, bound to the prepared status');
select is((select subject||'/'||obligation_id||'/'||evidence from public.money_review_requests where id=pg_temp.id('wd-prep')),
  pg_temp.id('att-prep')||'/'||pg_temp.id('prep')||'/Bank portal: no ACH line for this payee this week','The request names the transfer, its payout and the bank evidence');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('wd-prep'))->>'state','awaiting_approval','The withdrawal waits for a second operator');
select is(pg_temp.request_of(pg_temp.id('wd-prep'))->'details'->>'status','prepared','The approver sees the status being withdrawn');
select is((pg_temp.request_of(pg_temp.id('wd-prep'))->'details'->>'amount')::bigint,9500::bigint,'The approver sees the statement amount');
select is(pg_temp.request_of(pg_temp.id('wd-prep'))->'details'->>'period_start',to_char(current_date,'YYYY-MM-DD'),'The approver sees the statement week');
select is(pg_temp.request_of(pg_temp.id('wd-prep'))->'details'->>'payee_name','Synthetic replacement payee','The approver sees the payee');
select is(pg_temp.item_of('prep',current_date)->>'open_withdrawal_request_id',pg_temp.id('wd-prep')::text,'The transfer points to its open withdrawal request');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('wd-prep'),'Self'),'42501','A different finance operator must approve this command','The requester cannot approve the withdrawal');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('wd-prep')),'42501','Separate authenticated approval of exact financial command required','An unapproved withdrawal cannot run');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('wd-prep'),'Checked the bank portal myself'),'A second operator approves the withdrawal');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('wd-prep')),'42501','Only the requesting finance operator can execute this command','The approver cannot run the withdrawal');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
select is(public.money_operator_execute_review(pg_temp.id('wd-prep'))->>'replay','false','The requester runs the withdrawal');
select is(public.money_operator_execute_review(pg_temp.id('wd-prep'))->>'replay','true','Running it again replays');
reset role;
select is((select status from public.money_ach_attempts where id=pg_temp.id('att-prep')),'withdrawn','The transfer is withdrawn');
select is((select previous_status||'/'||requested_by||'/'||approved_by||'/'||reason from public.money_ach_withdrawals where attempt_id=pg_temp.id('att-prep')),
  'prepared/a7910000-0000-4000-8000-000000000002/a7910000-0000-4000-8000-000000000003/Customer refund agreed before sending','The withdrawal names status, requester, approver and reason');
select is((select previous_status||'>'||status||'/'||business_key from public.money_ach_events where attempt_id=pg_temp.id('att-prep')),
  'prepared>withdrawn/ach-withdrawal:'||pg_temp.id('att-prep'),'The bank history records the withdrawal');
select is((select count(*) from public.money_journals where obligation_id=pg_temp.id('prep') and kind like 'ach_%'),0::bigint,'A withdrawal posts no journal');
select is(pg_temp.payable_ok('prep'),true,'The kernel still finds the payout payable');
select throws_ok(format('update public.money_ach_withdrawals set reason=%L where attempt_id=%L','Changed',pg_temp.id('att-prep')),'55000','Immutable financial evidence; append a correction','A withdrawal cannot be edited');

-- A withdrawn transfer takes no bank outcome, retry or second withdrawal, even through the kernels.
select throws_ok(format('select public.money_record_ach(%L,%L,%L,%L,%L,%L)',pg_temp.id('att-prep'),'submitted','REP-LATE','a7910000-0000-4000-8000-000000000002','Evidence','k-kernel-late'),'P0001','Invalid bank transition','The bank outcome kernel refuses a withdrawn transfer');
select pg_temp.kernel_approve(private.money_ach_retry_command(pg_temp.id('item-prep')));
select throws_ok(format('select public.money_retry_ach(%L,%L,%L)',pg_temp.id('item-prep'),'a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003'),'P0001','Bank outcome unresolved or already paid; do not resend','The retry kernel refuses a withdrawn transfer');
set local role authenticated;
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-prep'),'submitted','REP-LATE','Evidence','k-late'),'55000','Bank outcome not recordable: withdrawn','A withdrawn transfer cannot be submitted');
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.id('att-prep'),'Retry','k-retry-withdrawn'),'55000','Finance review not actionable: withdrawn','A withdrawn transfer cannot be retried');
select throws_ok($$select pg_temp.withdraw('prep','k-w-again')$$,'55000','Finance review not actionable: completed','A withdrawn transfer cannot be withdrawn again');
select is(pg_temp.request_of(pg_temp.id('wd-prep'))->>'state','executed','The withdrawal reads back done');
select is(pg_temp.item_of('prep',current_date)->>'status','withdrawn','The transfer reads back withdrawn');
select is(pg_temp.item_of('prep',current_date)->'withdrawal'->>'previous_status','prepared','The withdrawal reads back what was withdrawn');
select is((pg_temp.item_of('prep',current_date)->'withdrawal'->>'by_me')::boolean,true,'The withdrawal reads back as mine');
select is(pg_temp.item_of('prep',current_date)->>'retry_blocker',null,'A withdrawn transfer offers no retry');
select is((pg_temp.batch_of(current_date)->>'withdrawn_total')::bigint,9500::bigint,'The batch reads back what was withdrawn from it');

-- Off the statement: the payout is ready again, can be held, and reconciles as eligible.
select is((pg_temp.ready_of('prep')->>'amount')::bigint,9500::bigint,'The withdrawn payout is ready for a later batch');
select is(pg_temp.ready_of('prep')->'replaces'->>'period_start',to_char(current_date,'YYYY-MM-DD'),'It says which statement it replaces');
select is(pg_temp.ready_of('prep')->'replaces'->>'previous_status','prepared','It says what was withdrawn');
select is(pg_temp.row_of('prep')->'payout'->>'funds_state','eligible','Reconciliation reads the withdrawn payout as eligible');
select is(pg_temp.row_of('prep')->'payout'->'statement','null'::jsonb,'Reconciliation shows no live statement');
select is((pg_temp.row_of('prep')->'payout'->>'withdrawn_statements')::integer,1,'Reconciliation counts the withdrawn statement');
select is(pg_temp.row_of('prep')->'issues','[]'::jsonb,'The withdrawn payout reconciles');
insert into f values('hold-after',(public.money_operator_place_hold(pg_temp.id('prep'),'Complaint','Synthetic ticket','k-hold-after')->>'hold_id')::uuid);
select ok(pg_temp.id('hold-after') is not null,'A hold can be placed once the transfer is withdrawn');
select is(pg_temp.ready_of('prep'),null,'The held payout is not ready');
select lives_ok($$select public.money_operator_release_hold(pg_temp.id('hold-after'),'Cleared','Synthetic ticket closed')$$,'One operator releases the hold');

-- The replacement statement: the next weekly batch prepares it through the unchanged kernel.
insert into f values('w2',pg_temp.batch(current_date+7,array['prep'],'rep-w2'));
select is(pg_temp.request_of(pg_temp.id('w2'))->'details'->'items'->0->'replaces'->>'period_start',to_char(current_date,'YYYY-MM-DD'),'The approver sees the statement being replaced');
select pg_temp.review(pg_temp.id('w2'));
reset role;
select is((select replaces_item_id from public.money_ach_items where id=pg_temp.item_id('prep')),pg_temp.id('item-prep'),'The replacement names the withdrawn statement');
select is((select count(*) from public.money_ach_items where obligation_id=pg_temp.id('prep')),2::bigint,'The payout has two statement items');
select is(private.money_ach_live_item(pg_temp.id('prep')),pg_temp.item_id('prep'),'Only the replacement is live');
select is((select a.status||':'||a.attempt_number||':'||i.amount from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id where a.id=pg_temp.attempt_of('prep')),'prepared:1:9500','The replacement has a prepared first attempt at the current amount');
select throws_ok(format($$insert into public.money_ach_items(batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id,replaces_item_id)
  select batch_id,obligation_id,contractor_id,snapshot_id,service_retained,tip_retained,platform_fee,amount,confirmation_ref,bank_evidence_id,%L from public.money_ach_items where id=%L$$,pg_temp.id('item-prep'),pg_temp.item_id('prep')),
  'P0001','Payout already on an ACH statement; withdraw its transfer before a replacement','A second replacement of the same statement is refused');
set local role authenticated;
select is(pg_temp.ready_of('prep'),null,'The replaced payout is no longer ready');
select is(pg_temp.item_of('prep',current_date)->>'replaced_in',to_char(current_date+7,'YYYY-MM-DD'),'The withdrawn item says where it was replaced');
select is(pg_temp.item_of('prep',current_date+7)->>'replaces_period',to_char(current_date,'YYYY-MM-DD'),'The replacement says which week it replaces');
select is(pg_temp.row_of('prep')->'payout'->>'funds_state','scheduled','Reconciliation reads the replacement as scheduled');
select is(pg_temp.row_of('prep')->'payout'->'statement'->>'period_start',to_char(current_date+7,'YYYY-MM-DD'),'Reconciliation reads the replacement statement');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('prep'),'Complaint','Synthetic ticket','k-hold-replaced')$$,'55000','Payout already on an ACH statement; a hold cannot stop it','The replacement is a live statement again');
select lives_ok($$select pg_temp.record('prep','submitted','REP-PREP-2','k-prep-sub')$$,'The replacement is submitted');
select lives_ok($$select pg_temp.record('prep','settled',null,'k-prep-settled')$$,'The replacement settles');
select is(pg_temp.row_of('prep')->'payout'->>'funds_state','paid','The replaced payout is paid once');
select is((pg_temp.row_of('prep')->'payout'->>'paid')::bigint,9500::bigint,'Only the replacement counts as paid');
select is(pg_temp.row_of('prep')->'issues','[]'::jsonb,'The paid replacement reconciles');

-- A returned transfer: settlement, return, withdrawal and a settled replacement pay the provider once.
select lives_ok($$select pg_temp.review(pg_temp.withdraw('ret','k-w-ret'))$$,'A returned transfer is withdrawn after review');
reset role;
select is((select count(*) from public.money_journals where obligation_id=pg_temp.id('ret') and kind like 'ach_%'),2::bigint,'The withdrawal adds no journal to the settlement and its return');
set local role authenticated;
select is(pg_temp.row_of('ret')->'payout'->>'funds_state','eligible','The returned, withdrawn payout is eligible again');
select lives_ok($$select pg_temp.review(pg_temp.batch(current_date+14,array['ret'],'rep-w3'))$$,'The returned payout goes on a replacement statement');
select lives_ok($$select pg_temp.record('ret','submitted','REP-RET-2','k-ret2-sub')$$,'The replacement is submitted');
select lives_ok($$select pg_temp.record('ret','settled',null,'k-ret2-settled')$$,'The replacement settles');
select is((pg_temp.row_of('ret')->'payout'->>'paid')::bigint-(pg_temp.row_of('ret')->'payout'->>'returned')::bigint,9500::bigint,'Net paid is one payout');
select is((pg_temp.row_of('ret')->'payout'->>'payable_ledger')::bigint,0::bigint,'The provider payable is cleared');
select is(pg_temp.row_of('ret')->'issues','[]'::jsonb,'Two statements, one return and one withdrawal reconcile');

-- A refund after withdrawal changes the amount; the replacement pays the new amount.
select lives_ok($$select pg_temp.review(pg_temp.withdraw('refund','k-w-refund'))$$,'A prepared transfer is withdrawn for a refund');
reset role;
select is(private.money_refund_blocker(pg_temp.id('refund'),'pi_rep_refund',2000,0,0),null,'A refund is allowed once the transfer is withdrawn');
set local role authenticated;
insert into f values('refund-req',(public.money_operator_request_refund(pg_temp.id('refund'),'pi_rep_refund',2000,0,0,'Ticket 9','Partial rework','k-refund')->>'request_id')::uuid);
select pg_temp.review(pg_temp.id('refund-req'));
reset role;
select public.money_prepare_refund((select id from public.money_refund_authorizations where obligation_id=pg_temp.id('refund')),'a7910000-0000-4000-8000-000000000002');
select public.money_receive_event('evt_rep_refund_settled','refund',jsonb_build_object('authorization_id',(select id from public.money_refund_authorizations where obligation_id=pg_temp.id('refund')),
  'refund_id','re_rep_refund','payment_id','pi_rep_refund','amount',2000,'currency','usd'));
select is(public.money_process_event('evt_rep_refund_settled'),'processed','The refund settles');
set local role authenticated;
select is((pg_temp.ready_of('refund')->>'amount')::bigint,7800::bigint,'The payout is ready at its reduced amount');
select is((pg_temp.ready_of('refund')->'replaces'->>'amount')::bigint,9500::bigint,'It shows the withdrawn statement amount');
select lives_ok($$select pg_temp.review(pg_temp.batch(current_date+21,array['refund'],'rep-w4'))$$,'The reduced payout goes on a replacement statement');
reset role;
select is((select amount from public.money_ach_items where id=pg_temp.item_id('refund')),7800::bigint,'The replacement statement pays the reduced amount');
set local role authenticated;
select is(pg_temp.row_of('refund')->'issues','[]'::jsonb,'The refunded replacement reconciles');

-- A lost chargeback can be allocated once the transfer is withdrawn.
select lives_ok($$select pg_temp.review(pg_temp.withdraw('cb','k-w-cb'))$$,'A prepared transfer is withdrawn for a chargeback');
reset role;
select is(private.money_chargeback_state_blocker('dp_rep_cb'),null,'The chargeback can be allocated once the transfer is withdrawn');
set local role authenticated;
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
select lives_ok($$select pg_temp.review((public.money_operator_request_chargeback('dp_rep_cb',1000,0,0,'Synthetic loss allocation','k-cb')->>'request_id')::uuid)$$,'The chargeback allocation runs');
reset role;
select is((select service from public.money_chargeback_resolutions where dispute_id='dp_rep_cb'),1000::bigint,'The loss is allocated to the retained service');

-- A changed bank authorization: a prepared and a failed transfer are withdrawn and replaced with
-- the new authorization, which a retry could not do.
insert into f select 'bank-old',id from public.vendor_compliance_evidence where contractor_id='a7920000-0000-4000-8000-000000000002' and kind='bank_authorization';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by,supersedes)
 select contractor_id,application_version_id,'bank_authorization','bank_authorization-v2','Synthetic new bank form',now()-interval '1 hour',now()+interval '1 year','a7910000-0000-4000-8000-000000000003',id
 from public.vendor_compliance_evidence where id=pg_temp.id('bank-old');
set local role authenticated;
select is(pg_temp.item_of('bank1',current_date)->>'submit_blocker','bank_authorization_changed','The prepared transfer cannot be sent to the old account');
select is(pg_temp.item_of('bank2',current_date)->>'retry_blocker','bank_authorization_changed','The failed transfer cannot be retried to the old account');
select is(pg_temp.item_of('bank1',current_date)->>'withdraw_blocker',null,'The prepared transfer can be withdrawn');
select is(pg_temp.item_of('bank2',current_date)->>'withdraw_blocker',null,'The failed transfer can be withdrawn');
insert into f values('wd-bank2',pg_temp.withdraw('bank2','k-w-bank2'));
select is(pg_temp.request_of(pg_temp.id('wd-bank2'))->'details'->>'bank_evidence','Synthetic bank evidence failed','The approver sees the recorded failure');
select is(pg_temp.request_of(pg_temp.id('wd-bank2'))->'details'->>'bank_reference_hint','ANK2','The approver sees only the reference hint');
select pg_temp.review(pg_temp.id('wd-bank2'));
select pg_temp.review(pg_temp.withdraw('bank1','k-w-bank1'));
select lives_ok($$select pg_temp.review(pg_temp.batch(current_date+28,array['bank1','bank2'],'rep-w5'))$$,'Both payouts go on replacement statements');
reset role;
select is((select count(*) from public.money_ach_items i where i.obligation_id in (pg_temp.id('bank1'),pg_temp.id('bank2')) and i.replaces_item_id is not null
  and i.bank_evidence_id<>pg_temp.id('bank-old')),2::bigint,'The replacements use the new bank authorization');
set local role authenticated;
select is(pg_temp.item_of('bank1',current_date+28)->>'submit_blocker',null,'The replacement can be sent');

-- A withdrawal request goes stale when the transfer moves on before it runs.
insert into f values('wd-fail',pg_temp.withdraw('fail','k-w-fail'));
insert into f values('att-fail1',pg_temp.attempt_of('fail'));
insert into f values('retry-fail',(public.money_operator_request_ach_retry(pg_temp.attempt_of('fail'),'Retry to same account','k-retry-fail')->>'request_id')::uuid);
select pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('wd-fail'),'Checked'),'The withdrawal is approved');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
select pg_temp.review(pg_temp.id('retry-fail'));
select is(pg_temp.request_of(pg_temp.id('wd-fail'))->>'blocker','completed','A retried transfer makes its withdrawal stale');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('wd-fail')),'55000','Finance review not actionable: completed','The stale withdrawal cannot run');
insert into f values('wd-fail2',pg_temp.withdraw('fail','k-w-fail2'));
select lives_ok($$select pg_temp.record('fail','submitted','REP-FAIL-2','k-fail2-sub')$$,'The retry is submitted before the new withdrawal runs');
select is(pg_temp.request_of(pg_temp.id('wd-fail2'))->>'blocker','status_changed','A submission makes the withdrawal of a prepared transfer stale');
select pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('wd-fail2'),'Checked'),'55000','Finance review not actionable: status_changed','The stale withdrawal cannot be approved');

-- The kernel binds the status it was approved for.
reset role;
select pg_temp.kernel_approve(private.money_ach_withdrawal_command(pg_temp.attempt_of('sub'),'submitted','Kernel','Kernel evidence'));
select throws_ok(format('select public.money_withdraw_ach(%L,%L,%L,%L,%L,%L)',pg_temp.attempt_of('sub'),'submitted','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','Kernel','Kernel evidence'),
  'P0001','Only an unsent, failed or returned transfer can be withdrawn; the bank may hold this one','The kernel refuses a submitted transfer');
select pg_temp.kernel_approve(private.money_ach_withdrawal_command(pg_temp.attempt_of('sub'),'prepared','Kernel','Kernel evidence'));
select throws_ok(format('select public.money_withdraw_ach(%L,%L,%L,%L,%L,%L)',pg_temp.attempt_of('sub'),'prepared','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','Kernel','Kernel evidence'),
  'P0001','Bank status changed since the withdrawal was requested','The kernel refuses an approval for another status');
select throws_ok(format('select public.money_withdraw_ach(%L,%L,%L,%L,%L,%L)',pg_temp.attempt_of('sub'),'prepared','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','Kernel','Other evidence'),
  '42501','Separate authenticated approval of exact financial command required','The kernel refuses an unapproved command');
select is(public.money_withdraw_ach(pg_temp.id('att-prep'),'prepared','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003',
  'Customer refund agreed before sending','Bank portal: no ACH line for this payee this week'),(select id from public.money_ach_withdrawals where attempt_id=pg_temp.id('att-prep')),'The kernel replays a recorded withdrawal');

select pg_temp.kernel_approve(private.money_ach_withdrawal_command(pg_temp.id('att-prep'),'prepared','Other reason','Bank portal: no ACH line for this payee this week'));
select throws_ok(format('select public.money_withdraw_ach(%L,%L,%L,%L,%L,%L)',pg_temp.id('att-prep'),'prepared','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003',
  'Other reason','Bank portal: no ACH line for this payee this week'),'P0001','ACH withdrawal idempotency conflict','The kernel refuses a different withdrawal of the same transfer');
select pg_temp.kernel_approve(private.money_ach_withdrawal_command(pg_temp.id('att-fail1'),'failed','Kernel','Kernel evidence'));
select throws_ok(format('select public.money_withdraw_ach(%L,%L,%L,%L,%L,%L)',pg_temp.id('att-fail1'),'failed','a7910000-0000-4000-8000-000000000002','a7910000-0000-4000-8000-000000000003','Kernel','Kernel evidence'),
  'P0001','Only the latest transfer of a statement can be withdrawn','The kernel refuses a transfer that was already retried');

-- An expired withdrawal cannot be approved.
set local role authenticated;
select pg_temp.as_user('a7910000-0000-4000-8000-000000000002');
reset role;
alter table public.money_review_requests disable trigger immutable_evidence;
update public.money_review_requests set created_at=now()-interval '25 hours' where id=pg_temp.id('wd-fail2');
alter table public.money_review_requests enable trigger immutable_evidence;
set local role authenticated;
select pg_temp.as_user('a7910000-0000-4000-8000-000000000003');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('wd-fail2'),'Checked'),'55000','Finance review request expired; request it again','An expired withdrawal cannot be approved');

-- No gateway path returned a full bank reference or a customer identity.
select is(position('REP-BANK2' in pg_temp.ops()::text),0,'No full bank transaction reference is returned');
select is(position('rep-homeowner@example.invalid' in pg_temp.ops()::text),0,'No customer identity is returned');

select * from finish();
rollback;
