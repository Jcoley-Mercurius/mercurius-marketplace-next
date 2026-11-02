-- Phase 6.6c / TRACE-125: a recurring visit is payable only after its own acceptance, at the price
-- of the plan terms bound to its creation (never the current catalog or the plan's latest
-- acceptance), through the existing two-person snapshot and the homeowner's own checkout. Live
-- eligibility refusals name the exception; nothing is substituted or repriced. The operations
-- queue opens at appointment − 24 h (or at a later acceptance); failure and unknown outcomes are the
-- shared G6 classification. The one-time path is characterized unchanged (separate corrective
-- issue). Synthetic data only; amounts are test examples, not prices.
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

-- Users: 1 homeowner A, 2 homeowner B, 3 plan provider, 4 other provider, 5–6 operators and the two
-- finance actors.
insert into auth.users(id,email) select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'payments-'||n||'@example.invalid'
  from generate_series(1,6) n;
delete from public.user_roles where user_id in ('97100000-0000-4000-8000-000000000003','97100000-0000-4000-8000-000000000004','97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('97100000-0000-4000-8000-000000000003','vendor'),('97100000-0000-4000-8000-000000000004','vendor'),
 ('97100000-0000-4000-8000-000000000005','admin'),('97100000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006','Synthetic'),
 ('97100000-0000-4000-8000-000000000006','97100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-rp-cat','Synthetic recurring payments');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-rp-lawn','Synthetic payment lawn','synthetic-rp-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00097','Synthetic',true,false);
insert into private.r0_lee_zips values ('00097');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00097','synthetic-rp-lawn','97100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('97200000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000003','Synthetic plan provider',true,true),
 ('97200000-0000-4000-8000-000000000002','97100000-0000-4000-8000-000000000004','Synthetic other provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('97200000-0000-4000-8000-000000000001','00097'),('97200000-0000-4000-8000-000000000002','00097');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('97400000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001','synthetic-rp-lawn','Synthetic plan lawn','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('97500000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('97500000-0000-4000-8000-000000000003','97400000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('97600000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000001','Edge trimming',5,'exact','visit',0,1,false,'{weekly}',0);

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('97700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
create function pg_temp.submit(p_user integer, p_key text, p_frequency text, p_tier uuid, p_addon boolean, p_total numeric) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00097'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'service_id','synthetic-rp-lawn','frequency',p_frequency,'package_id','97400000-0000-4000-8000-000000000001','tier_id',p_tier,
      'preferred_contractor_id','97200000-0000-4000-8000-000000000001',
      'addons',case when p_addon then jsonb_build_array(jsonb_build_object('id','97600000-0000-4000-8000-000000000001','quantity',1)) end,
      'expected',jsonb_build_object('pricing_mode','fixed','total',p_total)))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.accept_plan(p_request uuid) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;
create function pg_temp.day(n integer, t time default '09:00') returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + t $$;
-- An operator adds a visit; returns the visit id (null when blocked).
create function pg_temp.visit(p_series uuid, p_key integer, p_local timestamp) returns uuid language sql as $$
  select (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_local at time zone 'America/New_York', p_local, 'Synthetic payment visit'))->>'occurrence_id')::uuid $$;
create function pg_temp.accept(p_visit uuid) returns void language sql as $$
  select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_visit)) $$;
create function pg_temp.src(p_request uuid) returns jsonb language sql as $$ select private.money_source(p_request) $$;
create function pg_temp.terms(request uuid, service bigint, addons bigint, expires interval default interval '2 days') returns jsonb language sql as $$
  select jsonb_build_object('service',service,'addons',addons,'discount',0,'adjustment',0,'subtotal',service+addons,'tax',0,'tip',0,
    'deposit',0,'total',service+addons,'currency','usd','source_version',private.money_source(request)->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic visit review','expires_at',now()+expires) $$;
create function pg_temp.publish(request uuid, service bigint, addons bigint, expires interval default interval '2 days') returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request, service, addons, expires); prior text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"97100000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('97100000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent visit review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.checkout(p_user integer, p_snapshot uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', p_snapshot)) $$;
create function pg_temp.pay(p_visit uuid, p_at timestamptz default now()) returns jsonb language sql as $$
  select private.recurring_visit_payment(v, p_at) from public.service_requests v where v.id = p_visit $$;
create function pg_temp.q(p_visit uuid, p_at timestamptz default now()) returns jsonb language sql as $$
  select i from jsonb_array_elements(private.recurring_payment_queue(p_at)->'items') i where i->>'request_id' = p_visit::text $$;
create function pg_temp.event(p_id text, p_type text, p_payload jsonb) returns text language plpgsql as $$
begin
  perform public.money_receive_event(p_id, p_type, p_payload);
  return public.money_process_event(p_id);
end $$;
create function pg_temp.money_rows() returns text language sql as $$
  select concat_ws(',', (select count(*) from public.money_obligations), (select count(*) from public.money_snapshots),
    (select count(*) from public.money_checkout_attempts), (select count(*) from public.money_journals),
    (select count(*) from public.invoices), (select count(*) from public.money_review_approvals)) $$;

-- Plans: S1 weekly $40 with a $5 add-on (homeowner A); S2 weekly $40 (homeowner A); S3 weekly $40
-- (homeowner B). R1: a one-time request at $60, the regression for the unchanged one-time path.
insert into fx values ('s1', pg_temp.submit(1,'rp-s1-000000000001','weekly','97500000-0000-4000-8000-000000000001',true,45));
insert into fx values ('s2', pg_temp.submit(1,'rp-s2-000000000001','weekly','97500000-0000-4000-8000-000000000001',false,40));
insert into fx values ('s3', pg_temp.submit(2,'rp-s3-000000000001','weekly','97500000-0000-4000-8000-000000000001',false,40));
insert into fx values ('r1', pg_temp.submit(1,'rp-r1-000000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
select pg_temp.accept_plan(pg_temp.id('s1'));
select pg_temp.accept_plan(pg_temp.id('s2'));
select pg_temp.accept_plan(pg_temp.id('s3'));
select pg_temp.accept_plan(pg_temp.id('r1'));
select is((select count(*) from private.recurring_series_terms where series_id in (pg_temp.id('s1'),pg_temp.id('s2'),pg_temp.id('s3'))), 3::bigint,
  'three accepted plans with recorded terms');

-- Access -------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated','private.recurring_visit_terms(uuid)','execute')
  and not has_function_privilege('authenticated','private.recurring_visit_source_check(public.service_requests)','execute')
  and not has_function_privilege('authenticated','private.recurring_visit_payment(public.service_requests,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.money_payment_exceptions(timestamptz)','execute')
  and not has_function_privilege('authenticated','private.recurring_payment_queue(timestamptz)','execute')
  and not has_function_privilege('service_role','private.recurring_visit_source_check(public.service_requests)','execute'),
  'the terms helper, source check, payment state and classification are not client-callable');
select ok(not has_function_privilege('anon','public.admin_recurring_payment_queue()','execute')
  and has_function_privilege('authenticated','public.admin_recurring_payment_queue()','execute'), 'the queue is signed-in only and checks the role itself');
select throws_ok($$select pg_temp.call(1, 'select public.admin_recurring_payment_queue()')$$, '42501', 'Only admins can read the recurring payment queue', 'a homeowner cannot read the queue');
select throws_ok($$select pg_temp.call(3, 'select public.admin_recurring_payment_queue()')$$, '42501', 'Only admins can read the recurring payment queue', 'a provider cannot read the queue');
select lives_ok($$select pg_temp.call(5, 'select public.admin_recurring_payment_queue()')$$, 'an operator reads the queue');

-- Eligibility only after the visit's own acceptance -------------------------------------------------
insert into fx values ('v1', pg_temp.visit(pg_temp.id('s1'), 1, pg_temp.day(10)));
insert into fx values ('v2', pg_temp.visit(pg_temp.id('s2'), 2, pg_temp.day(10)));
select isnt(pg_temp.id('v1'), null, 'a visit with the add-on is created');
select is((private.recurring_visit_terms(pg_temp.id('v1'))).id,
  (select terms_id from private.recurring_visit_generations where occurrence_id = pg_temp.id('v1') and outcome = 'created'),
  'the visit is bound to the terms recorded on its creation');
select throws_ok($$select pg_temp.src(pg_temp.id('v1'))$$, 'P0001', 'Scheduled commercial parties required', 'an offered visit has no commercial source yet');
select is(pg_temp.pay(pg_temp.id('v1'))->>'state', 'not_accepted', 'its payment state says it is not accepted yet');
select is(pg_temp.q(pg_temp.id('v1'), pg_temp.day(10) at time zone 'America/New_York'), null, 'and it never enters the queue, even at its appointment');
select throws_ok($$select pg_temp.publish(pg_temp.id('v1'), 4000, 500)$$, 'P0001', 'Scheduled commercial parties required', 'so it cannot be published');

-- Price edit after creation, before acceptance: the visit's offer and bound terms keep $40. v1 (with
-- the add-on) is accepted first; a second add-on visit characterizes the existing acceptance rule.
insert into fx values ('v1b', pg_temp.visit(pg_temp.id('s1'), 11, pg_temp.day(11)));
select pg_temp.accept(pg_temp.id('v1'));
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 44 where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is((select needs_review from public.vendor_packages where id = '97400000-0000-4000-8000-000000000001'), false, 'the correction stays inside the review band');
select pg_temp.accept(pg_temp.id('v2'));
select throws_ok($$select pg_temp.accept(pg_temp.id('v1b'))$$, '22023', 'Provider is no longer eligible',
  'existing rule (unchanged): an add-on visit''s offer bound to the old revision cannot be accepted after a price change; nothing is repriced');
select is((select status::text from public.service_requests where id = pg_temp.id('v2')), 'scheduled', 'the provider accepts each visit');
select is((pg_temp.src(pg_temp.id('v1'))->>'service')::bigint, 4000::bigint, 'a price edit before acceptance does not change the visit price');
select is((pg_temp.src(pg_temp.id('v1'))->>'addons')::bigint, 500::bigint, 'the add-on comes from the bound terms');
select is(pg_temp.src(pg_temp.id('v1'))#>>'{recurring_terms,terms_id}', (private.recurring_visit_terms(pg_temp.id('v1'))).id::text,
  'the source evidence names the bound terms');
select ok(not (pg_temp.src(pg_temp.id('v1')) ? 'tier') and not (pg_temp.src(pg_temp.id('v1')) ? 'package'),
  'and carries no current package or tier row');
select is((pg_temp.src(pg_temp.id('v2'))->>'service')::bigint, 4000::bigint, 'a visit without add-ons keeps $40');
select ok(not (pg_temp.src(pg_temp.id('v2')) ? 'addons'), 'with no add-on amount');
select throws_ok($$select pg_temp.publish(pg_temp.id('v2'), 4400, 0)$$, 'P0001', 'Service amount must equal selected offering',
  'reviewers cannot publish the corrected catalog price');

-- Late eligibility after publication: price and non-price catalog edits keep the snapshot payable.
select set_config('t.v2hash', pg_temp.src(pg_temp.id('v2'))->>'version', true);
insert into fx values ('v2snap', pg_temp.publish(pg_temp.id('v2'), 4000, 0));
select is(pg_temp.publish(pg_temp.id('v2'), 4000, 0), pg_temp.id('v2snap'), 'an identical publication retry returns the same snapshot');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 47 where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.edit_in_place($sql$update public.vendor_packages set name = 'Synthetic plan lawn (renamed)', description = 'Synthetic description edit' where id = '97400000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set name = 'Weekly (renamed)' where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.edit_in_place($sql$update public.package_addons set price = 6 where id = '97600000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.src(pg_temp.id('v2'))->>'version', current_setting('t.v2hash'), 'price, add-on and name edits leave the visit''s source hash unchanged');
select is((pg_temp.src(pg_temp.id('v1'))->>'addons')::bigint, 500::bigint, 'an add-on revision does not change an existing visit''s add-on');
select is(pg_temp.pay(pg_temp.id('v2'))->>'state', 'ready', 'the published visit is ready to pay');
select is(pg_temp.pay(pg_temp.id('v2'))->>'action', 'pay', 'with a pay action');
select is((pg_temp.pay(pg_temp.id('v2'))->>'snapshot_id')::uuid, pg_temp.id('v2snap'), 'for its current snapshot');
select set_config('t.money', pg_temp.money_rows(), true);
insert into fx values ('v2a1', (pg_temp.checkout(1, pg_temp.id('v2snap'))->>'id')::uuid);
select is((select amount from public.money_checkout_attempts where id = pg_temp.id('v2a1')), 4000::bigint,
  'after the catalog edits the first checkout succeeds at the agreed amount');
select is((pg_temp.checkout(1, pg_temp.id('v2snap'))->>'id')::uuid, pg_temp.id('v2a1'), 'a repeated checkout returns the same attempt');
select is((select count(*) from public.money_checkout_attempts a join public.money_obligations o on o.id = a.obligation_id
  where o.service_request_id = pg_temp.id('v2')), 1::bigint, 'one attempt for the visit');
select throws_ok($$select pg_temp.checkout(2, pg_temp.id('v2snap'))$$, '42501', null, 'another homeowner cannot check out the visit');
select throws_ok($$select pg_temp.publish(pg_temp.id('v2'), 4000, 0, interval '3 days')$$, 'P0001', 'Existing checkout requires reconciliation before repricing',
  'a different publication after checkout started is refused');
select is(pg_temp.pay(pg_temp.id('v2'))->>'state', 'processing', 'an open checkout shows as processing');
select is(pg_temp.pay(pg_temp.id('v2'))->>'action', 'continue', 'with a continue action to the same checkout');
select is(pg_temp.event('evt_rp_cap_v2','capture',jsonb_build_object('attempt_id',pg_temp.id('v2a1'),'payment_id','pi_rp_v2','amount',4000,'currency','usd')),
  'processed', 'the capture event is processed');
select is(pg_temp.pay(pg_temp.id('v2'))->>'state', 'paid', 'the visit is paid');
select is(pg_temp.pay(pg_temp.id('v2'))->>'action', null, 'with no pay action');
select is(pg_temp.event('evt_rp_cap_v2','capture',jsonb_build_object('attempt_id',pg_temp.id('v2a1'),'payment_id','pi_rp_v2','amount',4000,'currency','usd')),
  'processed', 'a duplicate capture event is idempotent');
select is((select captured from public.money_obligations where service_request_id = pg_temp.id('v2')), 4000::bigint, 'and captures once');
select is((select count(*) from public.money_obligations where service_request_id = pg_temp.id('v1')), 0::bigint, 'paying one visit creates nothing for another');
select is((select count(*) from public.money_obligations where service_request_id = pg_temp.id('s2')), 0::bigint, 'nor for the plan');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 40, name = 'Weekly' where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.edit_in_place($sql$update public.package_addons set price = 5 where id = '97600000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is(pg_temp.edit_in_place($sql$update public.vendor_packages set name = 'Synthetic plan lawn', description = null where id = '97400000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');

-- One-time regression (unchanged path; DEC-2026-034 exposure is a separate corrective issue) -------
-- These expectations characterize the known one-time behavior. They change only with that issue.
select is((pg_temp.src(pg_temp.id('r1'))->>'service')::bigint, 6000::bigint, 'a one-time request is priced from its tier');
select ok(pg_temp.src(pg_temp.id('r1')) ? 'tier' and pg_temp.src(pg_temp.id('r1')) ? 'package', 'with the current package and tier rows in its evidence');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 66 where id = '97500000-0000-4000-8000-000000000003'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select is((pg_temp.src(pg_temp.id('r1'))->>'service')::bigint, 6600::bigint,
  'KNOWN EXPOSURE (one-time): an in-place tier correction changes the unpublished source price');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 60 where id = '97500000-0000-4000-8000-000000000003'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
insert into fx values ('r1snap', pg_temp.publish(pg_temp.id('r1'), 6000, 0));
select is(pg_temp.edit_in_place($sql$update public.vendor_packages set description = 'Synthetic one-time edit' where id = '97400000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
select throws_ok($$select pg_temp.checkout(1, pg_temp.id('r1snap'))$$, 'P0001', 'Commercial source changed; review current terms',
  'KNOWN EXPOSURE (one-time): a non-price package edit refuses checkout of a published snapshot');
select is(pg_temp.edit_in_place($sql$update public.vendor_packages set description = null where id = '97400000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');

-- Plan re-acceptance after visit creation --------------------------------------------------------------
-- The plan provider accepts plan S2 again at $50 (new offer, new terms row); visits created before
-- keep their own bound terms, and a visit created after is bound to the new terms.
insert into fx values ('v3', pg_temp.visit(pg_temp.id('s2'), 3, pg_temp.day(17)));
select pg_temp.accept(pg_temp.id('v3'));
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 50 where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');
-- TRACE-131: an accepted plan's status changes only as owner maintenance; this simulates re-acceptance.
set local mercurius.owner_maintenance = 'on';
update public.service_requests set status = 'matched' where id = pg_temp.id('s2');
insert into public.job_match_attempts(service_request_id,contractor_id,attempt_number,outcome,package_id,package_tier_id,frequency,base_price,effective_price,accepted_at,responded_at)
  values (pg_temp.id('s2'),'97200000-0000-4000-8000-000000000001',9,'accepted','97400000-0000-4000-8000-000000000001','97500000-0000-4000-8000-000000000001',
    'weekly',50,50,now()+interval '1 second',now()+interval '1 second');
update public.service_requests set status = 'scheduled' where id = pg_temp.id('s2');
set local mercurius.owner_maintenance = 'off';
select is((select count(*) from private.recurring_series_terms where series_id = pg_temp.id('s2')), 2::bigint, 'the plan has a second acceptance');
select is((select visit_total from private.recurring_series_terms where series_id = pg_temp.id('s2') order by seq desc limit 1)::numeric(12,2), 50.00,
  'whose terms are $50 a visit');
select is((pg_temp.src(pg_temp.id('v3'))->>'service')::bigint, 4000::bigint, 'a visit created before re-acceptance keeps its own $40');
select is((pg_temp.src(pg_temp.id('v2'))->>'service')::bigint, 4000::bigint, 'as does the paid visit');
insert into fx values ('v4', pg_temp.visit(pg_temp.id('s2'), 4, pg_temp.day(24)));
select pg_temp.accept(pg_temp.id('v4'));
select is((pg_temp.src(pg_temp.id('v4'))->>'service')::bigint, 5000::bigint, 'a visit created after re-acceptance is bound to the new terms');
select is((private.recurring_visit_terms(pg_temp.id('v3'))).seq < (private.recurring_visit_terms(pg_temp.id('v4'))).seq, true,
  'each visit resolves the terms of its own creation, not the latest acceptance');
select is(pg_temp.edit_in_place($sql$update public.package_tiers set price = 40 where id = '97500000-0000-4000-8000-000000000001'$sql$), 'refused',
  'TRACE-134: the version is in use, so this edit is refused in place (applied under owner maintenance below)');

-- Live eligibility refusals: named, with recovery; never substituted ------------------------------------
create function pg_temp.refusal(p_visit uuid) returns text language plpgsql as $$
declare d text;
begin
  perform private.money_source(p_visit);
  return 'payable';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;
-- Package Reviews holds the package (the flag is kept only when written by operations or the service).
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.vendor_packages set needs_review = true where id = '97400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','',true);
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:package_in_review', 'a package in review blocks the visit''s source');
select is(pg_temp.pay(pg_temp.id('v3'))#>>'{problem,code}', 'package_in_review', 'and the payment state names it');
select is(pg_temp.pay(pg_temp.id('v3'))->>'reason', 'source_blocked', 'as blocked terms, not merely a missing review');
select is(pg_temp.q(pg_temp.id('v3'), pg_temp.day(17) at time zone 'America/New_York' - interval '1 hour')->>'reason', 'source_blocked',
  'the queue item carries the blocked-terms reason');
select ok(length(pg_temp.pay(pg_temp.id('v3'))#>>'{problem,recovery}') > 0, 'with a recovery');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.vendor_packages set needs_review = false where id = '97400000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','',true);
update public.vendor_packages set is_active = false where id = '97400000-0000-4000-8000-000000000001';
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:package_unavailable', 'a package no longer offered blocks it');
update public.vendor_packages set is_active = true where id = '97400000-0000-4000-8000-000000000001';
delete from public.contractor_service_zips where contractor_id = '97200000-0000-4000-8000-000000000001';
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:provider_zip', 'a provider who no longer serves the ZIP blocks it');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('97200000-0000-4000-8000-000000000001','00097');
update public.contractors set is_active = false where id = '97200000-0000-4000-8000-000000000001';
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:provider_inactive', 'an inactive provider blocks it');
update public.contractors set is_active = true where id = '97200000-0000-4000-8000-000000000001';
update public.coverage_areas set is_active = false where zip_code = '00097';
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:coverage_inactive', 'an inactive service area blocks it');
update public.coverage_areas set is_active = true where zip_code = '00097';
update public.services_catalog set is_active = false where id = 'synthetic-rp-lawn';
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:service_inactive', 'an inactive service blocks it');
update public.services_catalog set is_active = true where id = 'synthetic-rp-lawn';
insert into public.package_promotions(package_id,label,promotion_type,percent_off,starts_at,ends_at,is_enabled)
  values ('97400000-0000-4000-8000-000000000001','Synthetic legacy promotion','percent_off',10,now()-interval '1 day',now()+interval '1 day',true);
select is(pg_temp.refusal(pg_temp.id('v3')), 'recurring_visit:promotion_decision', 'a package promotion keeps the visit unpayable (item 7)');
delete from public.package_promotions where package_id = '97400000-0000-4000-8000-000000000001';
select is(pg_temp.refusal(pg_temp.id('v3')), 'payable', 'every refusal clears once its cause is resolved, at the same price');
select is((pg_temp.src(pg_temp.id('v3'))->>'service')::bigint, 4000::bigint, 'still $40');

-- An eligibility refusal after publication blocks checkout and surfaces the exception.
insert into fx values ('v3snap', pg_temp.publish(pg_temp.id('v3'), 4000, 0));
update public.contractors set marketing_enabled = false where id = '97200000-0000-4000-8000-000000000001';
select throws_ok($$select pg_temp.checkout(1, pg_temp.id('v3snap'))$$, 'P0001', 'The plan''s provider isn''t active or listed.',
  'checkout of a published visit is refused while the provider is ineligible');
select is(pg_temp.pay(pg_temp.id('v3'))->>'state', 'review_pending', 'the visit shows as waiting for review');
select is(pg_temp.pay(pg_temp.id('v3'))->>'reason', 'source_blocked', 'because its source is blocked');
select is(pg_temp.pay(pg_temp.id('v3'))->>'action', null, 'with no pay action');
select is(pg_temp.q(pg_temp.id('v3'), pg_temp.day(17) at time zone 'America/New_York' - interval '1 hour')#>>'{detail,problem,code}', 'provider_inactive',
  'the queue names the exception');
update public.contractors set marketing_enabled = true where id = '97200000-0000-4000-8000-000000000001';
select is(pg_temp.pay(pg_temp.id('v3'))->>'action', 'pay', 'once resolved the snapshot is payable again');

-- Inconsistent terms: refused, never substituted -----------------------------------------------------
insert into fx values ('v5', pg_temp.visit(pg_temp.id('s3'), 5, pg_temp.day(31)));
select pg_temp.accept(pg_temp.id('v5'));
select is(pg_temp.refusal(pg_temp.id('v5')), 'payable', 'a fresh accepted visit is payable');
update public.service_requests set package_question_answers = '{"synthetic":{"answer":"changed"}}' where id = pg_temp.id('v5');
select is(pg_temp.refusal(pg_temp.id('v5')), 'recurring_visit:terms_inconsistent', 'changed answers are refused');
update public.service_requests set package_question_answers = (select package_question_answers from public.service_requests where id = pg_temp.id('s3'))
  where id = pg_temp.id('v5');
update public.service_requests set pricing_inputs = '{"version":"pricing-v2","status":"exact","total_cents":4000,"lines":[]}' where id = pg_temp.id('v5');
select is(pg_temp.refusal(pg_temp.id('v5')), 'recurring_visit:terms_inconsistent', 'a changed priced selection is refused');
update public.service_requests set pricing_inputs = null where id = pg_temp.id('v5');
update public.job_match_attempts set base_price = 30, effective_price = 30 where service_request_id = pg_temp.id('v5') and outcome = 'accepted';
select is(pg_temp.refusal(pg_temp.id('v5')), 'recurring_visit:offer_mismatch', 'an accepted offer at another price is refused');
update public.job_match_attempts set base_price = 40, effective_price = 40 where service_request_id = pg_temp.id('v5') and outcome = 'accepted';
update public.service_requests set contractor_id = '97200000-0000-4000-8000-000000000002' where id = pg_temp.id('v5');
select is(pg_temp.refusal(pg_temp.id('v5')), 'recurring_visit:replacement_provider', 'a replacement provider is not payable (item 8)');
update public.service_requests set contractor_id = '97200000-0000-4000-8000-000000000001' where id = pg_temp.id('v5');
select is(pg_temp.refusal(pg_temp.id('v5')), 'payable', 'restoring the recorded details makes it payable again');
-- A visit row with no creation record is never priced.
insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,status,frequency,
  pricing_mode,package_id,package_tier_id,recurrence_parent_id,occurrence_key,scheduled_start_at,preferred_date,timezone)
  select '97300000-0000-4000-8000-0000000000aa',customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,'scheduled',frequency,
    pricing_mode,package_id,package_tier_id,id,gen_random_uuid(),now()+interval '40 days',current_date+40,'America/New_York'
  from public.service_requests where id = pg_temp.id('s2');
select is(pg_temp.refusal('97300000-0000-4000-8000-0000000000aa'), 'recurring_visit:terms_missing', 'a visit without bound terms is refused');
select is(pg_temp.pay('97300000-0000-4000-8000-0000000000aa')->>'amount_cents', null, 'and has no amount');
delete from public.service_requests where id = '97300000-0000-4000-8000-0000000000aa';

-- Queue timing ----------------------------------------------------------------------------------
-- v5: appointment day 31 09:00; accepted now. Absent until appointment − 24 h, inclusive.
select set_config('t.v5', (select scheduled_start_at from public.service_requests where id = pg_temp.id('v5'))::text, true);
select is(pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '24 hours 1 minute'), null, 'absent 24 h + 1 min before the appointment');
select is(pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '24 hours')->>'kind', 'review_missing', 'present at exactly 24 h: review missing');
select is(pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '24 hours')->>'reason', 'no_snapshot', 'because no snapshot exists yet');
select is((pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '24 hours')->>'since')::timestamptz,
  current_setting('t.v5')::timestamptz - interval '24 hours', 'since the 24-hour threshold');
select is((pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '24 hours')->>'aged')::boolean, false, 'not aged before the appointment');
select is((pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz + interval '1 hour')->>'aged')::boolean, true, 'aged once the appointment has passed');
insert into fx values ('v5snap', pg_temp.publish(pg_temp.id('v5'), 4000, 0, interval '40 days'));
select is(pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '12 hours')->>'kind', 'ready_unpaid', 'after publication: ready but unpaid');
select is(pg_temp.pay(pg_temp.id('v5'), now() + interval '40 days')->>'reason', 'snapshot_expired',
  'an expired snapshot is waiting for review again');
select is(pg_temp.q(pg_temp.id('v5'), now() + interval '40 days')->>'reason', 'snapshot_expired', 'and the queue says the reviewed terms expired');
-- A dispute or refund holds the obligation: a distinct reason, no pay action.
update public.money_obligations set dispute_open = true where service_request_id = pg_temp.id('v5');
select is(pg_temp.pay(pg_temp.id('v5'))->>'reason', 'held', 'a dispute holds the visit''s payment');
select is(pg_temp.pay(pg_temp.id('v5'))->>'action', null, 'with no pay action');
select is(pg_temp.q(pg_temp.id('v5'), current_setting('t.v5')::timestamptz - interval '12 hours')->>'reason', 'held', 'and the queue says it is held');
update public.money_obligations set dispute_open = false where service_request_id = pg_temp.id('v5');
select is(pg_temp.pay(pg_temp.id('v5'))->>'state', 'ready', 'released, it is ready again');
-- Late acceptance: a manual visit 10 hours away, accepted now, appears at once since its acceptance.
insert into fx values ('v6', pg_temp.visit(pg_temp.id('s3'), 6, date_trunc('minute', (now() + interval '10 hours') at time zone 'America/New_York')));
select isnt(pg_temp.id('v6'), null, 'a manual visit 10 hours away is created');
select is(pg_temp.q(pg_temp.id('v6')), null, 'not in the queue before its acceptance');
select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('v6')));
select is(pg_temp.q(pg_temp.id('v6'), now() + interval '2 minutes')->>'kind', 'review_missing', 'a late acceptance appears immediately');
select is((pg_temp.q(pg_temp.id('v6'), now() + interval '2 minutes')->>'since')::timestamptz,
  (select max(coalesce(accepted_at, responded_at)) from public.job_match_attempts where service_request_id = pg_temp.id('v6') and outcome = 'accepted'),
  'since its acceptance');
-- Spring forward: the 24 hours are measured on instants, not wall time.
insert into fx values ('v7', pg_temp.visit(pg_temp.id('s3'), 7, (select (m + ((7 - extract(dow from m)::int) % 7) + 7) + time '09:00'
  from (select make_date(extract(year from now())::int + 1,3,1) m) s)));
select pg_temp.accept(pg_temp.id('v7'));
select is((pg_temp.q(pg_temp.id('v7'), (select scheduled_start_at from public.service_requests where id = pg_temp.id('v7')) - interval '24 hours')->>'since')::timestamptz,
  (select scheduled_start_at from public.service_requests where id = pg_temp.id('v7')) - interval '24 hours', 'on a spring-forward date the threshold is 24 elapsed hours');
select is(((select scheduled_start_at from public.service_requests where id = pg_temp.id('v7')) - interval '24 hours') at time zone 'America/New_York',
  (select (scheduled_start_at at time zone 'America/New_York') - interval '1 day' + interval '-1 hour' from public.service_requests where id = pg_temp.id('v7')),
  'which is 08:00 Eastern the day before');

-- Failure and unknown outcomes: the shared G6 classification -----------------------------------------
insert into fx values ('v8', pg_temp.visit(pg_temp.id('s3'), 8, pg_temp.day(12)));
select pg_temp.accept(pg_temp.id('v8'));
insert into fx values ('v8snap', pg_temp.publish(pg_temp.id('v8'), 4000, 0));
insert into fx values ('v8a1', (pg_temp.checkout(2, pg_temp.id('v8snap'))->>'id')::uuid);
select is(pg_temp.event('evt_rp_exp_v8','checkout_expired',jsonb_build_object('attempt_id',pg_temp.id('v8a1'),'session_id','cs_rp_v8')), 'processed',
  'the expiry webhook is processed');
select is(pg_temp.pay(pg_temp.id('v8'))->>'state', 'failed', 'a confirmed failure');
select is(pg_temp.pay(pg_temp.id('v8'))->>'action', 'pay', 'the homeowner can try again on the same snapshot');
select is(pg_temp.q(pg_temp.id('v8'))->>'kind', 'payment_failed', 'operations sees the failure at once, well before the 24-hour threshold');
select is((pg_temp.q(pg_temp.id('v8'))->>'since')::timestamptz, (select received_at from public.money_webhook_events where event_id = 'evt_rp_exp_v8'),
  'since the webhook');
insert into fx values ('v8a2', (pg_temp.checkout(2, pg_temp.id('v8snap'))->>'id')::uuid);
select isnt(pg_temp.id('v8a2'), pg_temp.id('v8a1'), 'a retry after failure is a new attempt');
-- Tie-break: both attempts were created in this one transaction, so their created_at is equal; the
-- latest is the higher attempt_number (the retry), never a random id.
select is((select count(distinct created_at)||':'||max(attempt_number) from public.money_checkout_attempts where snapshot_id = pg_temp.id('v8snap')), '1:2',
  'the two attempts tie on created_at; the retry is attempt 2');
select is(pg_temp.pay(pg_temp.id('v8'))->>'state', 'processing', 'which is processing');
select lives_ok(format($$select public.money_flag_checkout(%L,'synthetic_lost_response')$$, pg_temp.id('v8a2')), 'a lost provider response flags the attempt');
select is(pg_temp.pay(pg_temp.id('v8'))->>'state', 'unknown', 'the outcome is unknown, not failed or paid');
select is(pg_temp.pay(pg_temp.id('v8'))->>'action', null, 'with no pay action');
select is(pg_temp.q(pg_temp.id('v8'))->>'kind', 'payment_unresolved', 'and is queued as unresolved');
select throws_ok($$select pg_temp.checkout(2, pg_temp.id('v8snap'))$$, 'P0001', 'Commercial review required', 'checkout stays closed while it is reconciled');
-- A session past its expiry with no recorded result is unknown.
insert into fx values ('v9', pg_temp.visit(pg_temp.id('s3'), 9, pg_temp.day(13)));
select pg_temp.accept(pg_temp.id('v9'));
insert into fx values ('v9snap', pg_temp.publish(pg_temp.id('v9'), 4000, 0));
insert into fx values ('v9a1', (pg_temp.checkout(2, pg_temp.id('v9snap'))->>'id')::uuid);
select is(pg_temp.pay(pg_temp.id('v9'), now() + interval '2 hours')->>'state', 'unknown', 'a session past its expiry without a result is unknown');
select is(pg_temp.q(pg_temp.id('v9'), now() + interval '2 hours')->>'kind', 'payment_unresolved', 'and queued as unresolved');
-- One classification: the quote queue's payment items are exactly the shared ones.
select set_eq(
  $$select i->>'request_id' r, i->>'kind' k, i->>'since' s, i->>'due_at' d, i->>'detail' x from jsonb_array_elements(pg_temp.call(5, 'select public.admin_quote_queue()')->'items') i
    where i->>'kind' in ('payment_failed', 'payment_unresolved')$$,
  $$select request_id::text r, kind k, to_jsonb(since)#>>'{}' s, to_jsonb(due_at)#>>'{}' d, detail::text x from private.money_payment_exceptions(now())$$,
  'the quote queue lists exactly the shared payment exceptions');
select is((select count(*) from jsonb_array_elements(pg_temp.call(5, 'select public.admin_quote_queue()')->'items') i
  where i->>'request_id' = pg_temp.id('v8')::text and i->>'kind' = 'payment_unresolved'), 1::bigint, 'including the visit''s unresolved payment');
-- Both queues name the same obligation and carry the same classification for it.
create function pg_temp.quote_item(p_request uuid) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.call(5, 'select public.admin_quote_queue()')->'items') i
  where i->>'request_id' = p_request::text and i->>'kind' in ('payment_failed', 'payment_unresolved') $$;
select is((pg_temp.q(pg_temp.id('v8'))->>'obligation_id')::uuid, (select id from public.money_obligations where service_request_id = pg_temp.id('v8')),
  'the recurring queue names the visit''s obligation');
select is((pg_temp.quote_item(pg_temp.id('v8'))#>>'{detail,obligation_id}')::uuid, (pg_temp.q(pg_temp.id('v8'))->>'obligation_id')::uuid,
  'the quote queue names the same obligation');
select is(pg_temp.q(pg_temp.id('v8'))->>'kind', pg_temp.quote_item(pg_temp.id('v8'))->>'kind', 'with the same kind');
select is(pg_temp.q(pg_temp.id('v8'))->>'since', pg_temp.quote_item(pg_temp.id('v8'))->>'since', 'the same clock');
select is(pg_temp.q(pg_temp.id('v8'))#>'{detail,exception}', pg_temp.quote_item(pg_temp.id('v8'))->'detail', 'and the same detail');
select is((pg_temp.q(pg_temp.id('v9'), now() + interval '2 hours')->>'obligation_id')::uuid, (select id from public.money_obligations where service_request_id = pg_temp.id('v9')),
  'every visit item carries its obligation');

-- Readback by role --------------------------------------------------------------------------------
create function pg_temp.rb_visit(p_user integer, p_series uuid, p_visit uuid) returns jsonb language sql as $$
  select v from jsonb_array_elements(pg_temp.call(p_user, format('select public.recurring_series(%L)', p_series))->'visits') v
  where v->>'id' = p_visit::text $$;
select is(pg_temp.rb_visit(2, pg_temp.id('s3'), pg_temp.id('v5'))#>>'{payment_state,state}', 'ready', 'the homeowner sees the visit ready to pay');
select is(pg_temp.rb_visit(2, pg_temp.id('s3'), pg_temp.id('v5'))#>>'{payment_state,action}', 'pay', 'with the pay action');
select is((pg_temp.rb_visit(2, pg_temp.id('s3'), pg_temp.id('v5'))#>>'{payment_state,snapshot_id}')::uuid, pg_temp.id('v5snap'), 'for the current snapshot');
select ok(not (pg_temp.rb_visit(2, pg_temp.id('s3'), pg_temp.id('v5'))->'payment_state' ? 'problem')
  and not (pg_temp.rb_visit(2, pg_temp.id('s3'), pg_temp.id('v5'))->'payment_state' ? 'exception'), 'the homeowner gets no operations detail');
select is(pg_temp.rb_visit(1, pg_temp.id('s2'), pg_temp.id('v2'))->>'payment', 'paid', 'the legacy payment field still reads paid');
select is(pg_temp.rb_visit(3, pg_temp.id('s3'), pg_temp.id('v5'))->'payment_state', 'null'::jsonb, 'the provider sees no payment state');
select is(pg_temp.rb_visit(3, pg_temp.id('s3'), pg_temp.id('v5'))->'payment', 'null'::jsonb, 'or payment');
select is(pg_temp.rb_visit(5, pg_temp.id('s1'), pg_temp.id('v1'))#>>'{payment_state,state}', 'review_pending', 'operations sees a visit waiting for review');
select throws_ok($$select pg_temp.call(2, format('select public.recurring_series(%L)', pg_temp.id('s2')))$$, '42501', null, 'another homeowner cannot read the plan');

-- Reads change nothing ------------------------------------------------------------------------------
select set_config('t.money', pg_temp.money_rows(), true);
select pg_temp.call(5, 'select public.admin_recurring_payment_queue()') is not null;
select pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) is not null;
select count(*) from public.service_requests v, lateral private.recurring_visit_source_check(v) where v.recurrence_parent_id is not null;
select is(pg_temp.money_rows(), current_setting('t.money'), 'the queue, readback and source checks create no money, invoice or review rows');
select is((select count(*) from public.notifications where user_id in (pg_temp.u(1), pg_temp.u(2)) and title ilike '%pay%'), 0::bigint,
  'no payment notice is sent to homeowners');

select * from finish();
rollback;
