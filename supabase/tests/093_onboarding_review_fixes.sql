-- TRACE-122 (DEC-2026-047, 20261024003000). Synthetic fixtures only: internal package notes
-- change no revision and notify no one; paused or replaced packages can be archived and never
-- turned back on; licensing or insurance can be marked current by an exception that lapses at
-- its follow-up date and closes when a document is recorded.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1.
insert into auth.users(id,email,email_confirmed_at) values
 ('b9210000-0000-4000-8000-000000000001','review-operator@example.invalid',now()),
 ('b9210000-0000-4000-8000-000000000002','review-vendor@example.invalid',now());
delete from public.user_roles where user_id = 'b9210000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values
 ('b9210000-0000-4000-8000-000000000001','admin'),
 ('b9210000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b9220000-0000-4000-8000-000000000001','Synthetic review vendor',true,true,'b9210000-0000-4000-8000-000000000002'),
 ('b9220000-0000-4000-8000-000000000002','Synthetic review applicant',false,false,null);
insert into public.service_categories(id,name) values ('synthetic-review-cat','Synthetic review category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-review-svc','Synthetic review service','synthetic-review-cat',100,60,'monthly','{one-time,monthly}',true);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('b9230000-0000-4000-8000-000000000002','Synthetic review applicant','Test','Applicant','review-applicant@example.invalid','synthetic',
  'b9220000-0000-4000-8000-000000000002',array['synthetic/b92/license.pdf','synthetic/b92/insurance.pdf']);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9210000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor() returns uuid language sql as $$ select 'b9220000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.applicant() returns uuid language sql as $$ select 'b9220000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.rev(p_draft uuid) returns text language sql security definer as $$
 select content_hash from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.pkg_stamp(p_package uuid) returns timestamptz language sql security definer as $$
 select updated_at from public.vendor_packages where id = p_package $$;
create function pg_temp.save(p_name text) returns uuid language sql as $$
 select (public.admin_save_package_draft(null, null, pg_temp.vendor(), 'synthetic-review-svc', p_name, 'Synthetic scope',
   jsonb_build_array(jsonb_build_object('frequency','monthly','price',60)))->>'id')::uuid $$;
create function pg_temp.publish(p_draft uuid) returns uuid language sql as $$
 select (public.admin_publish_package_draft(p_draft, pg_temp.stamp(p_draft), 'Synthetic agreed rate')->>'package_id')::uuid $$;
create function pg_temp.note(p_subject uuid) returns text language sql security definer as $$
 select notes from private.package_internal_notes where subject_id = p_subject $$;
-- The stored legacy column; not readable by authenticated since 20261025001000.
create function pg_temp.stored_notes(p_package uuid) returns text language sql security definer as $$
 select policy_notes from public.vendor_packages where id = p_package $$;
create function pg_temp.hash(p_package uuid) returns text language sql security definer as $$
 select private.package_revision_hash(p_package) $$;
create function pg_temp.note_events(p_subject uuid) returns bigint language sql security definer as $$
 select count(*) from private.package_internal_note_events where subject_id = p_subject $$;
create function pg_temp.notices() returns bigint language sql security definer as $$
 select count(*) from public.notifications where user_id = 'b9210000-0000-4000-8000-000000000002' $$;
create function pg_temp.contents(p_package uuid) returns jsonb language sql as $$
 select e from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor())) e where e->>'package_id' = p_package::text $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;
create temp table vals(name text primary key, v text);
grant all on vals to authenticated;

-- Access ------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.admin_set_package_internal_notes(null, null, 'x')$$, '42501',
 'permission denied for function admin_set_package_internal_notes', 'anonymous callers cannot set notes');
select throws_ok($$select public.admin_archive_package(null, null, 'x')$$, '42501',
 'permission denied for function admin_archive_package', 'anonymous callers cannot archive');
select throws_ok($$select public.vendor_record_checklist_exception(null, 'license', 'r', 'a', current_date + 7, null, 'k')$$, '42501',
 'permission denied for function vendor_record_checklist_exception', 'anonymous callers cannot record an exception');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.admin_set_package_internal_notes(null, gen_random_uuid(), 'x')$$, '42501',
 'Onboarding operator required', 'a vendor cannot set internal notes');
select throws_ok($$select public.admin_archive_package(gen_random_uuid(), now(), 'x')$$, '42501',
 'Onboarding operator required', 'a vendor cannot archive');
select throws_ok($$select public.vendor_checklist_exceptions(pg_temp.vendor())$$, '42501',
 'Onboarding operator required', 'a vendor cannot read exceptions');
reset role;

-- 1. Internal notes -------------------------------------------------------------------------
select pg_temp.as_user('1');
set local role authenticated;
insert into ids values ('draft', pg_temp.save('Synthetic noted plan'));
insert into vals values ('draft_rev', pg_temp.rev((select id from ids where name='draft')));
insert into vals values ('notices', pg_temp.notices()::text);
select throws_ok($$select public.admin_set_package_internal_notes(null, null, 'x')$$, '22023', 'Choose a package or a draft',
 'notes need a package or a draft');
select throws_ok($$select public.admin_set_package_internal_notes(null, (select id from ids where name='draft'), repeat('x', 2001))$$,
 '22023', 'Internal notes too long', 'notes are at most 2000 characters');
select lives_ok($$select public.admin_set_package_internal_notes(null, (select id from ids where name='draft'), '  Synthetic gate code at office  ')$$,
 'an operator sets a new draft''s internal notes');
select is(pg_temp.note((select id from ids where name='draft')), 'Synthetic gate code at office', 'the notes are kept, trimmed, with the draft');
select is(pg_temp.rev((select id from ids where name='draft')), (select v from vals where name='draft_rev'),
 'setting notes does not change the draft revision');
select is((select d->>'internal_notes' from jsonb_array_elements(public.admin_package_drafts()) d where d->>'id' = (select id from ids where name='draft')::text),
 'Synthetic gate code at office', 'the draft readback carries its internal notes');
select ok((select (d->'content'->>'policy_notes') is null from jsonb_array_elements(public.admin_package_drafts()) d
  where d->>'id' = (select id from ids where name='draft')::text), 'the notes are not in the draft content');

insert into ids values ('pkg', pg_temp.publish((select id from ids where name='draft')));
select is(pg_temp.note((select id from ids where name='pkg')), 'Synthetic gate code at office', 'publishing moves the notes to the package');
select is(pg_temp.note((select id from ids where name='draft')), null, 'and removes them from the draft');
select is(pg_temp.contents((select id from ids where name='pkg'))->'internal_notes'->>'notes', 'Synthetic gate code at office',
 'admin_package_contents reports the internal notes');
select is(pg_temp.stored_notes((select id from ids where name='pkg')), null,
 'the published revision stores no notes');

insert into vals values ('pkg_hash', pg_temp.hash((select id from ids where name='pkg')));
insert into vals values ('pkg_count', (select count(*) from public.vendor_packages where contractor_id = pg_temp.vendor())::text);
insert into vals values ('after_publish', pg_temp.notices()::text);
select lives_ok($$select public.admin_set_package_internal_notes((select id from ids where name='pkg'), null, 'Synthetic: prefers mornings')$$,
 'an operator edits a live package''s notes');
select is(pg_temp.note((select id from ids where name='pkg')), 'Synthetic: prefers mornings', 'the edit is kept');
select is(pg_temp.hash((select id from ids where name='pkg')), (select v from vals where name='pkg_hash'),
 'editing notes leaves the revision hash unchanged');
select is((select count(*) from public.vendor_packages where contractor_id = pg_temp.vendor())::text, (select v from vals where name='pkg_count'),
 'editing notes creates no new revision');
select is(pg_temp.notices()::text, (select v from vals where name='after_publish'), 'editing notes notifies no one');
select is(pg_temp.note_events((select id from ids where name='pkg')), 1::bigint,
 'the edit is recorded in the notes history');
select lives_ok($$select public.admin_set_package_internal_notes((select id from ids where name='pkg'), null, '   ')$$, 'blank notes clear them');
select is(pg_temp.note((select id from ids where name='pkg')), null, 'cleared notes are removed');
select lives_ok($$select public.admin_set_package_internal_notes((select id from ids where name='pkg'), null, 'Synthetic: side gate')$$, 'notes set again');

-- A replacement draft shares its package's notes and copies none into its content.
insert into ids values ('replacement', (public.admin_draft_from_package((select id from ids where name='pkg'),
  pg_temp.pkg_stamp((select id from ids where name='pkg')), null, 'Synthetic replacement')->'draft'->>'id')::uuid);
select is((select d->>'internal_notes' from jsonb_array_elements(public.admin_package_drafts()) d where d->>'id' = (select id from ids where name='replacement')::text),
 'Synthetic: side gate', 'a replacement draft shows its package''s notes');
reset role;
select is((select content->>'policy_notes' from private.operator_package_drafts where id = (select id from ids where name='replacement')), null,
 'a replacement draft copies no notes into its content');

-- A legacy draft whose content still holds notes: they move to the package on publication.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids values ('legacy', pg_temp.save('Synthetic legacy plan'));
reset role;
update private.operator_package_drafts set content = content || '{"policy_notes":"Synthetic legacy note"}'
 where id = (select id from ids where name='legacy');
update private.operator_package_drafts d set content_hash = private.draft_revision_hash(d) where d.id = (select id from ids where name='legacy');
select pg_temp.as_user('1');
set local role authenticated;
insert into ids values ('legacy_pkg', pg_temp.publish((select id from ids where name='legacy')));
select is(pg_temp.note((select id from ids where name='legacy_pkg')), 'Synthetic legacy note', 'legacy draft notes move to the package');
select is(pg_temp.stored_notes((select id from ids where name='legacy_pkg')), null,
 'and the new revision stores none');

-- 2. Archive --------------------------------------------------------------------------------
select throws_ok($$select public.admin_archive_package((select id from ids where name='legacy_pkg'), pg_temp.pkg_stamp((select id from ids where name='legacy_pkg')), 'Synthetic old')$$,
 '55000', 'Suspend this listing before archiving it', 'a live package cannot be archived');
select lives_ok($$select public.admin_suspend_package((select id from ids where name='legacy_pkg'), pg_temp.pkg_stamp((select id from ids where name='legacy_pkg')), 'Synthetic pause')$$,
 'the operator suspends it');
insert into vals values ('before_archive', pg_temp.notices()::text);
select throws_ok($$select public.admin_archive_package((select id from ids where name='legacy_pkg'), pg_temp.pkg_stamp((select id from ids where name='legacy_pkg')), '  ')$$,
 '22023', 'Enter the reason for archiving', 'archiving needs a reason');
select throws_ok($$select public.admin_archive_package((select id from ids where name='legacy_pkg'), now() - interval '1 day', 'Synthetic old')$$,
 '40001', 'Package changed since it was read; reload before archiving', 'a stale read is refused');
select lives_ok($$select public.admin_archive_package((select id from ids where name='legacy_pkg'), pg_temp.pkg_stamp((select id from ids where name='legacy_pkg')), 'Synthetic old price')$$,
 'a paused package is archived');
select is(pg_temp.contents((select id from ids where name='legacy_pkg'))->'archive'->>'reason', 'Synthetic old price',
 'admin_package_contents reports the archive record');
select is(pg_temp.contents((select id from ids where name='legacy_pkg'))->'archive'->>'actor_email', 'review-operator@example.invalid',
 'with the operator who archived it');
select is(pg_temp.notices()::text, (select v from vals where name='before_archive'), 'archiving notifies no one');
select throws_ok($$select public.admin_archive_package((select id from ids where name='legacy_pkg'), pg_temp.pkg_stamp((select id from ids where name='legacy_pkg')), 'Again')$$,
 '55000', 'This package is already archived', 'a package is archived once');
reset role;
select throws_ok($$update public.vendor_packages set is_active = true where id = (select id from ids where name='legacy_pkg')$$,
 '55000', 'Mercurius archived this price; start a new price instead of turning it back on', 'an archived package is never turned back on');
select pg_temp.as_user('1');
set local role authenticated;

-- A replaced revision can be archived once its replacement is published; an open replacement blocks it.
select lives_ok($$select public.admin_suspend_package((select id from ids where name='pkg'), pg_temp.pkg_stamp((select id from ids where name='pkg')), 'Synthetic pause')$$,
 'the original package is paused');
select throws_ok($$select public.admin_archive_package((select id from ids where name='pkg'), pg_temp.pkg_stamp((select id from ids where name='pkg')), 'Synthetic old')$$,
 '55000', 'Publish or discard the replacement draft of this package first', 'an open replacement draft blocks archiving');
insert into ids values ('replacement_pkg', pg_temp.publish((select id from ids where name='replacement')));
select lives_ok($$select public.admin_archive_package((select id from ids where name='pkg'), pg_temp.pkg_stamp((select id from ids where name='pkg')), 'Synthetic superseded')$$,
 'the superseded revision is archived');
select is(pg_temp.contents((select id from ids where name='replacement_pkg'))->'internal_notes'->>'notes', 'Synthetic: side gate',
 'the notes stay with the package''s new revision');
select is(pg_temp.contents((select id from ids where name='replacement_pkg'))->'archive', 'null'::jsonb, 'the live revision is not archived');
reset role;

-- 3. Checklist exception --------------------------------------------------------------------
select pg_temp.as_user('1');
select public.vendor_begin_review(pg_temp.applicant(),
  (select id from public.vendor_application_versions where application_id = 'b9230000-0000-4000-8000-000000000002' order by revision desc limit 1));
create function pg_temp.item(p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist(pg_temp.applicant())->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.exception(p_key text, p_due date default (now() at time zone 'America/New_York')::date + 14,
  p_kind text default 'license', p_reason text default 'Synthetic: state portal down', p_supersedes uuid default null) returns jsonb language sql as $$
 select public.vendor_record_checklist_exception(pg_temp.applicant(), p_kind, p_reason, 'Synthetic Approver', p_due, p_supersedes, p_key) $$;
set local role authenticated;
select throws_ok($$select pg_temp.exception('x-identity', p_kind => 'identity')$$, '22023', 'An exception is only for licensing or insurance',
 'only licensing or insurance take an exception');
select throws_ok($$select pg_temp.exception('x-reason', p_reason => ' ')$$, '22023', 'Enter the reason for the exception', 'a reason is required');
select throws_ok($$select public.vendor_record_checklist_exception(pg_temp.applicant(), 'license', 'r', ' ', current_date + 14, null, 'x-approver')$$,
 '22023', 'Enter who approved the exception', 'an approver is required');
select throws_ok($$select pg_temp.exception('x-due', p_due => (now() at time zone 'America/New_York')::date)$$, '22023',
 'Enter a follow-up due date after today', 'the follow-up date must be after today');
select throws_ok($$select pg_temp.exception('')$$, 'P0001', 'Idempotency key required', 'a key is required');

select is(pg_temp.exception('x-license')->>'open', 'true', 'an exception is recorded for licensing');
select is(pg_temp.item('license')->>'state', 'current', 'the item is current while the document is pending');
select is(pg_temp.item('license')->>'evidence_ref', 'Exception: document pending', 'as an exception');
select is((pg_temp.item('license')->>'expires_at')::timestamptz,
 (((now() at time zone 'America/New_York')::date + 15)::timestamp at time zone 'America/New_York'),
 'it lapses at the end of the follow-up date, Eastern time');
select is(pg_temp.exception('x-license')->>'replayed', 'true', 'the same key replays the exception');
select throws_ok($$select pg_temp.exception('x-license', p_reason => 'Different')$$, 'P0001', 'Checklist exception idempotency conflict',
 'the same key with other details is refused');
select is((public.vendor_checklist_exceptions(pg_temp.applicant())->0->>'approver'), 'Synthetic Approver', 'the readback names the approver');
select is((public.vendor_checklist_exceptions(pg_temp.applicant())->0->>'actor_email'), 'review-operator@example.invalid', 'and the operator');

-- A real document already current: no exception over it.
select lives_ok($$select public.vendor_record_checklist_evidence(pg_temp.applicant(), 'insurance', 'v1', 'synthetic/b92/insurance.pdf',
  now() - interval '1 hour', now() + interval '1 year', null, 'x-insurance-doc')$$, 'insurance is recorded with its document');
select throws_ok($$select pg_temp.exception('x-insurance', p_kind => 'insurance', p_supersedes => (pg_temp.item('insurance')->>'evidence_id')::uuid)$$,
 '55000', 'This item already has current evidence', 'an exception does not replace a current document');

-- The document arrives: recorded over the exception, which closes and stays in history.
select lives_ok($$select public.vendor_record_checklist_evidence(pg_temp.applicant(), 'license', 'v1', 'synthetic/b92/license.pdf',
  now() - interval '1 minute', now() + interval '1 year', (pg_temp.item('license')->>'evidence_id')::uuid, 'x-license-doc')$$,
 'the licensing document supersedes the exception');
select is((public.vendor_checklist_exceptions(pg_temp.applicant())->0->>'open'), 'false', 'the exception is closed');
select ok((public.vendor_checklist_exceptions(pg_temp.applicant())->0->>'resolved_at') is not null, 'with the time it was resolved');
select is(pg_temp.item('license')->>'evidence_ref', 'synthetic/b92/license.pdf', 'the item now shows the document');
reset role;

select * from finish();
rollback;
