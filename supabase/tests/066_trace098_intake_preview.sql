-- TRACE-098: read-only intake preview. Synthetic identities and 000xx ZIPs, plus the approved
-- Lee County boundary ZIPs from migration 20260927010000 (DEC-2026-021).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('d6600000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('d6600000-0000-4000-8000-000000000002','{"full_name":"Synthetic vendor only"}');
delete from public.user_roles where user_id='d6600000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values ('d6600000-0000-4000-8000-000000000002','vendor');

-- 00060 covered, 00061 waitlist, 00062 absent. The distant provider serves only 00063;
-- the boundary provider serves 33917 (covered split ZIP) and 34110 (excluded Collier ZIP).
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values
 ('00060','Synthetic covered',true,false),('00061','Synthetic waitlist',false,true),('00063','Synthetic other',true,false);
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('d6620000-0000-4000-8000-000000000001','Synthetic fixed provider',true,true),
 ('d6620000-0000-4000-8000-000000000002','Synthetic quote provider',true,true),
 ('d6620000-0000-4000-8000-000000000003','Synthetic rule provider',true,true),
 ('d6620000-0000-4000-8000-000000000004','Synthetic distant provider',true,true),
 ('d6620000-0000-4000-8000-000000000005','Synthetic boundary provider',true,true),
 ('d6620000-0000-4000-8000-000000000006','Synthetic promoted provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('d6620000-0000-4000-8000-000000000001','00060'),('d6620000-0000-4000-8000-000000000002','00060'),
 ('d6620000-0000-4000-8000-000000000003','00060'),('d6620000-0000-4000-8000-000000000004','00063'),
 ('d6620000-0000-4000-8000-000000000005','33917'),('d6620000-0000-4000-8000-000000000005','34110'),
 ('d6620000-0000-4000-8000-000000000006','00060');
insert into public.vendor_packages(id,contractor_id,service_id,name,description,pricing_mode,default_frequency,is_active,needs_review) values
 ('d6640000-0000-4000-8000-000000000001','d6620000-0000-4000-8000-000000000001','lawn-mowing','Synthetic fixed','Synthetic scope','fixed','one-time',true,false),
 ('d6640000-0000-4000-8000-000000000002','d6620000-0000-4000-8000-000000000002','house-cleaning','Synthetic deposit quote',null,'deposit_quote','monthly',true,false),
 ('d6640000-0000-4000-8000-000000000003','d6620000-0000-4000-8000-000000000003','shrub-hedge-trimming','Synthetic rule',null,'fixed','one-time',true,false),
 ('d6640000-0000-4000-8000-000000000004','d6620000-0000-4000-8000-000000000004','lawn-mowing','Synthetic cheaper elsewhere',null,'fixed','one-time',true,false),
 ('d6640000-0000-4000-8000-000000000005','d6620000-0000-4000-8000-000000000005','pool-service','Synthetic boundary',null,'fixed','one-time',true,false),
 ('d6640000-0000-4000-8000-000000000006','d6620000-0000-4000-8000-000000000006','pest-control','Synthetic promoted',null,'fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name,includes,rule_question_key,rule_min,rule_max) values
 ('d6650000-0000-4000-8000-000000000001','d6640000-0000-4000-8000-000000000001','one-time',100,'Synthetic basic','{"Synthetic edge"}',null,null,null),
 ('d6650000-0000-4000-8000-000000000002','d6640000-0000-4000-8000-000000000001','one-time',150,'Synthetic plus','{}',null,null,null),
 ('d6650000-0000-4000-8000-000000000003','d6640000-0000-4000-8000-000000000003','one-time',80,'Synthetic small','{}','sqft',0,1000),
 ('d6650000-0000-4000-8000-000000000004','d6640000-0000-4000-8000-000000000003','one-time',120,'Synthetic large','{}','sqft',1001,5000),
 ('d6650000-0000-4000-8000-000000000005','d6640000-0000-4000-8000-000000000004','one-time',40,'Synthetic distant','{}',null,null,null),
 ('d6650000-0000-4000-8000-000000000006','d6640000-0000-4000-8000-000000000005','one-time',90,'Synthetic boundary','{}',null,null,null),
 ('d6650000-0000-4000-8000-000000000007','d6640000-0000-4000-8000-000000000006','one-time',60,'Synthetic promoted','{}',null,null,null);
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required,sort_order) values
 ('d6640000-0000-4000-8000-000000000003','sqft','Synthetic hedge length','number',true,0);

insert into private.r0_lee_zips values ('00060'),('00063');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select 'd6600000-0000-4000-8000-000000000001',c.zip_code,s.id,
 'd6600000-0000-4000-8000-000000000001'
from public.coverage_areas c cross join public.services_catalog s
where c.zip_code in ('00060','00063','33917') and c.is_active and s.is_active;

create function pg_temp.plan(p_zip text, p_selections jsonb, p_stage text default 'final') returns jsonb language sql as $$
  select jsonb_build_object('stage',p_stage,'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code',p_zip),
    'preferred_time','Preferred window: synthetic','selections',p_selections) $$;
create function pg_temp.preview(p_payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb; begin
  set local role anon;
  r := public.preview_service_request_selections(p_payload);
  reset role;
  return r;
end $$;
create function pg_temp.submit(p_key text, p_payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"d6600000-0000-4000-8000-000000000001"}',true);
  set local role authenticated;
  r := public.submit_service_requests(p_key,p_payload - 'stage');
  reset role;
  return r;
end $$;
-- Parity: submit exactly what the final preview showed. Outcomes, mode, amount and tier must
-- agree, so the intake never displays terms the command would then refuse or change.
create function pg_temp.parity(p_key text, p_zip text, p_selections jsonb) returns boolean language plpgsql as $$
declare preview jsonb; shown jsonb; submitted jsonb; begin
  preview := pg_temp.preview(pg_temp.plan(p_zip,p_selections));
  select jsonb_agg(selection || jsonb_build_object('expected', case
      when outcome->>'pricing_mode'='fixed' then jsonb_build_object('pricing_mode','fixed','total',(outcome->>'total')::numeric)
      else jsonb_build_object('pricing_mode','quote') end) order by ordinality)
  into shown
  from jsonb_array_elements(p_selections) with ordinality as input(selection, ordinality)
  join jsonb_array_elements(preview->'outcomes') outcome on (outcome->>'selection_index')::int = ordinality-1;
  submitted := pg_temp.submit(p_key,pg_temp.plan(p_zip,shown));
  return (select jsonb_agg(jsonb_build_object('o',o->>'outcome','m',o->>'pricing_mode','t',(o->>'total')::numeric) order by (o->>'selection_index')::int) from jsonb_array_elements(preview->'outcomes') o)
    = (select jsonb_agg(jsonb_build_object('o',o->>'outcome','m',o->>'pricing_mode','t',(o->>'total')::numeric) order by (o->>'selection_index')::int) from jsonb_array_elements(submitted->'outcomes') o)
    and coalesce((select jsonb_agg(jsonb_build_object('m',r->>'pricing_mode','p',r->>'package_id','t',r->>'package_tier_id') order by (r->>'selection_index')::int) from jsonb_array_elements(submitted->'requests') r),'[]')
    = coalesce((select jsonb_agg(jsonb_build_object('m',o->>'offering_mode','p',o->>'package_id','t',o->>'tier_id') order by (o->>'selection_index')::int) from jsonb_array_elements(preview->'outcomes') o where submitted->>'status'='submitted'),'[]');
end $$;

-- Privileges: a public read for anonymous and signed-in visitors; the internals stay private.
select ok(has_function_privilege('anon','public.preview_service_request_selections(jsonb)','EXECUTE'),'anonymous visitors may preview');
select ok(has_function_privilege('authenticated','public.preview_service_request_selections(jsonb)','EXECUTE'),'signed-in visitors may preview');
select ok(not has_function_privilege('anon','private.find_eligible_packages_with_answers(uuid,text,text,text,uuid,jsonb)','EXECUTE'),'answer-aware eligibility is not public');
select ok(not has_function_privilege('authenticated','private.find_eligible_packages_with_answers(uuid,text,text,text,uuid,jsonb)','EXECUTE'),'answer-aware eligibility is not callable by sessions');
select ok(not has_function_privilege('authenticated','private.intake_package_questions(uuid)','EXECUTE'),'question helper is private');
select ok(not has_function_privilege('authenticated','private.intake_offering_scope(uuid,uuid)','EXECUTE'),'scope helper is private');
select is((select provolatile::text from pg_proc where oid='public.preview_service_request_selections(jsonb)'::regprocedure),'s','preview is declared STABLE, so it cannot write');
select is((select prosecdef from pg_proc where oid='public.preview_service_request_selections(jsonb)'::regprocedure),true,'preview runs with fixed definer privileges');
select is((select proconfig from pg_proc where oid='public.preview_service_request_selections(jsonb)'::regprocedure),array['search_path=""'],'preview has an empty search_path');

-- Input validation mirrors the command.
select throws_ok($$select pg_temp.preview('[]')$$,'22023','Invalid preview','non-object refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]','quote'))$$,'22023','Invalid preview stage','unknown stage refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('3390','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))$$,'22023','Enter a valid five-digit ZIP code','invalid ZIP refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[]'))$$,'22023','Choose between 1 and 20 services','empty plan refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"},{"service_id":"lawn-mowing","frequency":"one-time"}]'))$$,'22023','Each service can be selected once','duplicate selection refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"fortnightly"}]'))$$,'22023','Invalid service frequency','unknown frequency refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","tier_id":"d6650000-0000-4000-8000-000000000001"}]'))$$,'22023','A tier requires its offering','tier without offering refused');
select throws_ok($$select pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","answers":{"a":{"nested":1}}}]'))$$,'22023','Invalid qualifying answers','structured answers refused');

-- Coverage: exact ZIP, never city wording.
select is(pg_temp.preview(pg_temp.plan('00062','[{"service_id":"lawn-mowing","frequency":"one-time"}]')),
  '{"stage": "final", "coverage": "uncovered", "outcomes": []}'::jsonb,'absent ZIP is uncovered with no outcomes');
select is(pg_temp.preview(pg_temp.plan('00061','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))->>'coverage','waitlist','inactive waitlist ZIP is waitlist');
select is(pg_temp.preview(pg_temp.plan('00060-1234','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))->>'coverage','covered','ZIP+4 uses its five-digit ZIP');
select is(pg_temp.preview(jsonb_set(pg_temp.plan('00062','[{"service_id":"lawn-mowing","frequency":"one-time"}]'),'{location,city}','"Cape Coral"'))->>'coverage','uncovered','a Lee County city name cannot cover an uncovered ZIP');
select is((select array_agg(pg_temp.preview(pg_temp.plan(zip,'[{"service_id":"pool-service","frequency":"one-time"}]'))->>'coverage' order by zip) from unnest(array['33917','33921','33936','34134']) zip),
  array['covered','covered','covered','covered'],'split Lee County ZIPs 33917/33921/33936/34134 are covered in full');
select is((select array_agg(pg_temp.preview(pg_temp.plan(zip,'[{"service_id":"pool-service","frequency":"one-time"}]'))->>'coverage' order by zip) from unnest(array['33955','34110','34119']) zip),
  array['uncovered','uncovered','uncovered'],'neighboring-county ZIPs 33955/34110/34119 are excluded');
select is(pg_temp.preview(pg_temp.plan('33917','[{"service_id":"pool-service","frequency":"one-time"}]'))#>>'{outcomes,0,outcome}','eligible_fixed','covered boundary ZIP with eligible supply is bookable');
select is(pg_temp.preview(pg_temp.plan('33921','[{"service_id":"pool-service","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','no_eligible_provider','covered boundary ZIP without supply is unavailable');
select is(pg_temp.preview(pg_temp.plan('34110','[{"service_id":"pool-service","frequency":"one-time"}]'))->'outcomes','[]'::jsonb,'supply in an excluded ZIP does not make it bookable');

-- Per-service outcomes at the covered ZIP.
select is((pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))#>'{outcomes,0}') - 'question_details' - 'scope',
  '{"tier_id": "d6650000-0000-4000-8000-000000000001", "total": 100, "outcome": "eligible_fixed", "promotion": false, "from_total": null, "package_id": "d6640000-0000-4000-8000-000000000001", "service_id": "lawn-mowing", "pricing_mode": "fixed", "offering_mode": "fixed", "selection_index": 0, "depends_on_answers": false}'::jsonb,
  'fixed price is the local provider-backed tier, not the cheaper out-of-area tier');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))#>'{outcomes,0,scope}',
  '{"tier_name": "Synthetic basic", "package_name": "Synthetic fixed", "tier_includes": ["Synthetic edge"], "package_description": "Synthetic scope"}'::jsonb,'offering scope is returned for review');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"house-cleaning","frequency":"monthly"}]'))#>>'{outcomes,0,offering_mode}','custom_quote','unbound quote supply previews as custom_quote');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"house-cleaning","frequency":"monthly","package_id":"d6640000-0000-4000-8000-000000000002"}]'))#>>'{outcomes,0,offering_mode}','deposit_quote','explicit deposit offering keeps its mode');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"general-home-service","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','service_not_offered','Something Else is unavailable (DEC-2026-020)');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"tree-trimming","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','no_eligible_provider','catalog service without local supply is unavailable');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"weekly"}]'))#>>'{outcomes,0,outcome}','unavailable','unsupported frequency is unavailable');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"d6620000-0000-4000-8000-0000000000ff"}]'))#>>'{outcomes,0,outcome}','invalid_provider','unknown provider refused');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"d6620000-0000-4000-8000-000000000002"}]'))#>>'{outcomes,0,outcome}','preferred_provider_unavailable','ineligible selected provider is reported, not replaced');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"d6640000-0000-4000-8000-000000000004"}]'))#>>'{outcomes,0,outcome}','package_unavailable','stale out-of-area offering is reported, not substituted');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"d6640000-0000-4000-8000-000000000001","tier_id":"d6650000-0000-4000-8000-000000000003"}]'))#>>'{outcomes,0,outcome}','invalid_package','tier from another offering refused');

-- Answer-based price levels: availability ignores answers; final evaluates them.
select is((pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time"}]','availability'))#>'{outcomes,0}') - 'question_details' - 'scope' - 'tier_id',
  '{"total": null, "outcome": "eligible_fixed", "promotion": false, "from_total": 80, "package_id": "d6640000-0000-4000-8000-000000000003", "service_id": "shrub-hedge-trimming", "pricing_mode": "fixed", "offering_mode": "fixed", "selection_index": 0, "depends_on_answers": true}'::jsonb,
  'availability shows answer-priced supply as a from amount instead of unavailable');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time"}]','availability'))#>'{outcomes,0,question_details}',
  '[{"unit": null, "options": null, "sort_order": 0, "input_type": "number", "is_required": true, "question_key": "sqft", "question_label": "Synthetic hedge length"}]'::jsonb,'availability returns the questions to ask');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','no_eligible_provider','final without answers matches the command (no rule tier applies)');
select is((pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","package_id":"d6640000-0000-4000-8000-000000000003"}]'))#>'{outcomes,0}') - 'question_details',
  '{"outcome": "answers_required", "questions": ["sqft"], "package_id": "d6640000-0000-4000-8000-000000000003", "service_id": "shrub-hedge-trimming", "selection_index": 0}'::jsonb,'final with a chosen offering lists missing required answers');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","answers":{"sqft":"3000"}}]'))#>>'{outcomes,0,total}','120','final answer selects the matching price level');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","answers":{"sqft":"9000"}}]'))#>>'{outcomes,0,outcome}','unavailable','answer outside every level is unavailable');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]','availability'))#>>'{outcomes,0,total}','100','availability without rule tiers is exact');

-- Promotions (DEC-2026-015): reported so the intake can fail safely.
insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
 values ('d6640000-0000-4000-8000-000000000006','percent_off',50,'Synthetic promotion',now()-interval '1 day',now()+interval '1 day',true);
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"pest-control","frequency":"one-time"}]'))#>>'{outcomes,0,promotion}','true','an effective promotion is flagged');
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))#>>'{outcomes,0,promotion}','false','unpromoted supply is not flagged');

-- No provider identity or scoring leaves the preview.
select ok(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"},{"service_id":"house-cleaning","frequency":"monthly"},{"service_id":"shrub-hedge-trimming","frequency":"one-time"}]','availability'))::text
  !~ '(d6620000|Synthetic (fixed|quote|rule) provider|contractor|score|rank)','preview returns no provider identity, name or ranking');

-- Nothing is written, even for a plan the command would accept.
select is((select count(*) from public.service_requests where zip_code='00060'),0::bigint,'previews created no request');

-- Parity with submit_service_requests for accepted and refused plans.
select ok(pg_temp.parity('synthetic-key-0000006601','00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'),'parity: fixed');
select ok(pg_temp.parity('synthetic-key-0000006602','00060','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"d6640000-0000-4000-8000-000000000001","tier_id":"d6650000-0000-4000-8000-000000000002"}]'),'parity: explicit tier');
select ok(pg_temp.parity('synthetic-key-0000006603','00060','[{"service_id":"house-cleaning","frequency":"monthly"}]'),'parity: unbound quote');
select ok(pg_temp.parity('synthetic-key-0000006604','00060','[{"service_id":"house-cleaning","frequency":"monthly","package_id":"d6640000-0000-4000-8000-000000000002"}]'),'parity: explicit deposit quote');
select ok(pg_temp.parity('synthetic-key-0000006605','00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","answers":{"sqft":"500"}}]'),'parity: answer-priced level');
select ok(pg_temp.parity('synthetic-key-0000006606','00060','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"d6620000-0000-4000-8000-000000000001"}]'),'parity: eligible selected provider');
select ok(pg_temp.parity('synthetic-key-0000006607','00060','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"d6620000-0000-4000-8000-000000000002"}]'),'parity: ineligible selected provider');
select ok(pg_temp.parity('synthetic-key-0000006608','00060','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","package_id":"d6640000-0000-4000-8000-000000000003"}]'),'parity: missing answers');
select ok(pg_temp.parity('synthetic-key-0000006609','00060','[{"service_id":"pest-control","frequency":"one-time"},{"service_id":"house-cleaning","frequency":"monthly"}]'),'parity: multi-service with promotion');
select ok(pg_temp.parity('synthetic-key-0000006610','00060','[{"service_id":"lawn-mowing","frequency":"one-time"},{"service_id":"general-home-service","frequency":"one-time"}]'),'parity: mixed plan refused whole');
select is((select count(*) from public.service_requests where zip_code='00060' and service_catalog_id='general-home-service'),0::bigint,'refused mixed plan created nothing');

-- Onboarding eligibility applies to the preview exactly as to the command.
update public.contractors set is_active=false where id='d6620000-0000-4000-8000-000000000001';
select is(pg_temp.preview(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))#>>'{outcomes,0,outcome}','unavailable','suspended provider no longer backs a preview');
select ok(pg_temp.parity('synthetic-key-0000006611','00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'),'parity: suspended supply');
update public.contractors set is_active=true where id='d6620000-0000-4000-8000-000000000001';

-- The delegating five-argument eligibility function is unchanged for existing callers.
select results_eq($$select contractor_id,package_id,package_tier_id,effective_price,rank_order from private.find_eligible_packages_without_onboarding(null,'shrub-hedge-trimming','one-time','00060',null)$$,
  $$select contractor_id,package_id,package_tier_id,effective_price,rank_order from private.find_eligible_packages_with_answers(null,'shrub-hedge-trimming','one-time','00060',null,'{}'::jsonb)$$,
  'without a request, rules are still evaluated against no answers');
select is((select count(*) from private.find_eligible_packages_without_onboarding(null,'shrub-hedge-trimming','one-time','00060',null)),0::bigint,'answer-only offerings stay hidden from answer-blind callers');
select is((select count(*) from public.find_public_eligible_providers('shrub-hedge-trimming','one-time','00060')),0::bigint,'public provider list is unchanged');
select is((select count(*) from public.find_public_eligible_providers('lawn-mowing','one-time','00060')),1::bigint,'public provider list still finds local fixed supply');
select results_eq($$select package_tier_id,effective_price from private.find_eligible_packages_core((select id from public.service_requests where service_catalog_id='shrub-hedge-trimming' and zip_code='00060' limit 1))$$,
  $$values ('d6650000-0000-4000-8000-000000000003'::uuid,80::numeric)$$,'request-bound eligibility still uses the request answers');

-- Role boundary: the preview needs no role and grants none; submission still requires homeowner.
select is(public.preview_service_request_selections(pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))#>>'{outcomes,0,outcome}','eligible_fixed','preview works without a session');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d6600000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select public.submit_service_requests('synthetic-key-0000006620',pg_temp.plan('00060','[{"service_id":"lawn-mowing","frequency":"one-time"}]') - 'stage')$$,'42501','Homeowner authorization required','vendor-only identity still cannot submit after previewing');
reset role;

select * from finish();
rollback;
