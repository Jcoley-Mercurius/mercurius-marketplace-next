begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-081 synthetic fixtures only. Covers importing payout-related statement lines, pairing them
-- with recorded ACH settlements, returns, late payments and provider repayments, resolving the
-- differences through the existing commands, and the reviewed close of a reconciled statement.
-- No statement line changes a transfer or the ledger by itself.
insert into auth.users(id,email,email_confirmed_at) values
 ('a8110000-0000-4000-8000-000000000001','stm-homeowner@example.invalid',now()),
 ('a8110000-0000-4000-8000-000000000002','stm-operator-a@example.invalid',now()),
 ('a8110000-0000-4000-8000-000000000003','stm-operator-b@example.invalid',now()),
 ('a8110000-0000-4000-8000-000000000004','stm-plain-admin@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a8110000-0000-4000-8000-000000000002','admin'),('a8110000-0000-4000-8000-000000000003','admin'),
 ('a8110000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003','Synthetic test'),
 ('a8110000-0000-4000-8000-000000000003','a8110000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a8120000-0000-4000-8000-000000000001','Synthetic statement payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a8130000-0000-4000-8000-000000000001','Synthetic statement payee','Test','Payout','stm-payee-1@example.invalid','synthetic','a8120000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,3,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id='a8130000-0000-4000-8000-000000000001';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a8110000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a8120000-0000-4000-8000-000000000001';

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
  perform pg_temp.as_user('a8110000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a8110000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A reviewed, fully captured order whose homeowner confirmed completion that many hours ago.
create function pg_temp.new_order(label text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a8110000-0000-4000-8000-000000000001','a8120000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a8110000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-request',request),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_stm_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_stm_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_stm_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
  insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
    values(request,'a8110000-0000-4000-8000-000000000001','a8120000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- Operator B approves and operator A (the requester) runs a request.
create function pg_temp.review(p_request uuid) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('a8110000-0000-4000-8000-000000000003');
  perform public.money_operator_approve_review(p_request,'Synthetic second-person review');
  perform pg_temp.as_user('a8110000-0000-4000-8000-000000000002');
  perform public.money_operator_execute_review(p_request);
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.batch(p_period date,labels text[],p_key text) returns uuid language sql as $$
 select (public.money_operator_request_ach(p_period,array(select pg_temp.id(l) from unnest(labels) l),'BANK-BATCH-'||p_key,'Synthetic weekly ACH',p_key)->>'request_id')::uuid $$;
create function pg_temp.item_id(label text) returns uuid language sql security definer as $$
 select i.id from public.money_ach_items i where i.obligation_id=pg_temp.id(label)
 and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) $$;
create function pg_temp.attempt_of(label text) returns uuid language sql security definer as $$
 select a.id from public.money_ach_attempts a where a.item_id=pg_temp.item_id(label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.record(label text,p_status text,p_ref text,p_key text) returns jsonb language sql as $$
 select public.money_operator_record_ach(pg_temp.attempt_of(label),p_status,p_ref,'Synthetic bank evidence '||p_status,p_key) $$;
create function pg_temp.settle_refund(label text,p_amount bigint) returns text language plpgsql security definer as $$
declare authorization_id uuid;
begin
  select id into strict authorization_id from public.money_refund_authorizations where obligation_id=pg_temp.id(label)
    and not exists(select 1 from public.money_refunds r where r.authorization_id=money_refund_authorizations.id);
  perform public.money_prepare_refund(authorization_id,'a8110000-0000-4000-8000-000000000002');
  perform public.money_receive_event('evt_stm_refund_'||label,'refund',jsonb_build_object('authorization_id',authorization_id,
    'refund_id','re_stm_'||label,'payment_id','pi_stm_'||label,'amount',p_amount,'currency','usd'));
  return public.money_process_event('evt_stm_refund_'||label);
end $$;
-- Mercurius's business day; statement periods are relative to it.
create function pg_temp.today() returns date language sql security definer as $$ select private.money_bank_day(now()) $$;
create function pg_temp.line(p_posted date,p_direction text,p_amount bigint,p_ref text) returns jsonb language sql as $$
 select jsonb_build_object('posted_on',to_char(p_posted,'YYYY-MM-DD'),'direction',p_direction,'amount',p_amount,'reference',p_ref) $$;
create function pg_temp.import(p_start date,p_end date,p_lines jsonb,p_key text) returns jsonb language sql as $$
 select public.money_operator_import_bank_statement(p_start,p_end,p_lines,null,p_key) $$;
create function pg_temp.line_id(p_statement uuid,p_number integer) returns uuid language sql security definer as $$
 select id from public.money_bank_statement_lines where statement_id=p_statement and line_number=p_number $$;
create function pg_temp.stmt_of(p_statement uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'statements'->'statements') v where v->>'statement_id'=p_statement::text $$;
create function pg_temp.line_of(p_statement uuid,p_number integer) returns jsonb language sql as $$
 select l from jsonb_array_elements(pg_temp.stmt_of(p_statement)->'lines') l where (l->>'line_number')::integer=p_number $$;
create function pg_temp.state(p_statement uuid,p_number integer) returns text language sql security definer as $$
 select s.state from private.money_bank_line_states() s where s.line_id=pg_temp.line_id(p_statement,p_number) $$;
create function pg_temp.movement_of(p_kind text,label text) returns text language sql security definer as $$
 select m.movement from private.money_bank_movements() m where m.kind=p_kind and m.obligation_id=pg_temp.id(label) $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
create function pg_temp.bank_exceptions(p_kind text) returns jsonb language sql as $$
 select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements(public.money_finance_reconciliation()->'exceptions') e where e->>'kind'=p_kind $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text),pg_temp.batch(date,text[],text),pg_temp.item_id(text),pg_temp.attempt_of(text),
  pg_temp.record(text,text,text,text),pg_temp.review(uuid),pg_temp.today(),pg_temp.line(date,text,bigint,text),
  pg_temp.import(date,date,jsonb,text),pg_temp.line_id(uuid,integer),pg_temp.stmt_of(uuid),pg_temp.line_of(uuid,integer),
  pg_temp.state(uuid,integer),pg_temp.movement_of(text,text),pg_temp.request_of(uuid),pg_temp.bank_exceptions(text) to authenticated;

select pg_temp.new_order('set',49);
select pg_temp.new_order('ret',50);
select pg_temp.new_order('ret2',51);
select pg_temp.new_order('open',52);
select pg_temp.new_order('wd',53);
select pg_temp.new_order('fail',54);
select pg_temp.new_order('amt',55);
select pg_temp.new_order('repay',56);
select pg_temp.new_order('alt',57);
select pg_temp.new_order('unev',58);
select pg_temp.new_order('short',59);
select pg_temp.new_order('alt2',60);
-- Used only by scripts/phase5-bank-statement-concurrency.mjs.
select pg_temp.new_order('race_a',49);
select pg_temp.new_order('race_b',49);
select pg_temp.new_order('race_open',49);
-- END CONCURRENCY SETUP

-- Grants: the operator commands are the browser path; the kernel, helpers and statement evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_import_bank_statement(date,date,jsonb,text,text)','execute'),true,'Signed-in users may call the import');
select is(has_function_privilege('authenticated','public.money_operator_match_bank_line(uuid,text,text)','execute'),true,'Signed-in users may call the manual match');
select is(has_function_privilege('authenticated','public.money_operator_dismiss_bank_line(uuid,text)','execute'),true,'Signed-in users may call the dismissal');
select is(has_function_privilege('authenticated','public.money_operator_resolve_bank_line(uuid,text,text,text)','execute'),true,'Signed-in users may call the line resolution');
select is(has_function_privilege('authenticated','public.money_operator_request_bank_statement_close(uuid,text,text)','execute'),true,'Signed-in users may request a close');
select is(has_function_privilege('anon','public.money_operator_import_bank_statement(date,date,jsonb,text,text)','execute'),false,'Anonymous callers cannot import');
select is(has_function_privilege('anon','public.money_operator_request_bank_statement_close(uuid,text,text)','execute'),false,'Anonymous callers cannot request a close');
select is(has_function_privilege('authenticated','public.money_close_bank_statement(uuid,integer,bigint,bigint,uuid,uuid,text)','execute'),false,'The close kernel is not a browser path');
select is(has_function_privilege('service_role','public.money_close_bank_statement(uuid,integer,bigint,bigint,uuid,uuid,text)','execute'),true,'The close kernel is a service path');
select is(has_function_privilege('authenticated','private.money_bank_pairs()','execute'),false,'The pairing helper stays closed');
select is(has_function_privilege('authenticated','private.money_bank_statement_operations(uuid)','execute'),false,'The statement readback helper stays closed');
select is(has_function_privilege('authenticated','private.money_open_bank_line(uuid)','execute'),false,'The line lock helper stays closed');
select is(has_table_privilege('authenticated','public.money_bank_statement_lines','select'),false,'Browser roles cannot read statement lines');
select is(has_table_privilege('authenticated','public.money_bank_statements','select'),false,'Browser roles cannot read statements');
select is(has_table_privilege('service_role','public.money_bank_statement_lines','update'),false,'Statement lines cannot be edited through the service role');
select is(has_table_privilege('service_role','public.money_bank_line_matches','update'),false,'Matches cannot be edited through the service role');
select is(has_table_privilege('service_role','public.money_bank_statement_closes','update'),false,'Closes cannot be edited through the service role');
select is((select count(*)::integer from information_schema.columns where table_schema='public' and table_name='money_bank_statement_lines'
  and column_name ~ 'desc|memo|payee|account|name'),0,'A statement line has no description, payee or account column');

-- Recorded bank movements: one batch pays every payout; outcomes are recorded as the bank shows them.
set local role authenticated;
select pg_temp.as_user('a8110000-0000-4000-8000-000000000002');
select pg_temp.review(pg_temp.batch(current_date,array['set','ret','ret2','open','wd','fail','amt','repay','alt','unev','short','alt2'],'stm-w1'));
select lives_ok($$select pg_temp.record('set','submitted','STM-SET','k-set-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('set','settled',null,'k-set-set')$$,'It settles');
select lives_ok($$select pg_temp.record('ret','submitted','STM-RET','k-ret-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('ret','settled',null,'k-ret-set')$$,'It settles');
select lives_ok($$select pg_temp.record('ret','returned',null,'k-ret-ret')$$,'It is returned');
select lives_ok($$select pg_temp.record('ret2','submitted','STM-RET2','k-ret2-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('ret2','settled',null,'k-ret2-set')$$,'It settles; its return is not recorded yet');
select lives_ok($$select pg_temp.record('open','submitted','STM-OPEN','k-open-sub')$$,'A transfer is submitted; its settlement is not recorded yet');
select lives_ok($$select pg_temp.record('wd','submitted','STM-WD','k-wd-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('wd','failed',null,'k-wd-failed')$$,'It fails');
select pg_temp.review((public.money_operator_request_ach_withdrawal(pg_temp.attempt_of('wd'),'Synthetic withdrawal','Bank portal showed a failure','k-wd-withdraw')->>'request_id')::uuid);
select lives_ok($$select pg_temp.record('fail','submitted','STM-FAIL','k-fail-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('fail','failed',null,'k-fail-failed')$$,'It fails');
select lives_ok($$select pg_temp.record('amt','submitted','STM-AMT','k-amt-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('amt','settled',null,'k-amt-set')$$,'It settles');
select lives_ok($$select pg_temp.record('repay','submitted','STM-REPAY','k-repay-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('repay','settled',null,'k-repay-set')$$,'It settles');
select lives_ok($$select pg_temp.record('alt','submitted','STM-ALT-RECORDED','k-alt-sub')$$,'A transfer is submitted under one reference');
select lives_ok($$select pg_temp.record('alt','settled',null,'k-alt-set')$$,'It settles');
select lives_ok($$select pg_temp.record('unev','submitted','STM-UNEV','k-unev-sub')$$,'A transfer is submitted');
select lives_ok($$select pg_temp.record('unev','settled',null,'k-unev-set')$$,'It settles and no statement line will show it');
select lives_ok($$select pg_temp.record('short','submitted','STM-SHORT','k-short-sub')$$,'A transfer is submitted; the bank will show a different amount');
-- A refund after the payout settled leaves 1700 owed; the provider repays 500 of it.
insert into f values('refund-req',(public.money_operator_request_refund(pg_temp.id('repay'),'pi_stm_repay',2000,0,0,'Ticket 81','Partial rework after payout','k-stm-refund')->>'request_id')::uuid);
select pg_temp.review(pg_temp.id('refund-req'));
reset role;
select is(pg_temp.settle_refund('repay',2000),'processed','The refund settles at Stripe');
set local role authenticated;
select pg_temp.review((public.money_operator_request_payout_recovery(pg_temp.id('repay'),'repayment',500,'Provider repaid part','Bank credit on the statement','k-stm-repayment')->>'request_id')::uuid);

reset role;
select is((select count(*)::integer from private.money_bank_movements() m where m.obligation_id in (select id from f)),9,
  'Nine recorded movements: seven settlements, a return and a repayment');
select is((select count(*)::integer from private.money_bank_movements() m where m.kind='settled' and m.obligation_id in (select id from f)),7,'Seven settlements are movements');
select is((select count(*)::integer from private.money_bank_movements() m where m.kind='returned' and m.obligation_id in (select id from f)),1,'One return is a movement');
select is((select count(*)::integer from private.money_bank_movements() m where m.kind='repayment' and m.obligation_id in (select id from f)),1,'One repayment is a movement');
select is((select direction||':'||amount from private.money_bank_movements() m where m.kind='repayment' and m.obligation_id=pg_temp.id('repay')),'credit:500','A repayment is a credit with no reference');
select is((select count(*)::integer from private.money_bank_movements() m where m.obligation_id in (select id from f) and m.kind='settled' and m.bank_reference='STM-FAIL'),0,'A failed transfer is not a movement');
create temp table journal_count as select count(*) n from public.money_journals;
create temp table attempt_state as select id,status from public.money_ach_attempts;
grant select on journal_count,attempt_state to authenticated;

-- Import access and validation.
set local role authenticated;
select pg_temp.as_user('a8110000-0000-4000-8000-000000000001');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,'[]','k-imp-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot import');
select pg_temp.as_user('a8110000-0000-4000-8000-000000000004');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,'[]','k-imp-plain')$$,'42501','Restricted finance authority required','An admin without finance authority cannot import');
select pg_temp.as_user('a8110000-0000-4000-8000-000000000002');
select throws_ok($$select pg_temp.import(pg_temp.today()-1,pg_temp.today()-10,'[]','k-imp-backwards')$$,'22023','Statement period of up to 32 days required','A backwards period is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-40,pg_temp.today()-1,'[]','k-imp-long')$$,'22023','Statement period of up to 32 days required','A period longer than a statement cycle is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()+1,pg_temp.today()+5,'[]','k-imp-future')$$,'22023','Statement period cannot start in the future','A future period is refused');
select throws_ok($$select public.money_operator_import_bank_statement(pg_temp.today()-10,pg_temp.today()-1,'[]','not-a-digest','k-imp-print')$$,'22023',
  'File fingerprint must be a SHA-256 hex digest','A malformed file fingerprint is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,'{}','k-imp-object')$$,'22023','Up to 1000 statement lines required','Lines must be an array');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,(select jsonb_agg(pg_temp.line(pg_temp.today()-3,'debit',100+n,'CAP-'||n)) from generate_series(1,1001) n),'k-imp-cap')$$,
  '22023','Up to 1000 statement lines required','More than 1000 lines are refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'X')||'{"description":"ACH PAYEE 000123456789"}'),'k-imp-desc')$$,
  '22023','Statement line 1 needs a posting date, direction, amount and reference only','A description or any other field is refused, so none can be stored');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'withdrawal',9500,'X')),'k-imp-dir')$$,
  '22023','Statement line 1 needs a posting date, direction, amount and reference only','An unknown direction is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,'[{"posted_on":"2026-02-30","direction":"debit","amount":9500,"reference":"X"}]','k-imp-date')$$,
  '22023','Statement line 1 has an invalid posting date','An impossible date is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'X'),pg_temp.line(pg_temp.today(),'debit',9500,'Y')),'k-imp-outside')$$,
  '22023','Statement line 2 is posted outside the statement period','A line outside the period is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',0,'X')),'k-imp-zero')$$,
  '22023','Statement line 1 needs an amount in whole cents greater than zero','A zero amount is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(jsonb_set(pg_temp.line(pg_temp.today()-3,'debit',1,'X'),'{amount}','95.5')),'k-imp-frac')$$,
  '22023','Statement line 1 needs an amount in whole cents greater than zero','A fractional cent amount is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',-9500,'X')),'k-imp-neg')$$,
  '22023','Statement line 1 needs an amount in whole cents greater than zero','A signed amount is refused; direction carries the sign');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'   ')),'k-imp-blank')$$,
  '22023','Statement line 1 needs a bank reference of up to 200 characters','A blank reference is refused');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'X'),pg_temp.line(pg_temp.today()-3,'debit',9500,' X ')),'k-imp-twice')$$,
  '23505','Statement line 2 is already imported','The same line twice in one import is refused');
reset role;
select is((select count(*)::integer from public.money_bank_statements),0,'No refused import created a statement');
set local role authenticated;

-- The past statement: every kind of line, imported in two parts.
insert into f values('s1',(pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-SET'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,' STM-RET '),
  pg_temp.line(pg_temp.today()-2,'credit',9500,'STM-RET'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-OPEN'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-WD')),'k-imp-s1a')->>'statement_id')::uuid);
select is(pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-SET'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,' STM-RET '),
  pg_temp.line(pg_temp.today()-2,'credit',9500,'STM-RET'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-OPEN'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-WD')),'k-imp-s1a')->>'replay','true','The same import replays');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-SET')),'k-imp-s1a')$$,
  '23505','Statement import idempotency conflict','The same key with other lines conflicts');
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-SET')),'k-imp-s1-dup')$$,
  '23505','Statement line 1 is already imported','A line already on a statement is refused');
select lives_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(
  pg_temp.line(pg_temp.today()-2,'credit',9500,'STM-RET2'),
  pg_temp.line(pg_temp.today()-2,'credit',500,'BANKCREDIT-7781'),
  pg_temp.line(pg_temp.today()-3,'debit',9500,'STM-ALT-BANKSIDE'),
  pg_temp.line(pg_temp.today()-4,'credit',123456,'STRIPE-PAYOUT-1')),'k-imp-s1b')$$,'A second import adds lines to the same statement');
select throws_ok($$select pg_temp.import(pg_temp.today()-12,pg_temp.today()-5,'[]','k-imp-overlap')$$,'23P01','Another statement already covers part of this period','An overlapping period is refused');
select is(pg_temp.stmt_of(pg_temp.id('s1'))->>'line_count','9','The statement has nine lines');
select is((pg_temp.stmt_of(pg_temp.id('s1'))->>'imports')::integer,2,'From two imports');
select is((pg_temp.stmt_of(pg_temp.id('s1'))->>'debit_total')::bigint,47500::bigint,'Five debits total 47500');
select is((pg_temp.stmt_of(pg_temp.id('s1'))->>'credit_total')::bigint,142956::bigint,'Four credits total 142956');
select is(pg_temp.line_of(pg_temp.id('s1'),2)->>'bank_reference_hint','-RET','A reference is trimmed and returned only as its last four characters');

-- Evidence only: importing changed no transfer and posted nothing.
reset role;
select is((select count(*) from public.money_journals)-(select n from journal_count),0::bigint,'Importing posted no journal');
select is((select count(*)::integer from public.money_ach_attempts a join attempt_state s on s.id=a.id where a.status<>s.status),0,'Importing changed no transfer');

-- Pairing by reference.
select is(pg_temp.state(pg_temp.id('s1'),1),'matched','A settled transfer''s line matches by reference');
select is((select movement from private.money_bank_line_states() where line_id=pg_temp.line_id(pg_temp.id('s1'),1)),pg_temp.movement_of('settled','set'),'It pairs with the settlement');
select is(pg_temp.state(pg_temp.id('s1'),2),'matched','A returned transfer''s debit matches its settlement');
select is((select movement from private.money_bank_line_states() where line_id=pg_temp.line_id(pg_temp.id('s1'),3)),pg_temp.movement_of('returned','ret'),'Its credit pairs with the return');
select is(pg_temp.state(pg_temp.id('s1'),4),'unmatched','A settlement not yet recorded leaves the line unmatched');
select is(pg_temp.state(pg_temp.id('s1'),9),'unmatched','A line naming no transfer is unmatched');
set local role authenticated;
select is(pg_temp.line_of(pg_temp.id('s1'),1)->'match'->>'kind','settled','The readback names what a line matched');
select is(pg_temp.line_of(pg_temp.id('s1'),1)->'match'->>'how','reference','And how');
select is(pg_temp.line_of(pg_temp.id('s1'),1)->'match'->>'payee_name','Synthetic statement payee','And whose payout it was');
select is(pg_temp.line_of(pg_temp.id('s1'),1)->'suggestion','null'::jsonb,'A matched line has no suggestion');

-- Suggestions for unmatched lines.
select is(pg_temp.line_of(pg_temp.id('s1'),4)->'suggestion'->>'action','record_settled','A submitted transfer the bank paid suggests recording it settled');
select is(pg_temp.line_of(pg_temp.id('s1'),4)->'suggestion'->>'attempt_id',pg_temp.attempt_of('open')::text,'It names the transfer');
select is(pg_temp.line_of(pg_temp.id('s1'),5)->'suggestion'->>'action','request_late_settlement','A withdrawn transfer the bank paid suggests a late payment');
select is(pg_temp.line_of(pg_temp.id('s1'),6)->'suggestion'->>'action','record_returned','A settled transfer the bank returned suggests recording the return');
select is(pg_temp.line_of(pg_temp.id('s1'),7)->'suggestion'->>'action','match_repayment','A credit with no transfer and a recorded repayment of that amount suggests matching it');
select is(pg_temp.line_of(pg_temp.id('s1'),8)->'suggestion'->>'action','no_transfer','A debit under a reference no transfer has suggests nothing to record');
select is(pg_temp.line_of(pg_temp.id('s1'),9)->'suggestion'->>'action','no_transfer','A non-payout credit names no transfer');

-- Resolving through the existing bank outcome command.
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'record_returned','Statement check','k-res-wrong')$$,
  '55000','Statement line not resolvable: suggestion_changed','An action other than the suggestion records nothing');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'record_settled','','k-res-blank')$$,
  '22023','Note of up to 500 characters required','A note is required');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'dismiss','Statement check','k-res-unknown')$$,
  '22023','Statement line action required','Only the three resolutions are accepted');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),'record_settled','Statement check','k-res-none')$$,
  '55000','Statement line not resolvable: suggestion_changed','A line naming no transfer cannot be resolved into an outcome');
select is(public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'record_settled','Weekly statement check','k-res-open')->>'status','settled',
  'The line records the settlement through the bank outcome command');
select is(public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'record_settled','Weekly statement check','k-res-open')->>'replay','true','A replay replays the recorded outcome');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),4),'record_settled','Other note','k-res-open')$$,
  '23505','Bank outcome idempotency conflict','A replay with another note conflicts');
select is(pg_temp.state(pg_temp.id('s1'),4),'matched','The line now matches the settlement it recorded');
reset role;
select is((select status from public.money_ach_attempts where id=pg_temp.attempt_of('open')),'settled','The transfer is settled');
select is((select e.evidence like 'Bank statement % line 4: debit of 95.00 posted %. Weekly statement check' from public.money_ach_events e
  where e.business_key='finance-ach:k-res-open'),true,'The outcome''s evidence is the statement line and the note');
select is((select e.actor from public.money_ach_events e where e.business_key='finance-ach:k-res-open'),'a8110000-0000-4000-8000-000000000002'::uuid,'Recorded as the signed-in operator');
set local role authenticated;
select is(public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),6),'record_returned','Return on the statement','k-res-ret2')->>'status','returned',
  'A return is recorded through the same command');
select is(pg_temp.state(pg_temp.id('s1'),6),'matched','The credit matches the return');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),6),'record_returned','Again','k-res-ret2-again')$$,
  '55000','Statement line not resolvable: line_matched','A matched line cannot be resolved again');

-- Resolving a late payment: a reviewed request, as TRACE-080 requires.
insert into f values('late-req',(public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),5),'request_late_settlement','Found on the statement','k-res-wd')->>'request_id')::uuid);
select is(pg_temp.request_of(pg_temp.id('late-req'))->>'operation','ach_late_settlement','It creates the reviewed late payment request');
select is(pg_temp.request_of(pg_temp.id('late-req'))->>'reason','Found on the statement','The note is its reason');
select ok(pg_temp.request_of(pg_temp.id('late-req'))->>'evidence' like 'Bank statement % line 5: debit of 95.00 %','Its evidence is the statement line');
select is(public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s1'),5),'request_late_settlement','Found on the statement','k-res-wd')->>'replay','true','A replay replays the request');
select is(pg_temp.state(pg_temp.id('s1'),5),'unmatched','The line waits until the late payment is recorded');
select pg_temp.review(pg_temp.id('late-req'));
select is(pg_temp.state(pg_temp.id('s1'),5),'matched','Once approved and run, the line matches the late payment');
reset role;
select is((select bank_reference from public.money_ach_late_settlements where attempt_id=pg_temp.attempt_of('wd')),'STM-WD','The late payment carries the line''s reference');

-- Manual matches: a repayment, and a transfer the bank shows under another reference.
set local role authenticated;
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),7),%L,'Credit is the repayment')$$,pg_temp.movement_of('settled','alt')),
  '55000','Statement line not matchable: direction_mismatch','A credit cannot match a payment');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),%L,'Bank reference differs')$$,pg_temp.movement_of('repayment','repay')),
  '55000','Statement line not matchable: direction_mismatch','A debit cannot match a repayment');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),%L,'Wrong amount')$$,pg_temp.movement_of('repayment','repay')),
  '55000','Statement line not matchable: amount_mismatch','A different amount cannot match');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),%L,'Already evidenced')$$,pg_temp.movement_of('settled','set')),
  '55000','Statement line not matchable: movement_matched','A movement another line evidences cannot match again');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),1),%L,'Line already matched')$$,pg_temp.movement_of('settled','alt')),
  '55000','Statement line not matchable: line_matched','A matched line cannot match again');
select throws_ok($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),'settled:00000000-0000-4000-8000-000000000000','Unknown')$$,
  '55000','Statement line not matchable: movement_not_found','An unknown movement is refused');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),%L,' ')$$,pg_temp.movement_of('settled','alt')),
  '22023','Reason of up to 1000 characters required','A reason is required');
select throws_ok(format($$select public.money_operator_match_bank_line('00000000-0000-4000-8000-000000000000',%L,'Unknown line')$$,pg_temp.movement_of('settled','alt')),
  'P0002','Statement line not found','An unknown line is refused');
select is(public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),7),pg_temp.movement_of('repayment','repay'),'Credit is the provider''s repayment')->>'replay','false',
  'A credit matches the recorded repayment');
select is(public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),7),pg_temp.movement_of('repayment','repay'),' Credit is the provider''s repayment ')->>'replay','true','A trimmed replay replays');
select is(public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),8),pg_temp.movement_of('settled','alt'),'Bank shows its own trace number')->>'movement',
  pg_temp.movement_of('settled','alt'),'A debit matches a settlement recorded under another reference');
select is(pg_temp.line_of(pg_temp.id('s1'),8)->'match'->>'how','manual','The readback shows a manual match');
select is(pg_temp.line_of(pg_temp.id('s1'),7)->'match'->>'kind','repayment','And what it matched');

-- Dismissing a line imported by mistake.
select throws_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),1),'Not payout related')$$,
  '55000','Statement line not dismissable: line_matched','A matched line cannot be dismissed');
select throws_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),'')$$,
  '22023','Reason of up to 1000 characters required','A reason is required');
select is(public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),'Stripe payout to Mercurius, not a provider payout')->>'replay','false','A non-payout line is dismissed');
select is(public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),'Stripe payout to Mercurius, not a provider payout')->>'replay','true','The dismissal replays');
select throws_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),'Another reason')$$,
  '55000','Statement line not dismissable: dismissed','A dismissal with another reason is refused');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),9),%L,'After dismissal')$$,pg_temp.movement_of('settled','unev')),
  '55000','Statement line not matchable: dismissed','A dismissed line cannot be matched');
select is(pg_temp.line_of(pg_temp.id('s1'),9)->>'state','dismissed','The readback shows the dismissal');
select is(pg_temp.line_of(pg_temp.id('s1'),9)->'dismissal'->>'reason','Stripe payout to Mercurius, not a provider payout','And its reason');

-- Evidence only: matching and dismissing posted nothing.
reset role;
select is((select count(*) from public.money_journals)-(select n from journal_count),3::bigint,
  'Only the three recorded outcomes posted journals: the settlement, the return and the late payment');

-- The current statement: exceptions, and a period still open.
set local role authenticated;
insert into f values('s2',(pg_temp.import(pg_temp.today(),pg_temp.today()+6,jsonb_build_array(
  pg_temp.line(pg_temp.today(),'debit',9500,'STM-FAIL'),
  pg_temp.line(pg_temp.today(),'debit',9400,'STM-AMT'),
  pg_temp.line(pg_temp.today(),'debit',9500,'STM-SET'),
  pg_temp.line(pg_temp.today(),'debit',9500,'UNKNOWN-REF'),
  pg_temp.line(pg_temp.today(),'debit',9000,'STM-SHORT'),
  pg_temp.line(pg_temp.today(),'debit',9500,'STM-WD')),'k-imp-s2')->>'statement_id')::uuid);
select is(pg_temp.line_of(pg_temp.id('s2'),1)->'suggestion'->>'action','outcome_conflict','A failed transfer the bank shows as paid is a conflict');
select is(pg_temp.line_of(pg_temp.id('s2'),2)->>'state','amount_mismatch','A line paired by reference at another amount is a mismatch');
select is(pg_temp.line_of(pg_temp.id('s2'),2)->'match'->>'amount','9500','The readback shows the recorded amount');
select is(pg_temp.line_of(pg_temp.id('s2'),3)->>'state','unmatched','A second line for a transfer already evidenced stays unmatched');
select is(pg_temp.line_of(pg_temp.id('s2'),3)->'suggestion'->>'action','already_evidenced','It says the transfer is on another line');
select is(pg_temp.line_of(pg_temp.id('s2'),4)->'suggestion'->>'action','no_transfer','An unknown reference names no transfer');
select is(pg_temp.line_of(pg_temp.id('s2'),5)->'suggestion'->>'action','amount_mismatch','A submitted transfer the bank paid at another amount is a mismatch, not a settlement');
select is((pg_temp.line_of(pg_temp.id('s2'),5)->'suggestion'->>'amount')::bigint,9500::bigint,'The suggestion shows the transfer''s amount');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s2'),5),'record_settled','Try','k-res-short')$$,
  '55000','Statement line not resolvable: suggestion_changed','A mismatched amount is never recorded as settled');
select is(pg_temp.line_of(pg_temp.id('s2'),6)->'suggestion'->>'action','already_evidenced','A second line for a withdrawn transfer already paid late does not ask for another late payment');
select throws_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s2'),1),'Not ours')$$,
  '55000','Statement line not dismissable: line_names_transfer','A line naming a transfer cannot be dismissed');
select throws_ok($$select public.money_operator_resolve_bank_line(pg_temp.line_id(pg_temp.id('s2'),1),'record_settled','Try','k-res-conflict')$$,
  '55000','Statement line not resolvable: suggestion_changed','A conflict cannot be resolved into an outcome');
reset role;
-- s2 covers today: its exceptions are its three unmatched lines, its mismatch, and each movement
-- recorded today that no line evidences.
select is((select array_agg(u.movement order by u.movement) from private.money_bank_unevidenced() u where u.obligation_id in (select id from f)),
  (select array_agg(m order by m) from unnest(array[pg_temp.movement_of('settled','ret2'),pg_temp.movement_of('settled','repay'),pg_temp.movement_of('settled','unev')]) m),
  'No line evidences the settlements of the returned, repaid and unevidenced payouts');
select is(private.money_bank_statement_exceptions(pg_temp.id('s2')),6+3,'The current statement has nine exceptions: six lines and three movements with no line');
select is(private.money_bank_statement_exceptions(pg_temp.id('s1')),0,'The past statement has none');
set local role authenticated;
select is(pg_temp.stmt_of(pg_temp.id('s2'))->>'close_blocker','period_open','A statement whose period has not ended cannot be closed');
select throws_ok(format($$select public.money_operator_request_bank_statement_close(%L,'Month end','k-close-s2')$$,pg_temp.id('s2')),
  '55000','Finance review not actionable: period_open','Nor can its close be requested');

-- Reconciliation lists the statement exceptions.
select is(jsonb_array_length(pg_temp.bank_exceptions('bank_line')),6,'Reconciliation lists each unresolved line');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.bank_exceptions('bank_line')) e where e->>'state'='amount_mismatch'),1,'Including the mismatch');
select is((select e->>'obligation_id' from jsonb_array_elements(pg_temp.bank_exceptions('bank_line')) e where e->>'state'='amount_mismatch'),pg_temp.id('amt')::text,'The mismatch names its payout');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.bank_exceptions('bank_unevidenced')) e where (e->>'obligation_id')::uuid in (select id from f)),3,
  'Reconciliation lists each movement no line evidences inside imported periods');
select is((select count(*)::integer from jsonb_array_elements(public.money_finance_operations()->'statements'->'unevidenced') u where (u->>'obligation_id')::uuid in (select id from f)),3,
  'The operator readback lists them too');
select is((select u->>'statement_id' from jsonb_array_elements(public.money_finance_operations()->'statements'->'unevidenced') u where u->>'movement'=pg_temp.movement_of('settled','unev')),
  pg_temp.id('s2')::text,'Each names the statement whose period covers it');

-- Closing the past statement: reviewed, bound to its lines, and final.
select pg_temp.as_user('a8110000-0000-4000-8000-000000000004');
select throws_ok(format($$select public.money_operator_request_bank_statement_close(%L,'Month end','k-close-plain')$$,pg_temp.id('s1')),
  '42501','Restricted finance authority required','An admin without finance authority cannot request a close');
select pg_temp.as_user('a8110000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_request_bank_statement_close('00000000-0000-4000-8000-000000000000','Month end','k-close-none')$$,
  'P0002','Bank statement not found','An unknown statement is refused');
select throws_ok($$select public.money_operator_request_review('bank_statement_close',pg_temp.id('s1')::text,'Month end','k-close-generic','x')$$,
  '22023','Unsupported finance review','The generic request refuses a close');
insert into f values('close1',(public.money_operator_request_bank_statement_close(pg_temp.id('s1'),' Month end reconciled ','k-close-s1')->>'request_id')::uuid);
reset role;
select is((select command from public.money_review_requests where id=pg_temp.id('close1')),
  jsonb_build_object('operation','bank_statement_close','statement',pg_temp.id('s1'),'lines',9,'debits',47500,'credits',142956,'reason','Month end reconciled'),
  'The stored command binds the statement''s lines and totals');
select is((select evidence from public.money_review_requests where id=pg_temp.id('close1')),null,'A close takes no separate evidence');
set local role authenticated;
select is(public.money_operator_request_bank_statement_close(pg_temp.id('s1'),'Month end reconciled','k-close-s1')->>'replay','true','A trimmed replay replays');
select is(pg_temp.request_of(pg_temp.id('close1'))->'details'->>'lines','9','The approver sees the line count');
select is((pg_temp.request_of(pg_temp.id('close1'))->'details'->>'debits')::bigint,47500::bigint,'And the totals');
select is((pg_temp.request_of(pg_temp.id('close1'))->'details'->>'exceptions_now')::integer,0,'And that nothing is open');
select is(pg_temp.stmt_of(pg_temp.id('s1'))->>'open_request_id',pg_temp.id('close1')::text,'The statement shows the open request');
-- A line imported after the request makes it stale.
select lives_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-1,'credit',777,'STRIPE-PAYOUT-2')),'k-imp-s1c')$$,
  'Another line is imported into the open statement');
select is(public.money_operator_request_bank_statement_close(pg_temp.id('s1'),'Month end reconciled','k-close-s1')->>'replay','true',
  'A replay keeps the totals it was requested against');
select pg_temp.as_user('a8110000-0000-4000-8000-000000000003');
select throws_ok(format($$select public.money_operator_approve_review(%L,'Checked')$$,pg_temp.id('close1')),
  '55000','Finance review not actionable: statement_changed','The earlier close request is stale');
select pg_temp.as_user('a8110000-0000-4000-8000-000000000002');
select is(pg_temp.request_of(pg_temp.id('close1'))->>'blocker','statement_changed','It reads back as stale');
select throws_ok(format($$select public.money_operator_request_bank_statement_close(%L,'Month end','k-close-s1-open')$$,pg_temp.id('s1')),
  '55000','Finance review not actionable: statement_exceptions','A close is refused while a line is unresolved');
select is(pg_temp.stmt_of(pg_temp.id('s1'))->>'close_blocker','statement_exceptions','The statement shows why');
select lives_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),10),'Stripe payout to Mercurius')$$,'The new line is dismissed');
insert into f values('close2',(public.money_operator_request_bank_statement_close(pg_temp.id('s1'),'Month end reconciled','k-close-s1-b')->>'request_id')::uuid);
select throws_ok(format($$select public.money_operator_approve_review(%L,'Self')$$,pg_temp.id('close2')),
  '42501','A different finance operator must approve this command','The requester cannot approve their own close');
select throws_ok(format($$select public.money_operator_execute_review(%L)$$,pg_temp.id('close2')),
  '42501','Separate authenticated approval of exact financial command required','An unapproved close cannot run');
select pg_temp.review(pg_temp.id('close2'));
select is(pg_temp.request_of(pg_temp.id('close2'))->>'state','executed','The approved close ran');
select is(pg_temp.stmt_of(pg_temp.id('s1'))->'closed'->>'reason','Month end reconciled','The statement reads back closed');
select is(pg_temp.stmt_of(pg_temp.id('s1'))->>'close_blocker',null,'A closed statement has no close blocker');
reset role;
select is((select (line_count,debit_total,credit_total,requested_by,approved_by)::text from public.money_bank_statement_closes where statement_id=pg_temp.id('s1')),
  (10,47500,143733,'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003')::text,'The close records its totals and both operators');
select is((select count(*)::integer from public.money_bank_line_matches m join public.money_bank_statement_lines l on l.id=m.line_id
  where l.statement_id=pg_temp.id('s1') and m.how='reference'),6,'Its six reference pairings are stored');
select is((select count(*)::integer from public.money_bank_line_matches m join public.money_bank_statement_lines l on l.id=m.line_id
  where l.statement_id=pg_temp.id('s1') and m.how='manual'),2,'Beside its two manual matches');
select throws_ok(format($$update public.money_bank_statement_lines set amount=1 where statement_id=%L$$,pg_temp.id('s1')),'55000','Immutable financial evidence; append a correction','Statement lines are immutable');
select throws_ok(format($$delete from public.money_bank_statement_closes where statement_id=%L$$,pg_temp.id('s1')),'55000','Immutable financial evidence; append a correction','A close is immutable');
select throws_ok($$delete from public.money_bank_line_matches$$,'55000','Immutable financial evidence; append a correction','Matches are immutable');
set local role authenticated;
select throws_ok($$select pg_temp.import(pg_temp.today()-10,pg_temp.today()-1,jsonb_build_array(pg_temp.line(pg_temp.today()-1,'credit',778,'LATE-LINE')),'k-imp-closed')$$,
  '55000','Bank statement is closed','A closed statement takes no more lines');
select throws_ok($$select public.money_operator_dismiss_bank_line(pg_temp.line_id(pg_temp.id('s1'),1),'Late')$$,
  '55000','Bank statement is closed','Its lines cannot be dismissed');
select throws_ok(format($$select public.money_operator_match_bank_line(pg_temp.line_id(pg_temp.id('s1'),1),%L,'Late')$$,pg_temp.movement_of('settled','unev')),
  '55000','Bank statement is closed','Nor matched');
select throws_ok(format($$select public.money_operator_request_bank_statement_close(%L,'Again','k-close-s1-c')$$,pg_temp.id('s1')),
  '55000','Finance review not actionable: completed','A closed statement cannot be closed again');
-- The stored pairing survives a later line that would otherwise pair first.
select is(pg_temp.line_of(pg_temp.id('s1'),1)->>'state','matched','The closed statement''s line stays matched');
select is(pg_temp.line_of(pg_temp.id('s2'),3)->'suggestion'->>'action','already_evidenced','The later duplicate still reads already evidenced');

-- The kernel: a reused approval replays; an unapproved command is refused.
reset role;
select lives_ok(format($$select public.money_close_bank_statement(%L,10,47500,143733,'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003','Month end reconciled')$$,
  pg_temp.id('s1')),'The kernel replays the recorded close');
select pg_temp.kernel_approve(private.money_bank_statement_close_command(pg_temp.id('s1'),10,47500,143733,'Other reason'));
select throws_ok(format($$select public.money_close_bank_statement(%L,10,47500,143733,'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003','Other reason')$$,
  pg_temp.id('s1')),'P0001','Bank statement close idempotency conflict','An approved close with other details conflicts with the recorded one');
select throws_ok(format($$select public.money_close_bank_statement(%L,4,0,0,'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003','Other')$$,pg_temp.id('s2')),
  '42501','Separate authenticated approval of exact financial command required','The kernel refuses an unapproved close');
select pg_temp.kernel_approve(private.money_bank_statement_close_command(pg_temp.id('s2'),6,56400,0,'Kernel'));
select throws_ok(format($$select public.money_close_bank_statement(%L,6,56400,0,'a8110000-0000-4000-8000-000000000002','a8110000-0000-4000-8000-000000000003','Kernel')$$,pg_temp.id('s2')),
  'P0001','Bank statement cannot be closed: period_open','The kernel refuses an open period even when approved');

-- A manually matched line never pairs again by its own reference: a later transfer recorded under
-- that reference pairs with a later line.
set local role authenticated;
select lives_ok($$select pg_temp.record('alt2','submitted','STM-ALT-BANKSIDE','k-alt2-sub')$$,'A later transfer is recorded under the reference a manual match used');
select lives_ok($$select pg_temp.record('alt2','settled',null,'k-alt2-set')$$,'It settles');
select lives_ok($$select pg_temp.import(pg_temp.today(),pg_temp.today()+6,jsonb_build_array(pg_temp.line(pg_temp.today(),'debit',9500,'STM-ALT-BANKSIDE')),'k-imp-s2b')$$,
  'Its line is imported');
reset role;
select is((select movement from private.money_bank_line_states() where line_id=pg_temp.line_id(pg_temp.id('s2'),7)),pg_temp.movement_of('settled','alt2'),'The new line pairs with the new transfer');
select is((select movement from private.money_bank_line_states() where line_id=pg_temp.line_id(pg_temp.id('s1'),8)),pg_temp.movement_of('settled','alt'),'The manual match is unchanged');
select is((select count(*)=count(distinct line_id) and count(*)=count(distinct movement) from private.money_bank_pairs()),true,'No line or movement is paired twice');

-- Nothing returned exposes a full bank reference or a customer identity.
set local role authenticated;
select is(position('STM-ALT-BANKSIDE' in public.money_finance_operations()::text),0,'The operator readback returns no full statement reference');
select is(position('BANKCREDIT-7781' in public.money_finance_reconciliation()::text),0,'Reconciliation returns no statement reference');
select is(position('stm-homeowner@example.invalid' in public.money_finance_operations()::text),0,'No customer identity is returned');

select * from finish();
rollback;
