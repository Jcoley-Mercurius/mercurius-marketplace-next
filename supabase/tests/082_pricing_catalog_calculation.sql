-- TRACE-112 (20261018001000). Synthetic fixtures only; amounts are test examples, not vendor
-- rates. Package identity and lineage, price meaning, structured add-ons, rule conditions,
-- the shared calculation, and its use by request preview and submission.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data) values
 ('b8210000-0000-4000-8000-000000000001','pricing-homeowner@example.invalid','{"full_name":"Synthetic homeowner"}'),
 ('b8210000-0000-4000-8000-000000000002','pricing-vendor@example.invalid','{"full_name":"Synthetic vendor"}');
delete from public.user_roles where user_id='b8210000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values ('b8210000-0000-4000-8000-000000000002','vendor');

insert into public.service_categories(id,name) values ('synthetic-pricing-cat','Synthetic pricing category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-cans','Synthetic can cleaning','synthetic-pricing-cat',60,30,'one-time','{one-time,monthly}',true),
 ('synthetic-clean','Synthetic home cleaning','synthetic-pricing-cat',150,120,'one-time','{one-time,monthly}',true),
 ('synthetic-walk','Synthetic walkthrough service','synthetic-pricing-cat',300,300,'one-time','{one-time}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00082','Synthetic covered',true,false);
insert into private.r0_lee_zips values ('00082');

-- Vendor 1 is linked to the vendor account; vendor 2 is unrelated.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8220000-0000-4000-8000-000000000001','Synthetic can vendor',true,true,'b8210000-0000-4000-8000-000000000002'),
 ('b8220000-0000-4000-8000-000000000002','Synthetic cleaning vendor',true,true,null);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('b8220000-0000-4000-8000-000000000001','00082'),('b8220000-0000-4000-8000-000000000002','00082');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select 'b8210000-0000-4000-8000-000000000001','00082',s.id,'b8210000-0000-4000-8000-000000000001'
from public.services_catalog s where s.id like 'synthetic-%';

-- Packages. 1 and 2 are distinct named packages for the same vendor, service and cadence.
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review,included_scope) values
 ('b8240000-0000-4000-8000-000000000001','b8220000-0000-4000-8000-000000000001','synthetic-cans','Synthetic one-time can cleaning','fixed','one-time',true,false,'{"Two cans"}'),
 ('b8240000-0000-4000-8000-000000000002','b8220000-0000-4000-8000-000000000001','synthetic-cans','Synthetic dump and clean','fixed','one-time',true,false,'{}'),
 ('b8240000-0000-4000-8000-000000000003','b8220000-0000-4000-8000-000000000002','synthetic-clean','Synthetic standard cleaning','fixed','one-time',true,false,'{"Inside oven"}'),
 ('b8240000-0000-4000-8000-000000000004','b8220000-0000-4000-8000-000000000002','synthetic-walk','Synthetic walkthrough','custom_quote','one-time',true,false,'{}'),
 ('b8240000-0000-4000-8000-000000000005','b8220000-0000-4000-8000-000000000002','synthetic-clean','Synthetic overlapping','fixed','monthly',true,false,'{}');
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('b8250000-0000-4000-8000-000000000001','b8240000-0000-4000-8000-000000000001','One-time',49.95,'one-time',0,'[]'),
 ('b8250000-0000-4000-8000-000000000002','b8240000-0000-4000-8000-000000000001','Monthly',29.95,'monthly',1,'[]'),
 ('b8250000-0000-4000-8000-000000000003','b8240000-0000-4000-8000-000000000002','One-time',89,'one-time',0,'[]'),
 -- Non-overlapping two-dimension levels: square feet and bedrooms.
 ('b8250000-0000-4000-8000-000000000004','b8240000-0000-4000-8000-000000000003','Small home',100,'one-time',0,
   '[{"question_key":"sqft","min":0,"max":1200},{"question_key":"bedrooms","min":1,"max":2}]'),
 ('b8250000-0000-4000-8000-000000000005','b8240000-0000-4000-8000-000000000003','Medium home',150,'one-time',1,
   '[{"question_key":"sqft","min":1201,"max":2000},{"question_key":"bedrooms","min":1,"max":3}]'),
 ('b8250000-0000-4000-8000-000000000006','b8240000-0000-4000-8000-000000000003','Large home',200,'one-time',2,
   '[{"question_key":"sqft","min":2001,"max":3000},{"question_key":"bedrooms","min":2,"max":5}]'),
 -- Overlapping at exactly 900 square feet.
 ('b8250000-0000-4000-8000-000000000007','b8240000-0000-4000-8000-000000000005','Up to 900',90,'monthly',0,'[{"question_key":"sqft","min":0,"max":900}]'),
 ('b8250000-0000-4000-8000-000000000008','b8240000-0000-4000-8000-000000000005','900 and up',110,'monthly',1,'[{"question_key":"sqft","min":900,"max":1300}]');
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required,sort_order) values
 ('b8240000-0000-4000-8000-000000000003','sqft','Synthetic square feet','number',true,0),
 ('b8240000-0000-4000-8000-000000000003','bedrooms','Synthetic bedrooms','number',true,1),
 ('b8240000-0000-4000-8000-000000000005','sqft','Synthetic square feet','number',true,0);
-- Extra cans: one rate per cadence, modelled explicitly. Oven: a range. Setup: required.
insert into public.package_addons(id,package_id,name,price,price_kind,price_max,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('b8260000-0000-4000-8000-000000000001','b8240000-0000-4000-8000-000000000001','Extra can (one-time)',15,'exact',null,'can',0,6,false,'{one-time}',0),
 ('b8260000-0000-4000-8000-000000000002','b8240000-0000-4000-8000-000000000001','Extra can (monthly)',10,'exact',null,'can',0,6,false,'{monthly}',1),
 ('b8260000-0000-4000-8000-000000000003','b8240000-0000-4000-8000-000000000003','Inside fridge',30,'range',60,null,0,1,false,'{}',0),
 ('b8260000-0000-4000-8000-000000000004','b8240000-0000-4000-8000-000000000002','Synthetic setup',10,'exact',null,null,1,1,true,'{}',0);

create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated, anon;
create function pg_temp.plan(p_selections jsonb, p_stage text default 'final') returns jsonb language sql as $$
  select jsonb_build_object('stage',p_stage,'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00082'),
    'preferred_time','Synthetic window','selections',p_selections) $$;
create function pg_temp.preview(p_selections jsonb, p_stage text default 'final') returns jsonb language plpgsql as $$
declare r jsonb; begin
  set local role anon;
  r := public.preview_service_request_selections(pg_temp.plan(p_selections, p_stage));
  reset role;
  return r -> 'outcomes' -> 0;
end $$;
create function pg_temp.submit(p_key text, p_selections jsonb) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"b8210000-0000-4000-8000-000000000001"}',true);
  set local role authenticated;
  r := public.submit_service_requests(p_key,pg_temp.plan(p_selections) - 'stage');
  reset role;
  return r;
end $$;
create function pg_temp.price(p_package text, p_frequency text, p_tier text, p_answers jsonb, p_addons jsonb) returns jsonb
language sql as $$ select private.price_selection(private.package_content(p_package::uuid), p_frequency, p_tier, p_answers, p_addons) $$;
create function pg_temp.ans(p_sqft text, p_bedrooms text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('sqft', jsonb_build_object('answer', p_sqft),
    'bedrooms', case when p_bedrooms is not null then jsonb_build_object('answer', p_bedrooms) end)) $$;

-- Identity -----------------------------------------------------------------------------
select is((select count(*) from public.vendor_packages where lineage_id is null), 0::bigint, 'every package has a lineage');
select is((select lineage_id from public.vendor_packages where id='b8240000-0000-4000-8000-000000000001'),
  'b8240000-0000-4000-8000-000000000001'::uuid, 'a first revision is its own lineage');
select ok((select count(*) from public.vendor_packages where contractor_id='b8220000-0000-4000-8000-000000000001'
  and service_id='synthetic-cans' and is_active)=2, 'two named packages coexist for one vendor, service and cadence');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review,lineage_id,revision_number)
 values ('b8240000-0000-4000-8000-000000000011','b8220000-0000-4000-8000-000000000001','synthetic-cans','Synthetic one-time can cleaning','fixed','one-time',false,false,'b8240000-0000-4000-8000-000000000001',2);
select throws_ok($$update public.vendor_packages set is_active=true where id='b8240000-0000-4000-8000-000000000011'$$,
  '23505', null, 'only one revision of a package is active at a time');
select throws_ok($$insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,lineage_id)
  values ('b8220000-0000-4000-8000-000000000002','synthetic-cans','Hijack','fixed','one-time','b8240000-0000-4000-8000-000000000001')$$,
  '22023', 'A package revision must belong to the same vendor and service', 'another vendor cannot join a lineage');
select throws_ok($$update public.vendor_packages set lineage_id='b8240000-0000-4000-8000-000000000002' where id='b8240000-0000-4000-8000-000000000011'$$,
  '22023', 'A package cannot change lineage', 'a revision cannot move to another lineage');

-- Price meaning guards ------------------------------------------------------------------
select throws_ok($$insert into public.package_tiers(package_id,name,price,price_kind,price_max,frequency)
  values ('b8240000-0000-4000-8000-000000000001','Range',40,'range',60,'one-time')$$,
  '22023', null, 'a fixed-price package cannot carry an estimate');
select throws_ok($$insert into public.package_tiers(package_id,name,price,price_kind,frequency)
  values ('b8240000-0000-4000-8000-000000000004','Exact',40,'exact','one-time')$$,
  '22023', null, 'a quote package cannot carry an exact price');
select throws_ok($$insert into public.package_tiers(package_id,name,price,price_kind,price_max,frequency)
  values ('b8240000-0000-4000-8000-000000000004','Range',60,'range',40,'one-time')$$,
  '23514', null, 'a range must be ordered');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency,rule_conditions)
  values ('b8240000-0000-4000-8000-000000000001','Bad rule',40,'one-time','[{"question_key":"sqft","min":10,"max":5}]')$$,
  '23514', null, 'an inverted rule is refused');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency,rule_conditions)
  values ('b8240000-0000-4000-8000-000000000001','Bad rule',40,'one-time','[{"question_key":"sqft"}]')$$,
  '23514', null, 'a rule needs a bound');
select throws_ok($$insert into public.package_addons(package_id,name,price,is_required,min_quantity)
  values ('b8240000-0000-4000-8000-000000000001','Required none',5,true,0)$$,
  '23514', null, 'a required add-on needs a quantity');
select throws_ok($$insert into public.package_addons(package_id,name,price,price_kind,price_max)
  values ('b8240000-0000-4000-8000-000000000001','Range none',5,'range',null)$$,
  '23514', null, 'a range add-on needs its upper amount');
select lives_ok($$insert into public.package_tiers(package_id,name,price,price_kind,price_max,frequency)
  values ('b8240000-0000-4000-8000-000000000004','Walkthrough estimate',250,'range',400,'one-time')$$,
  'a quote package can carry an estimate range');
delete from public.package_tiers where package_id='b8240000-0000-4000-8000-000000000004';

-- A vendor's own editor still writes tiers directly (RLS path) under the new constraints.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8210000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select lives_ok($$insert into public.package_tiers(package_id,name,price,frequency,rule_conditions)
  values ('b8240000-0000-4000-8000-000000000011','Vendor tier',45,'one-time','[{"question_key":"cans","max":2}]')$$,
  'a vendor still saves a tier on its own package');
select throws_ok($$insert into public.package_tiers(package_id,name,price,frequency)
  values ('b8240000-0000-4000-8000-000000000003','Other vendor',45,'one-time')$$,
  '42501', null, 'a vendor still cannot write another vendor''s package');
reset role;

-- Calculation: test fixtures 2-4 ------------------------------------------------------------
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','one-time',null,'{}','[{"id":"b8260000-0000-4000-8000-000000000001","quantity":2}]')->>'total_cents',
  '7995', '$49.95 plus two $15 extra cans is exactly $79.95');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','monthly',null,'{}','[{"id":"b8260000-0000-4000-8000-000000000002","quantity":2}]')->>'total_cents',
  '4995', 'the monthly visit uses the monthly level and the monthly extra-can rate');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','monthly',null,'{}','[{"id":"b8260000-0000-4000-8000-000000000001","quantity":2}]')->>'reason',
  'addon_not_offered', 'the one-time extra-can rate does not apply to a monthly visit');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','one-time',null,'{}','[{"id":"b8260000-0000-4000-8000-000000000001","quantity":7}]')->>'reason',
  'addon_quantity', 'a quantity above the allowed maximum is refused');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','one-time',null,'{}',
  '[{"id":"b8260000-0000-4000-8000-000000000001","quantity":1},{"id":"b8260000-0000-4000-8000-000000000001","quantity":1}]')->>'reason',
  'duplicate_addon', 'an add-on cannot be counted twice');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000001','one-time',null,'{}','[{"id":"not-an-addon","quantity":1}]')->>'status',
  'invalid', 'an unknown add-on is refused, not ignored');

select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1500','3'),'[{"id":"b8260000-0000-4000-8000-000000000003","quantity":1}]')
  - 'lines' - 'included_scope' - 'tier_id',
  '{"status":"estimate","reason":null,"requires_quote":true,"pricing_mode":"fixed","frequency":"one-time","tier_name":"Medium home","total_cents":null,"min_cents":18000,"max_cents":21000,"deposit_cents":null,"currency":"usd"}'::jsonb,
  'an exact level plus a range add-on is an estimate, never a total');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000004','one-time',null,'{}',null)->>'status',
  'quote', 'quote after walkthrough has no amount');
select ok(pg_temp.price('b8240000-0000-4000-8000-000000000004','one-time',null,'{}',null)->>'total_cents' is null
  and pg_temp.price('b8240000-0000-4000-8000-000000000004','one-time',null,'{}',null)->>'min_cents' is null,
  'a walkthrough shows neither a total nor a fabricated $0');

select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1200','2'),null)->>'tier_name',
  'Small home', 'the upper boundary 1200 matches only the small level');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1201','2'),null)->>'tier_name',
  'Medium home', 'the lower boundary 1201 matches only the medium level');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100','4'),null)->>'reason',
  'no_matching_price_level', 'conflicting answers (small area, many bedrooms) do not advance to a pricier level');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100'),null)->>'reason',
  'no_matching_price_level', 'a missing answer cannot produce an exact amount');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('9000','3'),null)->>'status',
  'unresolved', 'a home outside every level is unresolved');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,null,null)->>'reason',
  'answers_needed', 'without answers a rule-based package is not priced');
-- DEC-2026-041 item 7: unmatched answers show no level's amount and say which answer blocked.
select ok(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('9000','3'),null)->>'min_cents' is null
  and pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('9000','3'),null)->>'max_cents' is null
  and pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('9000','3'),null)->>'total_cents' is null,
  'unmatched answers show no amount: no lowest level, no next level, no range across levels');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('9000','3'),null)->'blocking',
  '{"answers":[{"answer":"9000","question_key":"sqft","question_label":"Synthetic square feet"}],"combination":false}'::jsonb,
  'an area outside every level is named as the blocking answer');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100','4'),null)->'blocking'->'answers'->0->>'question_key',
  'bedrooms', 'too many bedrooms for any level is named');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100','3'),null)->'blocking'->>'combination',
  'true', 'answers that each fit a level but not together are reported as a combination');
select is(jsonb_array_length(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100','3'),null)->'blocking'->'answers'),
  2, 'the combination names both answers');
select ok(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1100'),null)->'blocking'->'answers' @> '[{"question_key":"bedrooms","answer":null}]',
  'a missing answer is named as not answered');
select ok(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,null,null)->>'min_cents' is not null
  and pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,null,null)->'blocking' is null,
  'before any answer the range across levels is still shown as From, with nothing blocking');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000005','monthly',null,pg_temp.ans('900'),null)->>'reason',
  'ambiguous_price_levels', 'overlapping levels at 900 produce no exact amount');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time','b8250000-0000-4000-8000-000000000006',pg_temp.ans('1500','3'),null)->>'reason',
  'tier_not_applicable', 'a chosen level the answers do not match is refused');

select is(pg_temp.price('b8240000-0000-4000-8000-000000000002','one-time',null,'{}',null)->>'total_cents',
  '9900', 'a required add-on is always included');
select is(pg_temp.price('b8240000-0000-4000-8000-000000000002','one-time',null,'{}','[{"id":"b8260000-0000-4000-8000-000000000004","quantity":0}]')->>'reason',
  'addon_quantity', 'a required add-on cannot be deselected');
insert into public.package_addons(id,package_id,name,price) values
 ('b8260000-0000-4000-8000-000000000005','b8240000-0000-4000-8000-000000000003','Inside oven',25);
select is(pg_temp.price('b8240000-0000-4000-8000-000000000003','one-time',null,pg_temp.ans('1000','2'),'[{"id":"b8260000-0000-4000-8000-000000000005","quantity":1}]')->>'reason',
  'addon_included_in_package', 'included scope cannot be charged again as an add-on');
delete from public.package_addons where id='b8260000-0000-4000-8000-000000000005';

-- The revision fingerprint changes with any material edit.
insert into ids values ('rev_before', null);
create temp table revs as select private.package_revision_hash('b8240000-0000-4000-8000-000000000001') before_hash;
update public.package_addons set price=16 where id='b8260000-0000-4000-8000-000000000001';
select isnt(private.package_revision_hash('b8240000-0000-4000-8000-000000000001'), (select before_hash from revs), 'an add-on price edit changes the revision');
update public.package_addons set price=15 where id='b8260000-0000-4000-8000-000000000001';
select is(private.package_revision_hash('b8240000-0000-4000-8000-000000000001'), (select before_hash from revs), 'the same content has the same revision');

-- Preview and submission ---------------------------------------------------------------
select is(pg_temp.preview('[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001","addons":[{"id":"b8260000-0000-4000-8000-000000000001","quantity":2}]}]')->>'total',
  '79.95', 'the preview total includes the add-ons');
select is((pg_temp.preview('[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000002"}]')->>'total')::numeric,
  99::numeric, 'the second named package keeps its own price and its required add-on');
select is(jsonb_array_length(pg_temp.preview('[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001"}]')->'addon_options'),
  1, 'the preview lists the add-on choices for the chosen cadence only');
select is(pg_temp.preview('[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001","addons":[{"id":"b8260000-0000-4000-8000-000000000002","quantity":1}]}]')->>'outcome',
  'invalid_package', 'an add-on for another cadence is refused by the preview');
select throws_ok($$select pg_temp.preview('[{"service_id":"synthetic-cans","frequency":"one-time","addons":[{"id":"x","quantity":"2"}]}]')$$,
  '22023', 'Invalid add-on selection', 'a malformed add-on selection is refused');
select is(pg_temp.preview('[{"service_id":"synthetic-clean","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000003","answers":{"sqft":"1500","bedrooms":"3"},"addons":[{"id":"b8260000-0000-4000-8000-000000000003","quantity":1}]}]')
  - 'question_details' - 'scope' - 'price_breakdown' - 'addon_options' - 'package_revision' - 'selection_index' - 'service_id' - 'package_id',
  '{"outcome":"eligible_quote","pricing_mode":"quote","offering_mode":"custom_quote","total":null,"from_total":null,"depends_on_answers":false,"promotion":false,"tier_id":"b8250000-0000-4000-8000-000000000005","price_status":"estimate","price_reason":null,"estimate":{"min":180.00,"max":210.00},"deposit":null}'::jsonb,
  'a range add-on turns the preview into a quote with its estimate');
select is(pg_temp.preview('[{"service_id":"synthetic-clean","frequency":"monthly","package_id":"b8240000-0000-4000-8000-000000000005","answers":{"sqft":"900"}}]')
  - 'selection_index' - 'service_id',
  '{"outcome":"unavailable","reason":"no_eligible_provider","price_reason":"ambiguous_price_levels"}'::jsonb,
  'overlapping levels are not offered for the ambiguous answer, and the preview says why');
select is(pg_temp.preview('[{"service_id":"synthetic-clean","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000003","answers":{"sqft":"9000","bedrooms":"3"}}]')
  - 'selection_index' - 'service_id',
  '{"outcome":"unavailable","reason":"no_eligible_provider","price_reason":"no_matching_price_level","price_blocking":{"answers":[{"answer":"9000","question_key":"sqft","question_label":"Synthetic square feet"}],"combination":false}}'::jsonb,
  'DEC-2026-041 item 7: the preview names the answer that prevented an exact price and shows no amount');
select is(pg_temp.preview('[{"service_id":"synthetic-clean","frequency":"monthly","package_id":"b8240000-0000-4000-8000-000000000005","answers":{"sqft":"901"}}]')->>'total',
  '110', 'outside the overlap the single matching level is exact');
select is(pg_temp.preview('[{"service_id":"synthetic-walk","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000004"}]')->>'price_status',
  'quote', 'a walkthrough previews as a quote');

-- Submission stores the priced selection and package revision; later edits do not change it.
create temp table sub as select pg_temp.submit('synthetic-pricing-0000000001',
  '[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001","addons":[{"id":"b8260000-0000-4000-8000-000000000001","quantity":2}],"expected":{"pricing_mode":"fixed","total":79.95}}]') r;
select is((select r->>'status' from sub), 'submitted', 'a priced plan with add-ons submits');
insert into ids select 'req1', (r#>>'{requests,0,request_id}')::uuid from sub;
select is((select total_amount from public.service_requests where id=(select id from ids where name='req1')), 79.95, 'the request amount includes the add-ons');
select is((select pricing_inputs->>'package_revision' from public.service_requests where id=(select id from ids where name='req1')),
  (select before_hash from revs), 'the request keeps the package revision it was priced from');
select is((select jsonb_array_length(pricing_inputs->'lines') from public.service_requests where id=(select id from ids where name='req1')),
  2, 'the request keeps the level and add-on lines');
update public.package_tiers set price=59.95 where id='b8250000-0000-4000-8000-000000000001';
select is((select (pricing_inputs->>'total_cents')::bigint from public.service_requests where id=(select id from ids where name='req1')),
  7995::bigint, 'a later catalog edit does not change the stored breakdown');
select is((select total_amount from public.service_requests where id=(select id from ids where name='req1')), 79.95, 'nor the agreed amount');

select is((pg_temp.submit('synthetic-pricing-0000000002',
  jsonb_build_array(jsonb_build_object('service_id','synthetic-cans','frequency','one-time','package_id','b8240000-0000-4000-8000-000000000001',
    'package_revision',(select before_hash from revs))))#>>'{outcomes,0,outcome}'),
  'price_changed', 'a submission priced from a stale revision is re-shown');
select is((pg_temp.submit('synthetic-pricing-0000000003',
  '[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001","addons":[{"id":"b8260000-0000-4000-8000-000000000001","quantity":2}],"expected":{"pricing_mode":"fixed","total":49.95}}]')#>>'{outcomes,0,outcome}'),
  'price_changed', 'a tampered total is refused');

create temp table sub2 as select pg_temp.submit('synthetic-pricing-0000000004',
  '[{"service_id":"synthetic-clean","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000003","answers":{"sqft":"1500","bedrooms":"3"},"addons":[{"id":"b8260000-0000-4000-8000-000000000003","quantity":1}],"expected":{"pricing_mode":"quote"}}]') r;
insert into ids select 'req2', (r#>>'{requests,0,request_id}')::uuid from sub2;
select is((select row(pricing_mode, quote_only, total_amount)::text from public.service_requests where id=(select id from ids where name='req2')),
  '(custom_quote,t,)', 'an estimate submits as a quote request with no charge amount');
select is((select pricing_inputs->>'min_cents' || '-' || (pricing_inputs->>'max_cents') from public.service_requests where id=(select id from ids where name='req2')),
  '18000-21000', 'the quote request keeps the estimate it was shown');

-- DEC-2026-041 item 2: checkout's commercial source carries add-ons it can verify: the
-- request is priced again from the same package revision and must give the same result.
update public.package_tiers set price=49.95 where id='b8250000-0000-4000-8000-000000000001';
update public.service_requests set status='scheduled', contractor_id='b8220000-0000-4000-8000-000000000001'
 where id=(select id from ids where name='req1');
select is((select (s->>'service')::bigint || '+' || (s->>'addons') from (select private.money_source((select id from ids where name='req1')) s) x),
  '4995+3000', 'checkout carries the level price and the add-ons the request was priced with');
select is((select jsonb_array_length(s->'pricing') from (select private.money_source((select id from ids where name='req1')) s) x), 2,
  'the source keeps the accepted breakdown');
update public.package_addons set price=16 where id='b8260000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source((select id from ids where name='req1'))$$,
  'P0001', 'Offering add-ons changed since the request; a new request or quote is required', 'a changed add-on price is never charged silently');
update public.package_addons set price=15 where id='b8260000-0000-4000-8000-000000000001';
select lives_ok($$select private.money_source((select id from ids where name='req1'))$$, 'the same revision is accepted again');
update public.service_requests set pricing_inputs=jsonb_set(pricing_inputs,'{lines,1,quantity}','3')
 where id=(select id from ids where name='req1');
select throws_ok($$select private.money_source((select id from ids where name='req1'))$$,
  'P0001', 'Offering add-ons do not price the same as the request', 'an altered quantity does not price the same and is refused');
create temp table sub3 as select pg_temp.submit('synthetic-pricing-0000000005',
  '[{"service_id":"synthetic-cans","frequency":"one-time","package_id":"b8240000-0000-4000-8000-000000000001","expected":{"pricing_mode":"fixed","total":49.95}}]') r;
insert into ids select 'req3', (r#>>'{requests,0,request_id}')::uuid from sub3;
update public.service_requests set status='scheduled', contractor_id='b8220000-0000-4000-8000-000000000001'
 where id=(select id from ids where name='req3');
select is((private.money_source((select id from ids where name='req3'))->>'service')::bigint, 4995::bigint,
  'a request without add-ons still reaches checkout at its level price');

-- The finder (used by matching too) no longer picks a level among overlapping ones.
select is((select count(*) from private.find_eligible_packages_with_answers(null,'synthetic-clean','monthly','00082',null,pg_temp.ans('900'))),
  0::bigint, 'matching finds no exact level for an ambiguous answer');
select is((select count(*) from private.find_eligible_packages_with_answers(null,'synthetic-clean','monthly','00082',null,pg_temp.ans('901'))),
  1::bigint, 'matching finds the single level otherwise');

select * from finish();
rollback;
