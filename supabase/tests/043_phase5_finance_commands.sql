begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-076 synthetic fixtures only. Covers the finance operator command gateway: the actor
-- is the signed-in user, second-person commands bind an exact stored command approved by a
-- different finance operator in their own session, and every command reaches the unchanged
-- kernel. TRACE-077 made hold release a one-operator command. Kernel entry points moved behind adapters are granted temporarily, as 042 does.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7610000-0000-4000-8000-000000000001','commands-homeowner@example.invalid',now()),
 ('a7610000-0000-4000-8000-000000000002','commands-operator-a@example.invalid',now()),
 ('a7610000-0000-4000-8000-000000000003','commands-operator-b@example.invalid',now()),
 ('a7610000-0000-4000-8000-000000000004','commands-plain-admin@example.invalid',now()),
 ('a7610000-0000-4000-8000-000000000005','commands-operator-c@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7610000-0000-4000-8000-000000000002','admin'),('a7610000-0000-4000-8000-000000000003','admin'),
 ('a7610000-0000-4000-8000-000000000004','admin'),('a7610000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a7610000-0000-4000-8000-000000000002','a7610000-0000-4000-8000-000000000003','Synthetic test'),
 ('a7610000-0000-4000-8000-000000000003','a7610000-0000-4000-8000-000000000002','Synthetic test'),
 ('a7610000-0000-4000-8000-000000000005','a7610000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a7620000-0000-4000-8000-000000000001','Synthetic command payee',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('a7630000-0000-4000-8000-000000000001','Synthetic command payee','Test','Commands','commands-payee@example.invalid','synthetic','a7620000-0000-4000-8000-000000000001');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 values('a7620000-0000-4000-8000-000000000001',
   (select id from public.vendor_application_versions where application_id='a7630000-0000-4000-8000-000000000001'),3,'active');
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1','Synthetic '||k,now()-interval '30 days',now()+interval '1 year','a7610000-0000-4000-8000-000000000002'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='a7620000-0000-4000-8000-000000000001';

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
  perform pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a7610000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.new_order(label text,confirmed_hours integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a7610000-0000-4000-8000-000000000001','a7620000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a7610000-0000-4000-8000-000000000002','a7610000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a7610000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-attempt',attempt.id),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_cmd_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_cmd_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_cmd_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  if confirmed_hours is not null then
    update public.service_requests set status='completed',homeowner_confirmed_at=now()-make_interval(hours=>confirmed_hours) where id=request;
    insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
      values(request,'a7610000-0000-4000-8000-000000000001','a7620000-0000-4000-8000-000000000001',now()-make_interval(hours=>confirmed_hours));
  end if;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.payable_ok(label text) returns boolean language plpgsql as $$
begin
  perform public.money_payable(pg_temp.id(label));
  return true;
exception when others then return false;
end $$;
create function pg_temp.ops() returns jsonb language sql as $$ select public.money_finance_operations() $$;
create function pg_temp.request_of(p_request uuid) returns jsonb language sql as $$
 select v from jsonb_array_elements(public.money_finance_operations()->'requests') v where v->>'request_id'=p_request::text $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text) to authenticated;

select pg_temp.new_order('hold',72);
select pg_temp.new_order('readback',72);
select pg_temp.new_order('statement',72);
select pg_temp.new_order('refund',72);
-- END CONCURRENCY SETUP

-- Grants: the gateway is the only browser path; the kernels and refund functions stay service-only.
select is(has_function_privilege('authenticated','public.money_operator_place_hold(uuid,text,text,text)','execute'),true,'Signed-in users may call the hold gateway');
select is(has_function_privilege('authenticated','public.money_operator_execute_review(uuid)','execute'),true,'Signed-in users may call the review executor');
select is(has_function_privilege('anon','public.money_operator_place_hold(uuid,text,text,text)','execute'),false,'Anonymous callers hold no gateway grant');
select is(has_function_privilege('anon','public.money_finance_operations()','execute'),false,'Anonymous callers cannot read operations');
select is(has_function_privilege('authenticated','public.money_place_hold(uuid,text,uuid,text,text)','execute'),false,'The hold kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_exclude_event(text,uuid,uuid,text,text)','execute'),false,'The exclusion kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_resolve_reconciliation(uuid,uuid,uuid,text)','execute'),false,'The resolution kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_replay_event(text,uuid,text)','execute'),false,'The replay kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_refund_readback_target(uuid,uuid)','execute'),false,'Refund readback target is not browser-callable');
select is(has_function_privilege('authenticated','public.money_record_refund_readback(uuid,uuid,text,text,bigint)','execute'),false,'Refund readback recording is not browser-callable');
select is(has_function_privilege('service_role','public.money_record_refund_readback(uuid,uuid,text,text,bigint)','execute'),true,'The refund Edge function may record readbacks');
select is(has_function_privilege('authenticated','private.money_review_blocker(text,text)','execute'),false,'Private helpers stay closed');
select is((select count(*)::integer from pg_proc p where p.proname like 'money_operator_%' and pronamespace='public'::regnamespace
  and exists(select 1 from unnest(proargnames) a where a in ('p_actor','p_approver'))),0,'No gateway function accepts an actor or approver');

-- Access: finance authority, on the authenticated role.
set local role authenticated;
select throws_ok($$select public.money_finance_operations()$$,'42501','Restricted finance authority required','No signed-in user is refused');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000001');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'r','e','k-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot place a hold');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'r','e','k-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot place a hold');
select throws_ok($$select public.money_finance_operations()$$,'42501','Restricted finance authority required','An admin without finance authority cannot read operations');
select throws_ok($$select public.money_place_hold(pg_temp.id('hold'),'k-direct','a7610000-0000-4000-8000-000000000002','r','e')$$,'42501',null,'A browser cannot call the kernel with another operator as actor');

-- Payout hold: one operator places, attributed to the session user, replayable by key.
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
select lives_ok($$select public.money_finance_operations()$$,'A finance operator reads operations');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),' ','Ticket 1','cmd-hold-1')$$,'22023','Reason of up to 1000 characters required','A hold needs a reason');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'Quality complaint',null,'cmd-hold-1')$$,'22023','Evidence of up to 1000 characters required','A hold needs evidence');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'Quality complaint','Ticket 1','')$$,'22023','Idempotency key required','A hold needs an idempotency key');
select throws_ok($$select public.money_operator_place_hold(gen_random_uuid(),'Quality complaint','Ticket 1','cmd-hold-x')$$,'P0002','Finance obligation not found','An unknown obligation is refused');
reset role;
select is(pg_temp.payable_ok('hold'),true,'Before the hold the payout is payable');
set local role authenticated;
select is((public.money_operator_place_hold(pg_temp.id('hold'),'Quality complaint','Ticket 1','cmd-hold-1')->>'replay')::boolean,false,'Operator A places a hold');
select is((public.money_operator_place_hold(pg_temp.id('hold'),'Quality complaint','Ticket 1','cmd-hold-1')->>'replay')::boolean,true,'The same key replays');
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'Different','Ticket 1','cmd-hold-1')$$,'23505','Hold idempotency conflict','The same key with different text conflicts');
reset role;
insert into f select 'hold-1',id from public.money_holds where business_key='cmd-hold-1';
select is((select actor from public.money_holds where business_key='cmd-hold-1'),'a7610000-0000-4000-8000-000000000002'::uuid,'The hold actor is the session user');
select is(pg_temp.payable_ok('hold'),false,'The hold stops the payout kernel');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('hold'),'Quality complaint','Ticket 1','cmd-hold-1')$$,'23505','Hold idempotency conflict','Another operator cannot replay someone else''s key');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.ops()->'holds') h where h->>'hold_id'=pg_temp.id('hold-1')::text and h->>'placed_by_me'='false' and h->>'evidence'='Ticket 1'),1,'Operator B sees the open hold with its evidence');
reset role;

-- Hold on a statement is refused rather than shown as held.
select pg_temp.kernel_approve(jsonb_build_object('operation','ach','period',current_date,'obligations',array[pg_temp.id('statement')],'bank_ref','private-bank-form','reason','Synthetic weekly ACH'));
select public.money_prepare_ach(current_date,array[pg_temp.id('statement')],'a7610000-0000-4000-8000-000000000002','a7610000-0000-4000-8000-000000000003','private-bank-form','Synthetic weekly ACH');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.money_operator_place_hold(pg_temp.id('statement'),'Late complaint','Ticket 2','cmd-hold-statement')$$,'55000','Payout already on an ACH statement; a hold cannot stop it','A payout already on a statement cannot be held');

-- Hold release: one finance operator (owner decision G3, TRACE-077). The reviewed release request
-- is retired; suite 044 covers second-person approval mechanics on reviewed refunds.
select throws_ok($$select public.money_operator_request_review('hold_resolution',pg_temp.id('hold-1')::text,'Complaint closed','cmd-release-1','Ticket 1 closed')$$,'22023','A payout hold is released by one finance operator; release it directly','Hold release is no longer a reviewed request');
select throws_ok($$select public.money_operator_request_review('payout_release','x','r','cmd-bad-op','e')$$,'22023','Unsupported finance review','Unsupported operations are refused');
select throws_ok($$select public.money_operator_request_review('event_exclusion','evt_cmd_missing','r','cmd-missing-event','e')$$,'P0002','Finance review subject not found','An unknown event is refused');
select throws_ok($$select public.money_operator_release_hold(pg_temp.id('hold-1'),'Complaint closed',' ')$$,'22023','Evidence of up to 1000 characters required','A hold release needs evidence');
select throws_ok($$select public.money_operator_release_hold(pg_temp.id('hold-1'),' ','Ticket 1 closed')$$,'22023','Reason of up to 1000 characters required','A hold release needs a reason');
select throws_ok($$select public.money_operator_release_hold(gen_random_uuid(),'Complaint closed','Ticket 1 closed')$$,'P0002','Payout hold not found','An unknown hold is refused');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_operator_release_hold(pg_temp.id('hold-1'),'Complaint closed','Ticket 1 closed')$$,'42501','Restricted finance authority required','An admin without finance authority cannot release a hold');
select throws_ok($$select command from public.money_review_requests$$,'42501',null,'Browser roles cannot read stored commands directly');
-- Operator B, who did not place the hold, releases it alone.
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
select is((public.money_operator_release_hold(pg_temp.id('hold-1'),'Complaint closed','Ticket 1 closed')->>'replay')::boolean,false,'One finance operator releases the hold');
select is((public.money_operator_release_hold(pg_temp.id('hold-1'),'Complaint closed','Ticket 1 closed')->>'replay')::boolean,true,'The same release replays');
select throws_ok($$select public.money_operator_release_hold(pg_temp.id('hold-1'),'Other reason','Ticket 1 closed')$$,'55000','Payout hold already released','A different release of a released hold is refused');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_release_hold(pg_temp.id('hold-1'),'Complaint closed','Ticket 1 closed')$$,'55000','Payout hold already released','Another operator cannot replay someone else''s release');
select is(jsonb_array_length(pg_temp.ops()->'holds'),0,'No open hold remains');
reset role;
select is((select actor from public.money_hold_resolutions where hold_id=pg_temp.id('hold-1')),'a7610000-0000-4000-8000-000000000003'::uuid,'The release actor is the session user');
select is(pg_temp.payable_ok('hold'),true,'The released payout is payable again');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;

-- Stripe readback: one operator records; a match needs a two-person resolution.
select throws_ok($$select public.money_operator_record_readback(pg_temp.id('readback'),-1,'usd','Stripe pi_cmd_readback','cmd-rb-neg')$$,'22023','Observed amount in cents required','A negative observation is refused');
select throws_ok($$select public.money_operator_record_readback(pg_temp.id('readback'),11700,'USD','Stripe pi_cmd_readback','cmd-rb-cur')$$,'22023','Three-letter lowercase currency required','Currency must be lowercase ISO');
select throws_ok($$select public.money_operator_record_readback(pg_temp.id('readback'),11700,'usd',' ','cmd-rb-ev')$$,'22023','Evidence of up to 1000 characters required','A readback needs evidence');
select is((public.money_operator_record_readback(pg_temp.id('readback'),11600,'usd','Stripe pi_cmd_readback shows 116.00','cmd-rb-1')->>'matched')::boolean,false,'A mismatching readback records');
reset role;
select is((select reconciliation_open from public.money_obligations where id=pg_temp.id('readback')),true,'The mismatch opens the reconciliation hold');
select is(pg_temp.payable_ok('readback'),false,'The mismatch stops the payout kernel');
insert into f select 'rb-1',id from public.money_reconciliation where observation_key='cmd-rb-1';
select is((select actor from public.money_readback_entries where observation_id=pg_temp.id('rb-1')),'a7610000-0000-4000-8000-000000000002'::uuid,'The readback is attributed to the session user');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is((public.money_operator_record_readback(pg_temp.id('readback'),11600,'usd','Stripe pi_cmd_readback shows 116.00','cmd-rb-1')->>'replay')::boolean,true,'The same readback key replays');
select throws_ok($$select public.money_operator_record_readback(pg_temp.id('readback'),11700,'usd','Stripe pi_cmd_readback shows 116.00','cmd-rb-1')$$,'23505','Readback idempotency conflict','The same readback key with another amount conflicts');
select throws_ok($$select public.money_operator_record_readback(pg_temp.id('readback'),11600,'usd','Stripe balance txn instead','cmd-rb-1')$$,'23505','Readback idempotency conflict','The same readback key with other evidence conflicts');
select throws_ok($$select public.money_operator_request_review('reconciliation_resolution',pg_temp.id('rb-1')::text,'Resolved','cmd-res-mismatch',null)$$,'55000','Finance review not actionable: readback_mismatch','A mismatching readback cannot be resolved');
select is((select r->>'resolution_blocker' from jsonb_array_elements(pg_temp.ops()->'readbacks') r where r->>'obligation_id'=pg_temp.id('readback')::text),'readback_mismatch','Operations read back why it cannot be resolved');
select is((public.money_operator_record_readback(pg_temp.id('readback'),11700,'usd','Stripe pi_cmd_readback shows 117.00','cmd-rb-2')->>'matched')::boolean,true,'Operator A records a matching readback');
reset role;
insert into f select 'rb-2',id from public.money_reconciliation where observation_key='cmd-rb-2';
select is((select reconciliation_open from public.money_obligations where id=pg_temp.id('readback')),true,'A match alone does not clear the hold');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.money_operator_request_review('reconciliation_resolution',pg_temp.id('rb-1')::text,'Resolved','cmd-res-old',null)$$,'55000','Finance review not actionable: readback_superseded','A superseded readback cannot be resolved');
select throws_ok($$select public.money_operator_request_review('reconciliation_resolution',pg_temp.id('rb-2')::text,'Resolved','cmd-res-ev','extra')$$,'22023','A readback resolution takes no separate evidence','A resolution carries no separate evidence');
insert into f select 'resolve-1',(public.money_operator_request_review('reconciliation_resolution',pg_temp.id('rb-2')::text,'Stripe now matches the ledger','cmd-res-1',null)->>'request_id')::uuid;
select is((pg_temp.request_of(pg_temp.id('resolve-1'))->>'recorded_by_me')::boolean,true,'The requester recorded this readback');
select is((pg_temp.request_of(pg_temp.id('resolve-1'))->>'obligation_id')::uuid,pg_temp.id('readback'),'The request names its obligation');
-- Operator B records a later matching readback on another order, then may not approve its resolution.
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
select public.money_operator_record_readback(pg_temp.id('refund'),11600,'usd','Stripe pi_cmd_refund shows 116.00','cmd-rb-b1');
select public.money_operator_record_readback(pg_temp.id('refund'),11700,'usd','Stripe pi_cmd_refund shows 117.00','cmd-rb-b2');
reset role;
insert into f select 'rb-b2',id from public.money_reconciliation where observation_key='cmd-rb-b2';
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
insert into f select 'resolve-b',(public.money_operator_request_review('reconciliation_resolution',pg_temp.id('rb-b2')::text,'Matches after correction','cmd-res-b',null)->>'request_id')::uuid;
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('resolve-b'),'Looks right')$$,'42501','The operator who recorded this readback cannot approve its resolution','The readback recorder cannot approve its resolution');
reset role;
-- Even a direct kernel approval by the recorder is not used at execution.
select pg_temp.kernel_approve((select command from public.money_review_requests where business_key='cmd-res-b'));
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('resolve-b'))->>'state','awaiting_approval','A recorder''s direct approval does not make it approved');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('resolve-b'))$$,'42501','Separate authenticated approval of exact financial command required','A recorder''s approval cannot execute');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000005');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('resolve-b'),'Checked Stripe pi_cmd_refund')$$,'A third operator approves');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
select is((public.money_operator_execute_review(pg_temp.id('resolve-b'))->>'replay')::boolean,false,'The requester executes with the third operator as approver');
reset role;
select is((select approver from public.money_reconciliation_resolutions where observation_id=pg_temp.id('rb-b2')),'a7610000-0000-4000-8000-000000000005'::uuid,'The kernel records the eligible approver, not the recorder');
select is((select reconciliation_open from public.money_obligations where id=pg_temp.id('refund')),false,'The resolution clears the hold');
-- Resolution 1: Operator B approves (did not record rb-2); money moved in between makes it stale first.
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('resolve-1'),'Confirmed in Stripe')$$,'Operator B approves the readback resolution');
reset role;
savepoint stale_readback;
update public.money_obligations set captured=captured-1 where id=pg_temp.id('readback');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('resolve-1'))->>'state','stale','An approved resolution goes stale when money moves');
select is(pg_temp.request_of(pg_temp.id('resolve-1'))->>'blocker','readback_outdated','It says the readback is outdated');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('resolve-1'))$$,'55000','Finance review not actionable: readback_outdated','A stale approved command cannot execute');
reset role;
rollback to savepoint stale_readback;
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is((public.money_operator_execute_review(pg_temp.id('resolve-1'))->>'replay')::boolean,false,'The requester executes the resolution');
reset role;
select is((select reconciliation_open from public.money_obligations where id=pg_temp.id('readback')),false,'The resolution clears the reconciliation hold');
select ok((select (actor,approver)=('a7610000-0000-4000-8000-000000000002'::uuid,'a7610000-0000-4000-8000-000000000003'::uuid)
  from public.money_reconciliation_resolutions where observation_id=pg_temp.id('rb-2')),'The kernel records requester and approver');
select is(pg_temp.payable_ok('readback'),true,'The resolved payout is payable again');

-- Events: replay by one operator; exclusion of an unsupported event by two clears the global hold.
select public.money_receive_event('evt_cmd_unsupported','reconciliation_required','{"source_type":"charge.updated"}');
select is(pg_temp.payable_ok('readback'),false,'An unsupported event holds every payout (owner decision: kept global)');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.money_operator_request_review('event_exclusion','evt_cmd_unsupported','Not a money event','cmd-ex-early','Stripe evt shows charge.updated metadata')$$,'55000','Finance review not actionable: event_not_failed','An event that has not failed cannot be excluded');
select throws_ok($$select public.money_operator_replay_event('evt_cmd_unsupported',' ')$$,'22023','Reason of up to 1000 characters required','Replay needs a reason');
select throws_ok($$select public.money_operator_replay_event('evt_cmd_missing','Retry')$$,'P0002','Stripe event not found','Replay of an unknown event is refused');
select throws_ok($$select public.money_operator_replay_event('evt_cmd_hold','Retry')$$,'55000','Stripe event already processed','Replay of a processed event is refused');
select is(public.money_operator_replay_event('evt_cmd_unsupported','Process after webhook outage')->>'status','failed','Replay runs the kernel; an unsupported event fails');
reset role;
select is((select actor from public.money_event_replays where event_id='evt_cmd_unsupported'),'a7610000-0000-4000-8000-000000000002'::uuid,'The replay is attributed to the session user');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select e->>'exclusion_blocker' from jsonb_array_elements(pg_temp.ops()->'events') e where e->>'event_id'='evt_cmd_unsupported'),null,'The failed unsupported event is excludable');
select is((select (e->>'holds_all_payouts')::boolean from jsonb_array_elements(pg_temp.ops()->'events') e where e->>'event_id'='evt_cmd_unsupported'),true,'Operations say it holds every payout');
select throws_ok($$select public.money_operator_request_review('event_exclusion','evt_cmd_hold','No effect','cmd-ex-processed','Stripe')$$,'55000','Finance review not actionable: event_not_failed','A processed event cannot be excluded');
insert into f select 'exclude-1',(public.money_operator_request_review('event_exclusion','evt_cmd_unsupported','Informational charge.updated, no money moved','cmd-ex-1','Stripe Dashboard evt_cmd_unsupported: metadata-only update')->>'request_id')::uuid;
select is(pg_temp.request_of(pg_temp.id('exclude-1'))->>'obligation_id',null,'An unsupported event names no obligation');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('exclude-1'),'Read evt_cmd_unsupported back at Stripe')$$,'Operator B approves the exclusion');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
select is((public.money_operator_execute_review(pg_temp.id('exclude-1'))->>'operation'),'event_exclusion','Operator A executes the exclusion');
select throws_ok($$select public.money_operator_replay_event('evt_cmd_unsupported','Retry')$$,'55000','Excluded event requires a new reviewed reconciliation, not replay','An excluded event cannot be replayed');
select is(jsonb_array_length(pg_temp.ops()->'events'),0,'No unprocessed event remains');
reset role;
select ok((select (actor,approver,reason)=('a7610000-0000-4000-8000-000000000002'::uuid,'a7610000-0000-4000-8000-000000000003'::uuid,'Informational charge.updated, no money moved')
  from public.money_event_exclusions where event_id='evt_cmd_unsupported'),'The kernel records the exclusion with both operators');
select is(pg_temp.payable_ok('readback'),true,'Excluding the unsupported event lifts the global hold');
-- An event with financial effects cannot be excluded.
select public.money_receive_event('evt_cmd_bad_capture','capture',jsonb_build_object('attempt_id',pg_temp.id('refund-attempt'),'payment_id','pi_cmd_refund','amount',1,'currency','usd'));
select public.money_process_event('evt_cmd_bad_capture');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
insert into f select 'exclude-capture',(public.money_operator_request_review('event_exclusion','evt_cmd_bad_capture','Duplicate test capture','cmd-ex-capture','Stripe shows no such capture')->>'request_id')::uuid;
select is((pg_temp.request_of(pg_temp.id('exclude-capture'))->>'obligation_id')::uuid,pg_temp.id('refund'),'A payment event request names its obligation');
reset role;
savepoint effects;
insert into public.money_journals(obligation_id,business_key,kind,lines,evidence) values(pg_temp.id('refund'),'synthetic:effect','processor_cost',
  '[{"account":"processor_expense","debit":1,"credit":0},{"account":"stripe_clearing","debit":0,"credit":1}]','evt_cmd_bad_capture');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('exclude-capture'),'ok')$$,'55000','Finance review not actionable: event_has_effects','An event with ledger effects cannot be approved for exclusion');
reset role;
rollback to savepoint effects;

-- Refund readback functions for the Edge gateway.
select pg_temp.kernel_approve(jsonb_build_object('operation','refund','obligation',pg_temp.id('refund'),'payment','pi_cmd_refund','service',2000,'tax',140,'tip',0,'key','cmd-refund','policy','synthetic-CFG-006','reason','Synthetic adjustment'));
insert into f values('refund-auth',public.money_authorize_refund(pg_temp.id('refund'),'pi_cmd_refund',2000,140,0,'cmd-refund','a7610000-0000-4000-8000-000000000002','a7610000-0000-4000-8000-000000000003','synthetic-CFG-006','Synthetic adjustment'));
select throws_ok($$select public.money_refund_readback_target(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000004')$$,'42501','Restricted finance authority required','Refund readback needs finance authority');
select is(public.money_refund_readback_target(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005')->>'attempt_status','not_started','An unsent refund reads not started');
select is((select count(*)::integer from public.money_refund_attempts where authorization_id=pg_temp.id('refund-auth')),0,'Reading the target creates no attempt');
select throws_ok($$select public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005',null,null,null)$$,'55000','Refund was not sent; nothing to read back','An unsent refund cannot be read back');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select (r->>'can_send')::boolean from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),true,'The refund creator may send it');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000005');
select is((select (r->>'can_send')::boolean from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),false,'A third operator may not send it');
reset role;
select public.money_prepare_refund(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000002');
select is((public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005',null,null,null)->>'found')::boolean,false,'Not found at Stripe is recorded');
select is(public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005','re_cmd','pending',2140)->>'attempt_status','pending','A found refund records its Stripe status');
select throws_ok($$select public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005',null,null,null)$$,'55000','Refund reference already recorded','A known reference cannot later read as not found');
select throws_ok($$select public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005','re_cmd','succeeded',2000)$$,'P0001','Refund provider mismatch','A readback with another amount is refused by the kernel');
select is(public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7610000-0000-4000-8000-000000000005','re_cmd','succeeded',2140)->>'attempt_status','pending','Stripe success alone does not settle the refund without its event');
select is((select count(*)::integer from public.money_refund_readbacks where authorization_id=pg_temp.id('refund-auth') and actor='a7610000-0000-4000-8000-000000000005'),3,'Each readback is attributed to the verified user');
select pg_temp.as_user('a7610000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select r->'last_readback'->>'provider_status' from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),'succeeded','Operations show the last Stripe readback');
select is((select r ? 'created_by' from jsonb_array_elements(pg_temp.ops()->'refunds') r limit 1),false,'Operator identities are not returned');
reset role;

select * from finish();
rollback;
