begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-078 synthetic fixtures only. Covers finance operator commands part 2B: reviewed weekly ACH
-- batch requests bound to their payouts' amounts, payees and bank authorizations; one-operator
-- bank outcomes with the submission eligibility check; reviewed retries bound to the failed
-- attempt; and the ACH readback, which returns bank transaction references only as a hint.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7810000-0000-4000-8000-000000000001','ach-homeowner@example.invalid',now()),
 ('a7810000-0000-4000-8000-000000000002','ach-operator-a@example.invalid',now()),
 ('a7810000-0000-4000-8000-000000000003','ach-operator-b@example.invalid',now()),
 ('a7810000-0000-4000-8000-000000000004','ach-plain-admin@example.invalid',now()),
 ('a7810000-0000-4000-8000-000000000005','ach-operator-c@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7810000-0000-4000-8000-000000000002','admin'),('a7810000-0000-4000-8000-000000000003','admin'),
 ('a7810000-0000-4000-8000-000000000004','admin'),('a7810000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a7810000-0000-4000-8000-000000000002','a7810000-0000-4000-8000-000000000003','Synthetic test'),
 ('a7810000-0000-4000-8000-000000000003','a7810000-0000-4000-8000-000000000002','Synthetic test'),
 ('a7810000-0000-4000-8000-000000000005','a7810000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a7820000-0000-4000-8000-000000000001','Synthetic ACH payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('a7830000-0000-4000-8000-000000000001','Synthetic ACH payee','Test','Payout','ach-payee@example.invalid','synthetic','a7820000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 values('a7820000-0000-4000-8000-000000000001',
   (select id from public.vendor_application_versions where application_id='a7830000-0000-4000-8000-000000000001'),3,'active');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a7810000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a7820000-0000-4000-8000-000000000001';

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
  perform pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a7810000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order whose homeowner confirmed completion that many hours ago.
create function pg_temp.new_order(label text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a7810000-0000-4000-8000-000000000001','a7820000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a7810000-0000-4000-8000-000000000002','a7810000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a7810000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-request',request),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_ach_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_ach_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_ach_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a7810000-0000-4000-8000-000000000001','a7820000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.ops() returns jsonb language sql as $$ select public.money_finance_operations() $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.ready_of(label text) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'ach'->'ready') v where v->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.item_of(label text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.money_finance_operations()->'ach'->'batches') b cross join jsonb_array_elements(b->'items') i
 where i->>'obligation_id'=pg_temp.id(label)::text $$;
create function pg_temp.request(p_period date,labels text[],p_reason text,p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach(p_period,array(select pg_temp.id(l) from unnest(labels) l),'BANK-BATCH-'||p_key,p_reason,p_key)->>'request_id')::uuid $$;
create function pg_temp.attempt_of(label text) returns uuid language sql as $$
 select a.id from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id
 where i.obligation_id=pg_temp.id(label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.payable_ok(label text) returns boolean language plpgsql as $$
begin
  perform public.money_payable(pg_temp.id(label));
  return true;
exception when others then return false;
end $$;
-- Rewrites one field of a request's first term, as the database owner only.
create function pg_temp.tamper_terms(p_request uuid,p_field text,p_value jsonb) returns void language plpgsql as $$
declare changed jsonb;
begin
  select jsonb_build_array(jsonb_set(terms->0,array[p_field],p_value)) into changed from public.money_review_requests where id=p_request;
  alter table public.money_review_requests disable trigger immutable_evidence;
  update public.money_review_requests set terms=changed where id=p_request;
  alter table public.money_review_requests enable trigger immutable_evidence;
end $$;
-- Changes a statement amount (and its fee split) as the database owner only.
create function pg_temp.tamper_item_amount(p_obligation uuid,p_amount bigint) returns void language plpgsql as $$
begin
  alter table public.money_ach_items disable trigger immutable_evidence;
  update public.money_ach_items set amount=p_amount,platform_fee=service_retained+tip_retained-p_amount where obligation_id=p_obligation;
  alter table public.money_ach_items enable trigger immutable_evidence;
end $$;
create function pg_temp.age_request(p_request uuid,p_age interval) returns void language plpgsql as $$
begin
  alter table public.money_review_requests disable trigger immutable_evidence;
  update public.money_review_requests set created_at=now()-p_age where id=p_request;
  alter table public.money_review_requests enable trigger immutable_evidence;
end $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text) to authenticated;
grant execute on function pg_temp.request(date,text[],text,text) to authenticated;

select pg_temp.new_order('ready1',49);
select pg_temp.new_order('ready2',50);
select pg_temp.new_order('ready3',51);
select pg_temp.new_order('ready4',52);
select pg_temp.new_order('young',10);
select pg_temp.new_order('held',49);
select public.money_place_hold(pg_temp.id('held'),'ach-held','a7810000-0000-4000-8000-000000000002','Synthetic hold','Synthetic evidence');
-- Used only by scripts/phase5-finance-ach-concurrency.mjs.
select pg_temp.new_order('race_batch',49);
select pg_temp.new_order('race_overlap',49);
select pg_temp.new_order('race_refund',49);
select pg_temp.new_order('race_hold',49);
select pg_temp.new_order('race_bank',49);
-- END CONCURRENCY SETUP

-- Grants: the new commands are the browser path; kernels, helpers and evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_request_ach(date,uuid[],text,text,text)','execute'),true,'Signed-in users may call the batch request');
select is(has_function_privilege('authenticated','public.money_operator_request_ach_retry(uuid,text,text)','execute'),true,'Signed-in users may call the retry request');
select is(has_function_privilege('authenticated','public.money_operator_record_ach(uuid,text,text,text,text)','execute'),true,'Signed-in users may call the bank outcome record');
select is(has_function_privilege('anon','public.money_operator_request_ach(date,uuid[],text,text,text)','execute'),false,'Anonymous callers cannot request a batch');
select is(has_function_privilege('anon','public.money_operator_record_ach(uuid,text,text,text,text)','execute'),false,'Anonymous callers cannot record bank outcomes');
select is(has_function_privilege('anon','public.money_operator_request_ach_retry(uuid,text,text)','execute'),false,'Anonymous callers cannot request a retry');
select is(has_function_privilege('authenticated','public.money_prepare_ach(date,uuid[],uuid,uuid,text,text)','execute'),false,'The preparation kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_record_ach(uuid,text,text,uuid,text,text)','execute'),false,'The bank outcome kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_retry_ach(uuid,uuid,uuid)','execute'),false,'The retry kernel stays service-only');
select is(has_function_privilege('authenticated','private.money_ach_payable(uuid)','execute'),false,'The payable mirror stays closed');
select is(has_function_privilege('authenticated','private.money_request_blocker(text,text,jsonb,jsonb)','execute'),false,'The request blocker stays closed');
select is(has_function_privilege('authenticated','private.money_ach_operations(uuid)','execute'),false,'The ACH readback builder stays closed');
select is(has_function_privilege('authenticated','private.money_store_review_request(uuid,text,text,text,uuid,jsonb,text,text,boolean,jsonb)','execute'),false,'The request store stays closed');
select is(has_table_privilege('authenticated','public.money_ach_batches','select'),false,'Browser roles cannot read batches');
select is(has_table_privilege('authenticated','public.money_ach_attempts','select'),false,'Browser roles cannot read bank attempts');
select is(has_table_privilege('authenticated','public.money_ach_events','select'),false,'Browser roles cannot read bank events');

-- Readback parity with the kernel before anything is prepared: ready means money_payable accepts it.
select is(pg_temp.payable_ok('ready1'),true,'The kernel accepts a payout confirmed 49 hours ago');
select is(pg_temp.payable_ok('young'),false,'The kernel refuses a payout confirmed 10 hours ago');
select is(pg_temp.payable_ok('held'),false,'The kernel refuses a held payout');

-- Access.
set local role authenticated;
select pg_temp.as_user('a7810000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.request(current_date,array['ready1'],'Weekly','k-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot request a batch');
select throws_ok($$select public.money_operator_request_ach_retry(gen_random_uuid(),'Retry','k-homeowner-retry')$$,'42501','Restricted finance authority required','A homeowner cannot request a retry');
select throws_ok($$select public.money_operator_record_ach(gen_random_uuid(),'submitted','REF','Evidence','k-homeowner-record')$$,'42501','Restricted finance authority required','A homeowner cannot record a bank outcome');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.request(current_date,array['ready1'],'Weekly','k-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a batch');
select throws_ok($$select public.money_operator_record_ach(gen_random_uuid(),'submitted','REF','Evidence','k-admin-record')$$,'42501','Restricted finance authority required','An admin without finance authority cannot record a bank outcome');

-- Ready payouts.
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select ok(pg_temp.ready_of('ready1') is not null and pg_temp.ready_of('ready2') is not null and pg_temp.ready_of('ready3') is not null,'Payouts past the 48-hour window are ready');
select is(pg_temp.ready_of('young'),null,'A payout inside the 48-hour window is not ready');
select is(pg_temp.ready_of('held'),null,'A held payout is not ready');
select is((pg_temp.ready_of('ready1')->>'amount')::bigint,9500::bigint,'Ready amount is service less the 15% fee plus tip');
select is(pg_temp.ready_of('ready1')->>'payee_name','Synthetic ACH payee','Ready payout names its payee');
select is(pg_temp.ready_of('ready1')->>'blocker',null,'A ready payout with one bank authorization has no blocker');
select ok((pg_temp.ready_of('ready1')->>'eligible_at')::timestamptz<=now(),'Ready payout shows when it became eligible');
select is(pg_temp.ops()->'ach'->>'next_period_start',null,'No batch yet, so no next week is suggested');

-- Batch request validation.
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1')],'BANK',' ','k-v')$$,'22023','Reason of up to 1000 characters required','A batch needs a reason');
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1')],' ','Weekly','k-v')$$,'22023','Bank batch reference of up to 200 characters required','A batch needs a bank batch reference');
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1')],repeat('x',201),'Weekly','k-v')$$,'22023','Bank batch reference of up to 200 characters required','A bank batch reference is bounded');
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1')],'BANK','Weekly','')$$,'22023','Idempotency key required','A batch needs a key');
select throws_ok($$select public.money_operator_request_ach(null,array[pg_temp.id('ready1')],'BANK','Weekly','k-v')$$,'22023','Weekly period start required','A batch needs its week');
select throws_ok($$select public.money_operator_request_ach(current_date,array[]::uuid[],'BANK','Weekly','k-v')$$,'22023','Between 1 and 500 payouts required','An empty batch is refused');
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1'),null],'BANK','Weekly','k-v')$$,'22023','Between 1 and 500 payouts required','A batch with a missing payout is refused');
select throws_ok($$select public.money_operator_request_ach(current_date,array(select gen_random_uuid() from generate_series(1,501)),'BANK','Weekly','k-v')$$,'22023','Between 1 and 500 payouts required','A batch is bounded to 500 payouts');
select throws_ok($$select public.money_operator_request_ach(current_date,array[gen_random_uuid()],'BANK','Weekly','k-v')$$,'P0002','Finance obligation not found','An unknown payout is refused');
select throws_ok($$select pg_temp.request(current_date,array['ready1','young'],'Weekly','k-young')$$,'55000','Finance review not actionable: confirmation_window','A batch with a payout inside the window is refused with its reason');
select throws_ok($$select pg_temp.request(current_date,array['held'],'Weekly','k-held')$$,'55000','Finance review not actionable: payout_hold','A batch with a held payout is refused with its reason');
select throws_ok($$select public.money_operator_request_review('ach_preparation',current_date::text,'Weekly','k-generic',null)$$,'22023','Unsupported finance review','The generic review request does not take ACH');

-- A valid request: payouts are sorted and de-duplicated; the command is exactly the kernel's.
insert into f values('batch1',(public.money_operator_request_ach(current_date,
  array[pg_temp.id('ready2'),pg_temp.id('ready1'),pg_temp.id('ready2')],' BANK-BATCH-0921 ',' Weekly ACH one ','k-batch-1')->>'request_id')::uuid);
select is(public.money_operator_request_ach(current_date,array[pg_temp.id('ready2'),pg_temp.id('ready1'),pg_temp.id('ready2')],' BANK-BATCH-0921 ',' Weekly ACH one ','k-batch-1')->>'replay','true','The same request and key replays');
select throws_ok($$select public.money_operator_request_ach(current_date,array[pg_temp.id('ready1'),pg_temp.id('ready2')],'BANK-BATCH-0921','Different reason','k-batch-1')$$,'23505','Review request idempotency conflict','The same key with a different batch conflicts');
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('batch1')),
  private.money_ach_command(current_date,array(select x from unnest(array[pg_temp.id('ready1'),pg_temp.id('ready2')]) x order by x),'BANK-BATCH-0921','Weekly ACH one'),
  'The stored command is the kernel object with sorted, distinct payouts and trimmed text');
select is((select subject from public.money_review_requests where id=pg_temp.id('batch1')),to_char(current_date,'YYYY-MM-DD'),'The request subject is the week start');
select is((select jsonb_array_length(terms) from public.money_review_requests where id=pg_temp.id('batch1')),2,'Terms record each payout once');
select is((select sum((t->>'amount')::bigint) from public.money_review_requests q cross join jsonb_array_elements(q.terms) t where q.id=pg_temp.id('batch1')),19000::numeric,'Terms record each payout amount');
select ok((select bool_and(t->>'payee'='a7820000-0000-4000-8000-000000000001' and t->>'bank_evidence' is not null) from public.money_review_requests q cross join jsonb_array_elements(q.terms) t where q.id=pg_temp.id('batch1')),'Terms record payee and bank authorization');
select is((select evidence from public.money_review_requests where id=pg_temp.id('batch1')),null,'A batch request carries no separate evidence');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch1'))->>'state','awaiting_approval','The batch waits for a second operator');
select is(pg_temp.request_of(pg_temp.id('batch1'))->'details'->>'bank_ref','BANK-BATCH-0921','The approver sees the bank batch reference');
select is((pg_temp.request_of(pg_temp.id('batch1'))->'details'->>'total')::bigint,19000::bigint,'The approver sees the batch total');
select is(pg_temp.request_of(pg_temp.id('batch1'))->'details'->>'period_end',to_char(current_date+7,'YYYY-MM-DD'),'The week ends seven days later');
select is(jsonb_array_length(pg_temp.request_of(pg_temp.id('batch1'))->'details'->'items'),2,'The approver sees each payout');
select ok((select bool_and(i->>'blocker' is null and (i->>'amount')::bigint=9500 and i->>'payee_name'='Synthetic ACH payee') from jsonb_array_elements(pg_temp.request_of(pg_temp.id('batch1'))->'details'->'items') i),'Each payout reads back amount, payee and no blocker');
select is(pg_temp.ready_of('ready1')->>'open_request_id',pg_temp.id('batch1')::text,'A requested payout points to its open request');

-- Approval and execution.
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch1'),'Self'),'42501','A different finance operator must approve this command','The requester cannot approve the batch');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('batch1')),'42501','Separate authenticated approval of exact financial command required','An unapproved batch cannot run');
reset role;
select pg_temp.kernel_approve((select command from public.money_review_requests where id=pg_temp.id('batch1')));
set local role authenticated;
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('batch1')),'42501','Separate authenticated approval of exact financial command required','A kernel approval outside the request does not count');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch1'),'Checked amounts against statements'),'A second operator approves the batch');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('batch1')),'42501','Only the requesting finance operator can execute this command','The approver cannot run the batch');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select is(pg_temp.request_of(pg_temp.id('batch1'))->>'state','approved','The requester sees the batch approved');
select is(public.money_operator_execute_review(pg_temp.id('batch1'))->>'replay','false','The requester runs the batch');
select is(public.money_operator_execute_review(pg_temp.id('batch1'))->>'replay','true','Running it again replays');
reset role;
select is((select count(*) from public.money_ach_batches where period_start=current_date),1::bigint,'One batch is prepared');
select is((select created_by::text||'/'||approved_by::text||'/'||bank_authorization_ref||'/'||reason from public.money_ach_batches where period_start=current_date),
  'a7810000-0000-4000-8000-000000000002/a7810000-0000-4000-8000-000000000003/BANK-BATCH-0921/Weekly ACH one','The batch names requester, approver, bank reference and reason');
select is((select count(*) from public.money_ach_items i join public.money_ach_batches b on b.id=i.batch_id where b.period_start=current_date and i.amount=9500),2::bigint,'Both payouts are on the statement at their amounts');
select is((select string_agg(a.status||':'||a.attempt_number,',') from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id join public.money_ach_batches b on b.id=i.batch_id where b.period_start=current_date),'prepared:1,prepared:1','Each payout has one prepared attempt');
insert into f values('att-ready1',pg_temp.attempt_of('ready1')),('att-ready2',pg_temp.attempt_of('ready2'));
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch1'))->>'state','executed','The batch request reads back done');
select is(pg_temp.ready_of('ready1'),null,'A prepared payout is no longer ready');
select is(pg_temp.ops()->'ach'->>'next_period_start',to_char(current_date+7,'YYYY-MM-DD'),'The next week starts where the last one ends');
select is((pg_temp.ops()->'ach'->'batches'->0->>'total')::bigint,19000::bigint,'The batch reads back its total');
select is((pg_temp.ops()->'ach'->'batches'->0->>'created_by_me')::boolean,true,'The batch reads back as requested by me');
select is(pg_temp.ops()->'ach'->'batches'->0 ? 'bank_authorization_ref',false,'The prepared batch does not return its bank reference');
select is(pg_temp.item_of('ready1')->>'status','prepared','The payout reads back prepared');
select is(pg_temp.item_of('ready1')->>'submit_blocker',null,'A payable prepared payout can be submitted');

-- Weeks and payouts cannot be prepared twice; a batch that loses its week goes stale.
select throws_ok($$select pg_temp.request(current_date+3,array['ready3'],'Overlap','k-overlap')$$,'55000','Finance review not actionable: period_taken','An overlapping week is refused');
select throws_ok($$select pg_temp.request(current_date+7,array['ready1'],'Again','k-again')$$,'55000','Finance review not actionable: on_ach_statement','A payout already on a statement is refused');
insert into f values('batch2',pg_temp.request(current_date+7,array['ready3'],'Weekly ACH two','k-batch-2'));
insert into f values('batch3',pg_temp.request(current_date+7,array['ready3'],'Weekly ACH two again','k-batch-3'));
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch2'),'Checked'),'Second batch approved');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch3'),'Checked'),'Competing batch approved');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select lives_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('batch2')),'The first batch for the week runs');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('batch3')),'55000','Finance review not actionable: period_taken','A second batch for the same week is refused');
select is(pg_temp.request_of(pg_temp.id('batch3'))->>'state','stale','The losing batch reads back stale');
select is(pg_temp.request_of(pg_temp.id('batch3'))->>'blocker','period_taken','The losing batch says why');

-- A request is bound to its terms: a changed amount, payee or bank authorization makes it stale.
insert into f values('batch4',pg_temp.request(current_date+14,array['ready4'],'Weekly ACH three','k-batch-4'));
reset role;
select pg_temp.tamper_terms(pg_temp.id('batch4'),'amount','9400');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch4'))->>'blocker','payable_changed','A changed amount makes the batch stale');
select is(pg_temp.request_of(pg_temp.id('batch4'))->'details'->'items'->0->>'blocker','payable_changed','The changed payout is named');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch4'),'Checked'),'55000','Finance review not actionable: payable_changed','A stale batch cannot be approved');
reset role;
select pg_temp.tamper_terms(pg_temp.id('batch4'),'amount','9500');
select pg_temp.tamper_terms(pg_temp.id('batch4'),'payee',to_jsonb(gen_random_uuid()::text));
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch4'))->>'blocker','payee_changed','A changed payee makes the batch stale');
reset role;
select pg_temp.tamper_terms(pg_temp.id('batch4'),'payee','"a7820000-0000-4000-8000-000000000001"');
select pg_temp.tamper_terms(pg_temp.id('batch4'),'bank_evidence',to_jsonb(gen_random_uuid()::text));
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch4'))->>'blocker','bank_authorization_changed','A changed bank authorization makes the batch stale');
reset role;
select pg_temp.tamper_terms(pg_temp.id('batch4'),'bank_evidence',(select to_jsonb(id::text) from public.vendor_compliance_evidence where contractor_id='a7820000-0000-4000-8000-000000000001' and kind='bank_authorization'));
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('batch4'))->>'blocker',null,'Restored terms are actionable again');
reset role;
select pg_temp.age_request(pg_temp.id('batch4'),interval '25 hours');
set local role authenticated;
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('batch4'),'Checked'),'55000','Finance review request expired; request it again','An expired batch cannot be approved');
select is(pg_temp.request_of(pg_temp.id('batch4'))->>'state','expired','The expired batch reads back expired');
select is(pg_temp.request_of(pg_temp.id('batch4'))->'details'->'items'->0->>'blocker',null,'An expired batch computes no live blockers');

-- Bank outcomes: one operator, the kernel's transitions, submission re-proves the payout.
select pg_temp.as_user('a7810000-0000-4000-8000-000000000001');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'submitted','REF','Evidence','k-h'),'42501','Restricted finance authority required','A homeowner cannot record a submission');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'paid','REF','Evidence','k-o'),'22023','Bank outcome required','An unknown bank status is refused');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'submitted','REF',' ','k-o'),'22023','Evidence of up to 1000 characters required','A bank outcome needs evidence');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'submitted','  ','Evidence','k-o'),'22023','Bank reference of up to 200 characters required','A blank bank reference is refused');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',gen_random_uuid(),'submitted','REF','Evidence','k-o'),'P0002','Bank attempt not found','An unknown attempt is refused');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'settled','REF','Evidence','k-o'),'55000','Bank outcome not recordable: transition_invalid','A prepared transfer cannot settle before submission');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att-ready1'),'submitted','Evidence','k-o'),'55000','Bank outcome not recordable: bank_reference_required','A submission needs its bank reference');
select is(public.money_operator_record_ach(pg_temp.id('att-ready1'),'submitted',' ACH-TRACE-000111 ','Bank portal batch sent','k-sub-1')->>'status','submitted','One operator records the submission');
select is(public.money_operator_record_ach(pg_temp.id('att-ready1'),'submitted','ACH-TRACE-000111','Bank portal batch sent','k-sub-1')->>'replay','true','The same submission and key replays');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'submitted','ACH-TRACE-000111','Other evidence','k-sub-1'),'23505','Bank outcome idempotency conflict','The same key with other evidence conflicts');
reset role;
select is((select bank_reference from public.money_ach_attempts where id=pg_temp.id('att-ready1')),'ACH-TRACE-000111','The trimmed bank reference is recorded');
select is((select actor::text||'/'||business_key from public.money_ach_events where attempt_id=pg_temp.id('att-ready1')),'a7810000-0000-4000-8000-000000000002/finance-ach:k-sub-1','The event names the signed-in operator and a namespaced key');
set local role authenticated;
select is(pg_temp.item_of('ready1')->>'bank_reference_hint','0111','Operators see only the last four characters of the reference');
select is(position('ACH-TRACE-000111' in pg_temp.ops()::text),0,'The full bank reference is not returned');
select is(pg_temp.item_of('ready1')->'last_event'->>'status','submitted','The latest bank event reads back');
select is((pg_temp.item_of('ready1')->'last_event'->>'by_me')::boolean,true,'The latest bank event reads back as mine');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready2'),'submitted','ACH-TRACE-000111','Evidence','k-sub-dup'),'55000','Bank outcome not recordable: bank_reference_used','A reference already used for another transfer is refused');
-- A hold that arrives after preparation stops the submission, and the readback says so.
reset role;
select public.money_place_hold(pg_temp.id('ready2'),'ach-late-hold','a7810000-0000-4000-8000-000000000003','Late complaint','Synthetic ticket');
set local role authenticated;
select is(pg_temp.item_of('ready2')->>'submit_blocker','payout_hold','A late hold blocks submission in the readback');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready2'),'submitted','ACH-TRACE-000222','Evidence','k-sub-2'),'55000','Bank outcome not recordable: payout_hold','A late hold stops the submission');
reset role;
select public.money_resolve_hold((select id from public.money_holds where business_key='ach-late-hold'),'a7810000-0000-4000-8000-000000000003','Cleared','Synthetic ticket closed');
set local role authenticated;
select lives_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready2'),'submitted','ACH-TRACE-000222','Bank portal batch sent','k-sub-2'),'The submission proceeds once the hold is released');
-- Later outcomes reuse the submission reference.
select is(public.money_operator_record_ach(pg_temp.id('att-ready1'),'unknown',null,'Bank portal shows pending review','k-unknown-1')->>'status','unknown','An unknown outcome is recorded with the stored reference');
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.id('att-ready1'),'Retry','k-retry-unknown'),'55000','Finance review not actionable: bank_outcome_open','An unknown outcome cannot be retried');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att-ready1'),'failed','OTHER-REF','Evidence','k-conflict'),'55000','Bank outcome not recordable: bank_reference_conflict','A different reference for the same transfer is refused');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att-ready1'),'failed','Bank rejected: account closed','k-failed-1'),'A failure is recorded');
reset role;
select is((select count(*) from public.money_journals where obligation_id=pg_temp.id('ready1') and kind like 'ach_%'),0::bigint,'A failure posts no journal');
set local role authenticated;
select is(pg_temp.item_of('ready1')->>'status','failed','The failed payout reads back failed');
select is(pg_temp.item_of('ready1')->>'retry_blocker',null,'The failed payout can be retried');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att-ready2'),'settled','Statement line 12','k-settled-2'),'A settlement is recorded');
reset role;
select is((select count(*) from public.money_journals where business_key='ach:'||pg_temp.id('att-ready2')||':settled'),1::bigint,'A settlement posts its journal');
set local role authenticated;
select is((select v->'payout'->>'funds_state' from jsonb_array_elements(public.money_finance_reconciliation()->'obligations') v where v->>'obligation_id'=pg_temp.id('ready2')::text),'paid','Reconciliation reads the settled payout as paid');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att-ready2'),'returned','Return R02 on statement line 19','k-returned-2'),'A return is recorded after settlement');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att-ready2'),'failed','Evidence','k-fail-after-return'),'55000','Bank outcome not recordable: transition_invalid','A returned transfer takes no further outcome');
reset role;
select is((select count(*) from public.money_journals where business_key='ach:'||pg_temp.id('att-ready2')||':returned'),1::bigint,'A return posts its journal');
set local role authenticated;
select is(pg_temp.item_of('ready2')->>'retry_blocker',null,'A returned payout can be retried');

-- Retry: reviewed, bound to the failed attempt, and never carried over to a later failure.
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',gen_random_uuid(),'Retry','k-r'),'P0002','Bank attempt not found','An unknown attempt cannot be retried');
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.id('att-ready1'),' ','k-r'),'22023','Reason of up to 1000 characters required','A retry needs a reason');
insert into f values('retry1',(public.money_operator_request_ach_retry(pg_temp.id('att-ready1'),'Provider sent corrected account','k-retry-1')->>'request_id')::uuid);
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('retry1')),
  private.money_ach_retry_command((select item_id from public.money_ach_attempts where id=pg_temp.id('att-ready1'))),'The retry command is exactly the kernel object');
select is((select obligation_id from public.money_review_requests where id=pg_temp.id('retry1')),pg_temp.id('ready1'),'The retry names its payout');
set local role authenticated;
select is((pg_temp.request_of(pg_temp.id('retry1'))->'details'->>'amount')::bigint,9500::bigint,'The approver sees the retry amount');
select is(pg_temp.request_of(pg_temp.id('retry1'))->'details'->>'status','failed','The approver sees the failed outcome');
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('retry1')),'42501','Separate authenticated approval of exact financial command required','An unapproved retry cannot run');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('retry1'),'Read the bank rejection'),'A second operator approves the retry');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select lives_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('retry1')),'The requester runs the retry');
reset role;
select is((select status||':'||created_by||':'||approved_by from public.money_ach_attempts where item_id=(select item_id from public.money_ach_attempts where id=pg_temp.id('att-ready1')) and attempt_number=2),
  'prepared:a7810000-0000-4000-8000-000000000002:a7810000-0000-4000-8000-000000000003','The retry prepares attempt 2 with requester and approver');
insert into f values('att2-ready1',pg_temp.attempt_of('ready1'));
set local role authenticated;
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.id('att-ready1'),'Again','k-retry-again'),'55000','Finance review not actionable: completed','A retried attempt cannot be retried again');
select is(pg_temp.item_of('ready1')->>'attempt_number','2','The payout reads back its new attempt');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att2-ready1'),'submitted','ACH-TRACE-000333','Resent','k-sub-3'),'The retry is submitted');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att2-ready1'),'failed','Bank rejected again','k-failed-3'),'The retry fails again');
insert into f values('retry2',(public.money_operator_request_ach_retry(pg_temp.id('att2-ready1'),'Provider sent corrected account again','k-retry-2')->>'request_id')::uuid);
reset role;
select is((select command_hash from public.money_review_requests where id=pg_temp.id('retry2')),(select command_hash from public.money_review_requests where id=pg_temp.id('retry1')),'The second retry has the identical kernel command');
set local role authenticated;
select throws_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('retry2')),'42501','Separate authenticated approval of exact financial command required','The first retry''s approval does not carry over');
select is(pg_temp.request_of(pg_temp.id('retry2'))->>'state','awaiting_approval','The second retry waits for its own approval');
reset role;
select public.money_place_hold(pg_temp.id('ready1'),'ach-retry-hold','a7810000-0000-4000-8000-000000000003','Complaint after failure','Synthetic ticket');
set local role authenticated;
select is(pg_temp.item_of('ready1')->>'retry_blocker','payout_hold','A hold blocks the retry in the readback');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000005');
select throws_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('retry2'),'Checked'),'55000','Finance review not actionable: payout_hold','A held retry cannot be approved');
reset role;
select public.money_resolve_hold((select id from public.money_holds where business_key='ach-retry-hold'),'a7810000-0000-4000-8000-000000000003','Cleared','Synthetic ticket closed');
set local role authenticated;
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('retry2'),'Read the second rejection'),'A different second operator approves the second retry');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select lives_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('retry2')),'The second retry runs');
reset role;
select is((select approved_by from public.money_ach_attempts where item_id=(select item_id from public.money_ach_attempts where id=pg_temp.id('att-ready1')) and attempt_number=3),'a7810000-0000-4000-8000-000000000005'::uuid,'Attempt 3 names its own approver');
insert into f values('att3-ready1',pg_temp.attempt_of('ready1'));
set local role authenticated;
insert into f values('retry3',(public.money_operator_request_ach_retry(pg_temp.id('att-ready2'),'Return corrected','k-retry-3')->>'request_id')::uuid);
select pg_temp.as_user('a7810000-0000-4000-8000-000000000003');
select lives_ok(format('select public.money_operator_approve_review(%L,%L)',pg_temp.id('retry3'),'Read the return'),'A returned payout retry is approved');
select pg_temp.as_user('a7810000-0000-4000-8000-000000000002');
select lives_ok(format('select public.money_operator_execute_review(%L)',pg_temp.id('retry3')),'A returned payout retry runs');
reset role;
insert into f values('att2-ready2',pg_temp.attempt_of('ready2'));
set local role authenticated;
select lives_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att3-ready1'),'submitted','ACH-TRACE-000444','Resent','k-sub-4'),'Attempt 3 is submitted');
select lives_ok(format('select public.money_operator_record_ach(%L,%L,null,%L,%L)',pg_temp.id('att3-ready1'),'failed','Bank rejected a third time','k-failed-4'),'Attempt 3 fails');

-- A statement whose amount no longer matches the payable cannot be sent.
reset role;
select pg_temp.tamper_item_amount(pg_temp.id('ready2'),9400);
set local role authenticated;
select is(pg_temp.item_of('ready2')->>'submit_blocker','statement_stale','A stale statement amount blocks submission in the readback');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att2-ready2'),'submitted','ACH-TRACE-000555','Evidence','k-sub-stale'),'55000','Bank outcome not recordable: statement_stale','A stale statement amount stops submission');
reset role;
select pg_temp.tamper_item_amount(pg_temp.id('ready2'),9500);
set local role authenticated;
select is(pg_temp.item_of('ready2')->>'submit_blocker',null,'The restored statement can be submitted');

-- A dispute after preparation stops submission; conflicting completion evidence stops a batch.
reset role;
update public.service_requests set disputed=true where id=pg_temp.id('ready3-request');
set local role authenticated;
select is(pg_temp.item_of('ready3')->>'submit_blocker','dispute_hold','A dispute blocks submission in the readback');
reset role;
select is(pg_temp.payable_ok('ready3'),false,'The kernel agrees a disputed payout is not payable');
update public.service_requests set disputed=false where id=pg_temp.id('ready3-request');
insert into public.money_completion_evidence(obligation_id,homeowner_id,confirmed_at,source_ref)
 values(pg_temp.id('ready4'),'a7810000-0000-4000-8000-000000000001',now()-interval '60 hours','synthetic-legacy-confirmation');
select is(pg_temp.payable_ok('ready4'),false,'The kernel refuses conflicting completion evidence');
set local role authenticated;
select is(pg_temp.ready_of('ready4'),null,'A payout with conflicting completion evidence is not ready');
select throws_ok($$select pg_temp.request(current_date+28,array['ready4'],'Weekly','k-conflict-evidence')$$,'55000','Finance review not actionable: confirmation_conflict','Conflicting completion evidence is refused with its reason');
select is(pg_temp.request_of(pg_temp.id('batch4'))->'details'->'items'->0->>'blocker',null,'An expired batch does not re-evaluate its payouts');

-- A changed bank authorization stops submission and retry: the statement needs replacement.
reset role;
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by,supersedes)
 select contractor_id,application_version_id,'bank_authorization','bank_authorization-v2','Synthetic new bank form',now()-interval '1 hour',now()+interval '1 year','a7810000-0000-4000-8000-000000000003',id
 from public.vendor_compliance_evidence where contractor_id='a7820000-0000-4000-8000-000000000001' and kind='bank_authorization';
set local role authenticated;
select is(pg_temp.item_of('ready2')->>'submit_blocker','bank_authorization_changed','A changed bank authorization blocks submission in the readback');
select throws_ok(format('select public.money_operator_record_ach(%L,%L,%L,%L,%L)',pg_temp.id('att2-ready2'),'submitted','ACH-TRACE-000555','Evidence','k-sub-5'),'55000','Bank outcome not recordable: bank_authorization_changed','A changed bank authorization stops submission');
select is(pg_temp.item_of('ready1')->>'retry_blocker','bank_authorization_changed','A changed bank authorization blocks the retry in the readback');
select throws_ok(format('select public.money_operator_request_ach_retry(%L,%L,%L)',pg_temp.id('att3-ready1'),'Retry','k-retry-bank'),'55000','Finance review not actionable: bank_authorization_changed','A changed bank authorization stops a retry request');
select ok(pg_temp.ready_of('race_batch') is not null,'An unprepared payout is ready with the new bank authorization');
-- Two current bank authorizations are refused before the kernel's strict lookup.
reset role;
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select contractor_id,application_version_id,'bank_authorization','bank_authorization-v3','Synthetic duplicate bank form',now()-interval '1 hour',now()+interval '1 year','a7810000-0000-4000-8000-000000000003'
 from public.vendor_onboarding where contractor_id='a7820000-0000-4000-8000-000000000001';
set local role authenticated;
select is(pg_temp.ready_of('race_batch')->>'blocker','bank_authorization_ambiguous','Two current bank authorizations read back as a blocker');
select throws_ok($$select pg_temp.request(current_date+21,array['race_batch'],'Weekly','k-ambiguous')$$,'55000','Finance review not actionable: bank_authorization_ambiguous','Two current bank authorizations are refused');

-- No gateway path returned a full bank reference or a customer identity.
select is(position('ACH-TRACE-' in pg_temp.ops()::text),0,'No full bank transaction reference is returned');
select is(position('ach-homeowner@example.invalid' in pg_temp.ops()::text),0,'No customer identity is returned');

select * from finish();
rollback;
