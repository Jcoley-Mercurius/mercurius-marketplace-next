-- TRACE-122 review corrections (20261025001000). Synthetic fixtures only; amounts are test
-- examples. Legacy internal notes are unreadable by anonymous users, homeowners and vendors on
-- every path while revision hashes and priced requests keep working; archived packages are
-- read-only history; checklist exceptions are bounded to 14 Eastern calendar days.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1; 3 homeowner; 4 vendor bound to provider 2.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('b9410000-0000-4000-8000-000000000001','corr-operator@example.invalid',now(),'{}'),
 ('b9410000-0000-4000-8000-000000000002','corr-vendor@example.invalid',now(),'{}'),
 ('b9410000-0000-4000-8000-000000000003','corr-homeowner@example.invalid',now(),'{"full_name":"Synthetic homeowner"}'),
 ('b9410000-0000-4000-8000-000000000004','corr-other-vendor@example.invalid',now(),'{}');
delete from public.user_roles where user_id in ('b9410000-0000-4000-8000-000000000002','b9410000-0000-4000-8000-000000000004');
insert into public.user_roles(user_id,role) values
 ('b9410000-0000-4000-8000-000000000001','admin'),
 ('b9410000-0000-4000-8000-000000000002','vendor'),
 ('b9410000-0000-4000-8000-000000000004','vendor');
insert into public.service_categories(id,name) values ('synthetic-corr-cat','Synthetic corrections category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-corr-svc','Synthetic corrections service','synthetic-corr-cat',100,60,'one-time','{one-time,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00094','Synthetic covered',true,false);
insert into private.r0_lee_zips values ('00094');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b9420000-0000-4000-8000-000000000001','Synthetic corrections vendor',true,true,'b9410000-0000-4000-8000-000000000002'),
 ('b9420000-0000-4000-8000-000000000002','Synthetic other vendor',true,true,'b9410000-0000-4000-8000-000000000004'),
 ('b9420000-0000-4000-8000-000000000003','Synthetic corrections applicant',false,false,null);
insert into public.contractor_service_zips(contractor_id,zip_code) values ('b9420000-0000-4000-8000-000000000001','00094');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
 values ('b9410000-0000-4000-8000-000000000003','00094','synthetic-corr-svc','b9410000-0000-4000-8000-000000000003');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('b9430000-0000-4000-8000-000000000003','Synthetic corrections applicant','Test','Applicant','corr-applicant@example.invalid','synthetic',
  'b9420000-0000-4000-8000-000000000003',array['synthetic/b94/license.pdf']);

-- Legacy revisions written before 20261024003000: an active one and an inactive one, both
-- carrying provider notes in the column their revision hash covers.
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review,included_scope,policy_notes) values
 ('b9440000-0000-4000-8000-000000000001','b9420000-0000-4000-8000-000000000001','synthetic-corr-svc','Synthetic legacy live','fixed','one-time',true,false,'{"Two rooms"}','SYNTHETIC-INTERNAL-NOTE-LIVE'),
 ('b9440000-0000-4000-8000-000000000002','b9420000-0000-4000-8000-000000000001','synthetic-corr-svc','Synthetic legacy paused','fixed','one-time',false,false,'{}','SYNTHETIC-INTERNAL-NOTE-PAUSED'),
 ('b9440000-0000-4000-8000-000000000003','b9420000-0000-4000-8000-000000000001','synthetic-corr-svc','Synthetic editable','fixed','one-time',false,false,'{}',null);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order) values
 ('b9450000-0000-4000-8000-000000000001','b9440000-0000-4000-8000-000000000001','One-time',80,'one-time',0),
 ('b9450000-0000-4000-8000-000000000002','b9440000-0000-4000-8000-000000000002','One-time',70,'one-time',0),
 ('b9450000-0000-4000-8000-000000000003','b9440000-0000-4000-8000-000000000003','One-time',60,'one-time',0);
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required,sort_order) values
 ('b9440000-0000-4000-8000-000000000002','rooms','Synthetic rooms','number',false,0);
insert into public.package_addons(id,package_id,name,price) values
 ('b9460000-0000-4000-8000-000000000002','b9440000-0000-4000-8000-000000000002','Synthetic extra',10);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b9410000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor() returns uuid language sql as $$ select 'b9420000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.applicant() returns uuid language sql as $$ select 'b9420000-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.live() returns uuid language sql as $$ select 'b9440000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.paused() returns uuid language sql as $$ select 'b9440000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.editable() returns uuid language sql as $$ select 'b9440000-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.hash(p_package uuid) returns text language sql security definer as $$
 select private.package_revision_hash(p_package) $$;
create function pg_temp.pkg_stamp(p_package uuid) returns timestamptz language sql security definer as $$
 select updated_at from public.vendor_packages where id = p_package $$;
create function pg_temp.rev(p_draft uuid) returns text language sql security definer as $$
 select content_hash from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.plan(p_selections jsonb) returns jsonb language sql as $$
  select jsonb_build_object('stage','final','location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00094'),
    'preferred_time','Synthetic window','selections',p_selections) $$;
create function pg_temp.selection() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('service_id','synthetic-corr-svc','frequency','one-time','package_id',pg_temp.live(),
    'expected',jsonb_build_object('pricing_mode','fixed','total',80))) $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/New_York')::date $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated, anon;
create temp table vals(name text primary key, v text);
grant all on vals to authenticated, anon;

-- The hash still covers the legacy notes: the same content without them hashes differently.
insert into vals values ('live_hash', pg_temp.hash(pg_temp.live()));
select is(pg_temp.hash(pg_temp.live()), private.pricing_content_hash(private.package_content(pg_temp.live())),
 'the revision hash is still the hash of the full package content');
select isnt(pg_temp.hash(pg_temp.live()), private.pricing_content_hash(private.package_content(pg_temp.live()) - 'policy_notes'),
 'and that content still includes the legacy notes (revision semantics unchanged)');
select is((select policy_notes from public.vendor_packages where id = pg_temp.paused()), 'SYNTHETIC-INTERNAL-NOTE-PAUSED',
 'historical notes are preserved in place');

-- 1. Direct table reads ---------------------------------------------------------------------
select ok(not has_column_privilege('anon', 'public.vendor_packages', 'policy_notes', 'select'), 'anon holds no select on policy_notes');
select ok(not has_column_privilege('authenticated', 'public.vendor_packages', 'policy_notes', 'select'), 'authenticated holds no select on policy_notes');
select ok(not has_column_privilege('authenticated', 'public.vendor_packages', 'policy_notes', 'insert'), 'authenticated cannot insert policy_notes');
select ok(not has_column_privilege('authenticated', 'public.vendor_packages', 'policy_notes', 'update'), 'authenticated cannot update policy_notes');
select is((select array_agg(column_name::text order by column_name::text) from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'vendor_packages'
     and not has_column_privilege('anon', 'public.vendor_packages', c.column_name, 'select')),
 array['policy_notes'], 'every other column stays readable (a new column must be granted explicitly)');
select ok(has_column_privilege('service_role', 'public.vendor_packages', 'policy_notes', 'select'), 'the service role is unchanged');

set local role anon;
select throws_ok($$select policy_notes from public.vendor_packages where id = pg_temp.live()$$, '42501',
 'permission denied for table vendor_packages', 'anonymous users cannot read notes of a live package');
select throws_ok($$select * from public.vendor_packages limit 1$$, '42501',
 'permission denied for table vendor_packages', 'nor through select *');
select throws_ok($$select id from public.vendor_packages where policy_notes like 'SYNTHETIC%'$$, '42501',
 'permission denied for table vendor_packages', 'nor by filtering on them');
select is((select name from public.vendor_packages where id = pg_temp.live()), 'Synthetic legacy live',
 'public package information stays readable');
select is((select count(*) from public.vendor_packages where id = pg_temp.paused()), 0::bigint, 'a paused package stays hidden from the public');
reset role;

select pg_temp.as_user('3');
set local role authenticated;
select throws_ok($$select policy_notes from public.vendor_packages where id = pg_temp.live()$$, '42501',
 'permission denied for table vendor_packages', 'a homeowner cannot read notes');
select is((select included_scope from public.vendor_packages where id = pg_temp.live()), '{"Two rooms"}'::text[],
 'a homeowner reads the package scope');
reset role;

select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select policy_notes from public.vendor_packages where id = pg_temp.paused()$$, '42501',
 'permission denied for table vendor_packages', 'the owning vendor cannot read notes of its own revision');
select throws_ok($$update public.vendor_packages set policy_notes = 'x' where id = pg_temp.editable()$$, '42501',
 'permission denied for table vendor_packages', 'nor write them');
select throws_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active,policy_notes)
   values (pg_temp.vendor(),'synthetic-corr-svc','Synthetic injected','fixed','one-time',false,'x')$$, '42501',
 'permission denied for table vendor_packages', 'nor insert a revision with notes');
select is((select count(*) from public.vendor_packages where contractor_id = pg_temp.vendor()), 3::bigint,
 'the vendor still reads all its own revisions');
select lives_ok($$update public.vendor_packages set description = 'Synthetic edited' where id = pg_temp.editable()$$,
 'the vendor still edits an ordinary package');
select lives_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
   values (pg_temp.vendor(),'synthetic-corr-svc','Synthetic new draft','fixed','one-time',false) returning id$$,
 'and adds a package without notes');
-- TRACE-134 (6.11A, F611-2): vendors no longer write legacy package promotions.
select throws_ok($$insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
   values (pg_temp.live(),'percent_off',10,'Synthetic offer',now() + interval '30 days',now() + interval '37 days',true)$$,
 '42501', null, 'the vendor can no longer enable a legacy promotion on its live package');
reset role;
-- validate_package_promotion now reads only the columns it checks (operator write).
select lives_ok($$insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
   values (pg_temp.live(),'percent_off',10,'Synthetic offer',now() + interval '30 days',now() + interval '37 days',true)$$,
 'the promotion validation still accepts a valid owner-side write');

-- 2. RPC responses --------------------------------------------------------------------------
-- Preview and submission price from the full content and bind to the unchanged hash.
set local role anon;
insert into vals select 'preview', public.preview_service_request_selections(pg_temp.plan(pg_temp.selection()))::text;
reset role;
select is(((select v from vals where name='preview')::jsonb #>> '{outcomes,0,total}'), '80', 'the public preview still prices the legacy package');
select ok((select v from vals where name='preview') not like '%SYNTHETIC-INTERNAL-NOTE%', 'and carries no notes');
select pg_temp.as_user('3');
set local role authenticated;
insert into vals select 'submit', public.submit_service_requests('synthetic-corr-0000000001', pg_temp.plan(pg_temp.selection()) - 'stage')::text;
reset role;
select is(((select v from vals where name='submit')::jsonb ->> 'status'), 'submitted', 'a homeowner still submits a priced request');
select ok((select v from vals where name='submit') not like '%SYNTHETIC-INTERNAL-NOTE%', 'the submission response carries no notes');
insert into ids select 'req', ((select v from vals where name='submit')::jsonb #>> '{requests,0,request_id}')::uuid;
select is((select pricing_inputs->>'package_revision' from public.service_requests where id = (select id from ids where name='req')),
 (select v from vals where name='live_hash'), 'the request binds to the unchanged revision hash');
select ok((select pricing_inputs::text from public.service_requests where id = (select id from ids where name='req')) not like '%SYNTHETIC-INTERNAL-NOTE%',
 'the stored priced selection holds no notes');
select pg_temp.as_user('3');
set local role authenticated;
select is((select total_amount from public.service_requests where id = (select id from ids where name='req')), 80::numeric,
 'the homeowner still reads the historical request');
reset role;
update public.service_requests set status = 'scheduled', contractor_id = pg_temp.vendor() where id = (select id from ids where name='req');
select is((private.money_source((select id from ids where name='req'))->>'service'), '8000',
 'checkout''s commercial source still verifies the bound revision');

-- The vendor's draft and approval responses drop legacy notes; approval still binds to the hash.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids values ('draft', (public.admin_save_package_draft(null, null, pg_temp.vendor(), 'synthetic-corr-svc', 'Synthetic legacy draft',
  'Synthetic scope', jsonb_build_array(jsonb_build_object('frequency','monthly','price',55)))->>'id')::uuid);
reset role;
update private.operator_package_drafts set content = content || '{"policy_notes":"SYNTHETIC-INTERNAL-NOTE-DRAFT"}'
 where id = (select id from ids where name='draft');
update private.operator_package_drafts d set content_hash = private.draft_revision_hash(d) where d.id = (select id from ids where name='draft');
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.admin_send_package_draft((select id from ids where name='draft'), pg_temp.rev((select id from ids where name='draft')))$$,
 'an operator sends the legacy draft for approval');
select is((select d->>'internal_notes' from jsonb_array_elements(public.admin_package_drafts()) d where d->>'id' = (select id from ids where name='draft')::text),
 'SYNTHETIC-INTERNAL-NOTE-DRAFT', 'the operator still sees the legacy notes');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select ok(public.vendor_package_approvals()::text not like '%SYNTHETIC-INTERNAL-NOTE%', 'the vendor''s approval list carries no notes');
select is((select d->>'revision' from jsonb_array_elements(public.vendor_package_approvals()) d where d->>'id' = (select id from ids where name='draft')::text),
 pg_temp.rev((select id from ids where name='draft')), 'and still reports the stored revision');
select ok((public.vendor_approve_package_draft((select id from ids where name='draft'), pg_temp.rev((select id from ids where name='draft'))))::text
   not like '%SYNTHETIC-INTERNAL-NOTE%', 'the vendor approves the exact revision and the response carries no notes');
reset role;
select is((select approval_state from private.operator_package_drafts where id = (select id from ids where name='draft')), 'approved',
 'the approval is recorded against the unchanged hash');
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok($$select public.vendor_package_approvals()$$, '42501', 'Vendor account required', 'a homeowner reads no drafts');
select throws_ok($$select public.admin_package_contents(null)$$, '42501', 'Onboarding operator required', 'nor the operator package readback');
reset role;
set local role anon;
select throws_ok($$select public.admin_package_contents(null)$$, '42501', 'permission denied for function admin_package_contents',
 'anonymous users cannot call the operator readback');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select is((select e->'content'->>'policy_notes' from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor())) e
   where e->>'package_id' = pg_temp.paused()::text), 'SYNTHETIC-INTERNAL-NOTE-PAUSED', 'operators keep the historical notes readback');
reset role;

-- 3. Archived packages are read-only history ------------------------------------------------
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select public.admin_archive_package(pg_temp.paused(), pg_temp.pkg_stamp(pg_temp.paused()), 'Synthetic superseded')$$,
 'an operator archives the paused legacy package');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$update public.vendor_packages set is_active = true where id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; start a new price instead of turning it back on', 'the reactivation guard still answers first');
select throws_ok($$update public.vendor_packages set name = 'Synthetic renamed' where id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'the vendor cannot edit an archived package');
select throws_ok($$delete from public.vendor_packages where id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor delete it');
select throws_ok($$update public.package_tiers set price = 1 where package_id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor change its prices');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency) values (pg_temp.paused(),'Synthetic',5,'monthly')$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor add a price level');
select throws_ok($$update public.package_tiers set package_id = pg_temp.paused() where package_id = pg_temp.editable()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor move a level into it');
select throws_ok($$delete from public.package_addons where package_id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor remove its add-ons');
select throws_ok($$update public.package_qualifying_questions set question_label = 'x' where package_id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'nor change its questions');
select is((select name from public.vendor_packages where id = pg_temp.paused()), 'Synthetic legacy paused', 'the vendor still reads the archived package');
select is((select count(*) from public.package_tiers where package_id = pg_temp.paused()), 1::bigint, 'and its prices');
select is(public.vendor_package_archives(pg_temp.vendor()) -> 0 ->> 'package_id', pg_temp.paused()::text,
 'the vendor reads which of its packages are archived');
select ok(public.vendor_package_archives(pg_temp.vendor()) -> 0 ->> 'reason' is null, 'without the operator''s reason');
select lives_ok($$update public.package_tiers set price = 65 where package_id = pg_temp.editable()$$, 'an ordinary package stays editable');
select lives_ok($$delete from public.vendor_packages where id = pg_temp.editable()$$, 'and deletable, with its levels');
reset role;
select throws_ok($$update public.vendor_packages set sort_order = 9 where id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'no write path bypasses the guard');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$update public.package_tiers set price = 75 where package_id = pg_temp.paused()$$, '55000',
 'Mercurius archived this price; it is kept as read-only history', 'an operator''s direct write cannot change it either');
select is((select e->'archive'->>'reason' from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor())) e
   where e->>'package_id' = pg_temp.paused()::text), 'Synthetic superseded', 'the archive record stays readable to operators');
select is(jsonb_array_length(public.vendor_package_archives(pg_temp.vendor())), 1, 'operators read any provider''s archive list');
reset role;
select pg_temp.as_user('4');
set local role authenticated;
select throws_ok($$select public.vendor_package_archives(pg_temp.vendor())$$, '42501', 'Provider not found', 'another vendor cannot read it');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok($$select public.vendor_package_archives(pg_temp.vendor())$$, '42501', 'Provider not found', 'nor a homeowner');
reset role;
set local role anon;
select throws_ok($$select public.vendor_package_archives(pg_temp.vendor())$$, '42501',
 'permission denied for function vendor_package_archives', 'nor an anonymous user');
reset role;

-- 4. Checklist exception window -------------------------------------------------------------
select is(private.checklist_exception_expires_at('2026-10-31'), '2026-11-01 04:00:00+00'::timestamptz,
 'expiry is the end of the Eastern date (EDT)');
select is(private.checklist_exception_expires_at('2026-11-01'), '2026-11-02 05:00:00+00'::timestamptz,
 'on the day daylight time ends, expiry is the end of that Eastern day (EST)');
select is(private.checklist_exception_expires_at('2027-03-13'), '2027-03-14 05:00:00+00'::timestamptz,
 'the day before daylight time starts ends at midnight EST');
select is(private.checklist_exception_expires_at('2027-03-14'), '2027-03-15 04:00:00+00'::timestamptz,
 'the day daylight time starts ends at midnight EDT');

select pg_temp.as_user('1');
select public.vendor_begin_review(pg_temp.applicant(),
  (select id from public.vendor_application_versions where application_id = 'b9430000-0000-4000-8000-000000000003' order by revision desc limit 1));
create function pg_temp.item(p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist(pg_temp.applicant())->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.exception(p_key text, p_due date, p_supersedes uuid default null, p_reason text default 'Synthetic: portal down',
  p_kind text default 'license') returns jsonb language sql as $$
 select public.vendor_record_checklist_exception(pg_temp.applicant(), p_kind, p_reason, 'Synthetic Approver', p_due, p_supersedes, p_key) $$;
reset role;

select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select pg_temp.exception('w-vendor', pg_temp.today() + 7)$$, '42501', 'Onboarding operator required',
 'a vendor cannot record an exception');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok($$select pg_temp.exception('w-homeowner', pg_temp.today() + 7)$$, '42501', 'Onboarding operator required',
 'nor a homeowner');
reset role;

select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select pg_temp.exception('w-today', pg_temp.today())$$, '22023', 'Enter a follow-up due date after today', 'today is refused');
select throws_ok($$select pg_temp.exception('w-past', pg_temp.today() - 1)$$, '22023', 'Enter a follow-up due date after today', 'a past date is refused');
select throws_ok($$select pg_temp.exception('w-null', null)$$, '22023', 'Enter a follow-up due date after today', 'a missing date is refused');
select throws_ok($$select pg_temp.exception('w-15', pg_temp.today() + 15)$$, '22023',
 'The follow-up due date can be at most 14 days after today (Eastern)', 'today + 15 days is refused');
select throws_ok($$select pg_temp.exception('w-inf', 'infinity'::date)$$, '22023',
 'The follow-up due date can be at most 14 days after today (Eastern)', 'an infinite date is refused');
select throws_ok($$select pg_temp.exception('w-neg-inf', '-infinity'::date)$$, '22023',
 'Enter a follow-up due date after today', 'a negative infinite date is refused');
select throws_ok($$select pg_temp.exception('w-far', '9999-12-31'::date)$$, '22023',
 'The follow-up due date can be at most 14 days after today (Eastern)', 'a far-future date is refused');

insert into vals select 'first', pg_temp.exception('w-first', pg_temp.today() + 14)::text;
select is((select v from vals where name='first')::jsonb ->> 'follow_up_due', (pg_temp.today() + 14)::text, 'today + 14 days is accepted');
select is(((select v from vals where name='first')::jsonb ->> 'expires_at')::timestamptz, ((pg_temp.today() + 15)::timestamp at time zone 'America/New_York'),
 'it expires at the end of that Eastern date');
select is((select v from vals where name='first')::jsonb ->> 'sequence', '1', 'the first exception for the item is number 1');
select is(pg_temp.item('license')->>'state', 'current', 'the item counts as current (approved temporary effect)');
select is(pg_temp.item('license')->>'requirement_version', 'exception', 'recorded as an exception');
select is(pg_temp.item('license')->>'evidence_ref', 'Exception: document pending', 'with documentation pending, no document claimed');
select is(pg_temp.exception('w-first', pg_temp.today() + 14)->>'replayed', 'true', 'a retry with the same key replays');
select is(pg_temp.exception('w-first', pg_temp.today() + 14)->>'evidence_id', (select v from vals where name='first')::jsonb ->> 'evidence_id',
 'the retry records nothing new');
select throws_ok($$select pg_temp.exception('w-first', pg_temp.today() + 13)$$, 'P0001', 'Checklist exception idempotency conflict',
 'the same key with another date is refused');

-- No automatic renewal: a further exception names the one it replaces and is recorded anew.
select throws_ok($$select pg_temp.exception('w-second-stale', pg_temp.today() + 10, null, 'Synthetic: still pending')$$, 'P0001',
 'Stale evidence version', 'a further exception must name the exception it replaces');
insert into vals select 'second', pg_temp.exception('w-second', pg_temp.today() + 10,
  ((select v from vals where name='first')::jsonb ->> 'evidence_id')::uuid, 'Synthetic: still pending')::text;
select is((select v from vals where name='second')::jsonb ->> 'sequence', '2', 'the further exception is reported as number 2');
select is(jsonb_array_length(public.vendor_checklist_exceptions(pg_temp.applicant())), 2, 'both exceptions stay in the history');
select is((select e->>'open' from jsonb_array_elements(public.vendor_checklist_exceptions(pg_temp.applicant())) e
   where e->>'evidence_id' = (select v from vals where name='first')::jsonb ->> 'evidence_id'), 'false', 'the first is closed by the second');
select is((select count(*) from jsonb_array_elements(public.vendor_checklist_exceptions(pg_temp.applicant())) e where e->>'reason' = 'Synthetic: still pending'), 1::bigint,
 'the further exception carries its own reason');
reset role;

-- Expiry: once the follow-up date has passed the item lapses on its own.
alter table public.vendor_compliance_evidence disable trigger immutable_evidence;
update public.vendor_compliance_evidence set accepted_at = now() - interval '2 days', expires_at = now() - interval '1 second'
 where id = ((select v from vals where name='second')::jsonb ->> 'evidence_id')::uuid;
alter table public.vendor_compliance_evidence enable trigger immutable_evidence;
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.item('license')->>'state', 'expired', 'a lapsed exception no longer counts as current');
reset role;

-- The window holds for new rows on every path; existing rows are not revalidated.
select throws_ok($$insert into private.vendor_checklist_exceptions(evidence_id,contractor_id,kind,reason,approver,follow_up_due,business_key,actor)
   values (((select v from vals where name='first')::jsonb ->> 'evidence_id')::uuid, pg_temp.applicant(), 'license', 'x', 'x', pg_temp.today() + 30, 'w-direct', gen_random_uuid())$$,
 '23514', null, 'a direct insert outside the window is refused');
select is((select convalidated from pg_constraint where conname = 'vendor_checklist_exceptions_follow_up_window'), false,
 'the constraint was added without rewriting or revalidating existing rows');

select * from finish();
rollback;
