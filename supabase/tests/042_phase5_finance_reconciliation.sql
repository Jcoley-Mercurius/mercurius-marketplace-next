begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-075 synthetic fixtures only. Covers the finance reconciliation readback: access,
-- charge/refund/earnings/payout reconciliation, funds state parity with money_payable,
-- the exceptions queue and detection of tampered ledger or counters.
-- Kernel entry points moved behind adapters are granted temporarily, as 020 does.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7510000-0000-4000-8000-000000000001','finance-homeowner@example.invalid',now()),
 ('a7510000-0000-4000-8000-000000000002','finance-operator@example.invalid',now()),
 ('a7510000-0000-4000-8000-000000000003','finance-reviewer@example.invalid',now()),
 ('a7510000-0000-4000-8000-000000000004','finance-plain-admin@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7510000-0000-4000-8000-000000000002','admin'),('a7510000-0000-4000-8000-000000000003','admin'),
 ('a7510000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003','Synthetic test'),
 ('a7510000-0000-4000-8000-000000000003','a7510000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a7520000-0000-4000-8000-000000000001','Synthetic payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('a7530000-0000-4000-8000-000000000001','Synthetic payee','Test','Finance','finance-payee@example.invalid','synthetic','a7520000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 values('a7520000-0000-4000-8000-000000000001',
   (select id from public.vendor_application_versions where application_id='a7530000-0000-4000-8000-000000000001'),3,'active');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a7510000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a7520000-0000-4000-8000-000000000001';

create temp table f(key text primary key,id uuid);
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_user)::text,true) $$;
create function pg_temp.approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('a7510000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a7510000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- One synthetic order: reviewed snapshot, captured payment and, when given, a homeowner
-- confirmation that many hours ago.
create function pg_temp.new_order(label text,mode text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a7510000-0000-4000-8000-000000000001','a7520000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a7510000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,mode);
  insert into f values(label||'-request',request),(label||'-attempt',attempt.id),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  if confirmed_hours is not null then
    update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
    insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
      values(request,'a7510000-0000-4000-8000-000000000001','a7520000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  end if;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.readback() returns jsonb language sql as $$ select public.money_finance_reconciliation() $$;
create function pg_temp.row_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_reconciliation()->'obligations') v where v->>'obligation_id'=(select id::text from f where key=label) $$;
create function pg_temp.exceptions(p_kind text,label text) returns bigint language sql as $$
 select count(*) from jsonb_array_elements(public.money_finance_reconciliation()->'exceptions') e
 where e->>'kind'=p_kind and (label is null or e->>'obligation_id'=(select id::text from f where key=label)) $$;
create function pg_temp.payable_ok(label text) returns boolean language plpgsql as $$
begin
  perform public.money_payable((select id from f where key=label));
  return true;
exception when others then return false;
end $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;

-- Access: restricted finance authority only.
select throws_ok($$select public.money_finance_reconciliation()$$,'42501','Restricted finance authority required','No signed-in user is refused');
select pg_temp.as_user('a7510000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.money_finance_reconciliation()$$,'42501','Restricted finance authority required','A homeowner is refused');
select pg_temp.as_user('a7510000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_finance_reconciliation()$$,'42501','Restricted finance authority required','An admin without finance authority is refused');
select throws_ok($$select private.money_obligation_reconciliation(null,now())$$,'42501',null,'Browser roles cannot call the private row builder');
select pg_temp.as_user('a7510000-0000-4000-8000-000000000002');
select lives_ok($$select public.money_finance_reconciliation()$$,'A finance operator reads the reconciliation');
reset role;
select is(has_function_privilege('anon','public.money_finance_reconciliation()','execute'),false,'Anonymous callers hold no execute grant');
select is((pg_temp.readback()->>'obligation_count')::integer,0,'Empty ledger reads back empty');

-- A: full payment, confirmed 49 hours ago, active payee with current payout onboarding.
select pg_temp.new_order('clean','full',49);
select is(pg_temp.row_of('clean')->'issues','[]'::jsonb,'Clean full payment reconciles with no issues');
select is((pg_temp.row_of('clean')->'charges'->>'captured')::bigint,11700::bigint,'Captured charge read back');
select is((pg_temp.row_of('clean')->'charges'->>'ledger_captured')::bigint,11700::bigint,'Capture journals agree with the counter');
select is(pg_temp.row_of('clean')->'charges'->'payments'->0->>'payment_id','pi_clean','Stripe payment ID is available to find the charge');
select is((pg_temp.row_of('clean')->'earnings'->>'platform_fee')::bigint,1500::bigint,'Fee is 15 percent of subtotal, excluding tax and tip');
select is((pg_temp.row_of('clean')->'earnings'->>'platform_fee_ledger')::bigint,1500::bigint,'Ledger platform revenue agrees');
select is((pg_temp.row_of('clean')->'earnings'->>'tax_ledger')::bigint,700::bigint,'Tax liability tracked separately');
select is((pg_temp.row_of('clean')->'earnings'->>'provider_proceeds')::bigint,9500::bigint,'Proceeds are 85 percent of service plus all tips');
select is((pg_temp.row_of('clean')->'payout'->>'payable_ledger')::bigint,9500::bigint,'Provider payable ledger agrees');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','eligible','Confirmed 48 hours ago with no holds reads eligible');
select is(pg_temp.payable_ok('clean'),true,'Parity: the payout kernel agrees it is payable');
select is(pg_temp.row_of('clean')->'readback'->>'state','none','No provider readback recorded yet');
select is(pg_temp.row_of('clean')->'payee'->>'name','Synthetic payee','Payee named for the operator');
select is(pg_temp.row_of('clean') ?| array['customer_id','customer_email'],false,'No customer identity is returned');

-- B: deposit only.
select pg_temp.new_order('deposit','deposit',49);
select is(pg_temp.row_of('deposit')->'issues','[]'::jsonb,'Deposit-only obligation reconciles');
select is((pg_temp.row_of('deposit')->'earnings'->>'platform_fee_ledger')::bigint,0::bigint,'A deposit earns no fee');
select is(pg_temp.row_of('deposit')->'payout'->>'funds_state','not_eligible','Unpaid balance is not eligible');
select is(pg_temp.row_of('deposit')->'payout'->'not_eligible','["payment_incomplete"]'::jsonb,'The reason is the incomplete payment');
select is(pg_temp.payable_ok('deposit'),false,'Parity: the kernel refuses it too');

-- C: confirmation inside the 48-hour window.
select pg_temp.new_order('window','full',47);
select is(pg_temp.row_of('window')->'payout'->>'funds_state','not_eligible','Inside 48 hours is not yet eligible');
select is(pg_temp.row_of('window')->'payout'->'not_eligible','["confirmation_window"]'::jsonb,'The reason is the confirmation window');
select is((pg_temp.row_of('window')->'payout'->>'eligible_at')::timestamptz,now()+interval '1 hour','Eligibility time is confirmation plus 48 hours');
select is(pg_temp.payable_ok('window'),false,'Parity: the kernel refuses it too');
select pg_temp.new_order('unconfirmed','full',null);
select is(pg_temp.row_of('unconfirmed')->'payout'->'not_eligible','["awaiting_confirmation"]'::jsonb,'No homeowner confirmation reads awaiting confirmation');

-- D: a partial refund, pending then settled.
select pg_temp.new_order('refund','full',49);
select pg_temp.approve(jsonb_build_object('operation','refund','obligation',(select id from f where key='refund'),'payment','pi_refund','service',2000,'tax',140,'tip',0,'key','fin-refund','policy','synthetic-CFG-006','reason','Synthetic adjustment'));
insert into f values('refund-auth',public.money_authorize_refund((select id from f where key='refund'),'pi_refund',2000,140,0,'fin-refund','a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003','synthetic-CFG-006','Synthetic adjustment'));
select is(pg_temp.row_of('refund')->'payout'->'held','["pending_refund"]'::jsonb,'An unsettled refund holds the payout');
select is(pg_temp.payable_ok('refund'),false,'Parity: the kernel holds it too');
select is(pg_temp.exceptions('refund_pending','refund'),1::bigint,'Pending refund is an exception');
select is((select e->>'attempt_status' from jsonb_array_elements(pg_temp.readback()->'exceptions') e where e->>'kind'='refund_pending'),'not_started','Refund exception shows no provider attempt yet');
select public.money_prepare_refund((select id from f where key='refund-auth'),'a7510000-0000-4000-8000-000000000002');
select is((select e->>'attempt_status' from jsonb_array_elements(pg_temp.readback()->'exceptions') e where e->>'kind'='refund_pending'),'prepared','Refund exception follows the durable attempt');
select public.money_receive_event('evt_fin_refund','refund',jsonb_build_object('authorization_id',(select id from f where key='refund-auth'),'refund_id','re_fin','payment_id','pi_refund','amount',2140,'currency','usd'));
select is(public.money_process_event('evt_fin_refund'),'processed','Refund settles');
select is(pg_temp.row_of('refund')->'issues','[]'::jsonb,'Settled partial refund reconciles');
select is((pg_temp.row_of('refund')->'refunds'->>'settled')::integer,1,'One settled refund');
select is((pg_temp.row_of('refund')->'earnings'->>'platform_fee')::bigint,1200::bigint,'Fee recalculated on the retained subtotal');
select is((pg_temp.row_of('refund')->'earnings'->>'provider_proceeds')::bigint,7800::bigint,'Proceeds follow the retained service and tip');
select is((pg_temp.row_of('refund')->'earnings'->>'tax_ledger')::bigint,560::bigint,'Refunded tax leaves the liability');
select is(pg_temp.row_of('refund')->'payout'->>'funds_state','eligible','Settled refund releases the hold');
select is(pg_temp.payable_ok('refund'),true,'Parity after settlement');
select is(pg_temp.exceptions('refund_pending','refund'),0::bigint,'Settled refund leaves the exceptions');

-- E: provider readback against Stripe.
select public.money_record_reconciliation((select id from f where key='refund'),'fin-readback-bad',9559,'usd','synthetic-readback');
select is(pg_temp.row_of('refund')->'readback'->>'state','mismatch','One-cent drift reads as a mismatch');
select is(pg_temp.row_of('refund')->'payout'->'held','["reconciliation"]'::jsonb,'Drift holds the payout');
select is(pg_temp.payable_ok('refund'),false,'Parity: drift holds in the kernel');
select is(pg_temp.exceptions('reconciliation_open','refund'),1::bigint,'Open reconciliation is an exception');
select public.money_record_reconciliation((select id from f where key='refund'),'fin-readback-good',9560,'usd','synthetic-readback');
insert into f select 'readback-good',id from public.money_reconciliation where observation_key='fin-readback-good';
select is(pg_temp.row_of('refund')->'readback'->>'state','matched','Latest matching readback reads matched');
select is(pg_temp.exceptions('reconciliation_open','refund'),1::bigint,'A match alone does not clear the open reconciliation');
select pg_temp.approve(jsonb_build_object('operation','reconciliation_resolution','observation',(select id from f where key='readback-good'),'reason','Synthetic resolution'));
select public.money_resolve_reconciliation((select id from f where key='readback-good'),'a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003','Synthetic resolution');
select is(pg_temp.exceptions('reconciliation_open','refund'),0::bigint,'Reviewed resolution clears the exception');
select public.money_record_reconciliation((select id from f where key='clean'),'fin-readback-clean',11700,'usd','synthetic-readback');
select is(pg_temp.row_of('clean')->'readback'->>'state','matched','Clean order readback matches');

-- F: weekly ACH statement through bank outcomes.
select pg_temp.approve(jsonb_build_object('operation','ach','period',current_date,'obligations',array[(select id from f where key='clean')],'bank_ref','private-bank-form','reason','Synthetic weekly ACH'));
insert into f values('batch',public.money_prepare_ach(current_date,array[(select id from f where key='clean')],'a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003','private-bank-form','Synthetic weekly ACH'));
insert into f select 'item',id from public.money_ach_items where batch_id=(select id from f where key='batch');
insert into f select 'attempt-1',id from public.money_ach_attempts where item_id=(select id from f where key='item');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','scheduled','Prepared statement reads scheduled');
select is((pg_temp.row_of('clean')->'payout'->'statement'->>'amount')::bigint,9500::bigint,'Statement amount read back');
select is(pg_temp.row_of('clean')->'payout'->'statement' ? 'bank_authorization_ref',false,'Bank references are not returned');
select is(pg_temp.readback()::text like '%private-bank-form%',false,'Bank authorization reference appears nowhere in the readback');
select public.money_record_ach((select id from f where key='attempt-1'),'submitted','bank-fin-1','a7510000-0000-4000-8000-000000000002','Synthetic submission','fin-submit-1');
select public.money_record_ach((select id from f where key='attempt-1'),'unknown','bank-fin-1','a7510000-0000-4000-8000-000000000002','Synthetic timeout','fin-unknown-1');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','scheduled','Unknown bank outcome is still scheduled, never paid');
select is(pg_temp.exceptions('bank_outcome','clean'),1::bigint,'Unknown bank outcome is an exception');
select public.money_record_ach((select id from f where key='attempt-1'),'failed','bank-fin-1','a7510000-0000-4000-8000-000000000002','Synthetic failure','fin-failed-1');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','payout_failed','Failed transfer reads payout failed');
select is((pg_temp.row_of('clean')->'payout'->>'payable_ledger')::bigint,9500::bigint,'Failed transfer leaves the payable');
select is(pg_temp.row_of('clean')->'issues','[]'::jsonb,'Failure reconciles: nothing was posted');
select pg_temp.approve(jsonb_build_object('operation','ach_retry','item',(select id from f where key='item')));
insert into f values('attempt-2',public.money_retry_ach((select id from f where key='item'),'a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003'));
select is(pg_temp.exceptions('bank_outcome','clean'),0::bigint,'Retry clears the failed-outcome exception');
select is((pg_temp.row_of('clean')->'payout'->'statement'->>'attempt_number')::integer,2,'Latest attempt number read back');
select public.money_record_ach((select id from f where key='attempt-2'),'submitted','bank-fin-2','a7510000-0000-4000-8000-000000000002','Synthetic submission','fin-submit-2');
select public.money_record_ach((select id from f where key='attempt-2'),'settled','bank-fin-2','a7510000-0000-4000-8000-000000000002','Synthetic settlement','fin-settle-2');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','paid','Recorded settlement reads paid');
select is((pg_temp.row_of('clean')->'payout'->>'paid')::bigint,9500::bigint,'Settled amount read back');
select is((pg_temp.row_of('clean')->'payout'->>'payable_ledger')::bigint,0::bigint,'Settlement clears the payable');
select is(pg_temp.row_of('clean')->'issues','[]'::jsonb,'Paid statement reconciles to bank and payable');
select public.money_record_ach((select id from f where key='attempt-2'),'returned','bank-fin-2','a7510000-0000-4000-8000-000000000002','Synthetic return','fin-return-2');
select is(pg_temp.row_of('clean')->'payout'->>'funds_state','payout_failed','A bank return reads payout failed, not reversed');
select is((pg_temp.row_of('clean')->'payout'->>'payable_ledger')::bigint,9500::bigint,'Return restores the payable');
select is(pg_temp.row_of('clean')->'issues','[]'::jsonb,'Returned statement reconciles');
select is(pg_temp.exceptions('bank_outcome','clean'),1::bigint,'Returned transfer is an exception');

-- G: chargeback open, lost, then allocated.
select pg_temp.new_order('chargeback','full',49);
select public.money_receive_event('evt_fin_dp_open','dispute','{"dispute_id":"dp_fin","payment_id":"pi_chargeback","amount":1000,"currency":"usd","state":"open"}');
select public.money_process_event('evt_fin_dp_open');
select is(pg_temp.row_of('chargeback')->'payout'->'held','["chargeback"]'::jsonb,'Open chargeback holds the payout');
select is(pg_temp.payable_ok('chargeback'),false,'Parity: the kernel holds it too');
select is((pg_temp.row_of('chargeback')->'chargebacks'->>'suspense_ledger')::bigint,1000::bigint,'Disputed amount in suspense');
select is(pg_temp.row_of('chargeback')->'issues','[]'::jsonb,'Open chargeback reconciles');
select is(pg_temp.exceptions('chargeback','chargeback'),1::bigint,'Open chargeback is an exception');
select public.money_receive_event('evt_fin_dp_lost','dispute','{"dispute_id":"dp_fin","payment_id":"pi_chargeback","amount":1000,"currency":"usd","state":"lost"}');
select public.money_process_event('evt_fin_dp_lost');
select is(pg_temp.exceptions('chargeback','chargeback'),1::bigint,'Lost and unallocated remains an exception');
select pg_temp.approve(jsonb_build_object('operation','chargeback','dispute','dp_fin','service',1000,'tax',0,'tip',0,'reason','Synthetic allocation'));
select public.money_resolve_chargeback_loss('dp_fin',1000,0,0,'a7510000-0000-4000-8000-000000000002','a7510000-0000-4000-8000-000000000003','Synthetic allocation');
select is(pg_temp.exceptions('chargeback','chargeback'),0::bigint,'Allocated loss leaves the exceptions');
select is(pg_temp.row_of('chargeback')->'issues','[]'::jsonb,'Allocated chargeback reconciles against clearing and suspense');
select is((pg_temp.row_of('chargeback')->'earnings'->>'platform_fee')::bigint,1350::bigint,'Fee follows the retained service after the loss');
select is((pg_temp.row_of('chargeback')->'chargebacks'->>'lost')::bigint,1000::bigint,'Lost principal read back');
select is(pg_temp.row_of('chargeback')->'payout'->>'funds_state','eligible','Allocated loss releases the hold');
select is(pg_temp.payable_ok('chargeback'),true,'Parity after allocation');

-- H: holds, provider onboarding, flagged checkout and failed provider events.
insert into f values('hold',public.money_place_hold((select id from f where key='chargeback'),'fin-hold','a7510000-0000-4000-8000-000000000002','Synthetic hold','synthetic-ticket'));
select is(pg_temp.row_of('chargeback')->'payout'->'held','["payout_hold"]'::jsonb,'Unresolved hold reads held');
select is(pg_temp.exceptions('payout_hold','chargeback'),1::bigint,'Unresolved hold is an exception');
select public.money_resolve_hold((select id from f where key='hold'),'a7510000-0000-4000-8000-000000000002','Resolved','synthetic-resolution');
select is(pg_temp.exceptions('payout_hold','chargeback'),0::bigint,'Resolved hold leaves the exceptions');
savepoint suspension;
update public.vendor_onboarding set status='suspended' where contractor_id='a7520000-0000-4000-8000-000000000001';
select is(pg_temp.row_of('chargeback')->'payout'->'held','["payout_onboarding"]'::jsonb,'Suspended payee reads held for payout onboarding');
select is(pg_temp.payable_ok('chargeback'),false,'Parity: suspension holds in the kernel');
rollback to savepoint suspension;
select pg_temp.new_order('flagged','deposit',null);
select pg_temp.as_user('a7510000-0000-4000-8000-000000000001');
insert into f select 'flagged-balance',(private.money_prepare_checkout((select current_snapshot_id from public.money_obligations where id=(select id from f where key='flagged')),'balance')).id;
select public.money_flag_checkout((select id from f where key='flagged-balance'),'stripe_timeout');
select pg_temp.as_user('a7510000-0000-4000-8000-000000000002');
select is(pg_temp.exceptions('checkout_reconcile','flagged'),1::bigint,'Checkout needing reconciliation is an exception');
select is((select e->>'error_code' from jsonb_array_elements(pg_temp.readback()->'exceptions') e where e->>'kind'='checkout_reconcile'),'stripe_timeout','Checkout exception carries its failure code');
select public.money_receive_event('evt_fin_bad','capture',jsonb_build_object('attempt_id',(select id from f where key='window-attempt'),'payment_id','pi_window','amount',1,'currency','usd'));
select is(public.money_process_event('evt_fin_bad'),'failed','Mismatched capture fails');
select is(pg_temp.exceptions('provider_event','window'),1::bigint,'Failed event is an exception linked to its obligation');
select is((pg_temp.row_of('window')->'payout'->'held')::jsonb ? 'provider_event',true,'Failed event holds the obligation');
select is((pg_temp.readback()->>'global_event_holds')::integer,0,'No global event hold yet');
savepoint global_event;
select public.money_receive_event('evt_fin_unsupported','reconciliation_required','{"source_type":"charge.updated"}');
select is((pg_temp.readback()->>'global_event_holds')::integer,1,'Unsupported provider event is a global hold');
select is(pg_temp.row_of('refund')->'payout'->'held','["provider_event"]'::jsonb,'A global event hold holds every obligation');
select is(pg_temp.payable_ok('refund'),false,'Parity: the kernel holds every payout for it too');
select is((select (e->>'holds_all_payouts')::boolean from jsonb_array_elements(pg_temp.readback()->'exceptions') e where e->>'event_id'='evt_fin_unsupported'),true,'The exception says it holds all payouts');
rollback to savepoint global_event;

-- I: parity across every unscheduled obligation.
select is((select count(*) from jsonb_array_elements(pg_temp.readback()->'obligations') v
  where v->'payout'->'statement'='null'::jsonb
    and (v->'payout'->>'funds_state'='eligible') is distinct from pg_temp.payable_ok((select key from f where id::text=v->>'obligation_id'))),
  0::bigint,'Every unscheduled funds state agrees with the payout kernel');

-- J: totals and ledger-wide balance.
select is((select sum((a->>'debit')::bigint)=sum((a->>'credit')::bigint) from jsonb_array_elements(pg_temp.readback()->'accounts') a),true,'Ledger-wide debits equal credits');
select is((pg_temp.readback()->'totals'->>'captured')::bigint,(select sum(captured)::bigint from public.money_obligations),'Captured total covers all obligations');
select is((pg_temp.readback()->'totals'->>'with_issues')::integer,0,'No obligation has a reconciliation issue');
select is((pg_temp.readback()->'totals'->>'paid_out')::bigint,0::bigint,'Returned transfer leaves nothing paid out');
create temp table evidence_before as select count(*) n from public.money_completion_evidence;
select pg_temp.readback();
select is((select count(*) from public.money_completion_evidence),(select n from evidence_before),'Readback writes no completion evidence');

-- K: detection. Tampered rows bypass the kernels here only to prove the checks fire.
savepoint tamper;
insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values((select id from f where key='refund'),'tamper:fee','tamper',
  '[{"account":"provider_payable","debit":100,"credit":0},{"account":"platform_revenue","debit":0,"credit":100}]','synthetic-tamper');
select is(pg_temp.row_of('refund')->'issues','["platform_fee", "provider_payable"]'::jsonb,'A stray fee transfer is detected on both accounts');
select is(pg_temp.exceptions('ledger_mismatch','refund'),1::bigint,'Ledger mismatch is an exception');
select is((pg_temp.readback()->'obligations'->0->>'obligation_id'),(select id::text from f where key='refund'),'Obligations with issues are listed first');
rollback to savepoint tamper;
savepoint tamper_counter;
update public.money_obligations set captured=captured+1 where id=(select id from f where key='deposit');
select is(pg_temp.row_of('deposit')->'issues' @> '["charge_attempts","charge_ledger","customer_advance","stripe_clearing"]'::jsonb,true,'A drifted capture counter is detected');
rollback to savepoint tamper_counter;
savepoint tamper_refund;
update public.money_obligations set refunded_tax=refunded_tax+1 where id=(select id from f where key='refund');
select is(pg_temp.row_of('refund')->'issues' @> '["refund_counters","refund_ledger"]'::jsonb,true,'A drifted refund counter is detected');
rollback to savepoint tamper_refund;
savepoint tamper_bank;
insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values((select id from f where key='clean'),'tamper:bank','tamper',
  '[{"account":"provider_payable","debit":9500,"credit":0},{"account":"bank","debit":0,"credit":9500}]','synthetic-tamper');
select is(pg_temp.row_of('clean')->'issues','["provider_payable", "bank_ledger"]'::jsonb,'A payout posted without a bank settlement is detected');
rollback to savepoint tamper_bank;
savepoint tamper_earnings;
alter table public.money_journals disable trigger immutable_evidence;
delete from public.money_journals where obligation_id=(select id from f where key='window') and kind='earnings';
alter table public.money_journals enable trigger immutable_evidence;
select is(pg_temp.row_of('window')->'issues' @> '["earnings_posting","platform_fee","tax_liability","customer_advance"]'::jsonb,true,'A missing earnings allocation is detected');
rollback to savepoint tamper_earnings;
select is((pg_temp.readback()->'totals'->>'with_issues')::integer,0,'Detection cases rolled back cleanly');

select * from finish();
rollback;
