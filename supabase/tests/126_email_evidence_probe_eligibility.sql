-- TRACE-155 (Phase 7.3D-1 review fixes, migration 20261129001000): whole-provider-ID probe
-- exclusion (D-11) with logical expiry.
-- Shape and privileges of the restated probe readback; non-operator refusals; a content-conflicted
-- receipt beside an otherwise valid expected-event receipt for the same provider ID, in either
-- arrival order; every disqualifying kind (content conflict, stored identity conflict, tag, link)
-- beside a valid receipt; expired disqualifying receipts beside current valid ones, including the
-- exact expiry boundary; expired receipts never returned or counted, while still stored until a
-- purge; read purity; nothing else restated.
-- Synthetic identities and content only. Nothing is sent. Every change rolls back.
begin;
select no_plan();

-- 1 operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1260000-0000-4000-8000-000000000001','probe-operator@example.test',now(),'{}'),
 ('e1260000-0000-4000-8000-000000000002','probe-homeowner@example.test',now(),'{}'),
 ('e1260000-0000-4000-8000-000000000003','probe-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1260000-0000-4000-8000-000000000001','admin'),
 ('e1260000-0000-4000-8000-000000000002','homeowner'),
 ('e1260000-0000-4000-8000-000000000003','vendor')
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
 select pg_temp.run('e1260000-0000-4000-8000-000000000001','authenticated',p_sql) $$;

-- The route's receive call, exactly as SQL 121, 122, 124 and 125 make it.
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

create function pg_temp.probe(p_email text) returns jsonb language sql as $$
 select pg_temp.op(format('select public.email_evidence_probe_readback(%L)', p_email)) $$;
-- The readback condensed: not_probe, then event:state for each returned receipt in order.
create function pg_temp.pv(p_email text) returns text language sql as $$
 select (p->>'not_probe')||'|'||coalesce((select string_agg(r->>'event_type'||':'||(r->>'state'), ',' order by o)
                                           from jsonb_array_elements(p->'receipts') with ordinality x(r, o)), '')
   from (select pg_temp.probe(p_email) as p) y $$;
create function pg_temp.st(p_id text) returns text language sql as $$
 select private.email_evidence_receipt_state(e) from private.email_provider_events e where svix_id = p_id $$;
create function pg_temp.cls(p_id text) returns text language sql as $$
 select identity_class from private.email_provider_events where svix_id = p_id $$;
-- A stored receipt written directly at a chosen expiry (the receive function always sets a future one).
create function pg_temp.stored(p_id text, p_email text, p_expires timestamptz, p_type text default 'email.delivered',
  p_class text default 'unmatched', p_content_conflict boolean default false, p_tag_ledger text default null)
returns void language sql as $$
 insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,
   provider_created_at,provider_email_id,bounce_type,bounce_subtype,identity_class,content_conflict,conflict_seen_at,
   tag_ledger,tag_ref,tag_attempt)
 values (p_id, now()-interval '40 days', p_expires, 'current', 'recorded', p_type, p_type, now()-interval '40 days', p_email,
   case when p_type='email.bounced' then 'permanent' end, case when p_type='email.bounced' then 'general' end,
   p_class, p_content_conflict, case when p_content_conflict then now()-interval '39 days' end,
   p_tag_ledger, case when p_tag_ledger is not null then 'e1263000-0000-4000-8000-000000000001'::uuid end,
   case when p_tag_ledger is not null then 1 end) $$;

-- Contact submissions 1..5, each with its pending owner-email row from the 7.2C-1 trigger.
insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 select ('e1262000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic','Sender','probe-sender@example.test',null,'Synthetic','Synthetic body'
   from generate_series(1,5) n;
create function pg_temp.oe(p_n int) returns uuid language sql as $$
 select id from private.owner_email_notifications
  where contact_submission_id = ('e1262000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.sent(p_n int, p_email text) returns void language sql as $$
 update private.owner_email_notifications set state='sent', attempts=1, claimed_at=now(), sent_at=now(), provider_message_id=p_email
  where id = pg_temp.oe(p_n) $$;
-- Everything a read could touch.
create function pg_temp.world() returns text language sql as $$
 select md5(concat_ws('#',
   (select string_agg(to_jsonb(a)::text, ',' order by seq) from private.email_evidence_arming_events a),
   (select string_agg(to_jsonb(c)::text, ',') from private.email_evidence_config c),
   (select string_agg(to_jsonb(e)::text, ',' order by svix_id) from private.email_provider_events e),
   (select string_agg(to_jsonb(p)::text, ',' order by id) from private.email_provider_event_purges p),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.owner_email_notifications n))) $$;

-- 1. Shape and privileges of the restated function ------------------------------------------------
select is((select p.provolatile::text||':'||p.prosecdef::text||':'||array_to_string(p.proconfig, ';')||':'||
                  pg_get_function_identity_arguments(p.oid)||':'||format_type(p.prorettype, null)
             from pg_proc p where p.oid = 'public.email_evidence_probe_readback(text)'::regprocedure),
 's:true:search_path="":p_provider_email_id text:jsonb', 'the probe readback keeps its signature, stability, definer and empty search_path');
select is((select string_agg(r, ',' order by r) from unnest(array['anon','authenticated','service_role']) r
  where has_function_privilege(r, 'public.email_evidence_probe_readback(text)', 'execute')),
 'authenticated', 'only authenticated may execute it (each call still requires an operator)');
select ok((select prosrc like '%email_evidence_receipt_state%' and prosrc like '%content_conflict%'
             from pg_proc where oid = 'public.email_evidence_probe_readback(text)'::regprocedure),
 'eligibility reads receipts through the shared trust and expiry predicate, including the content-conflict state');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.proname like '%email\_evidence\_probe%'), 2,
 'no function is added: the probe has only its authorization check and its readback');

-- 2. Operator only --------------------------------------------------------------------------------
select is(pg_temp.recv('msg-r-1','email.delivered','em-r'),'recorded','a probe receipt to read');
create temp table w_refusals as select pg_temp.world() as digest;
grant select on w_refusals to public;
create temp table d2_refusals(who text, outcome text);
grant all on d2_refusals to public;
do $$
declare r record;
begin
  for r in select * from (values ('anon', null::uuid, 'anon'), ('service', null::uuid, 'service_role'),
      ('homeowner', 'e1260000-0000-4000-8000-000000000002'::uuid, 'authenticated'),
      ('vendor', 'e1260000-0000-4000-8000-000000000003'::uuid, 'authenticated'),
      ('no role', gen_random_uuid(), 'authenticated')) v(who, sub, role) loop
    begin
      perform pg_temp.run(r.sub, r.role, 'select public.email_evidence_probe_readback(''em-r'')');
      insert into d2_refusals values (r.who, 'allowed');
    exception when others then
      reset role;
      insert into d2_refusals values (r.who, sqlstate);
    end;
  end loop;
end $$;
select is((select string_agg(who||':'||outcome, ',' order by who) from d2_refusals),
 'anon:42501,homeowner:42501,no role:42501,service:42501,vendor:42501',
 'anon, the service role, a homeowner, a vendor and a user with no role are refused (42501)');
select is(pg_temp.world(), (select digest from w_refusals), 'refused reads change nothing');
select throws_ok('select pg_temp.run(''e1260000-0000-4000-8000-000000000001'',''authenticated'',
  ''select count(*) from private.email_provider_events'')', '42501', null, 'an operator session cannot read receipts directly');

-- 3. D-11: a content conflict beside an otherwise valid expected-event receipt ----------------------
-- A bounced probe: the expected email.bounced arrives valid; a second report for the same ID is
-- then re-delivered under its svix-id with a changed payload, which flags it content_conflict.
select is(pg_temp.recv('msg-a-sent','email.sent','em-a'),'recorded','A: sent');
select is(pg_temp.recv('msg-a-bounce','email.bounced','em-a',p_bounce=>'permanent',p_created=>'2026-11-20T10:00:01Z'),'recorded','A: the expected bounce');
select is(pg_temp.pv('em-a'), 'false|email.sent:unlinked,email.bounced:unlinked', 'A: before any conflict the ID is probe evidence');
select is(pg_temp.recv('msg-a-x','email.delivered','em-a',p_created=>'2026-11-20T10:00:02Z'),'recorded','A: a third report');
select is(pg_temp.recv('msg-a-x','email.complained','em-a',p_created=>'2026-11-20T10:00:02Z'),'conflict','A: re-sent under the same svix-id with a changed payload');
select is(pg_temp.st('msg-a-x')||'|'||pg_temp.cls('msg-a-x')||'|'||pg_temp.st('msg-a-bounce'), 'content_conflict|unmatched|unlinked',
 'A: the third report is content-conflicted while still unmatched; the bounce is still an unlinked receipt');
select is(pg_temp.probe('em-a'), jsonb_build_object('checked_at', now(), 'not_probe', true, 'receipts', '[]'::jsonb),
 'A: the whole ID is excluded and nothing is returned, not even the valid expected bounce (20261128001000 returned it)');

-- The same in the other arrival order: the conflict exists before the expected report.
select is(pg_temp.recv('msg-b-x','email.delivered','em-b'),'recorded','B: a report');
select is(pg_temp.recv('msg-b-x','email.bounced','em-b',p_bounce=>'transient'),'conflict','B: content conflict first');
select is(pg_temp.recv('msg-b-bounce','email.bounced','em-b',p_bounce=>'permanent',p_created=>'2026-11-20T10:00:03Z'),'recorded','B: then the expected bounce');
select is(pg_temp.pv('em-b'), 'true|', 'B: excluded whatever the arrival order');

-- Every disqualifying kind, each beside a valid unlinked expected-event receipt for the same ID.
-- Stored identity conflict: a report whose mm_* tags are invalid.
select is(pg_temp.recv('msg-c-ok','email.delivered','em-c'),'recorded','C: a valid delivered report');
select is(pg_temp.recv('msg-c-tag','email.delivered','em-c','invalid'),'recorded','C: a report with invalid tags');
select is(pg_temp.st('msg-c-tag'), 'stored_conflict', 'C: classed as a stored identity conflict');
select is(pg_temp.pv('em-c'), 'true|', 'C: a stored identity conflict excludes the whole ID');
-- Linked: the ID later became a ledger send's recorded ID, so a later report links to that row.
select is(pg_temp.recv('msg-d-ok','email.delivered','em-d'),'recorded','D: a valid report before any ledger row names the ID');
select pg_temp.sent(1, 'em-d');
select is(pg_temp.recv('msg-d-link','email.delivered','em-d'),'recorded','D: a later report for the same ID');
select is(pg_temp.cls('msg-d-ok')||'|'||pg_temp.cls('msg-d-link'), 'unmatched|id_only', 'D: the earlier report stays unmatched; the later one is linked');
select is(pg_temp.pv('em-d'), 'true|', 'D: a linked receipt excludes the whole ID');
-- Tagged and linked: a valid tag naming a ledger row whose recorded ID is this one.
select pg_temp.sent(2, 'em-e');
select is(pg_temp.recv('msg-e-ok','email.delivered','em-f'),'recorded','E: an unrelated valid probe ID');
select is(pg_temp.recv('msg-e-tag','email.delivered','em-e','valid','owner_email',pg_temp.oe(2),1),'recorded','E: a tagged report');
select is(pg_temp.cls('msg-e-tag'), 'tag_and_id', 'E: tagged and linked');
select is(pg_temp.pv('em-e')||' / '||pg_temp.pv('em-f'), 'true| / false|email.delivered:unlinked',
 'E: the tagged ID is excluded; another ID is unaffected');
-- A stored tag on a conflicted receipt written directly (tag_ledger set, identity conflict).
select pg_temp.stored('msg-g-tag', 'em-g', now() + interval '1 day', p_class=>'conflict_disagree', p_tag_ledger=>'owner_email');
select is(pg_temp.recv('msg-g-ok','email.delivered','em-g'),'recorded','G: a valid report');
select is(pg_temp.pv('em-g'), 'true|', 'G: a tagged, conflicted receipt excludes the whole ID');

-- 4. Logical expiry: expired receipts never affect eligibility or output ----------------------------
-- Every receive purges up to 100 expired receipts, so all receives in this section come first and
-- expired rows are written afterwards (none is purged before the checks below).
select is(pg_temp.recv('msg-h-ok','email.bounced','em-h',p_bounce=>'permanent'),'recorded','H: a current expected bounce');
select is(pg_temp.recv('msg-i-link','email.delivered','em-i'),'recorded','I: a report');
select pg_temp.sent(3, 'em-i');
select is(pg_temp.recv('msg-i-link2','email.delivered','em-i'),'recorded','I: a linked report');
select is(pg_temp.pv('em-i'), 'true|', 'I: while the linked receipt is current, the ID is excluded');
-- Each kind of disqualifying receipt, expired, beside H's current valid expected-event receipt.
select pg_temp.stored('msg-h-cc', 'em-h', now() - interval '1 second', 'email.complained', p_content_conflict=>true);
select pg_temp.stored('msg-h-tag', 'em-h', now() - interval '1 day', p_class=>'conflict_tag_invalid');
select pg_temp.stored('msg-h-dis', 'em-h', now() - interval '2 days', p_class=>'conflict_disagree', p_tag_ledger=>'application');
select is((select string_agg(pg_temp.st(svix_id), ',' order by pg_temp.st(svix_id), svix_id) from private.email_provider_events where provider_email_id='em-h'),
 'expired,expired,expired,unlinked', 'H: three expired disqualifying receipts and one current unlinked receipt are stored');
select is(pg_temp.pv('em-h'), 'false|email.bounced:unlinked',
 'H: expired disqualifying receipts do not exclude the ID and are not returned; the current bounce is');
-- I's linked receipt expires (test-only rewrite of its expiry; the guard forbids it otherwise).
alter table private.email_provider_events disable trigger user;
update private.email_provider_events set expires_at = now() - interval '1 second', received_at = now() - interval '40 days'
 where svix_id = 'msg-i-link2';
alter table private.email_provider_events enable trigger user;
select is(pg_temp.st('msg-i-link2'), 'expired', 'I: the linked receipt has now expired');
select is(pg_temp.pv('em-i'), 'false|email.delivered:unlinked', 'I: once it expires, it no longer excludes the ID');

-- The exact boundary: expires_at = now() is expired; one microsecond later is current.
select pg_temp.stored('msg-j-cc', 'em-j', now(), 'email.complained', p_content_conflict=>true);
select pg_temp.stored('msg-j-ok', 'em-j', now() + interval '1 day', 'email.bounced');
select is(pg_temp.st('msg-j-cc'), 'expired', 'J: a receipt expiring exactly now is expired');
select is(pg_temp.pv('em-j'), 'false|email.bounced:unlinked', 'J: at its exact expiry a content conflict no longer excludes the ID');
select pg_temp.stored('msg-k-cc', 'em-k', now() + interval '1 microsecond', 'email.complained', p_content_conflict=>true);
select pg_temp.stored('msg-k-ok', 'em-k', now() + interval '1 day', 'email.bounced');
select is(pg_temp.st('msg-k-cc'), 'content_conflict', 'K: one microsecond before expiry it is still current');
select is(pg_temp.pv('em-k'), 'true|', 'K: and it still excludes the whole ID');
-- The same boundary for a tagged, conflicted receipt (judged by its stored tag, not only its state).
select pg_temp.stored('msg-n-tag', 'em-n', now(), p_class=>'conflict_disagree', p_tag_ledger=>'owner_email');
select pg_temp.stored('msg-n-ok', 'em-n', now() + interval '1 day', 'email.bounced');
select is(pg_temp.pv('em-n'), 'false|email.bounced:unlinked', 'N: a tagged receipt expiring exactly now no longer excludes the ID');
select pg_temp.stored('msg-o-tag', 'em-o', now() + interval '1 microsecond', p_class=>'conflict_disagree', p_tag_ledger=>'owner_email');
select pg_temp.stored('msg-o-ok', 'em-o', now() + interval '1 day', 'email.bounced');
select is(pg_temp.pv('em-o'), 'true|', 'O: one microsecond before expiry it still excludes the whole ID');
-- A valid receipt at its exact expiry is not returned; one microsecond earlier it is.
select pg_temp.stored('msg-l-gone', 'em-l', now(), 'email.bounced');
select pg_temp.stored('msg-l-live', 'em-l', now() + interval '1 microsecond', 'email.delivered');
select is(pg_temp.pv('em-l'), 'false|email.delivered:unlinked', 'L: an expired valid receipt is not returned; a current one is');
-- Only expired receipts: reads as no receipts yet, never as excluded.
select pg_temp.stored('msg-m-cc', 'em-m', now() - interval '1 second', p_content_conflict=>true);
select pg_temp.stored('msg-m-ok', 'em-m', now() - interval '1 second', 'email.bounced');
select is(pg_temp.probe('em-m'), jsonb_build_object('checked_at', now(), 'not_probe', false, 'receipts', '[]'::jsonb),
 'M: an ID with only expired receipts reads as no receipts, not as excluded and not as evidence');
select is((select count(*)::int from private.email_provider_events where expires_at <= now()), 9,
 'expired receipts are still stored until a purge (logical expiry, not deletion)');

-- 5. Physical purge changes nothing visible ---------------------------------------------------------
create temp table before_purge as
 select e as email, pg_temp.pv(e) as view from unnest(array['em-a','em-b','em-c','em-d','em-e','em-f','em-g','em-h','em-i','em-j','em-k','em-l','em-m','em-n','em-o']) e;
grant select on before_purge to public;
select is((pg_temp.op('select public.email_provider_events_purge(100)')->>'deleted')::int, 9, 'the operator purge deletes the nine expired receipts');
select is((select count(*)::int from before_purge b where pg_temp.pv(b.email) is distinct from b.view), 0,
 'every probe readback is identical before and after the purge');

-- 6. Read purity -------------------------------------------------------------------------------------
create temp table world_before as select pg_temp.world() as digest;
grant select on world_before to public;
select ok((select bool_and(pg_temp.probe(e) is not null) from unnest(array['em-a','em-c','em-d','em-h','em-k','em-never']) e),
 'read: probe readback for excluded, eligible and unknown IDs');
select is(pg_temp.world(), (select digest from world_before),
 'history, arming record, receipts, purge audit and ledger are byte-identical after every probe read');
select is((select string_agg(svix_id||':'||identity_class, ',' order by svix_id) from private.email_provider_events
  where svix_id in ('msg-a-bounce','msg-d-ok','msg-c-ok')), 'msg-a-bounce:unmatched,msg-c-ok:unmatched,msg-d-ok:unmatched',
 'reading never links, rematches or reclassifies a receipt');

-- 7. Nothing else is restated -----------------------------------------------------------------------
select is(md5(pg_get_functiondef('private.email_evidence_summary(text[],timestamptz)'::regprocedure)), '8eadddd6f47401258d747248a38ce507',
 'the summary keeps its 7.3D-1 definition');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['private.email_evidence_arming_events_guard()','private.email_evidence_transition(text,text)',
   'public.email_evidence_arm(text)','public.email_evidence_disarm(text)','private.email_evidence_retry_horizon()',
   'private.email_evidence_coverage(timestamptz)','public.email_evidence_arming_readback()',
   'public.email_evidence_probe_authorize()']::regprocedure[]::oid[])),
 '8|8fbc18c05a0ed9f360bc9b266423f509', 'the other eight 7.3D-1 functions are unchanged');
select is(md5(pg_get_functiondef('public.email_evidence_probe_readback(text)'::regprocedure)), 'bd5da284bbd54764df0986ac1153e529',
 'the restated probe readback (20261128001000 definition 2d02c820f1d7a7a5356636e1e5e6e19f)');

select * from finish();
rollback;
