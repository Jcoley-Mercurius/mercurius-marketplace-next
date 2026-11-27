-- Phase 7.5G-1 (TRACE-159): applications awaiting review (20261205001000).
-- Plan: governance/PHASE-7-OPERATIONS-QUEUES-PLAN-7-5G.md §5 and §9 (Codex R-1..R-5, C-1..C-3).
--
-- public.admin_application_review_queue() lists exactly the applications the applications page
-- classifies as "awaiting_review" (src/lib/applicationQueueState.ts), with `since` = when the
-- application was received (created_at; intake revisions do not reset it), ordered by created_at
-- then id. The summary's 'applications' row counts it, after offer_terms and before finance.
--
-- Cross-layer parity (C-1): the fixture block below is replayed by
-- scripts/derive-application-review-parity.mjs, which writes the database's own readbacks
-- (application status as the page selects it, vendor_onboarding_intake_status as the page reads it,
-- and the server queue) to tests/fixtures/application-review-queue-parity.json. P1 asserts that the
-- database returns exactly that JSON here; tests/unit/application-review-queue-parity.test.ts holds
-- the committed file equal to P1's literal and passes its readbacks through the real
-- applicationQueueState. Parity is claimed only for fully loaded readbacks of one database state
-- (C-2). Fixture times are absolute: nothing in the queue depends on the clock.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- BEGIN 7.5G-1 FIXTURES (replayed verbatim by scripts/derive-application-review-parity.mjs)
-- The exact results below assume a database with no other applications (a clean replay with the
-- synthetic seed). Stop here with a clear message rather than report a confusing difference.
do $$ begin
  if exists(select 1 from public.vendor_applications) then
    raise exception '7.5G-1 fixtures need a database with no vendor applications';
  end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('c75a0000-0000-4000-8000-000000000001','p75g-admin@example.invalid',now()),
 ('c75a0000-0000-4000-8000-000000000002','p75g-home@example.invalid',now()),
 ('c75a0000-0000-4000-8000-000000000003','p75g-vendor@example.invalid',now()),
 ('c75a0000-0000-4000-8000-000000000004','p75g-finance@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('c75a0000-0000-4000-8000-000000000001','admin'),('c75a0000-0000-4000-8000-000000000002','homeowner'),
 ('c75a0000-0000-4000-8000-000000000003','vendor'),('c75a0000-0000-4000-8000-000000000004','admin')
 on conflict do nothing;
insert into public.money_authorities(user_id,granted_by,reason) values
 ('c75a0000-0000-4000-8000-000000000004','c75a0000-0000-4000-8000-000000000004','Synthetic finance holder');
-- Contractors an application can be linked to before any onboarding exists.
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('c75a1000-0000-4000-8000-000000000002','P75G linked, no onboarding',false,false),
 ('c75a1000-0000-4000-8000-000000000003','P75G legacy review',false,false),
 ('c75a1000-0000-4000-8000-000000000007','P75G legacy rejected',false,false),
 ('c75a1000-0000-4000-8000-000000000016','P75G legacy active',false,false);
-- Applications, inserted with their real triggers (intake version, admin notice, owner email row).
-- a01..a17: one per state the page distinguishes, plus a created_at tie (a14, a15) and an
-- unrecognized legacy status (a17).
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,address,status,created_at) values
 ('c75a2000-0000-4000-8000-000000000001','P75G a01 null contractor','Ann','A','p75g-a01@example.invalid','synthetic','1 Probe St','pending','2026-10-01 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000002','P75G a02 linked, no onboarding','Ann','A','p75g-a02@example.invalid','synthetic','1 Probe St','pending','2026-10-02 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000003','P75G a03 legacy onboarding review, no start','Ann','A','p75g-a03@example.invalid','synthetic','1 Probe St','pending','2026-10-03 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000004','P75G a04 review started','Ann','A','p75g-a04@example.invalid','synthetic','1 Probe St','pending','2026-10-04 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000005','P75G a05 started, active','Ann','A','p75g-a05@example.invalid','synthetic','1 Probe St','pending','2026-10-05 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000006','P75G a06 started, suspended','Ann','A','p75g-a06@example.invalid','synthetic','1 Probe St','pending','2026-10-06 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000007','P75G a07 legacy onboarding rejected, no start','Ann','A','p75g-a07@example.invalid','synthetic','1 Probe St','pending','2026-10-07 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000008','P75G a08 application rejected','Ann','A','p75g-a08@example.invalid','synthetic','1 Probe St','rejected','2026-10-08 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000009','P75G a09 abandoned','Ann','A','p75g-a09@example.invalid','synthetic','1 Probe St','abandoned','2026-10-09 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000010','P75G a10 legacy approved','Ann','A','p75g-a10@example.invalid','synthetic','1 Probe St','approved','2026-10-10 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000011','P75G a11 legacy approved, started','Ann','A','p75g-a11@example.invalid','synthetic','1 Probe St','approved','2026-10-11 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000012','P75G a12 started, then abandoned','Ann','A','p75g-a12@example.invalid','synthetic','1 Probe St','pending','2026-10-12 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000013','P75G a13 revised intake','Ann','A','p75g-a13@example.invalid','synthetic','1 Probe St','pending','2026-09-20 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000015','P75G a15 tie, later id','Ann','A','p75g-a15@example.invalid','synthetic','1 Probe St','pending','2026-10-14 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000014','P75G a14 tie, earlier id','Ann','A','p75g-a14@example.invalid','synthetic','1 Probe St','pending','2026-10-14 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000016','P75G a16 legacy onboarding active, no start','Ann','A','p75g-a16@example.invalid','synthetic','1 Probe St','pending','2026-10-16 09:00:00+00'),
 ('c75a2000-0000-4000-8000-000000000017','P75G a17 unrecognized status','Ann','A','p75g-a17@example.invalid','synthetic','1 Probe St','reviewing','2026-10-17 09:00:00+00');
-- a13: two intake corrections after receipt, so three intake versions (R-3, C-3).
update public.vendor_applications set business_name = 'P75G a13 revised intake (2)', updated_at = '2026-11-01 09:00:00+00'
 where id = 'c75a2000-0000-4000-8000-000000000013';
update public.vendor_applications set phone = 'synthetic-2', updated_at = '2026-11-20 09:00:00+00'
 where id = 'c75a2000-0000-4000-8000-000000000013';
-- Links to existing contractors (contractor_id is not an intake field, so no new version).
update public.vendor_applications a set contractor_id = v.c from (values
 ('c75a2000-0000-4000-8000-000000000002'::uuid,'c75a1000-0000-4000-8000-000000000002'::uuid),
 ('c75a2000-0000-4000-8000-000000000003','c75a1000-0000-4000-8000-000000000003'),
 ('c75a2000-0000-4000-8000-000000000007','c75a1000-0000-4000-8000-000000000007'),
 ('c75a2000-0000-4000-8000-000000000016','c75a1000-0000-4000-8000-000000000016')) v(a, c) where a.id = v.a;

create function pg_temp.as_user(n text) returns void language sql as $$
  select set_config('request.jwt.claims','{"role":"authenticated","sub":"c75a0000-0000-4000-8000-00000000000'||n||'"}',true) $$;
-- Each application's latest intake version, read as the owner (the commands require it).
create table pg_temp.v as select distinct on (application_id) application_id, id from public.vendor_application_versions
  where application_id::text like 'c75a2000-%' order by application_id, revision desc;
grant select on pg_temp.v to authenticated;
create function pg_temp.latest_version(app uuid) returns uuid language sql as $$
  select id from pg_temp.v where application_id = app $$;
grant execute on function pg_temp.latest_version(uuid) to authenticated;

-- Real commands as the operator: the reviewed start (review-start row, onboarding anchor) and the
-- recovered pipeline's begin-review (linked onboarding, no review-start row).
set local role authenticated;
select pg_temp.as_user('1');
select public.vendor_start_onboarding_review(a, pg_temp.latest_version(a), 'Synthetic review start', 'p75g-start-'||a)
  from unnest(array['c75a2000-0000-4000-8000-000000000004','c75a2000-0000-4000-8000-000000000005',
    'c75a2000-0000-4000-8000-000000000006','c75a2000-0000-4000-8000-000000000011',
    'c75a2000-0000-4000-8000-000000000012']::uuid[]) a;
select public.vendor_begin_review(c, pg_temp.latest_version(a))
  from (values ('c75a2000-0000-4000-8000-000000000003'::uuid,'c75a1000-0000-4000-8000-000000000003'::uuid),
    ('c75a2000-0000-4000-8000-000000000007','c75a1000-0000-4000-8000-000000000007'),
    ('c75a2000-0000-4000-8000-000000000016','c75a1000-0000-4000-8000-000000000016')) v(a, c);
reset role;
-- Later onboarding outcomes and a closure, written as the owner (the outcome commands need evidence
-- this queue does not read; only the resulting status matters here).
set local session_replication_role = replica;
update public.vendor_onboarding o set status = v.s from (values
 ('c75a2000-0000-4000-8000-000000000005'::uuid,'active'),('c75a2000-0000-4000-8000-000000000006','suspended')) v(a, s)
 where o.contractor_id = (select contractor_id from public.vendor_onboarding_review_starts where application_id = v.a);
update public.vendor_onboarding set status = 'rejected' where contractor_id = 'c75a1000-0000-4000-8000-000000000007';
update public.vendor_onboarding set status = 'active' where contractor_id = 'c75a1000-0000-4000-8000-000000000016';
update public.vendor_applications set status = 'abandoned' where id = 'c75a2000-0000-4000-8000-000000000012';
set local session_replication_role = origin;

-- The parity readback: per fixture application, the status the page selects and the fields of
-- vendor_onboarding_intake_status that applicationQueueState reads, then the server queue, all read
-- by one admin in one statement (one database state).
create function pg_temp.parity() returns jsonb language sql as $$
  select jsonb_build_object(
    'applications', (select jsonb_agg(jsonb_build_object('application_id', a.id, 'status', a.status,
        'onboarding_status', r->'onboarding_status', 'review_started', r->'review_started') order by a.id)
      from public.vendor_applications a, lateral (select public.vendor_onboarding_intake_status(a.id) r) x
      where a.id::text like 'c75a2000-%'),
    'items', public.admin_application_review_queue()->'items') $$;
grant execute on function pg_temp.parity() to authenticated;
-- END 7.5G-1 FIXTURES

create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v; return coalesce(v,'<null>');
exception when others then return 'REFUSED '||sqlstate;
end $$;
grant execute on function pg_temp.val(text) to authenticated, anon;
create function pg_temp.row_of(s jsonb, queue text) returns jsonb language sql as $$
  select r from jsonb_array_elements(s->'queues') r where r->>'queue' = $2 $$;

-- Reads kept for the comparisons below (same transaction, same now()).
create table pg_temp.r(k text primary key, v jsonb);
grant select, insert on pg_temp.r to authenticated;
set local role authenticated;
select pg_temp.as_user('1');
insert into pg_temp.r values ('queue', public.admin_application_review_queue()), ('parity', pg_temp.parity()),
  ('summary_admin', public.admin_operations_summary());
select pg_temp.as_user('4');
insert into pg_temp.r values ('summary_finance', public.admin_operations_summary());
reset role;
create function pg_temp.got(k text) returns jsonb language sql as $$ select v from pg_temp.r where r.k = $1 $$;

-- F  The fixtures are what the cases need.
select is((select count(*)::int from public.vendor_application_versions where application_id = 'c75a2000-0000-4000-8000-000000000013'), 3,
  'F a13 has three intake versions (received, then two corrections)');
select is((select count(*)::int from public.vendor_onboarding_review_starts where application_id::text like 'c75a2000-%'), 5,
  'F five review starts (a04, a05, a06, a11, a12)');
select is((select array_agg(application_id::text order by application_id) from public.vendor_onboarding_review_starts where application_id::text like 'c75a2000-%'),
  array['c75a2000-0000-4000-8000-000000000004','c75a2000-0000-4000-8000-000000000005','c75a2000-0000-4000-8000-000000000006',
    'c75a2000-0000-4000-8000-000000000011','c75a2000-0000-4000-8000-000000000012'], 'F review starts are on the intended applications');
select is((select array_agg(contractor_id::text || ':' || status order by contractor_id) from public.vendor_onboarding
  where contractor_id in ('c75a1000-0000-4000-8000-000000000003','c75a1000-0000-4000-8000-000000000007','c75a1000-0000-4000-8000-000000000016')),
  array['c75a1000-0000-4000-8000-000000000003:review','c75a1000-0000-4000-8000-000000000007:rejected','c75a1000-0000-4000-8000-000000000016:active'],
  'F linked onboarding without a review start: review, rejected, active');
select ok(not exists(select 1 from public.vendor_onboarding_review_starts s join public.vendor_applications a on a.id = s.application_id
  where a.contractor_id in ('c75a1000-0000-4000-8000-000000000003','c75a1000-0000-4000-8000-000000000007','c75a1000-0000-4000-8000-000000000016')),
  'F the legacy-linked applications have no review-start row');
select is((select contractor_id from public.vendor_applications where id = 'c75a2000-0000-4000-8000-000000000001'), null, 'F a01 has no contractor');

-- Q  The queue: exactly the awaiting applications, received time, deterministic order.
select is((select array_agg(i->>'application_id' order by n) from jsonb_array_elements(pg_temp.got('queue')->'items') with ordinality x(i, n)),
  array['c75a2000-0000-4000-8000-000000000013','c75a2000-0000-4000-8000-000000000001','c75a2000-0000-4000-8000-000000000002',
    'c75a2000-0000-4000-8000-000000000003','c75a2000-0000-4000-8000-000000000014','c75a2000-0000-4000-8000-000000000015',
    'c75a2000-0000-4000-8000-000000000016','c75a2000-0000-4000-8000-000000000017'],
  'Q1 exactly a13, a01, a02, a03, a14, a15, a16, a17, ordered by created_at then id');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('queue')->'items') i
  join public.vendor_applications a on a.id = (i->>'application_id')::uuid where (i->>'since')::timestamptz = a.created_at), 8,
  'Q2 since = created_at (application received) for every item');
select is((select (i->>'since')::timestamptz from jsonb_array_elements(pg_temp.got('queue')->'items') i
  where i->>'application_id' = 'c75a2000-0000-4000-8000-000000000013'), '2026-09-20 09:00:00+00'::timestamptz,
  'Q3 three intake versions later, a13 is still received at its created_at (revisions do not reset it)');
select ok((select max(created_at) from public.vendor_application_versions where application_id = 'c75a2000-0000-4000-8000-000000000013')
  > '2026-09-20 09:00:00+00'::timestamptz, 'Q3b a13 has an intake version newer than its received time');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(pg_temp.got('queue')->'items') i, jsonb_object_keys(i) k),
  array['application_id','since'], 'Q4 items carry only application_id and since');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.got('queue')) k), array['checked_at','items'], 'Q4b response is {checked_at, items}');
select is((pg_temp.got('queue')->>'checked_at')::timestamptz, now(), 'Q4c checked_at = now()');

-- P  Cross-layer parity source: the database output equals the committed fixture (the unit test
-- runs the real applicationQueueState over it). Regenerate with
-- scripts/derive-application-review-parity.mjs, never by hand.
select is(pg_temp.got('parity'), $parity${"applications":[
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000001","review_started":false,"onboarding_status":null},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000002","review_started":false,"onboarding_status":null},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000003","review_started":false,"onboarding_status":"review"},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000004","review_started":true,"onboarding_status":"review"},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000005","review_started":true,"onboarding_status":"active"},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000006","review_started":true,"onboarding_status":"suspended"},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000007","review_started":false,"onboarding_status":"rejected"},
{"status":"rejected","application_id":"c75a2000-0000-4000-8000-000000000008","review_started":false,"onboarding_status":null},
{"status":"abandoned","application_id":"c75a2000-0000-4000-8000-000000000009","review_started":false,"onboarding_status":null},
{"status":"approved","application_id":"c75a2000-0000-4000-8000-000000000010","review_started":false,"onboarding_status":null},
{"status":"approved","application_id":"c75a2000-0000-4000-8000-000000000011","review_started":true,"onboarding_status":"review"},
{"status":"abandoned","application_id":"c75a2000-0000-4000-8000-000000000012","review_started":true,"onboarding_status":"review"},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000013","review_started":false,"onboarding_status":null},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000014","review_started":false,"onboarding_status":null},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000015","review_started":false,"onboarding_status":null},
{"status":"pending","application_id":"c75a2000-0000-4000-8000-000000000016","review_started":false,"onboarding_status":"active"},
{"status":"reviewing","application_id":"c75a2000-0000-4000-8000-000000000017","review_started":false,"onboarding_status":null}
],"items":[
{"since":"2026-09-20T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000013"},
{"since":"2026-10-01T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000001"},
{"since":"2026-10-02T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000002"},
{"since":"2026-10-03T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000003"},
{"since":"2026-10-14T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000014"},
{"since":"2026-10-14T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000015"},
{"since":"2026-10-16T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000016"},
{"since":"2026-10-17T09:00:00+00:00","application_id":"c75a2000-0000-4000-8000-000000000017"}
]}$parity$::jsonb, 'P1 parity readback equals tests/fixtures/application-review-queue-parity.json');

-- S  The summary row: after offer_terms, before finance; count = the queue; no aging rule.
select is((select array_agg(r->>'queue' order by n) from jsonb_array_elements(pg_temp.got('summary_admin')->'queues') with ordinality x(r, n)),
  array['quote','recurring_payment','fulfillment','cancellation','support','compliance_renewal','renewal_documents','offer_terms','applications','finance_exceptions'],
  'S1 queue order: applications after offer_terms, finance last');
select is(pg_temp.row_of(pg_temp.got(k), 'applications'), '{"queue":"applications","state":"ready","count":8,"aged":null}'::jsonb,
  format('S2 applications row: count 8 = queue, aged null (%s)', k)) from unnest(array['summary_admin','summary_finance']) k;
select is((pg_temp.row_of(pg_temp.got('summary_admin'), 'applications')->>'count')::int, jsonb_array_length(pg_temp.got('queue')->'items'),
  'S2b summary count equals the queue read in the same transaction');
select is(pg_temp.row_of(pg_temp.got('summary_admin'), 'finance_exceptions'), '{"queue":"finance_exceptions","state":"restricted","count":null,"aged":null}'::jsonb,
  'S3 finance restricted without authority');
select is(pg_temp.row_of(pg_temp.got('summary_finance'), 'finance_exceptions')->>'state', 'ready', 'S3 finance ready with authority');
select is((select count(*)::int from jsonb_array_elements(pg_temp.got('summary_finance')->'queues') r where r->>'state' <> 'ready'), 0,
  'S3b every row ready for the finance holder');

-- W  Read-only: neither function writes a row.
create table pg_temp.w(n bigint);
insert into pg_temp.w select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%';
set local role authenticated;
select pg_temp.as_user('1');
select public.admin_application_review_queue() is not null;
select public.admin_operations_summary() is not null;
select pg_temp.as_user('4');
select public.admin_operations_summary() is not null;
reset role;
select is((select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%'),
  (select n from pg_temp.w), 'W1 the queue and the summary write no row');
select is((select provolatile::text from pg_proc where oid = 'public.admin_application_review_queue()'::regprocedure), 's', 'W2 the queue is STABLE');

-- A  Access: admin only; no PUBLIC, anon or service_role execute; definer with an empty search_path.
set local role authenticated;
select pg_temp.as_user('2');
select is(pg_temp.val('select public.admin_application_review_queue()::text'), 'REFUSED 42501', 'A1 homeowner refused');
select pg_temp.as_user('3');
select is(pg_temp.val('select public.admin_application_review_queue()::text'), 'REFUSED 42501', 'A1 vendor refused');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.val('select public.admin_application_review_queue()::text'), 'REFUSED 42501', 'A1 signed-in caller without identity refused');
reset role;
set local role anon;
select is(pg_temp.val('select public.admin_application_review_queue()::text'), 'REFUSED 42501', 'A1 anon refused');
reset role;
select is((select proacl::text from pg_proc where oid = 'public.admin_application_review_queue()'::regprocedure),
  '{postgres=X/postgres,authenticated=X/postgres}', 'A2 execute: owner and authenticated only');
select ok(not has_function_privilege(r, 'public.admin_application_review_queue()', 'execute'), format('A2 no execute for %s', r))
  from unnest(array['anon','service_role']) r;
select ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres'
  from pg_proc where oid = 'public.admin_application_review_queue()'::regprocedure), 'A3 security definer, empty search_path, owner postgres');
select is((select proacl::text from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'A4 summary grants unchanged');
select ok((select prosecdef and proconfig = array['search_path=""'] and provolatile = 'v' and pg_get_userbyid(proowner) = 'postgres'
  from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure), 'A4 summary still security definer, empty search_path, owner postgres');

-- E  Per-queue error isolation: a failing applications reader turns only its own row into an
-- error; every other row, finance included, keeps its value. Stand-in inside this transaction.
create or replace function public.admin_application_review_queue() returns jsonb language plpgsql as $f$
begin raise exception 'synthetic applications failure'; end $f$;
set local role authenticated;
select pg_temp.as_user('4');
select is(pg_temp.val($q$select r::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'applications'$q$),
  '{"aged": null, "count": null, "queue": "applications", "state": "error"}', 'E1 failing applications reader: its row is an error');
select is(pg_temp.val($q$select jsonb_agg(r)::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' <> 'applications'$q$),
  (select jsonb_agg(r)::text from jsonb_array_elements(pg_temp.got('summary_finance')->'queues') r where r->>'queue' <> 'applications'),
  'E1 every other row unchanged, finance included');
select pg_temp.as_user('1');
select is(pg_temp.val($q$select r::text from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'finance_exceptions'$q$),
  '{"aged": null, "count": null, "queue": "finance_exceptions", "state": "restricted"}', 'E2 finance still restricted for a non-holder');
reset role;

select * from finish();
rollback;
