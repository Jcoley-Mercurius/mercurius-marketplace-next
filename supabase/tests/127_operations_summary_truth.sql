-- Phase 7.5B (TRACE-159): operations overview summary truth repair (20261130001000).
-- Contract: governance/PHASE-7-OPERATIONS-QUEUES-CONTRACT.md §8 (DF-1, DF-2).
-- SQL 108's summary assertions (Q1–Q5, count parity, no errors) stay where they are; this file adds
-- parity on nonempty synthetic fixtures: each summary row's count equals its queue's list, each
-- `aged` equals that queue's flagged items where the queue has an aging rule and is null where it
-- has none, the offers-at-other-terms row (including a rematch_failed item), the exact queue list,
-- authorization, grants, no writes, and per-queue error isolation.
--
-- The two exact summaries below (S8, S9) are the browser fixture: tests/fixtures/
-- admin-operations-summary.json holds the same values with checked_at normalized, a unit test
-- (src/lib/adminOperations.test.ts) holds the fixture equal to these literals and to SUMMARY_QUEUES,
-- and scripts/derive-operations-summary-fixture.mjs re-derives it from the fixture block below.
-- The fixtures are timed relative to now(), so the results do not drift with the clock.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- BEGIN 7.5B FIXTURES (replayed verbatim by scripts/derive-operations-summary-fixture.mjs)
insert into auth.users(id,email,email_confirmed_at) values
 ('c75b0000-0000-4000-8000-000000000001','p75b-admin@example.invalid',now()),
 ('c75b0000-0000-4000-8000-000000000002','p75b-home@example.invalid',now()),
 ('c75b0000-0000-4000-8000-000000000003','p75b-vendor@example.invalid',now()),
 ('c75b0000-0000-4000-8000-000000000004','p75b-finance@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('c75b0000-0000-4000-8000-000000000001','admin'),('c75b0000-0000-4000-8000-000000000002','homeowner'),
 ('c75b0000-0000-4000-8000-000000000003','vendor'),('c75b0000-0000-4000-8000-000000000004','admin')
 on conflict do nothing;
-- Finance authority for admin 4 only; admin 1 has none.
insert into public.money_authorities(user_id,granted_by,reason) values
 ('c75b0000-0000-4000-8000-000000000004','c75b0000-0000-4000-8000-000000000004','Synthetic finance holder');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('c75b1000-0000-4000-8000-00000000000a','P75B provider',true,false,'c75b0000-0000-4000-8000-000000000003');
-- The exact summaries below assume a database with no other queue items (a clean replay with the
-- synthetic seed). Stop here with a clear message rather than report a confusing difference.
do $$
declare s jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"c75b0000-0000-4000-8000-000000000004"}', true);
  s := public.admin_operations_summary();
  perform set_config('request.jwt.claims', '', true);
  if exists(select 1 from jsonb_array_elements(s->'queues') q where coalesce((q->>'count')::int, 0) <> 0) then
    raise exception '7.5B fixtures need a database with no queue items; found %', s->'queues';
  end if;
end $$;
-- Rows are written directly (replica mode skips lifecycle triggers); each one is shaped to the
-- condition its queue reads.
set local session_replication_role = replica;
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,assigned_at,vendor_completed_at,scheduled_start_at,recurrence_parent_id,frequency) values
 -- Offers at other terms: a decline whose re-match failed (rematch_failed) and a gate-blocked exhaustion (blocked_inactive).
 ('c75b2000-0000-4000-8000-000000000001','c75b0000-0000-4000-8000-000000000002',null,'house-cleaning','1 Probe St','Fort Myers','FL','33901','P75B rematch failed','pending','awaiting_match','fixed',null,null,null,null,'one-time'),
 ('c75b2000-0000-4000-8000-000000000002','c75b0000-0000-4000-8000-000000000002',null,'house-cleaning','2 Probe St','Fort Myers','FL','33901','P75B gate blocked','pending','exhausted','fixed',null,null,null,null,'one-time'),
 -- Fulfillment: completion marked 80 hours ago, unconfirmed and without evidence (confirmation_overdue, evidence_unverified).
 ('c75b2000-0000-4000-8000-000000000003','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','3 Probe St','Fort Myers','FL','33901','P75B completion overdue','vendor_completed','matched','fixed',now()-interval '100 hours',now()-interval '80 hours',null,null,'one-time'),
 -- Quote: a quote-mode job with no proposal 30 hours after assignment (proposal_missing, aged).
 ('c75b2000-0000-4000-8000-000000000004','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','4 Probe St','Fort Myers','FL','33901','P75B proposal missing','matched','matched','custom_quote',now()-interval '30 hours',null,null,null,'one-time'),
 -- Recurring: a series with two accepted visits and no payment review, one past its start (aged) and one starting in 10 hours (not aged).
 ('c75b2000-0000-4000-8000-000000000005','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','5 Probe St','Fort Myers','FL','33901','P75B series','scheduled','matched','fixed',now()-interval '200 hours',null,null,null,'monthly'),
 ('c75b2000-0000-4000-8000-000000000006','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','5 Probe St','Fort Myers','FL','33901','P75B visit started','scheduled','matched','fixed',now()-interval '200 hours',null,now()-interval '2 hours','c75b2000-0000-4000-8000-000000000005','monthly'),
 ('c75b2000-0000-4000-8000-000000000007','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','5 Probe St','Fort Myers','FL','33901','P75B visit upcoming','scheduled','matched','fixed',now()-interval '200 hours',null,now()+interval '10 hours','c75b2000-0000-4000-8000-000000000005','monthly'),
 -- Fulfillment: a provider no-show on a scheduled one-time job (fulfillment_exception).
 ('c75b2000-0000-4000-8000-000000000008','c75b0000-0000-4000-8000-000000000002','c75b1000-0000-4000-8000-00000000000a','house-cleaning','8 Probe St','Fort Myers','FL','33901','P75B no-show','scheduled','matched','fixed',now()-interval '50 hours',null,now()-interval '6 hours',null,'one-time');
insert into private.offer_terms_rematch_failures(request_id,terms_id,via,last_attempt,sqlstate,message,created_at) values
 ('c75b2000-0000-4000-8000-000000000001',null,'terms',0,'P0001','Synthetic re-match failure',now()-interval '3 hours');
insert into private.offer_terms_blocks(request_id,candidates,created_at) values
 ('c75b2000-0000-4000-8000-000000000002','[]'::jsonb,now()-interval '5 hours');
-- Quote: an accepted change waiting for review (no clock, so never aged).
insert into public.request_quote_exceptions(id,request_id,kind,subject,opened_by,opened_at,reason) values
 ('c75b4000-0000-4000-8000-000000000001','c75b2000-0000-4000-8000-000000000004','accepted_change','c75b4000-0000-4000-8000-0000000000aa','c75b0000-0000-4000-8000-000000000001',now()-interval '2 hours','Synthetic accepted change');
insert into public.job_operations(id,job_id,operation_key,actor_id,kind,reason,before_value,policy_assessment,created_at) values
 ('c75b5000-0000-4000-8000-000000000001','c75b2000-0000-4000-8000-000000000008','c75b5000-0000-4000-8000-0000000000aa','c75b0000-0000-4000-8000-000000000002','no_show','Synthetic provider no-show','{}'::jsonb,'{}'::jsonb,now()-interval '5 hours');
-- Support: one open ticket past its response target and one within it.
insert into public.support_tickets(id,user_id,ticket_number,subject,description,issue_type,status,priority,response_due_at,queue_owner,version,created_at,updated_at) values
 ('c75b3000-0000-4000-8000-000000000001','c75b0000-0000-4000-8000-000000000002','P75B-1','P75B past target','Synthetic','general','open','standard',now()-interval '1 hour','project_owner',1,now()-interval '30 hours',now()-interval '30 hours'),
 ('c75b3000-0000-4000-8000-000000000002','c75b0000-0000-4000-8000-000000000002','P75B-2','P75B within target','Synthetic','general','open','standard',now()+interval '20 hours','project_owner',1,now()-interval '4 hours',now()-interval '4 hours');
set local session_replication_role = origin;
-- END 7.5B FIXTURES

create function pg_temp.as_user(n text) returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"authenticated","sub":"c75b0000-0000-4000-8000-00000000000'||n||'"}',true) $$;
create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v; return coalesce(v,'<null>');
exception when others then return 'REFUSED '||sqlstate;
end $$;
grant execute on function pg_temp.val(text) to authenticated, anon;
-- One summary read per caller, kept for the comparisons below (same transaction, same now()).
create table pg_temp.s(caller text primary key, summary jsonb);
-- Every queue reader as read by the same caller in the same transaction, keyed by summary queue.
create table pg_temp.q(caller text, queue text, list jsonb, primary key (caller, queue));
grant select, insert on pg_temp.s, pg_temp.q to authenticated;
create function pg_temp.capture(caller text) returns void language plpgsql as $$
begin
  insert into pg_temp.s values (caller, public.admin_operations_summary());
  insert into pg_temp.q values
    (caller, 'quote', public.admin_quote_queue()->'items'),
    (caller, 'recurring_payment', public.admin_recurring_payment_queue()->'items'),
    (caller, 'fulfillment', public.admin_fulfillment_queue()->'items'),
    (caller, 'cancellation', public.admin_cancellation_queue()->'items'),
    (caller, 'support', public.admin_support_queue(false)->'items'),
    (caller, 'compliance_renewal', public.vendor_evidence_renewal_queue()->'entries'),
    (caller, 'renewal_documents', public.vendor_renewal_document_queue()->'entries'),
    (caller, 'offer_terms', public.admin_offer_terms_queue()->'items');
end $$;
grant execute on function pg_temp.capture(text) to authenticated;
create function pg_temp.row_of(caller text, queue text) returns jsonb language sql as $$
  select r from pg_temp.s, jsonb_array_elements(s.summary->'queues') r where s.caller = $1 and r->>'queue' = $2 $$;
create function pg_temp.list_of(caller text, queue text) returns jsonb language sql as $$
  select coalesce(list, '[]'::jsonb) from pg_temp.q where q.caller = $1 and q.queue = $2 $$;
create function pg_temp.flagged(caller text, queue text, flag text) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(pg_temp.list_of($1, $2)) i where coalesce((i->>$3)::boolean, false) $$;

set local role authenticated;
select pg_temp.as_user('1');
select pg_temp.capture('admin');
select pg_temp.as_user('4');
select pg_temp.capture('finance');
insert into pg_temp.q values ('finance', 'finance_exceptions', public.money_finance_reconciliation()->'exceptions');
reset role;

-- S1 The exact queue list and order: the seven existing queues unchanged, offers at other terms
-- appended, finance last.
select is((select array_agg(r->>'queue' order by n) from pg_temp.s, jsonb_array_elements(s.summary->'queues') with ordinality x(r, n) where s.caller = 'admin'),
  array['quote','recurring_payment','fulfillment','cancellation','support','compliance_renewal','renewal_documents','offer_terms','finance_exceptions'],
  'S1 queue list and order (offer_terms appended; finance last)');
select is((select array_agg(r->>'queue' order by n) from pg_temp.s, jsonb_array_elements(s.summary->'queues') with ordinality x(r, n) where s.caller = 'finance'),
  (select array_agg(r->>'queue' order by n) from pg_temp.s, jsonb_array_elements(s.summary->'queues') with ordinality x(r, n) where s.caller = 'admin'),
  'S1b the same list for a finance-authority holder');

-- S2 Count parity, per queue, for both callers: the summary count is its queue's list length.
select is((pg_temp.row_of(c, k)->>'count')::int, jsonb_array_length(pg_temp.list_of(c, k)), format('S2 %s count = queue (%s)', k, c))
  from unnest(array['admin','finance']) c,
       unnest(array['quote','recurring_payment','fulfillment','cancellation','support','compliance_renewal','renewal_documents','offer_terms']) k;
select is((pg_temp.row_of('finance', 'finance_exceptions')->>'count')::int, jsonb_array_length(pg_temp.list_of('finance', 'finance_exceptions')),
  'S2 finance_exceptions count = money_finance_reconciliation exceptions (finance holder)');
select is((select count(*)::int from pg_temp.s, jsonb_array_elements(s.summary->'queues') r where r->>'state' <> 'ready'
  and not (s.caller = 'admin' and r->>'queue' = 'finance_exceptions')), 0, 'S2b every row ready except finance for a non-holder');

-- S3 Aged parity. A queue with an aging rule reports exactly its flagged items; a queue with none
-- reports null (JSON null, never 0).
select is((pg_temp.row_of(c, k)->>'aged')::int, pg_temp.flagged(c, k, f), format('S3 %s aged = items with %s (%s)', k, f, c))
  from unnest(array['admin','finance']) c,
       (values ('quote', 'aged'), ('recurring_payment', 'aged'), ('support', 'overdue')) v(k, f);
select is(jsonb_typeof(pg_temp.row_of(c, k)->'aged'), 'null', format('S3 %s aged is null: no aging rule (%s)', k, c))
  from unnest(array['admin','finance']) c,
       unnest(array['fulfillment','cancellation','compliance_renewal','renewal_documents','offer_terms','finance_exceptions']) k;
-- DF-1: the fulfillment queue emits no aged flag at all, so a summary aged count for it could only
-- ever be 0. Offers at other terms emits none either.
select is((select count(*)::int from jsonb_array_elements(pg_temp.list_of('admin', k)) i where i ? 'aged'), 0, format('S3b %s items carry no aged field', k))
  from unnest(array['fulfillment','offer_terms']) k;

-- S4 The fixtures are nonempty where parity needs it, with both aged and not-aged items.
select ok(jsonb_array_length(pg_temp.list_of('admin', k)) > 0, format('S4 %s fixture is nonempty', k))
  from unnest(array['quote','recurring_payment','fulfillment','support','offer_terms']) k;
select ok(pg_temp.flagged('admin', k, f) between 1 and jsonb_array_length(pg_temp.list_of('admin', k)) - 1, format('S4 %s has aged and not-aged items', k))
  from (values ('quote', 'aged'), ('recurring_payment', 'aged'), ('support', 'overdue')) v(k, f);
select is((select array_agg(i->>'kind' order by i->>'kind') from jsonb_array_elements(pg_temp.list_of('admin', 'offer_terms')) i),
  array['blocked_inactive','rematch_failed'], 'S4 offer terms fixture includes rematch_failed');
select is((select array_agg(i->>'kind' order by i->>'kind') from jsonb_array_elements(pg_temp.list_of('admin', 'fulfillment')) i),
  array['confirmation_overdue','evidence_unverified','fulfillment_exception'], 'S4 fulfillment fixture includes confirmation_overdue (past 72 hours)');

-- S5 Finance stays restricted for a non-holder and ready for a holder.
select is(pg_temp.row_of('admin', 'finance_exceptions'), '{"queue":"finance_exceptions","state":"restricted","count":null,"aged":null}'::jsonb, 'S5 finance restricted without authority');
select is(pg_temp.row_of('finance', 'finance_exceptions')->>'state', 'ready', 'S5 finance ready with authority');

-- S6 checked_at is this transaction's time.
select is((s.summary->>'checked_at')::timestamptz, now(), format('S6 checked_at = now() (%s)', s.caller)) from pg_temp.s order by s.caller;

-- S7 The summary writes nothing: no row inserted, updated or deleted in any table by a call.
create table pg_temp.w(n bigint);
insert into pg_temp.w select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%';
select pg_temp.as_user('4');
select public.admin_operations_summary() is not null;
select pg_temp.as_user('1');
select public.admin_operations_summary() is not null;
select is((select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%'),
  (select n from pg_temp.w), 'S7 the summary writes no row');

-- S8, S9 The exact summaries (checked_at removed): the browser fixture. Values follow from the
-- fixtures above: quote 2 (1 aged), recurring 2 (1 aged), fulfillment 3 (no rule), support 2
-- (1 past target), offers at other terms 2 (no rule), all others empty.
select is((select summary - 'checked_at' from pg_temp.s where caller = 'admin'),
  $admin_summary${"queues": [
  {"queue":"quote","state":"ready","count":2,"aged":1},
  {"queue":"recurring_payment","state":"ready","count":2,"aged":1},
  {"queue":"fulfillment","state":"ready","count":3,"aged":null},
  {"queue":"cancellation","state":"ready","count":0,"aged":null},
  {"queue":"support","state":"ready","count":2,"aged":1},
  {"queue":"compliance_renewal","state":"ready","count":0,"aged":null},
  {"queue":"renewal_documents","state":"ready","count":0,"aged":null},
  {"queue":"offer_terms","state":"ready","count":2,"aged":null},
  {"queue":"finance_exceptions","state":"restricted","count":null,"aged":null}
]}$admin_summary$::jsonb, 'S8 exact summary, admin without finance authority');
select is((select summary - 'checked_at' from pg_temp.s where caller = 'finance'),
  $finance_summary${"queues": [
  {"queue":"quote","state":"ready","count":2,"aged":1},
  {"queue":"recurring_payment","state":"ready","count":2,"aged":1},
  {"queue":"fulfillment","state":"ready","count":3,"aged":null},
  {"queue":"cancellation","state":"ready","count":0,"aged":null},
  {"queue":"support","state":"ready","count":2,"aged":1},
  {"queue":"compliance_renewal","state":"ready","count":0,"aged":null},
  {"queue":"renewal_documents","state":"ready","count":0,"aged":null},
  {"queue":"offer_terms","state":"ready","count":2,"aged":null},
  {"queue":"finance_exceptions","state":"ready","count":0,"aged":null}
]}$finance_summary$::jsonb, 'S9 exact summary, finance-authority holder');

-- S10 Authorization and definition: admin only, no PUBLIC or anon execute, grants as in
-- 20261108001000, security definer with an empty search_path.
set local role authenticated;
select pg_temp.as_user('2');
select is(pg_temp.val('select public.admin_operations_summary()::text'), 'REFUSED 42501', 'S10 homeowner refused');
select pg_temp.as_user('3');
select is(pg_temp.val('select public.admin_operations_summary()::text'), 'REFUSED 42501', 'S10 vendor refused');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.val('select public.admin_operations_summary()::text'), 'REFUSED 42501', 'S10 signed-in caller without identity refused');
reset role;
set local role anon;
select is(pg_temp.val('select public.admin_operations_summary()::text'), 'REFUSED 42501', 'S10 anon refused');
reset role;
select is((select proacl::text from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'S10 grants unchanged');
select ok((select prosecdef and proconfig = array['search_path=""'] and provolatile = 'v' and pg_get_userbyid(proowner) = 'postgres'
  from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure), 'S10 security definer, empty search_path, owner postgres');

-- S11 Per-queue error isolation: a failing reader turns only its own row into an error; every
-- other row, finance included, keeps its value. The failing readers are stand-ins inside this
-- rolled-back transaction.
create or replace function public.admin_offer_terms_queue() returns jsonb language plpgsql as $f$
begin raise exception 'synthetic offer terms failure'; end $f$;
set local role authenticated;
select pg_temp.as_user('4');
select is(pg_temp.val($q$select r::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'offer_terms'$q$),
  '{"aged": null, "count": null, "queue": "offer_terms", "state": "error"}', 'S11 failing offer terms reader: its row is an error');
select is(pg_temp.val($q$select jsonb_agg(r)::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' <> 'offer_terms'$q$),
  (select jsonb_agg(r)::text from pg_temp.s, jsonb_array_elements(s.summary->'queues') r where s.caller = 'finance' and r->>'queue' <> 'offer_terms'),
  'S11 every other row unchanged');
reset role;
create or replace function public.admin_fulfillment_queue() returns jsonb language plpgsql as $f$
begin raise exception 'synthetic fulfillment failure'; end $f$;
set local role authenticated;
select pg_temp.as_user('4');
select is(pg_temp.val($q$select jsonb_agg(r->>'queue' order by r->>'queue')::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'state' = 'error'$q$),
  '["fulfillment", "offer_terms"]', 'S11 two failing readers: exactly those two rows are errors');
select is(pg_temp.val($q$select (r->>'count') from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'renewal_documents'$q$),
  '0', 'S11 the loop continues after a failure (renewal documents still read)');
reset role;

select * from finish();
rollback;
