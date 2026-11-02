-- TRACE-135 (Phase 6.12A, 20261106001000). Synthetic fixtures only. A provider reads its own
-- compliance status: item states, temporary exceptions worded as documentation pending, renewal
-- documents awaiting review, decline notes, and the compliance part of matching and payout
-- eligibility. No provider parameter, no evidence references, exception reasons or other
-- providers' data; the readback writes nothing.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor A; 3 vendor B; 4 homeowner; 5 legacy vendor C (no onboarding record).
insert into auth.users(id,email,email_confirmed_at) values
 ('b1060000-0000-4000-8000-000000000001','status-operator@example.invalid',now()),
 ('b1060000-0000-4000-8000-000000000002','status-vendor-a@example.invalid',now()),
 ('b1060000-0000-4000-8000-000000000003','status-vendor-b@example.invalid',now()),
 ('b1060000-0000-4000-8000-000000000004','status-homeowner@example.invalid',now()),
 ('b1060000-0000-4000-8000-000000000005','status-vendor-c@example.invalid',now());
delete from public.user_roles where user_id in ('b1060000-0000-4000-8000-000000000002','b1060000-0000-4000-8000-000000000003',
 'b1060000-0000-4000-8000-000000000004','b1060000-0000-4000-8000-000000000005');
insert into public.user_roles(user_id,role) values
 ('b1060000-0000-4000-8000-000000000001','admin'),
 ('b1060000-0000-4000-8000-000000000002','vendor'),
 ('b1060000-0000-4000-8000-000000000003','vendor'),
 ('b1060000-0000-4000-8000-000000000005','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b1061000-0000-4000-8000-00000000000a','Synthetic status vendor A',true,false,'b1060000-0000-4000-8000-000000000002'),
 ('b1061000-0000-4000-8000-00000000000b','Synthetic status vendor B',true,false,'b1060000-0000-4000-8000-000000000003'),
 ('b1061000-0000-4000-8000-00000000000c','Synthetic status vendor C',true,false,'b1060000-0000-4000-8000-000000000005');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('b1062000-0000-4000-8000-00000000000a','Synthetic status vendor A','Test','A','status-vendor-a@example.invalid','synthetic','b1061000-0000-4000-8000-00000000000a'),
 ('b1062000-0000-4000-8000-00000000000b','Synthetic status vendor B','Test','B','status-vendor-b@example.invalid','synthetic','b1061000-0000-4000-8000-00000000000b');

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1060000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.a() returns uuid language sql as $$ select 'b1061000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.b() returns uuid language sql as $$ select 'b1061000-0000-4000-8000-00000000000b'::uuid $$;
create function pg_temp.version(p_contractor uuid) returns uuid language sql security definer as $$
 select v.id from public.vendor_application_versions v join public.vendor_applications a on a.id=v.application_id
 where a.contractor_id=p_contractor order by v.revision desc limit 1 $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/New_York')::date $$;
-- Evidence written as the database owner so expired and backdated states can be arranged.
create function pg_temp.evidence(p_contractor uuid, p_kind text, p_ref text, p_accepted timestamptz, p_expires timestamptz,
  p_requirement text default 'synthetic-v1') returns uuid language sql security definer as $$
 insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 values (p_contractor,pg_temp.version(p_contractor),p_kind,p_requirement,p_ref,p_accepted,p_expires,'b1060000-0000-4000-8000-000000000001')
 returning id $$;
create function pg_temp.status() returns jsonb language sql as $$ select public.vendor_own_compliance_status() $$;
create function pg_temp.item(p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(pg_temp.status()->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.notice(p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_own_evidence_renewal()->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.written() returns text language sql security definer as $$
 select concat_ws('|',(select count(*) from public.vendor_compliance_evidence),(select count(*) from private.vendor_checklist_exceptions),
   (select count(*) from public.vendor_renewal_documents),(select count(*) from public.vendor_renewal_document_decisions),
   (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
   (select count(*) from public.user_roles),(select count(*) from public.notifications)) $$;
create temp table vals(name text primary key, v text);
grant all on vals to authenticated;

-- Onboarding for A and B through the operator command; C stays a legacy provider.
select pg_temp.as_user('1');
select public.vendor_begin_review(pg_temp.a(), pg_temp.version(pg_temp.a()));
select public.vendor_begin_review(pg_temp.b(), pg_temp.version(pg_temp.b()));
reset role;

-- A: identity, agreement, coverage, profile/pricing and test notification current; license on a
-- current exception; insurance on an exception that lapsed exactly now; payout onboarding expired;
-- availability missing; one insurance document awaiting review.
select pg_temp.evidence(pg_temp.a(), k, 'SECRET-REF-A-'||k, now() - interval '30 days', null)
 from unnest(array['identity','agreement','coverage','profile_pricing','test_notification']) k;
select pg_temp.evidence(pg_temp.a(), 'bank_authorization', 'SECRET-BANK-A', now() - interval '400 days', now() - interval '1 day');
select pg_temp.as_user('1');
select public.vendor_record_checklist_exception(pg_temp.a(), 'license', 'SECRET-REASON-A', 'SECRET-APPROVER-A',
 pg_temp.today() + 10, null, 'status-a-license');
reset role;
insert into vals select 'a_insurance', pg_temp.evidence(pg_temp.a(), 'insurance', 'Exception: document pending',
 now() - interval '3 days', now(), 'exception')::text;
insert into private.vendor_checklist_exceptions(evidence_id,contractor_id,kind,reason,approver,follow_up_due,business_key,actor,created_at)
 values ((select v from vals where name='a_insurance')::uuid, pg_temp.a(), 'insurance', 'SECRET-REASON-A2', 'SECRET-APPROVER-A2',
   pg_temp.today() - 1, 'status-a-insurance', 'b1060000-0000-4000-8000-000000000001', now() - interval '3 days');
insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
 values (pg_temp.a(), 'insurance', 'renewals/'||pg_temp.a()||'/insurance/b1063000-0000-4000-8000-000000000001-certificate.pdf',
   'certificate.pdf', 'application/pdf', 1000, 'b1060000-0000-4000-8000-000000000002', 'provider');

-- B: every item current (insurance inside the notice window); one later license document declined.
select pg_temp.evidence(pg_temp.b(), k, 'SECRET-REF-B-'||k, now() - interval '30 days',
  case when k='license' then now() + interval '200 days' when k='insurance' then now() + interval '10 days' end)
 from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k;
with d as (insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
 values (pg_temp.b(), 'license', 'renewals/'||pg_temp.b()||'/license/b1063000-0000-4000-8000-000000000002-license.pdf',
   'license.pdf', 'application/pdf', 1000, 'b1060000-0000-4000-8000-000000000003', 'provider') returning id)
insert into vals select 'b_doc', id::text from d;
insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor)
 values ((select v from vals where name='b_doc')::uuid, 'declined', 'Synthetic: the expiry date is not readable', 'status-b-decline',
   'b1060000-0000-4000-8000-000000000001');

update public.vendor_onboarding set status='active' where contractor_id in (pg_temp.a(), pg_temp.b());
insert into vals select 'written', pg_temp.written();

-- 1. Access ------------------------------------------------------------------------------------
select is((select pronargs::int from pg_proc where oid='public.vendor_own_compliance_status()'::regprocedure), 0,
 'the readback takes no provider parameter');
select is((select provolatile::text from pg_proc where oid='public.vendor_own_compliance_status()'::regprocedure), 's',
 'the readback is stable (read-only)');
select ok(not has_function_privilege('anon','public.vendor_own_compliance_status()','execute'), 'anon cannot execute it');
select ok(not has_function_privilege('service_role','public.vendor_own_compliance_status()','execute'), 'nor service_role');
select ok(has_function_privilege('authenticated','public.vendor_own_compliance_status()','execute'), 'authenticated can call it');
set local role anon;
select throws_ok($$select public.vendor_own_compliance_status()$$, '42501',
 'permission denied for function vendor_own_compliance_status', 'an anonymous caller is refused');
reset role;
select pg_temp.as_user('4');
set local role authenticated;
select throws_ok($$select public.vendor_own_compliance_status()$$, '42501', 'Vendor account required', 'a homeowner is refused');
reset role;

-- 2. Vendor A: every state, worded from recorded evidence ---------------------------------------
select pg_temp.as_user('2');
set local role authenticated;
select is(jsonb_array_length(pg_temp.status()->'items'), 9, 'A sees all nine checklist items');
select is(pg_temp.status()->>'onboarding_status', 'active', 'A reads its own onboarding status');
select is(pg_temp.item('identity')->>'state', 'current', 'a recorded item without expiry is current');
select ok(pg_temp.item('identity')->>'recorded_at' is not null, 'a recorded item says when Mercurius recorded it');
select is(pg_temp.item('license')->>'state', 'exception', 'a current exception is reported as an exception, not current');
select is(pg_temp.item('license')->>'exception', 'true', 'and flagged as an exception');
select is(pg_temp.item('license')->>'follow_up_due', (pg_temp.today() + 10)::text, 'with its Eastern follow-up date');
select is(pg_temp.item('license')->'recorded_at', 'null'::jsonb, 'an exception claims no recorded review of a document');
select is(pg_temp.item('insurance')->>'state', 'expired', 'an exception lapses at its expiry instant (boundary: expires_at = now)');
select is(pg_temp.item('insurance')->>'exception', 'true', 'and stays identified as an exception, not a document');
select is((pg_temp.item('insurance')->>'awaiting_review')::int, 1, 'the uploaded insurance document is awaiting review');
select ok(pg_temp.item('insurance')->>'last_submitted_at' is not null, 'with its submission time');
select is(pg_temp.item('bank_authorization')->>'state', 'expired', 'expired payout onboarding is expired');
select is(pg_temp.item('availability')->>'state', 'missing', 'an unrecorded item is missing');
select is(pg_temp.status()->>'checklist_current', 'false', 'the checklist is not current');
select is(pg_temp.status()->>'matching_allowed', 'false', 'so compliance blocks new requests');
select is(pg_temp.status()->>'payout_onboarding_current', 'false', 'and payouts are held for payout onboarding');
select is(pg_temp.status()->>'accepting_uploads', 'true', 'an active provider may upload renewals');
select is(pg_temp.status()->>'today', pg_temp.today()::text, 'today is the Eastern calendar date');

-- Nothing operator-only or belonging to B is disclosed.
insert into vals select 'a_text', pg_temp.status()::text;
select ok((select v from vals where name='a_text') not like '%SECRET%', 'no evidence reference, bank reference, reason or approver');
select ok((select v from vals where name='a_text') not like '%evidence_ref%' and (select v from vals where name='a_text') not like '%storage_path%'
 and (select v from vals where name='a_text') not like '%requirement_version%', 'no reference, path or requirement-version keys');
select ok((select v from vals where name='a_text') not like '%'||pg_temp.b()||'%' and (select v from vals where name='a_text') not like '%readable%',
 'nothing of vendor B');

-- 3. Renewal notice keys -------------------------------------------------------------------------
select is(pg_temp.notice('license')->>'exception', 'true', 'the notice marks an expiring exception');
select is(pg_temp.notice('license')->>'follow_up_due', (pg_temp.today() + 10)::text, 'with its follow-up date');
select is(pg_temp.notice('license')->>'state', 'expiring', 'its notice state is unchanged');
select is(pg_temp.notice('insurance')->>'state', 'lapsed', 'a lapsed exception stays lapsed in the notice');
select is(pg_temp.notice('bank_authorization')->>'exception', 'false', 'a document is not an exception');
select ok(public.vendor_own_evidence_renewal()::text not like '%SECRET%', 'the notice discloses no reference or reason');
reset role;

-- 4. Vendor B: isolated, everything current -----------------------------------------------------
select pg_temp.as_user('3');
set local role authenticated;
select is((select count(*)::int from jsonb_array_elements(pg_temp.status()->'items') i where i->>'state' in ('current','expiring')), 9,
 'B sees its own nine items as current or expiring');
select is(pg_temp.item('insurance')->>'state', 'expiring', 'current evidence inside the notice window is expiring');
select is(pg_temp.status()->>'matching_allowed', 'true', 'expiring evidence still allows new requests');
select is(pg_temp.status()->>'payout_onboarding_current', 'true', 'and payouts');
select is(pg_temp.item('license')->>'state', 'current', 'a declined later document leaves the current license current');
select is(pg_temp.item('license')#>>'{declined,note}', 'Synthetic: the expiry date is not readable', 'and shows the decline note');
select ok(pg_temp.status()::text not like '%'||pg_temp.a()||'%' and pg_temp.status()::text not like '%certificate%',
 'nothing of vendor A');
reset role;

-- 5. Legacy provider without an onboarding record -----------------------------------------------
select pg_temp.as_user('5');
set local role authenticated;
select is(pg_temp.status()->>'provider_found', 'true', 'a legacy provider is found');
select is(pg_temp.status()->'onboarding_status', 'null'::jsonb, 'with no onboarding record');
select is(pg_temp.status()->'items', '[]'::jsonb, 'no checklist items are invented');
select is(pg_temp.status()->>'matching_allowed', 'false', 'and no eligibility is claimed');
reset role;

-- 6. Read-only ------------------------------------------------------------------------------------
select is(pg_temp.written(), (select v from vals where name='written'), 'reading changed no evidence, exception, document, onboarding, role or notice');

select * from finish();
rollback;
