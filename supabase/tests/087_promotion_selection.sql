-- TRACE-116 (20261018006000, DEC-2026-042). Synthetic fixtures only; amounts are test examples.
-- Explicit offer selection at intake and after submission, server-side reservation with the
-- request, matching bound to the priced selection, the homeowner's confirmation at checkout,
-- the unpaid-reservation sweep, recurring visits with add-ons and idempotent approval sends.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- TRACE-134 (6.11A): a price version that is live or in use is not edited in place on any path.
-- Edits below that the guard refuses are applied under owner maintenance (version guards disabled for
-- that statement) so this file keeps characterizing what an in-place change would do (TRACE-126/127).
create function pg_temp.edit_in_place(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    return 'applied';
  exception when sqlstate '55000' then null;
  end;
  alter table public.vendor_packages disable trigger trg_vendor_package_version_guard;
  alter table public.package_tiers disable trigger trg_package_tiers_version_guard;
  alter table public.package_addons disable trigger trg_package_addons_version_guard;
  alter table public.package_qualifying_questions disable trigger trg_package_questions_version_guard;
  execute p_sql;
  alter table public.vendor_packages enable trigger trg_vendor_package_version_guard;
  alter table public.package_tiers enable trigger trg_package_tiers_version_guard;
  alter table public.package_addons enable trigger trg_package_addons_version_guard;
  alter table public.package_qualifying_questions enable trigger trg_package_questions_version_guard;
  return 'refused';
end $f$;

-- Users: 1 homeowner (first booking), 2 homeowner with a completed service, 3 vendor A account,
-- 4 and 5 finance operators (two-person review), 6-9 homeowners.
insert into auth.users(id,email) select ('b8710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'selection-'||n||'@example.invalid'
  from generate_series(1,9) n;
delete from public.user_roles where user_id in ('b8710000-0000-4000-8000-000000000003','b8710000-0000-4000-8000-000000000004','b8710000-0000-4000-8000-000000000005');
insert into public.user_roles(user_id,role) values ('b8710000-0000-4000-8000-000000000003','vendor'),
  ('b8710000-0000-4000-8000-000000000004','admin'),('b8710000-0000-4000-8000-000000000005','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('b8710000-0000-4000-8000-000000000004','b8710000-0000-4000-8000-000000000005','Synthetic'),
 ('b8710000-0000-4000-8000-000000000005','b8710000-0000-4000-8000-000000000004','Synthetic');

insert into public.service_categories(id,name) values ('synthetic-selection-cat','Synthetic selection');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-sel-cans','Synthetic selection cans','synthetic-selection-cat',60,30,'one-time','{one-time,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00087','Synthetic',true,false);
insert into private.r0_lee_zips values ('00087');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('b8710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00087','synthetic-sel-cans','b8710000-0000-4000-8000-000000000004'
  from unnest(array[1,2,6,7,8,9]) n;
-- Vendor A is bound to account 3; vendor B is cheaper and unbound.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8720000-0000-4000-8000-000000000001','Synthetic selection vendor A',true,true,'b8710000-0000-4000-8000-000000000003'),
 ('b8720000-0000-4000-8000-000000000002','Synthetic selection vendor B',true,true,null);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('b8720000-0000-4000-8000-000000000001','00087'),('b8720000-0000-4000-8000-000000000002','00087');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('b8740000-0000-4000-8000-000000000001','b8720000-0000-4000-8000-000000000001','synthetic-sel-cans','Synthetic A cans','fixed','one-time',true,false),
 ('b8740000-0000-4000-8000-000000000002','b8720000-0000-4000-8000-000000000002','synthetic-sel-cans','Synthetic B cans','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('b8750000-0000-4000-8000-000000000001','b8740000-0000-4000-8000-000000000001','One-time',50,'one-time',0,'[]'),
 ('b8750000-0000-4000-8000-000000000002','b8740000-0000-4000-8000-000000000001','Monthly',30,'monthly',1,'[]'),
 ('b8750000-0000-4000-8000-000000000003','b8740000-0000-4000-8000-000000000002','One-time',40,'one-time',0,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('b8760000-0000-4000-8000-000000000001','b8740000-0000-4000-8000-000000000001','Extra can (one-time)',15,'exact','can',0,6,false,'{one-time}',0),
 ('b8760000-0000-4000-8000-000000000002','b8740000-0000-4000-8000-000000000001','Extra can (monthly)',10,'exact','can',0,6,false,'{monthly}',1);
-- Homeowner 2 has a completed Marketplace service.
insert into public.service_requests(customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,status)
  values ('b8710000-0000-4000-8000-000000000002','b8720000-0000-4000-8000-000000000002','Synthetic','synthetic-sel-cans','1 Synthetic Way','Synthetic','FL','00087','one-time','completed');

-- Offers, approved for their exact revision.
create function pg_temp.offer(p_id uuid, p_funding text, p_contractor uuid, p_kind text, p_amount bigint, p_bps integer, p_code text,
  p_first boolean, p_label text) returns void language plpgsql as $$
declare o private.promotion_offers;
begin
  insert into private.promotion_offers(id,status,funding,contractor_id,kind,amount_cents,percent_bps,code_hash,first_booking_only,label,terms,
      starts_at,ends_at,budget_cents,content_hash,created_by,updated_by)
    values (p_id,'draft',p_funding,p_contractor,p_kind,p_amount,p_bps,private.promotion_code_hash(p_code),p_first,p_label,'Synthetic terms',
      now()-interval '1 day',now()+interval '30 days',case when p_funding='platform' then 100000 end,'pending',
      'b8710000-0000-4000-8000-000000000004','b8710000-0000-4000-8000-000000000004') returning * into o;
  update private.promotion_offers set content_hash=private.promotion_offer_hash(o), status='approved',
    vendor_approved_hash=case when p_funding='vendor' then private.promotion_offer_hash(o) end,
    authorized_hash=case when p_funding='platform' then private.promotion_offer_hash(o) end where id=p_id;
end $$;
select pg_temp.offer('b8770000-0000-4000-8000-000000000001','platform',null,'amount',1000,null,null,false,'Synthetic $10 off');
select pg_temp.offer('b8770000-0000-4000-8000-000000000002','vendor','b8720000-0000-4000-8000-000000000001','percent',null,2000,null,false,'Synthetic 20% off');
select pg_temp.offer('b8770000-0000-4000-8000-000000000003','platform',null,'amount',500,null,'SAVE-SEL5',false,'Synthetic code offer');
select pg_temp.offer('b8770000-0000-4000-8000-000000000004','platform',null,'amount',1200,null,null,true,'Synthetic welcome');

create temp table fx(key text primary key, id uuid);
grant all on fx to authenticated, anon;
create function pg_temp.o(n integer) returns uuid language sql as $$ select ('b8770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('b8710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.fp(n integer) returns text language sql as $$ select content_hash from private.promotion_offers where id=pg_temp.o(n) $$;
create function pg_temp.plan(p_selections jsonb) returns jsonb language sql as $$
  select jsonb_build_object('location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00087'),
    'preferred_time','Synthetic window','selections',p_selections) $$;
-- Vendor A's one-time cans with n extra cans, optionally with a chosen offer.
create function pg_temp.sel(p_cans integer, p_promo jsonb default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('service_id','synthetic-sel-cans','frequency','one-time',
    'package_id','b8740000-0000-4000-8000-000000000001','tier_id','b8750000-0000-4000-8000-000000000001',
    'preferred_contractor_id','b8720000-0000-4000-8000-000000000001',
    'addons',case when p_cans>0 then jsonb_build_array(jsonb_build_object('id','b8760000-0000-4000-8000-000000000001','quantity',p_cans)) end,
    'expected',jsonb_build_object('pricing_mode','fixed','total',50+15*p_cans),'promotion',p_promo)) $$;
create function pg_temp.promo(n integer, p_discount bigint, p_code text default null, p_fp integer default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('offer_id',pg_temp.o(n),'fingerprint',pg_temp.fp(coalesce(p_fp,n)),'expected_discount_cents',p_discount,'code',p_code)) $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;
create function pg_temp.options(p_user integer, p_selections jsonb, p_codes jsonb default '{}') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_promotion_options(%L::jsonb)', pg_temp.plan(p_selections) || jsonb_build_object('codes',p_codes))) $$;
create function pg_temp.submit(p_user integer, p_key text, p_selections jsonb) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, pg_temp.plan(p_selections))) $$;
create function pg_temp.state(p_user integer, p_request uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_request_promotion(%L)', p_request)) $$;
create function pg_temp.choose(p_user integer, p_request uuid, p_offer uuid, p_code text, p_expected bigint, p_key text) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_choose_request_promotion(%L,%L,%L,%L,%s,%L)', p_request, p_offer,
    (select content_hash from private.promotion_offers where id=p_offer), p_code, p_expected, p_key)) $$;
create function pg_temp.active(p_request uuid) returns text language sql as $$
  select coalesce((select o.label||':'||x.status from private.promotion_redemptions x join private.promotion_offers o on o.id=x.offer_id
    where x.service_request_id=p_request and x.status in ('reserved','finalized')), 'none') $$;
create function pg_temp.ids(p jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg((select label from private.promotion_offers where id=(e->>'offer_id')::uuid) order by ord), '[]'::jsonb)
  from jsonb_array_elements(p) with ordinality as t(e, ord) $$;
create function pg_temp.terms(p_request uuid, p_discount bigint, p_promo text) returns jsonb language sql as $$ select jsonb_build_object(
 'service',(private.money_source(p_request)->>'service')::bigint,'addons',coalesce((private.money_source(p_request)->>'addons')::bigint,0),
 'discount',p_discount,'adjustment',0,
 'subtotal',(private.money_source(p_request)->>'service')::bigint+coalesce((private.money_source(p_request)->>'addons')::bigint,0)-p_discount,
 'tax',0,'tip',0,'deposit',0,
 'total',(private.money_source(p_request)->>'service')::bigint+coalesce((private.money_source(p_request)->>'addons')::bigint,0)-p_discount,
 'currency','usd','source_version',private.money_source(p_request)->>'version','policy_version','CFG-005/DEC-2026-038','tax_evidence','synthetic-tax-decision',
 'promotion_terms',p_promo,'reason','Synthetic reviewed source','expires_at',now()+interval '1 day') $$;
create function pg_temp.publish(p_request uuid, p_terms jsonb) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"b8710000-0000-4000-8000-000000000005"}',true);
 perform public.money_approve_review('b8710000-0000-4000-8000-000000000004',jsonb_build_object('operation','snapshot','request',p_request,'terms',p_terms),'Synthetic second review');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 return public.money_publish_snapshot(p_request,p_terms,'b8710000-0000-4000-8000-000000000004','b8710000-0000-4000-8000-000000000005');
end $$;
create function pg_temp.match(p_request uuid) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;

-- Grants and the gate ---------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.homeowner_promotion_options(jsonb)','execute')
  and not has_function_privilege('anon','public.homeowner_promotion_options(jsonb)','execute'), 'offers are listed to signed-in callers only');
select ok(not has_function_privilege('authenticated','private.run_promotion_release_sweep()','execute')
  and not has_function_privilege('service_role','private.run_promotion_release_sweep()','execute'), 'the sweep is not callable by any client role');
select ok(not has_table_privilege('authenticated','private.promotion_selections','select'), 'the homeowner choice record is private');
select throws_ok($$select pg_temp.call(3, 'select public.homeowner_promotion_options(''{}''::jsonb)')$$, '42501',
  'Homeowner authorization required', 'a vendor account cannot list homeowner offers');
select is(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)))->>'available', 'false', 'with the promotions gate closed no offer is shown');
select throws_ok($$select pg_temp.submit(1,'sel-closed-000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(1,1000))))$$, '22023',
  'Offers are not available yet. Remove the offer and submit again', 'with the gate closed an offer cannot be submitted');
update private.money_feature_gates set enabled=true, reason='Synthetic test' where name='promotions_checkout';

-- Displayed offers ---------------------------------------------------------------------------------------
-- $50 + two $15 cans = $80. 20% (vendor A) = $16; welcome (first booking) = $12; $10 off; the code offer is hidden.
insert into fx(key,id) values ('dummy', null);
select is((pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)))#>>'{selections,0,service_cents}')::bigint, 8000::bigint,
  'savings are computed on the selection with its add-ons');
select is(pg_temp.ids(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)))#>'{selections,0,options}'),
  '["Synthetic 20% off", "Synthetic welcome", "Synthetic $10 off"]'::jsonb, 'eligible public offers, greatest saving first; the code-only offer is not listed');
select is(jsonb_path_query_array(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2))), '$.selections[0].options[*].discount_cents'),
  '[1600, 1200, 1000]'::jsonb, 'each offer shows its actual saving on this selection');
select is(jsonb_path_query_array(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2))), '$.selections[0].options[*].total_after_cents'),
  '[6400, 6800, 7000]'::jsonb, 'and the total after it');
select is(jsonb_path_query_array(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2))), '$.selections[0].options[*].best'),
  '[true, false, false]'::jsonb, 'only the greatest saving is labelled; nothing is selected');
select is(pg_temp.ids(pg_temp.options(2, jsonb_build_array(pg_temp.sel(2)))#>'{selections,0,options}'),
  '["Synthetic 20% off", "Synthetic $10 off"]'::jsonb, 'a homeowner with a completed service is not offered the first-booking offer');
select is(pg_temp.ids(pg_temp.options(1, jsonb_build_array(jsonb_build_object('service_id','synthetic-sel-cans','frequency','one-time',
    'package_id','b8740000-0000-4000-8000-000000000002','tier_id','b8750000-0000-4000-8000-000000000003',
    'preferred_contractor_id','b8720000-0000-4000-8000-000000000002')))#>'{selections,0,options}'),
  '["Synthetic welcome", "Synthetic $10 off"]'::jsonb, 'another vendor''s offering is not offered vendor A''s funded offer');
select pg_temp.offer('b8770000-0000-4000-8000-000000000005','platform',null,'amount',1600,null,null,false,'Synthetic tie');
select is(jsonb_path_query_array(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2))), '$.selections[0].options[*].best'),
  '[true, true, false, false]'::jsonb, 'equal greatest savings are both labelled');
update private.promotion_offers set status='retired', retired_at=now(), retired_by=pg_temp.u(4), retire_reason='Synthetic' where id=pg_temp.o(5);
select is(jsonb_array_length(pg_temp.options(1, jsonb_build_array(pg_temp.sel(0)))#>'{selections,0,options}'), 3,
  'a retired offer is no longer listed');

-- Codes -----------------------------------------------------------------------------------------------------
select is(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)), '{"0":"save-sel5"}')#>'{selections,0,code}',
  jsonb_build_object('status','eligible','offer_id',pg_temp.o(3)), 'an entered code finds its offer (case does not matter)');
select ok(pg_temp.ids(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)), '{"0":"SAVE-SEL5"}')#>'{selections,0,options}') ? 'Synthetic code offer',
  'the code offer is listed with its saving once its code is entered');
select is(pg_temp.options(1, jsonb_build_array(pg_temp.sel(2)), '{"0":"NOPE-0000"}')#>>'{selections,0,code,status}', 'not_found',
  'an unknown code says only that it was not found');
select is((select count(*) from generate_series(1,10) n where pg_temp.options(6, jsonb_build_array(pg_temp.sel(0)),
  jsonb_build_object('0','WRONG-'||n))#>>'{selections,0,code,status}' = 'not_found'), 10::bigint, 'ten unknown codes');
select is(pg_temp.options(6, jsonb_build_array(pg_temp.sel(0)), '{"0":"SAVE-SEL5"}')#>>'{selections,0,code,status}', 'too_many_attempts',
  'after ten unknown codes in an hour no code is checked, even a valid one');

-- Submission -------------------------------------------------------------------------------------------------
select throws_ok($$select pg_temp.submit(1,'sel-addons-00000001',jsonb_build_array(jsonb_build_object('service_id','synthetic-sel-cans','frequency','one-time',
    'addons',jsonb_build_array(jsonb_build_object('id','b8760000-0000-4000-8000-000000000001','quantity',1)),'expected',jsonb_build_object('pricing_mode','quote'))))$$,
  '22023', 'Add-ons can be chosen only with a specific provider''s offering. Choose an offering or remove the add-ons',
  'add-ons without a chosen offering are refused, not handed to an automatically matched provider');
select is((pg_temp.submit(1,'sel-wrong-000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(2,1500))))#>'{outcomes,0}') - 'total' - 'service_id',
  '{"reason": "discount_changed", "outcome": "promotion_changed", "pricing_mode": "fixed", "selection_index": 0}'::jsonb,
  'a saving different from what was shown refuses the whole submission');
select is(pg_temp.submit(1,'sel-stale-000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(1,1000,null,2))))#>>'{outcomes,0,reason}', 'offer_changed',
  'an offer revision different from what was shown is refused');
select is(pg_temp.submit(1,'sel-code-0000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(3,500))))#>>'{outcomes,0,reason}', 'code_required',
  'a code offer without its code is refused');
select is(pg_temp.submit(1,'sel-none-0000000001',jsonb_build_array(pg_temp.sel(2, jsonb_build_object('offer_id','b8770000-0000-4000-8000-0000000000ff',
  'fingerprint',pg_temp.fp(1),'expected_discount_cents',1000))))#>>'{outcomes,0,reason}', 'offer_unavailable', 'an unknown offer is refused');
select is((select count(*) from public.service_requests where customer_id=pg_temp.u(1)), 0::bigint, 'a refused submission leaves no request behind');
select is((select count(*) from private.promotion_redemptions where customer_id=pg_temp.u(1)), 0::bigint, 'and no reservation');

insert into fx(key,id) select 'r1', (r#>>'{requests,0,request_id}')::uuid
  from (select pg_temp.submit(1,'sel-r1-000000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(2,1600)))) r) s where r->>'status'='submitted';
select isnt((select id from fx where key='r1'), null, 'a homeowner submits vendor A''s 20% offer they chose');
select is((select row(x.status, x.contractor_id=c.id, x.eligible_cents, x.discount_cents, x.commission_rate_bps, x.commission_base_cents,
    x.commission_cents, x.vendor_proceeds_cents, x.platform_subsidy_cents)::text
  from private.promotion_redemptions x, public.contractors c where x.service_request_id=(select id from fx where key='r1') and c.id='b8720000-0000-4000-8000-000000000001'),
  '(reserved,t,8000,1600,750,6400,480,5920,0)', 'reserved with the request for the priced provider: vendor-funded, 7.5% of the discounted $64');
select is((select row(state, confirmed_service_cents)::text from private.promotion_selections where service_request_id=(select id from fx where key='r1')),
  '(applied,6400)', 'the homeowner''s choice and confirmed amount are recorded');
select is(pg_temp.submit(1,'sel-r1-000000000001',jsonb_build_array(pg_temp.sel(2, pg_temp.promo(2,1600))))->>'reused', 'true', 'a retried submission is replayed');
select is((select count(*) from private.promotion_redemptions where customer_id=pg_temp.u(1)), 1::bigint, 'with one reservation');

insert into fx(key,id) select 'r2', (pg_temp.submit(1,'sel-r2-000000000001',jsonb_build_array(pg_temp.sel(0, pg_temp.promo(4,1200))))#>>'{requests,0,request_id}')::uuid;
select is(pg_temp.active((select id from fx where key='r2')), 'Synthetic welcome:reserved', 'the first-booking offer is reserved for a second request');
select is(pg_temp.submit(1,'sel-r2b-00000000001',jsonb_build_array(pg_temp.sel(1, pg_temp.promo(4,1200))))#>>'{outcomes,0,reason}', 'first_booking_already_reserved',
  'one first-booking reservation per homeowner');
insert into fx(key,id) select 'r5', (pg_temp.submit(6,'sel-r5-000000000001',jsonb_build_array(pg_temp.sel(0, pg_temp.promo(1,1000))))#>>'{requests,0,request_id}')::uuid;
insert into fx(key,id) select 'r0', (pg_temp.submit(7,'sel-r0-000000000001',jsonb_build_array(jsonb_build_object('service_id','synthetic-sel-cans',
  'frequency','one-time','expected',jsonb_build_object('pricing_mode','fixed','total',40))))#>>'{requests,0,request_id}')::uuid;

-- Matching keeps the priced selection --------------------------------------------------------------------------
select is((select count(*) from private.find_eligible_packages_core((select id from fx where key='r0'))), 2::bigint,
  'an ordinary automatically matched request still has every eligible provider');
select is((select string_agg(contractor_id::text||':'||effective_price::numeric(10,2), ',') from private.find_eligible_packages_core((select id from fx where key='r1'))),
  'b8720000-0000-4000-8000-000000000001:80.00', 'a request with add-ons and an offer has one candidate: its package, at the total with add-ons');
select pg_temp.match((select id from fx where key='r1'));
select is((select row(status, contractor_id, total_amount)::text from public.service_requests where id=(select id from fx where key='r1')),
  '(scheduled,b8720000-0000-4000-8000-000000000001,80.00)', 'matching and acceptance keep the total with add-ons');
select pg_temp.match((select id from fx where key='r5'));

-- After submission: the homeowner sees, replaces or removes the offer ----------------------------------------------
select throws_ok($$select pg_temp.state(2, (select id from fx where key='r1'))$$, 'P0002', 'Request not found', 'another homeowner cannot read it');
select is(pg_temp.state(1, (select id from fx where key='r1')) - 'options' - 'applied' - 'code',
  '{"offers_open": true, "state": "applied", "reason": null, "credits": null, "editable": true, "available": true, "locked_reason": null, "service_cents": 8000, "confirmed_service_cents": 6400}'::jsonb,
  'the homeowner sees the applied offer');
select is(pg_temp.state(1, (select id from fx where key='r1'))#>>'{applied,problem}', null, 'it still applies');
select is(pg_temp.ids(pg_temp.state(1, (select id from fx where key='r1'))->'options'), '["Synthetic $10 off"]'::jsonb,
  'alternatives exclude the applied offer, code offers and the first-booking offer already reserved elsewhere');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(1), null, 7100, 'choose-r1-00000001')->>'reason', 'price_changed',
  'a total different from what the homeowner saw changes nothing');
select is(pg_temp.active((select id from fx where key='r1')), 'Synthetic 20% off:reserved', 'the original offer is kept');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(1), null, 7000, 'choose-r1-00000002')->>'status', 'applied',
  'applying another offer replaces the previous one');
select is(pg_temp.active((select id from fx where key='r1')), 'Synthetic $10 off:reserved', 'one promotion per booking');
select is((select release_reason from private.promotion_redemptions where service_request_id=(select id from fx where key='r1') and offer_id=pg_temp.o(2)),
  'Replaced by the homeowner', 'the replaced reservation is released');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(1), null, 7000, 'choose-r1-00000002')->>'reused', 'true', 'a retried choice changes nothing');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(3), null, 7500, 'choose-r1-00000003')->>'reason', 'code_required',
  'a code offer needs its code');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(3), 'SAVE-SEL5', 7500, 'choose-r1-00000004')->>'status', 'applied',
  'with its code it applies');
select is(pg_temp.choose(1, (select id from fx where key='r1'), null, null, 7500, 'choose-r1-00000005')->>'reason', 'price_changed',
  'continuing without an offer needs the undiscounted total confirmed');
select is(pg_temp.choose(1, (select id from fx where key='r1'), null, null, 8000, 'choose-r1-00000006')->>'status', 'declined',
  'the homeowner continues at $80 without an offer');
select is(pg_temp.active((select id from fx where key='r1')), 'none', 'no offer is reserved');
select is(private.money_source((select id from fx where key='r1')) ? 'promotion', false, 'the checkout source carries no promotion');
select is((private.money_source((select id from fx where key='r1'))->>'addons')::bigint, 3000::bigint, 'and keeps the add-ons');
select is(pg_temp.choose(1, (select id from fx where key='r1'), pg_temp.o(1), null, 7000, 'choose-r1-00000007')->>'status', 'applied', 'the homeowner applies $10 off again');
select is((select string_agg(kind, ',' order by sequence) from private.promotion_selection_events where service_request_id=(select id from fx where key='r1')),
  'applied,replaced,replaced,declined,applied', 'each choice is recorded');

-- Checkout: 7.5% of $80 before a Mercurius-funded discount, the subsidy apart ---------------------------------------
select is((select row(s->'promotion'->>'funding', s->>'discount', s->'promotion'->>'commission_base_cents', s->'promotion'->>'commission_cents',
    s->'promotion'->>'platform_subsidy_cents')::text from (select private.money_source((select id from fx where key='r1')) s) x),
  '(platform,1000,8000,600,1000)', 'the source carries the chosen offer: $6.00 commission on $80, $10 subsidy');
select is(private.promotion_economics(8000, 0, null)->>'commission_cents', '1200', 'an ordinary $80 booking pays 15%: $12.00');
insert into fx(key,id) values ('s1', pg_temp.publish((select id from fx where key='r1'), pg_temp.terms((select id from fx where key='r1'),1000,'Synthetic $10 off: Synthetic terms')));
select is((select row(funding,discount,commission,platform_subsidy)::text from public.money_snapshot_promotions where snapshot_id=(select id from fx where key='s1')),
  '(platform,1000,600,1000)', 'the two-person snapshot records the split');
insert into fx(key,id) values ('s5', pg_temp.publish((select id from fx where key='r5'), pg_temp.terms((select id from fx where key='r5'),1000,'Synthetic $10 off: Synthetic terms')));
insert into fx(key,id) select 'a1', (pg_temp.call(1, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', (select id from fx where key='s1')))->>'id')::uuid;
select is((select amount from public.money_checkout_attempts where id=(select id from fx where key='a1')), 7000::bigint, 'the homeowner checks out $70');
select throws_ok($$select pg_temp.choose(1, (select id from fx where key='r1'), null, null, 8000, 'choose-r1-00000008')$$, '55000',
  'Checkout has started; the offer can no longer change', 'once checkout starts the offer cannot change');

-- Cleanup ------------------------------------------------------------------------------------------------------
-- Request 5's terms expire unpaid (moved back in time for the fixture).
set local session_replication_role = replica;
update public.money_snapshots set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where id=(select id from fx where key='s5');
set local session_replication_role = origin;
select is(private.run_promotion_release_sweep()->>'released', '1', 'the sweep releases the reservation whose terms expired unpaid');
select is((select release_reason from private.promotion_redemptions where service_request_id=(select id from fx where key='r5')), 'Terms expired unpaid', 'with its reason');
select is((select state from private.promotion_selections where service_request_id=(select id from fx where key='r5')), 'needs_homeowner',
  'the homeowner must choose again');
select throws_ok($$select private.money_source((select id from fx where key='r5'))$$, '40001',
  'The homeowner''s offer no longer applies; the homeowner must choose again', 'checkout never falls back to the undiscounted price on its own');
select is(private.run_promotion_release_sweep()->>'released', '0', 'a second run releases nothing');
select is((select count(*) from private.promotion_selection_events where service_request_id=(select id from fx where key='r5') and kind='released'), 1::bigint,
  'the release is recorded once');
select is((select count(*) from private.promotion_sweep_runs where outcome='completed'), 2::bigint, 'each run is logged');

-- Both offers end. Request 2's unpaid reservation is released; request 1's checkout keeps its own.
update private.promotion_offers set ends_at = now() - interval '1 second' where id in (pg_temp.o(1), pg_temp.o(4));
select is(private.run_promotion_release_sweep()->>'released', '1', 'an ended offer is released from the unpaid request');
select is((select release_reason from private.promotion_redemptions where service_request_id=(select id from fx where key='r2')), 'Offer ended before payment', 'with its reason');
select is(pg_temp.active((select id from fx where key='r1')), 'Synthetic $10 off:reserved', 'a checkout in progress keeps its reservation');
select is(pg_temp.state(1, (select id from fx where key='r2'))->>'state', 'needs_homeowner', 'the homeowner sees the offer needs a new choice');
select lives_ok(format($$select public.money_receive_event('evt_sel_r1','capture',jsonb_build_object('attempt_id',%L::uuid,'payment_id','pi_sel_r1','amount',7000,'currency','usd'))$$,
  (select id from fx where key='a1')), 'the capture arrives');
select is(public.money_process_event('evt_sel_r1'), 'processed', 'and is processed');
select is(pg_temp.active((select id from fx where key='r1')), 'Synthetic $10 off:finalized', 'payment commits the reservation after the offer ended');
select is(private.run_promotion_release_sweep()->>'released', '0', 'a paid booking is never released');
create function pg_temp.net(p_request uuid, p_account text) returns bigint language sql as $$
  select private.money_account_net((select id from public.money_obligations where service_request_id=p_request), p_account)::bigint $$;
select is(-pg_temp.net((select id from fx where key='r1'),'platform_revenue'), 600::bigint, 'commission revenue $6.00');
select is(pg_temp.net((select id from fx where key='r1'),'promotion_subsidy'), 1000::bigint, 'subsidy $10.00, apart from commission');
select is(-pg_temp.net((select id from fx where key='r1'),'provider_payable'), 7400::bigint, 'vendor proceeds $74.00');

-- Rounding: whole cents, half away from zero, on each figure.
select is(private.promotion_economics(3333, 333, 'vendor') - 'funding', '{"discount_cents": 333, "eligible_cents": 3333, "commission_cents": 225, "commission_rate_bps": 750, "commission_base_cents": 3000, "vendor_proceeds_cents": 2775, "platform_subsidy_cents": 0, "homeowner_service_cents": 3000}'::jsonb,
  'vendor-funded: 7.5% of $30.00 is $2.25');
select is(private.promotion_economics(3333, 333, 'platform')->>'commission_cents', '250', 'Mercurius-funded: 7.5% of $33.33 = 249.975 cents rounds to $2.50');
select is(private.promotion_economics(3333, 0, null)->>'commission_cents', '500', 'ordinary: 15% of $33.33 = 499.95 cents rounds to $5.00');
select is(private.promotion_discount((select o from private.promotion_offers o where id=pg_temp.o(2)), 3333), 667::bigint, '20% of $33.33 = 666.6 cents rounds to $6.67');

-- Refunds from the original snapshot, in two uneven steps ($70 paid: $6.00 commission, $10 subsidy).
create function pg_temp.refund(p_label text, p_request uuid, p_service bigint) returns void language plpgsql as $$
declare auth uuid; o uuid := (select id from public.money_obligations where service_request_id=p_request);
  payment text := (select stripe_payment_id from public.money_checkout_attempts where obligation_id=o and status='captured' limit 1);
begin
  insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
    values (o,payment,p_service,0,0,'refund-'||p_label,pg_temp.u(4),pg_temp.u(5),'CFG-006','Synthetic refund') returning id into auth;
  perform public.money_receive_event('evt_refund_'||p_label,'refund',jsonb_build_object('authorization_id',auth,'amount',p_service,'currency','usd',
    'payment_id',payment,'refund_id','re_'||p_label));
  if public.money_process_event('evt_refund_'||p_label)<>'processed' then raise exception 'Fixture refund failed'; end if;
end $$;
select pg_temp.refund('sel-third', (select id from fx where key='r1'), 2333);
select is(-pg_temp.net((select id from fx where key='r1'),'platform_revenue'), 400::bigint, 'after $23.33 of $70 refunded: round(600 x 4667/7000) = $4.00 commission remains');
select is(pg_temp.net((select id from fx where key='r1'),'promotion_subsidy'), 667::bigint, 'round(1000 x 4667/7000) = $6.67 subsidy remains');
select is(-pg_temp.net((select id from fx where key='r1'),'provider_payable'), 4934::bigint, '$46.67 + $6.67 - $4.00 = $49.34 vendor proceeds remain');
select is(private.money_obligation_reconciliation((select id from public.money_obligations where service_request_id=(select id from fx where key='r1')), now())->'issues',
  '[]'::jsonb, 'reconciliation agrees after an uneven partial refund');
select is(pg_temp.active((select id from fx where key='r1')), 'Synthetic $10 off:finalized', 'a partial refund keeps the promotion committed');
select pg_temp.refund('sel-rest', (select id from fx where key='r1'), 4667);
select is(row(-pg_temp.net((select id from fx where key='r1'),'platform_revenue'), pg_temp.net((select id from fx where key='r1'),'promotion_subsidy'),
  -pg_temp.net((select id from fx where key='r1'),'provider_payable'))::text, '(0,0,0)', 'the rest reverses everything left, to the cent');
select is((select status from private.promotion_redemptions where service_request_id=(select id from fx where key='r1') and status<>'released'), 'restored',
  'a full refund before service restores the promotion');
select is(private.money_obligation_reconciliation((select id from public.money_obligations where service_request_id=(select id from fx where key='r1')), now())->'issues',
  '[]'::jsonb, 'reconciliation agrees after the full refund');
select is(pg_temp.call(4, 'select public.admin_promotion_reservation_health()') - 'last_run' - 'scheduled',
  '{"reserved": 0, "gate_open": true, "runs_24h": 4, "releasable": 0, "needs_homeowner": 2, "held_by_checkout": 0}'::jsonb,
  'operators see the reservation health');
select throws_ok($$select pg_temp.call(1, 'select public.admin_promotion_reservation_health()')$$, '42501', null, 'homeowners do not');

-- Promotions closed again: a request holding an offer can still drop it and proceed.
update private.money_feature_gates set enabled=false where name='promotions_checkout';
select is(pg_temp.state(6, (select id from fx where key='r5'))->>'available', 'true', 'with the gate closed, a request with an offer choice still shows it');
select is(jsonb_array_length(pg_temp.state(6, (select id from fx where key='r5'))->'options'), 0, 'but lists no alternatives');
select is(pg_temp.state(7, (select id from fx where key='r0'))->>'available', 'false', 'a request without an offer shows nothing');
select throws_ok($$select pg_temp.choose(6, (select id from fx where key='r5'), pg_temp.o(2), null, 4000, 'choose-r5-00000001')$$, '22023',
  'Offers are not available yet', 'no offer can be applied while closed');
select is(pg_temp.choose(6, (select id from fx where key='r5'), null, null, 5000, 'choose-r5-00000002')->>'status', 'declined',
  'the homeowner confirms the price without an offer');
select is(private.money_source((select id from fx where key='r5')) ? 'promotion', false, 'and the request can be invoiced at that price');
update private.money_feature_gates set enabled=true where name='promotions_checkout';

-- A recurring visit carries the priced add-ons -------------------------------------------------------------------
insert into fx(key,id) select 'r4', (pg_temp.submit(9,'sel-r4-000000000001',jsonb_build_array(jsonb_build_object('service_id','synthetic-sel-cans','frequency','monthly',
  'package_id','b8740000-0000-4000-8000-000000000001','tier_id','b8750000-0000-4000-8000-000000000002','preferred_contractor_id','b8720000-0000-4000-8000-000000000001',
  'addons',jsonb_build_array(jsonb_build_object('id','b8760000-0000-4000-8000-000000000002','quantity',2)),
  'expected',jsonb_build_object('pricing_mode','fixed','total',50))))#>>'{requests,0,request_id}')::uuid;
select pg_temp.match((select id from fx where key='r4'));
-- TRACE-123: visits are created by admin_create_recurring_visit (create_service_occurrence is retired).
insert into fx(key,id) select 'v2', (pg_temp.call(4, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,''Synthetic next visit'')',
  (select id from fx where key='r4'), gen_random_uuid(), (l.local at time zone 'America/New_York'), l.local))->>'occurrence_id')::uuid
  from (select (now() at time zone 'America/New_York')::date + 30 + time '10:00' as local) l;
select is((select row(r.pricing_inputs->>'total_cents', r.total_amount, r.contractor_id)::text from public.service_requests r where id=(select id from fx where key='v2')),
  '(5000,50.00,b8720000-0000-4000-8000-000000000001)', 'the next visit is offered at the monthly level plus its two cans');

-- A change to the priced package stops matching rather than dropping add-ons --------------------------------------
insert into fx(key,id) select 'r3', (pg_temp.submit(8,'sel-r3-000000000001',jsonb_build_array(pg_temp.sel(1)))#>>'{requests,0,request_id}')::uuid;
select is(pg_temp.edit_in_place($sql$update public.package_addons set price=16 where id='b8760000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is((select count(*) from private.find_eligible_packages_core((select id from fx where key='r3'))), 0::bigint,
  'a later package revision is not a candidate, and no other provider is substituted');
select lives_ok(format('select private.offer_next_for_request_internal(%L)', (select id from fx where key='r3')), 'matching runs');
select is((select row(matching_status, needs_admin_review, contractor_id)::text from public.service_requests where id=(select id from fx where key='r3')),
  '(exhausted,t,)', 'the request goes to operator review instead');

-- Approval sends: a retried send of the same revision reuses the unread notice ----------------------------------
insert into fx(key,id) select 'd', (pg_temp.call(4, format('select public.admin_save_package_draft_content(null,null,%L,%L,null,%L::jsonb)',
  'b8720000-0000-4000-8000-000000000001','synthetic-sel-cans',
  '{"name":"Synthetic selection draft","pricing_mode":"fixed","tiers":[{"id":"one","name":"One-time","frequency":"one-time","price_kind":"exact","price":70}]}'))->>'id')::uuid;
create function pg_temp.send() returns jsonb language sql as $$
  select pg_temp.call(4, format('select public.admin_send_package_draft(%L,%L)', (select id from fx where key='d'),
    (select content_hash from private.operator_package_drafts where id=(select id from fx where key='d')))) $$;
select is(pg_temp.send()->>'status', 'sent', 'the draft is sent in-app');
select is(pg_temp.send()->>'already_in_inbox', 'true', 'a retry while the notice is unread sends nothing new');
select is((select count(*) from public.notifications where user_id=pg_temp.u(3) and link='/vendor/packages#price-approvals'), 1::bigint, 'one notice');
update public.notifications set read_at=now() where user_id=pg_temp.u(3) and link='/vendor/packages#price-approvals';
select is(pg_temp.send()->>'status', 'sent', 'once read, a resend is a new notice');
select is((select count(*) from public.notifications where user_id=pg_temp.u(3) and link='/vendor/packages#price-approvals'), 2::bigint, 'two notices');

select * from finish();
rollback;
