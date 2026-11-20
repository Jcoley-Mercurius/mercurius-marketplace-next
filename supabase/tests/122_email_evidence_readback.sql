-- TRACE-155 (Phase 7.3C-1): owner-email correlation reference and read-only delivery evidence.
-- Shape, volatility and privileges; the correlation reference for both kinds; every §7.3 check
-- (S-37, S-38, S-57 as amended, same-row/different-attempt, cross-ledger, own-row-different-ID);
-- current-snapshot recovery after the competing record disappears; stored and content conflicts
-- staying excluded; rules 1–10 (S-39 to S-43, S-45, S-47, S-49) and S-44 permutations; S-48 no
-- rematch; additive counts with existing attention counts unchanged; one expiry predicate for
-- summary, history, counts and conflict signal (S-34 readback side, the >100-backlog replay);
-- output keys; read purity; unchanged legacy definitions.
-- Synthetic identities and content only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1220000-0000-4000-8000-000000000001','readback-operator@example.test',now(),'{}'),
 ('e1220000-0000-4000-8000-000000000002','readback-homeowner@example.test',now(),'{}'),
 ('e1220000-0000-4000-8000-000000000003','readback-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1220000-0000-4000-8000-000000000001','admin'),
 ('e1220000-0000-4000-8000-000000000002','homeowner'),
 ('e1220000-0000-4000-8000-000000000003','vendor')
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
 select pg_temp.run('e1220000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e1220000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;

-- The route's receive call, exactly as SQL 121 makes it.
create function pg_temp.recv(p_id text, p_type text, p_email text default null, p_tags text default 'absent',
  p_ledger text default null, p_ref uuid default null, p_attempt int default null,
  p_bounce text default null, p_created timestamptz default '2026-11-18T10:00:00Z')
returns text language sql as $$
 select pg_temp.svc(format('select public.email_receive_provider_event(p_svix_id=>%L,p_secret_slot=>%L,p_processing=>%L,p_event_type=>%L,'
   'p_provider_type=>%L,p_provider_created_at=>%L,p_provider_email_id=>%L,p_bounce_type=>%L,p_bounce_subtype=>%L,'
   'p_tag_status=>%L,p_tag_ledger=>%L,p_tag_ref=>%L,p_tag_attempt=>%L)',
   p_id,'current','recorded',p_type,p_type,p_created,p_email,p_bounce,case when p_bounce is not null then 'general' end,
   p_tags,p_ledger,p_ref,p_attempt))->>'result' $$;

-- Contact submissions 1..60, each with its pending ledger row from the 7.2C-1 trigger.
insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 select ('e1222000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic','Sender','readback-sender@example.test',null,'Synthetic','Synthetic body'
   from generate_series(1,60) n;
create function pg_temp.src(p_n int) returns uuid language sql as $$ select ('e1222000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.oe(p_n int) returns uuid language sql as $$
 select id from private.owner_email_notifications where contact_submission_id = pg_temp.src(p_n) $$;
create function pg_temp.sent(p_n int, p_attempts int, p_email text) returns void language sql as $$
 update private.owner_email_notifications set state='sent', attempts=p_attempts, sent_at=now(), provider_message_id=p_email
  where id = pg_temp.oe(p_n) $$;
create function pg_temp.at_state(p_n int, p_state text, p_attempts int) returns void language sql as $$
 update private.owner_email_notifications set state=p_state, attempts=p_attempts, sent_at=null, provider_message_id=null,
   last_error_code=case when p_state in ('failed','unknown') then 'provider_server_error' end where id = pg_temp.oe(p_n) $$;
-- A linked, tagged receipt inserted directly (the coherence checks still apply).
create function pg_temp.put(p_id text, p_n int, p_attempt int, p_type text, p_email text, p_bounce text default null,
  p_created timestamptz default '2026-11-18T10:00:00Z', p_class text default 'tag_and_id',
  p_expires timestamptz default now() + interval '1 day', p_received timestamptz default now() - interval '1 minute') returns void
language sql as $$
 insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,
   provider_created_at,provider_email_id,bounce_type,tag_ledger,tag_ref,tag_attempt,owner_email_notification,linked_attempt,identity_class)
 values (p_id,p_received,p_expires,'current','recorded',p_type,p_type,p_created,p_email,p_bounce,
   case when p_class <> 'id_only' then 'owner_email' end, case when p_class <> 'id_only' then pg_temp.oe(p_n) end,
   case when p_class <> 'id_only' then p_attempt end, pg_temp.oe(p_n), p_attempt, p_class) $$;
create function pg_temp.ev(p_n int) returns jsonb language sql as $$ select private.email_evidence_owner_row(pg_temp.oe(p_n)) $$;
create function pg_temp.rule(p_n int) returns int language sql as $$ select (pg_temp.ev(p_n)->'summary'->>'rule')::int $$;
create function pg_temp.flags(p_n int) returns text language sql as $$
 select concat_ws('|', s->>'rule', s->>'delivered_fact', s->>'non_delivery_proven', s->>'needs_review', s->'reported')
   from (select pg_temp.ev(p_n)->'summary' as s) x $$;
create function pg_temp.st(p_id text) returns text language sql as $$
 select private.email_evidence_receipt_state(e) from private.email_provider_events e where svix_id = p_id $$;
create function pg_temp.class(p_id text) returns text language sql as $$
 select identity_class from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.counts() returns jsonb language sql as $$ select pg_temp.op('select public.owner_email_evidence_counts()') $$;
create function pg_temp.claim(p_n int) returns uuid language sql as $$
 select (pg_temp.svc(format('select public.owner_email_claim(%L,%L,%L)','contact_submission',pg_temp.src(p_n),'initial'))->>'claim_id')::uuid $$;
create function pg_temp.record(p_n int, p_claim uuid, p_outcome text, p_email text) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.owner_email_record(%L,%L,%L,%L,%L,%L)','contact_submission',pg_temp.src(p_n),p_claim,p_outcome,p_email,
   case when p_outcome = 'sent' then null else 'provider_server_error' end)) $$;
-- Everything a read could touch.
create function pg_temp.world() returns text language sql as $$
 select md5(concat_ws('#',
   (select string_agg(to_jsonb(e)::text, ',' order by svix_id) from private.email_provider_events e),
   (select string_agg(to_jsonb(p)::text, ',' order by id) from private.email_provider_event_purges p),
   (select string_agg(to_jsonb(c)::text, ',') from private.email_evidence_config c),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.owner_email_notifications n),
   (select string_agg(to_jsonb(v)::text, ',' order by id) from private.owner_email_notification_events v),
   (select string_agg(to_jsonb(n)::text, ',' order by application_id) from private.r0_application_notifications n),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.package_draft_email_notices n))) $$;

-- 1. Shape, volatility and privileges --------------------------------------------------------
create temp table new_functions(sig regprocedure, kind text);
insert into new_functions values
 ('public.owner_email_correlation_ref(text,uuid)','service'),
 ('public.owner_email_evidence(text,uuid[])','operator'),
 ('public.owner_email_evidence_counts()','operator'),
 ('private.email_evidence_fact(text,text)','private'),
 ('private.email_evidence_identity_holds(private.email_provider_events)','private'),
 ('private.email_evidence_receipt_state(private.email_provider_events)','private'),
 ('private.email_evidence_summary(text[],timestamptz)','private'),
 ('private.email_evidence_owner_claimed_at(uuid,integer)','private'),
 ('private.email_evidence_owner_receipts(uuid)','private'),
 ('private.email_evidence_owner_row(uuid)','private');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and (p.proname like 'email\_evidence\_%' or p.proname like 'owner\_email\_%')
    and p.oid not in (select sig::oid from new_functions)
    and p.oid <> all(array['private.owner_email_require_kind(text)','private.owner_email_state(text,timestamptz,timestamptz)',
      'private.owner_email_log(uuid,text,uuid,text,text,integer,uuid,text,text,text)','private.owner_email_lock(text,uuid)',
      'private.owner_email_refuse_untracked(text,uuid)','private.owner_email_contact_create()','public.owner_email_claim(text,uuid,text)',
      'public.owner_email_record(text,uuid,uuid,text,text,text)','public.owner_email_request_resend(text,uuid,boolean)',
      'public.owner_email_acknowledge(text,uuid,text,boolean)','public.owner_email_overview(text,boolean,timestamptz,uuid,integer)',
      'public.owner_email_contact_submission(uuid)','private.owner_email_renewal_create()']::regprocedure[]::oid[])
    -- TRACE-155 (7.3C-2, 20261127001000): its five private helpers share this prefix. They are
    -- excluded by exact signature here and tested in SQL 124.
    and p.oid <> all(array['private.email_evidence_ledger_claimed_at(text,uuid,integer)','private.email_evidence_ledger_receipts(text,uuid)',
      'private.email_evidence_ledger_row(text,uuid)','private.email_evidence_ledger_counts(text)',
      'private.email_evidence_global_counts()']::regprocedure[]::oid[])
    -- TRACE-155 (7.3D-1, 20261128001000): its arming, coverage and probe functions share the
    -- prefix too. Excluded by exact signature here and tested in SQL 125.
    and p.oid <> all(array['private.email_evidence_arming_events_guard()','private.email_evidence_transition(text,text)',
      'public.email_evidence_arm(text)','public.email_evidence_disarm(text)','private.email_evidence_retry_horizon()',
      'private.email_evidence_coverage(timestamptz)','public.email_evidence_arming_readback()',
      'public.email_evidence_probe_authorize()','public.email_evidence_probe_readback(text)']::regprocedure[]::oid[])),0,
 'this slice adds exactly the ten listed functions beside the 13 original owner-email functions (and the 7.3C-2 helpers, SQL 124)');
select is((select string_agg(distinct p.provolatile::text, ',') from pg_proc p where p.oid in (select sig::oid from new_functions where sig::text <> 'private.email_evidence_fact(text,text)')),
 's','every read function is STABLE (none can write)');
select is((select provolatile::text from pg_proc where oid='private.email_evidence_fact(text,text)'::regprocedure),'i','the fact mapping is IMMUTABLE');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=sig::oid), sig::text||' is security definer with an empty search_path')
  from new_functions where kind <> 'private';
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=sig::oid), sig::text||' runs as its caller with an empty search_path')
  from new_functions where kind = 'private';
select ok(not has_function_privilege(r, sig, 'EXECUTE'), sig::text||' is not executable by '||r)
  from new_functions, unnest(array['anon','authenticated','service_role']) r where kind = 'private';
select ok(has_function_privilege('service_role','public.owner_email_correlation_ref(text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.owner_email_correlation_ref(text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.owner_email_correlation_ref(text,uuid)','EXECUTE')
  and not has_function_privilege('public','public.owner_email_correlation_ref(text,uuid)','EXECUTE'),
 'the correlation reference is service role only');
select ok(has_function_privilege('authenticated',sig,'EXECUTE') and not has_function_privilege('anon',sig,'EXECUTE')
  and not has_function_privilege('service_role',sig,'EXECUTE'), sig::text||' is granted to authenticated only (operator-guarded inside)')
  from new_functions where kind = 'operator';
select throws_ok(format('select pg_temp.run(null,%L,%L)', r, q), '42501', null, r||' cannot call '||q)
  from unnest(array['anon','service_role']) r,
       unnest(array['select public.owner_email_evidence(null, array[]::uuid[])','select public.owner_email_evidence_counts()']) q;
select throws_ok(format('select pg_temp.user(%s,%L)', u, q), '42501', null, 'user '||u||' cannot call '||q)
  from unnest(array[2,3]) u,
       unnest(array['select public.owner_email_evidence(null, array[]::uuid[])','select public.owner_email_evidence_counts()',
                    'select to_jsonb(public.owner_email_correlation_ref(''contact_submission'',''e1222000-0000-4000-8000-000000000001''))']) q;
select throws_ok('select pg_temp.op(''select to_jsonb(public.owner_email_correlation_ref(''''contact_submission'''',''''e1222000-0000-4000-8000-000000000001''''))'')',
 '42501', null, 'an operator session cannot call the correlation reference');
select throws_ok('select pg_temp.run(null,''anon'',''select to_jsonb(public.owner_email_correlation_ref(''''contact_submission'''',''''e1222000-0000-4000-8000-000000000001''''))'')',
 '42501', null, 'anon cannot call the correlation reference');

-- 2. Correlation reference (C3C-1) -----------------------------------------------------------
create function pg_temp.ref(p_kind text, p_source uuid) returns text language sql as $$
 select pg_temp.svc(format('select to_jsonb(public.owner_email_correlation_ref(%L,%L))', p_kind, p_source)) #>> '{}' $$;
insert into public.contractors(id,name,is_active,marketing_enabled) values ('e1223000-0000-4000-8000-000000000001','Synthetic Readback Co',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 values ('e1223100-0000-4000-8000-000000000001','Synthetic readback','Test','Readback','readback-app@example.test','synthetic','e1223000-0000-4000-8000-000000000001','{}');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 values ('e1223000-0000-4000-8000-000000000001',
   (select id from public.vendor_application_versions where application_id='e1223100-0000-4000-8000-000000000001'),1,'active');
insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
 values ('e1223200-0000-4000-8000-000000000001','e1223000-0000-4000-8000-000000000001','license',
   'renewals/e1223000-0000-4000-8000-000000000001/license/e1223300-0000-4000-8000-000000000001-synthetic.pdf',
   'synthetic.pdf','application/pdf',100,'e1220000-0000-4000-8000-000000000003','provider');
select is(pg_temp.ref('contact_submission',pg_temp.src(1)), pg_temp.oe(1)::text, 'a contact submission resolves to exactly its ledger row');
select is(pg_temp.ref('renewal_document','e1223200-0000-4000-8000-000000000001'),
 (select id::text from private.owner_email_notifications where renewal_document_id='e1223200-0000-4000-8000-000000000001'),
 'a renewal document resolves to exactly its ledger row');
select is(pg_temp.ref('renewal_document',pg_temp.src(1)), null, 'a contact source under the renewal kind selects nothing');
select is(pg_temp.ref('contact_submission','e1223200-0000-4000-8000-000000000001'), null, 'a renewal source under the contact kind selects nothing');
select is(pg_temp.ref('newsletter',pg_temp.src(1)), null, 'an unknown kind selects nothing');
select is(pg_temp.ref(null,pg_temp.src(1)), null, 'a null kind selects nothing');
select is(pg_temp.ref('contact_submission','e1229999-0000-4000-8000-000000000000'), null, 'a source without a ledger row selects nothing');
select is(pg_temp.ref('contact_submission',null), null, 'a null source selects nothing');

-- 3. Read-time identity checks, plan §7.3 -----------------------------------------------------
-- S-37: a tagged callback before outcome recording, on real claims and records.
create temp table claims(n int primary key, claim uuid);
insert into claims select n, pg_temp.claim(n) from generate_series(1,4) n;
select is(pg_temp.recv('msg-37a','email.delivered','em-37a','valid','owner_email',pg_temp.oe(1),1),'recorded','S-37 tagged delivered before the record (a)');
select is(pg_temp.recv('msg-37b','email.delivered','em-37b','valid','owner_email',pg_temp.oe(2),1),'recorded','S-37 (b)');
select is(pg_temp.recv('msg-37c','email.delivered','em-37c','valid','owner_email',pg_temp.oe(3),1),'recorded','S-37 (c)');
select is(pg_temp.class('msg-37a')||'|'||pg_temp.st('msg-37a')||'|'||pg_temp.rule(1),'tag_only|trusted|4',
 'S-37 linked tag_only at receipt; trusted while the row is still sending; rule 4');
select is(pg_temp.record(1,(select claim from claims where n=1),'sent','em-37a')->>'state','sent','S-37(a) record sent with the same ID');
select is(pg_temp.record(2,(select claim from claims where n=2),'sent','em-37b-other')->>'state','sent','S-37(b) record sent with a different ID');
select is(pg_temp.record(3,(select claim from claims where n=3),'unknown',null)->>'state','unknown','S-37(c) record unknown');
select is(pg_temp.st('msg-37a')||'|'||pg_temp.rule(1),'trusted|4','S-37(a) the record commits the same ID: trusted, rule 4');
select is(pg_temp.st('msg-37b')||'|'||pg_temp.rule(2)||'|'||(pg_temp.ev(2)->>'has_conflict')||'|'||(pg_temp.ev(2)->'conflict_reasons')::text,
 'current_conflict|10|true|["current_conflict"]',
 'S-37(b) its own linked row records a different ID, while no row holds the receipt''s ID: current_conflict, excluded, signalled');
select is(private.email_provider_id_candidate('em-37b')->>'kind','none','S-37(b) I'' is none: the check that fails is the linked row''s own ID (§7.3 item 2)');
select is(pg_temp.st('msg-37c')||'|'||pg_temp.rule(3)||'|'||(select state from private.owner_email_notifications where id=pg_temp.oe(3)),
 'trusted|4|unknown','S-37(c)/S-38 rule 4 on an unknown row; the row stays unknown');
select is(array[pg_temp.class('msg-37a'),pg_temp.class('msg-37b'),pg_temp.class('msg-37c')],array['tag_only','tag_only','tag_only'],
 'S-37 the stored identity class is unchanged in all three');
select throws_ok(format('select pg_temp.op(%L)',format('select public.owner_email_request_resend(%L,%L,false)','contact_submission',pg_temp.src(3))),
 '55000',null,'S-38 a resend of the unknown row still needs the no-email attestation despite rule 4');
-- S-51: a stale worker after an operator's resend request, with receipts present.
select is(pg_temp.recv('msg-51','email.delivered','em-51','valid','owner_email',pg_temp.oe(4),1),'recorded','S-51 a receipt for the claimed attempt');
update private.owner_email_notifications set claimed_at = now() - interval '11 minutes' where id = pg_temp.oe(4);
select is(pg_temp.op(format('select public.owner_email_request_resend(%L,%L,true)','contact_submission',pg_temp.src(4)))->>'state','resend_requested',
 'S-51 the operator requests a resend of the unknown row with the attestation');
select throws_ok(format('select pg_temp.record(4,%L,''sent'',''em-51'')',(select claim from claims where n=4)),'40001',null,
 'S-51 the stale worker''s record is refused with 40001, receipts notwithstanding');

-- S-57 as amended: current-snapshot exclusion, and recovery when the competing record goes.
-- Each section below starts from no receipts, so its counts are exact.
delete from private.email_provider_events;
select pg_temp.at_state(7,'unknown',1);
select is(pg_temp.recv('msg-57t','email.bounced','em-57t','valid','owner_email',pg_temp.oe(7),1,'permanent'),'recorded','S-57 tag_only bounce on row X');
update private.owner_email_notifications set state='sent', sent_at=now(), provider_message_id='em-57t' where id=pg_temp.oe(7);
select is(pg_temp.flags(7)||'|'||pg_temp.st('msg-57t'),'5|false|true|true|["bounced_permanent"]|trusted','S-57 before Y: trusted, rule 5 (X now sent with that ID)');
select is((pg_temp.counts()->>'not_delivered')::int,1,'S-57 before Y: counted as not delivered');
select pg_temp.sent(8,1,'em-57t');
select is(pg_temp.st('msg-57t')||'|'||pg_temp.rule(7)||'|'||(pg_temp.ev(7)->>'has_conflict'),'current_conflict|10|true',
 'S-57 after row Y records the same ID: current_conflict, excluded');
select is((pg_temp.counts()->>'not_delivered')::int||'|'||(pg_temp.counts()->>'conflicting_rows'),'0|1','S-57 the counts move: not delivered 0, conflicting 1');
delete from public.contact_submissions where id = pg_temp.src(8);
select is(pg_temp.st('msg-57t')||'|'||pg_temp.rule(7)||'|'||(pg_temp.ev(7)->>'has_conflict'),'trusted|5|false',
 'S-57 after Y''s source is deleted (its ledger row cascades): trusted again, the summary returns');
select is((pg_temp.counts()->>'not_delivered')::int||'|'||(pg_temp.counts()->>'conflicting_rows'),'1|0','S-57 and the counts move back');
-- The id_only variant, with the competing ID in another ledger.
select pg_temp.sent(9,1,'em-57i');
select is(pg_temp.recv('msg-57i','email.delivered','em-57i'),'recorded','S-57 untagged receipt for row 9');
select is(pg_temp.class('msg-57i')||'|'||pg_temp.st('msg-57i'),'id_only|trusted','S-57 id_only, trusted');
alter table public.vendor_applications disable trigger vendor_version_intake;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone) values
 ('e1224000-0000-4000-8000-0000000000a1','Synthetic Readback App','Ann','Applicant','readback-app1@example.test','synthetic');
alter table public.vendor_applications enable trigger vendor_version_intake;
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-57i'
 where application_id='e1224000-0000-4000-8000-0000000000a1';
select is(pg_temp.st('msg-57i')||'|'||pg_temp.rule(9),'current_conflict|10','S-57 the ID recorded in another ledger makes it current_conflict (cross-ledger)');
delete from public.vendor_applications where id='e1224000-0000-4000-8000-0000000000a1';
select is(pg_temp.st('msg-57i')||'|'||pg_temp.rule(9),'trusted|4','S-57 deleting the competing application restores it');
-- A tag_only receipt whose ID another ledger later records (Codex's cross-ledger refusal, derived).
select pg_temp.at_state(10,'unknown',1);
select is(pg_temp.recv('msg-xl','email.delivered','em-xl','valid','owner_email',pg_temp.oe(10),1),'recorded','tag_only for row 10');
alter table public.vendor_applications disable trigger vendor_version_intake;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone) values
 ('e1224000-0000-4000-8000-0000000000a2','Synthetic Readback App 2','Bo','Applicant','readback-app2@example.test','synthetic');
alter table public.vendor_applications enable trigger vendor_version_intake;
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-xl'
 where application_id='e1224000-0000-4000-8000-0000000000a2';
select is(pg_temp.st('msg-xl'),'current_conflict','an application later recording the tag_only receipt''s ID makes it current_conflict');
-- Same row, different attempt: tagged for attempt 1; attempt 2 is then sent with that ID.
select pg_temp.at_state(11,'unknown',1);
select is(pg_temp.recv('msg-att','email.delivered','em-att','valid','owner_email',pg_temp.oe(11),1),'recorded','tag_only for attempt 1');
select pg_temp.sent(11,2,'em-att');
select is(pg_temp.st('msg-att')||'|'||(private.email_provider_id_candidate('em-att')->>'attempt'),'current_conflict|2',
 'same row, different attempt: I'' names attempt 2, so the attempt-1 receipt is current_conflict');
-- S-47: a receipt for attempt 1 after attempt 2 stays on attempt 1.
select pg_temp.at_state(12,'unknown',1);
select is(pg_temp.recv('msg-47','email.delivered','em-47','valid','owner_email',pg_temp.oe(12),1),'recorded','S-47 attempt 1 receipt');
select pg_temp.at_state(12,'failed',2);
select is(pg_temp.rule(12)||'|'||(pg_temp.ev(12)->>'attempt')||'|'||(pg_temp.ev(12)->'attempts'->0->>'attempt')||'|'||(pg_temp.ev(12)->'attempts'->0->>'rule')
  ||'|'||jsonb_array_length(pg_temp.ev(12)->'attempts'),'10|2|1|4|1',
 'S-47 the row summary is attempt 2 (rule 10); the report stays on attempt 1 (rule 4) in the history');
-- Literal §7.3 item 2: once a later attempt of the same row records a different ID, the
-- earlier attempt's tagged report is excluded as a current conflict (recorded for Codex, D-4).
select pg_temp.sent(12,2,'em-47-attempt2');
select is(pg_temp.st('msg-47')||'|'||(pg_temp.ev(12)->'attempts'->0->'reports'->0->>'excluded'),'current_conflict|current_conflict',
 'item 2: a later attempt recording a different ID excludes the earlier attempt''s report');

-- 4. Stored and content conflicts stay excluded -----------------------------------------------
select pg_temp.at_state(13,'unknown',1);
select pg_temp.sent(14,1,'em-dis');
select is(pg_temp.recv('msg-dis','email.bounced','em-dis','valid','owner_email',pg_temp.oe(13),1,'permanent'),'recorded','conflict_disagree setup');
select is(pg_temp.class('msg-dis')||'|'||pg_temp.st('msg-dis'),'conflict_disagree|stored_conflict','a receipt-time disagreement is a stored conflict');
select is((pg_temp.ev(13)->'conflict_reasons')::text||'|'||(pg_temp.ev(14)->'conflict_reasons')::text||'|'||pg_temp.rule(13)||'|'||pg_temp.rule(14),
 '["stored_conflict"]|["stored_conflict"]|10|10','it is signalled on the row its tag names and on the row its ID names, and changes neither summary');
select is(pg_temp.ev(13)->'attempts'->0->'reports'->0->>'excluded','stored_conflict','the history marks it excluded');
delete from public.contact_submissions where id = pg_temp.src(14);
select is(pg_temp.st('msg-dis')||'|'||(pg_temp.ev(13)->>'has_conflict')||'|'||pg_temp.rule(13),'stored_conflict|true|10',
 'deleting the row its ID named does not make a stored conflict trusted');
-- S-45: a content-conflicted permanent bounce is excluded; the summary comes from the others.
select pg_temp.sent(15,1,'em-45');
select pg_temp.put('msg-45-ok',15,1,'email.delivered','em-45');
select pg_temp.put('msg-45-bad',15,1,'email.bounced','em-45','permanent');
update private.email_provider_events set content_conflict=true, conflict_seen_at=now() where svix_id='msg-45-bad';
select is(pg_temp.flags(15)||'|'||(pg_temp.ev(15)->'conflict_reasons')::text,'4|true|false|false|[]|["content_conflict"]',
 'S-45 rule 4 from the trusted report; the content-conflicted bounce is excluded and signalled');
-- S-46: a content conflict on the only receipt leaves no evidence and a visible signal.
select pg_temp.sent(16,1,'em-46');
select pg_temp.put('msg-46',16,1,'email.delivered','em-46');
update private.email_provider_events set content_conflict=true, conflict_seen_at=now() where svix_id='msg-46';
select is(pg_temp.rule(16)||'|'||(pg_temp.ev(16)->>'has_conflict'),'10|true','S-46 excluded; the conflict signal is visible');

-- 5. Rules, flags and labels' inputs (§8.3) -----------------------------------------------------
create function pg_temp.case_row(p_n int, p_specs text[]) returns text language plpgsql as $$
declare i int := 0; spec text;
begin
  perform pg_temp.sent(p_n, 1, 'em-rule-'||p_n);
  foreach spec in array p_specs loop
    i := i + 1;
    perform pg_temp.put('msg-rule-'||p_n||'-'||i, p_n, 1, split_part(spec,':',1), 'em-rule-'||p_n, nullif(split_part(spec,':',2),''),
      case when i % 2 = 0 then null else '2026-11-18T10:00:00Z'::timestamptz end);
  end loop;
  return pg_temp.flags(p_n);
end $$;
select is(pg_temp.case_row(20, array['email.delivered','email.complained']),'1|true|false|true|[]','S-39 delivered + complaint: rule 1, never not delivered');
select is(pg_temp.case_row(21, array['email.complained']),'1|true|false|true|[]','a complaint alone states the hand-off occurred (rule 1)');
select is(pg_temp.case_row(22, array['email.delivered','email.bounced:transient']),'3|true|false|true|[]','S-40 delivered + temporary bounce: rule 3');
select is(pg_temp.case_row(23, array['email.delivered','email.bounced:undetermined']),'3|true|false|true|[]','S-40 delivered + undetermined bounce: rule 3');
select is(pg_temp.case_row(24, array['email.bounced:permanent']),'5|false|true|true|["bounced_permanent"]','S-41 permanent bounce only: rule 5, not delivered');
select is(pg_temp.case_row(25, array['email.delivered','email.bounced:permanent']),'2|true|false|true|["bounced_permanent"]',
 'S-42 delivered + permanent bounce: rule 2 disagreement, not "not delivered"');
select is(pg_temp.case_row(26, array['email.bounced:transient']),'6|false|false|true|[]','S-43 temporary bounce only: rule 6');
select is(pg_temp.case_row(27, array['email.bounced:other']),'6|false|false|true|[]','a bounce of unknown category is undetermined (rule 6), never proof');
select is(pg_temp.case_row(28, array['email.failed','email.suppressed']),'5|false|true|true|["provider_failed", "provider_suppressed"]','failure and suppression: rule 5');
select is(pg_temp.case_row(29, array['email.delivery_delayed','email.sent']),'7|false|false|false|[]','delayed: rule 7');
select is(pg_temp.case_row(30, array['email.sent']),'8|false|false|false|[]','accepted only: rule 8');
select is(pg_temp.case_row(31, array['email.delivered','email.sent','email.delivery_delayed']),'4|true|false|false|[]','delivered with accepted and delayed: rule 4');
select is(pg_temp.case_row(32, array['email.delivered','email.failed','email.suppressed','email.bounced:transient']),
 '2|true|false|true|["provider_failed", "provider_suppressed"]','rule 2 precedes rule 3 and lists every non-delivery report');
-- S-42 history: provider times exactly as received, equal or missing, display-ordered only.
select is((select string_agg(coalesce(r->>'provider_created_at','null'),',') from jsonb_array_elements(pg_temp.ev(25)->'attempts'->0->'reports') r),
 '2026-11-18T10:00:00+00:00,null','S-42 the history shows each provider time as received (missing ones last)');
select is((select string_agg(r->>'fact',',') from jsonb_array_elements(pg_temp.ev(25)->'attempts'->0->'reports') r),
 'delivered,bounced_permanent','S-42 both reports are kept and shown');
select is((pg_temp.ev(24)->'attempts'->0->'reports'->0) - 'provider_created_at',
 '{"fact":"bounced_permanent","excluded":null,"bounce_type":"permanent","bounce_subtype":null}'::jsonb,'a history entry holds the fact, bounce category and exclusion only');

-- S-44: every arrival permutation of a fixed fact set gives the same summary and flags.
create temp table perm_results(set_no int, perm int[], summary jsonb);
do $$
declare sets text[][] := array[
  array['email.delivered:','email.bounced:permanent','email.complained:','email.delivery_delayed:'],
  array['email.delivered:','email.bounced:permanent','email.suppressed:','email.sent:']];
  s int; p int[]; k int; spec text;
begin
  perform pg_temp.sent(40, 1, 'em-perm');
  for s in 1..2 loop
    for p in with recursive perms(p) as (select array[]::int[] union all
               select perms.p || i from perms, generate_series(1,4) i where not i = any(perms.p) and cardinality(perms.p) < 4)
             select perms.p from perms where cardinality(perms.p) = 4 loop
      delete from private.email_provider_events where owner_email_notification = pg_temp.oe(40);
      for k in 1..4 loop
        spec := sets[s][p[k]];
        perform pg_temp.put('msg-perm-'||k, 40, 1, split_part(spec,':',1), 'em-perm', nullif(split_part(spec,':',2),''),
          '2026-11-18T10:00:00Z'::timestamptz + (k * interval '1 second'), 'tag_and_id', now() + interval '1 day', now() - interval '1 hour' + k * interval '1 second');
      end loop;
      insert into perm_results values (s, p, pg_temp.ev(40)->'summary');
    end loop;
  end loop;
end $$;
select is((select count(*)::int from perm_results), 48, 'S-44 all 24 permutations of each of two fact sets were read');
select is((select string_agg(distinct summary::text, ' / ') from perm_results where set_no = 1),
 '{"rule": 1, "coverage": "unknown", "reported": [], "needs_review": true, "delivered_fact": true, "non_delivery_proven": false}','S-44 set 1: one summary for every order');
select is((select string_agg(distinct summary::text, ' / ') from perm_results where set_no = 2),
 '{"rule": 2, "coverage": "unknown", "reported": ["bounced_permanent", "provider_suppressed"], "needs_review": true, "delivered_fact": true, "non_delivery_proven": false}',
 'S-44 set 2: one summary for every order');

-- S-48: an unmatched receipt is never rematched on read.
select is(pg_temp.recv('msg-48','email.delivered','em-48'),'recorded','S-48 an untagged receipt with no matching row');
select pg_temp.sent(41,1,'em-48');
select is(pg_temp.class('msg-48')||'|'||pg_temp.st('msg-48')||'|'||pg_temp.rule(41)||'|'||jsonb_array_length(pg_temp.ev(41)->'attempts'),
 'unmatched|unlinked|10|0','S-48 the row later recording that ID shows nothing: an untagged early callback stays unmatched');

-- S-49: arming record, rule 9 versus 10, and no override of trusted facts.
-- TRACE-155 (7.3D-1, 20261128001000): rule 9 now reads the audited arming intervals, not
-- armed_at alone, so each case arms through the history (one arm event at the given time, and the
-- matching armed_at). Expected rules are unchanged; interval coverage is tested in SQL 125.
create function pg_temp.arming(p_at timestamptz) returns void language plpgsql as $$
begin
  alter table private.email_evidence_arming_events disable trigger email_evidence_arming_events_guard;
  delete from private.email_evidence_arming_events;
  alter table private.email_evidence_arming_events enable trigger email_evidence_arming_events_guard;
  delete from private.email_evidence_config;
  if p_at is not null then
    insert into private.email_evidence_arming_events(seq, action, occurred_at, actor, reason)
      values (1, 'arm', p_at, 'e1220000-0000-4000-8000-000000000001', 'Synthetic arming');
    insert into private.email_evidence_config(singleton, armed_at) values (true, p_at);
  end if;
end $$;
select pg_temp.at_state(42,'unknown',1);
update private.owner_email_notifications set claimed_at = now() - interval '5 minutes' where id = pg_temp.oe(42);
select pg_temp.arming(now() - interval '4 minutes');
select is(pg_temp.rule(42),10,'S-49 armed after the claim: rule 10');
select pg_temp.arming(now() - interval '6 minutes');
select is(pg_temp.rule(42),9,'S-49 armed before the claim: rule 9 ("No provider report yet")');
select is(pg_temp.rule(43),10,'S-49 a row without any attempt: rule 10');
select pg_temp.arming(now() + interval '1 hour');
select is(pg_temp.rule(31),4,'Codex item 4: rules 9/10 never override trusted facts (armed after the claim, rule 4 stands)');
select isnt(pg_temp.claim(44), null, 'S-49 a real claim of row 44');
select is((select (c.armed_at <= (select min(v.created_at) from private.owner_email_notification_events v
            where v.notification_id=pg_temp.oe(44) and v.state='sending'))::text from private.email_evidence_config c)
  ||'|'||pg_temp.rule(44),'false|10','S-49 the claim time comes from the attempt''s sending event');
select pg_temp.arming(now() - interval '1 hour');
select is(pg_temp.rule(44),9,'S-49 and an earlier arming time gives rule 9 for it');
select pg_temp.put('msg-49-facts',44,1,'email.delivered','em-49f',p_class=>'tag_only');
select is(pg_temp.rule(44),4,'Codex item 4: armed before the claim, a trusted report still gives its own rule (4), not rule 9');
select pg_temp.arming(null);

-- 6. Additive counts (§9.1) and unchanged attention counts ---------------------------------------
delete from private.email_provider_events;
select is(pg_temp.counts() - 'checked_at',
 '{"to_review":0,"not_delivered":0,"receiver_armed":false,"conflicting_rows":0,"retention_backlog":{"expired":0,"expired_over_cap":false,"oldest_expires_at":null},"unmatched_reports":{"total":0,"by_type":{}},"conflicting_reports":{"conflict_disagree":0,"content_conflict":0,"conflict_tag_invalid":0,"conflict_id_ambiguous":0}}'::jsonb,
 'with no receipts and an empty arming record every count is zero and the receiver reads unarmed');
select pg_temp.sent(45,1,'em-c45'); select pg_temp.put('msg-c45',45,1,'email.bounced','em-c45','permanent');            -- not delivered
select pg_temp.at_state(46,'unknown',1); select pg_temp.put('msg-c46',46,1,'email.bounced','em-c46','permanent','2026-11-18T10:00:00Z','tag_only'); -- proven, not sent
select pg_temp.sent(47,1,'em-c47'); select pg_temp.put('msg-c47',47,1,'email.complained','em-c47');                    -- to review
select pg_temp.sent(48,1,'em-c48'); select pg_temp.put('msg-c48',48,1,'email.bounced','em-c48','transient');           -- to review
select pg_temp.sent(49,1,'em-c49'); select pg_temp.put('msg-c49a',49,1,'email.delivered','em-c49'); select pg_temp.put('msg-c49b',49,1,'email.bounced','em-c49','permanent'); -- to review
select pg_temp.sent(50,1,'em-c50'); select pg_temp.put('msg-c50',50,1,'email.delivered','em-c50');                     -- rule 4, nothing
select is(pg_temp.recv('msg-u1','email.delivered','em-u1'),'recorded','unmatched 1');
select is(pg_temp.recv('msg-u2','email.delivered','em-u2'),'recorded','unmatched 2');
select is(pg_temp.recv('msg-u3','email.bounced',null,p_bounce=>'permanent'),'recorded','id_missing');
select is(pg_temp.recv('msg-d1','email.delivered','em-d1','valid','owner_email',pg_temp.oe(51),1),'recorded','tag for an attempt row 51 never made: conflict_tag_invalid');
select pg_temp.at_state(52,'unknown',1);
select is(pg_temp.recv('msg-d2','email.delivered','em-c45','valid','owner_email',pg_temp.oe(52),1),'recorded','tag for row 52, ID of row 45: conflict_disagree');
select is(pg_temp.counts() - 'checked_at' - 'retention_backlog',
 '{"to_review":3,"not_delivered":1,"receiver_armed":false,"conflicting_rows":3,"unmatched_reports":{"total":3,"by_type":{"email.bounced":1,"email.delivered":2}},"conflicting_reports":{"conflict_disagree":1,"content_conflict":0,"conflict_tag_invalid":1,"conflict_id_ambiguous":0}}'::jsonb,
 'counts: only the sent proven row is not delivered; complaint, inconclusive bounce and disagreement are to review; the unknown proven row is in neither; conflicts by row and by class; unmatched by type');
select is((select string_agg(n::text, ',' order by n) from generate_series(45,52) n where (pg_temp.ev(n)->>'has_conflict')::boolean),'45,51,52',
 'the conflicting rows are those its stored conflicts name (row 45 by ID, 51 and 52 by tag)');
create temp table attention_with as select pg_temp.op('select public.owner_email_overview(null,true,null,null,100)')->'attention_count' as v;
delete from private.email_provider_events;
select is(pg_temp.op('select public.owner_email_overview(null,true,null,null,100)')->'attention_count',(select v from attention_with),
 'the existing attention counts are identical with and without these receipts');

-- 7. One expiry predicate everywhere (S-34 readback side; the >100-backlog replay) ---------------
delete from private.email_provider_events;
select pg_temp.sent(53,1,'em-x53');
select pg_temp.put('msg-x53',53,1,'email.bounced','em-x53','permanent',p_expires=>now() + interval '1 second');
select pg_temp.sent(54,1,'em-x54');
select pg_temp.put('msg-x54',54,1,'email.bounced','em-x54','permanent',p_expires=>now());
select pg_temp.at_state(55,'unknown',1);
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,provider_email_id,
  tag_ledger,tag_ref,tag_attempt,identity_class)
 values ('msg-x55',now()-interval '1 day',now(),'current','recorded','email.delivered','email.delivered','em-x54','owner_email',pg_temp.oe(55),1,'conflict_disagree'),
        ('msg-x56',now()-interval '1 day',now(),'current','recorded','email.delivered','email.delivered','em-x56',null,null,null,'unmatched');
-- The >100-backlog replay leaves an expired linked receipt stored and flagged (SQL 121 §9).
select pg_temp.sent(56,1,'em-x57');
select pg_temp.put('msg-x57',56,1,'email.bounced','em-x57','permanent',p_expires=>now() - interval '1 day',p_received=>now() - interval '2 days');
update private.email_provider_events set content_conflict=true, conflict_seen_at=now() where svix_id='msg-x57';
select is(pg_temp.st('msg-x53')||'|'||pg_temp.st('msg-x54')||'|'||pg_temp.st('msg-x55')||'|'||pg_temp.st('msg-x56')||'|'||pg_temp.st('msg-x57'),
 'trusted|expired|expired|expired|expired','S-34 expires_at - 1 s is visible; at expires_at (and earlier) the state is expired');
select is(pg_temp.rule(53)||'|'||pg_temp.rule(54)||'|'||jsonb_array_length(pg_temp.ev(54)->'attempts'),'5|10|0','S-34 summary and history exclude the expired report');
select is((pg_temp.ev(54)->>'has_conflict')||'|'||(pg_temp.ev(55)->>'has_conflict')||'|'||(pg_temp.ev(56)->>'has_conflict')||'|'||pg_temp.rule(56),
 'false|false|false|10','S-34 the conflict signal excludes expired stored and content conflicts (including the flagged backlog replay)');
select is(pg_temp.counts() - 'checked_at' - 'receiver_armed',
 jsonb_build_object('to_review',0,'not_delivered',1,'conflicting_rows',0,
  'retention_backlog',jsonb_build_object('expired',4,'expired_over_cap',false,'oldest_expires_at',now() - interval '1 day'),
  'unmatched_reports','{"total":0,"by_type":{}}'::jsonb,
  'conflicting_reports','{"conflict_disagree":0,"content_conflict":0,"conflict_tag_invalid":0,"conflict_id_ambiguous":0}'::jsonb),
 'S-34 every count excludes expired receipts; only the backlog counts them, with the oldest expiry');
select is((select count(*)::int from private.email_provider_events),5,'the readback purged nothing: expired receipts are still stored');

-- 8. The page readback: shape, bounds and privacy ------------------------------------------------
create temp table page as select pg_temp.op(format('select public.owner_email_evidence(null, %L::uuid[])',
  array[pg_temp.src(53), pg_temp.src(54), pg_temp.src(1), pg_temp.src(57), 'e1223200-0000-4000-8000-000000000001', 'e1229999-0000-4000-8000-000000000000'])) as v;
select is((select array_agg(i->>'source_id' order by i->>'source_id') from page, jsonb_array_elements(v->'items') i),
 (select array_agg(x order by x) from unnest(array[pg_temp.src(57)::text, pg_temp.src(54)::text, pg_temp.src(53)::text, pg_temp.src(1)::text,
   'e1223200-0000-4000-8000-000000000001']) x),
 'exactly the requested tracked rows; an unknown source is omitted');
select is((select string_agg(i->>'kind'||':'||(i->'summary'->>'rule'), ',' order by i->>'source_id') from page, jsonb_array_elements(v->'items') i
  where i->>'source_id' in (pg_temp.src(53)::text, pg_temp.src(54)::text)),'contact_submission:5,contact_submission:10','each item carries its kind and summary');
select is((select array_agg(distinct k order by k) from page, jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k),
 array['attempt','attempts','conflict_reasons','has_conflict','kind','source_id','summary'],'item keys');
select is((select array_agg(distinct k order by k) from page, jsonb_array_elements(v->'items') i, jsonb_object_keys(i->'summary') k),
 array['coverage','delivered_fact','needs_review','non_delivery_proven','reported','rule'],'summary keys');
select is((select array_agg(distinct k order by k) from page, jsonb_array_elements(v->'items') i, jsonb_array_elements(i->'attempts') a, jsonb_object_keys(a) k),
 array['attempt','coverage','delivered_fact','has_conflict','needs_review','non_delivery_proven','reported','reports','rule'],'history attempt keys');
select is((select array_agg(distinct k order by k) from page, jsonb_array_elements(v->'items') i, jsonb_array_elements(i->'attempts') a,
  jsonb_array_elements(a->'reports') r, jsonb_object_keys(r) k),
 array['bounce_subtype','bounce_type','excluded','fact','provider_created_at'],'history report keys');
select is((select array_agg(distinct k order by k) from page, jsonb_object_keys(v) k),array['checked_at','items'],'top-level keys');
select ok((select v::text from page) !~ '(em-|msg-)' and position(pg_temp.oe(53)::text in (select v::text from page)) = 0
  and position(pg_temp.oe(1)::text in (select v::text from page)) = 0,
 'no provider email ID, svix-id or ledger row ID appears in the output');
select is(jsonb_array_length(pg_temp.op(format('select public.owner_email_evidence(%L, %L::uuid[])','renewal_document',
  array[pg_temp.src(53),'e1223200-0000-4000-8000-000000000001']))->'items'),1,'a kind filter limits the rows');
select is(pg_temp.op('select public.owner_email_evidence(null, array[]::uuid[])')->'items','[]'::jsonb,'an empty list reads nothing');
select throws_ok(format('select pg_temp.op(%L)', format('select public.owner_email_evidence(null, %L::uuid[])',
  (select array_agg(gen_random_uuid()) from generate_series(1,101)))),'22023',null,'more than 100 sources are refused');
select lives_ok(format('select pg_temp.op(%L)', format('select public.owner_email_evidence(null, %L::uuid[])',
  (select array_agg(gen_random_uuid()) from generate_series(1,100)))),'exactly 100 sources are read');
select throws_ok('select pg_temp.op(''select public.owner_email_evidence(null, null)'')','22023',null,'a null list is refused');
select throws_ok('select pg_temp.op(''select public.owner_email_evidence(''''newsletter'''', array[]::uuid[])'')','22023',null,'an unknown kind is refused');

-- 9. Read purity -------------------------------------------------------------------------------
-- Restore a mixed world (conflicts, expired, unmatched, an arming record) and read everything.
insert into private.email_evidence_config(singleton, armed_at) values (true, now() - interval '1 hour');
select pg_temp.put('msg-p1',50,1,'email.delivered','em-c50');
select is(pg_temp.recv('msg-p2','email.delivered','em-p2'),'recorded','purity fixture');
create temp table world_before as select pg_temp.world() as digest;
select ok(pg_temp.counts() is not null, 'read: counts');
select is(jsonb_array_length(pg_temp.op(format('select public.owner_email_evidence(null, %L::uuid[])',
  (select array_agg(pg_temp.src(n)) from generate_series(1,60) n)))->'items'), 58, 'read: every remaining tracked contact row (rows 8 and 14 were deleted)');
select ok((select bool_and(private.email_evidence_owner_row(id) is not null) from private.owner_email_notifications), 'read: every ledger row''s evidence');
select ok((select count(private.email_evidence_receipt_state(e)) from private.email_provider_events e) > 0, 'read: every receipt''s state');
select isnt(pg_temp.ref('contact_submission', pg_temp.src(50)), null, 'read: a correlation reference');
select is(pg_temp.world(), (select digest from world_before),
 'receipts, purge audit, arming record, all three ledgers and the owner-email event log are byte-identical after every read');

-- 10. Unchanged definitions ----------------------------------------------------------------------
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.oid = any(array['private.owner_email_require_kind(text)','private.owner_email_state(text,timestamptz,timestamptz)',
   'private.owner_email_log(uuid,text,uuid,text,text,integer,uuid,text,text,text)','private.owner_email_lock(text,uuid)',
   'private.owner_email_refuse_untracked(text,uuid)','private.owner_email_contact_create()','public.owner_email_claim(text,uuid,text)',
   'public.owner_email_record(text,uuid,uuid,text,text,text)','public.owner_email_request_resend(text,uuid,boolean)',
   'public.owner_email_acknowledge(text,uuid,text,boolean)','public.owner_email_overview(text,boolean,timestamptz,uuid,integer)',
   'public.owner_email_contact_submission(uuid)']::regprocedure[]::oid[])),
 '12|016c0e683cb19c4c68769d87f5215ff1','the 7.2C-1 owner-email functions, by original signature, are byte-identical (claim and overview not restated)');
select is(md5(pg_get_functiondef('private.owner_email_renewal_create()'::regprocedure)),'b1607618f1af59ca19d9c6e5d0d410f5','the 7.2C-2 renewal trigger function is unchanged');
select is(md5(pg_get_functiondef('public.vendor_submit_renewal_document(text,uuid)'::regprocedure)),'8c8942365d8f9d34bdcd1d839f86c472','vendor_submit_renewal_document is unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'r0\_%notification%'),
 '10|5f14532aa26ed5400e73e210379aa4f8','the vendor-application ledger functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (('private','package_draft_email_view'),('public','pricing_claim_draft_email'),
   ('public','pricing_record_draft_email'),('public','admin_request_draft_email'))),
 '4|fddc8bb9fc830932a830db9d6db9c811','the price-draft email functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['private.email_provider_events_guard()','private.email_provider_event_retention(boolean)',
   'private.email_provider_id_candidate(text)','private.email_provider_tag_exists(text,uuid,integer)',
   'public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)',
   'public.email_provider_events_purge(integer)']::regprocedure[]::oid[])),
 '6|57277a24ac11744bde74a0be96cbd79d','the six 7.3B receiver functions are unchanged');
select is((select md5(string_agg(format('%s %s %s %s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull), ',' order by c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','owner_email_notifications','package_draft_email_notices')
    and a.attnum>0 and not a.attisdropped),
 '0e06a9c789f1968178c5fadc97793c33','the three ledger tables'' columns are unchanged');

select * from finish();
rollback;
