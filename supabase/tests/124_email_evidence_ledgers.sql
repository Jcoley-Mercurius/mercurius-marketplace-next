-- TRACE-155 (Phase 7.3C-2): application and price-draft delivery-evidence readbacks.
-- Shape, volatility and privileges; exact claimed attempt and notice tagging on real claims and
-- records, including a price-draft revision change during delivery; callback before the outcome
-- record (S-37, S-38) on both ledgers; same-row/different-attempt and cross-ledger conflicts;
-- current-snapshot recovery after the competing record disappears; stored conflicts staying
-- excluded; unmatched receipts staying unmatched; claim times from existing evidence only (an
-- unknown price-draft claim time stays unknown); one expiry predicate on every surface; ledger
-- counts kept apart from global counts, which equal the owner-email readback's; attention
-- readbacks unchanged; parity with the owner-email readback on identical scenarios; output keys;
-- read purity; unchanged definitions.
-- Synthetic identities and content only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1240000-0000-4000-8000-000000000001','ledgers-operator@example.test',now(),'{}'),
 ('e1240000-0000-4000-8000-000000000002','ledgers-homeowner@example.test',now(),'{}'),
 ('e1240000-0000-4000-8000-000000000003','ledgers-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1240000-0000-4000-8000-000000000001','admin'),
 ('e1240000-0000-4000-8000-000000000002','homeowner'),
 ('e1240000-0000-4000-8000-000000000003','vendor')
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
 select pg_temp.run('e1240000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e1240000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;

-- The route's receive call, exactly as SQL 121 and 122 make it.
create function pg_temp.recv(p_id text, p_type text, p_email text default null, p_tags text default 'absent',
  p_ledger text default null, p_ref uuid default null, p_attempt int default null,
  p_bounce text default null, p_created timestamptz default '2026-11-18T10:00:00Z')
returns text language sql as $$
 select pg_temp.svc(format('select public.email_receive_provider_event(p_svix_id=>%L,p_secret_slot=>%L,p_processing=>%L,p_event_type=>%L,'
   'p_provider_type=>%L,p_provider_created_at=>%L,p_provider_email_id=>%L,p_bounce_type=>%L,p_bounce_subtype=>%L,'
   'p_tag_status=>%L,p_tag_ledger=>%L,p_tag_ref=>%L,p_tag_attempt=>%L)',
   p_id,'current','recorded',p_type,p_type,p_created,p_email,p_bounce,case when p_bounce is not null then 'general' end,
   p_tags,p_ledger,p_ref,p_attempt))->>'result' $$;

-- Fixtures ----------------------------------------------------------------------------------
-- Applications 1..40, each with its pending delivery record from the TRACE-104 trigger. Version
-- intake is skipped so applications can be deleted below (versions are immutable evidence).
alter table public.vendor_applications disable trigger vendor_version_intake;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone)
 select ('e1241000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic App '||n,'Ann','Applicant','ledgers-app@example.test','synthetic'
   from generate_series(1,40) n;
alter table public.vendor_applications enable trigger vendor_version_intake;
create function pg_temp.app(p_n int) returns uuid language sql as $$ select ('e1241000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;

-- Contact submissions 1..10 (owner-email rows from the 7.2C-1 trigger), for cross-ledger cases
-- and parity.
insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 select ('e1242000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic','Sender','ledgers-sender@example.test',null,'Synthetic','Synthetic body'
   from generate_series(1,10) n;
create function pg_temp.src(p_n int) returns uuid language sql as $$ select ('e1242000-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
create function pg_temp.oe(p_n int) returns uuid language sql as $$
 select id from private.owner_email_notifications where contact_submission_id = pg_temp.src(p_n) $$;

-- Price drafts 1..30 for one unbound provider with a contact email, each sent at revision 'h1'
-- with its pending notice, as admin_send_package_draft leaves them.
insert into public.contractors(id,name,email) values ('e1243000-0000-4000-8000-000000000001','Synthetic Draft Co','ledgers-draft@example.test');
create function pg_temp.draft(p_n int) returns uuid language sql as $$ select ('e1243100-0000-4000-8000-'||lpad(p_n::text,12,'0'))::uuid $$;
insert into private.operator_package_drafts(id,contractor_id,service_id,name,prices,created_by,updated_by,content,content_hash,approval_state,sent_hash,sent_at)
 select pg_temp.draft(n),'e1243000-0000-4000-8000-000000000001',(select id from public.services_catalog order by id limit 1),
   'Synthetic draft '||n,'[{"price":100}]','e1240000-0000-4000-8000-000000000001','e1240000-0000-4000-8000-000000000001','{}','h1','sent','h1',now()
   from generate_series(1,30) n;
insert into private.package_draft_email_notices(draft_id,revision) select pg_temp.draft(n),'h1' from generate_series(1,30) n;
create function pg_temp.notice(p_n int, p_revision text default 'h1') returns uuid language sql as $$
 select id from private.package_draft_email_notices where draft_id = pg_temp.draft(p_n) and revision = p_revision $$;

-- Real claims, records and operator resends.
create function pg_temp.app_claim(p_n int, p_mode text default 'initial') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.r0_claim_application_notification(%L,%L)', pg_temp.app(p_n), p_mode)) $$;
create function pg_temp.app_record(p_n int, p_claim jsonb, p_outcome text, p_email text default null) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.r0_record_application_notification(%L,%L,%L,%L,%L)', pg_temp.app(p_n), p_claim->>'claim_id',
   p_outcome, p_email, case when p_outcome = 'sent' then null else 'Resend returned 500' end)) $$;
create function pg_temp.app_resend(p_n int) returns jsonb language sql as $$
 select pg_temp.op(format('select public.r0_request_application_notification_resend(%L, true)', pg_temp.app(p_n))) $$;
create function pg_temp.draft_claim(p_n int, p_mode text default 'initial') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.pricing_claim_draft_email(%L,%L)', pg_temp.draft(p_n), p_mode)) $$;
create function pg_temp.draft_record(p_n int, p_claim jsonb, p_outcome text, p_email text default null) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.pricing_record_draft_email(%L,%L,%L,%L,%L)', pg_temp.draft(p_n), p_claim->>'claim_id',
   p_outcome, p_email, case when p_outcome = 'sent' then null else 'Resend returned 500' end)) $$;
create function pg_temp.draft_resend(p_n int) returns jsonb language sql as $$
 select pg_temp.op(format('select public.admin_request_draft_email(%L, true, true)', pg_temp.draft(p_n))) $$;

-- A receipt inserted directly (the table's coherence checks still apply), for content
-- conflicts, stored classes and expiry boundaries.
create function pg_temp.put(p_id text, p_ledger text, p_ref uuid, p_attempt int, p_type text, p_email text,
  p_class text default 'tag_and_id', p_bounce text default null, p_created timestamptz default '2026-11-18T10:00:00Z',
  p_expires timestamptz default now() + interval '1 day', p_content_conflict boolean default false) returns void
language sql as $$
 insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,
   provider_created_at,provider_email_id,bounce_type,tag_ledger,tag_ref,tag_attempt,
   application_notification,owner_email_notification,package_draft_notice,linked_attempt,identity_class,content_conflict,conflict_seen_at)
 values (p_id, now() - interval '2 days', p_expires, 'current', 'recorded', p_type, p_type, p_created, p_email, p_bounce,
   case when p_class not in ('id_only','unmatched','conflict_id_ambiguous') then p_ledger end,
   case when p_class not in ('id_only','unmatched','conflict_id_ambiguous') then p_ref end,
   case when p_class not in ('id_only','unmatched','conflict_id_ambiguous') then p_attempt end,
   case when p_ledger = 'application' and p_class in ('id_only','tag_only','tag_and_id') then p_ref end,
   case when p_ledger = 'owner_email' and p_class in ('id_only','tag_only','tag_and_id') then p_ref end,
   case when p_ledger = 'package_draft' and p_class in ('id_only','tag_only','tag_and_id') then p_ref end,
   case when p_class in ('id_only','tag_only','tag_and_id') then p_attempt end,
   p_class, p_content_conflict, case when p_content_conflict then now() end) $$;

create function pg_temp.aev(p_n int) returns jsonb language sql as $$ select private.email_evidence_ledger_row('application', pg_temp.app(p_n)) $$;
create function pg_temp.dev(p_n int, p_revision text default 'h1') returns jsonb language sql as $$
 select private.email_evidence_ledger_row('package_draft', pg_temp.notice(p_n, p_revision)) $$;
create function pg_temp.st(p_id text) returns text language sql as $$
 select private.email_evidence_receipt_state(e) from private.email_provider_events e where svix_id = p_id $$;
create function pg_temp.class(p_id text) returns text language sql as $$
 select identity_class from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.link(p_id text) returns text language sql as $$
 select concat_ws('|', identity_class, coalesce(application_notification::text, package_draft_notice::text, owner_email_notification::text, 'none'),
   coalesce(linked_attempt::text, 'none')) from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.hist(p_ev jsonb, p_attempt int) returns text language sql as $$
 select string_agg(r->>'fact'||':'||coalesce(r->>'excluded','trusted'), ',' order by r->>'fact', r->>'excluded')
   from jsonb_array_elements(p_ev->'attempts') a, jsonb_array_elements(a->'reports') r where (a->>'attempt')::int = p_attempt $$;
-- Everything a read could touch.
create function pg_temp.world() returns text language sql as $$
 select md5(concat_ws('#',
   (select string_agg(to_jsonb(e)::text, ',' order by svix_id) from private.email_provider_events e),
   (select string_agg(to_jsonb(p)::text, ',' order by id) from private.email_provider_event_purges p),
   (select string_agg(to_jsonb(c)::text, ',') from private.email_evidence_config c),
   (select string_agg(to_jsonb(n)::text, ',' order by application_id) from private.r0_application_notifications n),
   (select string_agg(to_jsonb(v)::text, ',' order by id) from private.r0_application_notification_events v),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.package_draft_email_notices n),
   (select string_agg(to_jsonb(d)::text, ',' order by id) from private.operator_package_drafts d),
   (select string_agg(to_jsonb(n)::text, ',' order by id) from private.owner_email_notifications n),
   (select string_agg(to_jsonb(v)::text, ',' order by id) from private.owner_email_notification_events v))) $$;

-- 1. Shape, volatility and privileges --------------------------------------------------------
create temp table new_functions(sig regprocedure, kind text);
insert into new_functions values
 ('private.email_evidence_ledger_claimed_at(text,uuid,integer)','private'),
 ('private.email_evidence_ledger_receipts(text,uuid)','private'),
 ('private.email_evidence_ledger_row(text,uuid)','private'),
 ('private.email_evidence_ledger_counts(text)','private'),
 ('private.email_evidence_global_counts()','private'),
 ('public.application_email_evidence(uuid[])','operator'),
 ('public.application_email_evidence_counts()','operator'),
 ('public.package_draft_email_evidence(uuid[])','operator'),
 ('public.package_draft_email_evidence_counts()','operator');
create temp table c1_functions(sig regprocedure);
insert into c1_functions values
 ('public.owner_email_correlation_ref(text,uuid)'),('public.owner_email_evidence(text,uuid[])'),('public.owner_email_evidence_counts()'),
 ('private.email_evidence_fact(text,text)'),('private.email_evidence_identity_holds(private.email_provider_events)'),
 ('private.email_evidence_receipt_state(private.email_provider_events)'),('private.email_evidence_summary(text[],timestamptz)'),
 ('private.email_evidence_owner_claimed_at(uuid,integer)'),('private.email_evidence_owner_receipts(uuid)'),('private.email_evidence_owner_row(uuid)');
grant select on new_functions, c1_functions to public;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and (p.proname like 'email\_evidence\_%' or p.proname like '%email\_evidence%')
    and p.oid not in (select sig::oid from new_functions) and p.oid not in (select sig::oid from c1_functions)
    -- TRACE-155 (7.3D-1, 20261128001000): its arming, coverage and probe functions, tested in SQL 125.
    and p.oid <> all(array['private.email_evidence_arming_events_guard()','private.email_evidence_transition(text,text)',
      'public.email_evidence_arm(text)','public.email_evidence_disarm(text)','private.email_evidence_retry_horizon()',
      'private.email_evidence_coverage(timestamptz)','public.email_evidence_arming_readback()',
      'public.email_evidence_probe_authorize()','public.email_evidence_probe_readback(text)']::regprocedure[]::oid[])),0,
 'this slice adds exactly the nine listed functions beside the ten 7.3C-1 functions');
select is((select count(*)::int from new_functions),9,'nine new functions');
select is((select string_agg(distinct p.provolatile::text, ',') from pg_proc p where p.oid in (select sig::oid from new_functions)),
 's','every new function is STABLE (none can write)');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=sig::oid), sig::text||' is security definer with an empty search_path')
  from new_functions where kind = 'operator';
select ok((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid=sig::oid), sig::text||' runs as its caller with an empty search_path')
  from new_functions where kind = 'private';
select ok(not has_function_privilege(r, sig, 'EXECUTE'), sig::text||' is not executable by '||r)
  from new_functions, unnest(array['anon','authenticated','service_role']) r where kind = 'private';
select ok(has_function_privilege('authenticated', sig, 'EXECUTE') and not has_function_privilege('anon', sig, 'EXECUTE')
  and not has_function_privilege('service_role', sig, 'EXECUTE'), sig::text||' is granted to authenticated only')
  from new_functions where kind = 'operator';
select ok(not exists (select 1 from pg_depend d where d.objid in (select sig::oid from new_functions)
  and d.refobjid = 'private.email_provider_events'::regclass),'no new function takes or returns the receipt row type');
create temp table calls(sql text);
insert into calls values
 ('select public.application_email_evidence(array[]::uuid[])'),('select public.application_email_evidence_counts()'),
 ('select public.package_draft_email_evidence(array[]::uuid[])'),('select public.package_draft_email_evidence_counts()');
grant select on calls to public;
select throws_ok(format('select pg_temp.run(null,%L,%L)', r, c.sql),'42501',null, r||' is refused: '||c.sql)
  from calls c, unnest(array['anon','service_role']) r;
select throws_ok(format('select pg_temp.user(%s,%L)', u, c.sql),'42501',null, 'user '||u||' (not an operator) is refused: '||c.sql)
  from calls c, unnest(array[2,3]) u;
select lives_ok(format('select pg_temp.op(%L)', c.sql), 'the operator reads: '||c.sql) from calls c;

-- 2. Application: the claimed attempt, callback before the outcome record (S-37, S-38) ---------
-- The application ledger's key is application_id, so the sender tags with it and the claim's
-- attempt. Each row is claimed for real, receives a tagged report before its record, then
-- records (a) the same ID, (b) a different ID, (c) an unknown outcome.
create temp table ac as select n, pg_temp.app_claim(n) as claim from generate_series(1,3) n;
select is((select (claim->>'attempt')::int from ac where n = x), 1, 'application '||x||' claims attempt 1') from generate_series(1,3) x;
select is(pg_temp.recv('msg-a'||n,'email.delivered','em-a'||n,'valid','application',pg_temp.app(n),1),'recorded','tagged report before the record '||n)
  from generate_series(1,3) n;
select is(pg_temp.link('msg-a'||n),'tag_only|'||pg_temp.app(n)||'|1','linked by its tag to its own row and claimed attempt '||n)
  from generate_series(1,3) n;
select is(pg_temp.st('msg-a1'),'trusted','while the row is sending, the report is trusted (no ID recorded anywhere)');
select is(pg_temp.app_record(1,(select claim from ac where n=1),'sent','em-a1')->>'state','sent','(a) the same ID is recorded');
select is(pg_temp.app_record(2,(select claim from ac where n=2),'sent','em-a2-other')->>'state','sent','(b) a different ID is recorded');
select is(pg_temp.app_record(3,(select claim from ac where n=3),'unknown')->>'state','unknown','(c) an unknown outcome is recorded');
select is(pg_temp.class('msg-a'||n),'tag_only','the stored class is unchanged by the record '||n) from generate_series(1,3) n;
select is((pg_temp.aev(1)->'summary'->>'rule')::int,4,'(a) agreement: trusted, rule 4');
select is(pg_temp.aev(1)->>'has_conflict','false','(a) no conflict');
select is((pg_temp.aev(2)->'summary'->>'rule')::int,10,'(b) a different ID: the report is excluded');
select is(pg_temp.aev(2)->'conflict_reasons','["current_conflict"]'::jsonb,'(b) as a current conflict, even though no other row holds the ID');
select is(pg_temp.aev(2)->>'has_conflict','true','(b) a current conflict alone raises the row''s conflict signal');
select is((pg_temp.aev(3)->'summary'->>'rule')::int,4,'(c) S-38: rule 4 on an unknown row');
select is(private.r0_notification_view(pg_temp.app(3)),'unknown','S-38: the row stays unknown');
select throws_ok(format('select pg_temp.op(%L)', format('select public.r0_request_application_notification_resend(%L, false)', pg_temp.app(3))),
 '55000',null,'S-38: a resend of the unknown row still needs the inbox attestation');
select is(pg_temp.recv('msg-a3-future','email.delivered','em-a3-f','valid','application',pg_temp.app(3),2),'recorded','a report tagged for an attempt not yet claimed');
select is(pg_temp.class('msg-a3-future'),'conflict_tag_invalid','is a stored tag conflict, never linked');

-- 3. Price draft: the claimed notice, through a revision change during delivery ---------------
-- pricing_claim_draft_email returns the claimed notice_id. The sender tags with exactly that
-- notice, never the draft ID and never a later lookup of the current revision.
create temp table d1 as select pg_temp.draft_claim(1) as claim;
grant select on d1 to public;
select is((select claim->>'notice_id' from d1), pg_temp.notice(1)::text, 'the claim returns the notice of the revision it claimed');
select is((select (claim->>'attempt')::int from d1), 1, 'attempt 1');
-- The operator saves and sends revision h2 while h1's email is in flight (admin_send_package_draft
-- inserts the new revision's notice and moves the sent revision).
update private.operator_package_drafts set content_hash='h2', sent_hash='h2', sent_at=now() where id=pg_temp.draft(1);
insert into private.package_draft_email_notices(draft_id,revision) values (pg_temp.draft(1),'h2');
select is(pg_temp.recv('msg-d1','email.delivered','em-d1','valid','package_draft',(select (claim->>'notice_id')::uuid from d1),1),'recorded',
 'the report tagged with the claimed notice');
select is(pg_temp.link('msg-d1'),'tag_only|'||pg_temp.notice(1,'h1')||'|1','links to the claimed revision''s notice, not the current one');
select is(pg_temp.draft_record(1,(select claim from d1),'sent','em-d1')->>'state','sent','the record lands on the claimed notice by its claim');
select is((select state||'|'||provider_message_id from private.package_draft_email_notices where id=pg_temp.notice(1,'h1')),'sent|em-d1','h1''s notice holds the outcome');
select is((select state||'|'||attempts from private.package_draft_email_notices where id=pg_temp.notice(1,'h2')),'pending|0','h2''s notice is untouched');
create temp table d1_read as select pg_temp.op(format('select public.package_draft_email_evidence(%L::uuid[])', array[pg_temp.draft(1)])) as v;
grant select on d1_read to public;
select is((select jsonb_array_length(v->'items') from d1_read),1,'one draft');
select is((select string_agg(concat_ws(':', n->>'current', n->>'state', n->'summary'->>'rule', n->>'attempt'), ',' order by (n->>'current')::boolean desc)
  from d1_read, jsonb_array_elements(v->'items'->0->'notices') n),
 'true:pending:10:0,false:sent:4:1','the current revision''s notice has no evidence; the claimed revision''s notice holds rule 4');
-- What the wrong references would have produced: the draft ID, or the current revision's notice.
select is(pg_temp.recv('msg-d2-draftid','email.delivered','em-d2-x','valid','package_draft',pg_temp.draft(2),1),'recorded','tagged with a draft ID');
select is(pg_temp.class('msg-d2-draftid'),'conflict_tag_invalid','a draft ID is not a notice: a stored tag conflict');
update private.operator_package_drafts set content_hash='h2', sent_hash='h2', sent_at=now() where id=pg_temp.draft(2);
insert into private.package_draft_email_notices(draft_id,revision) values (pg_temp.draft(2),'h2');
select is(pg_temp.recv('msg-d2-current','email.delivered','em-d2-y','valid','package_draft',pg_temp.notice(2,'h2'),1),'recorded','tagged with the current revision''s notice');
select is(pg_temp.class('msg-d2-current'),'conflict_tag_invalid','that notice has no attempt 1: a stored tag conflict');

-- Callback before the record on price drafts 3, 4 and 5: (a) same ID, (b) different, (c) unknown.
create temp table dc as select n, pg_temp.draft_claim(n) as claim from generate_series(3,5) n;
grant select on dc to public;
select is((select claim->>'notice_id' from dc where n=x), pg_temp.notice(x)::text, 'claim '||x||' names its notice') from generate_series(3,5) x;
select is(pg_temp.recv('msg-d'||n,'email.delivered','em-d'||n,'valid','package_draft',pg_temp.notice(n),1),'recorded','tagged report before the record '||n)
  from generate_series(3,5) n;
select is(pg_temp.draft_record(3,(select claim from dc where n=3),'sent','em-d3')->>'state','sent','(a) same ID');
select is(pg_temp.draft_record(4,(select claim from dc where n=4),'sent','em-d4-other')->>'state','sent','(b) different ID');
select is(pg_temp.draft_record(5,(select claim from dc where n=5),'unknown')->>'state','unknown','(c) unknown');
select is(pg_temp.class('msg-d'||n),'tag_only','stored class unchanged '||n) from generate_series(3,5) n;
select is((pg_temp.dev(3)->'summary'->>'rule')::int,4,'(a) price draft: trusted, rule 4');
select is((pg_temp.dev(4)->'summary'->>'rule')::int,10,'(b) price draft: excluded');
select is(pg_temp.dev(4)->'conflict_reasons','["current_conflict"]'::jsonb,'(b) price draft: as a current conflict');
select is((pg_temp.dev(5)->'summary'->>'rule')::int,4,'(c) price draft: rule 4 on an unknown notice');
select is((select private.package_draft_email_view(e) from private.package_draft_email_notices e where id=pg_temp.notice(5)),'unknown',
 '(c) the notice stays unknown');

-- 4. Same row, different attempt (the conservative whole-row check, Codex D-4 retained) --------
-- Application 4 and price draft 6: attempt 1 unknown with a tagged report, then an operator
-- resend, and attempt 2 records a different ID.
create temp table a4 as select pg_temp.app_claim(4) as c1;
grant select on a4 to public;
select is(pg_temp.recv('msg-a4-1','email.delivered','em-a4-1','valid','application',pg_temp.app(4),1),'recorded','attempt 1 report');
select is(pg_temp.app_record(4,(select c1 from a4),'unknown')->>'state','unknown','attempt 1 unknown');
select is(pg_temp.st('msg-a4-1'),'trusted','attempt 1''s report is trusted while the row holds no ID');
select is(pg_temp.app_resend(4)->>'state','resend_requested','the operator resends with the attestation');
create temp table a4b as select pg_temp.app_claim(4,'resend') as c2;
grant select on a4b to public;
select is((select (c2->>'attempt')::int from a4b),2,'the resend claims attempt 2');
select is(pg_temp.app_record(4,(select c2 from a4b),'sent','em-a4-2')->>'state','sent','attempt 2 records a different ID');
select is(pg_temp.st('msg-a4-1'),'current_conflict','attempt 1''s earlier report is excluded once the row records another ID (whole-row check)');
select is(pg_temp.recv('msg-a4-s54','email.delivered','em-a4-2','valid','application',pg_temp.app(4),1),'recorded','S-54: attempt 1 tag with attempt 2''s ID');
select is(pg_temp.class('msg-a4-s54'),'conflict_disagree','is a stored disagreement');
select is(pg_temp.recv('msg-a4-2','email.delivered','em-a4-2','valid','application',pg_temp.app(4),2),'recorded','attempt 2 report');
select is(pg_temp.class('msg-a4-2'),'tag_and_id','agrees with the recorded ID');
select is((pg_temp.aev(4)->'summary'->>'rule')::int,4,'the current attempt 2 reads rule 4');
select is(pg_temp.aev(4)->'conflict_reasons','["current_conflict", "stored_conflict"]'::jsonb,'both conflicts are signalled on the row');
select is(pg_temp.hist(pg_temp.aev(4),1),'delivered:current_conflict,delivered:stored_conflict','attempt 1''s history lists each report once, excluded');
select is(pg_temp.hist(pg_temp.aev(4),2),'delivered:trusted','attempt 2''s history');

create temp table d6 as select pg_temp.draft_claim(6) as c1;
grant select on d6 to public;
select is(pg_temp.recv('msg-d6-1','email.delivered','em-d6-1','valid','package_draft',pg_temp.notice(6),1),'recorded','price draft attempt 1 report');
select is(pg_temp.draft_record(6,(select c1 from d6),'unknown')->>'state','unknown','price draft attempt 1 unknown');
select is(pg_temp.draft_resend(6)->>'state','resend_requested','the operator resends');
create temp table d6b as select pg_temp.draft_claim(6,'resend') as c2;
grant select on d6b to public;
select is((select (c2->>'attempt')::int||'|'||(c2->>'notice_id') from d6b),'2|'||pg_temp.notice(6),'the resend claims attempt 2 of the same notice');
select is(pg_temp.draft_record(6,(select c2 from d6b),'sent','em-d6-2')->>'state','sent','price draft attempt 2 records a different ID');
select is(pg_temp.st('msg-d6-1'),'current_conflict','price draft attempt 1''s report is excluded (whole-row check)');
select is((pg_temp.dev(6)->'summary'->>'rule')::int,10,'price draft current attempt 2 has no report');
select is(pg_temp.dev(6)->'conflict_reasons','["current_conflict"]'::jsonb,'price draft row signals the current conflict');

-- 5. Cross-ledger conflicts: derived ones recover, stored ones never do ------------------------
-- Application 5: tag_only report; an owner-email row then records its ID; that source is deleted.
select is((pg_temp.app_claim(5)->>'attempt')::int,1,'application 5 claims attempt 1');
select is(pg_temp.recv('msg-a5','email.delivered','em-x5','valid','application',pg_temp.app(5),1),'recorded','application 5 tag_only report');
select is(pg_temp.st('msg-a5'),'trusted','trusted before any other row holds its ID');
create temp table conflicting_before as
 select (pg_temp.op('select public.application_email_evidence_counts()')->'ledger'->>'conflicting_rows')::int as n;
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-x5' where id=pg_temp.oe(1);
select is(pg_temp.st('msg-a5'),'current_conflict','excluded while an owner-email row holds its ID');
select is((pg_temp.op('select public.application_email_evidence_counts()')->'ledger'->>'conflicting_rows')::int,(select n + 1 from conflicting_before),
 'counted as one more conflicting application row');
delete from public.contact_submissions where id=pg_temp.src(1);
select is(pg_temp.st('msg-a5'),'trusted','trusted again once that record is gone (current-snapshot exclusion)');
select is((pg_temp.op('select public.application_email_evidence_counts()')->'ledger'->>'conflicting_rows')::int,(select n from conflicting_before),
 'and the conflicting-row count moves back');
select is((pg_temp.aev(5)->'summary'->>'rule')::int,4,'its summary returns');
-- Price draft 7: tag_only report; application 6 then records its ID; that application is deleted.
select is((pg_temp.draft_claim(7)->>'attempt')::int,1,'price draft 7 claims attempt 1');
select is(pg_temp.recv('msg-d7','email.delivered','em-x7','valid','package_draft',pg_temp.notice(7),1),'recorded','price draft 7 tag_only report');
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-x7' where application_id=pg_temp.app(6);
select is(pg_temp.st('msg-d7'),'current_conflict','excluded while an application row holds its ID');
delete from public.vendor_applications where id=pg_temp.app(6);
select is(pg_temp.st('msg-d7'),'trusted','trusted again after the application is deleted');
-- Application 7, id_only: a price-draft notice then records the same ID (ambiguous); its draft is deleted.
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-x8' where application_id=pg_temp.app(7);
select is(pg_temp.recv('msg-a7','email.delivered','em-x8'),'recorded','untagged report with application 7''s ID');
select is(pg_temp.link('msg-a7'),'id_only|'||pg_temp.app(7)||'|1','id_only on its sent attempt');
update private.package_draft_email_notices set state='sent', attempts=1, sent_at=now(), provider_message_id='em-x8' where id=pg_temp.notice(8);
select is(pg_temp.st('msg-a7'),'current_conflict','excluded while the ID is ambiguous across ledgers');
delete from private.operator_package_drafts where id=pg_temp.draft(8);
select is(pg_temp.st('msg-a7'),'trusted','trusted again after the draft (and its notice) is deleted');
-- Stored: application 8 tagged (attempt 1, no ID) with owner-email row 2's ID → conflict_disagree.
select is((pg_temp.app_claim(8)->>'attempt')::int,1,'application 8 claims attempt 1');
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-oe2' where id=pg_temp.oe(2);
select is(pg_temp.recv('msg-a8','email.delivered','em-oe2','valid','application',pg_temp.app(8),1),'recorded','application tag with an owner row''s ID');
select is(pg_temp.class('msg-a8'),'conflict_disagree','a stored cross-ledger disagreement');
select is(pg_temp.aev(8)->'conflict_reasons','["stored_conflict"]'::jsonb,'signalled on the application named by its tag');
select is(private.email_evidence_owner_row(pg_temp.oe(2))->'conflict_reasons','["stored_conflict"]'::jsonb,'and on the owner row named by its ID');
delete from public.contact_submissions where id=pg_temp.src(2);
select is(pg_temp.st('msg-a8'),'stored_conflict','still excluded after the owner row is deleted (stored conflicts are never restored)');
select is(pg_temp.aev(8)->'conflict_reasons','["stored_conflict"]'::jsonb,'and still signalled on the application');
-- Stored: price draft 9 tagged (attempt 1) with application 9's ID → conflict_disagree.
select is((pg_temp.draft_claim(9)->>'attempt')::int,1,'price draft 9 claims attempt 1');
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-a9' where application_id=pg_temp.app(9);
select is(pg_temp.recv('msg-d9','email.bounced','em-a9','valid','package_draft',pg_temp.notice(9),1,'permanent'),'recorded','price draft tag with an application''s ID');
select is(pg_temp.class('msg-d9'),'conflict_disagree','a stored cross-ledger disagreement');
select is(pg_temp.aev(9)->'conflict_reasons','["stored_conflict"]'::jsonb,'signalled on the application named by its ID');
select is((pg_temp.aev(9)->'summary'->>'rule')::int,10,'and never counted as its evidence (no "not delivered")');
delete from public.vendor_applications where id=pg_temp.app(9);
select is(pg_temp.dev(9)->'conflict_reasons','["stored_conflict"]'::jsonb,'still excluded and signalled on the draft after the application is deleted');
select is(pg_temp.hist(pg_temp.dev(9),1),'bounced_permanent:stored_conflict','under its tag attempt, as received');

-- 6. Unmatched stays unmatched (S-48, early untagged callback) ---------------------------------
create temp table a10 as select pg_temp.app_claim(10) as c;
select is(pg_temp.recv('msg-a10','email.delivered','em-a10'),'recorded','an untagged report before the record');
select is(pg_temp.class('msg-a10'),'unmatched','is unmatched');
select is(pg_temp.app_record(10,(select c from a10),'sent','em-a10')->>'state','sent','the row then records that ID');
select is(pg_temp.class('msg-a10'),'unmatched','still unmatched after the row records that ID');
select is(pg_temp.st('msg-a10'),'unlinked','never rematched on read');
select is((pg_temp.aev(10)->'summary'->>'rule')::int||'|'||jsonb_array_length(pg_temp.aev(10)->'attempts'),'10|0','the row shows no evidence and no history');
create temp table d10 as select pg_temp.draft_claim(10) as c;
grant select on d10 to public;
select is(pg_temp.recv('msg-d10','email.delivered','em-d10'),'recorded','price draft: untagged report before the record');
select is(pg_temp.draft_record(10,(select c from d10),'sent','em-d10')->>'state','sent','price draft: the notice then records that ID');
select is(pg_temp.st('msg-d10'),'unlinked','price draft: still unmatched after the record');
select is((pg_temp.dev(10)->'summary'->>'rule')::int,10,'price draft: no evidence');

-- 7. Claim times from existing evidence only (§8.4) --------------------------------------------
-- Application 11 and price draft 11: attempt 1 claimed and left unknown, resent, attempt 2 claimed.
create temp table a11 as select pg_temp.app_claim(11) as c1;
grant select on a11 to public;
select is(pg_temp.app_record(11,(select c1 from a11),'unknown')->>'state','unknown','application 11 attempt 1 unknown');
select is(pg_temp.app_resend(11)->>'state','resend_requested','application 11 resend requested');
create temp table a11b as select pg_temp.app_claim(11,'resend') as c2;
grant select on a11b to public;
select is(pg_temp.app_record(11,(select c2 from a11b),'unknown')->>'state','unknown','application 11 attempt 2 unknown');
update private.r0_application_notification_events set created_at = now() - interval '2 hours'
 where application_id=pg_temp.app(11) and state='sending' and attempt=1;
select is(private.email_evidence_ledger_claimed_at('application',pg_temp.app(11),1), now() - interval '2 hours','application attempt 1: its sending event');
select is(private.email_evidence_ledger_claimed_at('application',pg_temp.app(11),2), now(),'application attempt 2: its sending event');
create temp table d11 as select pg_temp.draft_claim(11) as c1;
grant select on d11 to public;
select is(pg_temp.draft_record(11,(select c1 from d11),'unknown')->>'state','unknown','price draft 11 attempt 1 unknown');
select is(pg_temp.draft_resend(11)->>'state','resend_requested','price draft 11 resend requested');
create temp table d11b as select pg_temp.draft_claim(11,'resend') as c2;
grant select on d11b to public;
select is(pg_temp.draft_record(11,(select c2 from d11b),'unknown')->>'state','unknown','price draft 11 attempt 2 unknown');
select is(private.email_evidence_ledger_claimed_at('package_draft',pg_temp.notice(11),2), now(),'price draft current attempt: the notice''s claimed_at');
select is(private.email_evidence_ledger_claimed_at('package_draft',pg_temp.notice(11),1), null,'price draft earlier attempt: unknown, not invented');
select is(private.email_evidence_ledger_claimed_at('owner_email',pg_temp.oe(3),1), null,'another ledger name selects nothing');
-- An excluded report on each attempt 1 so attempt 1 appears in history with an empty fact set.
select pg_temp.put('msg-a11-cc','application',pg_temp.app(11),1,'email.delivered','em-a11-1','tag_only',null,'2026-11-18T10:00:00Z',now()+interval '1 day',true);
select pg_temp.put('msg-d11-cc','package_draft',pg_temp.notice(11),1,'email.delivered','em-d11-1','tag_only',null,'2026-11-18T10:00:00Z',now()+interval '1 day',true);
select is((pg_temp.aev(11)->'summary'->>'rule')::int,10,'unarmed: application rule 10');
-- TRACE-155 (7.3D-1, 20261128001000): rule 9 reads the audited arming intervals, so this case
-- arms through the history (one arm event and the matching armed_at). Expected rules unchanged.
insert into private.email_evidence_arming_events(seq, action, occurred_at, actor, reason)
  values (1, 'arm', now() - interval '1 hour', 'e1240000-0000-4000-8000-000000000001', 'Synthetic arming');
insert into private.email_evidence_config(singleton, armed_at) values (true, now() - interval '1 hour');
select is((pg_temp.aev(11)->'summary'->>'rule')::int,9,'armed before attempt 2''s claim: application rule 9');
select is((select (a->>'rule')::int from jsonb_array_elements(pg_temp.aev(11)->'attempts') a where (a->>'attempt')::int=1),10,
 'application attempt 1 was claimed before arming: rule 10');
select is((pg_temp.dev(11)->'summary'->>'rule')::int,9,'armed before the current claim: price draft rule 9');
select is((select (a->>'rule')::int from jsonb_array_elements(pg_temp.dev(11)->'attempts') a where (a->>'attempt')::int=1),10,
 'price draft attempt 1''s claim time is unknown: rule 10, never rule 9');
select is((pg_temp.op('select public.application_email_evidence_counts()')->'all_emails'->>'receiver_armed')::boolean,true,'receiver_armed reads the arming record');
delete from private.email_evidence_config;
alter table private.email_evidence_arming_events disable trigger email_evidence_arming_events_guard;
delete from private.email_evidence_arming_events;
alter table private.email_evidence_arming_events enable trigger email_evidence_arming_events_guard;

-- 8. Expiry boundaries (S-34, readback side) ----------------------------------------------------
-- After the last real receive (each receive purges expired rows). One second before expiry is
-- visible; at and after expiry a report is excluded from summary, history, counts and signal.
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-a12' where application_id=pg_temp.app(12);
select pg_temp.put('msg-a12-live','application',pg_temp.app(12),1,'email.delivered','em-a12','tag_and_id',null,'2026-11-18T10:00:00Z',now()+interval '1 second');
select pg_temp.put('msg-a12-at','application',pg_temp.app(12),1,'email.bounced','em-a12','tag_and_id','permanent','2026-11-18T10:01:00Z',now());
select pg_temp.put('msg-a12-past','application',pg_temp.app(12),1,'email.complained','em-a12','tag_and_id',null,'2026-11-18T10:02:00Z',now()-interval '1 second');
select pg_temp.put('msg-a12-conf','application',pg_temp.app(12),1,'email.delivered','em-a12-c','conflict_tag_invalid',null,'2026-11-18T10:03:00Z',now());
select is(pg_temp.st('msg-a12-'||x), case x when 'live' then 'trusted' else 'expired' end, 'S-34: '||x) from unnest(array['live','at','past','conf']) x;
select is((pg_temp.aev(12)->'summary'->>'rule')::int,4,'only the unexpired report counts: rule 4, not 2 or 1');
select is(pg_temp.hist(pg_temp.aev(12),1),'delivered:trusted','history omits expired reports');
select is(pg_temp.aev(12)->>'has_conflict','false','an expired stored conflict raises no signal');
update private.package_draft_email_notices set state='sent', attempts=1, sent_at=now(), provider_message_id='em-d12' where id=pg_temp.notice(12);
select pg_temp.put('msg-d12-live','package_draft',pg_temp.notice(12),1,'email.bounced','em-d12','tag_and_id','permanent','2026-11-18T10:00:00Z',now()+interval '1 second');
select pg_temp.put('msg-d12-at','package_draft',pg_temp.notice(12),1,'email.delivered','em-d12','tag_and_id',null,'2026-11-18T10:01:00Z',now());
select is((pg_temp.dev(12)->'summary'->>'rule')::int,5,'price draft: the expired delivered report cannot turn rule 5 into rule 2');

-- 9. Counts: ledger scope and global scope ------------------------------------------------------
-- A small, known world: every receipt above is removed (the table owner deletes; no read path
-- writes), the ledger states are set, the attention readbacks are recorded, then receipts are
-- added. Application 13 sent, permanent bounce (not delivered); 14 unknown with a permanent
-- bounce (proven, but not a sent row); 15 sent, delivered + complaint (to review); 16 sent, a
-- content conflict; 17 named by a stored tag conflict. Price draft 13 sent, suppressed (not
-- delivered); 14 sent, transient bounce (to review). Globally one unmatched, one expired.
delete from private.email_provider_events;
update private.r0_application_notifications n set state='sent', attempts=1, sent_at=now(), provider_message_id='em-c'||x.n
  from (values (13),(15),(16)) x(n) where n.application_id=pg_temp.app(x.n);
update private.r0_application_notifications set state='unknown', attempts=1 where application_id=pg_temp.app(14);
update private.package_draft_email_notices n set state='sent', attempts=1, sent_at=now(), provider_message_id='em-dc'||x.n
  from (values (13),(14)) x(n) where n.id=pg_temp.notice(x.n);
create temp table attention_before as select
 pg_temp.op('select public.r0_application_notification_overview()')->'items' as apps,
 pg_temp.op('select public.admin_package_drafts()') as drafts,
 pg_temp.op('select public.owner_email_overview(null,true,null,null,100)')->'attention_count' as owner;
grant select on attention_before to public;
select pg_temp.put('msg-c13','application',pg_temp.app(13),1,'email.bounced','em-c13','tag_and_id','permanent');
select pg_temp.put('msg-c14','application',pg_temp.app(14),1,'email.bounced','em-c14','tag_only','permanent');
select pg_temp.put('msg-c15a','application',pg_temp.app(15),1,'email.delivered','em-c15','tag_and_id',null,'2026-11-18T10:00:00Z');
select pg_temp.put('msg-c15b','application',pg_temp.app(15),1,'email.complained','em-c15','tag_and_id',null,'2026-11-18T10:01:00Z');
select pg_temp.put('msg-c16','application',pg_temp.app(16),1,'email.bounced','em-c16','tag_and_id','permanent','2026-11-18T10:00:00Z',now()+interval '1 day',true);
select pg_temp.put('msg-dc13','package_draft',pg_temp.notice(13),1,'email.suppressed','em-dc13','tag_and_id');
select pg_temp.put('msg-dc14','package_draft',pg_temp.notice(14),1,'email.bounced','em-dc14','tag_and_id','transient');
select pg_temp.put('msg-unmatched','application',null,null,'email.delivered','em-nobody','unmatched');
select pg_temp.put('msg-stored','application',pg_temp.app(17),1,'email.delivered','em-x17','conflict_tag_invalid');
select pg_temp.put('msg-expired','application',null,null,'email.bounced','em-old','unmatched','permanent','2026-11-18T10:00:00Z',now()-interval '1 second');
select is(pg_temp.op('select public.application_email_evidence_counts()')->'ledger',
 '{"to_review": 1, "not_delivered": 1, "conflicting_rows": 2}'::jsonb,
 'application ledger: 13 not delivered; 15 to review; 14 (unknown, proven) in neither; 16 and 17 conflicting');
select is(pg_temp.op('select public.package_draft_email_evidence_counts()')->'ledger',
 '{"to_review": 1, "not_delivered": 1, "conflicting_rows": 0}'::jsonb,
 'price-draft ledger: 13 not delivered (suppressed); 14 to review (transient bounce)');
select is(pg_temp.op('select public.application_email_evidence_counts()')->'all_emails',
 jsonb_build_object('receiver_armed', false,
   'unmatched_reports', jsonb_build_object('total', 1, 'by_type', jsonb_build_object('email.delivered', 1)),
   'retention_backlog', jsonb_build_object('expired', 1, 'expired_over_cap', false, 'oldest_expires_at', now() - interval '1 second'),
   'conflicting_reports', jsonb_build_object('content_conflict', 1, 'conflict_disagree', 0, 'conflict_tag_invalid', 1, 'conflict_id_ambiguous', 0)),
 'global: one unmatched, one tag conflict, one content conflict, one expired (backlog only)');
select is(pg_temp.op('select public.package_draft_email_evidence_counts()')->'all_emails',
 pg_temp.op('select public.application_email_evidence_counts()')->'all_emails','both pages read the same global counts');
select is(pg_temp.op('select public.owner_email_evidence_counts()') - 'checked_at' - 'not_delivered' - 'to_review' - 'conflicting_rows',
 pg_temp.op('select public.application_email_evidence_counts()')->'all_emails','the global counts equal the owner-email readback''s global keys');
select is(pg_temp.op('select public.owner_email_evidence_counts()')->>'conflicting_rows','0','no owner-email row is counted for another ledger''s reports');
select is(pg_temp.op('select public.r0_application_notification_overview()')->'items',(select apps from attention_before),
 'the Recruiting attention readback is identical with and without receipts');
select is(pg_temp.op('select public.admin_package_drafts()'),(select drafts from attention_before),
 'the price-draft panel readback (including email state) is identical with and without receipts');
select is(pg_temp.op('select public.owner_email_overview(null,true,null,null,100)')->'attention_count',(select owner from attention_before),
 'the owner-email attention counts are unchanged');

-- 10. Output keys and bounds ---------------------------------------------------------------------
create temp table app_page as select pg_temp.op(format('select public.application_email_evidence(%L::uuid[])',
  array[pg_temp.app(13), pg_temp.app(15), pg_temp.app(16), pg_temp.app(9), 'e1249999-0000-4000-8000-000000000001'::uuid])) as v;
grant select on app_page to public;
select is((select array_agg(i->>'application_id' order by i->>'application_id') from app_page, jsonb_array_elements(v->'items') i),
 array[pg_temp.app(13)::text, pg_temp.app(15)::text, pg_temp.app(16)::text],'exactly the requested tracked applications; deleted or unknown ones are omitted');
select is((select array_agg(distinct k order by k) from app_page, jsonb_object_keys(v) k),array['checked_at','items'],'application top-level keys');
select is((select array_agg(distinct k order by k) from app_page, jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k),
 array['application_id','attempt','attempts','conflict_reasons','has_conflict','summary'],'application item keys');
select is((select array_agg(distinct k order by k) from app_page, jsonb_array_elements(v->'items') i, jsonb_array_elements(i->'attempts') a, jsonb_object_keys(a) k),
 array['attempt','coverage','delivered_fact','has_conflict','needs_review','non_delivery_proven','reported','reports','rule'],'application history attempt keys');
select is((select array_agg(distinct k order by k) from app_page, jsonb_array_elements(v->'items') i, jsonb_array_elements(i->'attempts') a,
  jsonb_array_elements(a->'reports') r, jsonb_object_keys(r) k),
 array['bounce_subtype','bounce_type','excluded','fact','provider_created_at'],'application history report keys');
select ok((select v::text from app_page) !~ '(em-|msg-)','no provider email ID or svix-id in the application output');
create temp table draft_page as select pg_temp.op(format('select public.package_draft_email_evidence(%L::uuid[])',
  array[pg_temp.draft(13), pg_temp.draft(14), pg_temp.draft(8), pg_temp.draft(1), 'e1249999-0000-4000-8000-000000000002'::uuid])) as v;
grant select on draft_page to public;
select is((select array_agg(i->>'draft_id' order by i->>'draft_id') from draft_page, jsonb_array_elements(v->'items') i),
 array[pg_temp.draft(1)::text, pg_temp.draft(13)::text, pg_temp.draft(14)::text],'exactly the requested drafts with notices; deleted or unknown ones are omitted');
select is((select array_agg(distinct k order by k) from draft_page, jsonb_array_elements(v->'items') i, jsonb_object_keys(i) k),
 array['draft_id','notices'],'draft item keys');
select is((select array_agg(distinct k order by k) from draft_page, jsonb_array_elements(v->'items') i, jsonb_array_elements(i->'notices') n, jsonb_object_keys(n) k),
 array['attempt','attempts','conflict_reasons','current','has_conflict','queued_at','state','summary'],'notice keys');
select ok((select v::text from draft_page) !~ '(em-|msg-)'
  and position(pg_temp.notice(13)::text in (select v::text from draft_page)) = 0
  and position(pg_temp.notice(1,'h1')::text in (select v::text from draft_page)) = 0
  and position(pg_temp.notice(1,'h2')::text in (select v::text from draft_page)) = 0
  and position('"h1"' in (select v::text from draft_page)) = 0,
 'no provider email ID, svix-id, notice ID or revision hash in the draft output');
select is(pg_temp.op('select public.application_email_evidence(array[]::uuid[])')->'items','[]'::jsonb,'an empty application list reads nothing');
select is(pg_temp.op('select public.package_draft_email_evidence(array[]::uuid[])')->'items','[]'::jsonb,'an empty draft list reads nothing');
select throws_ok(format('select pg_temp.op(%L)', format('select public.%s(%L::uuid[])', f,
  (select array_agg(gen_random_uuid()) from generate_series(1,101)))),'22023',null,f||': more than 100 are refused')
  from unnest(array['application_email_evidence','package_draft_email_evidence']) f;
select lives_ok(format('select pg_temp.op(%L)', format('select public.%s(%L::uuid[])', f,
  (select array_agg(gen_random_uuid()) from generate_series(1,100)))),f||': exactly 100 are read')
  from unnest(array['application_email_evidence','package_draft_email_evidence']) f;
select throws_ok(format('select pg_temp.op(%L)', format('select public.%s(null)', f)),'22023',null,f||': a null list is refused')
  from unnest(array['application_email_evidence','package_draft_email_evidence']) f;

-- 11. Parity with the owner-email readback ------------------------------------------------------
-- The same receipts on an owner-email row, an application row and a price-draft notice (each
-- sent on attempt 2 with its own ID) give the same evidence, value for value.
update private.owner_email_notifications set state='sent', attempts=2, sent_at=now(), provider_message_id='em-par-o' where id=pg_temp.oe(3);
update private.r0_application_notifications set state='sent', attempts=2, sent_at=now(), provider_message_id='em-par-a' where application_id=pg_temp.app(18);
update private.package_draft_email_notices set state='sent', attempts=2, sent_at=now(), provider_message_id='em-par-d' where id=pg_temp.notice(15);
create temp table parity(ledger text, ref uuid, tag text);
insert into parity values ('owner_email',pg_temp.oe(3),'o'),('application',pg_temp.app(18),'a'),('package_draft',pg_temp.notice(15),'d');
grant select on parity to public;
select pg_temp.put('msg-par1-'||tag,ledger,ref,1,'email.delivered','em-par-'||tag||'-1','tag_only',null,'2026-11-18T10:00:00Z') from parity;
select pg_temp.put('msg-par2-'||tag,ledger,ref,2,'email.delivered','em-par-'||tag,'tag_and_id',null,'2026-11-18T10:01:00Z') from parity;
select pg_temp.put('msg-par3-'||tag,ledger,ref,2,'email.bounced','em-par-'||tag,'tag_and_id','permanent','2026-11-18T10:02:00Z') from parity;
select pg_temp.put('msg-par4-'||tag,ledger,ref,2,'email.bounced','em-par-'||tag,'tag_and_id','transient','2026-11-18T10:03:00Z',now()+interval '1 day',true) from parity;
select pg_temp.put('msg-par5-'||tag,ledger,ref,3,'email.delivered','em-par-'||tag||'-3','conflict_tag_invalid',null,'2026-11-18T10:04:00Z') from parity;
select pg_temp.put('msg-par6-'||tag,ledger,ref,null,'email.delivered','em-par-'||tag,'conflict_id_ambiguous',null,'2026-11-18T10:05:00Z') from parity;
select pg_temp.put('msg-par7-'||tag,ledger,ref,2,'email.delivered','em-par-'||tag,'tag_and_id',null,'2026-11-18T10:06:00Z',now()) from parity;
select is(private.email_evidence_ledger_row('application',pg_temp.app(18)), private.email_evidence_owner_row(pg_temp.oe(3)),
 'application evidence equals owner-email evidence for the same receipts');
select is(private.email_evidence_ledger_row('package_draft',pg_temp.notice(15)), private.email_evidence_owner_row(pg_temp.oe(3)),
 'price-draft evidence equals owner-email evidence for the same receipts');
select is(private.email_evidence_ledger_row('application',pg_temp.app(18)) - 'attempts',
 jsonb_build_object('attempt',2,'has_conflict',true,'conflict_reasons',jsonb_build_array('content_conflict','current_conflict','stored_conflict'),
   'summary',jsonb_build_object('rule',2,'coverage','unknown','delivered_fact',true,'non_delivery_proven',false,'needs_review',true,'reported',jsonb_build_array('bounced_permanent'))),
 'rule 2 on the sent attempt, with every conflict kind signalled');
select is((select string_agg((a->>'attempt')||':'||(a->>'rule'), ',' order by (a->>'attempt')::int) from jsonb_array_elements(pg_temp.aev(18)->'attempts') a),
 '1:10,2:2,3:10','history per attempt; a received future tag attempt is a label, never a claim (D-6)');
select is(pg_temp.hist(pg_temp.aev(18),2),'bounced_permanent:trusted,bounced_transient:content_conflict,delivered:stored_conflict,delivered:trusted',
 'attempt 2 lists its reports once each; the expired one is absent');

-- 12. Read purity --------------------------------------------------------------------------------
insert into private.email_evidence_config(singleton, armed_at) values (true, now() - interval '1 hour');
create temp table world_before as select pg_temp.world() as digest;
grant select on world_before to public;
select ok(pg_temp.op('select public.application_email_evidence_counts()') is not null, 'read: application counts');
select ok(pg_temp.op('select public.package_draft_email_evidence_counts()') is not null, 'read: price-draft counts');
select ok(pg_temp.op(format('select public.application_email_evidence(%L::uuid[])', (select array_agg(pg_temp.app(n)) from generate_series(1,40) n))) is not null,
 'read: every application');
select ok(pg_temp.op(format('select public.package_draft_email_evidence(%L::uuid[])', (select array_agg(pg_temp.draft(n)) from generate_series(1,30) n))) is not null,
 'read: every draft');
select ok((select bool_and(private.email_evidence_ledger_row('application', application_id) is not null) from private.r0_application_notifications),
 'read: every application row''s evidence');
select ok((select bool_and(private.email_evidence_ledger_row('package_draft', id) is not null) from private.package_draft_email_notices),
 'read: every notice''s evidence');
select is(pg_temp.world(), (select digest from world_before),
 'receipts, purge audit, arming record, all three ledgers, both event logs and the drafts are byte-identical after every read');
select is((select count(*)::int from private.email_provider_events where expires_at <= now()) > 0, true, 'expired receipts are still stored: nothing purged');

-- 13. Unchanged definitions ------------------------------------------------------------------------
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
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid = any(array['private.email_provider_events_guard()','private.email_provider_event_retention(boolean)',
   'private.email_provider_id_candidate(text)','private.email_provider_tag_exists(text,uuid,integer)',
   'public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)',
   'public.email_provider_events_purge(integer)']::regprocedure[]::oid[])),
 '6|57277a24ac11744bde74a0be96cbd79d','the six 7.3B receiver functions are unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.oid::regprocedure::text))
  from pg_proc p where p.oid in (select sig::oid from c1_functions)),
 -- TRACE-155 (7.3D-1, 20261128001000) deliberately restates one of the ten,
 -- private.email_evidence_summary (functiondef md5 e3436221f69164c48be9d90f70f3dd6f →
 -- 8eadddd6f47401258d747248a38ce507), so the set moves from 10|8177b42a7194ac42e22bd908558f1dff.
 -- The other nine are unchanged; SQL 125 pins them separately.
 '10|f258d4e1699becf089efb72725581d1c','the ten 7.3C-1 functions: only the deliberately restated summary changed');
select is((select md5(string_agg(format('%s %s %s %s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull), ',' order by c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','owner_email_notifications','package_draft_email_notices')
    and a.attnum>0 and not a.attisdropped),
 '0e06a9c789f1968178c5fadc97793c33','the three ledger tables'' columns are unchanged');

select * from finish();
rollback;
