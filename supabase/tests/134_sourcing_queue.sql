-- Phase 7.5G-2 (TRACE-159): the sourcing queue (20261206001000).
-- Plan: governance/PHASE-7-SOURCING-QUEUE-PLAN-7-5G-2.md §3–§10 (Codex SG-1..SG-9; OD-4a, DEC-2026-070).
--
-- public.admin_sourcing_queue() lists pending requests whose matching ended in 'exhausted',
-- 'awaiting_consent' or legacy 'sourcing', with the latest related stored event and its basis,
-- plan_visit and offer_terms_block; it settles nothing and writes nothing. The summary's 'sourcing'
-- row counts it, after applications and before finance.
--
-- Fixtures are reached through the real commands: the matcher (private.offer_next_for_request_internal),
-- vendor_decline_job, vendor_accept_job, record_job_operation, consent_to_provider_fallback,
-- admin_retry_offer_terms_matching and expire_stale_matches, on SQL 102's quote-package pattern.
-- Exceptions, each named where it happens (I-4..I-6 in the 7.5G-2 record):
--   * the legacy 'sourcing' row and the rematch_failed row are written as the owner in replica mode
--     (no live producer writes 'sourcing'; the 7.5C method);
--   * one transaction has one now(), so every command stamps the same time. Where an assertion needs
--     two events at different times, the stored time is moved afterwards as the owner in replica
--     mode, and the move is named;
--   * one offer's expires_at is moved into the past to stand for an offer whose response window has
--     passed (as SQL 006 does).
-- Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 admin, 2 homeowner, 3 provider A, 4 provider B, 5 admin with finance authority, 6 vendor without a contractor.
insert into auth.users(id, raw_user_meta_data) select ('c75c0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '{}'
  from generate_series(1, 6) n;
insert into public.user_roles(user_id, role) values
  ('c75c0000-0000-4000-8000-000000000001', 'admin'), ('c75c0000-0000-4000-8000-000000000002', 'homeowner'),
  ('c75c0000-0000-4000-8000-000000000003', 'vendor'), ('c75c0000-0000-4000-8000-000000000004', 'vendor'),
  ('c75c0000-0000-4000-8000-000000000005', 'admin'), ('c75c0000-0000-4000-8000-000000000006', 'vendor')
  on conflict do nothing;
insert into public.money_authorities(user_id, granted_by, reason) values
  ('c75c0000-0000-4000-8000-000000000005', 'c75c0000-0000-4000-8000-000000000005', 'Synthetic finance holder');

create function pg_temp.u(n integer) returns uuid language sql immutable as
  $$ select ('c75c0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as
  $$ select ('c75c1000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n integer) returns uuid language sql immutable as
  $$ select ('c75c2000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql immutable as
  $$ select ('c75c4000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.pkg(contractor integer, weekly boolean default false) returns uuid language sql immutable as
  $$ select ('c75c9000-0000-4000-8000-0000000000' || case when weekly then '2' else '1' end || contractor)::uuid $$;

-- Providers: A (1) and B (2) active with quote packages; P (3) and Q (4) inactive, used only as a
-- homeowner's preferred provider (fallback consent) and as a plan's provider who is no longer eligible.
insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values
  ('c75c1000-0000-4000-8000-000000000001', 'c75c0000-0000-4000-8000-000000000003', 'P75C provider A', true, true),
  ('c75c1000-0000-4000-8000-000000000002', 'c75c0000-0000-4000-8000-000000000004', 'P75C provider B', true, true),
  ('c75c1000-0000-4000-8000-000000000003', null, 'P75C preferred, inactive', false, true),
  ('c75c1000-0000-4000-8000-000000000004', null, 'P75C plan provider, inactive', false, true);
-- ZIPs: 00710 no provider; 00711 A and B; 00712 A only.
insert into public.coverage_areas(zip_code, city) values ('00710', 'P75C none'), ('00711', 'P75C A and B'), ('00712', 'P75C A only')
  on conflict do nothing;
insert into public.contractor_service_zips(contractor_id, zip_code) values
  ('c75c1000-0000-4000-8000-000000000001', '00711'), ('c75c1000-0000-4000-8000-000000000002', '00711'),
  ('c75c1000-0000-4000-8000-000000000001', '00712');
insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active)
select pg_temp.pkg(n, weekly), pg_temp.c(n), (select id from public.services_catalog order by id limit 1),
  'P75C ' || freq || ' quote', 'custom_quote', freq, true
from generate_series(1, 2) n, (values (false, 'one-time'), (true, 'weekly')) v(weekly, freq);

create function pg_temp.call(who integer, statement text) returns text language plpgsql as $$
declare result text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.u(who))::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement into result;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return result;
exception when others then
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  raise;
end $$;
create function pg_temp.err(statement text) returns text language plpgsql as $$
begin
  execute statement; return 'ok';
exception when others then return sqlstate;
end $$;
-- A one-time request (or a plan visit) as the homeowner's submission would store it.
create function pg_temp.request(n integer, zip text, created_ago interval default interval '0', preferred integer default null,
  parent integer default null) returns void language sql as $$
  insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code, created_at,
    preferred_contractor_id, recurrence_parent_id, occurrence_key)
  values (pg_temp.r(n), pg_temp.u(2), 'P75C request ' || n, 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    case when parent is null then 'one-time' else 'weekly' end, zip, now() - created_ago,
    case when preferred is null then null else pg_temp.c(preferred) end,
    case when parent is null then null else pg_temp.r(parent) end,
    case when parent is null then null else pg_temp.k(5000 + n) end)
$$;
create function pg_temp.match(n integer) returns uuid language sql as $$ select private.offer_next_for_request_internal(pg_temp.r(n)) $$;
create function pg_temp.gate(p_on boolean) returns void language sql as
  $$ update private.money_feature_gates set enabled = p_on, reason = 'Synthetic 7.5G-2 gate' where name = 'offer_terms' $$;
create function pg_temp.op(who integer, n integer, key integer, kind text) returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.record_job_operation(%L, %L, %L, ''Synthetic operation'')::text',
    pg_temp.r(n), pg_temp.k(key), kind))::jsonb $$;
-- Provider A is offered the request directly and accepts it (the ordinary path), with an appointment.
create function pg_temp.accepted(n integer, hours numeric) returns void language plpgsql as $$
begin
  perform private.create_job_offer_internal(pg_temp.r(n), pg_temp.c(1), pg_temp.pkg(1), null, false);
  perform pg_temp.call(3, format('select public.vendor_accept_job(%L)::text', pg_temp.r(n)));
  update public.service_requests set scheduled_start_at = date_trunc('minute', now() + make_interval(mins => (hours * 60)::int)) where id = pg_temp.r(n);
end $$;
create function pg_temp.req(n integer) returns public.service_requests language sql as
  $$ select * from public.service_requests where id = pg_temp.r(n) $$;
create function pg_temp.state(n integer) returns text language sql as
  $$ select (pg_temp.req(n)).status || '/' || (pg_temp.req(n)).matching_status $$;
create function pg_temp.queue() returns jsonb language sql as
  $$ select pg_temp.call(1, 'select public.admin_sourcing_queue()::text')::jsonb $$;
create function pg_temp.offer_terms() returns jsonb language sql as
  $$ select pg_temp.call(1, 'select public.admin_offer_terms_queue()::text')::jsonb $$;
-- The reader's items, keyed by fixture number (or 0 for a request that is not a fixture).
create function pg_temp.items() returns table(pos bigint, n integer, kind text, related_event text, related_event_at timestamptz,
  plan_visit boolean, offer_terms_block boolean) language sql as $$
  select x.pos, coalesce((select g from generate_series(1, 99) g where pg_temp.r(g) = (x.i->>'request_id')::uuid), 0),
    x.i->>'kind', x.i->>'related_event', (x.i->>'related_event_at')::timestamptz, (x.i->>'plan_visit')::boolean, (x.i->>'offer_terms_block')::boolean
  from jsonb_array_elements(pg_temp.queue()->'items') with ordinality x(i, pos) $$;
create function pg_temp.listed(n integer) returns boolean language sql as
  $$ select exists(select 1 from pg_temp.items() i where i.n = $1) $$;

-- The exact results below assume a database with no request already in this queue (a clean replay
-- with the synthetic seed). Stop with a clear message rather than report a confusing difference.
do $$ begin
  if jsonb_array_length(pg_temp.queue()->'items') <> 0 then
    raise exception '7.5G-2 fixtures need a database with no request in the sourcing queue';
  end if;
end $$;
select is((select enabled from private.money_feature_gates where name = 'offer_terms'), false, 'F0 the offer_terms gate starts off');

-- Fixtures, gate off ------------------------------------------------------------------------------
-- r02 P-2: one-time, no candidate, gate off: exhausted, with a block whose candidates are [].
select pg_temp.request(2, '00710', interval '9 days');
select pg_temp.match(2);
-- r03 P-2 again; its block then lists a gate-skipped candidate. The reader never reads candidates,
-- so the list is written as the owner (an other-terms candidate needs the full pricing-v2 setup of SQL 117).
select pg_temp.request(3, '00710', interval '8 days');
select pg_temp.match(3);
set local session_replication_role = replica;
update private.offer_terms_blocks set candidates = jsonb_build_array(jsonb_build_object('contractor_id', pg_temp.c(2),
  'package_id', pg_temp.pkg(2), 'package_tier_id', null)) where request_id = pg_temp.r(3);
set local session_replication_role = origin;
-- r04 P-2, later retried after activation (below).
select pg_temp.request(4, '00710', interval '7 days');
select pg_temp.match(4);
-- r05 Declined, then exhausted: A is offered, declines, nobody else serves 00712.
select pg_temp.request(5, '00712');
select pg_temp.match(5);
select pg_temp.call(3, format('select public.vendor_decline_job(%L, ''Synthetic decline'')::text', pg_temp.r(5)));
-- r06 Expired in the matcher: A's offer window has passed (expires_at moved back two hours); the
-- next matcher run settles it (responded_at = now()) and exhausts.
select pg_temp.request(6, '00712');
select pg_temp.match(6);
update public.job_match_attempts set expires_at = now() - interval '2 hours' where service_request_id = pg_temp.r(6) and outcome = 'pending';
select pg_temp.match(6);
-- r07 E5 replacement search closed after a provider cancel: A accepts, withdraws 100 hours ahead, B is
-- offered; the appointment moves inside 24 hours and B declines. The operation and B's decline share now().
select pg_temp.request(7, '00711');
select pg_temp.accepted(7, 100);
select pg_temp.op(3, 7, 701, 'provider_cancel');
update public.service_requests set scheduled_start_at = now() + interval '10 hours' where id = pg_temp.r(7);
select pg_temp.call(4, format('select public.vendor_decline_job(%L, ''Synthetic decline'')::text', pg_temp.r(7)));
-- r08 The same path; then the operation's stored time is moved one hour back, so the decline is later.
select pg_temp.request(8, '00711');
select pg_temp.accepted(8, 100);
select pg_temp.op(3, 8, 801, 'provider_cancel');
update public.service_requests set scheduled_start_at = now() + interval '10 hours' where id = pg_temp.r(8);
select pg_temp.call(4, format('select public.vendor_decline_job(%L, ''Synthetic decline'')::text', pg_temp.r(8)));
-- r09 P-5 inside the search deadline: A accepts, then withdraws 20 hours ahead. The operation's stored
-- time is then moved three hours back, so the acceptance (responded_at) is later than every closing
-- event: acceptance is not a closing event.
select pg_temp.request(9, '00712');
select pg_temp.accepted(9, 20);
create temp table op9 as select pg_temp.op(3, 9, 901, 'provider_cancel') as a;
-- r10 P-5 with an offer still pending: A withdraws from the open offer 20 hours before the appointment;
-- the operation row and the attempt's withdrawn_at take the same now().
select pg_temp.request(10, '00712');
select pg_temp.match(10);
update public.service_requests set scheduled_start_at = now() + interval '20 hours' where id = pg_temp.r(10);
create temp table op10 as select pg_temp.op(3, 10, 1001, 'provider_cancel') as a;
-- r30 a weekly plan with A; r11 its visit, accepted by A and withdrawn (DEC-2026-049 item 8: never re-offered).
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, service_catalog_id, status, matching_status,
  frequency, zip_code, scheduled_start_at) values
  (pg_temp.r(30), pg_temp.u(2), pg_temp.c(1), 'P75C plan', 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    'scheduled', 'matched', 'weekly', '00711', now() + interval '100 hours');
select pg_temp.request(11, '00711', interval '0', 1, 30);
update public.service_requests set scheduled_start_at = now() + interval '101 hours' where id = pg_temp.r(11);
select private.create_job_offer_internal(pg_temp.r(11), pg_temp.c(1), pg_temp.pkg(1, true), null, false);
select pg_temp.call(3, format('select public.vendor_accept_job(%L)::text', pg_temp.r(11)));
select pg_temp.op(3, 11, 1101, 'provider_cancel');
-- r12 a visit of a plan whose provider (Q) is no longer eligible: the matcher offers nobody else.
select pg_temp.request(12, '00711', interval '6 days', 4, 30);
select pg_temp.match(12);
-- r13 P-4: the homeowner's preferred provider (P) is not eligible; A is a candidate, but fallback needs consent.
select pg_temp.request(13, '00712', interval '5 days', 3);
select pg_temp.match(13);
-- r14 the same, then the homeowner consents and A is offered.
select pg_temp.request(14, '00712', interval '0', 3);
select pg_temp.match(14);
create temp table before_consent as select pg_temp.state(14) as s;
select pg_temp.call(2, format('select coalesce(public.consent_to_provider_fallback(%L)::text, '''')', pg_temp.r(14)));
-- r17 awaiting a first match (no search has run).
select pg_temp.request(17, '00711');
-- r19 an offer whose response window has passed but which nothing has settled.
select pg_temp.request(19, '00712');
select pg_temp.match(19);
update public.job_match_attempts set expires_at = now() - interval '1 hour' where service_request_id = pg_temp.r(19) and outcome = 'pending';
-- r20 accepted by A (a provider holds it).
select pg_temp.request(20, '00712');
select pg_temp.accepted(20, 100);

-- r24 a decline whose re-match failed (written as the owner, as SQL 127 does), retried while the gate
-- is off: the retry's matcher records a new block in the retry's own transaction, so block and retry
-- share now(). Only a strictly later retry clears a block (SQL 117 finding 1), so it stays blocked.
set local session_replication_role = replica;
insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code, created_at,
  status, matching_status, needs_admin_review) values
  (pg_temp.r(24), pg_temp.u(2), 'P75C rematch failed, retried', 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    'one-time', '00710', now() - interval '1 day', 'pending', 'awaiting_match', true);
insert into private.offer_terms_rematch_failures(request_id, terms_id, via, last_attempt, sqlstate, message, created_at) values
  (pg_temp.r(24), null, 'terms', 0, 'P0001', 'Synthetic re-match failure', now() - interval '2 hours');
set local session_replication_role = origin;
create temp table retry24 as select pg_temp.call(1, format('select public.admin_retry_offer_terms_matching(%L, %L, ''Synthetic retry'')::text',
  pg_temp.r(24), pg_temp.k(2401)))::jsonb as a;

-- Fixtures, gate on --------------------------------------------------------------------------------
select pg_temp.gate(true);
-- r01 P-1: no eligible provider while the gate is on: exhausted, no block.
select pg_temp.request(1, '00710', interval '10 days');
select pg_temp.match(1);
-- r21, r22 the same, with equal created_at; r22 is inserted first, r21 has the lower id.
select pg_temp.request(22, '00710', interval '3 days');
select pg_temp.request(21, '00710', interval '3 days');
update public.service_requests set created_at = (pg_temp.req(22)).created_at where id = pg_temp.r(21);
select pg_temp.match(22);
select pg_temp.match(21);
-- r16 exhausted, then cancelled by the homeowner (cancellation leaves 'exhausted' and the flag).
select pg_temp.request(16, '00710', interval '2 days');
select pg_temp.match(16);
select pg_temp.op(2, 16, 1601, 'customer_cancel');
-- r04 retried after activation. Its block's stored time is moved one hour back first: in one
-- transaction a retry and the block share now(), and only a strictly later retry clears a block.
set local session_replication_role = replica;
update private.offer_terms_blocks set created_at = now() - interval '1 hour' where request_id = pg_temp.r(4);
set local session_replication_role = origin;
create temp table retry4 as select pg_temp.call(1, format('select public.admin_retry_offer_terms_matching(%L, %L, ''Synthetic retry'')::text',
  pg_temp.r(4), pg_temp.k(401)))::jsonb as a;

-- Owner-written rows and moved times (replica mode) -------------------------------------------------
set local session_replication_role = replica;
-- r15 legacy 'sourcing', as the superseded Phase 1 matcher left it.
insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code, created_at,
  status, matching_status, needs_admin_review) values
  (pg_temp.r(15), pg_temp.u(2), 'P75C legacy', 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    'one-time', '00710', now() - interval '4 days', 'pending', 'sourcing', true);
-- r18 a decline whose re-match failed (pending, awaiting_match), as SQL 127 writes it.
insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code,
  status, matching_status, needs_admin_review) values
  (pg_temp.r(18), pg_temp.u(2), 'P75C rematch failed', 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    'one-time', '00711', 'pending', 'awaiting_match', true);
insert into private.offer_terms_rematch_failures(request_id, terms_id, via, last_attempt, sqlstate, message, created_at) values
  (pg_temp.r(18), null, 'terms', 0, 'P0001', 'Synthetic re-match failure', now() - interval '3 hours');
-- r05's decline moved two days back (declined_at and responded_at together).
update public.job_match_attempts set declined_at = now() - interval '2 days', responded_at = now() - interval '2 days'
  where service_request_id = pg_temp.r(5) and outcome = 'declined';
-- r08's operation one hour back; r09's three hours back.
update public.job_operations set created_at = now() - interval '1 hour' where job_id = pg_temp.r(8);
update public.job_operations set created_at = now() - interval '3 hours' where job_id = pg_temp.r(9);
set local session_replication_role = origin;

-- F Fixtures reached the intended states ----------------------------------------------------------
select is(pg_temp.state(n), s, format('F1 r%s is %s', lpad(n::text, 2, '0'), s)) from (values
  (1, 'pending/exhausted'), (2, 'pending/exhausted'), (3, 'pending/exhausted'), (4, 'pending/exhausted'), (5, 'pending/exhausted'),
  (6, 'pending/exhausted'), (7, 'pending/exhausted'), (8, 'pending/exhausted'), (9, 'pending/exhausted'), (10, 'pending/exhausted'),
  (11, 'pending/exhausted'), (12, 'pending/exhausted'), (13, 'pending/awaiting_consent'), (14, 'matched/offered'),
  (15, 'pending/sourcing'), (16, 'cancelled/exhausted'), (17, 'pending/awaiting_match'), (18, 'pending/awaiting_match'),
  (19, 'matched/offered'), (21, 'pending/exhausted'), (22, 'pending/exhausted'), (24, 'pending/exhausted')) v(n, s) order by n;
select ok((pg_temp.req(20)).status in ('matched', 'scheduled') and (pg_temp.req(20)).matching_status = 'matched', 'F1 r20 is held by provider A');
select is((select s from before_consent), 'pending/awaiting_consent', 'F1 r14 waited for consent before the homeowner consented');
select is((select a->>'inside_search_deadline' from op9), 'true', 'F2 r09''s withdrawal is inside the 24-hour search deadline');
select is((select a->>'inside_search_deadline' from op10), 'true', 'F2 r10''s withdrawal is inside the 24-hour search deadline');
select is((select outcome from public.job_match_attempts where service_request_id = pg_temp.r(10)), 'withdrawn', 'F2 r10''s pending offer was withdrawn');
select is((select withdrawn_at from public.job_match_attempts where service_request_id = pg_temp.r(10)),
  (select created_at from public.job_operations where job_id = pg_temp.r(10)), 'F2 r10: the operation and withdrawn_at share one time (P-5 tie)');
select is((select outcome || ':' || (responded_at = now())::text || ':' || (expires_at < now() - interval '1 hour')::text
  from public.job_match_attempts where service_request_id = pg_temp.r(6)), 'expired:true:true', 'F2 r06''s expiry was processed now, after expires_at');
select is((select array_agg(outcome order by attempt_number) from public.job_match_attempts where service_request_id = pg_temp.r(7)),
  array['accepted', 'declined'], 'F2 r07: A accepted, B declined');
select is((select retry4.a->>'matching_status' from retry4), 'exhausted', 'F2 r04''s retry ran the matcher and re-exhausted');
select is((select (b.created_at = x.created_at)::text from private.offer_terms_blocks b, private.offer_terms_retries x
  where b.request_id = pg_temp.r(24) and x.request_id = pg_temp.r(24)), 'true', 'F2 r24: the retry and the block it recorded share one time');
select is((select count(*)::int from private.offer_terms_blocks where request_id = pg_temp.r(4)), 1, 'F2 r04: the retry with the gate on wrote no new block');
select is((select count(*)::int from private.offer_terms_blocks where request_id in (pg_temp.r(1), pg_temp.r(21), pg_temp.r(22), pg_temp.r(7), pg_temp.r(9), pg_temp.r(11), pg_temp.r(12))),
  0, 'F2 no block for gate-on, E5, inside-deadline or plan-visit exhaustions');
select is((select candidates from private.offer_terms_blocks where request_id = pg_temp.r(2)), '[]'::jsonb, 'F2 r02''s block has no candidates');
-- SG-1: every live producer sets needs_admin_review, so not requiring it changes no current result.
select ok((pg_temp.req(n)).needs_admin_review, format('F3 r%s: the live producer set needs_admin_review', lpad(n::text, 2, '0')))
  from unnest(array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 21, 22, 24]) n;
select ok((pg_temp.req(16)).needs_admin_review, 'F3 r16: cancellation leaves the flag set');

-- Q Membership, kinds, related events, flags and order ---------------------------------------------
create temp table expected(pos bigint, n integer, kind text, related_event text, related_event_at timestamptz, plan_visit boolean, offer_terms_block boolean);
insert into expected values
  ( 1,  1, 'exhausted',        'request_created',    now() - interval '10 days', false, false),
  ( 2,  2, 'exhausted',        'request_created',    now() - interval '9 days',  false, true),
  ( 3,  3, 'exhausted',        'request_created',    now() - interval '8 days',  false, true),
  ( 4,  4, 'exhausted',        'request_created',    now() - interval '7 days',  false, false),
  ( 5, 12, 'exhausted',        'request_created',    now() - interval '6 days',  true,  false),
  ( 6, 13, 'awaiting_consent', 'request_created',    now() - interval '5 days',  false, false),
  ( 7, 15, 'legacy_sourcing',  'request_created',    now() - interval '4 days',  false, false),
  ( 8, 21, 'exhausted',        'request_created',    now() - interval '3 days',  false, false),
  ( 9, 22, 'exhausted',        'request_created',    now() - interval '3 days',  false, false),
  (10,  5, 'exhausted',        'offer_closed',       now() - interval '2 days',  false, true),
  (11, 24, 'exhausted',        'request_created',    now() - interval '1 day',   false, true),
  (12,  9, 'exhausted',        'provider_operation', now() - interval '3 hours', false, false),
  (13,  6, 'exhausted',        'offer_closed',       now(),                      false, true),
  (14,  7, 'exhausted',        'provider_operation', now(),                      false, false),
  (15,  8, 'exhausted',        'offer_closed',       now(),                      false, false),
  (16, 10, 'exhausted',        'provider_operation', now(),                      false, false),
  (17, 11, 'exhausted',        'provider_operation', now(),                      true,  false);
select results_eq('select * from pg_temp.items() order by pos', 'select * from expected order by pos',
  'Q1 exact items: membership, kind, related event and time, plan_visit, offer_terms_block, in server order');
select is((select array_agg(n order by n) from pg_temp.items() where n in (14, 16, 17, 18, 19, 20, 30)), null::integer[],
  'Q2 excluded: offered after consent, cancelled, awaiting_match, rematch_failed, unsettled expired offer, accepted, plan');
select is((select count(*)::int from pg_temp.items() where n = 0), 0, 'Q2 no request other than the fixtures');
select is((select array_agg(distinct kind order by kind) from pg_temp.items()), array['awaiting_consent', 'exhausted', 'legacy_sourcing'],
  'Q3 exactly three kinds, each present');
select is((select array_agg(distinct related_event order by related_event) from pg_temp.items()), array['offer_closed', 'provider_operation', 'request_created'],
  'Q3 exactly three related events, each present');
-- The time is never updated_at and an expiry's time is never expires_at.
select ok((select related_event_at <> (pg_temp.req(1)).updated_at from pg_temp.items() where n = 1), 'Q4 r01''s time is not updated_at');
select ok((select related_event_at <> (select expires_at from public.job_match_attempts where service_request_id = pg_temp.r(6)) from pg_temp.items() where n = 6),
  'Q4 r06''s time is when the expiry was processed, not expires_at');
select is((select related_event_at from pg_temp.items() where n = 5), (select declined_at from public.job_match_attempts where service_request_id = pg_temp.r(5)),
  'Q4 r05''s time is the decline''s stored time');
select is((select related_event_at from pg_temp.items() where n = 8), (select declined_at from public.job_match_attempts where service_request_id = pg_temp.r(8) and outcome = 'declined'),
  'Q4 r08: the later of operation and decline is the decline');
select ok((select related_event_at < (select responded_at from public.job_match_attempts where service_request_id = pg_temp.r(9) and outcome = 'accepted')
  from pg_temp.items() where n = 9), 'Q4 r09: a later acceptance is not a closing event');
-- Ties: equal times keep provider_operation (r07, r10); equal times across items fall back to request_id (r21 before r22).
select is((select array_agg(n order by pos) from pg_temp.items() where n in (21, 22)), array[21, 22], 'Q5 equal related_event_at: ordered by request_id');
select ok(pg_temp.r(21) < pg_temp.r(22) and (pg_temp.req(21)).created_at = (pg_temp.req(22)).created_at, 'Q5 r21 and r22 tie on time and differ by id');
-- Shape: exactly six fields per item, two in the envelope; no customer, address, price, provider or candidate.
select is((select array_agg(distinct key order by key) from jsonb_array_elements(pg_temp.queue()->'items') i, jsonb_object_keys(i) key),
  array['kind', 'offer_terms_block', 'plan_visit', 'related_event', 'related_event_at', 'request_id'], 'Q6 item fields');
select is((select array_agg(key order by key) from jsonb_object_keys(pg_temp.queue()) key), array['checked_at', 'items'], 'Q6 envelope fields');
select is((pg_temp.queue()->>'checked_at')::timestamptz, now(), 'Q6 checked_at is the transaction time');

-- X Cross-reference with offers at other terms (SG-3), both ways --------------------------------------
create temp table blocked as select (i->>'request_id')::uuid as id from jsonb_array_elements(pg_temp.offer_terms()->'items') i where i->>'kind' = 'blocked_inactive';
select set_eq($$select (i->>'request_id')::uuid from jsonb_array_elements(pg_temp.queue()->'items') i where (i->>'offer_terms_block')::boolean$$,
  'select id from blocked', 'X1 offer_terms_block is true exactly for the blocked_inactive requests');
select ok((select count(*) from blocked) >= 4, 'X1 the overlap is exercised (gate-off exhaustions)');
select is((select count(*)::int from blocked where id not in (select (i->>'request_id')::uuid from jsonb_array_elements(pg_temp.queue()->'items') i)), 0,
  'X2 every blocked_inactive request is in the sourcing queue');
select is((select array_agg(i->>'kind') from jsonb_array_elements(pg_temp.offer_terms()->'items') i where (i->>'request_id')::uuid = pg_temp.r(18)),
  array['rematch_failed'], 'X3 r18 is in offers at other terms (rematch_failed), not in sourcing');
select ok(not (select offer_terms_block from pg_temp.items() where n = 4), 'X4 r04 after a strictly later retry: no block');
select ok((select offer_terms_block from pg_temp.items() where n = 24), 'X4 r24: a retry at the block''s own time does not clear it');

-- E Expired offers are not settled by reading (SG-4) ---------------------------------------------------
create temp table w(n bigint);
insert into w select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables
  where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%';
select ok(not pg_temp.listed(19), 'E1 r19 (offer past expires_at, unsettled) is excluded');
select ok(not pg_temp.listed(19), 'E1 still excluded after a second read');
select is((select outcome from public.job_match_attempts where service_request_id = pg_temp.r(19)), 'pending', 'E1 the reads left the offer pending');
select pg_temp.call(1, 'select public.admin_operations_summary()::text') is not null;
select pg_temp.call(5, 'select public.admin_operations_summary()::text') is not null;
-- W Neither function writes: no row inserted, updated or deleted by six reader and two summary calls.
select is((select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint from pg_stat_xact_all_tables
  where schemaname not in ('pg_temp', 'pg_toast') and schemaname not like 'pg_temp%'), (select n from w), 'W1 the reader and the summary write no row');
select is((select provolatile from pg_proc where oid = 'public.admin_sourcing_queue()'::regprocedure), 's', 'W2 the reader is STABLE');

-- S The summary row ---------------------------------------------------------------------------------
create temp table s as select pg_temp.call(5, 'select public.admin_operations_summary()::text')::jsonb as v;
select is((select array_agg(r->>'queue' order by n) from s, jsonb_array_elements(s.v->'queues') with ordinality x(r, n)),
  array['quote','recurring_payment','fulfillment','cancellation','support','compliance_renewal','renewal_documents','offer_terms','applications','sourcing','finance_exceptions'],
  'S1 sourcing follows applications; finance stays last');
select is((select r from s, jsonb_array_elements(s.v->'queues') r where r->>'queue' = 'sourcing'),
  jsonb_build_object('queue', 'sourcing', 'state', 'ready', 'count', jsonb_array_length(pg_temp.queue()->'items'), 'aged', null),
  'S2 the sourcing row counts the reader (17), with no aged count');
select is((select r->>'state' from s, jsonb_array_elements(s.v->'queues') r where r->>'queue' = 'finance_exceptions'), 'ready', 'S3 finance ready for the holder');
select is((select r->>'state' from jsonb_array_elements(pg_temp.call(1, 'select public.admin_operations_summary()::text')::jsonb->'queues') r
  where r->>'queue' = 'finance_exceptions'), 'restricted', 'S3 finance restricted without authority; the sourcing row is the same');

-- A Authorization and definition ------------------------------------------------------------------
select is(pg_temp.err(format('select pg_temp.call(%s, ''select public.admin_sourcing_queue()::text'')', who)), '42501', format('A1 %s refused', label))
  from (values (2, 'homeowner'), (3, 'provider'), (6, 'vendor without a contractor')) v(who, label);
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.err('select public.admin_sourcing_queue()'), '42501', 'A1 signed-in caller without identity refused');
reset role;
set local role anon;
select is(pg_temp.err('select public.admin_sourcing_queue()'), '42501', 'A1 anon refused (no execute)');
reset role;
select is((select proacl::text from pg_proc where oid = 'public.admin_sourcing_queue()'::regprocedure), '{postgres=X/postgres,authenticated=X/postgres}',
  'A2 execute for authenticated only');
select is((select array_agg(r || ':' || has_function_privilege(r, 'public.admin_sourcing_queue()', 'execute') order by r)
  from unnest(array['anon', 'authenticated', 'service_role']) r), array['anon:false', 'authenticated:true', 'service_role:false'], 'A2 no anon or service_role execute');
select ok((select prosecdef and proconfig = array['search_path=""'] and pg_get_userbyid(proowner) = 'postgres'
  from pg_proc where oid = 'public.admin_sourcing_queue()'::regprocedure), 'A3 security definer, empty search_path, owner postgres');
select is((select proacl::text from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure),
  '{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}', 'A3 summary grants unchanged');

-- L Settling the expired offer elsewhere brings it in, as stored state (SG-4) ------------------------
select pg_temp.call(1, 'select public.expire_stale_matches()::text');
select is(pg_temp.state(19), 'pending/exhausted', 'L1 expire_stale_matches settled r19 and the matcher exhausted it');
select is((select row(kind, related_event, related_event_at = now(), plan_visit, offer_terms_block)::text from pg_temp.items() where n = 19),
  '(exhausted,offer_closed,t,f,f)', 'L1 r19 is now listed: offer closed when the expiry was processed (gate on: no block)');
select is((select r->>'count' from jsonb_array_elements(pg_temp.call(5, 'select public.admin_operations_summary()::text')::jsonb->'queues') r
  where r->>'queue' = 'sourcing'), '18', 'L1 the summary count follows');
-- Consent: r13 leaves the queue once the homeowner consents.
select pg_temp.call(2, format('select coalesce(public.consent_to_provider_fallback(%L)::text, '''')', pg_temp.r(13)));
select ok(not pg_temp.listed(13) and pg_temp.state(13) = 'matched/offered', 'L2 after consent r13 is offered and leaves the queue');

-- I Error isolation: a failing reader turns only the sourcing row into an error -----------------------
create temp table before_failure as select pg_temp.call(5, 'select public.admin_operations_summary()::text')::jsonb as v;
create temp table real_reader as select pg_get_functiondef('public.admin_sourcing_queue()'::regprocedure) as def,
  md5(pg_get_functiondef('public.admin_sourcing_queue()'::regprocedure)) as h;
create or replace function public.admin_sourcing_queue() returns jsonb language plpgsql as $f$
begin raise exception 'synthetic sourcing failure'; end $f$;
create temp table after_failure as select pg_temp.call(5, 'select public.admin_operations_summary()::text')::jsonb as v;
select is((select r from after_failure, jsonb_array_elements(after_failure.v->'queues') r where r->>'queue' = 'sourcing'),
  '{"queue":"sourcing","state":"error","count":null,"aged":null}'::jsonb, 'I1 failing reader: its row is an error');
select is((select jsonb_agg(r) from after_failure, jsonb_array_elements(after_failure.v->'queues') r where r->>'queue' <> 'sourcing'),
  (select jsonb_agg(r) from before_failure, jsonb_array_elements(before_failure.v->'queues') r where r->>'queue' <> 'sourcing'),
  'I1 every other row unchanged, finance included');

-- R The real reader and the summary run in a READ ONLY transaction (HQ-2) ----------------------------
do $$ begin execute (select def from real_reader); end $$;
select is(md5(pg_get_functiondef('public.admin_sourcing_queue()'::regprocedure)), (select h from real_reader), 'R0 the real reader is restored');
select is((select proacl::text from pg_proc where oid = 'public.admin_sourcing_queue()'::regprocedure), '{postgres=X/postgres,authenticated=X/postgres}',
  'R0 with its grants');
create temp table ro_count as select jsonb_array_length(pg_temp.queue()->'items') as n;
set local transaction_read_only = on;
select is(current_setting('transaction_read_only'), 'on', 'R1 the transaction is read-only');
select is(jsonb_array_length(pg_temp.queue()->'items'), (select n from ro_count), 'R1 the reader runs read-only, same items');
select is((select r->>'state' || ':' || (r->>'count') from jsonb_array_elements(pg_temp.call(5, 'select public.admin_operations_summary()::text')::jsonb->'queues') r
  where r->>'queue' = 'sourcing'), 'ready:' || (select n from ro_count), 'R1 the summary''s sourcing row runs read-only');

select * from finish();
rollback;
