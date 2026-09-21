begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-077 synthetic fixtures only. Covers finance operator commands part 2A: reviewed refund,
-- cancellation refund and lost-chargeback requests run through their unchanged kernels with the
-- requester as author and a different operator as approver; the 24-hour request window (owner
-- decision G9); approvals bound to their request; and the reissue of an uncertain refund.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7710000-0000-4000-8000-000000000001','refunds-homeowner@example.invalid',now()),
 ('a7710000-0000-4000-8000-000000000002','refunds-operator-a@example.invalid',now()),
 ('a7710000-0000-4000-8000-000000000003','refunds-operator-b@example.invalid',now()),
 ('a7710000-0000-4000-8000-000000000004','refunds-plain-admin@example.invalid',now()),
 ('a7710000-0000-4000-8000-000000000005','refunds-operator-c@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7710000-0000-4000-8000-000000000002','admin'),('a7710000-0000-4000-8000-000000000003','admin'),
 ('a7710000-0000-4000-8000-000000000004','admin'),('a7710000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('a7710000-0000-4000-8000-000000000002','a7710000-0000-4000-8000-000000000003','Synthetic test'),
 ('a7710000-0000-4000-8000-000000000003','a7710000-0000-4000-8000-000000000002','Synthetic test'),
 ('a7710000-0000-4000-8000-000000000005','a7710000-0000-4000-8000-000000000002','Synthetic test');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('a7720000-0000-4000-8000-000000000001','Synthetic refunds payee',true,false);

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
  perform pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
  perform public.money_approve_review('a7710000-0000-4000-8000-000000000002',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.new_order(label text) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); snapshot uuid; attempt public.money_checkout_attempts; previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
    values(request,'a7710000-0000-4000-8000-000000000001','a7720000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
  perform pg_temp.kernel_approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
  snapshot:=private.money_publish_snapshot(request,pg_temp.terms(),'a7710000-0000-4000-8000-000000000002','a7710000-0000-4000-8000-000000000003');
  perform pg_temp.as_user('a7710000-0000-4000-8000-000000000001');
  attempt:=private.money_prepare_checkout(snapshot,'full');
  insert into f values(label||'-attempt',attempt.id),(label,attempt.obligation_id);
  perform public.money_receive_event('evt_ref_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_ref_'||label,'amount',attempt.amount,'currency','usd'));
  if public.money_process_event('evt_ref_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
-- A scheduled, fully paid visit the homeowner cancels the given number of hours ahead.
create function pg_temp.cancelled_order(label text,hours_ahead integer) returns void language plpgsql as $$
declare request uuid:=gen_random_uuid(); obligation uuid:=gen_random_uuid(); snapshot uuid:=gen_random_uuid(); op_key uuid:=gen_random_uuid(); previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,scheduled_start_at)
    values(request,'a7710000-0000-4000-8000-000000000001','a7720000-0000-4000-8000-000000000001','Synthetic','Synthetic cancellation','scheduled',now()+make_interval(hours=>hours_ahead));
  insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,captured)
    values(obligation,request,'a7710000-0000-4000-8000-000000000001','a7720000-0000-4000-8000-000000000001',11700);
  insert into public.money_snapshots(id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at)
    values(snapshot,obligation,1,'M5-REF-'||label,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','a7710000-0000-4000-8000-000000000002','a7710000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day');
  update public.money_obligations set current_snapshot_id=snapshot where id=obligation;
  insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,stripe_payment_id,status,expires_at,completed_at)
    values(obligation,snapshot,'a7710000-0000-4000-8000-000000000001','full',11700,'usd','ref-cancel-'||label,'ref-cancel-'||label,'pi_ref_cancel_'||label,'captured',now()+interval '1 day',now());
  perform pg_temp.as_user('a7710000-0000-4000-8000-000000000001');
  set local role authenticated;
  perform public.record_job_operation(request,op_key,'customer_cancel','Synthetic '||label||' cancellation');
  reset role;
  insert into f select 'cancel-'||label,id from public.job_operations where operation_key=op_key;
  insert into f values('cancel-'||label||'-obligation',obligation);
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
create function pg_temp.age_request(p_request uuid,p_age interval) returns void language plpgsql as $$
begin
  alter table public.money_review_requests disable trigger immutable_evidence;
  update public.money_review_requests set created_at=now()-p_age where id=p_request;
  alter table public.money_review_requests enable trigger immutable_evidence;
end $$;
grant usage on schema private to authenticated;
grant execute on function private.money_prepare_checkout(uuid,text) to authenticated;
grant execute on function pg_temp.id(text) to authenticated;

select pg_temp.new_order('refund');
select pg_temp.new_order('stale');
select pg_temp.new_order('dispute');
select pg_temp.cancelled_order('full',73);
select pg_temp.cancelled_order('half',25);
select pg_temp.cancelled_order('none',23);
select public.money_receive_event('evt_ref_dispute_open','dispute','{"dispute_id":"dp_ref_loss","payment_id":"pi_ref_dispute","amount":1000,"currency":"usd","state":"open"}');
select public.money_process_event('evt_ref_dispute_open');
-- END CONCURRENCY SETUP

-- Grants: the new commands are the browser path; kernels, helpers and evidence stay closed.
select is(has_function_privilege('authenticated','public.money_operator_request_refund(uuid,text,bigint,bigint,bigint,text,text,text)','execute'),true,'Signed-in users may call the refund request');
select is(has_function_privilege('authenticated','public.money_operator_request_cancellation_refund(uuid,text,text,text)','execute'),true,'Signed-in users may call the cancellation refund request');
select is(has_function_privilege('authenticated','public.money_operator_request_chargeback(text,bigint,bigint,bigint,text,text)','execute'),true,'Signed-in users may call the chargeback request');
select is(has_function_privilege('authenticated','public.money_operator_release_hold(uuid,text,text)','execute'),true,'Signed-in users may call the hold release');
select is(has_function_privilege('authenticated','public.money_operator_reissue_refund(uuid,text)','execute'),true,'Signed-in users may call the refund reissue');
select is(has_function_privilege('anon','public.money_operator_request_refund(uuid,text,bigint,bigint,bigint,text,text,text)','execute'),false,'Anonymous callers cannot request refunds');
select is(has_function_privilege('anon','public.money_operator_reissue_refund(uuid,text)','execute'),false,'Anonymous callers cannot reissue refunds');
select is(has_function_privilege('authenticated','public.money_authorize_refund(uuid,text,bigint,bigint,bigint,text,uuid,uuid,text,text)','execute'),false,'The refund kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_authorize_cancellation_refund(uuid,text,uuid,uuid,text)','execute'),false,'The cancellation refund kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_resolve_chargeback_loss(text,bigint,bigint,bigint,uuid,uuid,text)','execute'),false,'The chargeback kernel stays service-only');
select is(has_function_privilege('authenticated','public.money_prepare_refund(uuid,uuid)','execute'),false,'The refund attempt kernel stays service-only');
select is(has_function_privilege('authenticated','private.money_command_blocker(text,text,jsonb)','execute'),false,'Private blockers stay closed');
select is(has_function_privilege('authenticated','private.money_store_review_request(uuid,text,text,text,uuid,jsonb,text,text,boolean)','execute'),false,'The request store stays closed');
select is(has_table_privilege('authenticated','public.money_review_request_approvals','select'),false,'Browser roles cannot read request approvals');
select is(has_table_privilege('authenticated','public.money_refund_reissues','select'),false,'Browser roles cannot read reissues');

-- Access.
set local role authenticated;
select pg_temp.as_user('a7710000-0000-4000-8000-000000000001');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7','Rework agreed','k-homeowner')$$,'42501','Restricted finance authority required','A homeowner cannot request a refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7','Rework agreed','k-admin')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a refund');
select throws_ok($$select public.money_operator_request_chargeback('dp_ref_loss',1000,0,0,'Loss','k-admin-cb')$$,'42501','Restricted finance authority required','An admin without finance authority cannot request a chargeback allocation');

-- Refund request validation and blockers.
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7',' ','k-r')$$,'22023','Reason of up to 1000 characters required','A refund needs a reason');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,null,'Rework agreed','k-r')$$,'22023','Policy reference of up to 1000 characters required','A refund needs a policy reference');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7','Rework agreed','')$$,'22023','Idempotency key required','A refund needs a key');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',0,0,0,'Ticket 7','Rework agreed','k-r')$$,'22023','Service, tax and tip amounts in cents required','A zero refund is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',-1,140,0,'Ticket 7','Rework agreed','k-r')$$,'22023','Service, tax and tip amounts in cents required','A negative component is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,null,0,'Ticket 7','Rework agreed','k-r')$$,'22023','Service, tax and tip amounts in cents required','A missing component is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'',2000,140,0,'Ticket 7','Rework agreed','k-r')$$,'22023','Stripe payment required','A refund names its payment');
select throws_ok($$select public.money_operator_request_refund(gen_random_uuid(),'pi_ref_refund',2000,140,0,'Ticket 7','Rework agreed','k-r')$$,'P0002','Finance obligation not found','An unknown obligation is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_other',2000,140,0,'Ticket 7','Rework agreed','k-r')$$,'55000','Finance review not actionable: payment_not_captured','Another invoice''s payment is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',10001,0,0,'Ticket 7','Rework agreed','k-r')$$,'55000','Finance review not actionable: refund_exceeds_components','More than the service subtotal is refused');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('dispute'),'pi_ref_dispute',1000,0,0,'Ticket 8','Goodwill','k-r-dispute')$$,'55000','Finance review not actionable: chargeback_open','A refund on a disputed invoice is refused');
reset role;
select is((select count(*)::integer from public.money_review_requests),0,'No refused request was stored');
set local role authenticated;

-- A reviewed refund: A requests, B approves in their own session, A runs it.
insert into f select 'refund-1',(public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,' Ticket 7 rework ',' Rework agreed with homeowner ','cmd-refund-1')->>'request_id')::uuid;
select is((public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7 rework','Rework agreed with homeowner','cmd-refund-1')->>'replay')::boolean,true,'The same refund request replays, trimmed');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2100,140,0,'Ticket 7 rework','Rework agreed with homeowner','cmd-refund-1')$$,'23505','Review request idempotency conflict','The same key with another amount conflicts');
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','awaiting_approval','The refund awaits approval');
select is(pg_temp.request_of(pg_temp.id('refund-1'))->'details',jsonb_build_object('payment_id','pi_ref_refund','service',2000,'tax',140,'tip',0),'The request shows the exact payment and amounts');
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'evidence','Ticket 7 rework','The policy reference is shown as evidence');
select ok((pg_temp.request_of(pg_temp.id('refund-1'))->>'expires_at')::timestamptz=now()+interval '24 hours','The request expires 24 hours after it is made');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('refund-1'))$$,'42501','Separate authenticated approval of exact financial command required','A refund cannot run without approval');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('refund-1'),'Self review')$$,'42501','A different finance operator must approve this command','The requester cannot approve their own refund');
reset role;
-- Approvals given outside this request do not count, even of the identical command.
select pg_temp.kernel_approve((select command from public.money_review_requests where business_key='cmd-refund-1'));
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','awaiting_approval','A direct kernel approval of the exact command is not an approval of the request');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('refund-1'))$$,'42501','Separate authenticated approval of exact financial command required','A direct kernel approval cannot run the refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000004');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('refund-1'),'Looks fine')$$,'42501','Restricted finance authority required','An admin without finance authority cannot approve a refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select isnt(public.money_operator_approve_review(pg_temp.id('refund-1'),'Read ticket 7 and Stripe pi_ref_refund')->>'approval_id',null,'Operator B approves the refund');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('refund-1'),'Again')$$,'A repeated approval is harmless');
select is((pg_temp.request_of(pg_temp.id('refund-1'))->>'approved_by_me')::boolean,true,'The approver sees their approval');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('refund-1'))$$,'42501','Only the requesting finance operator can execute this command','The approver cannot run the refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000005');
select is((pg_temp.request_of(pg_temp.id('refund-1'))->>'approved_by_me')::boolean,false,'Another operator does not see someone else''s approval as theirs');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','approved','The requester sees it approved');
reset role;
select is((select count(*)::integer from public.money_review_request_approvals where request_id=pg_temp.id('refund-1')),1,'One approval is bound to the request');
select throws_ok($$delete from public.money_review_request_approvals$$,'55000',null,'Request approvals are immutable');
savepoint lost_authority;
delete from public.money_authorities where user_id='a7710000-0000-4000-8000-000000000003';
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','awaiting_approval','An approver who lost finance authority no longer counts');
reset role;
rollback to savepoint lost_authority;
savepoint expired_after_approval;
select pg_temp.age_request(pg_temp.id('refund-1'),interval '24 hours');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','expired','An approved request reads expired at exactly 24 hours');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('refund-1'))$$,'55000','Finance review request expired; request it again','An approved but expired request cannot run');
reset role;
rollback to savepoint expired_after_approval;
set local role authenticated;
select is((public.money_operator_execute_review(pg_temp.id('refund-1'))->>'replay')::boolean,false,'The requester runs the approved refund');
select is((public.money_operator_execute_review(pg_temp.id('refund-1'))->>'replay')::boolean,true,'Running again replays without a second authorization');
select is(pg_temp.request_of(pg_temp.id('refund-1'))->>'state','executed','The request reads executed');
select is((public.money_operator_request_refund(pg_temp.id('refund'),'pi_ref_refund',2000,140,0,'Ticket 7 rework','Rework agreed with homeowner','cmd-refund-1')->>'replay')::boolean,true,'A lost response after execution still replays');
select is((select (r->>'can_send')::boolean from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'amount'='2140'),true,'The requester may send the authorized refund');
select is((select r ? 'created_by' from jsonb_array_elements(pg_temp.ops()->'refunds') r limit 1),false,'Operator identities are not returned');
reset role;
insert into f select 'refund-auth',id from public.money_refund_authorizations where business_key='finance-request:cmd-refund-1';
select ok((select (created_by,approved_by,service,tax,tip,policy_evidence,reason)=('a7710000-0000-4000-8000-000000000002'::uuid,'a7710000-0000-4000-8000-000000000003'::uuid,2000::bigint,140::bigint,0::bigint,'Ticket 7 rework','Rework agreed with homeowner')
  from public.money_refund_authorizations where id=pg_temp.id('refund-auth')),'The kernel records the exact refund with requester as author and B as approver');
select is((select approver from public.money_review_executions where request_id=pg_temp.id('refund-1')),'a7710000-0000-4000-8000-000000000003'::uuid,'The gateway records the approver');
select is(pg_temp.payable_ok('refund'),false,'The pending refund holds the payout');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000005');
set local role authenticated;
select is((select (r->>'can_send')::boolean from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),false,'A third operator may not send it');

-- The 24-hour window (owner decision G9).
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
insert into f select 'refund-expiry',(public.money_operator_request_refund(pg_temp.id('stale'),'pi_ref_stale',1000,0,0,'Ticket 9','Partial goodwill','cmd-refund-expiry')->>'request_id')::uuid;
reset role;
savepoint window_edge;
select pg_temp.age_request(pg_temp.id('refund-expiry'),interval '23 hours 59 minutes');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
set local role authenticated;
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('refund-expiry'),'Inside the window')$$,'A request can be approved a minute before it expires');
reset role;
rollback to savepoint window_edge;
savepoint window_closed;
select pg_temp.age_request(pg_temp.id('refund-expiry'),interval '24 hours');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('refund-expiry'))->>'state','expired','An unapproved request reads expired at 24 hours');
select is(pg_temp.request_of(pg_temp.id('refund-expiry'))->>'blocker',null,'An expired request shows no subject blocker');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('refund-expiry'),'Too late')$$,'55000','Finance review request expired; request it again','An expired request cannot be approved');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_request_refund(pg_temp.id('stale'),'pi_ref_stale',1000,0,0,'Ticket 9','Partial goodwill','cmd-refund-expiry')$$,'55000','Finance review request expired; request it again','Replaying an expired request key is refused');
select is((public.money_operator_request_refund(pg_temp.id('stale'),'pi_ref_stale',1000,0,0,'Ticket 9','Partial goodwill','cmd-refund-expiry-2')->>'replay')::boolean,false,'A new request can be made after expiry');
reset role;
rollback to savepoint window_closed;
savepoint late_approval;
-- An approval recorded after the window never counts, even if one were written directly.
select pg_temp.age_request(pg_temp.id('refund-expiry'),interval '25 hours');
insert into public.money_review_approvals(requested_by,approved_by,command_hash,reason)
  select requested_by,'a7710000-0000-4000-8000-000000000003',command_hash,'Late' from public.money_review_requests where id=pg_temp.id('refund-expiry');
insert into public.money_review_request_approvals(request_id,approval_id,approved_by,reason)
  select pg_temp.id('refund-expiry'),a.id,a.approved_by,'Late' from public.money_review_approvals a
  join public.money_review_requests q on q.id=pg_temp.id('refund-expiry') and a.command_hash=q.command_hash and a.approved_by='a7710000-0000-4000-8000-000000000003';
select is(private.money_review_approver(pg_temp.id('refund-expiry')),null,'An approval after the window is not an approver');
rollback to savepoint late_approval;

-- A request goes stale when money moves before it runs.
select pg_temp.kernel_approve(jsonb_build_object('operation','refund','obligation',pg_temp.id('stale'),'payment','pi_ref_stale','service',9500,'tax',0,'tip',0,'key','ref-direct','policy','synthetic','reason','Synthetic direct refund'));
select public.money_authorize_refund(pg_temp.id('stale'),'pi_ref_stale',9500,0,0,'ref-direct','a7710000-0000-4000-8000-000000000002','a7710000-0000-4000-8000-000000000003','synthetic','Synthetic direct refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('refund-expiry'))->>'state','stale','A refund request goes stale when another refund takes its components');
select is(pg_temp.request_of(pg_temp.id('refund-expiry'))->>'blocker','refund_exceeds_components','It says why');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('refund-expiry'),'ok')$$,'55000','Finance review not actionable: refund_exceeds_components','A stale refund cannot be approved');

-- Cancellation refunds: amounts come from CFG-006 policy, never the caller.
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.ops()->'cancellations') c where c->>'operation_id' in (pg_temp.id('cancel-full')::text,pg_temp.id('cancel-half')::text)),2,'Full and half cancellations are listed');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.ops()->'cancellations') c where c->>'operation_id'=pg_temp.id('cancel-none')::text),0,'A cancellation with no refund due is not listed');
select is((select jsonb_build_object('pct',c->'refund_percent','service',c->'service','tax',c->'tax','tip',c->'tip','blocker',c->'blocker')
  from jsonb_array_elements(pg_temp.ops()->'cancellations') c where c->>'operation_id'=pg_temp.id('cancel-half')::text),
  jsonb_build_object('pct',50,'service',5000,'tax',350,'tip',500,'blocker',null),'The half cancellation shows its policy amounts');
select throws_ok($$select public.money_operator_request_cancellation_refund(gen_random_uuid(),'pi_ref_cancel_full','Policy refund','k-c')$$,'P0002','Cancellation not found','An unknown cancellation is refused');
select throws_ok($$select public.money_operator_request_cancellation_refund(pg_temp.id('cancel-full'),'pi:x','Policy refund','k-c')$$,'22023','Stripe payment required','A malformed payment is refused');
select throws_ok($$select public.money_operator_request_cancellation_refund(pg_temp.id('cancel-full'),'pi_ref_refund','Policy refund','k-c')$$,'55000','Finance review not actionable: not_eligible','A payment from another invoice is not eligible');
select throws_ok($$select public.money_operator_request_cancellation_refund(pg_temp.id('cancel-none'),'pi_ref_cancel_none','Policy refund','k-c')$$,'55000','Finance review not actionable: no_refund_due','A cancellation under 24 hours produces no refund');
insert into f select 'cancel-full-request',(public.money_operator_request_cancellation_refund(pg_temp.id('cancel-full'),'pi_ref_cancel_full',' Customer cancelled 73 hours ahead ','cmd-cancel-full')->>'request_id')::uuid;
select is(pg_temp.request_of(pg_temp.id('cancel-full-request'))->'details',jsonb_build_object('payment_id','pi_ref_cancel_full','service',10000,'tax',700,'tip',1000),'The request carries the policy amounts');
select is((select (c->>'open_request_id')::uuid from jsonb_array_elements(pg_temp.ops()->'cancellations') c where c->>'operation_id'=pg_temp.id('cancel-full')::text),pg_temp.id('cancel-full-request'),'The cancellation links its open request');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('cancel-full-request'),'Checked the 73-hour assessment')$$,'Operator B approves the policy refund');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select is((public.money_operator_execute_review(pg_temp.id('cancel-full-request'))->>'operation'),'cancellation_refund','Operator A runs the policy refund');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.ops()->'cancellations') c where c->>'operation_id'=pg_temp.id('cancel-full')::text),0,'The authorized cancellation leaves the list');
select is((public.money_operator_request_cancellation_refund(pg_temp.id('cancel-full'),'pi_ref_cancel_full','Customer cancelled 73 hours ahead','cmd-cancel-full')->>'replay')::boolean,true,'The executed cancellation request replays');
select throws_ok($$select public.money_operator_request_cancellation_refund(pg_temp.id('cancel-full'),'pi_ref_cancel_full','Again','cmd-cancel-full-2')$$,'55000','Finance review not actionable: completed','A cancellation cannot be refunded twice');
reset role;
select ok((select (s.service,s.tax,s.tip,a.created_by,a.approved_by)=(10000::bigint,700::bigint,1000::bigint,'a7710000-0000-4000-8000-000000000002'::uuid,'a7710000-0000-4000-8000-000000000003'::uuid)
  from public.money_operation_refund_sources s join public.money_refund_authorizations a on a.id=s.authorization_id
  where s.operation_id=pg_temp.id('cancel-full')),'The kernel binds the policy refund to the cancellation with both operators');
-- A half cancellation whose policy amount changes before approval goes stale.
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
insert into f select 'cancel-half-request',(public.money_operator_request_cancellation_refund(pg_temp.id('cancel-half'),'pi_ref_cancel_half','Customer cancelled 25 hours ahead','cmd-cancel-half')->>'request_id')::uuid;
reset role;
select pg_temp.kernel_approve(jsonb_build_object('operation','refund','obligation',pg_temp.id('cancel-half-obligation'),'payment','pi_ref_cancel_half','service',1000,'tax',0,'tip',0,'key','ref-half-adjust','policy','synthetic','reason','Synthetic adjustment'));
select public.money_authorize_refund(pg_temp.id('cancel-half-obligation'),'pi_ref_cancel_half',1000,0,0,'ref-half-adjust','a7710000-0000-4000-8000-000000000002','a7710000-0000-4000-8000-000000000003','synthetic','Synthetic adjustment');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('cancel-half-request'))->>'blocker','amount_changed','An earlier adjustment changes the policy amount and makes the request stale');
select throws_ok($$select public.money_operator_approve_review(pg_temp.id('cancel-half-request'),'ok')$$,'55000','Finance review not actionable: amount_changed','A changed policy amount cannot be approved');
-- Approval does not carry over to a later identical request after expiry.
reset role;
savepoint carry_over;
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
insert into f select 'cancel-half-again',(public.money_operator_request_cancellation_refund(pg_temp.id('cancel-half'),'pi_ref_cancel_half','Customer cancelled 25 hours ahead','cmd-cancel-half-again')->>'request_id')::uuid;
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('cancel-half-again'),'Approved the recomputed amount')$$,'B approves the recomputed request');
reset role;
select pg_temp.age_request(pg_temp.id('cancel-half-again'),interval '25 hours');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
insert into f select 'cancel-half-third',(public.money_operator_request_cancellation_refund(pg_temp.id('cancel-half'),'pi_ref_cancel_half','Customer cancelled 25 hours ahead','cmd-cancel-half-third')->>'request_id')::uuid;
reset role;
select is((select command_hash from public.money_review_requests where id=pg_temp.id('cancel-half-third')),(select command_hash from public.money_review_requests where id=pg_temp.id('cancel-half-again')),'The new request has the identical command');
set local role authenticated;
select is(pg_temp.request_of(pg_temp.id('cancel-half-third'))->>'state','awaiting_approval','The expired request''s approval does not carry over');
select throws_ok($$select public.money_operator_execute_review(pg_temp.id('cancel-half-third'))$$,'42501','Separate authenticated approval of exact financial command required','The new request cannot run on the old approval');
reset role;
rollback to savepoint carry_over;

-- Lost chargebacks: exact allocation of principal to retained components.
select public.money_receive_event('evt_ref_dispute_lost','dispute','{"dispute_id":"dp_ref_loss","payment_id":"pi_ref_dispute","amount":1000,"currency":"usd","state":"lost"}');
select public.money_process_event('evt_ref_dispute_lost');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select jsonb_build_object('amount',c->'amount','retained',c->'retained','blocker',c->'blocker') from jsonb_array_elements(pg_temp.ops()->'chargebacks') c where c->>'dispute_id'='dp_ref_loss'),
  jsonb_build_object('amount',1000,'retained',jsonb_build_object('service',10000,'tax',700,'tip',1000),'blocker',null),'The lost chargeback is listed with retained components');
select throws_ok($$select public.money_operator_request_chargeback('dp_missing',1000,0,0,'Loss','k-cb')$$,'P0002','Chargeback not found','An unknown chargeback is refused');
select throws_ok($$select public.money_operator_request_chargeback('dp_ref_loss',0,0,0,'Loss','k-cb')$$,'22023','Service, tax and tip amounts in cents required','A zero allocation is refused');
select throws_ok($$select public.money_operator_request_chargeback('dp_ref_loss',900,0,0,'Loss','k-cb')$$,'55000','Finance review not actionable: allocation_invalid','An allocation that does not equal the loss is refused');
select throws_ok($$select public.money_operator_request_chargeback('dp_ref_loss',0,0,1001,'Loss','k-cb')$$,'55000','Finance review not actionable: allocation_invalid','An allocation above a retained component is refused');
insert into f select 'chargeback-1',(public.money_operator_request_chargeback('dp_ref_loss',800,100,100,'Chargeback lost on Stripe dp_ref_loss','cmd-chargeback-1')->>'request_id')::uuid;
select is(pg_temp.request_of(pg_temp.id('chargeback-1'))->'details',jsonb_build_object('dispute_id','dp_ref_loss','service',800,'tax',100,'tip',100),'The request shows the allocation');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select lives_ok($$select public.money_operator_approve_review(pg_temp.id('chargeback-1'),'Read dp_ref_loss at Stripe')$$,'Operator B approves the allocation');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select is((public.money_operator_execute_review(pg_temp.id('chargeback-1'))->>'replay')::boolean,false,'Operator A runs the allocation');
select is(jsonb_array_length(pg_temp.ops()->'chargebacks'),0,'No lost chargeback remains to allocate');
select throws_ok($$select public.money_operator_request_chargeback('dp_ref_loss',800,100,100,'Again','cmd-chargeback-2')$$,'55000','Finance review not actionable: completed','An allocated chargeback cannot be allocated again');
reset role;
select ok((select (service,tax,tip,actor,approver)=(800::bigint,100::bigint,100::bigint,'a7710000-0000-4000-8000-000000000002'::uuid,'a7710000-0000-4000-8000-000000000003'::uuid)
  from public.money_chargeback_resolutions where dispute_id='dp_ref_loss'),'The kernel records the allocation with both operators');
select is((select dispute_open from public.money_obligations where id=pg_temp.id('dispute')),false,'The allocation clears the chargeback hold');

-- Legacy: an unexpired hold release request made before G3 still needs its approval to run.
-- Hold release itself is covered in suite 043.

-- Reissue of a refund whose Stripe outcome is uncertain.
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),' ')$$,'22023','Reason of up to 1000 characters required','A reissue needs a reason');
select throws_ok($$select public.money_operator_reissue_refund(gen_random_uuid(),'Retry')$$,'P0002','Refund authorization not found','An unknown refund is refused');
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Retry')$$,'55000','Refund reissue not allowed: refund_not_sent','An unsent refund cannot be reissued');
reset role;
select public.money_prepare_refund(pg_temp.id('refund-auth'),'a7710000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Retry')$$,'55000','Refund reissue not allowed: refund_not_uncertain','A refund inside its send window cannot be reissued');
reset role;
update public.money_refund_attempts set created_at=now()-interval '23 hours 30 minutes' where authorization_id=pg_temp.id('refund-auth');
select is((public.money_prepare_refund(pg_temp.id('refund-auth'),'a7710000-0000-4000-8000-000000000002')).status,'reconcile','After 23 hours an unconfirmed refund becomes uncertain');
set local role authenticated;
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Retry')$$,'55000','Refund reissue not allowed: readback_required','A reissue needs a Stripe readback first');
select is((select r->>'reissue_blocker' from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),'readback_required','Operations show why it cannot be reissued');
reset role;
select public.money_record_refund_readback(pg_temp.id('refund-auth'),'a7710000-0000-4000-8000-000000000005',null,null,null);
set local role authenticated;
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Retry')$$,'55000','Refund reissue not allowed: readback_too_early','A readback inside Stripe''s 24-hour idempotency window is not proof');
reset role;
update public.money_refund_attempts set created_at=now()-interval '25 hours' where authorization_id=pg_temp.id('refund-auth');
set local role authenticated;
select is((select r->>'reissue_blocker' from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),null,'A not-found readback 24 hours after preparation allows a reissue');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000005');
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Retry')$$,'42501','Only the refund''s author or approver can reissue it','A third operator cannot reissue');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000003');
select is((public.money_operator_reissue_refund(pg_temp.id('refund-auth'),' Stripe shows no refund ')->>'generation')::integer,2,'The refund''s approver reissues it as generation 2');
select is((public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Stripe shows no refund')->>'replay')::boolean,true,'The same reissue replays');
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Other reason')$$,'23505','Refund reissue idempotency conflict','A different reissue from the same readback conflicts');
select pg_temp.as_user('a7710000-0000-4000-8000-000000000002');
select throws_ok($$select public.money_operator_reissue_refund(pg_temp.id('refund-auth'),'Stripe shows no refund')$$,'23505','Refund reissue idempotency conflict','Another operator cannot replay someone else''s reissue');
select is((select jsonb_build_object('status',r->'attempt_status','generation',r->'generation') from jsonb_array_elements(pg_temp.ops()->'refunds') r where r->>'authorization_id'=pg_temp.id('refund-auth')::text),
  jsonb_build_object('status','prepared','generation',2),'Operations show the reissued refund ready to send');
reset role;
select ok((select (a.status,a.idempotency_key,a.prepared_at,a.amount)=('prepared','mercurius:refund-v1:'||pg_temp.id('refund-auth')||':g2',now(),2140::bigint)
  from public.money_refund_attempts a where a.authorization_id=pg_temp.id('refund-auth')),'The attempt is prepared again under a new key for the same amount');
select ok((select (x.previous_key,x.actor,x.reason)=('mercurius:refund-v1:'||pg_temp.id('refund-auth'),'a7710000-0000-4000-8000-000000000003'::uuid,'Stripe shows no refund')
  from public.money_refund_reissues x where x.authorization_id=pg_temp.id('refund-auth')),'The reissue records the old key, actor and reason');
select is((public.money_prepare_refund(pg_temp.id('refund-auth'),'a7710000-0000-4000-8000-000000000002')).status,'prepared','The 23-hour window restarts at the reissue');
select throws_ok($$update public.money_refund_reissues set reason='x'$$,'55000',null,'Reissues are immutable');
select is((select count(*)::integer from public.money_refunds where authorization_id=pg_temp.id('refund-auth')),0,'A reissue never settles a refund');
select is((select count(*)::integer from public.money_refund_authorizations where obligation_id=pg_temp.id('refund')),1,'A reissue never creates another authorization');

select * from finish();
rollback;
