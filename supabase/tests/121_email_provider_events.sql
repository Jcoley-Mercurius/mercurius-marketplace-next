-- TRACE-155 (Phase 7.3B): dormant receipt of Resend provider events.
-- Shape, coherence checks and privileges; independent identity resolution across the three
-- ledgers (S-31, S-32, S-52 to S-56, the receipt-time half of S-57); duplicates, content
-- conflicts and their injected failure (S-20, S-22 single-session, S-23, S-25); cascade with
-- the source (S-33); immutable expiry (S-59); boundary, bounded and ordered purge on receipt and
-- the clamped operator purge (S-34 to S-36, S-60); access (S-27); no ledger mutation; and the
-- unchanged existing definitions. Concurrency (S-21, S-22, S-58, S-61) and the migration lock
-- timeouts are in scripts/email-provider-events-concurrency.mjs.
-- Synthetic identities and content only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-155 (7.3C-1, Codex review 5926523770 item 3): the original 7.2C owner-email functions
-- by exact signature. Later slices add owner_email_* functions (correlation ref, evidence
-- readback) that are tested in their own files; a name filter would silently widen these checks.
create function pg_temp.legacy_owner_email_functions() returns oid[] language sql as $$
 select array['private.owner_email_require_kind(text)','private.owner_email_state(text,timestamptz,timestamptz)',
  'private.owner_email_log(uuid,text,uuid,text,text,integer,uuid,text,text,text)','private.owner_email_lock(text,uuid)',
  'private.owner_email_refuse_untracked(text,uuid)','private.owner_email_contact_create()','public.owner_email_claim(text,uuid,text)',
  'public.owner_email_record(text,uuid,uuid,text,text,text)','public.owner_email_request_resend(text,uuid,boolean)',
  'public.owner_email_acknowledge(text,uuid,text,boolean)','public.owner_email_overview(text,boolean,timestamptz,uuid,integer)',
  'public.owner_email_contact_submission(uuid)','private.owner_email_renewal_create()']::regprocedure[]::oid[] $$;

-- 1 operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1210000-0000-4000-8000-000000000001','evidence-operator@example.test',now(),'{}'),
 ('e1210000-0000-4000-8000-000000000002','evidence-homeowner@example.test',now(),'{}'),
 ('e1210000-0000-4000-8000-000000000003','evidence-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1210000-0000-4000-8000-000000000001','admin'),
 ('e1210000-0000-4000-8000-000000000002','homeowner'),
 ('e1210000-0000-4000-8000-000000000003','vendor')
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
 select pg_temp.run('e1210000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e1210000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;

-- The route's call, with named arguments exactly as the route sends them.
create function pg_temp.call(p_id text, p_type text, p_email text default null, p_tags text default 'absent',
  p_ledger text default null, p_ref uuid default null, p_attempt int default null,
  p_bounce text default null, p_sub text default null, p_slot text default 'current',
  p_created timestamptz default '2026-11-16T10:00:00Z', p_processing text default 'recorded', p_ptype text default null)
returns text language sql as $$
 select format('select public.email_receive_provider_event(p_svix_id=>%L,p_secret_slot=>%L,p_processing=>%L,p_event_type=>%L,'
   'p_provider_type=>%L,p_provider_created_at=>%L,p_provider_email_id=>%L,p_bounce_type=>%L,p_bounce_subtype=>%L,'
   'p_tag_status=>%L,p_tag_ledger=>%L,p_tag_ref=>%L,p_tag_attempt=>%L)',
   p_id,p_slot,p_processing,p_type,
   case when p_processing='invalid_payload' then null else coalesce(p_ptype, p_type) end,
   case when p_processing='invalid_payload' then null else p_created end,
   p_email,p_bounce,p_sub,p_tags,p_ledger,p_ref,p_attempt) $$;
create function pg_temp.recv(p_id text, p_type text, p_email text default null, p_tags text default 'absent',
  p_ledger text default null, p_ref uuid default null, p_attempt int default null,
  p_bounce text default null, p_sub text default null, p_slot text default 'current',
  p_created timestamptz default '2026-11-16T10:00:00Z', p_processing text default 'recorded', p_ptype text default null)
returns text language sql as $$
 select pg_temp.svc(pg_temp.call(p_id,p_type,p_email,p_tags,p_ledger,p_ref,p_attempt,p_bounce,p_sub,p_slot,p_created,p_processing,p_ptype))->>'result' $$;
create function pg_temp.ev(p_id text) returns private.email_provider_events language sql as $$
 select * from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.class(p_id text) returns text language sql as $$
 select identity_class from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.linked(p_id text) returns text language sql as $$
 select coalesce(application_notification::text, owner_email_notification::text, package_draft_notice::text, 'none')
   ||':'||coalesce(linked_attempt::text,'-') from private.email_provider_events where svix_id = p_id $$;
create function pg_temp.ledgers() returns text language sql as $$
 select md5(coalesce((select string_agg(to_jsonb(n)::text, ',' order by application_id) from private.r0_application_notifications n),'')
   ||coalesce((select string_agg(to_jsonb(n)::text, ',' order by id) from private.owner_email_notifications n),'')
   ||coalesce((select string_agg(to_jsonb(n)::text, ',' order by id) from private.package_draft_email_notices n),'')) $$;

-- 1. Shape and privileges (S-27) ---------------------------------------------------------
select has_table('private','email_provider_events','the receipt table exists');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
  where table_schema='private' and table_name='email_provider_events'),
 array['svix_id','received_at','expires_at','secret_slot','processing','event_type','provider_type','provider_created_at',
  'provider_email_id','bounce_type','bounce_subtype','tag_ledger','tag_ref','tag_attempt','application_notification',
  'owner_email_notification','package_draft_notice','linked_attempt','identity_class','content_conflict','conflict_seen_at'],
 'exactly the planned columns: no address, subject, Message-ID, bounce text, header or body');
select ok((select relrowsecurity from pg_class where oid=t::regclass), 'RLS on '||t)
  from unnest(array['private.email_provider_events','private.email_provider_event_purges','private.email_evidence_config']) t;
select is((select relacl::text from pg_class where oid=t::regclass), '{postgres=arwdDxtm/postgres}', 'owner-only grants on '||t)
  from unnest(array['private.email_provider_events','private.email_provider_event_purges','private.email_evidence_config']) t;
select is((select count(*)::int from private.email_evidence_config), 0, 'the arming record is created empty');
select ok(not has_function_privilege(r,'public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)','EXECUTE'),
 'receive is not executable by '||r) from unnest(array['anon','authenticated']) r;
select ok(has_function_privilege('service_role','public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)','EXECUTE'),
 'receive is executable by the service role only');
select ok(has_function_privilege('authenticated','public.email_provider_events_purge(integer)','EXECUTE')
  and not has_function_privilege('anon','public.email_provider_events_purge(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.email_provider_events_purge(integer)','EXECUTE'),
 'the operator purge is granted to authenticated (operator-guarded) only');
select ok(not has_function_privilege(r,f,'EXECUTE'), f||' is not executable by '||r)
  from unnest(array['anon','authenticated','service_role']) r,
       unnest(array['private.email_provider_events_guard()','private.email_provider_event_retention(boolean)',
                    'private.email_provider_id_candidate(text)','private.email_provider_tag_exists(text,uuid,integer)']) f;
select ok(not has_table_privilege(r,'private.email_provider_events',p), r||' has no '||p||' on receipts')
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p;
select throws_ok(format('select pg_temp.run(null,%L,%L)', 'anon', pg_temp.call('msg-anon','email.delivered','em-x')),
 '42501', null, 'anon cannot call receive');
select throws_ok(format('select pg_temp.user(3,%L)', pg_temp.call('msg-vendor','email.delivered','em-x')),
 '42501', null, 'a vendor session cannot call receive');
select throws_ok('select pg_temp.user(2,''select public.email_provider_events_purge(10)'')', '42501', null,
 'a homeowner cannot purge');
select throws_ok('select pg_temp.user(3,''select public.email_provider_events_purge(10)'')', '42501', null,
 'a vendor cannot purge');
select throws_ok('select pg_temp.svc(''select public.email_provider_events_purge(10)'')', '42501', null,
 'the service role cannot purge');
select throws_ok('select pg_temp.run(null,''anon'',''select public.email_provider_events_purge(10)'')', '42501', null,
 'anon cannot purge');
select throws_ok('select pg_temp.user(3,''select count(*) from private.email_provider_events'')', '42501', null,
 'a vendor session cannot read receipts');

-- Indexes: the planned lookups, and non-unique partial provider-ID indexes on the ledgers.
select is((select array_agg(indexname::text order by indexname) from pg_indexes where schemaname='private' and tablename='email_provider_events'),
 array['email_provider_events_application_notification','email_provider_events_expiry','email_provider_events_owner_email_notification',
  'email_provider_events_package_draft_notice','email_provider_events_pkey','email_provider_events_provider_email_id','email_provider_events_tag'],
 'receipt indexes: provider ID, tag, each FK column and (expires_at, svix_id)');
select is((select indexdef from pg_indexes where schemaname='private' and indexname=t||'_provider_message_id'),
 format('CREATE INDEX %s_provider_message_id ON private.%s USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL)', t, t),
 'an ordinary non-unique partial provider-ID index on '||t)
  from unnest(array['r0_application_notifications','owner_email_notifications','package_draft_email_notices']) t;

-- 2. Fixtures ---------------------------------------------------------------------------
-- Version intake is skipped for these synthetic applications so one can be deleted below
-- (versions are immutable evidence); the delivery-record trigger stays enabled.
alter table public.vendor_applications disable trigger vendor_version_intake;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone) values
 ('e1211000-0000-4000-8000-0000000000a1','Synthetic App One','Ann','Applicant','evidence-app1@example.test','synthetic'),
 ('e1211000-0000-4000-8000-0000000000a2','Synthetic App Two','Bo','Applicant','evidence-app2@example.test','synthetic'),
 ('e1211000-0000-4000-8000-0000000000a3','Synthetic App Three','Cy','Applicant','evidence-app3@example.test','synthetic');
alter table public.vendor_applications enable trigger vendor_version_intake;
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-app-1'
 where application_id='e1211000-0000-4000-8000-0000000000a1';
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-collide'
 where application_id='e1211000-0000-4000-8000-0000000000a3';
insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 select ('e1212000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic','Sender','evidence-sender@example.test',null,'Synthetic','Synthetic body'
   from generate_series(1,7) n;
create function pg_temp.oe(p_n int) returns uuid language sql as $$
 select id from private.owner_email_notifications where contact_submission_id=('e1212000-0000-4000-8000-00000000000'||p_n)::uuid $$;
-- oe1: unknown attempt 1 (no ID); oe2: sent attempt 2; oe3: sent attempt 1; oe4 collides with app3;
-- oe5 and oe6 share one ID; oe7 is pending.
update private.owner_email_notifications set state='unknown', attempts=1 where id=pg_temp.oe(1);
update private.owner_email_notifications set state='sent', attempts=2, sent_at=now(), provider_message_id='em-oe-2' where id=pg_temp.oe(2);
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-oe-3' where id=pg_temp.oe(3);
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-collide' where id=pg_temp.oe(4);
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-same' where id in (pg_temp.oe(5), pg_temp.oe(6));
insert into public.contractors(id,name,email) values ('e1213000-0000-4000-8000-000000000001','Synthetic Draft Co','evidence-draft@example.test');
insert into private.operator_package_drafts(id,contractor_id,service_id,name,prices,created_by,updated_by,content,content_hash,approval_state,sent_hash,sent_at)
 values ('e1213000-0000-4000-8000-0000000000d1','e1213000-0000-4000-8000-000000000001',(select id from public.services_catalog order by id limit 1),
  'Synthetic draft','[{"price":100}]','e1210000-0000-4000-8000-000000000001','e1210000-0000-4000-8000-000000000001','{}','h1','sent','h1',now());
insert into private.package_draft_email_notices(id,draft_id,revision,state,attempts,sent_at,provider_message_id)
 values ('e1213000-0000-4000-8000-0000000000e1','e1213000-0000-4000-8000-0000000000d1','h1','sent',1,now(),'em-draft-1');
create temp table ledger_before as select pg_temp.ledgers() as digest;

-- 3. Provider-ID candidate across all three ledgers ---------------------------------------
select is(private.email_provider_id_candidate('em-app-1'),
 jsonb_build_object('kind','one','ledger','application','ref','e1211000-0000-4000-8000-0000000000a1','attempt',1),'one application row');
select is(private.email_provider_id_candidate('em-oe-2')->>'attempt','2','the owner-email row''s sent attempt');
select is(private.email_provider_id_candidate('em-draft-1')->>'ledger','package_draft','a price-draft notice');
select is(private.email_provider_id_candidate('em-collide')->>'kind','ambiguous','one ID in two ledgers is ambiguous');
select is(private.email_provider_id_candidate('em-same')->>'kind','ambiguous','one ID twice in one ledger is ambiguous');
select is(private.email_provider_id_candidate('em-none')->>'kind','none','no row');
select is(private.email_provider_id_candidate(null)->>'kind','missing','no ID');

-- 4. Identity resolution at receipt -------------------------------------------------------
-- S-32
select is(pg_temp.recv('msg-s32-id','email.delivered','em-app-1'),'recorded','S-32 untagged with a unique ID is recorded');
select is(pg_temp.class('msg-s32-id'),'id_only','S-32 class id_only');
select is(pg_temp.linked('msg-s32-id'),'e1211000-0000-4000-8000-0000000000a1:1','S-32 linked to that row''s sent attempt');
select is((pg_temp.ev('msg-s32-id')).expires_at - (pg_temp.ev('msg-s32-id')).received_at, interval '90 days','a linked receipt expires after 90 days (EO-2 proposal)');
select is(pg_temp.recv('msg-s32-none','email.delivered','em-none'),'recorded','S-32 untagged without a match is recorded');
select is(pg_temp.class('msg-s32-none'),'unmatched','S-32 class unmatched');
select is(pg_temp.linked('msg-s32-none'),'none:-','S-32 unmatched is not linked');
select is((pg_temp.ev('msg-s32-none')).expires_at - (pg_temp.ev('msg-s32-none')).received_at, interval '30 days','an unlinked receipt expires after 30 days (EO-2 proposal)');
select is(pg_temp.recv('msg-draft-id','email.delivered','em-draft-1'),'recorded','untagged price-draft ID');
select is(pg_temp.linked('msg-draft-id'),'e1213000-0000-4000-8000-0000000000e1:1','linked to the price-draft notice');
-- S-31
select is(pg_temp.recv('msg-s31-tag','email.delivered','em-new-1','valid','owner_email',pg_temp.oe(1),1),'recorded','S-31 valid tag');
select is(pg_temp.class('msg-s31-tag'),'tag_only','S-31 a valid tag to an existing row and attempt with no ID anywhere is tag_only');
select is(pg_temp.linked('msg-s31-tag'),pg_temp.oe(1)||':1','S-31 linked to the tagged row and attempt');
select is(pg_temp.recv('msg-s31-norow','email.delivered','em-new-2','valid','owner_email','e1219999-0000-4000-8000-000000000000',1),'recorded','S-31 tag to a missing row');
select is(pg_temp.class('msg-s31-norow')||'|'||pg_temp.linked('msg-s31-norow')||'|'||(pg_temp.ev('msg-s31-norow')).tag_ref,
 'conflict_tag_invalid|none:-|e1219999-0000-4000-8000-000000000000','S-31 missing row: conflict_tag_invalid, unlinked, opaque tag kept');
select is(pg_temp.recv('msg-s31-future','email.delivered','em-new-3','valid','owner_email',pg_temp.oe(1),2),'recorded','S-31 tag to a future attempt');
select is(pg_temp.class('msg-s31-future'),'conflict_tag_invalid','S-31 attempt beyond the row''s attempts is conflict_tag_invalid');
select is(pg_temp.recv('msg-s31-partial','email.delivered','em-new-4','invalid'),'recorded','S-31 partial or malformed tags (route sends invalid)');
select is(pg_temp.class('msg-s31-partial')||'|'||coalesce((pg_temp.ev('msg-s31-partial')).tag_ledger,'null'),'conflict_tag_invalid|null',
 'S-31 malformed tags: conflict_tag_invalid with no tag stored');
select is(pg_temp.recv('msg-tag-id','email.delivered','em-oe-2','valid','owner_email',pg_temp.oe(2),2),'recorded','tag and ID agree');
select is(pg_temp.class('msg-tag-id')||'|'||pg_temp.linked('msg-tag-id'),'tag_and_id|'||pg_temp.oe(2)||':2','tag_and_id linked to the agreed row and attempt');
-- S-52 to S-56
select is(pg_temp.recv('msg-s52','email.bounced','em-oe-3','valid','owner_email',pg_temp.oe(1),1,'permanent','general'),'recorded','S-52');
select is(pg_temp.class('msg-s52')||'|'||pg_temp.linked('msg-s52'),'conflict_disagree|none:-',
 'S-52 tag names unknown attempt A of X; the ID belongs to Y in the same ledger: conflict_disagree, no FK');
select is(pg_temp.recv('msg-s53','email.delivered','em-app-1','valid','owner_email',pg_temp.oe(1),1),'recorded','S-53');
select is(pg_temp.class('msg-s53')||'|'||pg_temp.linked('msg-s53'),'conflict_disagree|none:-','S-53 the ID belongs to a row in another ledger: conflict_disagree');
select is(pg_temp.recv('msg-s54','email.delivered','em-oe-2','valid','owner_email',pg_temp.oe(2),1),'recorded','S-54');
select is(pg_temp.class('msg-s54'),'conflict_disagree','S-54 same row, different attempt: conflict_disagree');
select is(pg_temp.recv('msg-s55-x','email.delivered','em-collide'),'recorded','S-55 cross-ledger collision, untagged');
select is(pg_temp.recv('msg-s55-xt','email.delivered','em-collide','valid','application','e1211000-0000-4000-8000-0000000000a3',1),'recorded','S-55 cross-ledger collision, tagged');
select is(pg_temp.recv('msg-s55-s','email.delivered','em-same'),'recorded','S-55 same-ledger collision, untagged');
select is(pg_temp.recv('msg-s55-st','email.delivered','em-same','valid','owner_email',pg_temp.oe(5),1),'recorded','S-55 same-ledger collision, tagged');
select is(pg_temp.class(s)||'|'||pg_temp.linked(s),'conflict_id_ambiguous|none:-','S-55 ambiguous and never linked: '||s)
  from unnest(array['msg-s55-x','msg-s55-xt','msg-s55-s','msg-s55-st']) s;
select is(pg_temp.recv('msg-s56-bad','email.delivered','em-app-1','invalid'),'recorded','S-56 malformed tag with a uniquely matching ID');
select is(pg_temp.recv('msg-s56-norow','email.delivered','em-app-1','valid','application','e1219999-0000-4000-8000-000000000001',1),'recorded','S-56 missing-row tag with a uniquely matching ID');
select is(pg_temp.recv('msg-s56-future','email.delivered','em-oe-3','valid','owner_email',pg_temp.oe(3),5),'recorded','S-56 future-attempt tag with its own row''s ID');
select is(pg_temp.class(s)||'|'||pg_temp.linked(s),'conflict_tag_invalid|none:-','S-56 no fallback to the ID: '||s)
  from unnest(array['msg-s56-bad','msg-s56-norow','msg-s56-future']) s;
-- Missing ID, unknown types and verified-malformed payloads.
select is(pg_temp.recv('msg-noid','email.delivered',null),'recorded','an email event without an ID');
select is(pg_temp.class('msg-noid'),'id_missing','id_missing');
select is(pg_temp.recv('msg-noid-tag','email.delivered',null,'valid','owner_email',pg_temp.oe(1),1),'recorded','a valid tag without an ID');
select is(pg_temp.class('msg-noid-tag')||'|'||pg_temp.linked('msg-noid-tag'),'id_missing|none:-','a valid tag without an ID is id_missing and not linked');
select is(pg_temp.recv('msg-other','other','em-app-1','valid','owner_email',pg_temp.oe(1),1,p_ptype=>'email.opened'),'recorded','an unknown type');
select is(row((pg_temp.ev('msg-other')).event_type,(pg_temp.ev('msg-other')).provider_type,(pg_temp.ev('msg-other')).provider_email_id,
  (pg_temp.ev('msg-other')).tag_ref,pg_temp.class('msg-other'))::text,'(other,email.opened,,,unmatched)',
 'an unknown type keeps only its type: never matched, no ID or tag stored');
select is(pg_temp.recv('msg-invalid','other',p_processing=>'invalid_payload'),'recorded','a verified-malformed payload');
select is(row((pg_temp.ev('msg-invalid')).processing,(pg_temp.ev('msg-invalid')).event_type,(pg_temp.ev('msg-invalid')).provider_type,
  (pg_temp.ev('msg-invalid')).provider_created_at,pg_temp.class('msg-invalid'))::text,'(invalid_payload,other,,,unmatched)',
 'an invalid_payload receipt holds no data');
select throws_ok(pg_temp.call('msg-invalid-data','other','em-app-1',p_processing=>'invalid_payload'),'22023',null,
 'an invalid_payload receipt with data is refused');
select throws_ok(pg_temp.call('msg-bad-tags','email.delivered','em-app-1','valid','owner_email',null,1),'22023',null,
 'a valid tag status needs all three tag values');
select throws_ok(pg_temp.call('msg-bad-slot','email.delivered','em-app-1',p_slot=>'other'),'22023',null,'an unknown secret slot is refused');
select throws_ok(pg_temp.call('bad id','email.delivered','em-app-1'),'23514',null,'an svix-id with a space is refused by the table');
select is(pg_temp.recv('msg-bounce-type','email.delivered','em-none',p_bounce=>'permanent',p_sub=>'general')||'|'||
  coalesce((pg_temp.ev('msg-bounce-type')).bounce_type,'null'),'recorded|null','bounce fields are kept only on bounces');
select is((select pg_temp.ledgers()), (select digest from ledger_before), 'no receipt changed any ledger row');

-- 5. Duplicates and content conflicts (S-20, S-22 in one session, S-23, S-25) ------------
select is(pg_temp.recv('msg-s32-id','email.delivered','em-app-1'),'duplicate','S-20/S-25 a repeated delivery is a duplicate');
select is(pg_temp.recv('msg-s32-id','email.delivered','em-app-1',p_slot=>'previous'),'duplicate','a retry verified by the other secret is still a duplicate');
select is((select count(*)::int from private.email_provider_events where svix_id='msg-s32-id'),1,'one row per svix-id');
select is((pg_temp.ev('msg-s32-id')).secret_slot,'current','the first receipt is kept');
create function pg_temp.fail_update() returns trigger language plpgsql as $$ begin raise exception 'injected' using errcode='XX000'; end $$;
create trigger t_fail_update before update on private.email_provider_events for each row execute function pg_temp.fail_update();
select throws_ok(pg_temp.call('msg-s32-id','email.bounced','em-app-1',p_bounce=>'permanent',p_sub=>'general'),'XX000',null,
 'S-23 a failing conflict-flag update raises, so the route answers 5xx');
drop trigger t_fail_update on private.email_provider_events;
select is((pg_temp.ev('msg-s32-id')).content_conflict,false,'S-23 nothing was flagged by the failed call');
select is(pg_temp.recv('msg-s32-id','email.bounced','em-app-1',p_bounce=>'permanent',p_sub=>'general'),'conflict','S-22 different content under one svix-id');
select is(row((pg_temp.ev('msg-s32-id')).event_type,(pg_temp.ev('msg-s32-id')).bounce_type,(pg_temp.ev('msg-s32-id')).content_conflict,
  (pg_temp.ev('msg-s32-id')).conflict_seen_at is not null,pg_temp.class('msg-s32-id'))::text,'(email.delivered,,t,t,id_only)',
 'the first normalized receipt is kept; the differing content is not stored; the flag is set');
select is(pg_temp.recv('msg-s32-id','email.complained','em-app-1'),'conflict','a further different content is a conflict');
select is(pg_temp.recv('msg-s32-id','email.delivered','em-app-1'),'duplicate','the original content is still a duplicate');
select is(pg_temp.recv('msg-s32-id','email.delivered','em-app-1',p_created=>'2026-11-16T10:00:01Z'),'conflict','a different provider time is a conflict');
select is(pg_temp.recv('msg-s32-none','email.delivered','em-none','invalid'),'conflict','an untagged receipt replayed with malformed tags is a conflict');
select is(pg_temp.recv('msg-s31-partial','email.delivered','em-new-4','invalid'),'duplicate','malformed tags replayed identically are a duplicate');
select is(pg_temp.recv('msg-s31-partial','email.delivered','em-new-4'),'conflict','the same receipt without its tags is a conflict');
select is(pg_temp.recv('msg-invalid','other',p_processing=>'invalid_payload'),'duplicate','a verified-malformed duplicate');
select is(pg_temp.recv('msg-invalid','email.delivered','em-none'),'conflict','a well-formed payload under a malformed receipt''s svix-id is a conflict');

-- S-57, receipt-time half. Identity class depends on when a receipt arrives, not on what it
-- says, so a later retry is a duplicate and the stored receipt is never rewritten. The
-- read-time exclusion (id_conflict) belongs to 7.3C (7.3B record §4).
select is(pg_temp.recv('msg-s57-tag','email.delivered','em-late','valid','owner_email',pg_temp.oe(1),1),'recorded','S-57 a valid tag, no ID anywhere yet');
select is(pg_temp.class('msg-s57-tag'),'tag_only','S-57 linked tag_only at receipt');
update private.owner_email_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-late' where id=pg_temp.oe(7);
select is(pg_temp.recv('msg-s57-tag','email.delivered','em-late','valid','owner_email',pg_temp.oe(1),1),'duplicate',
 'S-57 a retry after another row records the ID is a duplicate');
select is(pg_temp.class('msg-s57-tag'),'tag_only','S-57 the stored receipt is not rewritten (no hidden mutation)');
select is(private.email_provider_id_candidate('em-late')->>'ref',pg_temp.oe(7)::text,
 'S-57 the candidate a 7.3C read-time recheck would use now names the other row');
select is(pg_temp.recv('msg-s57-new','email.delivered','em-late','valid','owner_email',pg_temp.oe(1),1),'recorded','S-57 a new receipt with the same content');
select is(pg_temp.class('msg-s57-new'),'conflict_disagree','S-57 a new receipt is classed against the current ledgers: conflict_disagree');
select is(pg_temp.recv('msg-s57-id','email.delivered','em-oe-3'),'recorded','S-57 an id_only receipt');
update private.r0_application_notifications set state='sent', attempts=1, sent_at=now(), provider_message_id='em-oe-3'
 where application_id='e1211000-0000-4000-8000-0000000000a2';
select is(private.email_provider_id_candidate('em-oe-3')->>'kind','ambiguous','S-57 the ID later recorded in another ledger is now ambiguous to a reader');
select is(pg_temp.class('msg-s57-id'),'id_only','S-57 and the stored receipt is unchanged');
update private.r0_application_notifications set state='pending', attempts=0, sent_at=null, provider_message_id=null
 where application_id='e1211000-0000-4000-8000-0000000000a2';

-- 6. Immutable expiry and permanent conflicts (S-59) --------------------------------------
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,provider_email_id,identity_class)
 values ('msg-s59-old',now()-interval '10 days',now()+interval '20 days','current','recorded','email.delivered','email.delivered','em-none','unmatched');
select is(pg_temp.recv('msg-s59-old','email.delivered','em-none',p_created=>null),'duplicate','S-59 a duplicate 10 days after the first');
select is((pg_temp.ev('msg-s59-old')).expires_at,now()+interval '20 days','S-59 the duplicate did not move expiry');
select is(pg_temp.recv('msg-s59-old','email.bounced','em-none',p_created=>null),'conflict','S-59 a content conflict');
select is((pg_temp.ev('msg-s59-old')).expires_at,now()+interval '20 days','S-59 the conflict flag did not move expiry');
select throws_ok($$update private.email_provider_events set expires_at=expires_at+interval '1 day' where svix_id='msg-s59-old'$$,'55000',
 'A provider receipt''s expiry is fixed when it is received','S-59 a direct expiry update by the table owner is rejected');
select throws_ok($$update private.email_provider_events set content_conflict=false, conflict_seen_at=null where svix_id='msg-s59-old'$$,'55000',
 'A provider receipt''s content conflict is permanent','a content conflict cannot be cleared');
select throws_ok($$update private.email_provider_events set identity_class='unmatched' where svix_id='msg-s52'$$,'55000',
 'A provider receipt is immutable except for its content-conflict flag','a stored identity conflict cannot be cleared');
select throws_ok($$update private.email_provider_events set event_type='email.delivered' where svix_id='msg-s52'$$,'55000',null,
 'stored content cannot be rewritten');

-- 7. Coherence checks (S-62) --------------------------------------------------------------
select throws_ok(format($$insert into private.email_provider_events(svix_id,expires_at,secret_slot,processing,event_type,provider_type,provider_email_id,identity_class,%s)
  values ('msg-s62-%s',now()+interval '1 day','current','recorded','email.delivered','email.delivered',%L,%L,%s)$$, cols, n, email, class, vals),
 '23514', null, 'S-62 rejected: '||label)
  from (values
   (1,'linked_attempt','em-none','unmatched','1','an attempt without a link'),
   (2,'owner_email_notification, linked_attempt','em-none','unmatched',quote_literal(pg_temp.oe(3))||',1','an FK without a matching class'),
   (3,'tag_ledger, tag_ref, tag_attempt','em-none','id_only','''owner_email'','||quote_literal(pg_temp.oe(3))||',1','id_only with tags (and no link)'),
   (4,'owner_email_notification, linked_attempt, tag_ledger, tag_ref, tag_attempt','em-oe-3','tag_only',
      quote_literal(pg_temp.oe(3))||',1,''owner_email'','||quote_literal(pg_temp.oe(2))||',1','a tag link pointing at another row'),
   (5,'owner_email_notification, linked_attempt, tag_ledger, tag_ref','em-none','tag_only',
      quote_literal(pg_temp.oe(3))||',1,''owner_email'','||quote_literal(pg_temp.oe(3)),'a partial tag set'),
   (6,'owner_email_notification, application_notification, linked_attempt','em-none','id_only',
      quote_literal(pg_temp.oe(3))||',''e1211000-0000-4000-8000-0000000000a1'',1','two links'),
   (7,'content_conflict','em-none','unmatched','true','a conflict flag without its time'),
   (8,'bounce_type','em-none','unmatched','''permanent''','bounce fields on a non-bounce'),
   (9,'tag_ledger, tag_ref, tag_attempt','em-none','unmatched','''owner_email'','||quote_literal(pg_temp.oe(3))||',1','unmatched with tags')
  ) v(n, cols, email, class, vals, label);
select throws_ok($$insert into private.email_provider_events(svix_id,expires_at,secret_slot,processing,event_type,provider_email_id,identity_class)
  values ('msg-s62-10',now()+interval '1 day','current','recorded','email.delivered','em-none','id_missing')$$,'23514',null,
 'S-62 rejected: id_missing with an ID');
select throws_ok($$insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,identity_class)
  values ('msg-s62-11',now(),now(),'current','invalid_payload','other','unmatched')$$,'23514',null,
 'S-62 rejected: an expiry that is not after receipt');
select throws_ok($$insert into private.email_provider_events(svix_id,expires_at,secret_slot,processing,event_type,provider_type,provider_email_id,identity_class)
  values ('msg-s62-12',now()+interval '1 day','current','recorded','email.delivered','email.delivered','someone@example.test','unmatched')$$,'23514',null,
 'S-62 rejected: an address-shaped provider ID');

-- 8. Cascade with the source (S-33) --------------------------------------------------------
select is((select count(*)::int from private.email_provider_events where svix_id in ('msg-s31-tag','msg-s57-tag')),2,'S-33 setup: two receipts linked to oe1');
create temp table deleted_oe1 as select pg_temp.oe(1) as id;
delete from public.contact_submissions where id='e1212000-0000-4000-8000-000000000001';
select is((select count(*)::int from private.email_provider_events where svix_id in ('msg-s31-tag','msg-s57-tag')),0,
 'S-33 deleting a contact submission deletes its linked receipts');
select is((select count(*)::int from private.email_provider_events where svix_id in ('msg-s52','msg-s53','msg-s31-future','msg-noid-tag','msg-s57-new')),5,
 'S-33 conflicted and unlinked receipts naming that row remain until their own expiry');
select is((pg_temp.ev('msg-s52')).tag_ref,(select tag_ref from private.email_provider_events where svix_id='msg-s53'),'S-33 and keep only their opaque tag');
-- No SQL path deletes applications (plan §3.1); the test deletes one directly.
delete from public.vendor_applications where id='e1211000-0000-4000-8000-0000000000a1';
select is((pg_temp.ev('msg-s32-id')).svix_id is null, true, 'S-33 deleting a vendor application deletes its linked receipt');
delete from private.operator_package_drafts where id='e1213000-0000-4000-8000-0000000000d1';
select is((pg_temp.ev('msg-draft-id')).svix_id is null, true, 'S-33 deleting a price draft deletes its linked receipt');
select is((pg_temp.ev('msg-s56-bad')).svix_id is not null and (pg_temp.ev('msg-s53')).svix_id is not null, true,
 'S-33 unlinked receipts naming the deleted application''s ID remain');
select is(pg_temp.recv('msg-s58-retry','email.delivered','em-new-5','valid','owner_email',(select id from deleted_oe1),1),
 'recorded','a receipt tagged for a deleted ledger row records');
select is(pg_temp.class('msg-s58-retry')||'|'||pg_temp.linked('msg-s58-retry'),'conflict_tag_invalid|none:-',
 'S-58 (serial half) a tag naming a deleted row is conflict_tag_invalid and unlinked');

-- 9. Expiry boundary, purge on receipt and the operator purge (S-34 to S-36, S-60) ---------
delete from private.email_provider_events;
create function pg_temp.expired(p_prefix text, p_count int, p_base timestamptz default '2026-01-01T00:00:00Z') returns void language sql as $$
 insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,identity_class)
 select p_prefix||lpad(i::text,6,'0'), p_base + i*interval '1 second' - interval '1 day', p_base + i*interval '1 second',
        'current','invalid_payload','other','unmatched'
   from generate_series(1,p_count) i
  order by md5(p_prefix||i)  -- heap order differs from expiry order, so oldest-first must come from the query
$$;
-- S-34
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,identity_class) values
 ('msg-s34-live',now()-interval '1 day',now()+interval '1 second','current','invalid_payload','other','unmatched'),
 ('msg-s34-due',now()-interval '1 day',now(),'current','invalid_payload','other','unmatched');
select is(pg_temp.op('select public.email_provider_events_purge(10)')->>'deleted','1','S-34 one row is due');
select is((select array_agg(svix_id) from private.email_provider_events),array['msg-s34-live'],
 'S-34 a row at expires_at is expired; one second before it is not');
-- A replay of an expired receipt that the receipt-time purge reaches is recorded as new.
-- Corrected 2026-11-19 (Codex review 5926513941): this is not "never a duplicate". The purge
-- deletes only the 100 oldest unlocked expired rows, so an expired receipt outside that batch
-- (a larger backlog, or a row another transaction holds) is still stored and the replay answers
-- duplicate, or conflict for a changed payload. The regression below records that behavior; the
-- 7.3C readback excludes expired receipts whatever the answer (SQL 122).
select pg_temp.expired('msg-replay-',1);
select is(pg_temp.recv('msg-replay-000001','email.delivered','em-none'),'recorded','a replay of an expired receipt the purge reaches is recorded as new');
select ok((pg_temp.ev('msg-replay-000001')).expires_at > now(),'with its own new expiry');
delete from private.email_provider_events;
-- More than 100 older expired rows: 250 expire before the target, so neither of the two
-- replays below purges it.
select pg_temp.expired('msg-backlog-',250);
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,provider_email_id,identity_class)
 values ('msg-backlog-target','2026-01-01T00:00:00Z'::timestamptz + interval '1 hour' - interval '1 day','2026-01-01T00:00:00Z'::timestamptz + interval '1 hour',
  'current','recorded','email.delivered','email.delivered','em-none','unmatched');
create temp table backlog_target as select expires_at from private.email_provider_events where svix_id='msg-backlog-target';
select is(pg_temp.recv('msg-backlog-target','email.delivered','em-none',p_created=>null),'duplicate',
 'an expired receipt behind a backlog of more than 100 answers duplicate to an identical replay (it is still stored)');
select is((select count(*)::int from private.email_provider_events where svix_id like 'msg-backlog-0%'),150,'that receive purged the 100 oldest only');
select is(pg_temp.recv('msg-backlog-target','email.bounced','em-none',p_bounce=>'permanent',p_created=>null),'conflict',
 'a changed replay of the same still-stored expired receipt answers conflict');
select is(row((pg_temp.ev('msg-backlog-target')).content_conflict,(pg_temp.ev('msg-backlog-target')).event_type,
  (pg_temp.ev('msg-backlog-target')).expires_at = (select expires_at from backlog_target),(pg_temp.ev('msg-backlog-target')).expires_at <= now())::text,
 '(t,email.delivered,t,t)','the existing receipt and its expiry are preserved (flag set, still expired); no new receipt or clock');
delete from private.email_provider_events;
-- S-35
select pg_temp.expired('msg-s35-',150);
select is(pg_temp.recv('msg-s35-new','email.delivered','em-none'),'recorded','S-35 one receive');
select is((select count(*)::int from private.email_provider_events where svix_id like 'msg-s35-0%'),50,'S-35 exactly 100 of 150 expired rows deleted');
select is((select min(svix_id) from private.email_provider_events where svix_id like 'msg-s35-0%'),'msg-s35-000101','S-35 the oldest first');
select ok(exists(select 1 from private.email_provider_events where svix_id='msg-s35-new'),'S-35 in the same transaction as the receipt');
-- S-36
select is(pg_temp.op('select public.email_provider_events_purge(0)') - 'checked_at' - 'oldest_remaining_expires_at',
 '{"limit":1,"deleted":1,"remaining_expired":49,"remaining_over_cap":false}'::jsonb,'S-36 a zero limit is clamped to 1');
select is(pg_temp.op('select public.email_provider_events_purge(-5)')->>'limit','1','S-36 a negative limit is clamped to 1');
select is(pg_temp.op('select public.email_provider_events_purge(null)')->>'limit','100','S-36 no limit means 100');
select is((select count(*)::int from private.email_provider_events where svix_id like 'msg-s35-0%'),0,'S-36 the remaining 48 are gone');
select pg_temp.expired('msg-s36-',11100);
select is(pg_temp.op('select public.email_provider_events_purge(1001)') - 'checked_at',
 jsonb_build_object('limit',1000,'deleted',1000,'remaining_expired',10000,'remaining_over_cap',true,
  'oldest_remaining_expires_at','2026-01-01T00:00:00Z'::timestamptz + 1001*interval '1 second'),
 'S-36 over 1,000 is clamped to 1,000; the remainder is capped at 10,000 and flagged; oldest remaining expiry returned');
select is((select min(svix_id) from private.email_provider_events where svix_id like 'msg-s36-%'),'msg-s36-001001','S-36 deterministic oldest-first order');
select is(pg_temp.op('select public.email_provider_events_purge(1000)')->>'remaining_expired','9100','S-36 the remaining count is exact below the cap');
select is((select array_agg(row(applied_limit,deleted,remaining_expired,remaining_over_cap)::text order by id) from private.email_provider_event_purges
  where actor='e1210000-0000-4000-8000-000000000001' and ran_at = now()),
 array['(10,1,0,f)','(1,1,49,f)','(1,1,48,f)','(100,48,0,f)','(1000,1000,10000,t)','(1000,1000,9100,f)'],
 'each operator purge is audited by counts only');
select is((select count(*)::int from information_schema.columns where table_schema='private' and table_name='email_provider_event_purges'),7,
 'the purge audit holds the actor, limit, counts and time only');
delete from private.email_provider_events;
-- S-60
select pg_temp.expired('msg-s60-',1000);
select is(pg_temp.recv('msg-s60-'||x,'email.delivered','em-none'),'recorded','S-60 receive '||x) from unnest(array['a','b','c']) x;
select is((select count(*)::int from private.email_provider_events where svix_id like 'msg-s60-0%'),700,
 'S-60 three receives delete 300 of 1,000 expired rows; 700 stay stored (no per-row deadline from receipts alone)');
select is((select min(svix_id) from private.email_provider_events where svix_id like 'msg-s60-0%'),'msg-s60-000301','S-60 oldest first');

-- 10. Unchanged surfaces --------------------------------------------------------------------
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'r0\_%notification%'),
 '10|5f14532aa26ed5400e73e210379aa4f8','the vendor-application ledger functions are byte-identical');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.oid = any(pg_temp.legacy_owner_email_functions()) and p.proname <> 'owner_email_renewal_create'),
 '12|016c0e683cb19c4c68769d87f5215ff1','the 7.2C-1 owner-email ledger functions are byte-identical');
select is(md5(pg_get_functiondef('public.vendor_submit_renewal_document(text,uuid)'::regprocedure)),'8c8942365d8f9d34bdcd1d839f86c472',
 'vendor_submit_renewal_document is unchanged');
select is(md5(pg_get_functiondef('private.owner_email_renewal_create()'::regprocedure)),'b1607618f1af59ca19d9c6e5d0d410f5',
 'the 7.2C-2 renewal trigger function is unchanged');
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where (n.nspname,p.proname) in (('private','package_draft_email_view'),('public','pricing_claim_draft_email'),
   ('public','pricing_record_draft_email'),('public','admin_request_draft_email'))),
 '4|fddc8bb9fc830932a830db9d6db9c811','the price-draft email functions are unchanged');
select is((select md5(string_agg(format('%s %s %s %s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull), ',' order by c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','owner_email_notifications','package_draft_email_notices')
    and a.attnum>0 and not a.attisdropped),
 '0e06a9c789f1968178c5fadc97793c33','the three ledger tables'' columns are unchanged');
select is((select md5(string_agg(conrelid::regclass||':'||conname||':'||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where conrelid in ('private.r0_application_notifications'::regclass,'private.owner_email_notifications'::regclass,
   'private.package_draft_email_notices'::regclass)),
 'a0a3cc8602481416c18a202455efc751','the three ledger tables'' own constraints are unchanged');
select is((select count(*)::int from pg_trigger where not tgisinternal and tgrelid in ('private.r0_application_notifications'::regclass,
  'private.owner_email_notifications'::regclass,'private.package_draft_email_notices'::regclass)),0,'no trigger is added to a ledger');
select is((select string_agg(c.relname||'='||coalesce(c.relacl::text,'null'), ';' order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','owner_email_notifications','package_draft_email_notices')),
 'owner_email_notifications={postgres=arwdDxtm/postgres};package_draft_email_notices={postgres=arwdDxtm/postgres};r0_application_notifications={postgres=arwdDxtm/postgres}',
 'the three ledger tables'' grants are unchanged');

select * from finish();
rollback;
