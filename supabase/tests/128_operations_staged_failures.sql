-- Phase 7.5C (TRACE-159): local staged-failure characterization, SF-1..SF-12.
-- Contract: governance/PHASE-7-OPERATIONS-QUEUES-CONTRACT.md §7.1 (OQ-1 revision 2, with Codex's
-- RV-1 and RV-4). Record: governance/PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md (scenario map).
--
-- Each scenario stages one failure with synthetic example.invalid users and asserts four outcomes:
-- queue item, alert, audit record and communication. Expected values are CURRENT behavior, pinned.
-- Where a producer is missing the test asserts the gap ("alert: none"), so a later slice has to change
-- the expectation on purpose. Passing here is characterization only: it is NOT Phase 7 gate acceptance
-- (contract §7.1, RV-4). SF-9 pins a KNOWN DEFECT (DF-3); SF-12 pins the 7.5B repair of DF-1.
--
-- Real database functions throughout: the queue readers, run_lifecycle_batch, expire_stale_matches,
-- the offer and acceptance commands, vendor_propose_quote, admin_send_itemized_quote, the Stripe
-- webhook receive/process pair, money_flag_checkout, open_support_ticket, post_support_message,
-- admin_update_support_ticket, the owner-email claim, owner_email_overview and the finance and
-- operations summaries. Preconditions that no single command reaches cheaply (an obligation and
-- snapshot, a recurring series, a completed job) are written directly, as SQL 003, 090 and 127 do.
--
-- Timing is deterministic: inside one transaction now() is fixed, every staged time is written
-- relative to it ("the clock passes" = recorded times moved back, as owner, in replica mode), and the
-- support calendar is checked at fixed instants. One exception is recorded, not hidden: the same-day
-- support routing trigger reads now() itself, so which of its two branches runs depends on when the
-- test runs (SF-8c). Nothing is committed: the file ends in rollback.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ------------------------------------------------------------------------------------------------
-- Users: 1 admin (operator), 2 admin with finance authority, 3 homeowner, 4 provider P1, 5 provider P2.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('c75c0000-0000-4000-8000-000000000001','p75c-admin@example.invalid',now(),'{"full_name":"P75C operator"}'),
 ('c75c0000-0000-4000-8000-000000000002','p75c-finance@example.invalid',now(),'{"full_name":"P75C finance operator"}'),
 ('c75c0000-0000-4000-8000-000000000003','p75c-home@example.invalid',now(),'{"full_name":"P75C homeowner"}'),
 ('c75c0000-0000-4000-8000-000000000004','p75c-p1@example.invalid',now(),'{"full_name":"P75C provider one"}'),
 ('c75c0000-0000-4000-8000-000000000005','p75c-p2@example.invalid',now(),'{"full_name":"P75C provider two"}');
insert into public.user_roles(user_id,role) values
 ('c75c0000-0000-4000-8000-000000000001','admin'),('c75c0000-0000-4000-8000-000000000002','admin'),
 ('c75c0000-0000-4000-8000-000000000003','homeowner'),('c75c0000-0000-4000-8000-000000000004','vendor'),
 ('c75c0000-0000-4000-8000-000000000005','vendor')
 on conflict do nothing;
insert into public.money_authorities(user_id,granted_by,reason) values
 ('c75c0000-0000-4000-8000-000000000002','c75c0000-0000-4000-8000-000000000001','Synthetic finance holder');

create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('c75c0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('c75c2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('c75c9000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- Run p_sql as user n (authenticated) and return its jsonb; claims and role are restored.
create function pg_temp.call(n int, p_sql text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(n))::text, true);
  set local role authenticated;
  execute p_sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end $$;
create function pg_temp.svc(p_sql text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  execute p_sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end $$;
-- "The clock passes": recorded times are moved back as the owner with triggers off (append-only and
-- immutability guards would refuse a time change; nothing else is altered).
create function pg_temp.backdate(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end $$;

-- Every outbound or alerting channel the database has, counted. "Alert" = something addressed to
-- operations: admin in-app rows (write-only, NM-1 §4.1), the owner-email ledger, any outbound HTTP
-- request (pg_net) or scheduled job (pg_cron). "Communication" = something addressed to a homeowner
-- or provider: their in-app rows, job messages, operations replies on support, application, package
-- draft, invitation and access emails.
create function pg_temp.channels() returns jsonb language plpgsql as $$
declare http bigint := 0; jobs bigint := 0;
begin
  if to_regclass('net.http_request_queue') is not null then execute 'select count(*) from net.http_request_queue' into http; end if;
  if to_regclass('cron.job') is not null then execute 'select count(*) from cron.job' into jobs; end if;
  return jsonb_build_object(
    'alert', jsonb_build_object(
      'admin_in_app', (select count(*) from public.notifications n where exists(select 1 from public.user_roles x where x.user_id = n.user_id and x.role = 'admin')),
      'owner_email', (select count(*) from private.owner_email_notifications),
      'owner_email_events', (select count(*) from private.owner_email_notification_events),
      'http_request', http,
      'cron_job', jobs),
    'communication', jsonb_build_object(
      'participant_in_app', (select count(*) from public.notifications n where not exists(select 1 from public.user_roles x where x.user_id = n.user_id and x.role = 'admin')),
      'job_message', (select count(*) from public.messages),
      'support_reply', (select count(*) from public.support_ticket_messages where author_role = 'operations' and visibility = 'participant'),
      'application_email', (select count(*) from private.r0_application_notifications),
      'package_draft_email', (select count(*) from private.package_draft_email_notices),
      'invitation_dispatch', (select count(*) from public.vendor_invitation_dispatches),
      'access_dispatch', (select count(*) from private.r0_provider_access_dispatches)));
end $$;
create table pg_temp.marks(label text primary key, at jsonb);
create function pg_temp.mark(label text) returns void language sql as $$
  insert into pg_temp.marks values (label, pg_temp.channels()) on conflict (label) do update set at = excluded.at $$;
-- Nonzero changes in one group ('alert' or 'communication') since a mark; '{}' when nothing changed.
create function pg_temp.delta(label text, grp text) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(now_.key, now_.value::bigint - (then_.value)::bigint) filter (where now_.value::bigint <> (then_.value)::bigint), '{}'::jsonb)
  from jsonb_each_text(pg_temp.channels()->grp) now_
  join jsonb_each_text((select at->grp from pg_temp.marks where marks.label = $1)) then_ on then_.key = now_.key $$;
create function pg_temp.events(job uuid) returns bigint language sql as $$ select count(*) from public.job_events where job_id = job $$;
create function pg_temp.item(queue jsonb, kind text, request uuid) returns jsonb language sql as $$
  select i from jsonb_array_elements(queue->'items') i where i->>'kind' = kind and (i->>'request_id')::uuid = request $$;
create function pg_temp.quote_q() returns jsonb language sql as $$ select pg_temp.call(1, 'select public.admin_quote_queue()') $$;
create function pg_temp.titles(request uuid) returns text[] language sql as $$
  select coalesce(array_agg(case when exists(select 1 from public.user_roles x where x.user_id = n.user_id and x.role = 'admin') then 'admin' else 'participant' end
    || ': ' || n.title order by n.title, n.user_id), '{}') from public.notifications n where n.related_request_id = request $$;

-- The exact summary in SF-12 needs a database with no other queue items (a clean replay with the
-- synthetic seed), as SQL 127 does. Stop with a clear message rather than a confusing difference.
do $$
declare s jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"c75c0000-0000-4000-8000-000000000002"}', true);
  s := public.admin_operations_summary();
  perform set_config('request.jwt.claims', '', true);
  if exists(select 1 from jsonb_array_elements(s->'queues') q where coalesce((q->>'count')::int, 0) <> 0) then
    raise exception '7.5C fixtures need a database with no queue items; found %', s->'queues';
  end if;
end $$;
select pg_temp.mark('file');

-- Providers: P1 serves 00128 (quote work), P2 serves 00129 (the SF-7 offer). Each zip has one provider.
insert into public.coverage_areas(zip_code,city) values ('00128','P75C quote area'),('00129','P75C offer area');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('c75c1000-0000-4000-8000-000000000001',pg_temp.u(4),'P75C provider one',true,true),
 ('c75c1000-0000-4000-8000-000000000002',pg_temp.u(5),'P75C provider two',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('c75c1000-0000-4000-8000-000000000001','00128'),('c75c1000-0000-4000-8000-000000000002','00129');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select ('c75c1100-0000-4000-8000-00000000000'||n)::uuid, ('c75c1000-0000-4000-8000-00000000000'||n)::uuid, s.id,
   'P75C quote service '||n, 'custom_quote', 'one-time', true
 from generate_series(1,2) n, (select id from public.services_catalog order by id limit 1) s;
create function pg_temp.items() returns jsonb language sql immutable as $$
  select '[{"kind":"labor","description":"Synthetic labor","quantity":1,"unit_cents":20000}]'::jsonb $$;

-- ================================================================================================
-- SF-1  Accepted quote-required job, no proposal; clock at 24 h − 1 µs and at 24 h (CFG-015 G4).
-- Expected: none / proposal_missing (aged). Alert none. Audit: the acceptance row only. Communication
-- none (CFG-015: no reminder or external message).
insert into public.service_requests(id,customer_id,service_type,address,city,state,zip_code,service_catalog_id,frequency,pricing_mode,quote_only,description)
 select pg_temp.r(n), pg_temp.u(3), 'P75C quote work '||n, n||' Probe St', 'Fort Myers', 'FL', '00128',
   (select id from public.services_catalog order by id limit 1), 'one-time', 'custom_quote', true, 'P75C scope'
 from generate_series(1,3) n;
select private.create_job_offer_internal(pg_temp.r(n), 'c75c1000-0000-4000-8000-000000000001', null, null, false) from generate_series(1,3) n;
select pg_temp.call(4, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.r(n))) from generate_series(1,3) n;
select is((select array_agg(status::text||'/'||matching_status order by id) from public.service_requests where id in (pg_temp.r(1),pg_temp.r(2),pg_temp.r(3))),
  array['scheduled/matched','scheduled/matched','scheduled/matched'], 'SF-1 setup: three quote requests accepted through the real offer and acceptance commands');
select pg_temp.backdate(format($b$update public.job_match_attempts set accepted_at = now() - interval '24 hours' + interval '1 microsecond',
  responded_at = now() - interval '24 hours' + interval '1 microsecond' where service_request_id = %L and outcome = 'accepted'$b$, pg_temp.r(1)));
select pg_temp.backdate(format($b$update public.job_match_attempts set accepted_at = now() - interval '24 hours',
  responded_at = now() - interval '24 hours' where service_request_id = %L and outcome = 'accepted'$b$, pg_temp.r(2)));
select pg_temp.mark('sf1');
select set_config('t.sf1_events', (pg_temp.events(pg_temp.r(1)) + pg_temp.events(pg_temp.r(2)))::text, true);
select is(pg_temp.item(pg_temp.quote_q(), 'proposal_missing', pg_temp.r(1)), null, 'SF-1 queue: 24 h − 1 µs after acceptance, no proposal_missing item');
select is(pg_temp.item(pg_temp.quote_q(), 'proposal_missing', pg_temp.r(2))->>'aged', 'true', 'SF-1 queue: at 24 h, proposal_missing, aged');
select is((pg_temp.item(pg_temp.quote_q(), 'proposal_missing', pg_temp.r(2))->>'due_at')::timestamptz, now(), 'SF-1 queue: due at acceptance + 24 h');
select is(pg_temp.delta('sf1', 'alert'), '{}'::jsonb, 'SF-1 alert: none (no admin row, owner email, HTTP request or job)');
select is(pg_temp.delta('sf1', 'communication'), '{}'::jsonb, 'SF-1 communication: none (CFG-015 forbids reminders)');
select is(pg_temp.events(pg_temp.r(1)) + pg_temp.events(pg_temp.r(2)), current_setting('t.sf1_events')::bigint, 'SF-1 audit: aging records nothing (read-time aging, X-2)');
select is((select count(*)::int from public.job_match_attempts where service_request_id = pg_temp.r(2) and outcome = 'accepted'), 1, 'SF-1 audit: the acceptance row is the only record');

-- ================================================================================================
-- SF-2  Pending proposal at 4 h; sent quote at 12 h and at 24 h; expiry through the batch (G4,
-- DEC-2026-008). Expected: proposal_review; quote_decision (deadline_passed at 24 h). Alert none.
-- Audit: proposal and quote rows; the expiry event. Communication none before expiry; N-QTE-06 once.
select pg_temp.call(4, format('select to_jsonb(public.vendor_propose_quote(%L, pg_temp.items(), %L, 0))', pg_temp.r(3), 'P75C scope'));
select pg_temp.mark('sf2');
select pg_temp.backdate(format($b$update public.request_quote_proposals set created_at = now() - interval '4 hours' + interval '1 microsecond'
  where request_id = %L and status = 'pending'$b$, pg_temp.r(3)));
select is(pg_temp.item(pg_temp.quote_q(), 'proposal_review', pg_temp.r(3)), null, 'SF-2 queue: proposal pending 4 h − 1 µs, not queued');
select pg_temp.backdate(format($b$update public.request_quote_proposals set created_at = now() - interval '4 hours'
  where request_id = %L and status = 'pending'$b$, pg_temp.r(3)));
select is(pg_temp.item(pg_temp.quote_q(), 'proposal_review', pg_temp.r(3))->>'aged', 'true', 'SF-2 queue: at 4 h, proposal_review, aged');
select is(pg_temp.delta('sf2', 'alert'), '{}'::jsonb, 'SF-2 alert: none for an aged proposal');
select is(pg_temp.delta('sf2', 'communication'), '{}'::jsonb, 'SF-2 communication: none for an aged proposal');
select pg_temp.call(1, format('select to_jsonb(public.admin_send_itemized_quote(%L, pg_temp.items(), %L, %L, 0, (select id from public.request_quote_proposals where request_id = %L and status = %L)))',
  pg_temp.r(3), 'P75C scope', 'Sent as proposed', pg_temp.r(3), 'pending'));
select is((select q.status from public.request_quotes q join public.service_requests r on r.current_quote_id = q.id where r.id = pg_temp.r(3)), 'submitted', 'SF-2 setup: the operator sent the quote');
select pg_temp.mark('sf2_sent');
select pg_temp.backdate(format($b$update public.request_quotes q set sent_at = now() - interval '12 hours' + interval '1 microsecond',
  expires_at = now() + interval '12 hours' + interval '1 microsecond' from public.service_requests r where r.current_quote_id = q.id and r.id = %L$b$, pg_temp.r(3)));
select is(pg_temp.item(pg_temp.quote_q(), 'quote_decision', pg_temp.r(3)), null, 'SF-2 queue: sent quote at 12 h − 1 µs, not queued');
select pg_temp.backdate(format($b$update public.request_quotes q set sent_at = now() - interval '12 hours',
  expires_at = now() + interval '12 hours' from public.service_requests r where r.current_quote_id = q.id and r.id = %L$b$, pg_temp.r(3)));
select is(pg_temp.item(pg_temp.quote_q(), 'quote_decision', pg_temp.r(3))->'detail'->>'deadline_passed', 'false', 'SF-2 queue: at 12 h, quote_decision, deadline not passed');
select pg_temp.backdate(format($b$update public.request_quotes q set sent_at = now() - interval '24 hours',
  expires_at = now() from public.service_requests r where r.current_quote_id = q.id and r.id = %L$b$, pg_temp.r(3)));
select is(pg_temp.item(pg_temp.quote_q(), 'quote_decision', pg_temp.r(3))->'detail'->>'deadline_passed', 'true', 'SF-2 queue: at 24 h, quote_decision with deadline_passed');
select is(pg_temp.delta('sf2_sent', 'alert'), '{}'::jsonb, 'SF-2 alert: none while the quote ages');
select is(pg_temp.delta('sf2_sent', 'communication'), '{}'::jsonb, 'SF-2 communication: none before expiry');
-- Expiry runs only through the batch (no scheduler is installed; X-3). Run R0.
select set_config('t.sf2_events', pg_temp.events(pg_temp.r(3))::text, true);
select is(pg_temp.svc(format('select public.run_lifecycle_batch(%L)', pg_temp.k(0))) - 'ran_at' - 'run_id',
  '{"ok":true,"quotes_expired":1,"matches_expired":0,"confirmations_sent":0,"admin_flagged":0,"lifecycle_version":"phase4-v1"}'::jsonb,
  'SF-2 batch R0: expires exactly this quote and nothing else');
select is((select quote_status||'/'||needs_admin_review from public.service_requests where id = pg_temp.r(3)), 'expired/true', 'SF-2 state: quote expired, request flagged for review');
select is(pg_temp.events(pg_temp.r(3)) - current_setting('t.sf2_events')::bigint, 1::bigint, 'SF-2 audit: one expiry event');
select is((select count(*)::int from public.job_events where job_id = pg_temp.r(3) and event_type = 'status_changed' and metadata->>'action' = 'quote_expired'
  and metadata->>'policy' = 'DEC-2026-008'), 1, 'SF-2 audit: it is the status_changed quote_expired event (DEC-2026-008)');
select is(pg_temp.delta('sf2_sent', 'alert'), '{}'::jsonb, 'SF-2 alert: none on expiry (the review flag is not an alert)');
select is(pg_temp.delta('sf2_sent', 'communication'), '{"participant_in_app": 1}'::jsonb, 'SF-2 communication: one in-app row on expiry');
select is((select array_agg(title) from public.notifications where related_request_id = pg_temp.r(3) and user_id = pg_temp.u(3) and created_at = now() and title like '%expired%'),
  array['Price quote expired'], 'SF-2 communication: N-QTE-06 to the homeowner');
select is(pg_temp.item(pg_temp.quote_q(), 'quote_decision', pg_temp.r(3)), null, 'SF-2 queue: the expired quote leaves the decision queue');
-- Observation (record §4, O-2): after expiry the request is in no quote item until proposal_missing
-- ages again, 24 hours after the expiry; only needs_admin_review (no queue reads it) marks it now.
select is((select jsonb_agg(i->>'kind') from jsonb_array_elements(pg_temp.quote_q()->'items') i where (i->>'request_id')::uuid = pg_temp.r(3)), null,
  'SF-2 queue: right after expiry the request has no quote item at all');
-- The whole history moves back: acceptance 72 h ago, quote sent 48 h ago, expired 24 h ago.
select pg_temp.backdate(format($b$update public.job_match_attempts set accepted_at = now() - interval '72 hours', responded_at = now() - interval '72 hours'
  where service_request_id = %L and outcome = 'accepted'$b$, pg_temp.r(3)));
select pg_temp.backdate(format($b$update public.request_quotes q set sent_at = now() - interval '48 hours', expires_at = now() - interval '24 hours'
  from public.service_requests r where r.current_quote_id = q.id and r.id = %L$b$, pg_temp.r(3)));
select is((pg_temp.item(pg_temp.quote_q(), 'proposal_missing', pg_temp.r(3))->>'since')::timestamptz, now() - interval '24 hours',
  'SF-2 queue: 24 hours after the expiry it is proposal_missing again, since the expiry');

-- ================================================================================================
-- SF-3  Stripe checkout_expired while unpaid, then + 24 h (G6). Expected: payment_failed, aged at
-- 24 h. Alert none. Audit: the attempt and the webhook event. Communication none (N-CXL-07).
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,status,matching_status,pricing_mode,description)
 select pg_temp.r(n), pg_temp.u(3), 'c75c1000-0000-4000-8000-000000000001', 'P75C paid work '||n, n||' Probe St', 'Fort Myers', 'FL', '00128',
   'scheduled', 'matched', 'fixed', 'P75C payment'
 from generate_series(4,5) n;
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id)
 select ('c75c3000-0000-4000-8000-00000000000'||n)::uuid, pg_temp.r(n), pg_temp.u(3), 'c75c1000-0000-4000-8000-000000000001' from generate_series(4,5) n;
insert into public.money_snapshots(id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,
  source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at)
 select ('c75c3100-0000-4000-8000-00000000000'||n)::uuid, ('c75c3000-0000-4000-8000-00000000000'||n)::uuid, 1, 'P75C-'||n, 20000,0,0,0,20000,0,0,0,20000,'usd',
   'synthetic','CFG-005','synthetic',pg_temp.u(1),pg_temp.u(2),'Synthetic',now()+interval '1 day'
 from generate_series(4,5) n;
update public.money_obligations set current_snapshot_id = ('c75c3100-0000-4000-8000-00000000000'||right(id::text,1))::uuid where id::text like 'c75c3000-%';
insert into public.money_checkout_attempts(id,obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at,created_at)
 select ('c75c3200-0000-4000-8000-00000000000'||n)::uuid, ('c75c3000-0000-4000-8000-00000000000'||n)::uuid, ('c75c3100-0000-4000-8000-00000000000'||n)::uuid,
   pg_temp.u(3), 'full', 20000, 'usd', 'p75c-'||n, 'p75c-k'||n, 'session_created', now()+interval '30 minutes', now()
 from generate_series(4,5) n;
select is(pg_temp.item(pg_temp.quote_q(), 'payment_failed', pg_temp.r(4)), null, 'SF-3 queue: an open checkout is not an exception');
select pg_temp.mark('sf3');
-- The webhook path the stripe-webhook function uses: receive commits, then process.
select pg_temp.svc($s$select to_jsonb(public.money_receive_event('evt_p75c_sf3','checkout_expired',
  jsonb_build_object('attempt_id','c75c3200-0000-4000-8000-000000000004','session_id','cs_p75c_sf3')))$s$);
select is(pg_temp.svc($s$select to_jsonb(public.money_process_event('evt_p75c_sf3'))$s$), '"processed"'::jsonb, 'SF-3 webhook: processed');
select is((select status from public.money_checkout_attempts where id = 'c75c3200-0000-4000-8000-000000000004'), 'expired', 'SF-3 audit: the attempt is expired');
select is((select status||'/'||attempt_count from public.money_webhook_events where event_id = 'evt_p75c_sf3'), 'processed/1', 'SF-3 audit: the webhook event is kept, processed once');
select is(pg_temp.item(pg_temp.quote_q(), 'payment_failed', pg_temp.r(4))->>'aged', 'false', 'SF-3 queue: payment_failed at once, not aged');
select pg_temp.backdate($b$update public.money_webhook_events set received_at = now() - interval '24 hours' + interval '1 microsecond' where event_id = 'evt_p75c_sf3'$b$);
select is(pg_temp.item(pg_temp.quote_q(), 'payment_failed', pg_temp.r(4))->>'aged', 'false', 'SF-3 queue: 24 h − 1 µs after the webhook, not aged');
select pg_temp.backdate($b$update public.money_webhook_events set received_at = now() - interval '24 hours' where event_id = 'evt_p75c_sf3'$b$);
select is(pg_temp.item(pg_temp.quote_q(), 'payment_failed', pg_temp.r(4))->>'aged', 'true', 'SF-3 queue: at 24 h, aged');
select is(pg_temp.delta('sf3', 'alert'), '{}'::jsonb, 'SF-3 alert: none');
select is(pg_temp.delta('sf3', 'communication'), '{}'::jsonb, 'SF-3 communication: none (payments inactive, N-CXL-07)');
select is((select status::text from public.service_requests where id = pg_temp.r(4)), 'scheduled', 'SF-3 state: the failure cancels nothing');

-- ================================================================================================
-- SF-4  Checkout attempt flagged for reconciliation (G6). Expected: payment_unresolved, never aged.
-- Alert none. Audit: the attempt row. Communication none.
select pg_temp.mark('sf4');
select pg_temp.svc($s$select to_jsonb(public.money_flag_checkout('c75c3200-0000-4000-8000-000000000005','synthetic_timeout'))$s$);
select is((select status||'/'||failure_code from public.money_checkout_attempts where id = 'c75c3200-0000-4000-8000-000000000005'), 'reconcile/synthetic_timeout', 'SF-4 audit: the attempt is in reconcile with its code');
select is(pg_temp.item(pg_temp.quote_q(), 'payment_unresolved', pg_temp.r(5))->>'aged', 'false', 'SF-4 queue: payment_unresolved at once, not aged');
select is(pg_temp.item(pg_temp.quote_q(), 'payment_unresolved', pg_temp.r(5))->'due_at', 'null'::jsonb, 'SF-4 queue: no due time');
select pg_temp.backdate($b$update public.money_checkout_attempts set created_at = now() - interval '30 days', expires_at = now() - interval '30 days' + interval '30 minutes'
  where id = 'c75c3200-0000-4000-8000-000000000005'$b$);
select is(pg_temp.item(pg_temp.quote_q(), 'payment_unresolved', pg_temp.r(5))->>'aged', 'false', 'SF-4 queue: still not aged 30 days later (never aged)');
select is(pg_temp.delta('sf4', 'alert'), '{}'::jsonb, 'SF-4 alert: none');
select is(pg_temp.delta('sf4', 'communication'), '{}'::jsonb, 'SF-4 communication: none');

-- ================================================================================================
-- SF-5  Accepted, unpaid recurring visit at appointment − 24 h (DEC-2026-049 item 6). Expected:
-- ready_unpaid or review_missing. Alert none. Audit: the visit's payment state. Communication none
-- (N-REC-04). The series is written directly (as SQL 127); SQL 097 drives the same boundary through
-- the real series, visit and acceptance commands.
select pg_temp.mark('sf5');
select pg_temp.backdate($b$insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,
  pricing_mode,assigned_at,scheduled_start_at,recurrence_parent_id,frequency) values
 ('c75c2000-0000-4000-8000-000000000006','c75c0000-0000-4000-8000-000000000003','c75c1000-0000-4000-8000-000000000001','P75C series','6 Probe St','Fort Myers','FL','00128','P75C series','scheduled','matched','fixed',now()-interval '200 hours',null,null,'monthly'),
 ('c75c2000-0000-4000-8000-000000000007','c75c0000-0000-4000-8000-000000000003','c75c1000-0000-4000-8000-000000000001','P75C series','6 Probe St','Fort Myers','FL','00128','P75C visit at 24 h','scheduled','matched','fixed',now()-interval '200 hours',now()+interval '24 hours','c75c2000-0000-4000-8000-000000000006','monthly'),
 ('c75c2000-0000-4000-8000-000000000008','c75c0000-0000-4000-8000-000000000003','c75c1000-0000-4000-8000-000000000001','P75C series','6 Probe St','Fort Myers','FL','00128','P75C visit at 24 h + 1 µs','scheduled','matched','fixed',now()-interval '200 hours',now()+interval '24 hours'+interval '1 microsecond','c75c2000-0000-4000-8000-000000000006','monthly')$b$);
create function pg_temp.recurring_q() returns jsonb language sql as $$ select pg_temp.call(1, 'select public.admin_recurring_payment_queue()') $$;
select is((select array_agg(i->>'kind') from jsonb_array_elements(pg_temp.recurring_q()->'items') i where (i->>'request_id')::uuid = pg_temp.r(8)), null,
  'SF-5 queue: a visit 24 h + 1 µs away is not queued');
select is(pg_temp.item(pg_temp.recurring_q(), 'review_missing', pg_temp.r(7))->>'reason', 'source_blocked', 'SF-5 queue: at appointment − 24 h, review_missing (source_blocked: no bound terms)');
select is((pg_temp.item(pg_temp.recurring_q(), 'review_missing', pg_temp.r(7))->>'since')::timestamptz, now(), 'SF-5 queue: since appointment − 24 h');
select is(pg_temp.item(pg_temp.recurring_q(), 'review_missing', pg_temp.r(7))->>'aged', 'false', 'SF-5 queue: not aged before the appointment');
select is(pg_temp.item(pg_temp.recurring_q(), 'review_missing', pg_temp.r(7))#>>'{detail,state}', 'review_pending', 'SF-5 audit: the visit''s payment state reads review_pending');
select is(pg_temp.delta('sf5', 'alert'), '{}'::jsonb, 'SF-5 alert: none');
select is(pg_temp.delta('sf5', 'communication'), '{}'::jsonb, 'SF-5 communication: none (N-REC-04)');

-- ================================================================================================
-- SF-6a Completion notice at 72 h − 1 µs and at 72 h; read path only (DEC-2026-006 T-5).
-- Expected: none / confirmation_overdue. Alert none. Audit none new. Communication none new.
-- Both jobs have their completion evidence, so evidence_unverified does not apply.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at,confirmation_deadline_at,photo_proof_urls)
 select pg_temp.r(n), pg_temp.u(3), 'c75c1000-0000-4000-8000-000000000001', 'P75C completed work', n||' Probe St', 'Fort Myers', 'FL', '00128', 'P75C completion',
   'vendor_completed', 'matched', 'fixed', now()-interval '4 days',
   case n when 9 then now()-interval '72 hours'+interval '1 microsecond' else now()-interval '72 hours' end,
   case n when 9 then now()+interval '1 microsecond' else now() end, array['synthetic-proof']
 from generate_series(9,10) n;
insert into public.job_completion_evidence(job_id,attempt,position,bucket_id,object_name,object_id,uploader_id,minimum_photos,rule_version)
 select pg_temp.r(n), 1, 1, 'job-photos', pg_temp.u(4)||'/'||pg_temp.r(n)||'/proof.png', gen_random_uuid(), pg_temp.u(4), 1, 0 from generate_series(9,10) n;
select pg_temp.mark('sf6');
select set_config('t.sf6_events', (pg_temp.events(pg_temp.r(9)) + pg_temp.events(pg_temp.r(10)))::text, true);
create function pg_temp.fulfillment_q() returns jsonb language sql as $$ select pg_temp.call(1, 'select public.admin_fulfillment_queue()') $$;
select is(pg_temp.item(pg_temp.fulfillment_q(), 'confirmation_overdue', pg_temp.r(9)), null, 'SF-6a queue: 72 h − 1 µs after the notice, not queued');
select is((pg_temp.item(pg_temp.fulfillment_q(), 'confirmation_overdue', pg_temp.r(10))->>'since')::timestamptz, now(), 'SF-6a queue: at 72 h, confirmation_overdue since the 72-hour mark');
select is((select array_agg(i->>'kind' order by i->>'kind') from jsonb_array_elements(pg_temp.fulfillment_q()->'items') i), array['confirmation_overdue'],
  'SF-6a queue: the only fulfillment item (evidence recorded)');
select is(pg_temp.fulfillment_q()->'items'->0 ? 'aged', false, 'SF-6a queue: the item carries no aged flag (DF-1 premise)');
select is(pg_temp.delta('sf6', 'alert'), '{}'::jsonb, 'SF-6a alert: none on the read path');
select is(pg_temp.delta('sf6', 'communication'), '{}'::jsonb, 'SF-6a communication: none new');
select is(pg_temp.events(pg_temp.r(9)) + pg_temp.events(pg_temp.r(10)), current_setting('t.sf6_events')::bigint, 'SF-6a audit: none new (reading records nothing)');
select is((select count(*)::int from public.service_requests where id in (pg_temp.r(9), pg_temp.r(10)) and needs_admin_review), 0, 'SF-6a state: nothing flagged by reading');

-- ================================================================================================
-- SF-12 The summary after SF-6a: fulfillment count 1 and aged null (DF-1 repaired by 7.5B; before
-- 20261130001000 the summary printed aged 0). Read as the finance holder and as the operator.
select is(pg_temp.call(n, $q$select r from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'fulfillment'$q$),
  '{"queue":"fulfillment","state":"ready","count":1,"aged":null}'::jsonb, format('SF-12 summary: fulfillment count 1, aged null (user %s)', n))
  from unnest(array[1,2]) n;
select is((pg_temp.call(2, $q$select r from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'fulfillment'$q$)->>'count')::int,
  jsonb_array_length(pg_temp.fulfillment_q()->'items'), 'SF-12 summary: count equals the fulfillment queue');

-- ================================================================================================
-- SF-6b Then run_lifecycle_batch twice with one run ID (R1), then once with a new run ID (R2).
-- Expected (RV-1): the item stays until a follow-up; one admin row per admin (write-only); one
-- flagged_for_admin_review event in total; run records: R1 inserts one, the R1 replay none, R2 a
-- second one with admin_flagged 0; the homeowner "under review" notice once; nothing from the
-- replay or the second run.
select set_config('t.runs', (select count(*) from public.lifecycle_worker_runs)::text, true);
select is(pg_temp.svc(format('select public.run_lifecycle_batch(%L)', pg_temp.k(1))) - 'ran_at' - 'run_id',
  '{"ok":true,"quotes_expired":0,"matches_expired":0,"confirmations_sent":0,"admin_flagged":1,"lifecycle_version":"phase4-v1"}'::jsonb,
  'SF-6b batch R1: flags exactly the 72-hour job');
select is((select array_agg(id::text||'/'||needs_admin_review order by id) from public.service_requests where id in (pg_temp.r(9), pg_temp.r(10))),
  array[pg_temp.r(9)||'/false', pg_temp.r(10)||'/true'], 'SF-6b state: 72 h flagged, 72 h − 1 µs not');
select is((select count(*)::int from public.lifecycle_worker_runs), current_setting('t.runs')::int + 1, 'SF-6b audit: R1 inserts one run record');
select is(pg_temp.delta('sf6', 'alert'), jsonb_build_object('admin_in_app', (select count(*) from public.user_roles where role = 'admin')),
  'SF-6b alert: one admin in-app row per admin (write-only; NM-1 §4.1)');
select is(pg_temp.delta('sf6', 'communication'), '{"participant_in_app": 1}'::jsonb, 'SF-6b communication: one participant row');
select is(pg_temp.titles(pg_temp.r(10)), array['admin: Unconfirmed completion needs review','admin: Unconfirmed completion needs review','participant: Your completed service is under review'],
  'SF-6b: the admin rows and the homeowner "under review" notice');
select is((select count(*)::int from public.job_events where job_id = pg_temp.r(10) and event_type = 'flagged_for_admin_review'), 1, 'SF-6b audit: one flagged_for_admin_review event');
select is((select metadata->>'reason' from public.job_events where job_id = pg_temp.r(10) and event_type = 'flagged_for_admin_review'), 'homeowner_confirmation_unanswered', 'SF-6b audit: with its reason');
select pg_temp.mark('sf6b_r1');
select set_config('t.sf6b_events', (pg_temp.events(pg_temp.r(9)) + pg_temp.events(pg_temp.r(10)))::text, true);
select is(pg_temp.svc(format('select public.run_lifecycle_batch(%L)', pg_temp.k(1)))->>'replayed', 'true', 'SF-6b replay of R1: returns the stored summary, replayed');
select is(pg_temp.svc(format('select public.run_lifecycle_batch(%L)', pg_temp.k(1))) - 'replayed',
  (select summary from public.lifecycle_worker_runs where id = pg_temp.k(1)), 'SF-6b replay of R1: the summary is the stored one');
select is((select count(*)::int from public.lifecycle_worker_runs), current_setting('t.runs')::int + 1, 'SF-6b audit: the same-run replay inserts no run record');
select is(pg_temp.svc(format('select public.run_lifecycle_batch(%L)', pg_temp.k(2)))->>'admin_flagged', '0', 'SF-6b batch R2 (new run ID): admin_flagged 0');
select is((select count(*)::int from public.lifecycle_worker_runs), current_setting('t.runs')::int + 2, 'SF-6b audit: the new run ID inserts a second run record');
select is((select (summary->>'admin_flagged')::int from public.lifecycle_worker_runs where id = pg_temp.k(2)), 0, 'SF-6b audit: the second run record has admin_flagged 0');
select is(pg_temp.delta('sf6b_r1', 'alert'), '{}'::jsonb, 'SF-6b alert: none from the replay or the second run');
select is(pg_temp.delta('sf6b_r1', 'communication'), '{}'::jsonb, 'SF-6b communication: none from the replay or the second run');
select is(pg_temp.events(pg_temp.r(9)) + pg_temp.events(pg_temp.r(10)), current_setting('t.sf6b_events')::bigint, 'SF-6b audit: no event from the replay or the second run');
select isnt(pg_temp.item(pg_temp.fulfillment_q(), 'confirmation_overdue', pg_temp.r(10)), null, 'SF-6b queue: the item stays until a follow-up is recorded');

-- ================================================================================================
-- SF-7  Offer past 4 h with no other candidate; read through expire_stale_matches as the homeowner's
-- dashboard does (T-1, CFG-009). Contract expectation: no server queue; needs_admin_review; a
-- match_expired event; exhaustion has no event; no message (N-REQ-04 ABSENT). OBSERVED IN ADDITION
-- (discrepancy SD-1, record §4): with the offer-terms gate off, the matcher records the exhaustion
-- in private.offer_terms_blocks, so it appears in the offers-at-other-terms queue as blocked_inactive.
insert into public.service_requests(id,customer_id,service_type,address,city,state,zip_code,service_catalog_id,frequency,description)
 select pg_temp.r(n), pg_temp.u(3), 'P75C offer work '||n, n||' Probe St', 'Fort Myers', 'FL', '00129',
   (select id from public.services_catalog order by id limit 1), 'one-time', 'P75C offer'
 from generate_series(11,12) n;
select private.create_job_offer_internal(pg_temp.r(n), 'c75c1000-0000-4000-8000-000000000002', null, null, false) from generate_series(11,12) n;
select is((select array_agg(matching_status order by id) from public.service_requests where id in (pg_temp.r(11), pg_temp.r(12))), array['offered','offered'], 'SF-7 setup: two exclusive offers to the only provider');
select pg_temp.backdate(format($b$update public.job_match_attempts set offered_at = now() - interval '4 hours', expires_at = now() where service_request_id = %L$b$, pg_temp.r(11)));
select pg_temp.backdate(format($b$update public.job_match_attempts set offered_at = now() - interval '4 hours' + interval '1 microsecond', expires_at = now() + interval '1 microsecond' where service_request_id = %L$b$, pg_temp.r(12)));
select is(private.offer_terms_active(false), false, 'SF-7 precondition: the offer-terms gate is off (as on a clean replay)');
select pg_temp.mark('sf7');
select set_config('t.sf7_events', pg_temp.events(pg_temp.r(11))::text, true);
select set_config('t.sf7_blocks', (select count(*) from private.offer_terms_blocks)::text, true);
select is(pg_temp.call(3, 'select to_jsonb(public.expire_stale_matches())'), '1'::jsonb, 'SF-7 read path: exactly the 4-hour offer expires');
select is(pg_temp.call(3, 'select to_jsonb(public.expire_stale_matches())'), '0'::jsonb, 'SF-7 read path: a second read expires nothing');
select is((select outcome from public.job_match_attempts where service_request_id = pg_temp.r(12)), 'pending', 'SF-7: the offer at 4 h − 1 µs is still pending');
select is((select status::text||'/'||matching_status||'/'||needs_admin_review||'/'||(contractor_id is null) from public.service_requests where id = pg_temp.r(11)),
  'pending/exhausted/true/true', 'SF-7 state: exhausted, needs_admin_review, unassigned');
select is((select count(*)::int from public.job_events where job_id = pg_temp.r(11) and event_type = 'match_expired'), 1, 'SF-7 audit: one match_expired event');
select is(pg_temp.events(pg_temp.r(11)) - current_setting('t.sf7_events')::bigint, 1::bigint, 'SF-7 audit: and nothing else on the job (exhaustion has no event, AC-1 L-4)');
select is((select count(*)::int from private.offer_terms_blocks) - current_setting('t.sf7_blocks')::int, 1, 'SF-7 audit (SD-1): one offer_terms_blocks row for the exhaustion');
select is((select candidates from private.offer_terms_blocks where request_id = pg_temp.r(11)), '[]'::jsonb, 'SF-7 audit (SD-1): with no candidate skipped for the gate');
select is(pg_temp.item(pg_temp.call(1, 'select public.admin_offer_terms_queue()'), 'blocked_inactive', pg_temp.r(11))->>'since',
  to_jsonb(now())#>>'{}', 'SF-7 queue (SD-1): the exhaustion is listed as blocked_inactive in offers at other terms');
select is(pg_temp.delta('sf7', 'alert'), '{}'::jsonb, 'SF-7 alert: none');
select is(pg_temp.delta('sf7', 'communication'), '{}'::jsonb, 'SF-7 communication: none (homeowner exhaustion message N-REQ-04 ABSENT; no provider expiry notice)');

-- ================================================================================================
-- SF-8  Support response targets (CFG-010, T-8). (a) Fixed instants: a request at Friday 16:30 ET is
-- due Monday 16:30 ET. (b) A ticket opened through open_support_ticket is due at that calendar from
-- its opening, owned by project_owner, with an `opened` event and one admin row per admin
-- (write-only) and no acknowledgement to the requester. (c) Same-day priority (clock-dependent).
select is(private.support_response_deadline(timestamptz '2026-11-27 16:30 America/New_York'), timestamptz '2026-11-30 16:30 America/New_York',
  'SF-8a calendar: Friday 16:30 ET is due Monday 16:30 ET');
select is(private.support_response_deadline(timestamptz '2026-11-27 17:00 America/New_York'), timestamptz '2026-11-30 17:00 America/New_York',
  'SF-8a calendar: Friday 17:00 ET (after hours) is due Monday 17:00 ET');
select is(private.support_response_deadline(timestamptz '2026-11-30 09:00 America/New_York'), timestamptz '2026-11-30 17:00 America/New_York',
  'SF-8a calendar: Monday 09:00 ET is due Monday 17:00 ET (eight support hours)');
select pg_temp.mark('sf8');
select set_config('t.t1', pg_temp.call(3, format('select public.open_support_ticket(%L, %L, %L)', pg_temp.k(81), 'P75C question', 'Synthetic support question'))->>'ticket_id', true);
create function pg_temp.ticket(k text) returns public.support_tickets language sql as $$ select * from public.support_tickets where id = current_setting(k)::uuid $$;
select is(((pg_temp.ticket('t.t1')).response_due_at, (pg_temp.ticket('t.t1')).priority, (pg_temp.ticket('t.t1')).queue_owner, (pg_temp.ticket('t.t1')).status)::text,
  (private.support_response_deadline(now()), 'standard', 'project_owner', 'open')::text, 'SF-8b queue: due at the CFG-010 calendar from opening, standard, project_owner');
select is((select array_agg(action) from public.support_ticket_events where ticket_id = current_setting('t.t1')::uuid), array['opened'], 'SF-8b audit: one opened event');
select is(pg_temp.delta('sf8', 'alert'), jsonb_build_object('admin_in_app', (select count(*) from public.user_roles where role = 'admin')),
  'SF-8b alert: one admin in-app row per admin (write-only; NM-1 §4.1)');
select is(pg_temp.delta('sf8', 'communication'), '{}'::jsonb, 'SF-8b communication: none (no acknowledgement to the requester, N-SUP-01)');
-- (c) A ticket on a job whose appointment is today (ET). route_support_ticket reads now(): during
-- weekday hours 09:00–17:00 ET it is same_day, due 17:00 ET today; otherwise standard at the calendar.
-- The expectation states CFG-010 at this transaction's clock; the branch exercised is reported.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,scheduled_start_at)
 values (pg_temp.r(13), pg_temp.u(3), 'c75c1000-0000-4000-8000-000000000001', 'P75C same-day work', '13 Probe St', 'Fort Myers', 'FL', '00128', 'P75C same day',
   'scheduled', 'matched', 'fixed', (date_trunc('day', now() at time zone 'America/New_York') + interval '10 hours') at time zone 'America/New_York'),
  (pg_temp.r(14), pg_temp.u(3), 'c75c1000-0000-4000-8000-000000000001', 'P75C next-day work', '14 Probe St', 'Fort Myers', 'FL', '00128', 'P75C next day',
   'scheduled', 'matched', 'fixed', (date_trunc('day', now() at time zone 'America/New_York') + interval '1 day 10 hours') at time zone 'America/New_York');
select set_config('t.in_hours', (extract(isodow from now() at time zone 'America/New_York') <= 5
  and (now() at time zone 'America/New_York')::time >= time '09:00' and (now() at time zone 'America/New_York')::time < time '17:00')::text, true);
select diag('SF-8c same-day branch exercised in this run: ' || case when current_setting('t.in_hours')::boolean then 'same_day (inside weekday hours)' else 'standard (outside weekday hours)' end);
select set_config('t.t2', pg_temp.call(3, format('select public.open_support_ticket(%L, %L, %L, %L)', pg_temp.k(82), 'P75C today', 'Synthetic same-day question', pg_temp.r(13)))->>'ticket_id', true);
select set_config('t.t3', pg_temp.call(3, format('select public.open_support_ticket(%L, %L, %L, %L)', pg_temp.k(83), 'P75C tomorrow', 'Synthetic next-day question', pg_temp.r(14)))->>'ticket_id', true);
select is(((pg_temp.ticket('t.t2')).priority, (pg_temp.ticket('t.t2')).response_due_at)::text,
  case when current_setting('t.in_hours')::boolean
    then ('same_day', ((now() at time zone 'America/New_York')::date + time '17:00') at time zone 'America/New_York')::text
    else ('standard', private.support_response_deadline(now()))::text end,
  'SF-8c queue: an appointment-today ticket follows CFG-010 at this clock (branch in the diagnostic above)');
select is(((pg_temp.ticket('t.t3')).priority, (pg_temp.ticket('t.t3')).response_due_at)::text, ('standard', private.support_response_deadline(now()))::text,
  'SF-8c queue: an appointment-tomorrow ticket is never same_day');
select is(pg_temp.delta('sf8', 'communication'), '{}'::jsonb, 'SF-8c communication: still none to the requester');

-- ================================================================================================
-- SF-9  KNOWN DEFECT DF-3 (contract §5.3; repair is 7.5D under CD-1). An operator replies before the
-- due time; the clock passes it. Current behavior: overdue = true, because "past response target"
-- measures "still open", not "not yet answered". Alert none. Audit: the message row. Communication:
-- N-SUP-03 to the requester. These assertions pin the defect; 7.5D must change them on purpose.
select pg_temp.mark('sf9');
select pg_temp.call(1, format('select public.post_support_message(%L, %L, %L)', current_setting('t.t1'), pg_temp.k(91), 'Synthetic operations answer'));
select is((select array_agg(author_role||'/'||visibility) from public.support_ticket_messages where ticket_id = current_setting('t.t1')::uuid), array['operations/participant'],
  'SF-9 audit: one participant-visible operations message');
select is(pg_temp.delta('sf9', 'alert'), '{}'::jsonb, 'SF-9 alert: none for an operations reply');
select is(pg_temp.delta('sf9', 'communication'), '{"participant_in_app": 1, "support_reply": 1}'::jsonb, 'SF-9 communication: the reply and one in-app row');
select is((select array_agg(title) from public.notifications where user_id = pg_temp.u(3) and created_at = now() and title like 'Mercurius replied on %'),
  array['Mercurius replied on ' || (pg_temp.ticket('t.t1')).ticket_number], 'SF-9 communication: N-SUP-03 to the requester');
-- The reply was an hour before the due time, and the due time has now passed.
select pg_temp.backdate(format($b$update public.support_tickets set created_at = now() - interval '3 hours', response_due_at = now() - interval '1 microsecond' where id = %L$b$, current_setting('t.t1')));
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = now() - interval '1 hour' where ticket_id = %L$b$, current_setting('t.t1')));
create function pg_temp.support_item(k text, include_closed boolean default false) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.call(1, format('select public.admin_support_queue(%L)', include_closed))->'items') i where (i->>'ticket_id')::uuid = current_setting(k)::uuid $$;
select is(pg_temp.support_item('t.t1')->>'overdue', 'true', 'SF-9 KNOWN DEFECT DF-3: answered before the due time, yet overdue once it passes');
select is((pg_temp.support_item('t.t1')->>'messages')::int, 1, 'SF-9 KNOWN DEFECT DF-3: the queue itself shows the reply');
select ok((pg_temp.call(2, $q$select r from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'support'$q$)->>'aged')::int >= 1,
  'SF-9 KNOWN DEFECT DF-3: the overview counts it "past response target"');
-- The other half of DF-3: a ticket closed without any reply is never overdue.
select pg_temp.mark('sf9_close');
select pg_temp.call(1, format('select public.admin_update_support_ticket(%L, %L, 0, %L, null, null, %L)', current_setting('t.t3'), pg_temp.k(92), 'closed', 'Synthetic closure without reply'));
select pg_temp.backdate(format($b$update public.support_tickets set response_due_at = now() - interval '1 hour' where id = %L$b$, current_setting('t.t3')));
select is(pg_temp.support_item('t.t3'), null, 'SF-9 KNOWN DEFECT DF-3: closed without a reply, it leaves the open queue');
select is(pg_temp.support_item('t.t3', true)->>'overdue', 'false', 'SF-9 KNOWN DEFECT DF-3: and is never overdue, though never answered');
select is((select count(*)::int from public.support_ticket_messages where ticket_id = current_setting('t.t3')::uuid), 0, 'SF-9 KNOWN DEFECT DF-3: no reply exists');
select is(pg_temp.delta('sf9_close', 'alert'), '{}'::jsonb, 'SF-9 closure alert: none');
select is(pg_temp.delta('sf9_close', 'communication'), '{}'::jsonb, 'SF-9 closure communication: none (the requester is not told)');

-- ================================================================================================
-- SF-10 Owner email row `sending` older than 10 minutes (TRACE-104 technical window, not an SLA).
-- Expected: `unknown`, in the attention count. Alert none (the page is the alert; nothing pushes).
-- Audit: the ledger row and its claim event. Communication n/a (operator email).
select pg_temp.svc($s$with i as (insert into public.contact_submissions(id,first_name,last_name,email,subject,message)
  values ('c75c4000-0000-4000-8000-000000000001','P75C','Sender','p75c-sender@example.invalid','P75C contact','Synthetic message') returning 1) select to_jsonb(count(*)) from i$s$);
select is(pg_temp.svc($s$select public.owner_email_claim('contact_submission','c75c4000-0000-4000-8000-000000000001','initial')$s$)->>'claimed', 'true', 'SF-10 setup: the sender claims the email');
create function pg_temp.owner_view() returns text language sql as $$
  select private.owner_email_state(n.state, n.created_at, n.claimed_at) from private.owner_email_notifications n where n.contact_submission_id = 'c75c4000-0000-4000-8000-000000000001' $$;
create function pg_temp.attention() returns int language sql as $$ select (pg_temp.call(1, 'select public.owner_email_overview()')#>>'{attention_count,total}')::int $$;
select set_config('t.attention', pg_temp.attention()::text, true);
select pg_temp.mark('sf10');
select pg_temp.backdate($b$update private.owner_email_notifications set claimed_at = now() - interval '10 minutes' where contact_submission_id = 'c75c4000-0000-4000-8000-000000000001'$b$);
select is((pg_temp.call(1, 'select public.owner_email_overview()')->>'stale_after_minutes')::int, 10, 'SF-10 precondition: the stale window is 10 minutes');
select is(pg_temp.owner_view(), 'sending', 'SF-10 queue: exactly 10 minutes after the claim it still reads sending');
select is(pg_temp.attention(), current_setting('t.attention')::int, 'SF-10 queue: not yet in the attention count');
select pg_temp.backdate($b$update private.owner_email_notifications set claimed_at = now() - interval '10 minutes' - interval '1 microsecond' where contact_submission_id = 'c75c4000-0000-4000-8000-000000000001'$b$);
select is(pg_temp.owner_view(), 'unknown', 'SF-10 queue: past 10 minutes it reads unknown');
select is(pg_temp.attention(), current_setting('t.attention')::int + 1, 'SF-10 queue: and is in the attention count');
select is((select state||'/'||attempts from private.owner_email_notifications where contact_submission_id = 'c75c4000-0000-4000-8000-000000000001'), 'sending/1', 'SF-10 audit: the stored row is unchanged (aging is read-time)');
select is(pg_temp.delta('sf10', 'alert'), '{}'::jsonb, 'SF-10 alert: none (no new ledger event, admin row, HTTP request or job)');
select is(pg_temp.delta('sf10', 'communication'), '{}'::jsonb, 'SF-10 communication: none');

-- ================================================================================================
-- SF-11 Stripe webhook row dead-lettered (MTS §10 step 7). Expected: provider_event finance
-- exception. Alert: NONE — MISSING (MTS §10 step 7 and §11 call for one). Audit: the webhook row.
select pg_temp.mark('sf11');
select pg_temp.svc($s$select to_jsonb(public.money_receive_event('evt_p75c_sf11','checkout_expired',
  jsonb_build_object('attempt_id','c75c3200-0000-4000-8000-0000000000ff','session_id','cs_p75c_sf11')))$s$);
select is(pg_temp.svc($s$select jsonb_agg(public.money_process_event('evt_p75c_sf11')) from generate_series(1,5)$s$), '["failed","failed","failed","failed","failed"]'::jsonb,
  'SF-11 webhook: an effect that cannot apply fails on each of five attempts');
select is((select status||'/'||attempt_count from public.money_webhook_events where event_id = 'evt_p75c_sf11'), 'dead_letter/5', 'SF-11 audit: dead-lettered after the fifth attempt');
select is(pg_temp.svc($s$select to_jsonb(public.money_process_event('evt_p75c_sf11'))$s$), '"dead_letter"'::jsonb, 'SF-11 webhook: a further attempt does nothing');
create function pg_temp.finance_item(event text) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.call(2, 'select public.money_finance_reconciliation()')->'exceptions') i where i->>'kind' = 'provider_event' and i->>'event_id' = event $$;
select is(pg_temp.finance_item('evt_p75c_sf11') - 'since', '{"kind":"provider_event","event_id":"evt_p75c_sf11","event_type":"checkout_expired","status":"dead_letter","attempts":5,"error_code":"P0002","holds_all_payouts":false,"obligation_id":null}'::jsonb,
  'SF-11 queue: a provider_event finance exception');
select is(pg_temp.finance_item('evt_p75c_sf3'), null, 'SF-11 queue: the processed SF-3 event is not an exception');
select ok((pg_temp.call(2, $q$select r from jsonb_array_elements(public.admin_operations_summary()->'queues') r where r->>'queue' = 'finance_exceptions'$q$)->>'count')::int >= 1,
  'SF-11 queue: counted in the finance row of the overview (money authority)');
select is(pg_temp.delta('sf11', 'alert'), '{}'::jsonb, 'SF-11 alert: NONE — MISSING (MTS §10 step 7, §11): no admin row, owner email, HTTP request or job');
select is(pg_temp.delta('sf11', 'communication'), '{}'::jsonb, 'SF-11 communication: none');

-- ================================================================================================
-- Whole file: every in-app row any staged failure wrote, per request (participant rows from setup
-- commands included), and no outbound HTTP request or scheduled job at all.
-- Setup notices (the offer to the provider, N-REQ-01; acceptance to the homeowner; the proposal to
-- each admin; the quote to the homeowner and provider; support opened to each admin) are listed so
-- that nothing else can appear unnoticed. Ticket numbers come from a sequence and are normalized.
create table pg_temp.expected_titles(n int primary key, titles text[]);
insert into pg_temp.expected_titles values
 (1, array['participant: New job offer — respond within four hours','participant: Provider accepted your service']),
 (2, array['participant: New job offer — respond within four hours','participant: Provider accepted your service']),
 (3, array['participant: Itemized quote ready to review','participant: New job offer — respond within four hours','participant: Price quote expired','participant: Provider accepted your service',
   'admin: Quote proposal ready for review','admin: Quote proposal ready for review','participant: Your quote was sent']),
 (10, array['admin: Unconfirmed completion needs review','admin: Unconfirmed completion needs review','participant: Your completed service is under review']),
 (11, array['participant: New job offer — respond within four hours']),
 (12, array['participant: New job offer — respond within four hours']),
 (13, array['admin: Support request TKT-n','admin: Support request TKT-n']),
 (14, array['admin: Support request TKT-n','admin: Support request TKT-n']);
select is((select array_agg(regexp_replace(t, 'TKT-[0-9]+', 'TKT-n') order by o) from unnest(pg_temp.titles(pg_temp.r(n))) with ordinality x(t, o)),
  (select titles from pg_temp.expected_titles e where e.n = g.n),
  format('Whole file: in-app rows for request %s are exactly the staged outcomes and setup notices', n))
  from generate_series(1,14) g(n);
select is(pg_temp.delta('file', 'alert') - 'admin_in_app' - 'owner_email' - 'owner_email_events', '{}'::jsonb, 'Whole file: no outbound HTTP request and no scheduled job');

select * from finish();
rollback;
