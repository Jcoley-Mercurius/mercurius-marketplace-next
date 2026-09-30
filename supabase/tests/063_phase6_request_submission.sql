-- TRACE-095: authoritative, duplicate-safe request submission. Synthetic identities and
-- synthetic 000xx ZIPs only. The Lee County allowlist and its real boundary ZIPs are covered by 064.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('c1000000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner A"}'),
 ('c1000000-0000-4000-8000-000000000002','{"full_name":"Synthetic homeowner B"}'),
 ('c1000000-0000-4000-8000-000000000003','{"full_name":"Synthetic provider"}'),
 ('c1000000-0000-4000-8000-000000000004','{"full_name":"Synthetic operator"}');
insert into public.user_roles(user_id,role) values
 ('c1000000-0000-4000-8000-000000000003','vendor'),('c1000000-0000-4000-8000-000000000004','admin');

-- 00020 covered, 00021 waitlist, 00022 absent. Provider 5 serves only 00023.
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values
 ('00020','Synthetic covered',true,false),('00021','Synthetic waitlist',false,true),('00023','Synthetic other',true,false);
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','Synthetic fixed provider',true,true),
 ('c2000000-0000-4000-8000-000000000002',null,'Synthetic quote provider',true,true),
 ('c2000000-0000-4000-8000-000000000003',null,'Synthetic rule provider',true,true),
 ('c2000000-0000-4000-8000-000000000004',null,'Synthetic suspended provider',true,true),
 ('c2000000-0000-4000-8000-000000000005',null,'Synthetic distant provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('c2000000-0000-4000-8000-000000000001','00020'),('c2000000-0000-4000-8000-000000000002','00020'),
 ('c2000000-0000-4000-8000-000000000003','00020'),('c2000000-0000-4000-8000-000000000004','00020'),
 ('c2000000-0000-4000-8000-000000000005','00023');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','lawn-mowing','Synthetic fixed','fixed','one-time',true,false),
 ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','house-cleaning','Synthetic deposit quote','deposit_quote','monthly',true,false),
 ('c4000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000003','shrub-hedge-trimming','Synthetic rule','fixed','one-time',true,false),
 ('c4000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000004','mulching-bed-care','Synthetic suspended','fixed','one-time',true,false),
 ('c4000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000005','lawn-mowing','Synthetic cheaper elsewhere','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name,rule_question_key,rule_min,rule_max) values
 ('c5000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','one-time',100,'Synthetic basic',null,null,null),
 ('c5000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000001','one-time',150,'Synthetic plus',null,null,null),
 ('c5000000-0000-4000-8000-000000000003','c4000000-0000-4000-8000-000000000003','one-time',80,'Synthetic small','sqft',0,1000),
 ('c5000000-0000-4000-8000-000000000004','c4000000-0000-4000-8000-000000000003','one-time',120,'Synthetic large','sqft',1001,5000),
 ('c5000000-0000-4000-8000-000000000005','c4000000-0000-4000-8000-000000000004','one-time',70,'Synthetic suspended',null,null,null),
 ('c5000000-0000-4000-8000-000000000006','c4000000-0000-4000-8000-000000000005','one-time',40,'Synthetic distant',null,null,null);
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required,sort_order) values
 ('c4000000-0000-4000-8000-000000000003','sqft','Synthetic hedge length','number',true,0);
update public.services_catalog set is_active=false where id='irrigation-maintenance';

insert into private.r0_lee_zips values ('00020'),('00023');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select u.id,c.zip_code,s.id,u.id
from auth.users u cross join public.coverage_areas c cross join public.services_catalog s
where u.id in ('c1000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002')
  and c.zip_code in ('00020','00023') and s.is_active = true;

create function pg_temp.submit(p_actor uuid, p_key text, p_payload jsonb) returns jsonb language plpgsql as $$
declare r jsonb; begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_actor)::text,true);
  set local role authenticated;
  r := public.submit_service_requests(p_key,p_payload);
  reset role;
  return r;
end $$;
create function pg_temp.plan(p_zip text, p_selections jsonb) returns jsonb language sql as $$
  select jsonb_build_object('location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','fl','zip_code',p_zip),
    'preferred_time','Preferred window: synthetic','selections',p_selections) $$;
create function pg_temp.requests(p_actor uuid) returns bigint language sql as $$
  select count(*) from public.service_requests where customer_id=p_actor $$;

-- Privileges and the closed bypass.
select ok(not has_table_privilege('authenticated','public.service_requests','INSERT'),'authenticated has no direct request INSERT');
select ok(has_table_privilege('service_role','public.service_requests','INSERT'),'trusted service role keeps INSERT');
select ok(not has_function_privilege('anon','public.submit_service_requests(text,jsonb)','EXECUTE'),'anonymous cannot submit');
select ok(has_function_privilege('authenticated','public.submit_service_requests(text,jsonb)','EXECUTE'),'authenticated may submit');
select ok(not has_table_privilege('authenticated','public.service_request_submissions','SELECT'),'submission records are not browser readable');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$insert into public.service_requests(customer_id,service_type,address,status,total_amount,zip_code)
  values('c1000000-0000-4000-8000-000000000001','Forged','x','completed',1,'00022')$$,'42501',null,'homeowner direct insert with forged status/price/ZIP is refused');
select throws_ok($$select * from public.service_request_submissions$$,'42501',null,'homeowner cannot read submission table');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000004"}',true);
select throws_ok($$insert into public.service_requests(customer_id,service_type,address) values('c1000000-0000-4000-8000-000000000004','Admin direct','x')$$,'42501',null,'admin browser session has no direct insert either');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok($$select public.submit_service_requests('synthetic-key-0000000001','{}')$$,'42501','Authentication required','session without a user is refused');
reset role;
set local role anon;
select throws_ok($$select public.submit_service_requests('synthetic-key-0000000001','{}')$$,'42501',null,'anonymous RPC is refused');
reset role;

-- Input validation.
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','short',pg_temp.plan('00020','[]'))$$,'22023','Invalid submission key','malformed key refused');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000002',pg_temp.plan('3390','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))$$,'22023','Enter a valid five-digit ZIP code','invalid ZIP refused');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000003',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time"},{"service_id":"lawn-mowing","frequency":"one-time"}]'))$$,'22023','Each service can be selected once','duplicate selection refused');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000004',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"fortnightly"}]'))$$,'22023','Invalid service frequency','unknown frequency refused');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000005',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"not-a-uuid"}]'))$$,'22023','Invalid provider or offering identifier','malformed provider id refused');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000006',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time"}]') || '{"preferred_date":"2000-01-01"}')$$,'22023','The preferred start date cannot be in the past','past date refused');

-- Coverage boundary: nothing is created outside active coverage.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000010',pg_temp.plan('00022','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))->>'coverage','uncovered','absent ZIP is uncovered');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000011',pg_temp.plan('00021','[{"service_id":"lawn-mowing","frequency":"one-time"}]'))->>'coverage','waitlist','inactive waitlist ZIP is waitlist');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000012',pg_temp.plan('00023','[{"service_id":"house-cleaning","frequency":"monthly"}]'))#>>'{outcomes,0,outcome}','unavailable','covered ZIP without provider supply is unavailable');
select is(pg_temp.requests('c1000000-0000-4000-8000-000000000001'),0::bigint,'uncovered, waitlist and unavailable outcomes create no request');

-- Eligible fixed: server-derived provider-backed price in this ZIP, not the cheaper out-of-area tier.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000020',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}}]'))->>'status','submitted','eligible fixed submission accepted');
select results_eq($$select customer_id,service_type,zip_code,state,status::text,matching_status,pricing_mode,quote_only,total_amount,package_id,package_tier_id,contractor_id
  from public.service_requests where customer_id='c1000000-0000-4000-8000-000000000001'$$,
  $$select 'c1000000-0000-4000-8000-000000000001'::uuid,(select name from public.services_catalog where id='lawn-mowing'),'00020','FL','pending','awaiting_match','fixed',false,100::numeric,
    'c4000000-0000-4000-8000-000000000001'::uuid,'c5000000-0000-4000-8000-000000000001'::uuid,null::uuid$$,
  'fixed request stores server-derived owner, catalog name, mode, tier and amount without assigning a provider');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000021',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":1}}]'))#>'{outcomes,0}',
  '{"total": 100, "outcome": "price_changed", "service_id": "lawn-mowing", "pricing_mode": "fixed", "selection_index": 0}'::jsonb,'tampered total is refused and the current price returned');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000022',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"quote"}}]'))#>>'{outcomes,0,outcome}','price_changed','unseen fixed price is re-shown before submission');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000023',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"c4000000-0000-4000-8000-000000000001","tier_id":"c5000000-0000-4000-8000-000000000002","expected":{"pricing_mode":"fixed","total":150}}]'))#>>'{requests,0,total_amount}','150','explicit eligible tier keeps its own price');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000024',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"c4000000-0000-4000-8000-000000000001","tier_id":"c5000000-0000-4000-8000-000000000003"}]'))#>>'{outcomes,0,outcome}','invalid_package','tier from another offering is refused');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000025',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","package_id":"c4000000-0000-4000-8000-000000000005"}]'))#>>'{outcomes,0,outcome}','package_unavailable','offering outside this ZIP is stale, not substituted');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000026',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"weekly"}]'))#>>'{outcomes,0,outcome}','unavailable','unsupported frequency is unavailable');

-- Eligible quote and pricing mode enforcement.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000030',pg_temp.plan('00020','[{"service_id":"house-cleaning","frequency":"monthly","expected":{"pricing_mode":"quote"}}]'))#>>'{outcomes,0,outcome}','eligible_quote','quote-only supply accepted as quote');
select results_eq($$select pricing_mode,quote_only,total_amount,package_id from public.service_requests where service_catalog_id='house-cleaning' and customer_id='c1000000-0000-4000-8000-000000000001'$$,
  $$select 'custom_quote'::text,true,null::numeric,null::uuid$$,'quote without a chosen offering is custom_quote with no amount');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000031',pg_temp.plan('00020','[{"service_id":"house-cleaning","frequency":"monthly","package_id":"c4000000-0000-4000-8000-000000000002","expected":{"pricing_mode":"fixed","total":5}}]'))#>>'{outcomes,0,outcome}','price_changed','quote offering cannot be submitted as a client-priced fixed request');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000032',pg_temp.plan('00020','[{"service_id":"house-cleaning","frequency":"monthly","package_id":"c4000000-0000-4000-8000-000000000002","expected":{"pricing_mode":"quote"}}]'))#>>'{requests,0,pricing_mode}','deposit_quote','chosen quote offering keeps its own pricing mode');

-- Catalog, provider and answer validation.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000040',pg_temp.plan('00020','[{"service_id":"irrigation-maintenance","frequency":"quarterly"}]'))#>>'{outcomes,0,reason}','service_not_offered','inactive catalog service is unavailable');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000041',pg_temp.plan('00020','[{"service_id":"general-home-service","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','service_not_offered','uncataloged Something Else creates no request (DEC-2026-020)');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000042',pg_temp.plan('00020','[{"service_id":"tree-trimming","frequency":"one-time"}]'))#>>'{outcomes,0,reason}','no_eligible_provider','catalog service without eligible supply is unavailable');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000043',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"c2000000-0000-4000-8000-0000000000ff"}]'))#>>'{outcomes,0,outcome}','invalid_provider','unknown provider refused');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000044',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"c2000000-0000-4000-8000-000000000002"}]'))#>>'{outcomes,0,outcome}','preferred_provider_unavailable','ineligible selected provider is explained, never silently replaced');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000045',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"c2000000-0000-4000-8000-000000000002","package_id":"c4000000-0000-4000-8000-000000000001"}]'))#>>'{outcomes,0,outcome}','invalid_package','offering of a different provider refused');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000046',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","preferred_contractor_id":"c2000000-0000-4000-8000-000000000001","expected":{"pricing_mode":"fixed","total":100}}]'))->>'status','submitted','eligible selected provider accepted');
select is((select preferred_contractor_id from public.service_requests where customer_id='c1000000-0000-4000-8000-000000000002' and service_catalog_id='lawn-mowing'),'c2000000-0000-4000-8000-000000000001'::uuid,'eligible selected provider is preserved for the first offer');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000047',pg_temp.plan('00020','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","package_id":"c4000000-0000-4000-8000-000000000003"}]'))#>'{outcomes,0}',
  '{"outcome": "answers_required", "questions": ["sqft"], "service_id": "shrub-hedge-trimming", "selection_index": 0}'::jsonb,'required qualifying answer is requested');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000048',pg_temp.plan('00020','[{"service_id":"shrub-hedge-trimming","frequency":"one-time","answers":{"sqft":"3000","forged":"x"},"expected":{"pricing_mode":"fixed","total":120}}]'))#>>'{requests,0,package_tier_id}','c5000000-0000-4000-8000-000000000004','qualifying answer selects the matching rule tier');
select is((select package_question_answers from public.service_requests where package_tier_id='c5000000-0000-4000-8000-000000000004'),
  '{"sqft": {"unit": null, "answer": "3000", "question": "Synthetic hedge length"}}'::jsonb,'answer snapshot uses stored labels and drops unknown keys');

-- Mixed plans are all or nothing (DEC-2026-020).
select is(pg_temp.requests('c1000000-0000-4000-8000-000000000002'),2::bigint,'homeowner B baseline');
select is(jsonb_path_query_array(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000050',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}},{"service_id":"tree-trimming","frequency":"one-time"}]')),'$.outcomes[*].outcome'),
  '["eligible_fixed", "unavailable"]'::jsonb,'mixed plan reports each selection');
select is(pg_temp.requests('c1000000-0000-4000-8000-000000000002'),2::bigint,'mixed plan creates no request');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000050',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}}]'))->>'reused','false','a refused key stores nothing, so the corrected plan can reuse it');

-- Retry identity: same actor/key/payload replays; changed payload is refused; keys are per actor.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000060',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}},{"service_id":"house-cleaning","frequency":"monthly","expected":{"pricing_mode":"quote"}}]'))->>'reused','false','multi-service plan submitted');
select is((select count(*) from public.service_request_submission_items item join public.service_request_submissions s on s.id=item.submission_id where s.submission_key='synthetic-key-0000000060'),2::bigint,'exactly one request per selection');
select is((select count(distinct item.service_request_id) from public.service_request_submission_items item join public.service_request_submissions s on s.id=item.submission_id where s.submission_key='synthetic-key-0000000060'),2::bigint,'selections create distinct requests');
select is(pg_temp.requests('c1000000-0000-4000-8000-000000000001'),6::bigint,'homeowner A request count before replay');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000060',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}},{"service_id":"house-cleaning","frequency":"monthly","expected":{"pricing_mode":"quote"}}]'))->'requests',
  (select result->'requests' from public.service_request_submissions where submission_key='synthetic-key-0000000060'),'replay returns the same requests');
select is(pg_temp.requests('c1000000-0000-4000-8000-000000000001'),6::bigint,'replay creates nothing');
select throws_ok($$select pg_temp.submit('c1000000-0000-4000-8000-000000000001','synthetic-key-0000000060',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}}]'))$$,
  '22023','Submission key reused with a different request','changed payload cannot silently reuse a key');
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000060',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}},{"service_id":"house-cleaning","frequency":"monthly","expected":{"pricing_mode":"quote"}}]'))->>'reused','false','the same key is independent per homeowner');

-- Current eligibility at submission: suspension and onboarding review remove supply.
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000070',pg_temp.plan('00020','[{"service_id":"mulching-bed-care","frequency":"one-time","expected":{"pricing_mode":"fixed","total":70}}]'))->>'status','submitted','active provider supply accepted');
update public.contractors set is_active=false where id='c2000000-0000-4000-8000-000000000004';
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000071',pg_temp.plan('00020','[{"service_id":"mulching-bed-care","frequency":"one-time","expected":{"pricing_mode":"fixed","total":70}}]'))#>>'{outcomes,0,outcome}','unavailable','suspended provider no longer backs a submission');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('c3000000-0000-4000-8000-000000000001','Synthetic fixed provider','Test','Provider','provider@example.invalid','synthetic','c2000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000004"}',true);
select public.vendor_begin_review('c2000000-0000-4000-8000-000000000001',
 (select id from public.vendor_application_versions where application_id='c3000000-0000-4000-8000-000000000001'));
select is(pg_temp.submit('c1000000-0000-4000-8000-000000000002','synthetic-key-0000000072',pg_temp.plan('00020','[{"service_id":"lawn-mowing","frequency":"one-time","expected":{"pricing_mode":"fixed","total":100}}]'))#>>'{outcomes,0,outcome}','unavailable','provider returned to onboarding review (TRACE-060) no longer backs a submission');

-- Created requests keep existing ownership, update scope and continuation paths.
create temp table a_request as select id from public.service_requests where customer_id='c1000000-0000-4000-8000-000000000001' limit 1;
grant select on a_request to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$update public.service_requests set zip_code='00022' where customer_id='c1000000-0000-4000-8000-000000000001'$$,'42501',null,'homeowner cannot move a pending request to another ZIP');
select lives_ok($$update public.service_requests set address='2 Synthetic Way' where customer_id='c1000000-0000-4000-8000-000000000001'$$,'homeowner may still correct the street address');
select lives_ok($$select public.start_request_matching(id) from public.service_requests where service_catalog_id='house-cleaning' and customer_id='c1000000-0000-4000-8000-000000000001'$$,'homeowner can start matching for a submitted quote request');
select lives_ok($$insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type)
  select id,'c1000000-0000-4000-8000-000000000001','homeowner','c1000000-0000-4000-8000-000000000001/'||id||'/intake-synthetic.png','evidence'
  from public.service_requests where customer_id='c1000000-0000-4000-8000-000000000001' limit 1$$,'homeowner can attach intake photos to a submitted request');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1000000-0000-4000-8000-000000000002"}',true);
select is((select count(*) from public.service_requests where customer_id='c1000000-0000-4000-8000-000000000001'),0::bigint,'homeowner B cannot read A requests');
select throws_ok($$insert into public.job_photos(service_request_id,uploaded_by,uploader_role,photo_url,photo_type)
  select id,'c1000000-0000-4000-8000-000000000002','homeowner','x','evidence' from a_request$$,'42501',null,'photos cannot be attached to a request the homeowner does not own');
reset role;
select is((select count(*) from public.job_match_attempts attempt join public.service_requests r on r.id=attempt.service_request_id
  where r.customer_id='c1000000-0000-4000-8000-000000000001' and attempt.contractor_id='c2000000-0000-4000-8000-000000000002' and attempt.outcome='pending'),2::bigint,'each submitted quote request offers the eligible provider');

select * from finish();
rollback;
