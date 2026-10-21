-- TRACE-112/113 follow-up (20261018004000): source comparison fixes and DEC-2026-041 items 4-7.
-- Synthetic fixtures only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1; 3 vendor bound to provider 3; provider 2 has no account.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8510000-0000-4000-8000-000000000001','decisions-operator@example.invalid',now()),
 ('b8510000-0000-4000-8000-000000000002','decisions-vendor@example.invalid',now()),
 ('b8510000-0000-4000-8000-000000000003','decisions-other-vendor@example.invalid',now());
delete from public.user_roles where user_id in ('b8510000-0000-4000-8000-000000000002','b8510000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('b8510000-0000-4000-8000-000000000001','admin'),
 ('b8510000-0000-4000-8000-000000000002','vendor'),
 ('b8510000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8520000-0000-4000-8000-000000000001','Synthetic decisions vendor',true,true,'b8510000-0000-4000-8000-000000000002'),
 ('b8520000-0000-4000-8000-000000000002','Synthetic decisions unlinked vendor',true,true,null),
 ('b8520000-0000-4000-8000-000000000003','Synthetic decisions other vendor',true,true,'b8510000-0000-4000-8000-000000000003');
insert into public.service_categories(id,name) values ('synthetic-decisions-cat','Synthetic decisions category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-decisions-svc','Synthetic decisions service','synthetic-decisions-cat',100,60,'one-time','{one-time,monthly}',true),
 ('synthetic-decisions-svc2','Synthetic decisions second service','synthetic-decisions-cat',100,60,'one-time','{one-time,monthly}',true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8510000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor(p_n integer) returns uuid language sql as $$ select ('b8520000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated, service_role;

-- Source item 2: active package names are distinct on every write path ------------------------
select pg_temp.as_user('2');
set local role authenticated;
with x as (insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(1),'synthetic-decisions-svc','Dump & Clean','fixed','one-time',true) returning id)
  insert into ids select 'first', id from x;
select throws_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(1),'synthetic-decisions-svc','  dump & clean ','fixed','one-time',true)$$,
 '23505', 'This vendor already has an active package named "dump & clean" for this service; rename it or replace that package',
 'the vendor editor cannot create a second active package with the same name');
with x as (insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(1),'synthetic-decisions-svc','Dump & Clean','fixed','one-time',false) returning id)
  insert into ids select 'paused', id from x;
select ok((select id from ids where name='paused') is not null, 'a paused package may share the name while it is paused');
select throws_ok($$update public.vendor_packages set is_active=true where id=(select id from ids where name='paused')$$,
 '23505', null, 'it cannot go live while the other is live');
select lives_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(1),'synthetic-decisions-svc','One-time Cleaning','fixed','one-time',true)$$,
 'a differently named package for the same service and cadence goes live');
select lives_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(1),'synthetic-decisions-svc2','Dump & Clean','fixed','one-time',true)$$,
 'the same name is allowed for another service');
select throws_ok($$update public.vendor_packages set name='dump & clean' where contractor_id=pg_temp.vendor(1) and name='One-time Cleaning'$$,
 '23505', null, 'renaming onto a live name is refused');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select lives_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values (pg_temp.vendor(3),'synthetic-decisions-svc','Dump & Clean','fixed','one-time',true)$$,
 'another vendor may use the same name');
reset role;
select ok(exists(select 1 from pg_indexes where indexname='vendor_packages_one_active_name'), 'a unique index closes the race');

-- Source items 4, 8: operators read live package content ---------------------------------------
update public.vendor_packages set description='Synthetic dump and clean scope', included_scope='{Two cans}', policy_notes='Synthetic note'
 where id=(select id from ids where name='first');
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required)
 values ((select id from ids where name='first'),'cans','Cans','number',true);
insert into public.package_tiers(package_id,name,price,frequency,rule_question_key,rule_min,rule_max)
 values ((select id from ids where name='first'),'Up to 2 cans',90,'one-time','cans',1,2);
select ok(not has_function_privilege('anon','public.admin_package_contents(uuid)','execute'), 'anonymous callers cannot read package contents');
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.admin_package_contents(pg_temp.vendor(1))$$, '42501', null, 'a vendor cannot use the operator read');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select is((select c->'content'->>'description' from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor(1))) c
  where (c->>'package_id')::uuid=(select id from ids where name='first')), 'Synthetic dump and clean scope', 'the description is returned');
select is((select c->'content'->'included_scope' from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor(1))) c
  where (c->>'package_id')::uuid=(select id from ids where name='first')), '["Two cans"]'::jsonb, 'included scope is returned');
select is((select c->'content'->'tiers'->0->>'rule_question_key' from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor(1))) c
  where (c->>'package_id')::uuid=(select id from ids where name='first')), 'cans', 'a legacy rule is returned with its level');
select is((select count(*)::int from jsonb_array_elements(public.admin_package_contents(pg_temp.vendor(1)))), 4,
 'one vendor''s packages, paused ones included');
select ok((select count(*)::int from jsonb_array_elements(public.admin_package_contents(null))) >= 5, 'every package without a filter');
reset role;

-- DEC-2026-041 item 6: unlinked vendor notice by the contact email on file ----------------------
-- Provider 2 has no account. A draft for it, first without and then with a contact email.
create function pg_temp.content(p_name text) returns jsonb language sql as $$
 select jsonb_build_object('name',p_name,'pricing_mode','fixed',
  'tiers',jsonb_build_array(jsonb_build_object('id','one','name','One-time','frequency','one-time','price_kind','exact','price',95))) $$;
create function pg_temp.notice(p_draft uuid) returns private.package_draft_email_notices language sql security definer as $$
 select n.* from private.package_draft_email_notices n join private.operator_package_drafts d on d.id=n.draft_id
  where n.draft_id=p_draft and n.revision=d.sent_hash $$;
create function pg_temp.rev(p_draft uuid) returns text language sql security definer as $$
 select content_hash from private.operator_package_drafts where id = p_draft $$;
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'email', (public.admin_save_package_draft_content(null,null,pg_temp.vendor(2),'synthetic-decisions-svc',null,
  pg_temp.content('Synthetic emailed price'))->>'id')::uuid;
select is(public.admin_send_package_draft((select id from ids where name='email'), pg_temp.rev((select id from ids where name='email')))->>'reason',
 'No vendor account is bound to this provider and no contact email is on file',
 'with no account and no contact email the send is blocked, and says so');
reset role;
update public.contractors set email='synthetic-contact@example.invalid' where id=pg_temp.vendor(2);
select pg_temp.as_user('1');
set local role authenticated;
select is((select d->'vendor_link'->>'email_on_file' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(2))) d
  where (d->>'id')::uuid=(select id from ids where name='email')), 'true', 'the operator sees that the contact email on file will be used');
select is(public.admin_send_package_draft((select id from ids where name='email'), pg_temp.rev((select id from ids where name='email')))
  - 'draft', '{"status":"sent","channel":"email","email_queued":true}'::jsonb, 'without an account the notice is queued for the contact email');
select is((select (d->'delivery') - 'email_sent_at' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(2))) d
  where (d->>'id')::uuid=(select id from ids where name='email')),
 '{"channel":"email","status":"emailed","email":"pending","email_attempts":0,"email_error":null}'::jsonb,
 'delivery shows the email as waiting to send');
select is((public.admin_send_package_draft((select id from ids where name='email'), pg_temp.rev((select id from ids where name='email')))->>'email_queued'),
 'false', 'sending the same revision again queues no second email');
select throws_ok($$select public.pricing_claim_draft_email((select id from ids where name='email'),'initial')$$,
 '42501', null, 'an operator session cannot claim the email (service key only)');
select throws_ok($$select public.admin_request_draft_email((select id from ids where name='email'), true, false)$$,
 '55000', null, 'a pending email cannot be resent');
reset role;
select ok(not has_function_privilege('authenticated','public.pricing_record_draft_email(uuid,uuid,text,text,text)','execute'),
 'signed-in users cannot record an email outcome');
select ok(has_function_privilege('service_role','public.pricing_claim_draft_email(uuid,text)','execute'), 'the delivery route can claim');

set local role service_role;
create temp table claim1 as select public.pricing_claim_draft_email((select id from ids where name='email'),'initial') c;
reset role;
select is((select c->>'recipient' from claim1), 'synthetic-contact@example.invalid', 'the claim reads the contact email on file');
select is((select c ?| array['price','prices','content'] from claim1), false, 'the claim carries no price for the email');
set local role service_role;
select is(public.pricing_claim_draft_email((select id from ids where name='email'),'initial')->>'claimed', 'false',
 'a second sender cannot claim the same email');
select is(public.pricing_record_draft_email((select id from ids where name='email'), ((select c->>'claim_id' from claim1))::uuid,
  'failed', null, 'Resend returned 422: invalid to synthetic-contact@example.invalid')->>'state', 'failed', 'a refusal is recorded');
reset role;
select is((pg_temp.notice((select id from ids where name='email'))).last_error, 'Resend returned 422: invalid to [address]',
 'the recorded error names no address');
select pg_temp.as_user('1');
set local role authenticated;
select is((select d->'delivery'->>'email' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(2))) d
  where (d->>'id')::uuid=(select id from ids where name='email')), 'failed', 'the operator sees the failed email');
select is(public.admin_request_draft_email((select id from ids where name='email'), true, false)->>'state', 'resend_requested',
 'the operator can allow one more attempt after a failure');
reset role;
set local role service_role;
create temp table claim2 as select public.pricing_claim_draft_email((select id from ids where name='email'),'resend') c;
select is((select (c->>'attempt')::int from claim2), 2, 'the resend is the second attempt');
select is(public.pricing_record_draft_email((select id from ids where name='email'), ((select c->>'claim_id' from claim2))::uuid,
  'sent', 'msg-1', null)->>'state', 'sent', 'a sent email is recorded');
reset role;
select is((pg_temp.notice((select id from ids where name='email'))).state, 'sent', 'the notice is sent');
select is((select approval_state from private.operator_package_drafts where id=(select id from ids where name='email')), 'sent',
 'an emailed notice leaves the draft waiting for approval, never approved');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='email'),
  (select (d->>'updated_at')::timestamptz from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(2))) d
   where (d->>'id')::uuid=(select id from ids where name='email')), 'Synthetic reason')$$,
 null, null, 'an emailed draft cannot be published without the vendor''s approval');
reset role;
-- The vendor links an account: only then can the sent revision be approved, by that account.
update public.contractors set user_id='b8510000-0000-4000-8000-000000000003' where id=pg_temp.vendor(3);
insert into auth.users(id,email,email_confirmed_at) values ('b8510000-0000-4000-8000-000000000004','decisions-linked@example.invalid',now());
insert into public.user_roles(user_id,role) values ('b8510000-0000-4000-8000-000000000004','vendor');
update public.contractors set user_id='b8510000-0000-4000-8000-000000000004' where id=pg_temp.vendor(2);
select pg_temp.as_user('4');
set local role authenticated;
select is(public.vendor_approve_package_draft((select id from ids where name='email'), pg_temp.rev((select id from ids where name='email')))->>'approval_state',
 'approved', 'after linking, the vendor account approves the revision that was emailed');
reset role;

-- DEC-2026-041 items 4 and 5: corrections and legacy packages become replacement drafts ---------
create function pg_temp.stamp(p_package uuid) returns timestamptz language sql security definer as $$
 select updated_at from public.vendor_packages where id = p_package $$;
create function pg_temp.tier_of(p_package uuid) returns text language sql security definer as $$
 select id::text from public.package_tiers where package_id = p_package order by sort_order, id limit 1 $$;
create function pg_temp.fix(p_package uuid, p_prices jsonb, p_reason text default 'Synthetic correction') returns jsonb language sql as $$
 select public.admin_draft_from_package(p_package, pg_temp.stamp(p_package), p_prices, p_reason) $$;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select pg_temp.fix((select id from ids where name='first'), null)$$, '42501', null, 'a vendor cannot start an operator correction');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select pg_temp.fix((select id from ids where name='first'), null, ' ')$$, '22023', 'Enter the reason. The vendor will see it.', 'a reason is required');
select throws_ok($$select public.admin_draft_from_package((select id from ids where name='first'), '2000-01-01', null, 'Synthetic')$$,
 '40001', null, 'a stale package read is refused');
select throws_ok($$select pg_temp.fix((select id from ids where name='first'),
  jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', pg_temp.tier_of((select id from ids where name='first')), 'from', 95, 'price', 80))))$$,
 '40001', null, 'a stale price read is refused');
select throws_ok($$select pg_temp.fix((select id from ids where name='first'),
  jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', pg_temp.tier_of((select id from ids where name='first')), 'from', 90, 'price', 0))))$$,
 '22023', 'Each price must be a positive amount in whole cents', 'a zero price is refused');
select throws_ok($$select pg_temp.fix((select id from ids where name='first'),
  jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', 'not-a-level', 'from', 90, 'price', 80))))$$,
 'P0001', 'Tier does not belong to this package', 'another package''s level is refused');
select throws_ok($$select pg_temp.fix((select id from ids where name='first'),
  jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', pg_temp.tier_of((select id from ids where name='first')), 'from', 90, 'price', 90))))$$,
 '22023', 'No price changed', 'a correction that changes nothing is refused');
select throws_ok($$select pg_temp.fix((select id from ids where name='first'), jsonb_build_object('deposit', 40, 'deposit_from', null))$$,
 'P0001', 'Only a quote + deposit package has a deposit', 'a fixed package has no deposit');

insert into ids select 'fix', (r->'draft'->>'id')::uuid from (select pg_temp.fix((select id from ids where name='first'),
  jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object('id', pg_temp.tier_of((select id from ids where name='first')), 'from', 90, 'price', 80)))) r) x;
reset role;
select is((select approval_state from private.operator_package_drafts where id=(select id from ids where name='fix')), 'draft',
 'a correction starts as a draft, not approved');
select is((select target_package_id from private.operator_package_drafts where id=(select id from ids where name='fix')),
 (select id from ids where name='first'), 'it replaces the live package');
select is((select (content->'tiers'->0->>'price')::numeric from private.operator_package_drafts where id=(select id from ids where name='fix')), 80::numeric,
 'the draft carries the corrected price');
select is((select content->'tiers'->0->'conditions' from private.operator_package_drafts where id=(select id from ids where name='fix')),
 '[{"max": 2, "min": 1, "question_key": "cans"}]'::jsonb, 'the legacy rule is kept as a condition');
select is((select content->'included_scope' from private.operator_package_drafts where id=(select id from ids where name='fix')), '["Two cans"]'::jsonb,
 'scope is copied, not re-entered');
select is((select price from public.package_tiers where package_id=(select id from ids where name='first')), 90::numeric,
 'the live price is unchanged until the vendor approves and the operator publishes');
select is((select note from private.package_draft_events where draft_id=(select id from ids where name='fix') order by sequence limit 1),
 'Synthetic correction', 'the reason is kept with the draft history');
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select pg_temp.fix((select id from ids where name='first'), null)$$, '55000', null,
 'one open replacement draft per package');
select is(public.admin_send_package_draft((select id from ids where name='fix'), pg_temp.rev((select id from ids where name='fix')))->>'status', 'sent',
 'the correction is sent to the bound vendor');
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='fix'),
  (select updated_at from private.operator_package_drafts where id=(select id from ids where name='fix')), 'Synthetic')$$,
 null, null, 'it cannot be published before the vendor approves');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select is(public.vendor_approve_package_draft((select id from ids where name='fix'), pg_temp.rev((select id from ids where name='fix')))->>'approval_state',
 'approved', 'the vendor approves the corrected revision');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'fixed_pkg', (public.admin_publish_package_draft((select id from ids where name='fix'),
  (select (d->>'updated_at')::timestamptz from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(1))) d
   where (d->>'id')::uuid=(select id from ids where name='fix')), 'Synthetic correction approved')->>'package_id')::uuid;
reset role;
select is((select price from public.package_tiers where package_id=(select id from ids where name='fixed_pkg')), 80::numeric,
 'the approved correction goes live as the next revision');
select is((select is_active from public.vendor_packages where id=(select id from ids where name='first')), false,
 'the previous revision is paused in the same step');

-- A legacy quote level without a price meaning is copied as "starting at", and reported.
insert into ids select 'quote', id from (select gen_random_uuid() id) x;
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 values ((select id from ids where name='quote'), pg_temp.vendor(1),'synthetic-decisions-svc2','Synthetic legacy quote','custom_quote','one-time',true);
insert into public.package_tiers(package_id,name,price,frequency) values ((select id from ids where name='quote'),'Estimate',200,'one-time');
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.fix((select id from ids where name='quote'), null, 'Synthetic legacy approval')->'conversions',
 '["Estimate: shown as \"starting at\" (no price meaning was recorded)"]'::jsonb, 'the conversion is reported');
reset role;
select is((select content->'tiers'->0->>'price_kind' from private.operator_package_drafts where target_package_id=(select id from ids where name='quote')),
 'starting_at', 'the legacy quote level becomes starting at');

-- Suspension while approval is obtained.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.admin_suspend_package((select id from ids where name='quote'), pg_temp.stamp((select id from ids where name='quote')), 'x')$$,
 '42501', null, 'a vendor cannot use the operator suspension');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.admin_suspend_package((select id from ids where name='quote'), '2000-01-01', 'Synthetic error')$$,
 '40001', null, 'a stale read is refused');
select is((public.admin_suspend_package((select id from ids where name='quote'), pg_temp.stamp((select id from ids where name='quote')), 'Synthetic wrong price')
  ->>'vendor_notified')::boolean, true, 'an incorrect listing is suspended and the vendor told');
select throws_ok($$select public.admin_suspend_package((select id from ids where name='quote'), pg_temp.stamp((select id from ids where name='quote')), 'Again')$$,
 '55000', null, 'a paused package cannot be suspended again');
select is(public.admin_package_price_corrections(pg_temp.vendor(1))->0->'changes', '[{"kind":"suspended"}]'::jsonb, 'the suspension is in the history');
reset role;
select is((select is_active from public.vendor_packages where id=(select id from ids where name='quote')), false, 'the listing is paused');
select ok(exists(select 1 from private.operator_package_drafts where target_package_id=(select id from ids where name='quote') and status='draft'),
 'its replacement draft stays open for approval');

-- DEC-2026-041 item 5: approval evidence is reported as recorded, never inferred.
create function pg_temp.approval(p_package uuid) returns jsonb language sql as $$
 select c->'approval' from jsonb_array_elements(public.admin_package_contents(null)) c where (c->>'package_id')::uuid = p_package $$;
select pg_temp.as_user('1');
set local role authenticated;
select is(pg_temp.approval((select id from ids where name='fixed_pkg'))->>'status', 'vendor_approved', 'a revision published after vendor approval says so');
select is(pg_temp.approval((select id from ids where name='paused'))->>'status', 'unrecorded',
 'a package written outside the draft flow claims no approval');
select is(pg_temp.approval((select id from ids where name='quote'))->'replacement'->>'approval_state', 'draft',
 'an open replacement draft is shown with its approval state');
reset role;
select * from finish();
rollback;
