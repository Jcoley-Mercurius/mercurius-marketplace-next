-- TRACE-155 (Phase 7.3D-1): audited arm/disarm commands, interval coverage and probe readback.
-- Shape and privileges; authorization on every public function (anon, service role, homeowner,
-- vendor refused; no caller-supplied actor); transitions and duplicate refusals; reason
-- validation; the append-only, ordered, alternating history; audit and config rolled back
-- together when either write fails; fail-closed on an arming record that disagrees with its
-- history; coverage at every interval boundary (before first arm, inside, partial, gap,
-- collecting, complete); rules 1–8 identical to the 7.3C-1 expressions for every fact set; facts
-- surviving disarm and re-arm; durable state rather than response status (duplicate, content
-- conflict, stored conflict, other, invalid_payload, unlinked); the arming cutoff; the retention
-- readback and purge after disablement; the probe readback; output keys; read purity; unchanged
-- definitions and money fingerprint.
-- Synthetic identities and content only. Nothing is sent. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1250000-0000-4000-8000-000000000001','arming-operator@example.test',now(),'{}'),
 ('e1250000-0000-4000-8000-000000000002','arming-homeowner@example.test',now(),'{}'),
 ('e1250000-0000-4000-8000-000000000003','arming-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1250000-0000-4000-8000-000000000001','admin'),
 ('e1250000-0000-4000-8000-000000000002','homeowner'),
 ('e1250000-0000-4000-8000-000000000003','vendor')
on conflict do nothing;

create function pg_temp.run(p_sub uuid, p_role text, p_sql text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role',p_role,'sub',p_sub)::text,true);
 execute format('set local role %I', p_role);
 execute p_sql into result;
 reset role;
 return result;
end $$;
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$ select pg_temp.run(null,'service_role',p_sql) $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$
 select pg_temp.run('e1250000-0000-4000-8000-000000000001','authenticated',p_sql) $$;

-- The route's receive call, exactly as SQL 121, 122 and 124 make it.
create function pg_temp.recv(p_id text, p_type text, p_email text default null, p_tags text default 'absent',
  p_ledger text default null, p_ref uuid default null, p_attempt int default null,
  p_bounce text default null, p_created timestamptz default '2026-11-20T10:00:00Z', p_processing text default 'recorded')
returns text language sql as $$
 select pg_temp.svc(format('select public.email_receive_provider_event(p_svix_id=>%L,p_secret_slot=>%L,p_processing=>%L,p_event_type=>%L,'
   'p_provider_type=>%L,p_provider_created_at=>%L,p_provider_email_id=>%L,p_bounce_type=>%L,p_bounce_subtype=>%L,'
   'p_tag_status=>%L,p_tag_ledger=>%L,p_tag_ref=>%L,p_tag_attempt=>%L)',
   p_id,'current',p_processing,p_type,case when p_processing='invalid_payload' then null else p_type end,
   case when p_processing='invalid_payload' then null else p_created end,p_email,p_bounce,case when p_bounce is not null then 'general' end,
   p_tags,p_ledger,p_ref,p_attempt))->>'result' $$;

create function pg_temp.events() returns int language sql as $$ select count(*)::int from private.email_evidence_arming_events $$;
create function pg_temp.armed_at() returns timestamptz language sql as $$ select armed_at from private.email_evidence_config where singleton $$;
create function pg_temp.event_at(p_seq int) returns timestamptz language sql as $$
 select occurred_at from private.email_evidence_arming_events where seq = p_seq $$;
-- Test-only reset of the arming history (the guard is bypassed by disabling it as the owner).
create function pg_temp.reset_arming() returns void language plpgsql as $$
begin
  alter table private.email_evidence_arming_events disable trigger email_evidence_arming_events_guard;
  delete from private.email_evidence_arming_events;
  alter table private.email_evidence_arming_events enable trigger email_evidence_arming_events_guard;
  delete from private.email_evidence_config;
end $$;
-- Test-only synthetic history at fixed times; the guard still checks order and time.
create function pg_temp.history(p_times timestamptz[]) returns void language plpgsql as $$
begin
  perform pg_temp.reset_arming();
  for i in 1 .. coalesce(cardinality(p_times), 0) loop
    insert into private.email_evidence_arming_events(seq, action, occurred_at, actor, reason)
      values (i, case when i % 2 = 1 then 'arm' else 'disarm' end, p_times[i], 'e1250000-0000-4000-8000-000000000001', 'Synthetic');
  end loop;
  insert into private.email_evidence_config(singleton, armed_at)
    values (true, case when cardinality(p_times) % 2 = 1 then p_times[cardinality(p_times)] end);
end $$;
create function pg_temp.cov(p_at timestamptz) returns text language sql as $$ select private.email_evidence_coverage(p_at) $$;
create function pg_temp.rc(p_at timestamptz) returns text language sql as $$
 select (s->>'rule')||'|'||(s->>'coverage') from (select private.email_evidence_summary('{}'::text[], p_at) as s) x $$;

-- Contact submissions 1..20, each with its pending owner-email row from the 7.2C-1 trigger.
insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 select ('e1252000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic','Sender','arming-sender@example.test',null,'Synthetic','Synthetic body'
   from generate_series(1,20) n;
create function pg_temp.src(p_n int) returns uuid language sql as $$ select ('e1252000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.oe(p_n int) returns uuid language sql as $$
 select id from private.owner_email_notifications where contact_submission_id = pg_temp.src(p_n) $$;
-- A sent attempt 1 claimed at p_at with provider ID p_email.
create function pg_temp.sent(p_n int, p_at timestamptz, p_email text) returns void language sql as $$
 update private.owner_email_notifications set state='sent', attempts=1, claimed_at=p_at, sent_at=p_at, provider_message_id=p_email
  where id = pg_temp.oe(p_n) $$;
create function pg_temp.ev(p_n int) returns jsonb language sql as $$ select private.email_evidence_owner_row(pg_temp.oe(p_n)) $$;
create function pg_temp.sum(p_n int) returns text language sql as $$
 select (pg_temp.ev(p_n)->'summary'->>'rule')||'|'||(pg_temp.ev(p_n)->'summary'->>'coverage') $$;
create function pg_temp.st(p_id text) returns text language sql as $$
 select private.email_evidence_receipt_state(e) from private.email_provider_events e where svix_id = p_id $$;
create function pg_temp.readback() returns jsonb language sql as $$ select pg_temp.op('select public.email_evidence_arming_readback()') $$;
create function pg_temp.probe(p_email text) returns jsonb language sql as $$
 select pg_temp.op(format('select public.email_evidence_probe_readback(%L)', p_email)) $$;
-- Everything a read could touch.
create function pg_temp.world() returns text language sql as $$
 select md5(concat_ws('#',
   (select string_agg(to_jsonb(a)::text, ',' order by seq) from private.email_evidence_arming_events a),
   (select string_agg(to_jsonb(c)::text, ',') from private.email_evidence_config c),
   (select string_agg(to_jsonb(e)::text, ',' order by svix_id) from private.email_provider_events e),
   (select string_agg(to_jsonb(p)::text, ',' order by id) from private.email_provider_event_purges p),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.owner_email_notifications n))) $$;

-- 1. Shape and privileges ---------------------------------------------------------------------
create temp table d1_functions(sig regprocedure);
insert into d1_functions values
 ('private.email_evidence_arming_events_guard()'),('private.email_evidence_transition(text,text)'),
 ('public.email_evidence_arm(text)'),('public.email_evidence_disarm(text)'),
 ('private.email_evidence_retry_horizon()'),('private.email_evidence_coverage(timestamptz)'),
 ('public.email_evidence_arming_readback()'),('public.email_evidence_probe_authorize()'),
 ('public.email_evidence_probe_readback(text)');
grant select on d1_functions to public;
select is((select string_agg(p.oid::regprocedure::text||':'||p.provolatile::text||':'||p.prosecdef::text, ',' order by p.oid::regprocedure::text)
  from pg_proc p where p.oid in (select sig::oid from d1_functions)),
 'email_evidence_arm(text):v:true,email_evidence_arming_readback():s:true,email_evidence_disarm(text):v:true,'
 'email_evidence_probe_authorize():s:true,email_evidence_probe_readback(text):s:true,'
 'private.email_evidence_arming_events_guard():v:false,private.email_evidence_coverage(timestamp with time zone):s:false,'
 'private.email_evidence_retry_horizon():i:false,private.email_evidence_transition(text,text):v:false',
 'nine new functions: commands volatile, reads stable, the horizon immutable; only the five public ones are security definer');
select is((select count(*)::int from pg_proc p where p.oid in (select sig::oid from d1_functions)
  and p.proconfig = array['search_path=""']), 9, 'every new function has an empty search_path');
select is((select string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text) from pg_proc p
  where p.oid in (select sig::oid from d1_functions) and has_function_privilege('authenticated', p.oid, 'execute')),
 'email_evidence_arm(text),email_evidence_arming_readback(),email_evidence_disarm(text),email_evidence_probe_authorize(),email_evidence_probe_readback(text)',
 'authenticated may execute only the five public functions (each still requires an operator)');
select is((select count(*)::int from pg_proc p where p.oid in (select sig::oid from d1_functions)
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
 'anon and the service role execute none of them');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like '%email\_evidence%'
    and p.oid not in (select sig::oid from d1_functions)
    and p.oid <> all(array['public.owner_email_evidence(text,uuid[])','public.owner_email_evidence_counts()',
      'private.email_evidence_fact(text,text)','private.email_evidence_identity_holds(private.email_provider_events)',
      'private.email_evidence_receipt_state(private.email_provider_events)','private.email_evidence_summary(text[],timestamptz)',
      'private.email_evidence_owner_claimed_at(uuid,integer)','private.email_evidence_owner_receipts(uuid)','private.email_evidence_owner_row(uuid)',
      'private.email_evidence_ledger_claimed_at(text,uuid,integer)','private.email_evidence_ledger_receipts(text,uuid)',
      'private.email_evidence_ledger_row(text,uuid)','private.email_evidence_ledger_counts(text)','private.email_evidence_global_counts()',
      'public.application_email_evidence(uuid[])','public.application_email_evidence_counts()',
      'public.package_draft_email_evidence(uuid[])','public.package_draft_email_evidence_counts()']::regprocedure[]::oid[])),0,
 'this slice adds exactly the nine listed functions beside the 7.3C-1 and 7.3C-2 functions');
select is((select relrowsecurity from pg_class where oid='private.email_evidence_arming_events'::regclass), true, 'the history has RLS enabled');
select is((select count(*)::int from unnest(array['anon','authenticated','service_role']) r,
   unnest(array['select','insert','update','delete','truncate']) priv
  where has_table_privilege(r, 'private.email_evidence_arming_events', priv)), 0, 'no client role holds any table privilege on the history');
select is((select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
  where a.attrelid='private.email_evidence_arming_events'::regclass and a.attnum>0 and not a.attisdropped),
 'seq,action,occurred_at,actor,reason', 'history columns: no recipient, provider, tag or content field');
select is((select pg_get_function_arguments('public.email_evidence_arm(text)'::regprocedure)||' / '||
                  pg_get_function_arguments('public.email_evidence_disarm(text)'::regprocedure)),
 'p_reason text / p_reason text', 'the commands take a reason only: there is no actor parameter');
select is(pg_temp.events(), 0, 'the history starts empty');
select is((select count(*)::int from private.email_evidence_config), 0, 'the arming record starts empty');

-- 2. Authorization on every public function ---------------------------------------------------------
create temp table d1_calls(call text);
insert into d1_calls values ('select public.email_evidence_arm(''Synthetic reason'')'),('select public.email_evidence_disarm(''Synthetic reason'')'),
 ('select public.email_evidence_arming_readback()'),('select to_jsonb(public.email_evidence_probe_authorize())'),
 ('select public.email_evidence_probe_readback(''em-anything'')');
grant select on d1_calls to public;
create temp table d1_refusals(call text, who text, outcome text);
do $$
declare c record; r record;
begin
  for c in select call from d1_calls loop
    for r in select * from (values ('anon', null::uuid, 'anon'), ('service', null::uuid, 'service_role'),
        ('homeowner', 'e1250000-0000-4000-8000-000000000002'::uuid, 'authenticated'),
        ('vendor', 'e1250000-0000-4000-8000-000000000003'::uuid, 'authenticated')) v(who, sub, role) loop
      begin
        perform pg_temp.run(r.sub, r.role, c.call);
        insert into d1_refusals values (c.call, r.who, 'allowed');
      exception when others then
        reset role;
        insert into d1_refusals values (c.call, r.who, sqlstate);
      end;
    end loop;
  end loop;
end $$;
select is((select count(*)::int from d1_refusals), 20, 'each of the five public functions was called by four non-operators');
select is((select string_agg(distinct outcome, ',') from d1_refusals), '42501',
 'anon, the service role, a homeowner and a vendor are all refused (42501) on every public function');
select is(pg_temp.events()||'|'||(select count(*) from private.email_evidence_config), '0|0', 'refused calls wrote nothing');
select is(pg_temp.op('select to_jsonb(public.email_evidence_probe_authorize())'), 'true'::jsonb, 'an operator session is authorized');
select throws_ok('select pg_temp.run(''e1250000-0000-4000-8000-000000000001'',''authenticated'',
  ''insert into private.email_evidence_arming_events values (1,''''arm'''',now(),gen_random_uuid(),''''x'''')'')', '42501', null,
 'an operator session cannot write the history directly');
select throws_ok('select pg_temp.run(null,''service_role'',''update private.email_evidence_config set armed_at = now()'')', '42501', null,
 'the service role cannot write the arming record directly');

-- 3. Transitions ------------------------------------------------------------------------------------
select throws_ok('select pg_temp.op(''select public.email_evidence_disarm(''''Synthetic'''')'')', '55000', 'Delivery evidence is not armed',
 'disarming before any arming is refused');
select throws_ok(format('select pg_temp.op(%L)', format('select public.email_evidence_arm(%L)', r)), '22023', null,
 'arming without a valid reason is refused (null, empty, blank, 501 characters, newline, tab: case '||n||')')
  from unnest(array[null, '', '    ', repeat('x', 501), E'two\nlines', E'tab\there']) with ordinality u(r, n);
select is(pg_temp.events()||'|'||(select count(*) from private.email_evidence_config), '0|0', 'refused transitions wrote nothing, not even the record row');
create temp table t_arm1 as select pg_temp.op('select public.email_evidence_arm(''  Synthetic rehearsal arm  '')') as v;
select is((select v - 'occurred_at' from t_arm1), '{"seq": 1, "armed": true, "action": "arm"}'::jsonb, 'the first arm is event 1');
select is((select actor::text||'|'||reason||'|'||action from private.email_evidence_arming_events where seq = 1),
 'e1250000-0000-4000-8000-000000000001|Synthetic rehearsal arm|arm', 'the actor is the session operator and the reason is trimmed');
select is(pg_temp.armed_at(), pg_temp.event_at(1), 'armed_at is the arm event''s time, written in the same call');
select is((select updated_at from private.email_evidence_config), pg_temp.event_at(1), 'the record''s updated_at is the transition time');
select ok(pg_temp.event_at(1) >= now(), 'the transition time is taken when the call runs (clock time), not earlier');
select is(((select v->>'occurred_at' from t_arm1))::timestamptz, pg_temp.event_at(1), 'the command returns the stored time');
select throws_ok('select pg_temp.op(''select public.email_evidence_arm(''''Synthetic'''')'')', '55000', 'Delivery evidence is already armed',
 'a second arm is refused');
select is(pg_temp.events(), 1, 'the refused arm appended nothing');
select is((pg_temp.op('select public.email_evidence_disarm(''Synthetic rehearsal disarm'')') - 'occurred_at'),
 '{"seq": 2, "armed": false, "action": "disarm"}'::jsonb, 'disarm is event 2');
select is(pg_temp.armed_at(), null, 'disarm clears armed_at');
select is((select updated_at from private.email_evidence_config), pg_temp.event_at(2), 'and stamps the record with the disarm time');
select throws_ok('select pg_temp.op(''select public.email_evidence_disarm(''''Synthetic'''')'')', '55000', 'Delivery evidence is not armed',
 'a second disarm is refused');
select is((pg_temp.op('select public.email_evidence_arm(''Synthetic rehearsal re-arm'')')->>'seq')::int, 3, 're-arming is event 3');
select is((select string_agg(seq||':'||action, ',' order by seq) from private.email_evidence_arming_events), '1:arm,2:disarm,3:arm',
 'history alternates and is complete');
select ok(pg_temp.event_at(1) < pg_temp.event_at(2) and pg_temp.event_at(2) < pg_temp.event_at(3), 'times strictly increase with seq');
select is((select jsonb_agg(h->'action' order by (h->>'seq')::int) from jsonb_array_elements(pg_temp.readback()->'history') h),
 '["arm", "disarm", "arm"]'::jsonb, 'the readback lists the full history in order');
select is(pg_temp.readback()->'intervals',
 jsonb_build_array(jsonb_build_object('armed_from', pg_temp.event_at(1), 'disarmed_at', pg_temp.event_at(2)),
                   jsonb_build_object('armed_from', pg_temp.event_at(3), 'disarmed_at', null)),
 'the readback gives one closed and one open interval');
select is((pg_temp.readback()->>'armed')::boolean||'|'||((pg_temp.readback()->>'armed_at')::timestamptz = pg_temp.event_at(3)), 'true|true',
 'the readback reads the current state');
select is((pg_temp.readback()->>'retry_horizon_seconds')::int, 100800, 'the readback states the 28-hour horizon');
select is((pg_temp.op('select public.application_email_evidence_counts()')->'all_emails'->>'receiver_armed')::boolean, true,
 'the existing receiver_armed count reads the commands'' armed_at');

-- 4. The history guard -------------------------------------------------------------------------------
select throws_ok('update private.email_evidence_arming_events set reason = ''changed'' where seq = 1', '55000', 'The arming history is append-only',
 'an event cannot be changed, even by the owner');
select throws_ok('delete from private.email_evidence_arming_events where seq = 3', '55000', 'The arming history is append-only',
 'an event cannot be deleted');
select throws_ok('truncate private.email_evidence_arming_events', '55000', 'The arming history is append-only', 'the history cannot be truncated');
select throws_ok('insert into private.email_evidence_arming_events values (5, ''arm'', clock_timestamp(), gen_random_uuid(), ''Skip'')',
 '55000', 'An arming event must follow the latest one', 'a skipped seq is refused');
select throws_ok(format('insert into private.email_evidence_arming_events values (4, ''disarm'', %L, gen_random_uuid(), ''Back'')', pg_temp.event_at(3)),
 '55000', 'An arming event must be later than the latest one', 'a time that does not move forward is refused');
select throws_ok('insert into private.email_evidence_arming_events values (4, ''arm'', clock_timestamp(), gen_random_uuid(), ''Twice'')',
 '23514', null, 'an arm cannot follow an arm, even inserted directly');
select is(pg_temp.events(), 3, 'nothing was changed or added by the refused writes');

-- 5. Audit and record roll back together -------------------------------------------------------------
create function public.d1_synthetic_failure() returns trigger language plpgsql as $$
begin raise exception 'Synthetic write failure' using errcode = 'P0001'; end $$;
create trigger d1_fail_config before update on private.email_evidence_config for each row execute function public.d1_synthetic_failure();
select throws_ok('select pg_temp.op(''select public.email_evidence_disarm(''''Synthetic'''')'')', 'P0001', 'Synthetic write failure',
 'a failing record write fails the disarm');
select is(pg_temp.events()||'|'||(pg_temp.armed_at() = pg_temp.event_at(3)), '3|true', 'and its audit event was rolled back with it');
drop trigger d1_fail_config on private.email_evidence_config;
create trigger d1_fail_history before insert on private.email_evidence_arming_events for each row execute function public.d1_synthetic_failure();
select throws_ok('select pg_temp.op(''select public.email_evidence_disarm(''''Synthetic'''')'')', 'P0001', 'Synthetic write failure',
 'a failing audit write fails the disarm');
select is(pg_temp.events()||'|'||(pg_temp.armed_at() = pg_temp.event_at(3)), '3|true', 'and the record is unchanged');
drop trigger d1_fail_history on private.email_evidence_arming_events;
drop function public.d1_synthetic_failure();
update private.email_evidence_config set armed_at = null;
select throws_ok('select pg_temp.op(''select public.email_evidence_disarm(''''Synthetic'''')'')', '55000',
 'The arming record disagrees with its audit history', 'a record that disagrees with its history fails closed (disarm)');
select throws_ok('select pg_temp.op(''select public.email_evidence_arm(''''Synthetic'''')'')', '55000',
 'The arming record disagrees with its audit history', 'and fails closed (arm)');
select is(pg_temp.events(), 3, 'nothing was appended while they disagree');
update private.email_evidence_config set armed_at = pg_temp.event_at(3);

-- 6. Coverage at every boundary ------------------------------------------------------------------------
select pg_temp.history(array[]::timestamptz[]);
select is(pg_temp.cov(now())||'|'||pg_temp.cov(null), 'before_first_arm|unknown', 'with no history: before the first arm; no claim time: unknown');
-- arm T-100h, disarm T-90h, arm T-80h, disarm T-40h, arm T-10h (open).
select pg_temp.history(array[now()-interval '100 hours', now()-interval '90 hours', now()-interval '80 hours',
                             now()-interval '40 hours', now()-interval '10 hours']);
select is(pg_temp.cov(c), e, 'coverage at '||l)
  from (values
    (now()-interval '100 hours'-interval '1 microsecond', 'before_first_arm', '1 µs before the first arm'),
    (now()-interval '100 hours', 'partial', 'the first arm instant (inside; closed 10 h later)'),
    (now()-interval '90 hours'-interval '1 microsecond', 'partial', '1 µs before the first disarm'),
    (now()-interval '90 hours', 'gap', 'the disarm instant (excluded from the interval)'),
    (now()-interval '80 hours'-interval '1 microsecond', 'gap', '1 µs before re-arming'),
    (now()-interval '80 hours', 'complete', 're-arm instant (armed 40 h after)'),
    (now()-interval '68 hours', 'complete', 'exactly 28 h before the disarm'),
    (now()-interval '68 hours'+interval '1 microsecond', 'partial', '1 µs inside the last 28 h before the disarm'),
    (now()-interval '40 hours'-interval '1 microsecond', 'partial', '1 µs before the second disarm'),
    (now()-interval '40 hours', 'gap', 'the second disarm instant'),
    (now()-interval '10 hours', 'collecting', 'the open interval''s arm instant'),
    (now(), 'collecting', 'now, still inside the horizon')) v(c, e, l);
select pg_temp.history(array[now()-interval '50 hours']);
select is(pg_temp.cov(c), e, 'open interval: '||l)
  from (values
    (now()-interval '29 hours', 'complete', 'claimed 29 h ago'),
    (now()-interval '28 hours', 'complete', 'claimed exactly 28 h ago'),
    (now()-interval '28 hours'+interval '1 microsecond', 'collecting', 'claimed 1 µs under 28 h ago'),
    (now()-interval '50 hours'-interval '1 microsecond', 'before_first_arm', '1 µs before the only arm')) v(c, e, l);
select is(pg_temp.rc(now()-interval '29 hours')||','||pg_temp.rc(now())||','||pg_temp.rc(now()-interval '60 hours')||','||pg_temp.rc(null),
 '9|complete,9|collecting,10|before_first_arm,10|unknown', 'empty facts: rule 9 only when claimed while armed');
select pg_temp.history(array[now()-interval '100 hours', now()-interval '90 hours', now()-interval '80 hours']);
select is(pg_temp.rc(now()-interval '95 hours')||','||pg_temp.rc(now()-interval '85 hours'), '9|partial,10|gap',
 'empty facts: partial coverage is rule 9 marked partial; a disarmed gap is rule 10 marked gap');
select is((select string_agg((s->>'rule')||'|'||(s->>'coverage'), ',') from (values
    (private.email_evidence_summary(array['delivered'], now()-interval '85 hours')),
    (private.email_evidence_summary(array['accepted'], now()-interval '200 hours')),
    (private.email_evidence_summary(array['bounced_permanent'], null))) v(s)),
 '4|gap,8|before_first_arm,5|unknown', 'trusted facts give rules 1–8 whatever the coverage');
select is(private.email_evidence_retry_horizon(), interval '28 hours', 'the horizon is 28 hours');

-- Rules 1–8 are the 7.3C-1 expressions: compare every non-empty subset of the nine facts.
create function pg_temp.summary_7_3c1(p_facts text[]) returns jsonb language sql as $$
  with f as (select coalesce(p_facts, '{}'::text[]) as facts),
  r as (
    select f.facts, case
      when 'complained' = any(f.facts) then 1
      when 'delivered' = any(f.facts) and f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 2
      when 'delivered' = any(f.facts) and f.facts && array['bounced_transient', 'bounced_undetermined'] then 3
      when 'delivered' = any(f.facts) then 4
      when f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 5
      when f.facts && array['bounced_transient', 'bounced_undetermined'] then 6
      when 'delayed' = any(f.facts) then 7
      when 'accepted' = any(f.facts) then 8
      else 10 end as rule
    from f
  )
  select jsonb_build_object(
    'rule', r.rule,
    'delivered_fact', r.rule in (1, 2, 3, 4),
    'non_delivery_proven', r.rule = 5,
    'needs_review', r.rule in (1, 2, 3, 5, 6),
    'reported', case when r.rule in (2, 5) then to_jsonb(array(
      select x from unnest(array['bounced_permanent', 'provider_failed', 'provider_suppressed']) x
       where x = any(r.facts) order by x)) else '[]'::jsonb end)
  from r $$;
create temp table d1_subsets as
 select m, array(select f from unnest(array['accepted','delayed','delivered','bounced_permanent','bounced_transient',
   'bounced_undetermined','complained','provider_failed','provider_suppressed']) with ordinality u(f, i)
   where (m >> (i::int - 1)) & 1 = 1) as facts
 from generate_series(1, 511) m;
select is((select count(*)::int from d1_subsets s, (values (null::timestamptz), (now()-interval '95 hours'), (now()-interval '85 hours'), (now())) c(at)
  where private.email_evidence_summary(s.facts, c.at) - 'coverage' is distinct from pg_temp.summary_7_3c1(s.facts)), 0,
 'all 511 non-empty fact sets give the 7.3C-1 rule and flags, at every coverage (rules 1–8 unchanged)');

-- 7. Facts survive disarm; history survives re-arm ------------------------------------------------------
select pg_temp.reset_arming();
select is((pg_temp.op('select public.email_evidence_arm(''Synthetic collection'')')->>'seq')::int, 1, 'armed through the command');
select pg_temp.sent(1, clock_timestamp(), 'em-d1-1');
select is(pg_temp.recv('msg-d1-1','email.delivered','em-d1-1','valid','owner_email',pg_temp.oe(1),1),'recorded','a tagged delivered report');
select is(pg_temp.sum(1)||'|'||pg_temp.st('msg-d1-1'), '4|collecting|trusted', 'row 1: rule 4 while collecting');
select pg_temp.op('select public.email_evidence_disarm(''Synthetic pause'')');
select is(pg_temp.sum(1)||'|'||pg_temp.st('msg-d1-1'), '4|partial|trusted',
 'after disarm the fact still stands (rule 4, trusted); its coverage is now partial');
select pg_temp.sent(2, clock_timestamp(), 'em-d1-2');
select is(pg_temp.sum(2), '10|gap', 'row 2, claimed while disarmed: rule 10, gap');
select pg_temp.op('select public.email_evidence_arm(''Synthetic resume'')');
select pg_temp.sent(3, clock_timestamp(), 'em-d1-3');
select is(pg_temp.sum(1)||','||pg_temp.sum(2)||','||pg_temp.sum(3), '4|partial,10|gap,9|collecting',
 'after re-arming: row 1 keeps its fact and partial label, row 2 keeps its gap, row 3 is collecting');
select is((select string_agg(seq||':'||action, ',' order by seq) from private.email_evidence_arming_events), '1:arm,2:disarm,3:arm',
 'every transition is still in the history');
select is((select count(*)::int from private.email_provider_events), 1, 'disarm and re-arm deleted no receipt');

-- 8. Durable state, not response status --------------------------------------------------------------------
select is(pg_temp.recv('msg-d1-1','email.delivered','em-d1-1','valid','owner_email',pg_temp.oe(1),1),'duplicate',
 'a repeated delivery answers duplicate');
select is(pg_temp.sum(1)||'|'||pg_temp.st('msg-d1-1'), '4|partial|trusted',
 'the duplicate is not new evidence, and the already stored expected receipt is still valid readback evidence');
select is(pg_temp.recv('msg-d1-other','other'),'recorded','an unknown event type (a 200 path)');
select is(pg_temp.recv('msg-d1-invalid','other',p_processing=>'invalid_payload'),'recorded','a verified-malformed payload (a 200 path)');
select is(pg_temp.recv('msg-d1-unlinked','email.delivered','em-unknown-1'),'recorded','an untagged report for an unknown ID (a 200 path)');
select is(pg_temp.recv('msg-d1-3cc','email.delivered','em-d1-3','valid','owner_email',pg_temp.oe(3),1),'recorded','row 3 tagged report');
select is(pg_temp.recv('msg-d1-3cc','email.bounced','em-d1-3','valid','owner_email',pg_temp.oe(3),1,'permanent'),'conflict',
 'the same svix-id with a different payload (a 200 path) flags a content conflict');
select is(pg_temp.recv('msg-d1-3sc','email.delivered','em-d1-1','valid','owner_email',pg_temp.oe(3),1),'recorded',
 'a report tagged for row 3 carrying row 1''s ID');
select is(pg_temp.st('msg-d1-3sc')||'|'||(select identity_class from private.email_provider_events where svix_id='msg-d1-3sc'),
 'stored_conflict|conflict_disagree', 'is a stored conflict');
select is(pg_temp.sum(3)||'|'||(pg_temp.ev(3)->>'has_conflict'), '9|collecting|true',
 'none of those responses becomes a fact for row 3: still rule 9, with the conflict signalled');
select is(pg_temp.sum(1), '4|partial', 'and row 1 is unchanged by them');

-- 9. Arming cutoff -------------------------------------------------------------------------------------------
select pg_temp.sent(4, pg_temp.event_at(1) - interval '1 minute', 'em-d1-4');
select is(pg_temp.recv('msg-d1-4','email.delivered','em-d1-4','valid','owner_email',pg_temp.oe(4),1),'recorded','a trusted report for row 4');
select is(pg_temp.sum(4)||'|'||pg_temp.st('msg-d1-4'), '4|before_first_arm|trusted',
 'claimed before the first arm: the fact stands, and the coverage marks it as before the cutoff (never qualifying)');

-- 10. Retention readback and purge after disablement ---------------------------------------------------------
select pg_temp.op('select public.email_evidence_disarm(''Synthetic stop'')');
select is((pg_temp.readback()->>'armed')::boolean, false, 'disarmed');
select is((pg_temp.readback()->'retention') - 'latest_expires_at',
 jsonb_build_object('retained', 7, 'retained_linked', 3, 'retained_unlinked', 4, 'expired', 0, 'oldest_expired_expires_at', null,
   'purge_duty', true, 'last_purge', null),
 'after disarm every receipt is still stored: 7 retained (3 linked, 4 unlinked including the stored conflict), 0 expired, and purge duty continues (zero expired is not zero retained)');
select is((pg_temp.readback()->'retention'->>'latest_expires_at')::timestamptz, (select max(expires_at) from private.email_provider_events),
 'the latest stored expiry is reported');
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,
  provider_created_at,provider_email_id,identity_class)
 select 'msg-old-'||n, now()-interval '40 days', now()-interval '10 days'+n*interval '1 second', 'current','recorded','email.delivered','email.delivered',
   now()-interval '40 days', 'em-old-'||n, 'unmatched' from generate_series(1,3) n;
select is((pg_temp.readback()->'retention'->>'expired')::int||'|'||(pg_temp.readback()->'retention'->>'retained')::int, '3|10',
 'three expired receipts are counted as both expired and retained');
select is((pg_temp.readback()->'retention'->>'oldest_expired_expires_at')::timestamptz, now()-interval '10 days'+interval '1 second',
 'with the oldest expired expiry');
select is((pg_temp.op('select public.email_provider_events_purge(100)')->>'deleted')::int, 3, 'the operator purge still works after disarm');
select is((pg_temp.readback()->'retention'->'last_purge') - 'ran_at', '{"deleted": 3, "remaining_expired": 0, "remaining_over_cap": false}'::jsonb,
 'the readback reports the last purge run, counts only');
select is((pg_temp.readback()->'retention'->>'expired')::int||'|'||(pg_temp.readback()->'retention'->>'retained')::int||'|'||
          (pg_temp.readback()->'retention'->>'purge_duty'), '0|7|true',
 'no expired backlog, but 7 unexpired receipts are still retained, so purge duty continues');
delete from private.email_provider_events;
select is((pg_temp.readback()->'retention'->>'retained')::int||'|'||(pg_temp.readback()->'retention'->>'purge_duty'), '0|false',
 'purge duty ends only when nothing is stored');

-- 11. Probe readback ----------------------------------------------------------------------------------------------
select is(pg_temp.recv('msg-p1-sent','email.sent','em-probe-1'),'recorded','probe: sent');
select is(pg_temp.recv('msg-p1-del','email.delivered','em-probe-1',p_created=>'2026-11-20T10:00:01Z'),'recorded','probe: delivered');
select is((select jsonb_agg(r->>'event_type'||':'||(r->>'fact')||':'||(r->>'state')) from jsonb_array_elements(pg_temp.probe('em-probe-1')->'receipts') r),
 '["email.sent:accepted:unlinked", "email.delivered:delivered:unlinked"]'::jsonb,
 'a probe''s receipts are unlinked transport evidence, in provider order');
select is((pg_temp.probe('em-probe-1')->>'not_probe')::boolean, false, 'and the ID is a probe''s');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(pg_temp.probe('em-probe-1')->'receipts') r, jsonb_object_keys(r) k),
 array['bounce_subtype','bounce_type','event_type','fact','provider_created_at','received_at','state'], 'probe receipt keys');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.probe('em-probe-1')) k), array['checked_at','not_probe','receipts'],
 'probe readback keys');
select ok(pg_temp.probe('em-probe-1')::text not like '%em-probe-1%' and pg_temp.probe('em-probe-1')::text not like '%msg-p1%',
 'the readback never returns the provider ID or svix-id');
select is(pg_temp.recv('msg-p2-b','email.bounced','em-probe-2',p_bounce=>'permanent'),'recorded','probe: bounced');
select is(pg_temp.recv('msg-p2-b','email.delivered','em-probe-2'),'conflict','probe: a changed payload under the same svix-id');
-- TRACE-155 (7.3D-1 review fixes, 20261129001000): deliberately changed. 20261128001000 returned
-- the content-conflicted receipt marked excluded with not_probe false; D-11 excludes the whole ID.
select is(pg_temp.probe('em-probe-2'), jsonb_build_object('checked_at', now(), 'not_probe', true, 'receipts', '[]'::jsonb),
 'a content-conflicted probe receipt excludes its whole ID: nothing is returned (SQL 126 covers the mixed cases)');
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,
  provider_created_at,provider_email_id,identity_class)
 values ('msg-p3-old', now()-interval '40 days', now()-interval '1 second', 'current','recorded','email.delivered','email.delivered',
   now()-interval '40 days', 'em-probe-3', 'unmatched');
select is(pg_temp.probe('em-probe-3')->'receipts', '[]'::jsonb, 'an expired probe receipt is not shown');
select pg_temp.sent(5, clock_timestamp(), 'em-d1-5');
select is(pg_temp.recv('msg-p4','email.delivered','em-d1-5'),'recorded','an untagged report for a ledger send (id_only)');
select is(pg_temp.probe('em-d1-5'), jsonb_build_object('checked_at', now(), 'not_probe', true, 'receipts', '[]'::jsonb),
 'a ledger send''s ID is not a probe: nothing is returned');
select is(pg_temp.recv('msg-p5','email.delivered','em-probe-5','invalid'),'recorded','a report with invalid mm_* tags');
select is((pg_temp.probe('em-probe-5')->>'not_probe')::boolean, true, 'a tagged ID is not a probe');
select is(pg_temp.probe('em-never'), jsonb_build_object('checked_at', now(), 'not_probe', false, 'receipts', '[]'::jsonb),
 'an ID with no receipts yet reads as no receipts');
select throws_ok(format('select pg_temp.probe(%L)', i), '22023', null, 'a malformed probe ID is refused (null, empty, space, 101 characters, newline: case '||n||')')
  from unnest(array[null, '', 'has space', repeat('a', 101), E'line\nbreak']) with ordinality u(i, n);
select is((select identity_class from private.email_provider_events where svix_id='msg-p1-del'), 'unmatched',
 'reading a probe never rematches or links its receipts');

-- 12. Readback keys -------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.readback()) k),
 array['armed','armed_at','checked_at','history','intervals','retention','retry_horizon_seconds'], 'arming readback keys');
select is((select array_agg(distinct k order by k) from jsonb_array_elements(pg_temp.readback()->'history') h, jsonb_object_keys(h) k),
 array['action','actor','occurred_at','reason','seq'], 'history entry keys');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.readback()->'retention') k),
 array['expired','last_purge','latest_expires_at','oldest_expired_expires_at','purge_duty','retained','retained_linked','retained_unlinked'],
 'retention keys: counts and times only');

-- 13. Read purity ------------------------------------------------------------------------------------------------------
create temp table world_before as select pg_temp.world() as digest;
grant select on world_before to public;
select ok(pg_temp.readback() is not null, 'read: arming readback');
select ok(pg_temp.probe('em-probe-1') is not null, 'read: probe readback');
select ok(pg_temp.op('select to_jsonb(public.email_evidence_probe_authorize())') is not null, 'read: probe authorization');
select ok((select bool_and(pg_temp.ev(n) is not null) from generate_series(1,5) n), 'read: owner-email evidence (restated summary)');
select ok(pg_temp.op('select public.owner_email_evidence_counts()') is not null, 'read: owner-email counts');
select ok(pg_temp.cov(now()) is not null, 'read: coverage');
select is(pg_temp.world(), (select digest from world_before), 'history, arming record, receipts, purge audit and ledger are byte-identical after every read');

-- 14. Definitions ---------------------------------------------------------------------------------------------------------
select is(md5(pg_get_functiondef('private.email_evidence_summary(text[],timestamptz)'::regprocedure)), '8eadddd6f47401258d747248a38ce507',
 'the deliberately restated summary (7.3C-1 definition e3436221f69164c48be9d90f70f3dd6f)');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['public.owner_email_correlation_ref(text,uuid)','public.owner_email_evidence(text,uuid[])',
  'public.owner_email_evidence_counts()','private.email_evidence_fact(text,text)','private.email_evidence_identity_holds(private.email_provider_events)',
  'private.email_evidence_receipt_state(private.email_provider_events)','private.email_evidence_owner_claimed_at(uuid,integer)',
  'private.email_evidence_owner_receipts(uuid)','private.email_evidence_owner_row(uuid)']::regprocedure[]::oid[])),
 '9|eaa066ba34ac15ceb89ecb146ae0cced', 'the other nine 7.3C-1 functions are unchanged (including the trust predicate)');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['private.email_evidence_ledger_claimed_at(text,uuid,integer)','private.email_evidence_ledger_receipts(text,uuid)',
  'private.email_evidence_ledger_row(text,uuid)','private.email_evidence_ledger_counts(text)','private.email_evidence_global_counts()',
  'public.application_email_evidence(uuid[])','public.application_email_evidence_counts()','public.package_draft_email_evidence(uuid[])',
  'public.package_draft_email_evidence_counts()']::regprocedure[]::oid[])),
 '9|dca434bc3178d8044904a19fcb00d240', 'the nine 7.3C-2 functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['private.email_provider_events_guard()','private.email_provider_event_retention(boolean)',
   'private.email_provider_id_candidate(text)','private.email_provider_tag_exists(text,uuid,integer)',
   'public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)',
   'public.email_provider_events_purge(integer)']::regprocedure[]::oid[])),
 '6|57277a24ac11744bde74a0be96cbd79d', 'the six 7.3B receiver functions are unchanged (receipt processing, purge)');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'r0\_%notification%'),
 '10|5f14532aa26ed5400e73e210379aa4f8','the vendor-application ledger functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (('private','package_draft_email_view'),('public','pricing_claim_draft_email'),
   ('public','pricing_record_draft_email'),('public','admin_request_draft_email'))),
 '4|fddc8bb9fc830932a830db9d6db9c811','the price-draft email functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.oid = any(array['private.owner_email_require_kind(text)','private.owner_email_state(text,timestamptz,timestamptz)',
   'private.owner_email_log(uuid,text,uuid,text,text,integer,uuid,text,text,text)','private.owner_email_lock(text,uuid)',
   'private.owner_email_refuse_untracked(text,uuid)','private.owner_email_contact_create()','public.owner_email_claim(text,uuid,text)',
   'public.owner_email_record(text,uuid,uuid,text,text,text)','public.owner_email_request_resend(text,uuid,boolean)',
   'public.owner_email_acknowledge(text,uuid,text,boolean)','public.owner_email_overview(text,boolean,timestamptz,uuid,integer)',
   'public.owner_email_contact_submission(uuid)']::regprocedure[]::oid[])),
 '12|016c0e683cb19c4c68769d87f5215ff1','the 7.2C-1 owner-email functions are unchanged');
select is(md5(pg_get_functiondef('private.owner_email_renewal_create()'::regprocedure)),'b1607618f1af59ca19d9c6e5d0d410f5','the 7.2C-2 renewal trigger function is unchanged');
select is(md5(pg_get_functiondef('public.vendor_submit_renewal_document(text,uuid)'::regprocedure)),'8c8942365d8f9d34bdcd1d839f86c472','vendor_submit_renewal_document is unchanged');
select is((select md5(string_agg(format('%s %s %s %s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull), ',' order by c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','owner_email_notifications','package_draft_email_notices',
    'email_provider_events','email_evidence_config')
    and a.attnum>0 and not a.attisdropped),
 '7a0c78089d11d4d87a1bb3cd9e18124e','the three ledgers, the receipt table and the arming record keep their columns');
-- The promotion money fingerprint (58 functions) is read by scripts/promotion-money-fingerprint.sql
-- on this stack and recorded in the 7.3D-1 record; this migration touches none of them.

select * from finish();
rollback;
