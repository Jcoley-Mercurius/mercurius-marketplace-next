-- Phase 6.10 / TRACE-133: support tickets, disputes, evidence, resolution and appeals. Direct ticket
-- writes are closed; general support, replies, internal notes and triage go through keyed, role-checked
-- commands with append-only history; disputes bind to the completion they question and take
-- stale-guarded decisions and appeals; evidence belongs to its own job and uploader. Nothing here moves
-- money or clears a hold other than the dispute's own resolution. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 assigned provider P, 4 unrelated provider Q, 5–6 operators.
insert into auth.users(id,email,raw_user_meta_data) select ('a1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'support-'||n||'@example.invalid', jsonb_build_object('full_name','Synthetic support '||n) from generate_series(1,6) n;
delete from public.user_roles where user_id in ('a1030000-0000-4000-8000-000000000003','a1030000-0000-4000-8000-000000000004',
  'a1030000-0000-4000-8000-000000000005','a1030000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('a1030000-0000-4000-8000-000000000003','vendor'),('a1030000-0000-4000-8000-000000000004','vendor'),
 ('a1030000-0000-4000-8000-000000000005','admin'),('a1030000-0000-4000-8000-000000000006','admin');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('a2030000-0000-4000-8000-000000000001','a1030000-0000-4000-8000-000000000003','Synthetic support provider',true,true),
 ('a2030000-0000-4000-8000-000000000002','a1030000-0000-4000-8000-000000000004','Synthetic other provider',true,true);
-- Jobs: 1 A/P completed 1 h ago (disputed below); 2 B/P completed; 3 A/P another visit; 4 A/P for the review appeal.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,service_catalog_id,frequency,zip_code,status,vendor_completed_at)
 select ('a3030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
   case when n = 2 then 'a1030000-0000-4000-8000-000000000002'::uuid else 'a1030000-0000-4000-8000-000000000001'::uuid end,
   'a2030000-0000-4000-8000-000000000001','Synthetic support service','Synthetic address',
   (select id from public.services_catalog order by id limit 1),'one-time','00000','vendor_completed',now() - interval '1 hour'
 from generate_series(1,4) n;

create function pg_temp.u(n integer) returns uuid language sql as $$ select ('a1030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.j(n integer) returns uuid language sql as $$ select ('a3030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('a7030000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.as_user(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(n))::text, true) $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_user(p_user);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;
create temp table fx(key text primary key, id uuid);
grant select on fx to authenticated;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;

create temp table money_before as select (select count(*) from public.money_refund_authorizations) refunds,
  (select count(*) from public.money_holds) holds, (select count(*) from public.money_obligations) obligations,
  (select count(*) from public.money_refunds) moved;

-- ── Grants and the closed direct-write surface ──────────────────────────────────────────────
select ok(not has_table_privilege('authenticated','public.support_tickets','INSERT'), 'clients cannot insert tickets');
select ok(not has_table_privilege('authenticated','public.support_tickets','UPDATE'), 'clients cannot update tickets');
select ok(not has_table_privilege('authenticated','public.support_tickets','DELETE'), 'clients cannot delete tickets');
select ok(not has_table_privilege('anon','public.support_tickets','SELECT'), 'anon cannot read tickets');
select ok(not has_table_privilege('authenticated','public.support_ticket_messages','SELECT'), 'messages: no client grant');
select ok(not has_table_privilege('authenticated','public.support_ticket_events','SELECT'), 'events: no client grant');
select ok(not has_table_privilege('authenticated','public.dispute_decisions','SELECT'), 'decisions: no client grant');
select ok(not has_table_privilege('authenticated','public.dispute_submissions','SELECT'), 'submissions: no client grant');
select ok(not has_function_privilege('anon','public.open_support_ticket(uuid,text,text,uuid)','EXECUTE'), 'anon cannot open tickets');
select ok(not has_function_privilege('anon','public.dispute_detail(uuid)','EXECUTE'), 'anon cannot read disputes');
select ok(not has_function_privilege('anon','public.admin_support_queue(boolean)','EXECUTE'), 'anon cannot read the queue');
select ok(has_function_privilege('authenticated','public.open_support_ticket(uuid,text,text,uuid)','EXECUTE'), 'signed-in users can open tickets');

select pg_temp.as_user(1);
set local role authenticated;
select throws_ok($$insert into public.support_tickets(user_id,subject,description,issue_type,job_id,status)
  values (auth.uid(),'Forged','x','dispute_appeal','a3030000-0000-4000-8000-000000000002','resolved')$$, '42501', null, 'S1: forged ticket insert refused');
select throws_ok($$update public.support_tickets set status='resolved'$$, '42501', null, 'S2: requester status rewrite refused');
select throws_ok($$delete from public.support_tickets$$, '42501', null, 'S3: delete refused');
select throws_ok($$insert into public.support_ticket_messages(ticket_id,author_id,author_role,visibility,body,request_key)
  values (gen_random_uuid(),auth.uid(),'requester','participant','x',gen_random_uuid())$$, '42501', null, 'direct message insert refused');
select throws_ok($$insert into public.dispute_submissions(dispute_id,author_id,author_role,statement,request_key)
  values (gen_random_uuid(),auth.uid(),'homeowner','x',gen_random_uuid())$$, '42501', null, 'direct submission insert refused');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok($$update public.support_tickets set status='closed'$$, '42501', null, 'S4: operator direct status write refused');
select throws_ok($$insert into public.dispute_decisions(dispute_id,action,from_status,to_status,from_version,to_version)
  values (gen_random_uuid(),'decided','open','resolved',0,1)$$, '42501', null, 'direct decision insert refused');
reset role;
select is(pg_temp.call(1, $$select to_jsonb(count(*)) from public.support_tickets$$), '0'::jsonb, 'requesters no longer read the ticket table');

-- ── General support intake ──────────────────────────────────────────────────────────────────
insert into fx select 'a_general', (pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(1),
  'Billing question','How do refunds show up?'))->>'ticket_id')::uuid;
select is(pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(1), 'Billing question','How do refunds show up?'))->>'ticket_id',
  pg_temp.id('a_general')::text, 'same key and payload returns the same ticket');
select is(pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(1), 'Billing question','How do refunds show up?'))->'replayed',
  'true'::jsonb, 'and says it was replayed');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(1), 'Changed','How do refunds show up?'), '22023', null, 'reused key with a different payload refused');
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(2), '  ','x'), '22023', null, 'subject required');
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(2), 'Long', repeat('x',4001)), '22023', null, 'description limit');
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,%L)', pg_temp.k(3), 'Not mine','x', pg_temp.j(2)), '42501', null, 'forged link to another homeowner''s job refused');
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,%L)', pg_temp.k(4), 'Missing','x', gen_random_uuid()), '42501', null, 'unknown job refused without revealing it');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select throws_ok(format('select public.open_support_ticket(%L,%L,%L,%L)', pg_temp.k(5), 'Other provider','x', pg_temp.j(1)), '42501', null, 'unrelated provider cannot link the job');
reset role;
insert into fx select 'a_linked', (pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,%L)', pg_temp.k(6), 'About my service','Running late?', pg_temp.j(1)))->>'ticket_id')::uuid;
insert into fx select 'p_linked', (pg_temp.call(3, format('select public.open_support_ticket(%L,%L,%L,%L)', pg_temp.k(7), 'Gate code','Need access', pg_temp.j(1)))->>'ticket_id')::uuid;
select is((select (user_id, opened_by, issue_type, status) from public.support_tickets where id = pg_temp.id('p_linked')),
  (pg_temp.u(3), pg_temp.u(3), 'general'::text, 'open'::text), 'provider ticket owned by the provider, general, open');
select is((select (status, disputed) from public.service_requests where id = pg_temp.j(1)), ('vendor_completed'::public.request_status, false),
  'contacting support changes no service state');
select is((select count(*) from public.disputes), 0::bigint, 'contacting support opens no dispute');
select is((select count(*) from public.support_ticket_events where ticket_id = pg_temp.id('a_general') and action = 'opened'), 1::bigint, 'opening is recorded');
select ok((select response_due_at is not null and queue_owner = 'project_owner' from public.support_tickets where id = pg_temp.id('a_general')), 'routed under CFG-010');

-- Operator-filed work on A's service (as 6.9 commands do) is not A's support request.
insert into public.support_tickets(user_id,subject,description,issue_type,job_id,opened_by,next_action)
  values (pg_temp.u(1),'Service operation: provider cancel','Provider reason','schedule_exception',pg_temp.j(3)::text,pg_temp.u(3),'Internal: assess full refund');
insert into fx select 'ops_item', id from public.support_tickets where issue_type = 'schedule_exception' and job_id = pg_temp.j(3)::text;

-- ── Requester reads ─────────────────────────────────────────────────────────────────────────
select is(jsonb_array_length(pg_temp.call(1, 'select public.my_support_tickets()')->'items'), 2, 'A sees the two requests A opened');
select is(jsonb_array_length(pg_temp.call(2, 'select public.my_support_tickets()')->'items'), 0, 'B sees none of A''s');
select is(jsonb_array_length(pg_temp.call(3, 'select public.my_support_tickets()')->'items'), 1, 'provider sees only its own request');
select ok(not (pg_temp.call(1, 'select public.my_support_tickets()')::text ~ '(next_action|queue_owner|Internal: assess|history|assigned_to)'),
  'requester list carries no queue internals and no operator-filed item');
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok(format('select public.support_ticket_detail(%L)', pg_temp.id('a_general')), '42501', null, 'B cannot read A''s request');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(format('select public.support_ticket_detail(%L)', pg_temp.id('a_linked')), '42501', null, 'the job''s provider cannot read the homeowner''s request');
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.support_ticket_detail(%L)', pg_temp.id('ops_item')), '42501', null, 'homeowner cannot read an operator-filed item');
reset role;
select ok(pg_temp.call(1, format('select public.support_ticket_detail(%L)', pg_temp.id('a_general'))) ? 'messages'
  and not pg_temp.call(1, format('select public.support_ticket_detail(%L)', pg_temp.id('a_general'))) ? 'next_action', 'requester detail without internals');

-- ── Replies and internal notes ──────────────────────────────────────────────────────────────
select is(pg_temp.call(1, format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(10), 'More detail'))->'replayed', 'false'::jsonb, 'requester replies');
select is(pg_temp.call(1, format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(10), 'More detail'))->'replayed', 'true'::jsonb, 'reply retry is replayed');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(10), 'Different'), '22023', null, 'reused reply key refused');
select throws_ok(format('select public.add_support_note(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(11), 'x'), '42501', null, 'requester cannot write internal notes');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok(format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(12), 'Intrude'), '42501', null, 'B cannot reply on A''s request');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select throws_ok(format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_linked'), pg_temp.k(13), 'Intrude'), '42501', null, 'provider cannot reply on the homeowner''s request');
reset role;
select ok(pg_temp.call(5, format('select public.add_support_note(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(14), 'Internal: customer is a repeat caller')) is not null, 'operator adds an internal note');
select ok(pg_temp.call(5, format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(15), 'Refunds show as pending until settled.')) is not null, 'operator replies');
select is(jsonb_array_length(pg_temp.call(1, format('select public.support_ticket_detail(%L)', pg_temp.id('a_general')))->'messages'), 2, 'requester sees two participant messages');
select ok(not (pg_temp.call(1, format('select public.support_ticket_detail(%L)', pg_temp.id('a_general')))::text like '%repeat caller%'), 'internal note never reaches the requester');
select ok(not (pg_temp.call(1, 'select public.my_support_tickets()')::text like '%repeat caller%'), 'nor the requester list');
select is(jsonb_array_length(pg_temp.call(5, format('select public.support_ticket_detail(%L)', pg_temp.id('a_general')))->'messages'), 3, 'operations sees the note too');
select throws_ok($$update public.support_ticket_messages set body = 'rewritten'$$, '42501', null, 'messages are append-only');

-- ── Triage: stale, keyed, reasoned ──────────────────────────────────────────────────────────
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L)', pg_temp.id('a_general'), pg_temp.k(20), 'resolved'), '42501', null, 'requester cannot triage');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L)', pg_temp.id('a_general'), pg_temp.k(21), 'in-progress'), '22023', null, 'reason required');
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,null,%L,null,%L)', pg_temp.id('a_general'), pg_temp.k(22), pg_temp.u(1), 'Assign'), '22023', null, 'assignee must be an operator');
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(23), 'open', 'Same'), '22023', null, 'no-op refused');
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(24), 'pending', 'Bad'), '22023', null, 'unknown status refused');
reset role;
select is(pg_temp.call(5, format('select public.admin_update_support_ticket(%L,%L,0,%L,%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(25),
  'in-progress', pg_temp.u(6), 'Explain refund timing', 'Taking this'))->'version', '1'::jsonb, 'triage bumps the version');
select is(pg_temp.call(5, format('select public.admin_update_support_ticket(%L,%L,0,%L,%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(25),
  'in-progress', pg_temp.u(6), 'Explain refund timing', 'Taking this'))->'replayed', 'true'::jsonb, 'triage retry is replayed');
select pg_temp.as_user(6);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(26), 'resolved', 'Stale'), '40001', null, 'stale version refused');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,1,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(25), 'resolved', 'Other'), '22023', null, 'reused triage key with a different change refused');
reset role;
select is((select array_agg(action order by seq) from public.support_ticket_events where ticket_id = pg_temp.id('a_general')),
  array['opened','status','assigned','next_action'], 'history records each change once');
select is((select count(distinct reason) from public.support_ticket_events where ticket_id = pg_temp.id('a_general') and action <> 'opened'), 1::bigint, 'with its reason');
select throws_ok($$delete from public.support_ticket_events$$, '42501', null, 'history is append-only');
select ok(pg_temp.call(6, format('select public.admin_update_support_ticket(%L,%L,1,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(27), 'resolved', 'Answered')) is not null, 'operator resolves');
select ok((select closed_at is not null from public.support_tickets where id = pg_temp.id('a_general')), 'closed_at recorded');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.post_support_message(%L,%L,%L)', pg_temp.id('a_general'), pg_temp.k(28), 'Still broken'), '22023', null, 'requester cannot reply on a resolved request');
reset role;
select ok(pg_temp.call(5, format('select public.admin_update_support_ticket(%L,%L,2,%L,null,null,%L)', pg_temp.id('a_general'), pg_temp.k(29), 'open', 'Customer called back')) is not null, 'operations reopens with a reason');
select ok((select closed_at is null and version = 3 from public.support_tickets where id = pg_temp.id('a_general')), 'reopened: closed_at cleared, version 3');

-- ── Disputes: completion binding, evidence, decisions, appeals ──────────────────────────────
select is(pg_temp.call(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L))', pg_temp.j(1), 'Edges not trimmed')) is not null, true, 'homeowner files within 48 h');
insert into fx select 'd1', id from public.disputes where job_id = pg_temp.j(1);
insert into fx select 'd1_ticket', ticket_id from public.disputes where job_id = pg_temp.j(1);
select is((select completion_at from public.disputes where id = pg_temp.id('d1')), (select vendor_completed_at from public.service_requests where id = pg_temp.j(1)),
  'dispute bound to the completion it questions');
select throws_ok(format($$update public.disputes set completion_at = now() where id = %L$$, pg_temp.id('d1')), '42501', null, 'completion binding is immutable');
select is((select opened_by from public.support_tickets where id = pg_temp.id('d1_ticket')), pg_temp.u(1), 'dispute ticket opened by the homeowner');
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('d1_ticket'), pg_temp.k(30), 'resolved', 'Close'), '22023', null, 'dispute ticket cannot be closed outside the decision');
reset role;
select ok(pg_temp.call(5, format('select public.admin_update_support_ticket(%L,%L,0,null,%L,null,%L)', pg_temp.id('d1_ticket'), pg_temp.k(31), pg_temp.u(5), 'Mine')) is not null, 'but it can be assigned');

-- Evidence: photos in their uploader's folder, on this job, from a participant.
select pg_temp.as_user(1);
set local role authenticated;
insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type) values
  ('a3030000-0000-4000-8000-000000000001',auth.uid(),'homeowner',auth.uid()||'/a3030000-0000-4000-8000-000000000001/issue-1.jpg','issue'),
  ('a3030000-0000-4000-8000-000000000003',auth.uid(),'homeowner',auth.uid()||'/a3030000-0000-4000-8000-000000000003/other-visit.jpg','issue');
select throws_ok($$insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type)
  values ('a3030000-0000-4000-8000-000000000001',auth.uid(),'homeowner','a1030000-0000-4000-8000-000000000003/a3030000-0000-4000-8000-000000000001/p.jpg','issue')$$,
  '42501', null, 'S5: a photo record cannot name another user''s object');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type) values
  ('a3030000-0000-4000-8000-000000000001',auth.uid(),'vendor',auth.uid()||'/a3030000-0000-4000-8000-000000000001/after.jpg','after');
select throws_ok($$insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type)
  values ('a3030000-0000-4000-8000-000000000001',auth.uid(),'vendor','a1030000-0000-4000-8000-000000000001/a3030000-0000-4000-8000-000000000001/issue-1.jpg','after')$$,
  '42501', null, 'S5: provider cannot point a record at the homeowner''s object');
reset role;
insert into fx select 'a_photo', id from public.job_photos where photo_url like '%/issue-1.jpg';
insert into fx select 'a_other_visit', id from public.job_photos where photo_url like '%/other-visit.jpg';
insert into fx select 'p_photo', id from public.job_photos where photo_url like '%/after.jpg';
insert into storage.objects(bucket_id,name,owner) values
  ('job-photos', pg_temp.u(1)||'/'||pg_temp.j(1)||'/issue-1.jpg', pg_temp.u(1)),
  ('job-photos', pg_temp.u(2)||'/private/secret.jpg', pg_temp.u(2));
select is(pg_temp.call(3, format($$select to_jsonb(count(*)) from storage.objects where bucket_id = 'job-photos' and name = %L$$, pg_temp.u(1)||'/'||pg_temp.j(1)||'/issue-1.jpg')),
  '1'::jsonb, 'the job''s provider sees the homeowner''s job photo');
select is(pg_temp.call(4, format($$select to_jsonb(count(*)) from storage.objects where bucket_id = 'job-photos' and name = %L$$, pg_temp.u(1)||'/'||pg_temp.j(1)||'/issue-1.jpg')),
  '0'::jsonb, 'an unrelated provider does not');
select is(pg_temp.call(3, $$select to_jsonb(count(*)) from storage.objects where bucket_id = 'job-photos' and name like 'a1030000-0000-4000-8000-000000000002/%'$$),
  '0'::jsonb, 'nor does anyone see an unlinked object of another user');

select is(pg_temp.call(1, format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(40), 'Front edge missed'))->'replayed', 'false'::jsonb, 'homeowner statement');
select is(pg_temp.call(1, format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(40), 'Front edge missed'))->'replayed', 'true'::jsonb, 'statement retry replayed');
select is(pg_temp.call(1, format('select public.add_dispute_submission(%L,%L,null,%L)', pg_temp.id('d1'), pg_temp.k(41), pg_temp.id('a_photo')))->'replayed', 'false'::jsonb, 'homeowner attaches its own photo of this job');
select is(pg_temp.call(3, format('select public.add_dispute_submission(%L,%L,%L,%L)', pg_temp.id('d1'), pg_temp.k(42), 'Edges done; see photo', pg_temp.id('p_photo')))->'replayed', 'false'::jsonb, 'provider participates with its own photo');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(40), 'Changed'), '22023', null, 'reused submission key refused');
select throws_ok(format('select public.add_dispute_submission(%L,%L,null,%L)', pg_temp.id('d1'), pg_temp.k(43), pg_temp.id('a_other_visit')), '42501', null, 'photo from another visit refused');
select throws_ok(format('select public.add_dispute_submission(%L,%L,null,%L)', pg_temp.id('d1'), pg_temp.k(44), pg_temp.id('p_photo')), '42501', null, 'the other party''s photo refused');
select throws_ok(format('select public.add_dispute_submission(%L,%L,null,%L)', pg_temp.id('d1'), pg_temp.k(45), pg_temp.id('a_photo')), '22023', null, 'a photo attaches once');
select throws_ok(format('select public.add_dispute_submission(%L,%L,null,null)', pg_temp.id('d1'), pg_temp.k(46)), '22023', null, 'empty submission refused');
select throws_ok(format($$delete from public.job_photos where id = %L$$, pg_temp.id('a_photo')), '42501', null, 'attached evidence cannot be deleted');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok(format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(47), 'x'), '42501', null, 'another homeowner refused');
select throws_ok(format('select public.dispute_detail(%L)', pg_temp.j(1)), '42501', null, 'another homeowner cannot read the dispute');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select throws_ok(format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(48), 'x'), '42501', null, 'an unrelated provider refused');
select throws_ok(format('select public.dispute_detail(%L)', pg_temp.j(1)), '42501', null, 'an unrelated provider cannot read the dispute');
reset role;
select is(jsonb_array_length(pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'disputes'->0->'submissions'), 3, 'both parties'' submissions in history');
select ok(pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(1))) ? 'refund'
  and pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'payout' = 'null'::jsonb, 'homeowner: refund state, no payout');
select ok(pg_temp.call(3, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'refund' = 'null'::jsonb
  and pg_temp.call(3, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'payout'->>'state' = 'no_payment_record', 'provider: payout state, no refund');
select ok(pg_temp.call(3, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'disputes'->0->'ticket_number' = 'null'::jsonb, 'provider does not see the homeowner''s ticket');

-- Decisions: operations only, stale-guarded, keyed, history append-only.
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(50), 'open', 'resolved', 'Self'), '42501', null, 'homeowner cannot decide');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(51), 'vendor_contacted', 'resolved', 'Stale'), '40001', null, 'stale status refused');
select throws_ok(format('select public.admin_decide_dispute(%L,%L,%L,1,%L,%L)', pg_temp.id('d1'), pg_temp.k(52), 'open', 'resolved', 'Stale'), '40001', null, 'stale version refused');
reset role;
select is(pg_temp.call(5, format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(53), 'open', 'vendor_contacted', 'Asked provider for photos'))->>'status',
  'vendor_contacted', 'follow-up recorded');
select is(pg_temp.call(5, format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(53), 'open', 'vendor_contacted', 'Asked provider for photos'))->'replayed',
  'true'::jsonb, 'decision retry replayed');
select is(pg_temp.call(5, format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(54), 'vendor_contacted', 'resolved', 'Provider returns to trim edges'))->'resolution_version',
  '1'::jsonb, 'resolution recorded as version 1');
select pg_temp.as_user(6);
set local role authenticated;
select throws_ok(format('select public.admin_decide_dispute(%L,%L,%L,0,%L,%L)', pg_temp.id('d1'), pg_temp.k(55), 'vendor_contacted', 'resolved', 'Concurrent other decision'), '40001', null, 'a second operator on the old version is refused');
reset role;
select is((select status from public.service_requests where id = pg_temp.j(1)), 'resolved'::public.request_status, 'service moved by the existing dispute effects');
select is((select status from public.support_tickets where id = pg_temp.id('d1_ticket')), 'resolved', 'dispute ticket follows the decision');
select is((select array_agg(to_value order by seq) from public.support_ticket_events where ticket_id = pg_temp.id('d1_ticket') and action = 'status'), array['resolved'],
  'its status history shows the resolution (the follow-up kept it open)');
select ok((select count(*) from public.support_ticket_events where ticket_id = pg_temp.id('d1_ticket') and action = 'next_action') >= 2, 'and each decision step''s next action');
select is((select array_agg(to_status::text order by seq) from public.dispute_decisions where dispute_id = pg_temp.id('d1')), array['vendor_contacted','resolved'], 'decision history');
select throws_ok($$update public.dispute_decisions set notes = 'rewritten'$$, '42501', null, 'decision history append-only');
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok(format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d1'), pg_temp.k(56), 'Late'), '22023', null, 'no submissions after a decision');
-- Appeal binds to the version read.
select throws_ok(format('select public.appeal_dispute_resolution(%L,%L,0)', pg_temp.id('d1'), 'Appeal of an old view'), '40001', null, 'appeal of a stale decision refused');
reset role;
insert into fx select 'appeal1', (pg_temp.call(1, format('select to_jsonb(public.appeal_dispute_resolution(%L,%L,1))', pg_temp.id('d1'), 'Still not trimmed'))#>>'{}')::uuid;
select is((pg_temp.call(1, format('select to_jsonb(public.appeal_dispute_resolution(%L,%L,1))', pg_temp.id('d1'), 'Still not trimmed'))#>>'{}')::uuid, pg_temp.id('appeal1'), 'appeal retry returns the same ticket');
select is((pg_temp.call(1, format('select to_jsonb(public.appeal_dispute_resolution(%L,%L))', pg_temp.id('d1'), 'Still not trimmed'))#>>'{}')::uuid, pg_temp.id('appeal1'), 'the old two-argument path agrees');
select is((select (status, resolution_notes) from public.disputes where id = pg_temp.id('d1')), ('escalated'::public.dispute_status, 'Provider returns to trim edges'::text), 'appeal escalates and keeps the decision');
select ok((select disputed from public.service_requests where id = pg_temp.j(1)), 'payout hold input restored by the appeal');
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('appeal1'), pg_temp.k(57), 'resolved', 'Close'),
  '22023', null, 'S4: appeal ticket cannot be resolved outside the decision (payout hold input)');
reset role;
select is((select status from public.support_tickets where id = pg_temp.id('appeal1')), 'open', 'appeal ticket stays open');
select is(pg_temp.call(5, format('select public.admin_decide_dispute(%L,%L,%L,1,%L,%L)', pg_temp.id('d1'), pg_temp.k(58), 'escalated', 'resolved', 'Appeal upheld: provider re-trims'))->'resolution_version',
  '2'::jsonb, 'appeal decided as version 2');
select is((select status from public.support_tickets where id = pg_temp.id('appeal1')), 'resolved', 'appeal ticket resolved by the decision');
select is((select array_agg(action order by seq) from public.dispute_decisions where dispute_id = pg_temp.id('d1')), array['decided','decided','appealed','decided'], 'full decision history');
select is(pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(1)))#>>'{disputes,0,decisions,3,by}', 'operations', 'participants see "operations", not the operator');
select is(pg_temp.call(5, format('select public.dispute_detail(%L)', pg_temp.j(1)))#>>'{disputes,0,decisions,3,by}', 'Synthetic support 5', 'operations sees who decided');
select is(pg_temp.call(3, format('select public.dispute_detail(%L)', pg_temp.j(1)))->'disputes'->0->'appeals', '[]'::jsonb, 'provider does not see the appeal text');
select is((select count(*) from public.money_refund_authorizations), (select refunds from money_before), 'no refund authorization written');
select is((select count(*) from public.money_holds), (select holds from money_before), 'no hold written or cleared');
select is((select count(*) from public.money_obligations), (select obligations from money_before), 'no obligation written');
select is((select count(*) from public.money_refunds), (select moved from money_before), 'no refund movement');

-- ── Review appeals: the ticket closes only after the decision ───────────────────────────────
insert into public.reviews(id,service_request_id,customer_id,contractor_id,rating,moderation_state) values
  ('a8030000-0000-4000-8000-000000000001',pg_temp.j(4),pg_temp.u(1),'a2030000-0000-4000-8000-000000000001',2,'appealed');
insert into public.support_tickets(user_id,subject,description,issue_type,job_id,opened_by)
  values (pg_temp.u(1),'Review moderation appeal','Please republish','review_appeal',pg_temp.j(4)::text,pg_temp.u(1));
insert into fx select 'review_ticket', id from public.support_tickets where issue_type = 'review_appeal' and job_id = pg_temp.j(4)::text;
insert into public.review_history(review_id,actor_id,action,before_value,reason,ticket_id)
  values ('a8030000-0000-4000-8000-000000000001',pg_temp.u(1),'appealed','{}'::jsonb,'Please republish',pg_temp.id('review_ticket'));
select pg_temp.as_user(5);
set local role authenticated;
select throws_ok(format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('review_ticket'), pg_temp.k(60), 'resolved', 'Done'), '22023', null, 'review appeal ticket waits for the decision');
reset role;
select is((pg_temp.call(5, 'select public.admin_support_queue()')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('review_ticket'), 'decision_recorded', false)), true, 'queue shows the decision is pending');
update public.reviews set moderation_state = 'published' where id = 'a8030000-0000-4000-8000-000000000001';
select is((pg_temp.call(5, 'select public.admin_support_queue()')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('review_ticket'), 'decision_recorded', true)), true, 'and then that it is recorded');
select ok(pg_temp.call(5, format('select public.admin_update_support_ticket(%L,%L,0,%L,null,null,%L)', pg_temp.id('review_ticket'), pg_temp.k(61), 'resolved', 'Upheld and republished')) is not null, 'then it closes');

-- ── Operations queue ────────────────────────────────────────────────────────────────────────
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok('select public.admin_support_queue()', '42501', null, 'homeowner cannot read the queue');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select throws_ok('select public.admin_support_queue()', '42501', null, 'provider cannot read the queue');
reset role;
update public.support_tickets set response_due_at = now() - interval '1 minute' where id = pg_temp.id('p_linked');
select ok((pg_temp.call(5, 'select public.admin_support_queue()')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('p_linked'), 'overdue', true)), 'overdue flagged');
select ok((pg_temp.call(5, 'select public.admin_support_queue()')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('ops_item'), 'next_action', 'Internal: assess full refund')), 'operator-filed item in the queue with its next action');
select ok((pg_temp.call(5, 'select public.admin_support_queue()')->'counts'->>'open')::integer >= 4, 'open count');
select ok(not (pg_temp.call(5, 'select public.admin_support_queue()')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('review_ticket'))), 'closed items leave the default queue');
select ok((pg_temp.call(5, 'select public.admin_support_queue(true)')->'items') @> jsonb_build_array(jsonb_build_object('ticket_id', pg_temp.id('review_ticket'))), 'and appear with closed included');

select * from finish();
rollback;
