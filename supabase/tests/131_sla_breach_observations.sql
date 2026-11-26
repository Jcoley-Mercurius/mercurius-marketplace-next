-- Phase 7.5F-1 (TRACE-159): SLA-breach observation ledger, detector, readbacks and retention purge.
-- Plan: governance/PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md §6 (groups A, B, T, M, N, Q, P, F, S,
-- E, R, Z). Record: governance/PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md. Multi-session groups (K, U,
-- L, F commit boundary, R lock sharing, REPEATABLE READ refusals) are in
-- scripts/sla-detector-concurrency.mjs.
--
-- Method (7.5C): one transaction, so now() is fixed; every staged time is written relative to it, and
-- "the clock passes" means recorded times moved back as owner in replica mode (append-only guards
-- would refuse a time change; nothing else is altered). Readers are the real queue readers; their
-- source rows are written directly (as SQL 128 does) except the offer-terms items, which go through
-- the real submission, matching and acceptance commands (as SQL 116). Synthetic example.invalid users.
-- Run keys are composed by the test, not by admin_sla_new_run_key, so the detector is shown to treat
-- any key alike. Nothing is committed: the file ends in rollback.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ------------------------------------------------------------------------------------------------
-- Users: 1 admin A, 2 admin B, 3 homeowner, 4 provider P1, 5 provider P2.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('f75f0000-0000-4000-8000-000000000001','p75f-admin-a@example.invalid',now(),'{"full_name":"P75F operator A"}'),
 ('f75f0000-0000-4000-8000-000000000002','p75f-admin-b@example.invalid',now(),'{"full_name":"P75F operator B"}'),
 ('f75f0000-0000-4000-8000-000000000003','p75f-home@example.invalid',now(),'{"full_name":"P75F homeowner"}'),
 ('f75f0000-0000-4000-8000-000000000004','p75f-p1@example.invalid',now(),'{"full_name":"P75F provider one"}'),
 ('f75f0000-0000-4000-8000-000000000005','p75f-p2@example.invalid',now(),'{"full_name":"P75F provider two"}');
delete from public.user_roles where user_id in ('f75f0000-0000-4000-8000-000000000004','f75f0000-0000-4000-8000-000000000005');
insert into public.user_roles(user_id,role) values
 ('f75f0000-0000-4000-8000-000000000001','admin'),('f75f0000-0000-4000-8000-000000000002','admin'),
 ('f75f0000-0000-4000-8000-000000000003','homeowner'),('f75f0000-0000-4000-8000-000000000004','vendor'),
 ('f75f0000-0000-4000-8000-000000000005','vendor')
 on conflict do nothing;
insert into public.money_authorities(user_id,granted_by,reason) values
 ('f75f0000-0000-4000-8000-000000000002','f75f0000-0000-4000-8000-000000000001','Synthetic finance holder');

create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('f75f0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.r(n int) returns uuid language sql immutable as $$ select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.t(n int) returns uuid language sql immutable as $$ select ('f75f6000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- A version-7 run key issued at `issued` (whole milliseconds), distinguished by n.
create function pg_temp.k(issued timestamptz, n int) returns uuid language sql immutable as $$
  select (lpad(to_hex(floor(extract(epoch from issued) * 1000)::bigint), 12, '0') || '7000' || '8' || lpad(to_hex(n), 15, '0'))::uuid $$;
-- Run p_sql as user n (0 = anon) and return its jsonb; claims and role are restored.
create function pg_temp.call(n int, p_sql text) returns jsonb language plpgsql as $$
declare result jsonb; prior text := current_setting('request.jwt.claims', true);
begin
  if n = 0 then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(n))::text, true);
    set local role authenticated;
  end if;
  execute p_sql into result;
  reset role;
  perform set_config('request.jwt.claims', coalesce(prior, ''), true);
  return result;
end $$;
create function pg_temp.err(n int, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.call(n, p_sql);
  return 'ok';
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.owner_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate || ': ' || sqlerrm;
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
create function pg_temp.backdate(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end $$;
-- Runs p_sql (returning jsonb) in a subtransaction that is then rolled back; returns its value.
create function pg_temp.isolated(p_sql text) returns jsonb language plpgsql as $$
declare result jsonb;
begin
  begin
    execute p_sql into result;
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  return result;
end $$;
create function pg_temp.scan(n int, key uuid, lim int default 200) returns jsonb language sql as $$
  select pg_temp.call(n, format('select public.admin_detect_sla_breaches(%L, %s)', key, coalesce(lim::text, 'null'))) $$;
create function pg_temp.scan_err(n int, key uuid, lim int default 200) returns text language sql as $$
  select pg_temp.err(n, format('select public.admin_detect_sla_breaches(%L, %s)', key, coalesce(lim::text, 'null'))) $$;
create function pg_temp.rule(res jsonb, rule text) returns jsonb language sql as $$
  select e from jsonb_array_elements(res->'rules') e where e->>'rule' = rule $$;
-- Observations of one run and rule as "kind subject due_at", sorted.
create function pg_temp.obs(run uuid, rule text) returns text[] language sql as $$
  select coalesce(array_agg(item_kind||' '||subject_id||' '||due_at order by item_kind, subject_id, due_at), '{}')
  from private.operations_sla_observations where run_id = run and rule_id = rule $$;
create function pg_temp.ledger() returns jsonb language sql as $$
  select jsonb_build_object('runs', (select count(*) from private.operations_sla_detector_runs),
    'results', (select count(*) from private.operations_sla_detector_run_results),
    'observations', (select count(*) from private.operations_sla_observations),
    'purges', (select count(*) from private.operations_sla_purges)) $$;
-- The invariant per ok rule: listed = already_recorded + inserted + conflicted + over_limit.
create function pg_temp.invariant(res jsonb) returns boolean language sql as $$
  select bool_and((e->>'listed')::int = (e->>'already_recorded')::int + (e->>'inserted')::int + (e->>'conflicted')::int + (e->>'over_limit')::int)
  from jsonb_array_elements(res->'rules') e where e->>'status' = 'ok' $$;

-- The qualifying set per rule, derived here independently from the readers' own output with the
-- plan §2 predicates (a specification, not the detector's helper), as "kind subject due_at".
create function pg_temp.qualifying(rule text) returns text[] language plpgsql as $$
declare q jsonb; result text[];
begin
  if rule in ('T-3', 'T-4') then
    q := pg_temp.call(1, 'select public.admin_quote_queue()');
    select coalesce(array_agg(x order by x), '{}') into result from (
      select (i->>'kind')||' '||case i->>'kind' when 'proposal_missing' then i->>'request_id' when 'proposal_review' then i#>>'{detail,proposal_id}'
          when 'quote_decision' then i#>>'{detail,quote_id}' else i#>>'{detail,attempt_id}' end||' '||(i->>'due_at')::timestamptz x
      from jsonb_array_elements(q->'items') i
      where (i->>'aged')::boolean and case rule when 'T-3' then i->>'kind' in ('proposal_missing','proposal_review','quote_decision')
        else i->>'kind' = 'payment_failed' end) s;
  elsif rule = 'T-5' then
    select coalesce(array_agg(x order by x), '{}') into result from (
      select 'confirmation_overdue '||(i->>'request_id')||' '||(i->>'since')::timestamptz x
      from jsonb_array_elements(pg_temp.call(1, 'select public.admin_fulfillment_queue()')->'items') i where i->>'kind' = 'confirmation_overdue') s;
  elsif rule = 'T-8' then
    select coalesce(array_agg(x order by x), '{}') into result from (
      select 'first_reply_overdue '||(i->>'ticket_id')||' '||(i->>'response_due_at')::timestamptz x
      from jsonb_array_elements(pg_temp.call(1, 'select public.admin_support_queue(false)')->'items') i where (i->>'overdue')::boolean) s;
  else
    select coalesce(array_agg(x order by x), '{}') into result from (
      select 'unanswered '||(i->>'terms_id')||' '||((i->>'since')::timestamptz + interval '24 hours') x
      from jsonb_array_elements(pg_temp.call(1, 'select public.admin_offer_terms_queue()')->'items') i where i->>'kind' = 'unanswered') s;
  end if;
  return result;
end $$;

-- Business state: row count and content md5 of every public/private table except the 7.5F tables,
-- plus outbound HTTP requests and cron jobs.
create function pg_temp.business_state() returns text language plpgsql as $$
declare t record; acc text := ''; h text; http bigint := 0; jobs bigint := 0;
begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public','private') and c.relkind in ('r','p') and c.relname not like 'operations_sla_%' order by 1, 2 loop
    execute format('select count(*)::text||'':''||coalesce(md5(string_agg(x::text, ''|'' order by x::text)), '''') from %I.%I x', t.nspname, t.relname) into h;
    acc := acc || t.nspname || '.' || t.relname || '=' || h || ';';
  end loop;
  if to_regclass('net.http_request_queue') is not null then execute 'select count(*) from net.http_request_queue' into http; end if;
  if to_regclass('cron.job') is not null then execute 'select count(*) from cron.job' into jobs; end if;
  return md5(acc) || ' http=' || http || ' cron=' || jobs;
end $$;
create function pg_temp.definitions() returns text language sql as $$
  select string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)), ';' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname, p.proname) in (('public','admin_quote_queue'),('public','admin_fulfillment_queue'),('public','admin_support_queue'),
    ('public','admin_offer_terms_queue'),('public','admin_operations_summary'),('public','run_lifecycle_batch'),
    ('private','fulfillment_queue_items'),('private','money_payment_exceptions')) $$;

-- ================================================================================================
-- A  Access refusal: execute only for authenticated, admin checked inside; tables owner only.
create temp table fn(sig text primary key);
insert into fn values ('public.admin_sla_new_run_key()'), ('public.admin_detect_sla_breaches(uuid,integer)'),
 ('public.admin_sla_observations(text,bigint,integer)'), ('public.admin_sla_detector_runs(integer)'), ('public.admin_sla_detector_run(uuid)'),
 ('public.admin_sla_observation_summary(timestamp with time zone,timestamp with time zone)'), ('public.admin_purge_sla_records(integer)');
select is((select array_agg(sig order by sig) from fn where has_function_privilege('authenticated', sig, 'execute')
  and not has_function_privilege('anon', sig, 'execute') and not has_function_privilege('service_role', sig, 'execute')
  and not has_function_privilege('public', sig, 'execute')), (select array_agg(sig order by sig) from fn),
  'A: every client function executes for authenticated only (no anon, service_role or public)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname like 'operations_sla_%'
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'A: private helpers are owner only');
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relname like 'operations_sla_%' and c.relkind = 'r' and c.relrowsecurity
    and not has_table_privilege('authenticated', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'delete')
    and not has_table_privilege('authenticated', c.oid, 'insert') and not has_table_privilege('authenticated', c.oid, 'update')
    and not has_table_privilege('service_role', c.oid, 'select') and not has_table_privilege('anon', c.oid, 'select')),
  array['operations_sla_detector_run_results','operations_sla_detector_runs','operations_sla_observations','operations_sla_purges','operations_sla_retention'],
  'A: the five tables have RLS on and no client privilege');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename like 'operations_sla_%'), 0, 'A: and no policies');
select is((select count(*)::int from pg_publication_tables where tablename like 'operations_sla_%'), 0, 'A: not in any publication (realtime)');
select is(pg_temp.err(3, format('select to_jsonb(%s)', s)), '42501: Only admins can run the SLA detector', format('A: homeowner refused: %s', s))
  from unnest(array['public.admin_sla_new_run_key()', format('public.admin_detect_sla_breaches(%L, 200)', pg_temp.k(now(), 1))]) s;
select is(pg_temp.err(4, format('select to_jsonb(%s)', s)) like '42501: %', true, format('A: provider refused (42501): %s', s))
  from unnest(array['public.admin_sla_new_run_key()', format('public.admin_detect_sla_breaches(%L, 200)', pg_temp.k(now(), 1)),
    'public.admin_sla_observations()', 'public.admin_sla_detector_runs()', format('public.admin_sla_detector_run(%L)', pg_temp.k(now(), 1)),
    'public.admin_sla_observation_summary(now() - interval ''1 day'', now())', 'public.admin_purge_sla_records(1)']) s;
select is(pg_temp.err(3, 'select public.admin_purge_sla_records(1)'), '42501: Only admins can purge SLA records', 'A: homeowner cannot purge');
select is(pg_temp.err(0, format('select public.admin_detect_sla_breaches(%L, 200)', pg_temp.k(now(), 1))) like '42501: permission denied%', true, 'A: anon has no execute');
select is(pg_temp.err(3, 'select to_jsonb(count(*)) from private.operations_sla_observations') like '42501: %', true, 'A: authenticated cannot select the ledger');
select is(pg_temp.err(1, 'select to_jsonb(count(*)) from private.operations_sla_detector_runs') like '42501: %', true, 'A: not even an admin can select a table directly');
select is(pg_temp.err(1, 'with d as (delete from private.operations_sla_observations returning 1) select to_jsonb(count(*)) from d') like '42501: %', true,
  'A: an admin cannot delete from a table directly');
select is((select retention from private.operations_sla_retention), interval '90 days', 'P-2: retention is 90 days, set by the migration');
select ok((select decision_ref like 'P-2,%DEC-2026-069%' from private.operations_sla_retention), 'P-2: the retention row names the decision');

-- ================================================================================================
-- Fixtures. Coverage, one quote/fulfillment provider (P1) and, for T-10, the SQL 116 offer-terms
-- catalog: P1's offering is submitted, P1 pauses, the offer_terms gate opens, P2 is offered at its
-- own terms and accepts, so the request waits for the homeowner's answer.
insert into public.service_categories(id,name) values ('synthetic-75f-cat','Synthetic 7.5F');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-75f-lawn','Synthetic 7.5F lawn','synthetic-75f-cat',60,40,120,'weekly','{one-time,weekly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00131','P75F area',true,false);
insert into private.r0_lee_zips values ('00131');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by) values (pg_temp.u(3),'00131','synthetic-75f-lawn',pg_temp.u(1));
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('f75f1000-0000-4000-8000-000000000001',pg_temp.u(4),'P75F provider one',true,true),
 ('f75f1000-0000-4000-8000-000000000002',pg_temp.u(5),'P75F provider two',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('f75f1000-0000-4000-8000-000000000001','00131'),('f75f1000-0000-4000-8000-000000000002','00131');
insert into public.vendor_packages(id,contractor_id,service_id,name,description,pricing_mode,default_frequency,is_active,needs_review,included_scope,policy_notes) values
 ('f75f4100-0000-4000-8000-000000000001','f75f1000-0000-4000-8000-000000000001','synthetic-75f-lawn','P75F submitted lawn',null,'fixed','weekly',true,false,'{Mowing}',null),
 ('f75f4100-0000-4000-8000-000000000002','f75f1000-0000-4000-8000-000000000002','synthetic-75f-lawn','P75F other lawn','Mow and haul','fixed','one-time',true,false,'{Mowing,Edging}','Synthetic policy notes');
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('f75f4200-0000-4000-8000-000000000001','f75f4100-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('f75f4200-0000-4000-8000-000000000002','f75f4100-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]'),
 ('f75f4200-0000-4000-8000-000000000003','f75f4100-0000-4000-8000-000000000002','Standard',70,'one-time',0,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('f75f4300-0000-4000-8000-000000000001','f75f4100-0000-4000-8000-000000000002','Haul away',10,'exact','visit',1,1,true,'{one-time}',0);

-- T-3 proposal_missing: r1 at due − 1 µs, r2 at due, r3 at due + 1 µs (since = assignment, no acceptance row).
-- T-3 proposal_review: r4..r6 with pending proposals at 4 h − 1 µs, 4 h, 4 h + 1 µs.
-- T-3 quote_decision: r7..r9 with sent quotes at 12 h − 1 µs, 12 h, 12 h + 1 µs.
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,quote_only,assigned_at,quote_status)
 select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001',
   'P75F quote work '||n, n||' Probe St', 'Fort Myers', 'FL', '00131', 'P75F quote', 'matched', 'matched', 'custom_quote', true,
   case n when 1 then now() - interval '24 hours' + interval '1 microsecond' when 2 then now() - interval '24 hours'
     when 3 then now() - interval '24 hours' - interval '1 microsecond' else now() - interval '1 hour' end,
   case when n between 7 and 9 then 'submitted' end
 from generate_series(1,9) n;
insert into public.request_quote_proposals(id,request_id,contractor_id,proposer_id,items,scope,subtotal_cents,based_on_revision,context,status,created_at)
 select ('f75f4000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
   'f75f1000-0000-4000-8000-000000000001', 'f75f0000-0000-4000-8000-000000000004',
   '[{"kind":"labor","description":"Synthetic labor","quantity":1,"unit_cents":20000}]', 'P75F scope', 20000, 0, '{}', 'pending',
   case n when 4 then now() - interval '4 hours' + interval '1 microsecond' when 5 then now() - interval '4 hours' else now() - interval '4 hours' - interval '1 microsecond' end
 from generate_series(4,6) n;
insert into public.request_quotes(id,request_id,amount,reason,revision,sender_id,status,sent_at,expires_at)
 select ('f75f5000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 200, 'P75F quote', 1,
   'f75f0000-0000-4000-8000-000000000001', 'submitted', s, s + interval '24 hours'
 from generate_series(7,9) n, lateral (select case n when 7 then now() - interval '12 hours' + interval '1 microsecond' when 8 then now() - interval '12 hours'
   else now() - interval '12 hours' - interval '1 microsecond' end s) x;
update public.service_requests set current_quote_id = ('f75f5000-0000-4000-8000-'||right(id::text,12))::uuid
 where id in ('f75f2000-0000-4000-8000-000000000007','f75f2000-0000-4000-8000-000000000008','f75f2000-0000-4000-8000-000000000009');
$b$);

-- T-4 payment_failed: r10..r12 expired attempts at 24 h − 1 µs, 24 h, 24 h + 1 µs after expiry (no
-- webhook); r13's attempt expires now, but its checkout_expired webhook arrived 25 h ago, so the
-- webhook is the named source (due 1 h ago).
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode)
 select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001',
   'P75F paid work '||n, n||' Probe St', 'Fort Myers', 'FL', '00131', 'P75F payment', 'scheduled', 'matched', 'fixed'
 from generate_series(10,13) n;
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,current_snapshot_id)
 select ('f75f3000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
   'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001', ('f75f3100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
 from generate_series(10,13) n;
insert into public.money_snapshots(id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,
  source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at,commission_rate_bps)
 select ('f75f3100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('f75f3000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 1, 'P75F-'||n,
   20000,0,0,0,20000,0,0,0,20000,'usd','synthetic','CFG-005','synthetic','f75f0000-0000-4000-8000-000000000001','f75f0000-0000-4000-8000-000000000002',
   'Synthetic', now() + interval '1 day', 1000
 from generate_series(10,13) n;
insert into public.money_checkout_attempts(id,obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at,created_at)
 select ('f75f3200-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, ('f75f3000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
   ('f75f3100-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'full', 20000, 'usd', 'p75f-'||n, 'p75f-k'||n, 'expired',
   e, e - interval '30 minutes'
 from generate_series(10,13) n, lateral (select case n when 10 then now() - interval '24 hours' + interval '1 microsecond' when 11 then now() - interval '24 hours'
   when 12 then now() - interval '24 hours' - interval '1 microsecond' else now() end e) x;
insert into public.money_webhook_events(event_id,event_type,payload,received_at)
 values ('evt_p75f_r13','checkout_expired',jsonb_build_object('attempt_id','f75f3200-0000-4000-8000-000000000013'), now() - interval '25 hours');
$b$);

-- T-5: r14..r16 completion notices at 72 h − 1 µs, 72 h, 72 h + 1 µs. M-7 (first scan): r17 overdue
-- for five days and still qualifying; r18 crossed its 72 h mark five days ago but was confirmed
-- before the first scan (left the queue).
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001',
   'P75F completed work '||n, n||' Probe St', 'Fort Myers', 'FL', '00131', 'P75F completion',
   (case n when 18 then 'homeowner_confirmed' else 'vendor_completed' end)::public.request_status, 'matched', 'fixed', now() - interval '9 days',
   case n when 14 then now() - interval '72 hours' + interval '1 microsecond' when 15 then now() - interval '72 hours'
     when 16 then now() - interval '72 hours' - interval '1 microsecond' else now() - interval '8 days' end
 from generate_series(14,18) n;
$b$);

-- T-8: t1..t3 general tickets due at now + 1 µs, now, now − 1 µs (the reader is strict); P-1: t4 a
-- dispute and t5 a dispute appeal, both overdue; t6 in progress on job r14; t7 resolved (not listed).
select pg_temp.backdate($b$
insert into public.support_tickets(id,user_id,ticket_number,subject,description,issue_type,status,priority,response_due_at,job_id,created_at)
 select ('f75f6000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'P75F-'||n, 'P75F ticket '||n, 'Synthetic question',
   case n when 4 then 'dispute' when 5 then 'dispute_appeal' else 'general' end,
   case n when 6 then 'in-progress' when 7 then 'resolved' else 'open' end, 'standard',
   case n when 1 then now() + interval '1 microsecond' when 2 then now() when 3 then now() - interval '1 microsecond'
     when 4 then now() - interval '2 hours' when 5 then now() - interval '3 hours' when 6 then now() - interval '1 hour' else now() - interval '5 hours' end,
   case n when 6 then 'f75f2000-0000-4000-8000-000000000014'::uuid end, now() - interval '2 days'
 from generate_series(1,7) n;
$b$);

-- T-10: four requests through the real commands; f1..f3 accepted at 24 h − 1 µs, 24 h, 24 h + 1 µs
-- before now; f4 accepted now (used by M-3).
create temp table fx(key text primary key, id uuid);
create function pg_temp.fx(k text) returns uuid language sql as $$ select id from fx where key = k $$;
insert into fx select 'f'||n, (pg_temp.call(3, format('select public.submit_service_requests(%L,%L::jsonb)', 'p75f-f'||n||'-0000000001', jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00131'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_build_object(
      'service_id','synthetic-75f-lawn','frequency','one-time','package_id','f75f4100-0000-4000-8000-000000000001',
      'tier_id','f75f4200-0000-4000-8000-000000000002','expected',jsonb_build_object('pricing_mode','fixed','total',60))))))#>>'{requests,0,request_id}')::uuid
  from generate_series(1,4) n;
select pg_temp.call(4, format('select to_jsonb(public.vendor_set_package_active(%L,false,%L))', 'f75f4100-0000-4000-8000-000000000001',
  (select updated_at from public.vendor_packages where id = 'f75f4100-0000-4000-8000-000000000001')));
update private.money_feature_gates set enabled = true, reason = 'Synthetic 7.5F' where name = 'offer_terms';
select private.offer_next_for_request_internal(pg_temp.fx('f'||n)) from generate_series(1,4) n;
select pg_temp.call(5, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.fx('f'||n))) from generate_series(1,4) n;
insert into fx select 't'||n, t.id from generate_series(1,4) n
  join public.job_offer_terms t on t.request_id = pg_temp.fx('f'||n);
select is((select array_agg(status::text||'/'||matching_status order by key) from fx join public.service_requests r on r.id = fx.id where key like 'f%'),
  array['matched/awaiting_terms','matched/awaiting_terms','matched/awaiting_terms','matched/awaiting_terms'],
  'T-10 setup: four requests wait for the homeowner''s answer to P2''s terms (real commands)');
select pg_temp.backdate(format($b$update public.job_match_attempts a set accepted_at = %s from public.job_offer_terms t where t.offer_id = a.id and t.id = %L$b$,
  case n when 1 then 'now() - interval ''24 hours'' + interval ''1 microsecond''' when 2 then 'now() - interval ''24 hours'''
    else 'now() - interval ''24 hours'' - interval ''1 microsecond''' end, pg_temp.fx('t'||n)))
  from generate_series(1,3) n;

-- ================================================================================================
-- B  First scan (K1 by admin A) on an empty ledger, with Z around it.
select is((select count(*)::int from private.operations_sla_observations), 0, 'B setup: the ledger starts empty');
select set_config('t.z_before', pg_temp.business_state(), true);
select set_config('t.defs', pg_temp.definitions(), true);
create temp table res(label text primary key, v jsonb);
insert into res values ('k1', pg_temp.scan(1, pg_temp.k(now(), 1), 200));
select is(pg_temp.business_state(), current_setting('t.z_before'), 'Z: a scan changes no business table, HTTP request or cron job');
select is(pg_temp.definitions(), current_setting('t.defs'), 'Z: reader, summary and batch definitions unchanged');

select is((select v->>'outcome' from res where label = 'k1'), 'complete', 'B: the first scan completes');
select is((select v->>'replayed' from res where label = 'k1'), 'false', 'B: it is not a replay');
select ok((select pg_temp.invariant(v) from res where label = 'k1'), 'B: listed = already_recorded + inserted + conflicted + over_limit for every rule');
select is(pg_temp.obs(pg_temp.k(now(), 1), r), pg_temp.qualifying(r), format('B parity: %s observations equal the reader''s qualifying set', r))
  from unnest(array['T-3','T-4','T-5','T-8','T-10']) r;
select is(pg_temp.obs(pg_temp.k(now(), 1), 'T-3'), (select array_agg(x order by x) from unnest(array[
    'proposal_missing '||pg_temp.r(2)||' '||now(), 'proposal_missing '||pg_temp.r(3)||' '||(now() - interval '1 microsecond'),
    'proposal_review f75f4000-0000-4000-8000-000000000005 '||now(), 'proposal_review f75f4000-0000-4000-8000-000000000006 '||(now() - interval '1 microsecond'),
    'quote_decision f75f5000-0000-4000-8000-000000000008 '||now(), 'quote_decision f75f5000-0000-4000-8000-000000000009 '||(now() - interval '1 microsecond')]) x),
  'B T-3: listed at due and due + 1 µs, not at due − 1 µs; subjects request, proposal, quote; due = since + 24 h / created + 4 h / sent + 12 h');
select is(pg_temp.obs(pg_temp.k(now(), 1), 'T-4'), (select array_agg(x order by x) from unnest(array[
    'payment_failed f75f3200-0000-4000-8000-000000000011 '||now(), 'payment_failed f75f3200-0000-4000-8000-000000000012 '||(now() - interval '1 microsecond'),
    'payment_failed f75f3200-0000-4000-8000-000000000013 '||(now() - interval '1 hour')]) x),
  'B T-4: subject the attempt; due = expiry + 24 h, or the first checkout_expired webhook + 24 h when there is one (r13)');
select is(pg_temp.obs(pg_temp.k(now(), 1), 'T-5'), (select array_agg(x order by x) from unnest(array[
    'confirmation_overdue '||pg_temp.r(15)||' '||now(), 'confirmation_overdue '||pg_temp.r(16)||' '||(now() - interval '1 microsecond'),
    'confirmation_overdue '||pg_temp.r(17)||' '||(now() - interval '5 days')]) x),
  'B T-5: due = notice + 72 h; at 72 h and after, not before');
select is(pg_temp.obs(pg_temp.k(now(), 1), 'T-8'), (select array_agg(x order by x) from unnest(array[
    'first_reply_overdue '||pg_temp.t(3)||' '||(now() - interval '1 microsecond'), 'first_reply_overdue '||pg_temp.t(4)||' '||(now() - interval '2 hours'),
    'first_reply_overdue '||pg_temp.t(5)||' '||(now() - interval '3 hours'), 'first_reply_overdue '||pg_temp.t(6)||' '||(now() - interval '1 hour')]) x),
  'B T-8: strict: not at due, first at due + 1 µs; due = response_due_at; resolved tickets excluded');
select is((select array_agg(subject_kind||'/'||coalesce(request_id::text,'-') order by subject_id) from private.operations_sla_observations where rule_id = 'T-8'),
  array['general/-','dispute/-','dispute_appeal/-','general/'||pg_temp.r(14)], 'P-1: disputes and dispute appeals recorded once under T-8, labelled by ticket kind; request = the ticket''s job');
select is((select count(*)::int from private.operations_sla_observations where rule_id not in ('T-3','T-4','T-5','T-8','T-10')), 0, 'P-1: no T-9 or other rule exists');
select is(pg_temp.obs(pg_temp.k(now(), 1), 'T-10'), (select array_agg(x order by x) from unnest(array[
    'unanswered '||pg_temp.fx('t2')||' '||now(), 'unanswered '||pg_temp.fx('t3')||' '||(now() - interval '1 microsecond')]) x),
  'B T-10: due = acceptance + 24 h (D-2 parity); at due and after, not before');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.r(18)), 0,
  'M-7: an episode that crossed due and left the queue before the first scan is not recorded (no backfill, P-5)');
select is((select extract(epoch from observed_at - due_at) > 5 * 86400 from private.operations_sla_observations where subject_id = pg_temp.r(17)), true,
  'M-7: a still-qualifying episode overdue since before the first scan is observed by it, lag = observed_at − due_at (> 5 days)');
select is((select array_agg(distinct (evaluated_at = now())::text) from private.operations_sla_observations), array['true'], 'T: evaluated_at is transaction now() on every row');
select is((select count(*)::int from private.operations_sla_observations o where not (o.due_at <= o.evaluated_at and o.evaluated_at <= o.observed_at)
  or (o.rule_id = 'T-8' and o.due_at >= o.evaluated_at)), 0, 'T: due_at <= evaluated_at <= observed_at (T-8 strict) on every row');
select is((select array_agg((pg_temp.rule(v, r)->>'observed_at')::timestamptz > now() order by o) from res, unnest(array['T-3','T-4','T-5','T-8','T-10']) with ordinality u(r, o) where label = 'k1'),
  array[true,true,true,true,true], 'T: each rule''s observed_at is later than evaluated_at');
select ok((select bool_and(a < b) from (select (pg_temp.rule(v, r)->>'observed_at')::timestamptz a,
    lead((pg_temp.rule(v, r)->>'observed_at')::timestamptz) over (order by o) b from res, unnest(array['T-3','T-4','T-5','T-8','T-10']) with ordinality u(r, o) where label = 'k1') s where b is not null),
  'T: observed_at differs between rules read in order (strictly increasing)');
select is((select array_agg(distinct (o.observed_at = (pg_temp.rule(v, o.rule_id)->>'observed_at')::timestamptz)::text) from private.operations_sla_observations o, res where label = 'k1'),
  array['true'], 'T: each row carries its rule''s observed_at');
select is((select (v->'totals'->>'inserted')::int from res where label = 'k1'), (select count(*)::int from private.operations_sla_observations where run_id = pg_temp.k(now(), 1)),
  'S: totals.inserted equals the rows written under the run');
select is((select (v->'totals'->>'listed')::int from res where label = 'k1'),
  (select sum((e->>'listed')::int)::int from res, jsonb_array_elements(v->'rules') e where label = 'k1'), 'S: totals are the sum of the rules');
select is((select count(*)::int from private.operations_sla_detector_run_results where run_id = pg_temp.k(now(), 1)), 1, 'F: the run has exactly one result');

-- ================================================================================================
-- N  Normalization and replay, same key and actor; Q refusals before any write.
select is(pg_temp.scan(1, pg_temp.k(now(), 1), 200) - 'replayed', (select v - 'replayed' from res where label = 'k1'), 'N: null and 200 are the same limit: the stored result replays');
select is(pg_temp.scan(1, pg_temp.k(now(), 1), 200)->>'replayed', 'true', 'N: marked replayed');
select is(pg_temp.scan_err(1, pg_temp.k(now(), 1), 100), '22023: Run key reused with different parameters', 'N: 100 vs 200 refused');
select is(pg_temp.scan_err(2, pg_temp.k(now(), 1), 200), '22023: Run key reused by another operator', 'N: another admin with the same key refused');
select set_config('t.ledger', pg_temp.ledger()::text, true);
select is(pg_temp.scan(1, pg_temp.k(now(), 2), 0)->>'applied_limit', '1', 'N: 0 is normalized to 1');
select is(pg_temp.scan(1, pg_temp.k(now(), 2), 1)->>'replayed', 'true', 'N: 0 then 1 replays');
select is(pg_temp.scan(1, pg_temp.k(now(), 3), 999)->>'applied_limit', '500', 'N: 999 is normalized to 500');
select is(pg_temp.scan(1, pg_temp.k(now(), 3), 500)->>'replayed', 'true', 'N: 999 then 500 replays');
select is(pg_temp.ledger(), (current_setting('t.ledger')::jsonb || jsonb_build_object('runs', (current_setting('t.ledger')::jsonb->>'runs')::int + 2,
  'results', (current_setting('t.ledger')::jsonb->>'results')::int + 2)), 'N: two new keys, two runs; the replays and refusals wrote nothing');
select set_config('t.ledger', pg_temp.ledger()::text, true);
select is(pg_temp.err(3, format('select public.admin_detect_sla_breaches(%L, 200)', pg_temp.k(now(), 9))), '42501: Only admins can run the SLA detector',
  'Q: a valid fresh key from a non-admin is refused (the timestamp grants nothing)');
select is(pg_temp.scan_err(1, gen_random_uuid(), 200), '22023: A version-7 run key is required', 'Q: a version-4 key is refused');
select is(pg_temp.scan_err(1, null, 200), '22023: A version-7 run key is required', 'Q: a null key is refused');
select is(pg_temp.scan_err(1, (overlay(pg_temp.k(now(), 9)::text placing '0' from 20 for 1))::uuid, 200), '22023: A version-7 run key is required', 'Q: a version-7 key with the wrong variant is refused');
select is(pg_temp.scan_err(1, pg_temp.k(clock_timestamp() + interval '6 minutes', 9), 200), '22023: Run key is issued in the future', 'Q: a key issued more than 5 minutes ahead is refused');
select is(pg_temp.scan(1, pg_temp.k(clock_timestamp() + interval '4 minutes', 9), 200)->>'outcome', 'complete', 'Q: a key up to 5 minutes ahead is accepted');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '25 hours', 9), 200), '22023: Run key is too old to start a scan', 'Q: an absent key issued more than 24 h ago is refused');
select is(pg_temp.scan(1, pg_temp.k(now() - interval '23 hours', 9), 200)->>'outcome', 'complete', 'Q: an absent key issued within 24 h scans');
select is(pg_temp.ledger(), (current_setting('t.ledger')::jsonb || jsonb_build_object('runs', (current_setting('t.ledger')::jsonb->>'runs')::int + 2,
  'results', (current_setting('t.ledger')::jsonb->>'results')::int + 2)), 'Q: refusals wrote nothing; the two accepted keys wrote one run each');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 77)))->>'state', 'not_visible',
  'U: lookup of an absent key: not_visible (no committed result is visible; never "failed")');
select is((pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 77)))->>'retry_until')::timestamptz,
  timestamptz 'epoch' + floor(extract(epoch from now()) * 1000) * interval '1 millisecond' + interval '24 hours', 'U: retry_until = the key''s issue time + 24 h');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 1)))->>'state', 'visible', 'U: lookup of a committed run: visible');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 1)))->'run', (select v - 'replayed' - 'state' from res where label = 'k1'),
  'U: lookup returns the stored run');

-- ================================================================================================
-- P  Progress under the cap (F-3), on T-5. p0 (due 10 h ago) is recorded first, alone; then three
-- new episodes p1 < p2 < p3 (due 3 h, 2 h, 1 h ago) that sort after it. With limit 1 the runs
-- insert p1, p2, p3 in turn, then nothing; p0 never consumes the cap.
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001',
   'P75F progress '||n, n||' Probe St', 'Fort Myers', 'FL', '00131', 'P75F progress', 'vendor_completed', 'matched', 'fixed', now() - interval '9 days',
   now() - interval '72 hours' - interval '10 hours'
 from generate_series(20,20) n;
$b$);
insert into res values ('p0', pg_temp.scan(1, pg_temp.k(now(), 20), 1));
select is(pg_temp.obs(pg_temp.k(now(), 20), 'T-5'), array['confirmation_overdue '||pg_temp.r(20)||' '||(now() - interval '10 hours')], 'P: p0 recorded alone');
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 select ('f75f2000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'f75f0000-0000-4000-8000-000000000003', 'f75f1000-0000-4000-8000-000000000001',
   'P75F progress '||n, n||' Probe St', 'Fort Myers', 'FL', '00131', 'P75F progress', 'vendor_completed', 'matched', 'fixed', now() - interval '9 days',
   now() - interval '72 hours' - (24 - n) * interval '1 hour'
 from generate_series(21,23) n;
$b$);
select set_config('t.t5_recorded', (select count(*) from private.operations_sla_observations where rule_id = 'T-5')::text, true);
insert into res select 'p'||n, pg_temp.scan(1, pg_temp.k(now(), 20 + n), 1) from generate_series(1,4) n;
select is((select array_agg(coalesce((select subject_id::text from private.operations_sla_observations where run_id = pg_temp.k(now(), 20 + n) and rule_id = 'T-5'), 'none') order by n)
  from generate_series(1,4) n), array[pg_temp.r(21)::text, pg_temp.r(22)::text, pg_temp.r(23)::text, 'none'], 'P: limit 1 inserts p1, p2, p3 in turn (oldest due first), then nothing');
select is((select array_agg((pg_temp.rule(v, 'T-5')->>'already_recorded')::int - current_setting('t.t5_recorded')::int order by label) from res where label in ('p1','p2','p3','p4')),
  array[0,1,2,3], 'P: already_recorded grows 0, 1, 2, 3 (beyond the episodes recorded before)');
select is((select array_agg((pg_temp.rule(v, 'T-5')->>'over_limit')::int order by label) from res where label in ('p1','p2','p3','p4')), array[2,1,0,0], 'P: over_limit 2, 1, 0, 0');
select ok((select bool_and(pg_temp.invariant(v)) from res), 'P: the invariant holds on every run and rule');

-- ================================================================================================
-- F  Constraints and the commit boundary (the cross-session half is in the script).
select is((select count(*)::int from pg_constraint where conrelid in ('private.operations_sla_detector_runs'::regclass, 'private.operations_sla_observations'::regclass,
  'private.operations_sla_detector_run_results'::regclass, 'private.operations_sla_retention'::regclass, 'private.operations_sla_purges'::regclass) and (condeferrable or condeferred)),
  0, 'F: no 7.5F constraint is deferrable');
select is((select array_agg(confrelid::regclass::text order by conrelid::regclass::text) from pg_constraint where contype = 'f'
  and conrelid in ('private.operations_sla_observations'::regclass, 'private.operations_sla_detector_run_results'::regclass)),
  array['private.operations_sla_detector_runs','private.operations_sla_detector_runs'], 'F: observations and results reference the run start');
select lives_ok('set constraints all immediate', 'F: after the scans, set constraints all immediate succeeds');
select is((select count(*)::int from private.operations_sla_detector_runs r where not exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = r.id)),
  0, 'F: every run start has its result');
select is((select count(*)::int from private.operations_sla_observations o join private.operations_sla_detector_runs r on r.id = o.run_id where o.evaluated_at <> r.evaluated_at),
  0, 'F: each observation copies its run''s evaluated_at');

-- ================================================================================================
-- S  Partial and failed runs; summary consistency.
-- A new T-3 and T-5 episode each; an insert trigger makes T-5 raise inside the test transaction.
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,quote_only,assigned_at)
 values ('f75f2000-0000-4000-8000-000000000030','f75f0000-0000-4000-8000-000000000003','f75f1000-0000-4000-8000-000000000001','P75F partial quote','30 Probe St','Fort Myers','FL','00131',
   'P75F partial','matched','matched','custom_quote',true,now() - interval '30 hours');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 values ('f75f2000-0000-4000-8000-000000000031','f75f0000-0000-4000-8000-000000000003','f75f1000-0000-4000-8000-000000000001','P75F partial completion','31 Probe St','Fort Myers','FL','00131',
   'P75F partial','vendor_completed','matched','fixed',now() - interval '9 days',now() - interval '80 hours');
$b$);
create function public.p75f_synthetic_failure() returns trigger language plpgsql as $$
begin raise exception 'synthetic rule failure' using errcode = 'P0001'; end $$;
create trigger p75f_synthetic_failure before insert on private.operations_sla_observations for each row when (new.rule_id = 'T-5')
  execute function public.p75f_synthetic_failure();
insert into res values ('s1', pg_temp.scan(1, pg_temp.k(now(), 30), 200));
drop trigger p75f_synthetic_failure on private.operations_sla_observations;
select is((select v->>'outcome' from res where label = 's1'), 'partial', 'S: one rule raising makes the run partial');
select is((select pg_temp.rule(v, 'T-5') - 'observed_at' from res where label = 's1'),
  '{"rule":"T-5","status":"error","sqlstate":"P0001","listed":null,"already_recorded":null,"inserted":null,"conflicted":null,"over_limit":null}'::jsonb,
  'S: the failed rule records its SQLSTATE only (no message), and no counts');
select is((select rules::text like '%synthetic rule failure%' from private.operations_sla_detector_run_results where run_id = pg_temp.k(now(), 30)), false, 'S: the stored result holds no error message');
select is(pg_temp.obs(pg_temp.k(now(), 30), 'T-5'), '{}'::text[], 'S: the failed rule''s inserts rolled back to its savepoint');
select is(pg_temp.obs(pg_temp.k(now(), 30), 'T-3'), array['proposal_missing '||pg_temp.r(30)||' '||(now() - interval '6 hours')], 'S: the other rules still recorded');
select is((select array_agg(pg_temp.rule(v, r)->>'status' order by o) from res, unnest(array['T-3','T-4','T-5','T-8','T-10']) with ordinality u(r,o) where label = 's1'),
  array['ok','ok','error','ok','ok'], 'S: per-rule statuses');
select is((select (v->'totals'->>'inserted')::int from res where label = 's1'), 1, 'S: totals count ok rules only');
-- Every rule raising: the helper is replaced inside a subtransaction that is then rolled back.
create function pg_temp.s2(key uuid) returns jsonb language plpgsql as $f$
begin
  execute $d$create or replace function private.operations_sla_rule_items(p_rule text) returns jsonb language plpgsql volatile set search_path = '' as $b$
    begin raise exception 'synthetic reader failure' using errcode = 'XX001'; end $b$$d$;
  return pg_temp.scan(1, key, 200);
end $f$;
select set_config('t.helper', md5(pg_get_functiondef('private.operations_sla_rule_items(text)'::regprocedure)), true);
insert into res values ('s2', pg_temp.isolated(format($s$select pg_temp.s2(%L)$s$, pg_temp.k(now(), 31))));
select is((select v->>'outcome' from res where label = 's2'), 'failed', 'S: every rule raising makes the run failed');
select is((select array_agg(distinct e->>'sqlstate') from res, jsonb_array_elements(v->'rules') e where label = 's2'), array['XX001'], 'S: each failed rule stores the SQLSTATE');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 31)))->>'state', 'not_visible', 'S: (the failed run was rolled back with its subtransaction)');
select is(md5(pg_get_functiondef('private.operations_sla_rule_items(text)'::regprocedure)), current_setting('t.helper'), 'S: the helper is restored after the rollback');
-- Summary = unexpired ledger.
insert into res values ('sum', pg_temp.call(1, 'select public.admin_sla_observation_summary(now() - interval ''1 day'', now() + interval ''1 day'')'));
select is((select jsonb_object_agg(e->>'rule', (e->>'observations')::int) from res, jsonb_array_elements(v->'rules') e where label = 'sum'),
  (select jsonb_object_agg(r, (select count(*) from private.operations_sla_observations o where o.rule_id = r)) from unnest(array['T-3','T-4','T-5','T-8','T-10']) r),
  'S: summary observation counts equal the ledger per rule');
select is((select (v->'runs'->>'total')::int from res where label = 'sum'), (select count(*)::int from private.operations_sla_detector_runs), 'S: summary run count equals the ledger');
select is((select (v->'runs'->>'partial')::int from res where label = 'sum'), 1, 'S: summary counts the partial run');
select is((select (e->'run_status'->>'error')::int from res, jsonb_array_elements(v->'rules') e where label = 'sum' and e->>'rule' = 'T-5'), 1, 'S: and the T-5 error under rule status');
select is((select (e->>'max_lag_seconds')::numeric from res, jsonb_array_elements(v->'rules') e where label = 'sum' and e->>'rule' = 'T-5'),
  (select extract(epoch from max(observed_at - due_at)) from private.operations_sla_observations where rule_id = 'T-5'), 'S: max lag is observed_at − due_at');
select ok((select not (v ? 'coverage') and not (v ? 'completeness') and not (v ? 'miss_rate') and not (v::text ~* 'coverage|complete_coverage|miss_rate|all breaches|no breaches missed|guarantee')
  and v->>'statement' like 'Counts are a lower bound%' and v->>'statement' like '%do not bound, estimate or count missed breaches.' from res where label = 'sum'),
  'T: the summary has no coverage, completeness or miss-rate field, and states the lower bound and descriptive intervals');
select is((select array_agg(k order by k) from res, jsonb_each(v->'rules'->0) x(k, y) where label = 'sum'),
  array['descriptive_largest_interval_seconds','first_completed_at','last_completed_at','max_lag_seconds','min_lag_seconds','observations','rule','run_status'],
  'T: per-rule summary fields are exactly these');
select is(pg_temp.err(1, 'select public.admin_sla_observation_summary(now(), now())'), '22023: A window with from before to is required', 'S: an empty window is refused');
select is(pg_temp.err(1, 'select public.admin_sla_observations(''T-9'')'), '22023: Unknown SLA rule', 'S: an unknown rule is refused');
-- Observations readback: newest first, keyset, lag.
select is((select array_agg((i->>'id')::bigint) from jsonb_array_elements(pg_temp.call(1, 'select public.admin_sla_observations(null, null, 3)')->'items') i),
  (select array_agg(id order by id desc) from (select id from private.operations_sla_observations order by id desc limit 3) s), 'S: observations newest first, limit honoured');
select is((pg_temp.call(1, 'select public.admin_sla_observations(null, null, 3)')->>'next_before_id')::bigint,
  (select min(id) from (select id from private.operations_sla_observations order by id desc limit 3) s), 'S: next_before_id is the last id of a full page');
select is((select array_agg(distinct i->>'rule') from jsonb_array_elements(pg_temp.call(1, 'select public.admin_sla_observations(''T-8'', null, 200)')->'items') i), array['T-8'], 'S: rule filter');
select is((select (i->>'lag_seconds')::numeric from jsonb_array_elements(pg_temp.call(1, 'select public.admin_sla_observations(''T-5'', null, 200)')->'items') i where (i->>'subject_id')::uuid = pg_temp.r(17)),
  (select extract(epoch from observed_at - due_at) from private.operations_sla_observations where subject_id = pg_temp.r(17)), 'S: lag_seconds = observed_at − due_at');
select is((select (pg_temp.call(1, 'select public.admin_sla_detector_runs(100)')->'items'->0->>'actor_name')), 'P75F operator A', 'S: runs readback names the actor');

-- ================================================================================================
-- E  Separation from the lifecycle worker's completion escalation (DEC-2026-006): r40 is a T-5 job
-- at 72 h. Path A: batch, then scan. Path B: scan, then batch. Each in a rolled-back subtransaction.
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at,confirmation_deadline_at,photo_proof_urls)
 values ('f75f2000-0000-4000-8000-000000000040','f75f0000-0000-4000-8000-000000000003','f75f1000-0000-4000-8000-000000000001','P75F escalation','40 Probe St','Fort Myers','FL','00131',
   'P75F escalation','vendor_completed','matched','fixed',now() - interval '4 days',now() - interval '72 hours',now(),array['synthetic-proof']);
$b$);
create function pg_temp.e_state() returns jsonb language sql as $$
  select jsonb_build_object('flag', (select needs_admin_review from public.service_requests where id = pg_temp.r(40)),
    'events', (select jsonb_agg(event_type||':'||coalesce(metadata->>'reason','') order by event_type) from public.job_events where job_id = pg_temp.r(40)),
    'notifications', (select jsonb_agg(title order by title, user_id) from public.notifications where related_request_id = pg_temp.r(40)),
    'runs', (select count(*) from public.lifecycle_worker_runs)) $$;
create function pg_temp.e_path(scan_first boolean) returns jsonb language plpgsql as $$
declare batch jsonb; scan jsonb;
begin
  if scan_first then scan := pg_temp.scan(1, pg_temp.k(now(), 41), 200); end if;
  batch := pg_temp.svc('select public.run_lifecycle_batch(''f75f9000-0000-4000-8000-000000000001'')') - 'ran_at' - 'run_id';
  if not scan_first then scan := pg_temp.scan(1, pg_temp.k(now(), 41), 200); end if;
  return jsonb_build_object('batch', batch, 'state', pg_temp.e_state(),
    'observed', (select count(*) from private.operations_sla_observations where subject_id = pg_temp.r(40) and rule_id = 'T-5'));
end $$;
insert into res values ('e_batch_first', pg_temp.isolated('select pg_temp.e_path(false)')), ('e_scan_first', pg_temp.isolated('select pg_temp.e_path(true)'));
select is((select v->'batch' from res where label = 'e_scan_first'), (select v->'batch' from res where label = 'e_batch_first'), 'E: the batch output is identical with and without a prior scan');
select is((select v->'state' from res where label = 'e_scan_first'), (select v->'state' from res where label = 'e_batch_first'), 'E: flag, events, notices and run records identical');
select is((select array_agg(v->'state'->>'flag' order by label) from res where label like 'e_%'), array['true','true'], 'E: the batch escalates r40 (DEC-2026-006) whether or not a scan ran first');
select is((select array_agg((v->>'observed')::int order by label) from res where label like 'e_%'), array[1,1], 'E: T-5 is observed whether the batch ran before or after');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.r(40)), 0, 'E: (both paths rolled back)');

-- ================================================================================================
-- M  Missed between scans. M-1: r50 is scanned before due (not listed); the clock passes due and the
-- homeowner confirms before the next scan: never recorded. M-3: f4's terms age past 24 h and become
-- not_acceptable (P2 deactivated) before a scan: never recorded.
select pg_temp.backdate($b$
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 values ('f75f2000-0000-4000-8000-000000000050','f75f0000-0000-4000-8000-000000000003','f75f1000-0000-4000-8000-000000000001','P75F missed','50 Probe St','Fort Myers','FL','00131',
   'P75F missed','vendor_completed','matched','fixed',now() - interval '4 days',now() - interval '71 hours');
$b$);
select is(pg_temp.scan(1, pg_temp.k(now(), 50), 200)->>'outcome', 'complete', 'M-1 setup: a scan before due');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.r(50)), 0, 'M-1: not listed before due');
select pg_temp.backdate($b$update public.service_requests set confirmation_sent_at = now() - interval '73 hours', status = 'homeowner_confirmed'
  where id = 'f75f2000-0000-4000-8000-000000000050'$b$);
select is(pg_temp.scan(1, pg_temp.k(now(), 51), 200)->>'outcome', 'complete', 'M-1: scan after the source resolved');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.r(50)), 0, 'M-1: crossed due and left the queue between scans: no observation, ever');
select pg_temp.backdate(format($b$update public.job_match_attempts a set accepted_at = now() - interval '25 hours' from public.job_offer_terms t where t.offer_id = a.id and t.id = %L$b$, pg_temp.fx('t4')));
update public.contractors set is_active = false where id = 'f75f1000-0000-4000-8000-000000000002';
select is((select i->>'kind' from jsonb_array_elements(pg_temp.call(1, 'select public.admin_offer_terms_queue()')->'items') i where (i->>'terms_id')::uuid = pg_temp.fx('t4')),
  'not_acceptable', 'M-3 setup: f4 is reclassified to not_acceptable');
select is(pg_temp.scan(1, pg_temp.k(now(), 52), 200)->>'outcome', 'complete', 'M-3: scan');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.fx('t4')), 0, 'M-3: reclassified before a scan: never recorded');
update public.contractors set is_active = true where id = 'f75f1000-0000-4000-8000-000000000002';

-- ================================================================================================
-- R  Retention (F-6, F-8) and Q key lifetime after expiry and purge (F-9).
select set_config('t.ledger', pg_temp.ledger()::text, true);
-- Undecided retention: nothing expires, the purge refuses and writes nothing.
update private.operations_sla_retention set retention = null;
select pg_temp.backdate($b$update private.operations_sla_observations set due_at = due_at - interval '1000 days', evaluated_at = evaluated_at - interval '1000 days',
  observed_at = observed_at - interval '1000 days' where subject_id = 'f75f2000-0000-4000-8000-000000000017'$b$);
select is(pg_temp.err(1, 'select public.admin_purge_sla_records(10)'), '55000: SLA record retention is not decided; nothing can be purged', 'R: retention null: the purge refuses (55000)');
select is(pg_temp.ledger(), current_setting('t.ledger')::jsonb, 'R: and writes nothing (no purge-log row)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.call(1, 'select public.admin_sla_observations(''T-5'', null, 200)')->'items') i where (i->>'subject_id')::uuid = pg_temp.r(17)),
  1, 'R: retention null: a 1,000-day-old observation is still visible (nothing expires)');
select pg_temp.backdate($b$update private.operations_sla_observations set due_at = due_at + interval '1000 days', evaluated_at = evaluated_at + interval '1000 days',
  observed_at = observed_at + interval '1000 days' where subject_id = 'f75f2000-0000-4000-8000-000000000017'$b$);
select is(pg_temp.owner_err('update private.operations_sla_retention set retention = interval ''7 days'' - interval ''1 second'''),
  '23514: new row for relation "operations_sla_retention" violates check constraint "operations_sla_retention_retention_check"', 'R: retention below the 7-day floor is refused');
update private.operations_sla_retention set retention = interval '90 days';

-- The append-only guard (one purge-log row first, so every table has a row).
select is(pg_temp.call(1, 'select public.admin_purge_sla_records(1)')->>'outcome', 'complete', 'R: a purge with nothing expired completes');
select is(pg_temp.owner_err(format('update %s set %s', t, c)), '55000: SLA observation records are append-only', format('R: UPDATE refused on %s', t))
  from (values ('private.operations_sla_detector_runs', 'rule_set = rule_set'), ('private.operations_sla_observations', 'queue = queue'),
    ('private.operations_sla_detector_run_results', 'outcome = outcome'), ('private.operations_sla_purges', 'outcome = outcome')) x(t, c);
select is(pg_temp.owner_err(format('delete from %s', t)), '55000: SLA observation records are deleted only by the retention purge', format('R: DELETE refused outside the purge on %s', t))
  from unnest(array['private.operations_sla_observations', 'private.operations_sla_detector_run_results', 'private.operations_sla_purges']) t;
select is(pg_temp.owner_err($s$do $d$ begin perform set_config('private.operations_sla_purge', pg_current_xact_id()::text, true);
  delete from private.operations_sla_observations; end $d$$s$), '55000: An unexpired SLA observation record cannot be deleted', 'R: even with the purge setting, an unexpired observation cannot be deleted');
select is(pg_temp.owner_err($s$do $d$ begin perform set_config('private.operations_sla_purge', pg_current_xact_id()::text, true);
  delete from private.operations_sla_purges; end $d$$s$), '55000: An unexpired SLA observation record cannot be deleted', 'R: nor an unexpired purge-log row');
select is(pg_temp.owner_err($s$do $d$ begin perform set_config('private.operations_sla_purge', pg_current_xact_id()::text, true);
  delete from private.operations_sla_detector_runs; end $d$$s$), '55000: A run is deleted only after its result', 'R: nor a run start before its result');
select is(pg_temp.owner_err($s$do $d$ begin perform set_config('private.operations_sla_purge', '1', true);
  delete from private.operations_sla_observations; end $d$$s$), '55000: SLA observation records are deleted only by the retention purge', 'R: a setting naming another transaction does not count');

-- Q: run keys whose runs are inserted backdated by the test as owner (actor A, limit 200).
create function pg_temp.old_run(key uuid, at timestamptz) returns void language sql as $$
  insert into private.operations_sla_detector_runs(id,actor,applied_limit,rule_set,evaluated_at,started_at) values (key, pg_temp.u(1), 200, 'synthetic', at, at);
  insert into private.operations_sla_detector_run_results(run_id,outcome,rules,finished_at) values (key, 'complete', '[]', at) $$;
select pg_temp.old_run(pg_temp.k(now() - interval '30 days', 60), now() - interval '30 days');
select is(pg_temp.scan(1, pg_temp.k(now() - interval '30 days', 60), 200)->>'replayed', 'true', 'Q: after the key''s lifetime, an unexpired run replays (no scan)');
select ok(pg_temp.scan(1, pg_temp.k(now() - interval '30 days', 60), 200) ? 'rules', 'Q: with its stored content');
select is(pg_temp.scan_err(2, pg_temp.k(now() - interval '30 days', 60), 200), '22023: Run key reused by another operator', 'Q: actor mismatch refused (unexpired)');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '30 days', 60), 100), '22023: Run key reused with different parameters', 'Q: limit mismatch refused (unexpired)');
-- With retention at its 7-day floor, a run committed at the earliest instant its key allows (issue − 5 min)
-- is unexpired at the end of the key's lifetime: a retry then replays.
update private.operations_sla_retention set retention = interval '7 days';
select pg_temp.old_run(pg_temp.k(now() - interval '24 hours', 61), now() - interval '24 hours' - interval '5 minutes');
select is(pg_temp.scan(1, pg_temp.k(now() - interval '24 hours', 61), 200)->>'replayed', 'true', 'Q: 7-day floor: a run committed within its key''s lifetime replays at retry_until');
update private.operations_sla_retention set retention = interval '90 days';

-- Everything in the ledger moves back 100 days, except run k(70) committed now; then key k(62)'s run is
-- inserted 100 days old with no observation.
select set_config('t.ledger', pg_temp.ledger()::text, true);
select pg_temp.backdate($b$
update private.operations_sla_observations set due_at = due_at - interval '100 days', evaluated_at = evaluated_at - interval '100 days', observed_at = observed_at - interval '100 days';
update private.operations_sla_detector_runs set evaluated_at = evaluated_at - interval '100 days', started_at = started_at - interval '100 days';
update private.operations_sla_detector_run_results set finished_at = finished_at - interval '100 days';
update private.operations_sla_purges set ran_at = ran_at - interval '100 days';
-- r17's source moves with it, so its episode key (which includes due_at) still matches its observation (M-10).
update public.service_requests set confirmation_sent_at = confirmation_sent_at - interval '100 days' where id = 'f75f2000-0000-4000-8000-000000000017';
$b$);
select pg_temp.old_run(pg_temp.k(now() - interval '100 days', 62), now() - interval '100 days');
-- 3 expired purge-log rows (the earlier one, moved back, and two more).
select pg_temp.backdate($b$insert into private.operations_sla_purges(actor,outcome,applied_limit,deleted_observations,deleted_runs,deleted_purge_logs,
  deleted_observation_rows,deleted_run_result_rows,deleted_run_start_rows,deleted_purge_log_rows,remaining_expired_observations,remaining_expired_runs,
  remaining_expired_runs_referenced,remaining_expired_purge_logs,remaining_over_cap,ran_at)
  select 'f75f0000-0000-4000-8000-000000000001','complete',1,0,0,0,0,0,0,0,0,0,0,0,false,now() - interval '100 days' - n * interval '1 minute' from generate_series(1,2) n$b$);
insert into res values ('k70', pg_temp.scan(1, pg_temp.k(now(), 70), 200));
select is((select v->>'outcome' from res where label = 'k70'), 'complete', 'R setup: one unexpired run (k70) recorded now');
select is((select count(*)::int from private.operations_sla_observations where subject_id = pg_temp.r(17)), 1,
  'M-10: an expired but unpurged observation still blocks its episode: k70 does not record r17 again');

-- Expired rows are hidden from every readback while still stored, including an expired run that
-- expired observations still reference (F-8), and the lookup says expired.
select is(jsonb_array_length(pg_temp.call(1, 'select public.admin_sla_observations(null, null, 200)')->'items'),
  (select count(*)::int from private.operations_sla_observations where observed_at >= now() - interval '90 days'), 'R: observations readback shows only unexpired rows');
select is((select array_agg((i->>'run_key')::uuid) from jsonb_array_elements(pg_temp.call(1, 'select public.admin_sla_detector_runs(100)')->'items') i), array[pg_temp.k(now(), 70)],
  'R: runs readback shows only the unexpired run');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now(), 1))) - 'checked_at', jsonb_build_object('run_key', pg_temp.k(now(), 1), 'state', 'expired'),
  'R: lookup of an expired run still referenced by expired observations: expired, content withheld (F-8)');
select is(pg_temp.scan(1, pg_temp.k(now(), 1), 200), jsonb_build_object('run_key', pg_temp.k(now(), 1), 'state', 'expired', 'replayed', true),
  'Q: a same-key retry of an expired run returns expired with no content');
select is(pg_temp.scan_err(2, pg_temp.k(now(), 1), 200), '22023: Run key reused by another operator', 'Q: actor mismatch refused (expired)');
select is(pg_temp.scan_err(1, pg_temp.k(now(), 1), 100), '22023: Run key reused with different parameters', 'Q: limit mismatch refused (expired)');
insert into res values ('sum2', pg_temp.call(1, 'select public.admin_sla_observation_summary(now() - interval ''200 days'', now() + interval ''1 day'')'));
select is((select (v->'runs'->>'total')::int from res where label = 'sum2'), 1, 'R: the summary counts only the unexpired run');
select is((select sum((e->>'observations')::int)::int from res, jsonb_array_elements(v->'rules') e where label = 'sum2'),
  (select count(*)::int from private.operations_sla_observations where observed_at >= now() - interval '90 days'), 'R: and only unexpired observations');
select is((select count(*)::int from private.operations_sla_observations o join private.operations_sla_detector_run_results x on x.run_id = o.run_id where o.observed_at > x.finished_at),
  0, 'R: observed_at <= finished_at for every row (an observation never outlives its run)');

-- Purge with limit 2 (more than 2 eligible items in every class).
create temp table before_purge as select
  (select count(*) from private.operations_sla_observations) obs, (select count(*) from private.operations_sla_detector_run_results) results,
  (select count(*) from private.operations_sla_detector_runs) starts, (select count(*) from private.operations_sla_purges) logs,
  (select array_agg(id order by observed_at, id) from (select id, observed_at from private.operations_sla_observations where observed_at < now() - interval '90 days' order by observed_at, id limit 2) s) obs_ids,
  (select array_agg(run_id order by finished_at, run_id) from (select x.run_id, x.finished_at from private.operations_sla_detector_run_results x where x.finished_at < now() - interval '90 days'
     and not exists(select 1 from private.operations_sla_observations o where o.run_id = x.run_id and o.id not in (select id from private.operations_sla_observations order by observed_at, id limit 2))
     order by x.finished_at, x.run_id limit 2) s) run_ids,
  (select array_agg(id order by ran_at, id) from (select id, ran_at from private.operations_sla_purges where ran_at < now() - interval '90 days' order by ran_at, id limit 2) s) log_ids,
  (select count(*) from private.operations_sla_observations where observed_at < now() - interval '90 days') exp_obs,
  (select count(*) from private.operations_sla_detector_run_results where finished_at < now() - interval '90 days') exp_runs,
  (select count(*) from private.operations_sla_purges where ran_at < now() - interval '90 days') exp_logs;
select ok((select exp_obs > 2 and exp_runs - (select count(distinct o.run_id) from private.operations_sla_observations o join private.operations_sla_detector_run_results x on x.run_id = o.run_id where x.finished_at < now() - interval '90 days') > 2 and exp_logs > 2 from before_purge),
  'R setup: more than 2 eligible items in each class');
select set_config('t.z_before', pg_temp.business_state(), true);
insert into res values ('purge2', pg_temp.call(1, 'select public.admin_purge_sla_records(2)'));
select is(pg_temp.business_state(), current_setting('t.z_before'), 'Z: a purge changes no business table, HTTP request or cron job');
select is((select v->'deleted_logical' from res where label = 'purge2'), '{"observations":2,"runs":2,"purge_logs":2}'::jsonb, 'R: limit n = 2: exactly n observations, n runs and n purge-log rows');
select is((select v->'deleted_physical_rows' from res where label = 'purge2'), '{"observations":2,"run_results":2,"run_starts":2,"purge_logs":2}'::jsonb,
  'R: physical rows 2 + 2 + 2 + 2 = 4n (runs are two rows each)');
select is((select array[obs - (select count(*) from private.operations_sla_observations), results - (select count(*) from private.operations_sla_detector_run_results),
    starts - (select count(*) from private.operations_sla_detector_runs), logs + 1 - (select count(*) from private.operations_sla_purges)] from before_purge),
  array[2,2,2,2]::bigint[], 'R: the counts equal the table changes (purge log: 2 deleted, 1 written)');
select is((select array[deleted_observations, deleted_runs, deleted_purge_logs, deleted_observation_rows, deleted_run_result_rows, deleted_run_start_rows, deleted_purge_log_rows]
  from private.operations_sla_purges where id = (select (v->>'purge_id')::bigint from res where label = 'purge2')), array[2,2,2,2,2,2,2], 'R: the log row records the same logical and physical counts');
select is((select count(*)::int from private.operations_sla_observations where id in (select unnest(obs_ids) from before_purge)), 0, 'R: the two oldest observations went first');
select is((select count(*)::int from private.operations_sla_detector_runs where id in (select unnest(run_ids) from before_purge)), 0, 'R: the two oldest unreferenced expired runs went');
select is((select count(*)::int from private.operations_sla_purges where id in (select unnest(log_ids) from before_purge)), 0, 'R: the two oldest expired purge-log rows went');
select is((select count(*)::int from private.operations_sla_detector_runs where id = pg_temp.k(now(), 1)), 1, 'R: a run still referenced by observations stays (deleted only after them)');
select is((select v->'remaining_expired_logical' from res where label = 'purge2'), jsonb_build_object('observations', (select exp_obs - 2 from before_purge),
    'runs', (select exp_runs - 2 from before_purge), 'runs_still_referenced', (select count(distinct o.run_id) from private.operations_sla_observations o join private.operations_sla_detector_run_results x on x.run_id = o.run_id where x.finished_at < now() - interval '90 days'),
    'purge_logs', (select exp_logs - 2 from before_purge), 'cap', 10000, 'over_cap', false),
  'R: remaining expired counts per class (logical)');
select ok((select (v->>'oldest_remaining_expired_at')::timestamptz < now() from res where label = 'purge2'), 'R: the oldest remaining expiry is in the past');
-- Drain.
insert into res select 'drain'||n, pg_temp.call(1, 'select public.admin_purge_sla_records(1000)') from generate_series(1,2) n;
select is((select v->'remaining_expired_logical' from res where label = 'drain2'), '{"observations":0,"runs":0,"runs_still_referenced":0,"purge_logs":0,"cap":10000,"over_cap":false}'::jsonb,
  'R: repeated purges drain every class to 0');
select is((select array[(select count(*) from private.operations_sla_observations where observed_at < now() - interval '90 days'),
  (select count(*) from private.operations_sla_detector_run_results where finished_at < now() - interval '90 days'),
  (select count(*) from private.operations_sla_purges where ran_at < now() - interval '90 days')]), array[0,0,0]::bigint[], 'R: no expired row remains');
select is((select count(*)::int from private.operations_sla_detector_runs where id = pg_temp.k(now(), 70)), 1, 'R: the unexpired run is untouched');
select is((select count(*)::int from private.operations_sla_purges where id = (select (v->>'purge_id')::bigint from res where label = 'drain2')), 1, 'R: a purge never deletes its own log row');
-- Q after purge: the key is too old; the lookup says not_visible with retry_until in the past.
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '100 days', 62), 200), '22023: Run key is too old to start a scan', 'Q: after purge, a retry is refused as too old and scans nothing');
select is((select pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now() - interval '100 days', 62)))->>'state'), 'not_visible', 'Q: after purge the lookup is not_visible');
select ok((pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now() - interval '100 days', 62)))->>'retry_until')::timestamptz < now(), 'Q: with retry_until in the past');
-- M-10: an episode whose observation was purged while it is still overdue is recorded again as a new, unlinked row.
insert into res values ('k71', pg_temp.scan(1, pg_temp.k(now(), 71), 200));
select is((select count(*)::int from private.operations_sla_observations where run_id = pg_temp.k(now(), 71) and subject_id = pg_temp.r(17)), 1,
  'M-10: after the purge, the still-overdue r17 is recorded again by the next scan');
-- The remaining count is capped at 10,000 (logical).
select pg_temp.backdate($b$insert into private.operations_sla_purges(actor,outcome,applied_limit,deleted_observations,deleted_runs,deleted_purge_logs,
  deleted_observation_rows,deleted_run_result_rows,deleted_run_start_rows,deleted_purge_log_rows,remaining_expired_observations,remaining_expired_runs,
  remaining_expired_runs_referenced,remaining_expired_purge_logs,remaining_over_cap,ran_at)
  select 'f75f0000-0000-4000-8000-000000000001','complete',1,0,0,0,0,0,0,0,0,0,0,0,false,now() - interval '100 days' from generate_series(1,10002)$b$);
insert into res values ('cap', pg_temp.call(1, 'select public.admin_purge_sla_records(1)'));
select is((select v->'remaining_expired_logical' from res where label = 'cap') - 'observations' - 'runs' - 'runs_still_referenced',
  '{"purge_logs":10000,"cap":10000,"over_cap":true}'::jsonb, 'R: remaining counts are capped at 10,000 with over_cap');
select is((select remaining_expired_purge_logs||'/'||remaining_over_cap from private.operations_sla_purges where id = (select (v->>'purge_id')::bigint from res where label = 'cap')),
  '10000/true', 'R: and the log row records the capped count');

select * from finish();
rollback;
