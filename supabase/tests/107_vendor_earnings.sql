-- TRACE-135 (Phase 6.12B, 20261107001000, DEC-2026-056). Synthetic fixtures only. A provider reads
-- its own earnings: provider-funds state per job, hold categories, amounts only once captured, the
-- eligibility date but no payout date, the live transfer status, and one statement per weekly ACH
-- batch. No provider parameter, no bank account, bank reference, approver, hold reason or other
-- provider's job; the readback writes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 finance operator; 2 finance reviewer; 3 homeowner; 4 vendor A; 5 vendor B; 6 admin, not a vendor.
insert into auth.users(id,email,email_confirmed_at) values
 ('b1070000-0000-4000-8000-000000000001','earn-operator@example.invalid',now()),
 ('b1070000-0000-4000-8000-000000000002','earn-reviewer@example.invalid',now()),
 ('b1070000-0000-4000-8000-000000000003','earn-homeowner@example.invalid',now()),
 ('b1070000-0000-4000-8000-000000000004','earn-vendor-a@example.invalid',now()),
 ('b1070000-0000-4000-8000-000000000005','earn-vendor-b@example.invalid',now()),
 ('b1070000-0000-4000-8000-000000000006','earn-admin@example.invalid',now());
delete from public.user_roles where user_id::text like 'b1070000-%';
insert into public.user_roles(user_id,role) values
 ('b1070000-0000-4000-8000-000000000001','admin'),('b1070000-0000-4000-8000-000000000002','admin'),
 ('b1070000-0000-4000-8000-000000000004','vendor'),('b1070000-0000-4000-8000-000000000005','vendor'),
 ('b1070000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('b1070000-0000-4000-8000-000000000001','b1070000-0000-4000-8000-000000000002','Synthetic test'),
 ('b1070000-0000-4000-8000-000000000002','b1070000-0000-4000-8000-000000000001','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b1071000-0000-4000-8000-00000000000a','Synthetic earnings vendor A',true,false,'b1070000-0000-4000-8000-000000000004'),
 ('b1071000-0000-4000-8000-00000000000b','Synthetic earnings vendor B',true,false,'b1070000-0000-4000-8000-000000000005');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('b1072000-0000-4000-8000-00000000000a','Synthetic earnings vendor A','Test','A','earn-vendor-a@example.invalid','synthetic','b1071000-0000-4000-8000-00000000000a'),
 ('b1072000-0000-4000-8000-00000000000b','Synthetic earnings vendor B','Test','B','earn-vendor-b@example.invalid','synthetic','b1071000-0000-4000-8000-00000000000b');

create temp table f(key text primary key,id uuid);
grant select on f to authenticated;
create function pg_temp.id(p_key text) returns uuid language sql as $$ select id from f where key=p_key $$;
create function pg_temp.a() returns uuid language sql as $$ select 'b1071000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'b1071000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1070000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',0,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('2');
  perform public.money_approve_review('b1070000-0000-4000-8000-000000000001',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- One synthetic job for a provider: reviewed snapshot, optionally fully captured, completed by the
-- provider and, when given, confirmed by the homeowner that many hours ago.
create function pg_temp.job(p_label text,p_contractor uuid,p_captured boolean,p_confirmed interval) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform pg_temp.as_user('1');
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address,matching_status)
    values(request,'b1070000-0000-4000-8000-000000000003',p_contractor,'house-cleaning','Synthetic address','matched');
  perform pg_temp.approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  perform private.money_publish_snapshot(request,pg_temp.terms(),'b1070000-0000-4000-8000-000000000001','b1070000-0000-4000-8000-000000000002');
  if p_captured then update public.money_obligations set captured=11700 where service_request_id=request; end if;
  update public.service_requests set status='vendor_completed',vendor_completed_at=now()-interval '4 days',photo_proof_urls=array['synthetic-proof'] where id=request;
  if p_confirmed is not null then
    update public.service_requests set status='completed',homeowner_confirmed_at=now()-p_confirmed where id=request;
    insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
      values(request,'b1070000-0000-4000-8000-000000000003',p_contractor,now()-p_confirmed);
  end if;
  insert into f values(p_label||'-request',request),(p_label,(select id from public.money_obligations where service_request_id=request));
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.earnings() returns jsonb language sql as $$ select public.vendor_own_earnings() $$;
create function pg_temp.row_of(p_label text) returns jsonb language sql as $$
 select j from jsonb_array_elements(public.vendor_own_earnings()->'jobs') j where j->>'job_id'=(select id::text from f where key=p_label||'-request') $$;
create function pg_temp.attempt(p_label text) returns uuid language sql as $$
 select a.id from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id
 where i.obligation_id=(select id from f where key=p_label) order by a.attempt_number desc limit 1 $$;
create function pg_temp.bank(p_label text,p_status text,p_ref text) returns void language sql as $$
 select public.money_record_ach(pg_temp.attempt(p_label),p_status,p_ref,'b1070000-0000-4000-8000-000000000001','Synthetic bank evidence',p_label||'-'||p_status) $$;
create function pg_temp.written() returns text language sql security definer as $$
 select concat_ws('|',(select count(*) from public.money_obligations),(select sum(captured) from public.money_obligations),
   (select count(*) from public.money_completion_evidence),(select count(*) from public.money_journals),
   (select count(*) from public.money_ach_items),(select string_agg(id||':'||status,',' order by id) from public.money_ach_attempts),
   (select count(*) from public.money_ach_events),(select count(*) from public.money_holds),(select count(*) from public.money_hold_resolutions),
   (select count(*) from public.money_reconciliation),(select count(*) from public.notifications)) $$;

-- Onboarding for A and B through the operator commands: nine current items, then activation.
select pg_temp.as_user('1');
do $$ declare v uuid; kind text; begin
  foreach v in array array['b1071000-0000-4000-8000-00000000000a','b1071000-0000-4000-8000-00000000000b']::uuid[] loop
    perform public.vendor_begin_review(v,(select x.id from public.vendor_application_versions x join public.vendor_applications a on a.id=x.application_id
      where a.contractor_id=v order by x.revision desc limit 1));
    foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
      perform public.vendor_record_evidence(v,kind,'synthetic-rule','SECRET-EVIDENCE-'||kind,now()-interval '1 hour',now()+interval '1 year');
    end loop;
    perform public.vendor_decide_onboarding(v,1,'activate','Synthetic review','activate-'||v);
  end loop;
end $$;

-- Vendor A's jobs, one per state.
select pg_temp.job('unpaid',pg_temp.a(),false,interval '60 hours');
select pg_temp.job('unconfirmed',pg_temp.a(),true,null);
select pg_temp.job('window',pg_temp.a(),true,interval '47 hours 59 minutes');
select pg_temp.job('eligible',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('held',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('chargeback',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('disputed',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('prepared',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('sent',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('unknown',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('paid',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('failed',pg_temp.a(),true,interval '49 hours');
select pg_temp.job('returned',pg_temp.a(),true,interval '49 hours');
-- Vendor B: one eligible job and one replaced from A to B.
select pg_temp.job('b-eligible',pg_temp.b(),true,interval '49 hours');
select pg_temp.job('replaced',pg_temp.a(),true,null);

-- One weekly batch with six of A's payouts, then each transfer's bank outcome.
select pg_temp.as_user('1');
select pg_temp.approve(jsonb_build_object('operation','ach','period',current_date-7,'obligations',
  array[pg_temp.id('prepared'),pg_temp.id('sent'),pg_temp.id('unknown'),pg_temp.id('paid'),pg_temp.id('failed'),pg_temp.id('returned')],
  'bank_ref','SECRET-BANK-BATCH','reason','Synthetic weekly ACH'));
insert into f values('batch',public.money_prepare_ach(current_date-7,
  array[pg_temp.id('prepared'),pg_temp.id('sent'),pg_temp.id('unknown'),pg_temp.id('paid'),pg_temp.id('failed'),pg_temp.id('returned')],
  'b1070000-0000-4000-8000-000000000001','b1070000-0000-4000-8000-000000000002','SECRET-BANK-BATCH','Synthetic weekly ACH'));
select pg_temp.bank('sent','submitted','SECRET-REF-SENT');
select pg_temp.bank('unknown','submitted','SECRET-REF-UNKNOWN');
select pg_temp.bank('unknown','unknown','SECRET-REF-UNKNOWN');
select pg_temp.bank('paid','submitted','SECRET-REF-PAID');
select pg_temp.bank('paid','settled','SECRET-REF-PAID');
select pg_temp.bank('failed','submitted','SECRET-REF-FAILED');
select pg_temp.bank('failed','failed','SECRET-REF-FAILED');
select pg_temp.bank('returned','submitted','SECRET-REF-RETURNED');
select pg_temp.bank('returned','settled','SECRET-REF-RETURNED');
select pg_temp.bank('returned','returned','SECRET-REF-RETURNED');

-- Holds placed after the batch: a payout hold, an open chargeback, an open dispute.
select public.money_place_hold(pg_temp.id('held'),'earn-hold','b1070000-0000-4000-8000-000000000001','SECRET-HOLD-REASON','SECRET-HOLD-EVIDENCE');
update public.money_obligations set dispute_open=true where id=pg_temp.id('chargeback');
insert into public.disputes(job_id,homeowner_id,vendor_id,reason,status)
 values(pg_temp.id('disputed-request'),'b1070000-0000-4000-8000-000000000003',pg_temp.a(),'SECRET-DISPUTE-REASON','open');
update public.service_requests set status='disputed',disputed=true where id=pg_temp.id('disputed-request');

-- The replacement payee, arranged as the database owner (its operation and decision records are
-- outside this readback; 027 exercises the real reconciliation command).
set local session_replication_role = replica;
insert into public.money_replacement_reconciliations(obligation_id,operation_id,replacement_decision_id,snapshot_id,original_contractor_id,
  replacement_contractor_id,captured,source_hash,created_by,approved_by,reason)
 select o.id,gen_random_uuid(),gen_random_uuid(),o.current_snapshot_id,pg_temp.a(),pg_temp.b(),11700,'synthetic-hash',
  'b1070000-0000-4000-8000-000000000001','b1070000-0000-4000-8000-000000000002','Synthetic replacement'
 from public.money_obligations o where o.id=pg_temp.id('replaced');
set local session_replication_role = origin;
select pg_temp.as_user('1');
reset role;

-- Access ------------------------------------------------------------------------------------------
select is(has_function_privilege('anon','public.vendor_own_earnings()','execute'),false,'Anonymous callers hold no execute grant');
select is(has_function_privilege('authenticated','public.vendor_own_earnings()','execute'),true,'Signed-in callers may execute; the body checks the vendor role');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='vendor_own_earnings' and p.pronargs=0),
  1::bigint,'The readback takes no provider parameter');
select is((select provolatile from pg_proc where oid='public.vendor_own_earnings()'::regprocedure),'s'::"char",'The readback is stable');
set local role authenticated;
select set_config('request.jwt.claims','',true);
select throws_ok($$select public.vendor_own_earnings()$$,'42501','Vendor account required','No signed-in user is refused');
select pg_temp.as_user('3');
select throws_ok($$select public.vendor_own_earnings()$$,'42501','Vendor account required','A homeowner is refused');
select pg_temp.as_user('6');
select throws_ok($$select public.vendor_own_earnings()$$,'42501','Vendor account required','An admin without a vendor role is refused');

-- Vendor A -----------------------------------------------------------------------------------------
select pg_temp.as_user('4');
create temp table before_read as select pg_temp.written() as v;
grant select on before_read to authenticated;
select is((pg_temp.earnings()->>'provider_found')::boolean,true,'A provider is found from the signed-in account');
select is(jsonb_array_length(pg_temp.earnings()->'jobs'),13,'Vendor A sees its own thirteen jobs');
select is(pg_temp.row_of('b-eligible'),null,'Vendor B''s job is absent for A');
select is(pg_temp.row_of('replaced'),null,'A job replaced to another provider is absent for the original provider');

select is(pg_temp.row_of('unpaid')->>'state','waiting_payment','Uncaptured payment reads Waiting for payment');
select is(pg_temp.row_of('unpaid')->'amounts','null'::jsonb,'No amount before capture (DEC-2026-056 item 4)');
select is(pg_temp.row_of('unpaid')->'received','null'::jsonb,'No received amount before capture');
select is(pg_temp.row_of('unconfirmed')->>'state','awaiting_confirmation','No homeowner confirmation reads awaiting confirmation');
select is(pg_temp.row_of('unconfirmed')->'eligible_at','null'::jsonb,'No eligibility date before confirmation');
select is(pg_temp.row_of('window')->>'state','confirmation_window','Inside 48 hours of confirmation');
select is((pg_temp.row_of('window')->>'eligible_at')::timestamptz,now()+interval '1 minute','Eligibility is confirmation plus 48 hours');
select is(pg_temp.row_of('eligible')->>'state','eligible','Past 48 hours with no hold reads eligible');
select is((pg_temp.row_of('eligible')->>'eligible_at')::timestamptz,now()-interval '1 hour','Eligible since confirmation plus 48 hours');
select is(pg_temp.row_of('eligible')->'amounts',
  '{"service":10000,"platform_fee":1500,"platform_subsidy":0,"tips":1000,"payout":9500}'::jsonb,
  'Captured amounts: service, 15 percent fee, tips and payout');
select is(pg_temp.row_of('eligible')->'transfer','null'::jsonb,'An eligible payout is on no transfer');

select is(pg_temp.row_of('held')->>'state','held','A payout hold reads held');
select is(pg_temp.row_of('held')->'holds','["mercurius"]'::jsonb,'A payout hold is shown as held by Mercurius');
select is(pg_temp.row_of('chargeback')->'holds','["payment_review"]'::jsonb,'An open chargeback is shown as payment under review');
select is(pg_temp.row_of('disputed')->>'state','held','An open dispute holds the payout');
select is(pg_temp.row_of('disputed')->'holds','["dispute"]'::jsonb,'An open dispute is shown as a dispute hold');

select is(pg_temp.row_of('prepared')->>'state','in_transfer','A prepared transfer reads in a transfer');
select is(pg_temp.row_of('prepared')->'transfer'->>'week_start',(current_date-7)::text,'The transfer names its week start');
select is(pg_temp.row_of('prepared')->'transfer'->>'week_end',(current_date-1)::text,'The transfer names its last day');
select is((pg_temp.row_of('prepared')->'transfer'->>'amount')::bigint,9500::bigint,'The transfer carries the statement amount');
select is(pg_temp.row_of('prepared')->'eligible_at','null'::jsonb,'A payout on a transfer shows no eligibility date');
select is(pg_temp.row_of('sent')->>'state','sent','A submitted transfer reads sent');
select is(pg_temp.row_of('unknown')->>'state','unknown','An unknown bank outcome reads unknown');
select is((pg_temp.row_of('unknown')->>'received')::bigint,0::bigint,'An unknown outcome is not counted as paid');
select is(pg_temp.row_of('paid')->>'state','paid','A settled transfer reads paid');
select is((pg_temp.row_of('paid')->>'received')::bigint,9500::bigint,'A settled transfer counts as received');
select is(pg_temp.row_of('failed')->>'state','failed','A failed transfer reads failed');
select is((pg_temp.row_of('failed')->>'received')::bigint,0::bigint,'A failed transfer is not paid');
select is(pg_temp.row_of('returned')->>'state','returned','A returned transfer reads returned');
select is((pg_temp.row_of('returned')->>'received')::bigint,0::bigint,'A returned transfer is no longer paid (settled minus returned)');

select is(pg_temp.earnings()->'totals'->'paid','{"count":1,"amount":9500}'::jsonb,'Paid total counts what the bank paid, once');
select is(pg_temp.earnings()->'totals'->'eligible','{"count":1,"amount":9500}'::jsonb,'Eligible total');
select is(pg_temp.earnings()->'totals'->'waiting_payment','{"count":1,"amount":null}'::jsonb,'Waiting for payment carries no amount');
select is(pg_temp.earnings()->'totals'->'held','{"count":3,"amount":28500}'::jsonb,'Held total over three held jobs');

select is(jsonb_array_length(pg_temp.earnings()->'statements'),1,'One statement for the one weekly batch');
select is(pg_temp.earnings()->'statements'->0->>'week_start',(current_date-7)::text,'Statement week start');
select is(pg_temp.earnings()->'statements'->0->>'week_end',(current_date-1)::text,'Statement week end');
select is(jsonb_array_length(pg_temp.earnings()->'statements'->0->'items'),6,'Statement lists each job in the batch');
select is((pg_temp.earnings()->'statements'->0->>'payout_total')::bigint,57000::bigint,'Statement payout total over its live items');
select is((pg_temp.earnings()->'statements'->0->>'paid_total')::bigint,9500::bigint,'Statement paid total counts settled transfers only');
select is((select jsonb_agg(i->>'status' order by i->>'status') from jsonb_array_elements(pg_temp.earnings()->'statements'->0->'items') i),
  '["failed","prepared","returned","settled","submitted","unknown"]'::jsonb,'Each item shows its latest transfer status');
select is((select i - 'job_id' - 'invoice_number' - 'status' from jsonb_array_elements(pg_temp.earnings()->'statements'->0->'items') i limit 1),
  '{"service":"house-cleaning","service_amount":10000,"platform_fee":1500,"platform_subsidy":0,"tips":1000,"payout":9500}'::jsonb,
  'A statement item shows the recorded service amount, fee, tips and payout');

-- Nothing operator-only: no bank account, reference, approver, actor, reason, evidence or internal ids.
select is(pg_temp.earnings()::text ~ 'SECRET',false,'No bank reference, hold reason, evidence or dispute reason is returned');
select is(pg_temp.earnings()::text ~ '"(bank_[a-z_]*|approved_by|created_by|actor|reason|evidence|obligation_id|contractor_id|payee|blocker|batch_id|snapshot_id|confirmation_ref)"',
  false,'No bank, approver, actor, reason, evidence or internal id keys are returned');
select is(pg_temp.earnings()::text ~ 'earn-homeowner|b1070000-0000-4000-8000-000000000003',false,'No homeowner identity is returned');
select is(pg_temp.written(),(select v from before_read),'Reading earnings writes nothing');

-- Vendor B -----------------------------------------------------------------------------------------
select pg_temp.as_user('5');
select is(jsonb_array_length(pg_temp.earnings()->'jobs'),2,'Vendor B sees its own job and the job replaced to it');
select is(pg_temp.row_of('eligible'),null,'Vendor A''s job is absent for B');
select isnt(pg_temp.row_of('replaced'),null,'The replacement payee sees the replaced job');
select is(pg_temp.row_of('b-eligible')->>'state','eligible','B''s job is eligible');
select is(pg_temp.earnings()->'statements','[]'::jsonb,'B has no statement; A''s batch is absent');
select is((pg_temp.earnings()->>'payout_onboarding_current')::boolean,true,'B''s payout onboarding is current');
reset role;
-- B's payout onboarding lapses: the payout is held under the payout onboarding category.
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by,supersedes)
 select e.contractor_id,e.application_version_id,e.kind,e.requirement_version,'SECRET-EVIDENCE-lapsed',now()-interval '2 days',now()-interval '1 minute',
  'b1070000-0000-4000-8000-000000000001',e.id
 from public.vendor_compliance_evidence e where e.contractor_id=pg_temp.b() and e.kind='bank_authorization'
  and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
set local role authenticated;
select pg_temp.as_user('5');
select is(pg_temp.row_of('b-eligible')->>'state','held','Lapsed payout onboarding holds the payout');
select is(pg_temp.row_of('b-eligible')->'holds','["payout_onboarding"]'::jsonb,'Shown as a payout onboarding hold');
select is((pg_temp.earnings()->>'payout_onboarding_current')::boolean,false,'Payout onboarding reads not current');

-- A vendor account with no provider record.
reset role;
insert into auth.users(id,email,email_confirmed_at) values('b1070000-0000-4000-8000-000000000007','earn-vendor-none@example.invalid',now());
delete from public.user_roles where user_id='b1070000-0000-4000-8000-000000000007';
insert into public.user_roles(user_id,role) values('b1070000-0000-4000-8000-000000000007','vendor');
set local role authenticated;
select pg_temp.as_user('7');
select is(pg_temp.earnings()->'provider_found','false'::jsonb,'A vendor account with no provider reads not found');
select is(pg_temp.earnings()->'jobs','[]'::jsonb,'and has no jobs');
reset role;

select * from finish();
rollback;
