-- Phase 7.5D (TRACE-159, DF-3): support "overdue" = awaiting a first reply past its target.
-- Migration 20261202001000. Record: governance/PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md (scenario map, R-1..R-7).
--
-- A qualifying reply is the earliest support message with author_role = 'operations' and
-- visibility = 'participant' (the row, CD-1/R-2). It is a recorded reply, not proof of access,
-- delivery or reading. An open or in-progress ticket is overdue only when no qualifying reply exists
-- and its original response_due_at has passed. The CFG-010 target, routing, queue membership and
-- order, grants and requester access are unchanged, and a reopen never resets the target or clears
-- the first reply.
--
-- Real commands throughout: open_support_ticket, post_support_message, add_support_note,
-- admin_update_support_ticket and the readers admin_support_queue, support_ticket_detail,
-- my_support_tickets and admin_operations_summary. Tickets that only another workflow produces (a
-- dispute, a provider- or operator-raised service exception) are inserted as the owner with the
-- producer's columns and the producer's caller as auth.uid(), so the real insert triggers stamp and
-- route them (the 7.5C precondition method). "The clock passes" = recorded times moved back as the
-- owner with triggers off; inside the transaction now() is fixed. Nothing is committed.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 operator, 2 operator with finance authority, 3 homeowner, 4 provider, 5 another homeowner.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('c75d0000-0000-4000-8000-000000000001','p75d-admin@example.invalid',now(),'{"full_name":"P75D operator"}'),
 ('c75d0000-0000-4000-8000-000000000002','p75d-finance@example.invalid',now(),'{"full_name":"P75D finance operator"}'),
 ('c75d0000-0000-4000-8000-000000000003','p75d-home@example.invalid',now(),'{"full_name":"P75D homeowner"}'),
 ('c75d0000-0000-4000-8000-000000000004','p75d-pro@example.invalid',now(),'{"full_name":"P75D provider"}'),
 ('c75d0000-0000-4000-8000-000000000005','p75d-other@example.invalid',now(),'{"full_name":"P75D other homeowner"}');
insert into public.user_roles(user_id,role) values
 ('c75d0000-0000-4000-8000-000000000001','admin'),('c75d0000-0000-4000-8000-000000000002','admin'),
 ('c75d0000-0000-4000-8000-000000000003','homeowner'),('c75d0000-0000-4000-8000-000000000004','vendor'),
 ('c75d0000-0000-4000-8000-000000000005','homeowner')
 on conflict do nothing;
insert into public.money_authorities(user_id,granted_by,reason) values
 ('c75d0000-0000-4000-8000-000000000002','c75d0000-0000-4000-8000-000000000001','Synthetic finance holder');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('c75d1000-0000-4000-8000-000000000001','c75d0000-0000-4000-8000-000000000004','P75D provider',true,true);
-- A job far from today, so no ticket here is routed same_day by the clock (SD-2 stays 7.5C's).
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,scheduled_start_at)
 values ('c75d2000-0000-4000-8000-000000000001','c75d0000-0000-4000-8000-000000000003','c75d1000-0000-4000-8000-000000000001',
   'P75D work','1 Probe St','Fort Myers','FL','00129','P75D job','scheduled','matched','fixed', now() + interval '20 days');

create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('c75d0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.k(n int) returns uuid language sql immutable as $$ select ('c75d9000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.job() returns uuid language sql immutable as $$ select 'c75d2000-0000-4000-8000-000000000001'::uuid $$;
-- Run p_sql as user n (authenticated), or as anon when n = 0, and return its jsonb.
create function pg_temp.call(n int, p_sql text) returns jsonb language plpgsql as $$
declare result jsonb;
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
  perform set_config('request.jwt.claims', '', true);
  return result;
end $$;
-- The SQLSTATE a call fails with, or 'allowed'. The failed call's role and claims roll back with it.
create function pg_temp.refused(n int, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.call(n, p_sql);
  return 'allowed';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.backdate(p_sql text) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  execute p_sql;
  set local session_replication_role = origin;
end $$;
-- Tickets are named; their ids live in transaction settings.
create function pg_temp.t(name text) returns uuid language sql as $$ select current_setting('t.'||name)::uuid $$;
create function pg_temp.open(name text, n int, key int) returns uuid language plpgsql as $$
begin
  perform set_config('t.'||name, pg_temp.call(n, format('select public.open_support_ticket(%L, %L, %L)', pg_temp.k(key), 'P75D '||name, 'Synthetic question '||name))->>'ticket_id', true);
  return pg_temp.t(name);
end $$;
-- A ticket another workflow produces: inserted with the producer's columns, auth.uid() = the producer's caller.
create function pg_temp.produced(name text, caller int, kind text, next_action text) returns uuid language plpgsql as $$
declare id uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(caller))::text, true);
  insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
    values (pg_temp.u(3), 'P75D '||name, 'Synthetic '||kind, kind, pg_temp.job()::text, next_action) returning support_tickets.id into id;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('t.'||name, id::text, true);
  return id;
end $$;
create function pg_temp.reply(name text, n int, key int) returns void language sql as $$
  select pg_temp.call(n, format('select public.post_support_message(%L, %L, %L)', pg_temp.t(name), pg_temp.k(key), 'Synthetic reply '||key)) $$;
create function pg_temp.triage(name text, key int, status text, assignee uuid, next_step text) returns jsonb language sql as $$
  select pg_temp.call(1, format('select public.admin_update_support_ticket(%L, %L, %s, %L, %L, %L, %L)', pg_temp.t(name), pg_temp.k(key),
    (select version from public.support_tickets where id = pg_temp.t(name)), status, assignee, next_step, 'Synthetic triage '||key)) $$;
create function pg_temp.due(name text, at timestamptz) returns void language sql as $$
  select pg_temp.backdate(format($b$update public.support_tickets set response_due_at = %L where id = %L$b$, at, pg_temp.t(name))) $$;
create function pg_temp.queue(include_closed boolean default false) returns jsonb language sql as $$
  select pg_temp.call(1, format('select public.admin_support_queue(%L)', include_closed)) $$;
create function pg_temp.item(name text, include_closed boolean default false) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.queue(include_closed)->'items') i where (i->>'ticket_id')::uuid = pg_temp.t(name) $$;
create function pg_temp.detail(name text, n int default 1) returns jsonb language sql as $$
  select pg_temp.call(n, format('select public.support_ticket_detail(%L)', pg_temp.t(name))) $$;
create function pg_temp.first_reply(name text) returns timestamptz language sql as $$
  select min(created_at) from public.support_ticket_messages where ticket_id = pg_temp.t(name) and author_role = 'operations' and visibility = 'participant' $$;
-- One line per reader: queue overdue / detail overdue / queue first reply / detail first reply.
create function pg_temp.state(name text) returns text language sql as $$
  select concat_ws(' / ', pg_temp.item(name, true)->>'overdue', pg_temp.detail(name)->>'overdue',
    coalesce(pg_temp.item(name, true)->>'first_response_at', 'none'), coalesce(pg_temp.detail(name)->>'first_response_at', 'none')) $$;
create function pg_temp.at(name text) returns text language sql as $$ select to_jsonb(pg_temp.first_reply(name))#>>'{}' $$;

-- ================================================================================================
-- R0  Shape. The helper exists, is not callable by clients, and the readers add exactly one key.
select has_function('private', 'support_first_response_at', array['uuid'], 'R0: private.support_first_response_at(uuid) exists');
select is(has_function_privilege('authenticated', 'private.support_first_response_at(uuid)', 'execute')
  or has_function_privilege('anon', 'private.support_first_response_at(uuid)', 'execute'), false, 'R0: no client role can execute the helper');
select is((select array_agg(r order by r) from unnest(array['authenticated','service_role']) r
    where has_function_privilege(r, 'public.admin_support_queue(boolean)', 'execute')), array['authenticated','service_role'],
  'R0: admin_support_queue grants unchanged (authenticated, service_role)');
select is(has_function_privilege('anon', 'public.admin_support_queue(boolean)', 'execute'), false, 'R0: anon still cannot execute the queue');
select pg_temp.open('shape', 3, 1);
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.item('shape')) k),
  array['assigned_to','assignee','created_at','decision_recorded','dispute_status','first_response_at','job_id','kind','messages','next_action','overdue',
    'priority','queue_owner','requester','response_due_at','status','subject','ticket_id','ticket_number','updated_at','version'],
  'R0: queue item keys = the 20 before + first_response_at');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.detail('shape')) k),
  array['assigned_to','assignee','can_reply','closed_at','created_at','description','dispute','first_response_at','history','job','kind','messages',
    'next_action','opened_by','overdue','priority','queue_owner','requester','response_due_at','review_appeal','status','subject','ticket_id',
    'ticket_number','updated_at','version'],
  'R0: operator detail keys = the 25 before + first_response_at');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.detail('shape', 3)) k),
  array['can_reply','closed_at','created_at','description','job','kind','messages','priority','response_due_at','status','subject','ticket_id',
    'ticket_number','updated_at','version'],
  'R0: requester detail keys unchanged (no overdue, no first_response_at)');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.queue()->'counts') k), array['open','overdue','same_day','unassigned'],
  'R0: queue counts keys unchanged');

-- ================================================================================================
-- R1  Answered before the target; the clock passes the target. Not overdue (the DF-3 repair).
select pg_temp.open('ontime', 3, 10);
select is(pg_temp.state('ontime'), 'false / false / none / none', 'R1: new and within target: not overdue, no reply');
select set_config('t.n_before', (select count(*) from public.notifications where user_id = pg_temp.u(3))::text, true);
select pg_temp.reply('ontime', 1, 11);
select is((select count(*)::int from public.notifications where user_id = pg_temp.u(3)) - current_setting('t.n_before')::int, 1,
  'R1: the reply producer is unchanged (one N-SUP-03 row to the requester)');
select pg_temp.backdate(format($b$update public.support_tickets set created_at = now() - interval '3 hours' where id = %L$b$, pg_temp.t('ontime')));
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = now() - interval '1 hour' where ticket_id = %L$b$, pg_temp.t('ontime')));
select pg_temp.due('ontime', now() - interval '1 microsecond');
select is(pg_temp.state('ontime'), format('false / false / %s / %s', pg_temp.at('ontime'), pg_temp.at('ontime')),
  'R1: answered an hour before the target, the target passes: not overdue; both readers report the reply time');
select is(pg_temp.first_reply('ontime'), now() - interval '1 hour', 'R1: the first reply time is the message''s own time');

-- R2  Unanswered past the target, then answered late. Overdue until the reply, then not; the target is kept.
select pg_temp.open('late', 3, 20);
select pg_temp.due('late', now() - interval '1 hour');
select is(pg_temp.state('late'), 'true / true / none / none', 'R2: unanswered an hour past the target: overdue');
select set_config('t.late_events', (select count(*) from public.support_ticket_events where ticket_id = pg_temp.t('late'))::text, true);
select pg_temp.reply('late', 1, 21);
select is(pg_temp.state('late'), format('false / false / %s / %s', to_jsonb(now())#>>'{}', to_jsonb(now())#>>'{}'),
  'R2: a late reply ends overdue at once; first reply = the reply time');
select is((select response_due_at from public.support_tickets where id = pg_temp.t('late')), now() - interval '1 hour', 'R2: the original target is kept (no late flag is stored)');
select is((select count(*)::int from public.support_ticket_events where ticket_id = pg_temp.t('late')), current_setting('t.late_events')::int,
  'R2: the reply writes no ticket event (no status, assignment or breach record)');

-- R3/R4  Boundaries for an unanswered ticket (strict "<", unchanged).
select pg_temp.open('edge', 3, 30);
select pg_temp.due('edge', now() + interval '1 microsecond');
select is(pg_temp.item('edge')->>'overdue', 'false', 'R3: target 1 µs ahead: not overdue');
select pg_temp.due('edge', now());
select is(pg_temp.item('edge')->>'overdue', 'false', 'R4: target exactly now: not overdue');
select pg_temp.due('edge', now() - interval '1 microsecond');
select is(pg_temp.item('edge')->>'overdue', 'true', 'R4: target 1 µs past: overdue');
-- A reply recorded exactly at the target counts like any other.
select pg_temp.reply('edge', 2, 31);
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = (select response_due_at from public.support_tickets where id = %L) where ticket_id = %L$b$,
  pg_temp.t('edge'), pg_temp.t('edge')));
select is(pg_temp.state('edge'), format('false / false / %s / %s', pg_temp.at('edge'), pg_temp.at('edge')), 'R4: a reply at exactly the target: not overdue');
select is(pg_temp.first_reply('edge'), now() - interval '1 microsecond', 'R4: and it is that reply''s time');

-- R5  An internal note is not a reply.
select pg_temp.open('note', 3, 40);
select pg_temp.due('note', now() - interval '1 hour');
select pg_temp.call(1, format('select public.add_support_note(%L, %L, %L)', pg_temp.t('note'), pg_temp.k(41), 'Synthetic internal note'));
select is((select array_agg(author_role||'/'||visibility) from public.support_ticket_messages where ticket_id = pg_temp.t('note')), array['operations/internal'],
  'R5: one operations internal note');
select is(pg_temp.state('note'), 'true / true / none / none', 'R5: a note only: still awaiting a first reply, overdue');
select is((pg_temp.item('note')->>'messages')::int, 0, 'R5: the queue''s participant message count is unchanged by a note');

-- R6  A requester message is not a reply.
select pg_temp.open('requester', 3, 50);
select pg_temp.due('requester', now() - interval '1 hour');
select pg_temp.reply('requester', 3, 51);
select is((select array_agg(author_role||'/'||visibility) from public.support_ticket_messages where ticket_id = pg_temp.t('requester')), array['requester/participant'],
  'R6: one requester message');
select is(pg_temp.state('requester'), 'true / true / none / none', 'R6: still awaiting a first reply, overdue');

-- R7  Status, assignment and next-action changes are not replies.
select pg_temp.open('triage', 3, 60);
select pg_temp.due('triage', now() - interval '1 hour');
select pg_temp.triage('triage', 61, 'in-progress', null, null);
select pg_temp.triage('triage', 62, null, pg_temp.u(2), null);
select pg_temp.triage('triage', 63, null, null, 'Call the homeowner');
select is((select array_agg(action order by seq) from public.support_ticket_events where ticket_id = pg_temp.t('triage')),
  array['opened','status','assigned','next_action'], 'R7: status, assignment and next action recorded as events');
select is((select count(*)::int from public.support_ticket_messages where ticket_id = pg_temp.t('triage')), 0, 'R7: no message written');
select is(pg_temp.state('triage'), 'true / true / none / none', 'R7: in progress, assigned, with a next action: still overdue');

-- R8  Closed without a reply: leaves the open queue, never answered, not overdue (open/in-progress only).
select pg_temp.open('unanswered', 3, 70);
select pg_temp.due('unanswered', now() - interval '2 hours');
select is(pg_temp.item('unanswered')->>'overdue', 'true', 'R8: before closing: overdue');
select pg_temp.triage('unanswered', 71, 'resolved', null, null);
select is(pg_temp.item('unanswered'), null, 'R8: resolved without a reply: not in the default queue');
select is(pg_temp.state('unanswered'), 'false / false / none / none', 'R8: with closed included: not overdue, first reply none (never answered)');
select pg_temp.triage('unanswered', 72, 'closed', null, null);
select is(pg_temp.state('unanswered'), 'false / false / none / none', 'R8: closed: the same');

-- R9  Reopened, never answered: back in the queue and overdue against its ORIGINAL target (R-7).
select set_config('t.unanswered_due', (select response_due_at from public.support_tickets where id = pg_temp.t('unanswered'))::text, true);
select pg_temp.triage('unanswered', 73, 'open', null, null);
select is((select response_due_at from public.support_tickets where id = pg_temp.t('unanswered')), current_setting('t.unanswered_due')::timestamptz,
  'R9: reopening does not reset the target');
select is(pg_temp.item('unanswered')->>'overdue', 'true', 'R9: reopened and never answered: in the queue, overdue at once');

-- R10 Replied, closed, reopened: still answered (first reply only; no recurring target).
select pg_temp.open('reopened', 3, 80);
select pg_temp.reply('reopened', 1, 81);
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = now() - interval '5 hours' where ticket_id = %L$b$, pg_temp.t('reopened')));
select pg_temp.due('reopened', now() - interval '4 hours');
select pg_temp.triage('reopened', 82, 'resolved', null, null);
select pg_temp.triage('reopened', 83, 'open', null, null);
select is((select count(*)::int from public.support_ticket_messages where ticket_id = pg_temp.t('reopened')), 1, 'R10: one reply');
select is(pg_temp.state('reopened'), format('false / false / %s / %s', pg_temp.at('reopened'), pg_temp.at('reopened')),
  'R10: replied, resolved, reopened past its target: not overdue; the first reply is kept');
select is(pg_temp.first_reply('reopened'), now() - interval '5 hours', 'R10: first reply = the reply before closing');
-- A requester message after the reopen does not restart anything.
select pg_temp.reply('reopened', 3, 84);
select is(pg_temp.item('reopened')->>'overdue', 'false', 'R10: a requester follow-up after the reopen: still not overdue');

-- R11 Several replies: the earliest counts, whoever wrote it.
select pg_temp.open('two', 3, 90);
select pg_temp.reply('two', 1, 91);
select pg_temp.reply('two', 2, 92);
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = now() - interval '2 hours' where ticket_id = %L and author_id = %L$b$, pg_temp.t('two'), pg_temp.u(2)));
select pg_temp.backdate(format($b$update public.support_ticket_messages set created_at = now() - interval '1 hour' where ticket_id = %L and author_id = %L$b$, pg_temp.t('two'), pg_temp.u(1)));
select is((pg_temp.item('two')->>'first_response_at')::timestamptz, now() - interval '2 hours', 'R11: two replies: the earlier (the second operator''s) is the first reply');
select is((pg_temp.detail('two')->>'first_response_at')::timestamptz, now() - interval '2 hours', 'R11: detail agrees');

-- R12 A dispute ticket follows the same rule (T-9 follows T-8).
select pg_temp.produced('dispute', 3, 'dispute', 'Review completion evidence and contact both parties');
select is((select (priority, queue_owner, opened_by = pg_temp.u(3))::text from public.support_tickets where id = pg_temp.t('dispute')), '(standard,project_owner,t)',
  'R12: the dispute ticket is routed as before (standard, project owner, opened by the homeowner)');
select pg_temp.due('dispute', now() - interval '1 hour');
select is(pg_temp.state('dispute'), 'true / true / none / none', 'R12: unanswered past the target: overdue');
select pg_temp.reply('dispute', 1, 121);
select is(pg_temp.item('dispute')->>'overdue', 'false', 'R12: answered: not overdue');

-- R13 Same-day priority keeps its own target; the rule is the same.
select pg_temp.open('sameday', 3, 130);
select pg_temp.backdate(format($b$update public.support_tickets set priority = 'same_day', response_due_at = now() - interval '1 minute' where id = %L$b$, pg_temp.t('sameday')));
select is(pg_temp.item('sameday')->>'overdue', 'true', 'R13: same-day, unanswered, past its target: overdue');
select pg_temp.reply('sameday', 1, 131);
select is((select (priority, response_due_at = now() - interval '1 minute')::text from public.support_tickets where id = pg_temp.t('sameday')), '(same_day,t)',
  'R13: a reply changes neither priority nor target');
select is(pg_temp.item('sameday')->>'overdue', 'false', 'R13: answered: not overdue');

-- ================================================================================================
-- R14 Access. Unchanged: only operators read the queue or the operator fields.
select is(pg_temp.refused(3, 'select public.admin_support_queue()'), '42501', 'R14: homeowner cannot read the queue');
select is(pg_temp.refused(4, 'select public.admin_support_queue()'), '42501', 'R14: provider cannot read the queue');
select is(pg_temp.refused(0, 'select public.admin_support_queue()'), '42501', 'R14: anon cannot read the queue');
select is(pg_temp.refused(5, format('select public.support_ticket_detail(%L)', pg_temp.t('ontime'))), '42501', 'R14: another homeowner cannot read the ticket');
select is(pg_temp.detail('ontime', 3) ? 'first_response_at' or pg_temp.detail('ontime', 3) ? 'overdue', false,
  'R14: the requester''s detail has neither first_response_at nor overdue');
select is((select count(*)::int from jsonb_array_elements(pg_temp.call(3, 'select public.my_support_tickets()')->'items') i where i ? 'first_response_at' or i ? 'overdue'), 0,
  'R14: my_support_tickets carries neither key');
select ok((select count(*) from jsonb_array_elements(pg_temp.call(3, 'select public.my_support_tickets()')->'items')) >= 10, 'R14: (the requester list is not empty)');

-- R14b Work items filed by a provider or an operator (schedule_exception: user_id = the homeowner,
-- opened_by = the caller). support_is_requester needs opened_by = the viewer, so NO participant can
-- open them; the row predicate still counts an operations participant reply (R-2). The reply's
-- N-SUP-03 still goes to the homeowner with a /support link where the ticket is not listed: recorded
-- as finding F-1 (7.5D record), not repaired here. Permissions and notification producers unchanged.
select pg_temp.produced('by_provider', 4, 'schedule_exception', 'Review service exception, replacement options and policy consequences');
select pg_temp.produced('by_operator', 1, 'schedule_exception', 'Review service exception, replacement options and policy consequences');
select is((select array_agg((user_id = pg_temp.u(3))::text || '/' || (opened_by = pg_temp.u(c))::text order by n) from
  (values ('by_provider', 4, 1), ('by_operator', 1, 2)) v(name, c, n) join public.support_tickets t on t.id = pg_temp.t(v.name)), array['true/true','true/true'],
  'R14b: both belong to the homeowner and were opened by their caller');
select is(pg_temp.refused(3, format('select public.support_ticket_detail(%L)', pg_temp.t('by_provider'))), '42501', 'R14b: the homeowner cannot open the provider-filed item');
select is(pg_temp.refused(3, format('select public.support_ticket_detail(%L)', pg_temp.t('by_operator'))), '42501', 'R14b: nor the operator-filed item');
select is(pg_temp.refused(4, format('select public.support_ticket_detail(%L)', pg_temp.t('by_provider'))), '42501', 'R14b: nor can the provider who filed it');
select is(pg_temp.refused(3, format('select public.post_support_message(%L, %L, %L)', pg_temp.t('by_provider'), pg_temp.k(140), 'Can I reply?')), '42501',
  'R14b: the homeowner cannot write on it');
select is((select count(*)::int from jsonb_array_elements(pg_temp.call(3, 'select public.my_support_tickets()')->'items') i
  where (i->>'ticket_id')::uuid in (pg_temp.t('by_provider'), pg_temp.t('by_operator'))), 0, 'R14b: neither is in the homeowner''s list');
select pg_temp.due('by_provider', now() - interval '1 hour');
select pg_temp.due('by_operator', now() - interval '1 hour');
select is(pg_temp.state('by_provider'), 'true / true / none / none', 'R14b: provider-filed, unanswered past target: overdue');
select set_config('t.n_before', (select count(*) from public.notifications where user_id = pg_temp.u(3))::text, true);
select pg_temp.reply('by_provider', 1, 141);
select is(pg_temp.state('by_provider'), format('false / false / %s / %s', pg_temp.at('by_provider'), pg_temp.at('by_provider')),
  'R14b: an operations participant reply counts (row predicate), though no participant can open it');
select is((select array_agg(title || ' -> ' || coalesce(link, '')) from public.notifications where user_id = pg_temp.u(3) and created_at = now() and title like 'Mercurius replied on %'
    and title like '%' || (select ticket_number from public.support_tickets where id = pg_temp.t('by_provider'))),
  array['Mercurius replied on ' || (select ticket_number from public.support_tickets where id = pg_temp.t('by_provider')) || ' -> /support'],
  'R14b F-1 (pinned, not repaired): the homeowner is still told "Mercurius replied" with a /support link');
select is(pg_temp.refused(3, format('select public.support_ticket_detail(%L)', pg_temp.t('by_provider'))), '42501', 'R14b F-1: and still cannot open it after the reply');
select is(pg_temp.state('by_operator'), 'true / true / none / none', 'R14b: operator-filed, unanswered: still overdue');

-- ================================================================================================
-- R15 Summary parity. admin_operations_summary is not restated by 7.5D; it counts the queue items' overdue.
-- Phase 7.5G-1 (20261205001000) restated it on purpose to append the applications row (7.5B body
-- 3bc2497f…); the support row is unchanged, as the assertions below show.
select is((select md5(pg_get_functiondef('public.admin_operations_summary()'::regprocedure))), '779d61f5d3509895233bfaaff855ce5b',
  'R15: admin_operations_summary is the 7.5G-1 definition (7.5B body plus the applications row)');
create function pg_temp.support_row(n int) returns jsonb language sql as $$
  select r from jsonb_array_elements(pg_temp.call(n, 'select public.admin_operations_summary()')->'queues') r where r->>'queue' = 'support' $$;
select is(pg_temp.support_row(2), jsonb_build_object('queue', 'support', 'state', 'ready', 'count', jsonb_array_length(pg_temp.queue()->'items'),
    'aged', (select count(*) from jsonb_array_elements(pg_temp.queue()->'items') i where (i->>'overdue')::boolean)),
  'R15: finance holder: support count = open items, aged = items awaiting a first reply past target');
select is(pg_temp.support_row(1), pg_temp.support_row(2), 'R15: operator without finance authority: the same support row');
select is((pg_temp.support_row(1)->>'aged')::int, (pg_temp.queue()->'counts'->>'overdue')::int, 'R15: aged = the queue''s overdue count');
-- This file's own open tickets that are overdue, by name: exactly the unanswered past-target ones.
select is((select array_agg(i->>'subject' order by i->>'subject') from jsonb_array_elements(pg_temp.queue()->'items') i
    where (i->>'overdue')::boolean and i->>'subject' like 'P75D %'),
  array['P75D by_operator','P75D note','P75D requester','P75D triage','P75D unanswered'],
  'R15: this file''s overdue tickets are exactly the unanswered past-target ones (answered ones are not)');

-- R16 Three readers agree for every ticket here: count = items, item = detail, both = the messages.
select is((pg_temp.queue()->'counts'->>'overdue')::int, (select count(*)::int from jsonb_array_elements(pg_temp.queue()->'items') i where (i->>'overdue')::boolean),
  'R16: counts.overdue = overdue items');
select is((select count(*)::int from jsonb_array_elements(pg_temp.queue(true)->'items') i
    join public.support_tickets t on t.id = (i->>'ticket_id')::uuid
    where i->>'subject' like 'P75D %'
      and ((i->>'overdue')::boolean is distinct from (pg_temp.call(1, format('select public.support_ticket_detail(%L)', t.id))->>'overdue')::boolean
        or (i->>'first_response_at')::timestamptz is distinct from (pg_temp.call(1, format('select public.support_ticket_detail(%L)', t.id))->>'first_response_at')::timestamptz
        or (i->>'first_response_at')::timestamptz is distinct from (select min(m.created_at) from public.support_ticket_messages m
             where m.ticket_id = t.id and m.author_role = 'operations' and m.visibility = 'participant')
        or (i->>'overdue')::boolean is distinct from (t.status in ('open', 'in-progress') and t.response_due_at < now()
             and not exists(select 1 from public.support_ticket_messages m where m.ticket_id = t.id and m.author_role = 'operations' and m.visibility = 'participant')))),
  0, 'R16: for every ticket here, queue and detail agree with each other and with the rule');
select is((select count(*)::int from public.support_tickets where subject like 'P75D %'), 14, 'R16: (14 tickets checked)');

-- R17 CFG-010 and routing unchanged.
select is(private.support_response_deadline(timestamptz '2026-11-27 16:30 America/New_York'), timestamptz '2026-11-30 16:30 America/New_York',
  'R17: Friday 16:30 ET is due Monday 16:30 ET');
select is(private.support_response_deadline(timestamptz '2026-11-30 09:00 America/New_York'), timestamptz '2026-11-30 17:00 America/New_York',
  'R17: Monday 09:00 ET is due Monday 17:00 ET');
select is((select array_agg(md5(pg_get_functiondef(f)) order by f::text) from unnest(array['private.support_response_deadline(timestamptz)'::regprocedure,
    'private.route_support_ticket()'::regprocedure, 'private.protect_ticket_queue_fields()'::regprocedure]) f),
  (select array_agg(h order by f) from (values ('private.protect_ticket_queue_fields()', 'b555627623d1674e523f63c51a43e960'),
    ('private.route_support_ticket()', '759f5aa693b766edf6043a499bdaba37'), ('private.support_response_deadline(timestamp with time zone)', '01497ca454556fd4ef012c2f1c493009')) v(f, h)),
  'R17: deadline, routing and queue-field protection definitions unchanged');
select is((select (response_due_at, priority, queue_owner)::text from public.support_tickets where id = pg_temp.t('shape')),
  (private.support_response_deadline((select created_at from public.support_tickets where id = pg_temp.t('shape'))), 'standard', 'project_owner')::text,
  'R17: a new ticket is still routed to the CFG-010 calendar');

-- R18 Membership and order unchanged. Ties are possible (one transaction clock), so order is checked
-- as "no adjacent pair out of the function's order", and membership as a set.
create function pg_temp.out_of_order(q jsonb) returns int language sql as $$
  with x as (select o, case when i->>'status' in ('open', 'in-progress') then 0 else 1 end a, case when i->>'priority' = 'same_day' then 0 else 1 end b,
      coalesce((i->>'response_due_at')::timestamptz, 'infinity') c, (i->>'created_at')::timestamptz d
    from jsonb_array_elements(q->'items') with ordinality y(i, o)),
  p as (select a, b, c, d, lead(a) over w na, lead(b) over w nb, lead(c) over w nc, lead(d) over w nd from x window w as (order by o))
  select count(*)::int from p where na is not null and (a, b, c, d) > (na, nb, nc, nd) $$;
select is(pg_temp.out_of_order(pg_temp.queue()), 0, 'R18: default queue in the unchanged order (open first, same-day first, due time, opened)');
select is(pg_temp.out_of_order(pg_temp.queue(true)), 0, 'R18: with closed included, the same order');
select is((select array_agg((i->>'ticket_id')::uuid order by (i->>'ticket_id')) from jsonb_array_elements(pg_temp.queue()->'items') i),
  (select array_agg(t.id order by t.id::text) from public.support_tickets t where t.status in ('open', 'in-progress')),
  'R18: default queue = exactly the open and in-progress tickets');
select is((select count(*)::int from jsonb_array_elements(pg_temp.queue(true)->'items')), (select count(*)::int from public.support_tickets),
  'R18: with closed included = every ticket');
select is((pg_temp.queue()->'counts'->>'open')::int, (select count(*)::int from public.support_tickets where status in ('open', 'in-progress')), 'R18: counts.open unchanged');

select * from finish();
rollback;
