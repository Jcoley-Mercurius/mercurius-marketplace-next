-- TRACE-113 (20261018002000). Synthetic fixtures only: full-content operator drafts,
-- revision-bound vendor approval, delivery states, template copies, replacement revisions,
-- previews, audit history and the legacy approval inventory.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1; 3 vendor bound to provider 3; provider 2 has no account.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8310000-0000-4000-8000-000000000001','approval-operator@example.invalid',now()),
 ('b8310000-0000-4000-8000-000000000002','approval-vendor@example.invalid',now()),
 ('b8310000-0000-4000-8000-000000000003','approval-other-vendor@example.invalid',now());
delete from public.user_roles where user_id in ('b8310000-0000-4000-8000-000000000002','b8310000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('b8310000-0000-4000-8000-000000000001','admin'),
 ('b8310000-0000-4000-8000-000000000002','vendor'),
 ('b8310000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8320000-0000-4000-8000-000000000001','Synthetic approval vendor',true,true,'b8310000-0000-4000-8000-000000000002'),
 ('b8320000-0000-4000-8000-000000000002','Synthetic unlinked vendor',true,true,null),
 ('b8320000-0000-4000-8000-000000000003','Synthetic other vendor',true,true,'b8310000-0000-4000-8000-000000000003');
insert into public.service_categories(id,name) values ('synthetic-approval-cat','Synthetic approval category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-approval-svc','Synthetic approval service','synthetic-approval-cat',100,60,'one-time','{one-time,monthly}',true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8310000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.vendor(p_n integer) returns uuid language sql as $$ select ('b8320000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create function pg_temp.stamp(p_draft uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.rev(p_draft uuid) returns text language sql security definer as $$
 select content_hash from private.operator_package_drafts where id = p_draft $$;
create function pg_temp.state(p_draft uuid) returns text language sql security definer as $$
 select approval_state from private.operator_package_drafts where id = p_draft $$;
-- Synthetic cleaning content: two non-overlapping square-foot levels, a range add-on and a required add-on.
create function pg_temp.content(p_name text default 'Synthetic standard clean', p_small numeric default 120) returns jsonb language sql as $$
 select jsonb_build_object('name',p_name,'description','Synthetic scope','pricing_mode','fixed',
  'included_scope','["Kitchen","Bathrooms"]'::jsonb,'policy_notes','Synthetic provider note',
  'questions','[{"question_key":"sqft","question_label":"Square feet","input_type":"number","is_required":true}]'::jsonb,
  'tiers',jsonb_build_array(
    jsonb_build_object('id','small','name','Up to 1,500 sq ft','frequency','one-time','price_kind','exact','price',p_small,
      'conditions','[{"question_key":"sqft","min":0,"max":1500}]'::jsonb),
    jsonb_build_object('id','large','name','1,501 to 3,000 sq ft','frequency','one-time','price_kind','exact','price',180,
      'conditions','[{"question_key":"sqft","min":1501,"max":3000}]'::jsonb)),
  'addons','[{"id":"fridge","name":"Inside fridge","price_kind":"range","price":30,"price_max":50},
             {"id":"setup","name":"Synthetic setup","price":10,"is_required":true,"min_quantity":1,"max_quantity":1}]'::jsonb) $$;
create function pg_temp.save(p_vendor integer, p_content jsonb, p_draft uuid default null, p_target uuid default null) returns jsonb language sql as $$
 select public.admin_save_package_draft_content(p_draft, case when p_draft is not null then pg_temp.stamp(p_draft) end,
   pg_temp.vendor(p_vendor), 'synthetic-approval-svc', p_target, p_content) $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;

-- Grants -----------------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.admin_save_package_draft_content(uuid,timestamptz,uuid,text,uuid,jsonb)','execute'),
 'anonymous callers cannot save drafts');
select ok(not has_function_privilege('anon','public.vendor_approve_package_draft(uuid,text)','execute'),
 'anonymous callers cannot approve');
select ok(not has_table_privilege('authenticated','private.package_draft_events','select'),
 'signed-in users cannot read draft history directly');

select pg_temp.as_user('1');
set local role authenticated;

-- Validation -------------------------------------------------------------------------------
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,1,conditions}', '[{"question_key":"sqft","min":1500,"max":3000}]'))$$,
 '22023', 'One-time: "Up to 1,500 sq ft" and "1,501 to 3,000 sq ft" can both match the same home; make their rules not overlap',
 'overlapping levels are refused at the boundary');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,1,conditions}', '[]'))$$,
 '22023', 'One-time: give every price level a rule, or none (then the homeowner chooses)', 'rules are all or none per cadence');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,0,conditions}', '[{"question_key":"beds","min":1}]'))$$,
 '22023', 'A rule must use a number question of this package', 'a rule needs a question the package asks');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,0,price_kind}', '"range"'))$$,
 '22023', 'A fixed price is exact; use "Quote required" for a starting-at or range estimate', 'a fixed package cannot hold an estimate');
select throws_ok($$select pg_temp.save(1, jsonb_set(jsonb_set(pg_temp.content(), '{pricing_mode}', '"custom_quote"'), '{tiers,0,price_kind}', '"exact"'))$$,
 '22023', 'A quote shows an estimate (starting at or a range), not an exact price', 'a quote cannot hold an exact price');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{addons,0,price_max}', '20'))$$,
 '22023', 'An add-on range needs an upper amount above its lower amount', 'add-on ranges are ordered');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{addons,0,name}', '"kitchen"'))$$,
 '22023', '"kitchen" is already included in the package; it cannot also be charged as an add-on', 'included scope is not charged again');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,0,frequency}', '"weekly"'))$$,
 '22023', 'Weekly is not offered for this service in the catalog', 'only catalog cadences are offered');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{tiers,0,price}', '12.345'))$$,
 '22023', 'Each price must be a positive amount in whole cents', 'prices are whole cents');
select throws_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content(), '{addons,1,min_quantity}', '0'))$$,
 '22023', 'A required add-on needs a quantity of at least 1', 'a required add-on needs a quantity');
select lives_ok($$select pg_temp.save(1, jsonb_build_object('name','Synthetic walkthrough','pricing_mode','custom_quote'))$$,
 'quote after walkthrough needs no amount');

-- A draft, its preview and its history ----------------------------------------------------
insert into ids select 'a', (pg_temp.save(1, pg_temp.content())->>'id')::uuid;
select is(pg_temp.state((select id from ids where name='a')), 'draft', 'a new draft starts as a draft');
select is((public.pricing_preview_draft((select id from ids where name='a'),'one-time',null,'{"sqft":"1500"}',null)->>'total_cents'),
 '13000', 'the draft preview prices the level and its required add-on');
select is((public.pricing_preview_draft((select id from ids where name='a'),'one-time',null,'{"sqft":"1501"}','[{"id":"fridge","quantity":1}]')
  - 'lines' - 'included_scope' - 'tier_id' - 'revision'),
 '{"status":"estimate","reason":null,"requires_quote":true,"pricing_mode":"fixed","frequency":"one-time","tier_name":"1,501 to 3,000 sq ft","total_cents":null,"min_cents":22000,"max_cents":24000,"deposit_cents":null,"currency":"usd"}'::jsonb,
 'the preview shows a range add-on as an estimate');
select is((public.pricing_preview_content('synthetic-approval-svc', pg_temp.content('Unsaved', 99), 'one-time', null, '{"sqft":"900"}', null)->>'total_cents'),
 '10900', 'unsaved edits preview with the same calculation');
select is((public.pricing_preview_draft((select id from ids where name='a'),'one-time',null,'{}',null)->>'reason'),
 'no_matching_price_level', 'a preview without the answer does not invent a level');

-- Sending: an unbound provider is blocked and recorded; the bound vendor gets an in-app notice.
insert into ids select 'unlinked', (pg_temp.save(2, pg_temp.content())->>'id')::uuid;
select is((public.admin_send_package_draft((select id from ids where name='unlinked'), pg_temp.rev((select id from ids where name='unlinked')))
  - 'draft'), '{"status":"blocked","reason":"No vendor account is bound to this provider and no contact email is on file"}'::jsonb,
 'a provider without a bound vendor account cannot be asked for approval');
select is(pg_temp.state((select id from ids where name='unlinked')), 'draft', 'a blocked send leaves the draft as a draft');
select throws_ok($$select public.admin_send_package_draft((select id from ids where name='a'), 'stale')$$,
 '40001', 'Draft changed since it was read; reload before sending', 'the operator sends the revision they read');
select is(public.admin_send_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'status',
 'sent', 'the bound vendor is asked to approve');
select is((select d->'delivery'->>'status' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(1))) d
  where (d->>'id')::uuid=(select id from ids where name='a')), 'in_inbox', 'delivery shows the notice in the vendor''s inbox');
select is((select d->'delivery'->>'email' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(1))) d
  where (d->>'id')::uuid=(select id from ids where name='a')), 'not_sent', 'no email is claimed');
reset role;
select is((select count(*)::int from public.notifications where user_id='b8310000-0000-4000-8000-000000000002' and type='pricing'),
 1, 'one in-app notice');
update public.notifications set read_at=now() where user_id='b8310000-0000-4000-8000-000000000002';
select pg_temp.as_user('1');
set local role authenticated;
select is((select d->'delivery'->>'status' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(1))) d
  where (d->>'id')::uuid=(select id from ids where name='a')), 'read', 'a read notice shows as read');
select is(pg_temp.state((select id from ids where name='a')), 'sent', 'a delivered or read notice is not an approval');
-- Publishing without the vendor's approval is covered by SQL 091 (DEC-2026-046).
-- The operator cannot approve on the vendor's behalf.
select throws_ok($$select public.vendor_approve_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))$$,
 '42501', 'Vendor account required', 'an operator cannot approve for the vendor');
reset role;

-- Vendor decisions -------------------------------------------------------------------------
select pg_temp.as_user('3');
set local role authenticated;
select throws_ok($$select public.vendor_approve_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))$$,
 'P0002', 'Draft not found', 'another vendor cannot approve this vendor''s price');
select is(public.vendor_package_approvals(), '[]'::jsonb, 'another vendor sees none of it');
reset role;

select pg_temp.as_user('2');
set local role authenticated;
select is(jsonb_array_length(public.vendor_package_approvals()), 1, 'the vendor sees the price waiting for approval');
select ok(not (public.vendor_package_approvals()->0 ? 'created_by_email'), 'the vendor view has no operator identity');
select is((public.pricing_preview_draft((select id from ids where name='a'),'one-time',null,'{"sqft":"1200"}',null)->>'total_cents'),
 '13000', 'the vendor previews what homeowners would pay');
select throws_ok($$select public.vendor_approve_package_draft((select id from ids where name='a'), repeat('0',64))$$,
 '40001', 'This price changed since you opened it; reload to review the current version', 'an obsolete revision cannot be approved');
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='a'), pg_temp.stamp((select id from ids where name='a')), 'x')$$,
 '42501', 'Onboarding operator required', 'a vendor cannot publish');
select throws_ok($$select public.vendor_request_package_changes((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')), '  ')$$,
 'P0001', 'Say what should change', 'a change request says what');
select is(public.vendor_request_package_changes((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')),
 'Small homes are $125')->>'approval_state', 'changes_requested', 'the vendor asks for changes');
reset role;

-- The operator revises; the material edit is a new revision and is sent again.
select pg_temp.as_user('1');
set local role authenticated;
select is((select d->>'change_request' from jsonb_array_elements(public.admin_package_drafts(pg_temp.vendor(1))) d
  where (d->>'id')::uuid=(select id from ids where name='a')), 'Small homes are $125', 'the operator reads the requested change');
insert into ids select 'rev1', null;
update ids set id = null where name = 'rev1';
create temp table revs as select pg_temp.rev((select id from ids where name='a')) r1;
grant all on revs to authenticated;
select lives_ok($$select pg_temp.save(1, pg_temp.content('Synthetic standard clean', 125), (select id from ids where name='a'))$$, 'the operator edits the price');
select isnt(pg_temp.rev((select id from ids where name='a')), (select r1 from revs), 'the edit is a new revision');
select is(public.admin_send_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'status',
 'sent', 'the new revision is sent');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_approve_package_draft((select id from ids where name='a'), (select r1 from revs))$$,
 '40001', 'This price changed since you opened it; reload to review the current version', 'the earlier revision cannot be approved');
select is(public.vendor_approve_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'approval_state',
 'approved', 'the vendor approves the current revision');
select is(public.vendor_approve_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'approval_state',
 'approved', 'a retried approval is harmless');
reset role;
select is((select count(*)::int from private.package_draft_events where draft_id=(select id from ids where name='a') and kind='approved'),
 1, 'a retried approval is not recorded twice');

-- A material edit after approval needs fresh approval; an unchanged save keeps it.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$select pg_temp.save(1, pg_temp.content('Synthetic standard clean', 125), (select id from ids where name='a'))$$, 'an unchanged save');
select is(pg_temp.state((select id from ids where name='a')), 'approved', 'an unchanged save keeps the approval');
create temp table approved_rev as select pg_temp.rev((select id from ids where name='a')) r;
grant all on approved_rev to authenticated;
select lives_ok($$select pg_temp.save(1, jsonb_set(pg_temp.content('Synthetic standard clean', 125), '{addons,1,price}', '12'), (select id from ids where name='a'))$$,
 'the operator changes an add-on after approval');
select is(pg_temp.state((select id from ids where name='a')), 'draft', 'the edited revision is no longer approved');
-- Put the approved content back: same revision again, but it must be approved again.
select lives_ok($$select pg_temp.save(1, pg_temp.content('Synthetic standard clean', 125), (select id from ids where name='a'))$$, 'reverted');
select is(pg_temp.rev((select id from ids where name='a')), (select r from approved_rev), 'the same content is the same revision');
select is(pg_temp.state((select id from ids where name='a')), 'draft', 'approval is not restored by an edit');
select is(public.admin_send_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'status', 'sent', 'sent again');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select is(public.vendor_approve_package_draft((select id from ids where name='a'), pg_temp.rev((select id from ids where name='a')))->>'approval_state',
 'approved', 'approved again');
reset role;

-- Publication -------------------------------------------------------------------------------
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'pkg', (public.admin_publish_package_draft((select id from ids where name='a'),
  pg_temp.stamp((select id from ids where name='a')), 'Synthetic agreed scope')->>'package_id')::uuid;
reset role;
select is((select row(name,pricing_mode,is_active,lineage_id=id,revision_number,included_scope,policy_notes)::text from public.vendor_packages
  where id=(select id from ids where name='pkg')),
 row('Synthetic standard clean','fixed',true,true,1,'{Kitchen,Bathrooms}'::text[],null::text)::text,
 'publishing creates the approved package as a first revision');
-- TRACE-122 (SQL 093): the draft's notes become the package's internal notes, not revision content.
select is((select notes from private.package_internal_notes where subject_id=(select id from ids where name='pkg')),
 'Synthetic provider note', 'the draft''s notes become the package''s internal notes');
select is((select array_agg(row(name,price,price_kind,rule_conditions)::text order by sort_order) from public.package_tiers
  where package_id=(select id from ids where name='pkg')),
 array[row('Up to 1,500 sq ft',125::numeric,'exact','[{"max": 1500, "min": 0, "question_key": "sqft"}]'::jsonb)::text,
       row('1,501 to 3,000 sq ft',180::numeric,'exact','[{"max": 3000, "min": 1501, "question_key": "sqft"}]'::jsonb)::text],
 'the approved levels and rules are published');
select is((select array_agg(row(name,price_kind,price,price_max,is_required)::text order by sort_order) from public.package_addons
  where package_id=(select id from ids where name='pkg')),
 array[row('Inside fridge','range',30::numeric,50::numeric,false)::text,row('Synthetic setup','exact',10::numeric,null::numeric,true)::text],
 'the approved add-ons are published');
select is((select count(*)::int from public.package_qualifying_questions where package_id=(select id from ids where name='pkg')), 1,
 'the approved question is published');
select is(private.price_selection(private.package_content((select id from ids where name='pkg')),'one-time',null,'{"sqft":{"answer":"1000"}}',null)->>'total_cents',
 '13500', 'the live package prices exactly as the approved preview');

-- A booking on revision 1, then a replacement revision.
insert into public.service_requests(id,customer_id,service_type,address,city,state,zip_code,frequency,package_id,total_amount)
 values ('b8350000-0000-4000-8000-000000000001','b8310000-0000-4000-8000-000000000002','Synthetic','1 Synthetic Way','Synthetic','FL','00083',
   'one-time',(select id from ids where name='pkg'),135);
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'b', (pg_temp.save(1, pg_temp.content('Synthetic standard clean', 140), null, (select id from ids where name='pkg'))->>'id')::uuid;
select is(public.admin_send_package_draft((select id from ids where name='b'), pg_temp.rev((select id from ids where name='b')))->>'status', 'sent', 'a replacement is sent');
reset role;
select is((select is_active from public.vendor_packages where id=(select id from ids where name='pkg')), true,
 'the approved live revision stays live while its replacement awaits approval');
select pg_temp.as_user('2');
set local role authenticated;
select is(public.vendor_approve_package_draft((select id from ids where name='b'), pg_temp.rev((select id from ids where name='b')))->>'approval_state', 'approved', 'the replacement is approved');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'pkg2', (public.admin_publish_package_draft((select id from ids where name='b'),
  pg_temp.stamp((select id from ids where name='b')), 'Synthetic new rate')->>'package_id')::uuid;
reset role;
select is((select row(lineage_id, revision_number, is_active)::text from public.vendor_packages where id=(select id from ids where name='pkg2')),
 row((select id from ids where name='pkg'), 2, true)::text, 'the replacement is revision 2 of the same package');
select is((select is_active from public.vendor_packages where id=(select id from ids where name='pkg')), false, 'revision 1 is paused, not deleted');
select is((select row(package_id, total_amount)::text from public.service_requests where id='b8350000-0000-4000-8000-000000000001'),
 row((select id from ids where name='pkg'), 135.00)::text, 'the earlier booking keeps revision 1 and its amount');

-- Same-name packages for the vendor and service are refused; another vendor's are not affected.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'same', (pg_temp.save(1, pg_temp.content('SYNTHETIC standard clean'))->>'id')::uuid;
select lives_ok($$select public.admin_send_package_draft((select id from ids where name='same'), pg_temp.rev((select id from ids where name='same')))$$, 'sent');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select lives_ok($$select public.vendor_approve_package_draft((select id from ids where name='same'), pg_temp.rev((select id from ids where name='same')))$$, 'approved');
reset role;
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.admin_publish_package_draft((select id from ids where name='same'), pg_temp.stamp((select id from ids where name='same')), 'x')$$,
 '23505', 'This vendor already has an active package named "SYNTHETIC standard clean" for this service; rename it or replace that package',
 'a second active package with the same name is refused');

-- Template copy: independent of later template edits.
reset role;
insert into public.pricing_templates(id,service_id,name,description,is_active) values
 ('b8360000-0000-4000-8000-000000000001','synthetic-approval-svc','Synthetic template','Synthetic template scope',true);
insert into public.pricing_template_questions(template_id,question_key,question_label,input_type,required,sort_order) values
 ('b8360000-0000-4000-8000-000000000001','sqft','Square feet','number',true,0),
 ('b8360000-0000-4000-8000-000000000001','pets','Pets?','boolean',false,1);
insert into public.pricing_template_tiers(template_id,name,rule_json,min_price,max_price,suggested_price,includes,sort_order) values
 ('b8360000-0000-4000-8000-000000000001','Small','{"all":[{"key":"sqft","min":0,"max":1000}]}',80,120,100,'{Kitchen}',0),
 ('b8360000-0000-4000-8000-000000000001','Large','{"any":[{"key":"sqft","min":1001}]}',120,200,null,'{}',1);
insert into public.pricing_template_addons(template_id,addon_key,label,default_price,price_min,price_max,sort_order) values
 ('b8360000-0000-4000-8000-000000000001','oven','Inside oven',25,20,40,0);
select pg_temp.as_user('1');
set local role authenticated;
create temp table clone as select public.admin_draft_from_template(pg_temp.vendor(3),'b8360000-0000-4000-8000-000000000001') d;
grant all on clone to authenticated;
select is((select jsonb_array_length(d->'content'->'tiers') from clone), 2, 'the copy keeps the template levels');
select is((select d->'content'->'tiers'->0->'conditions' from clone), '[]'::jsonb,
 'with one rule unconvertible, no rule is copied (rules are all or none)');
select is((select d->'content'->'tiers'->1->>'price' from clone), '120', 'a level without a suggested price starts at the template minimum');
select is((select d->'content'->'questions'->1->>'input_type' from clone), 'select', 'a yes/no question becomes a choice');
select is((select jsonb_array_length(d->'copy_notes') from clone), 3, 'the copy reports what it could not carry over');
select ok((select d->'copy_notes'->>2 from clone) like 'Only some rules converted%', 'and that the rules were left for the operator');
select ok((select d->'copy_notes'->>1 from clone) like '%"Large" could not be converted%', 'an unconvertible rule is reported, not guessed');
reset role;
update public.pricing_template_tiers set suggested_price=999 where template_id='b8360000-0000-4000-8000-000000000001';
select is((select content->'tiers'->0->>'price' from private.operator_package_drafts where id=(select (d->>'id')::uuid from clone)), '100',
 'a later template edit does not reprice the copy');

reset role;
update public.pricing_template_tiers set rule_json='{"all":[{"key":"sqft","min":1001,"max":4000}]}' where template_id='b8360000-0000-4000-8000-000000000001' and name='Large';
select pg_temp.as_user('1');
set local role authenticated;
select is((public.admin_draft_from_template(pg_temp.vendor(3),'b8360000-0000-4000-8000-000000000001')->'content'->'tiers'->0->'conditions'),
 '[{"max": 1000, "min": 0, "question_key": "sqft"}]'::jsonb, 'convertible rules are copied');
reset role;

-- History and inventory --------------------------------------------------------------------
select pg_temp.as_user('1');
set local role authenticated;
select is((select array_agg(e.value->>'kind' order by e.ordinality) from jsonb_array_elements(public.admin_package_draft_events((select id from ids where name='a')))
  with ordinality e(value, ordinality)),
 array['saved','sent','changes_requested','saved','sent','approved','saved','saved','sent','approved','published'],
 'the history records every step');
select is((select e->'changes' from jsonb_array_elements(public.admin_package_draft_events((select id from ids where name='a'))) e
  where e->>'kind'='saved' order by e->>'created_at' limit 1 offset 1)->0->>'field', 'tiers',
 'a save records which fields changed');
select is((select e->>'actor_email' from jsonb_array_elements(public.admin_package_draft_events((select id from ids where name='a'))) e where e->>'kind'='approved' limit 1),
 'approval-vendor@example.invalid', 'the approving vendor account is recorded');
select is((select count(*)::int from jsonb_array_elements(public.admin_package_draft_events((select id from ids where name='unlinked'))) e where e->>'kind'='send_blocked'),
 1, 'a blocked send is recorded');
select is((public.admin_pricing_approval_inventory()->>'vendor_approved_revision')::int >= 1, true,
 'the inventory counts packages published from a vendor-approved revision');
reset role;

select * from finish();
rollback;
