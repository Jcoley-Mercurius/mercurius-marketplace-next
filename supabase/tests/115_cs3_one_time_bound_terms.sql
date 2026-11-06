-- CS-3 / TRACE-126 (DEC-2026-060 D-1 (a); R-1 confirmed, DEC-2026-062; plan R-2, R-4, R-5): a
-- one-time fixed request whose offer or acceptance is the package and level priced at submission is
-- accepted and checked out at that bound level and price after an ordinary catalog revision (a price
-- change, a rename, an add-on change), while the offering's live revision still offers the cadence and
-- is not held in Package Reviews. Amounts and source hashes are unchanged. Genuine refusals (paused,
-- archived, in review, cadence dropped, provider, service, coverage, provider ZIP, provider matching
-- eligibility, a changed bound record) still block, by name. Requests accepted at another package or
-- level, requests without a pricing-v2 record, quotes and promotions keep the earlier rule. Every
-- catalog change goes through the real vendor or operator command. Synthetic data only; amounts are
-- test examples.
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
 ('97600000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000001','Edge trimming',5,'exact','visit',0,1,false,'{weekly,one-time}',0);

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


create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
declare d text;
begin
  execute p_sql; return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || ': ' || sqlerrm || coalesce(' [' || nullif(d, '') || ']', '');
end $f$;
create function pg_temp.head() returns uuid language sql security definer as $$
  select id from public.vendor_packages where lineage_id = '97400000-0000-4000-8000-000000000001' order by revision_number desc limit 1 $$;
create function pg_temp.content(p_one numeric, p_name text, p_addon numeric default 5, p_one_tier boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-rp-lawn',
    'package', jsonb_build_object('name',p_name,'description',null,'pricing_mode','fixed','default_frequency','weekly'),
    'questions','[]'::jsonb,
    'tiers', case when p_one_tier then jsonb_build_array(
        jsonb_build_object('name','Weekly','price',40,'frequency','weekly'),
        jsonb_build_object('name','One time','price',p_one,'frequency','one-time'))
      else jsonb_build_array(jsonb_build_object('name','Weekly','price',40,'frequency','weekly')) end,
    'addons', jsonb_build_array(jsonb_build_object('name','Edge trimming','price',p_addon,'frequencies',jsonb_build_array('weekly','one-time')))) $$;
-- The provider saves and publishes its current head revision through vendor_save_package.
create function pg_temp.save(p_content jsonb, p_key text) returns jsonb language sql as $$
  select pg_temp.call(3, format('select public.vendor_save_package(%L,%L,%L::jsonb,true,%L)',
    pg_temp.head(), private.package_revision_hash(pg_temp.head()), p_content, p_key)) $$;
create function pg_temp.hash(p_request uuid) returns text language sql as $$ select private.money_source(p_request)->>'version' $$;
create function pg_temp.amounts(p_request uuid) returns text language sql as $$
  select concat_ws('/', r.status, coalesce(round(r.total_amount, 2)::text, '-'), coalesce(round(a.base_price, 2)::text, '-'),
    coalesce(round(a.effective_price, 2)::text, '-'), coalesce((a.package_id = '97400000-0000-4000-8000-000000000001')::text, '-'))
  from public.service_requests r left join public.job_match_attempts a on a.service_request_id = r.id and a.outcome = 'accepted'
  where r.id = p_request $$;
create function pg_temp.offer(p_request uuid) returns void language sql as $$ select private.offer_next_for_request_internal(p_request) $$;
create function pg_temp.amount(p_attempt jsonb) returns bigint language sql as $$
  select amount from public.money_checkout_attempts where id = (p_attempt->>'id')::uuid $$;

-- One-time requests at $60 (+ $5 add-on where marked), priced from the bound one-time level:
-- oa offered + add-on (A), op offered (B), ra accepted + published + add-on (A), rp accepted +
-- published (B), ru accepted, unpublished (B), pd paid (A).
insert into fx values ('oa', pg_temp.submit(1,'cs3-oa-0000000001','one-time','97500000-0000-4000-8000-000000000003',true,65));
insert into fx values ('op', pg_temp.submit(2,'cs3-op-0000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
insert into fx values ('ra', pg_temp.submit(1,'cs3-ra-0000000001','one-time','97500000-0000-4000-8000-000000000003',true,65));
insert into fx values ('rp', pg_temp.submit(2,'cs3-rp-0000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
insert into fx values ('ru', pg_temp.submit(2,'cs3-ru-0000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
insert into fx values ('pd', pg_temp.submit(1,'cs3-pd-0000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
select is((select count(*) from fx where id is not null), 6::bigint, 'six one-time requests submitted at the bound one-time level');
select pg_temp.offer(pg_temp.id('oa')); select pg_temp.offer(pg_temp.id('op'));
select pg_temp.accept_plan(pg_temp.id('ra')); select pg_temp.accept_plan(pg_temp.id('rp'));
select pg_temp.accept_plan(pg_temp.id('ru')); select pg_temp.accept_plan(pg_temp.id('pd'));
insert into fx values ('rasnap', pg_temp.publish(pg_temp.id('ra'), 6000, 500));
insert into fx values ('rpsnap', pg_temp.publish(pg_temp.id('rp'), 6000, 0));
insert into fx values ('pdsnap', pg_temp.publish(pg_temp.id('pd'), 6000, 0));
insert into fx values ('pda', (pg_temp.checkout(1, pg_temp.id('pdsnap'))->>'id')::uuid);
select pg_temp.event('evt_cs3_cap_pd','capture',jsonb_build_object('attempt_id',pg_temp.id('pda'),'payment_id','pi_cs3_pd','amount',6000,'currency','usd'));
create temp table before_hash as select k, pg_temp.hash(pg_temp.id(k)) as h from unnest(array['ra','rp','ru']) k;
select is(pg_temp.amounts(pg_temp.id('ra')), 'scheduled/65.00/60.00/65.00/true', 'control: accepted at the bound $60 + $5');
select ok((select bool_and(h like 'commercial-v2:%') from before_hash), 'control: the bound one-time source is versioned commercial-v2 (R-4)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(private.money_source(pg_temp.id('ru'))) k),
  'bound,context,kind,service,version', 'control: its evidence carries only the bound record, no current package or tier rows');
select is((select status from public.money_checkout_attempts where id = pg_temp.id('pda')), 'captured', 'control: the paid request is captured');

-- Access and fingerprint list ------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated','private.one_time_bound_problem(public.service_requests,public.job_match_attempts)','execute')
  and not has_function_privilege('anon','private.one_time_bound_problem(public.service_requests,public.job_match_attempts)','execute')
  and not has_function_privilege('service_role','private.one_time_bound_problem(public.service_requests,public.job_match_attempts)','execute'),
  'the one-time bound rule is not client-callable');
select ok(has_function_privilege('authenticated','public.vendor_accept_job(uuid)','execute')
  and not has_function_privilege('anon','public.vendor_accept_job(uuid)','execute'), 'acceptance stays signed-in only');

-- Each scenario runs in a subtransaction that is rolled back; assertions run outside it.
create function pg_temp.observe(p_setup text, p_observe text) returns jsonb language plpgsql as $f$
declare out jsonb;
begin
  begin
    if p_setup is not null then execute p_setup; end if;
    execute p_observe into out;
    raise exception using errcode = 'MRCS3';
  exception when sqlstate 'MRCS3' then null;
  end;
  return out;
end $f$;

-- Ordinary revisions keep acceptance and checkout at the bound terms ---------------------------------
create function pg_temp.ordinary_obs(p_content jsonb, p_key text) returns jsonb language plpgsql as $f$
declare o jsonb := '{}'; saved jsonb; snap uuid; prior uuid := pg_temp.head();
begin
  saved := pg_temp.save(p_content, p_key);
  o := o || jsonb_build_object('saved', (saved->>'new_version')::boolean and (saved->>'replaced_package_id')::uuid = prior
    and (saved->>'is_active')::boolean and not (saved->>'needs_review')::boolean);
  o := o || jsonb_build_object('bound_live', (select is_active from public.vendor_packages where id = '97400000-0000-4000-8000-000000000001'));
  o := o || jsonb_build_object('accept_oa', pg_temp.err(format('select pg_temp.accept(%L)', pg_temp.id('oa'))));
  o := o || jsonb_build_object('accept_op', pg_temp.err(format('select pg_temp.accept(%L)', pg_temp.id('op'))));
  o := o || jsonb_build_object('amounts_oa', pg_temp.amounts(pg_temp.id('oa')), 'amounts_op', pg_temp.amounts(pg_temp.id('op')));
  o := o || jsonb_build_object('accept_again', pg_temp.err(format('select pg_temp.accept(%L)', pg_temp.id('oa'))));
  o := o || jsonb_build_object('src_oa', (select concat_ws('/', s->>'service', s->>'addons', split_part(s->>'version', ':', 1))
    from private.money_source(pg_temp.id('oa')) s));
  o := o || jsonb_build_object('publish_new_price', pg_temp.err(format('select pg_temp.publish(%L, 6600, 500)', pg_temp.id('oa'))));
  snap := pg_temp.publish(pg_temp.id('oa'), 6000, 500);
  o := o || jsonb_build_object('published', snap is not null,
    'hash_ra', pg_temp.hash(pg_temp.id('ra')), 'hash_rp', pg_temp.hash(pg_temp.id('rp')), 'hash_ru', pg_temp.hash(pg_temp.id('ru')));
  o := o || jsonb_build_object('checkout_ra', pg_temp.amount(pg_temp.checkout(1, pg_temp.id('rasnap'))),
    'checkout_rp', pg_temp.amount(pg_temp.checkout(2, pg_temp.id('rpsnap'))),
    'checkout_oa', pg_temp.amount(pg_temp.checkout(1, snap)));
  o := o || jsonb_build_object('captured_pd', (select status from public.money_checkout_attempts where id = pg_temp.id('pda')));
  return o;
end $f$;
create function pg_temp.ordinary(p_label text, o jsonb) returns setof text language plpgsql as $f$
begin
  return next is((o->>'saved')::boolean, true, p_label || ': saved as the live revision outside Package Reviews, replacing the previous one');
  return next is((o->>'bound_live')::boolean, false, p_label || ': the bound revision is paused');
  return next is(o->>'accept_oa', 'ok', p_label || ': the offered request with an add-on is accepted');
  return next is(o->>'accept_op', 'ok', p_label || ': the offered request without add-ons is accepted');
  return next is(o->>'amounts_oa', 'scheduled/65.00/60.00/65.00/true', p_label || ': at the bound $60 + $5 and the bound revision');
  return next is(o->>'amounts_op', 'scheduled/60.00/60.00/60.00/true', p_label || ': and at the bound $60');
  return next is(o->>'accept_again', 'P0001: No open offer is available to accept', p_label || ': a second acceptance finds no open offer');
  return next is(o->>'src_oa', '6000/500/commercial-v2', p_label || ': its source is the bound $60 + $5');
  return next is(o->>'publish_new_price', 'P0001: Service amount must equal selected offering', p_label || ': reviewers cannot publish the new catalog price');
  return next is((o->>'published')::boolean, true, p_label || ': the bound amounts are published');
  return next is(o->>'hash_ra', (select h from before_hash where k = 'ra'), p_label || ': the published add-on request''s source hash is unchanged');
  return next is(o->>'hash_rp', (select h from before_hash where k = 'rp'), p_label || ': as is the published one without add-ons');
  return next is(o->>'hash_ru', (select h from before_hash where k = 'ru'), p_label || ': and the unpublished one');
  return next is((o->>'checkout_ra')::bigint, 6500::bigint, p_label || ': checkout opens at the bound $65');
  return next is((o->>'checkout_rp')::bigint, 6000::bigint, p_label || ': and at the bound $60');
  return next is((o->>'checkout_oa')::bigint, 6500::bigint, p_label || ': as does the request accepted after it');
  return next is(o->>'captured_pd', 'captured', p_label || ': the paid request stays captured');
end $f$;
select * from pg_temp.ordinary('price 60 -> 66', pg_temp.observe(null,
  $$select pg_temp.ordinary_obs(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-price-0001')$$));
select * from pg_temp.ordinary('rename', pg_temp.observe(null,
  $$select pg_temp.ordinary_obs(pg_temp.content(60, 'Synthetic plan lawn renamed'), 'cs3-save-rename-001')$$));
select * from pg_temp.ordinary('add-on 5 -> 7', pg_temp.observe(null,
  $$select pg_temp.ordinary_obs(pg_temp.content(60, 'Synthetic plan lawn', 7), 'cs3-save-addon-0001')$$));
select * from pg_temp.ordinary('second revision 66 -> 68', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-twice-0001')$$,
  $$select pg_temp.ordinary_obs(pg_temp.content(68, 'Synthetic plan lawn'), 'cs3-save-twice-0002')$$));

-- Genuine refusals still block acceptance and checkout, by name ----------------------------------------
create function pg_temp.vendor_pause(p_package uuid) returns jsonb language sql as $$
  select pg_temp.call(3, format('select public.vendor_set_package_active(%L,false,%L)', p_package,
    (select updated_at from public.vendor_packages where id = p_package))) $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$ select pg_temp.call(5, p_sql) $$;
create function pg_temp.refusal_obs() returns jsonb language sql as $$
  select jsonb_build_object('accept', pg_temp.err(format('select pg_temp.accept(%L)', pg_temp.id('oa'))),
    'outcome', (select outcome from public.job_match_attempts where service_request_id = pg_temp.id('oa') order by offered_at desc limit 1),
    'source_ru', pg_temp.err(format('select private.money_source(%L)', pg_temp.id('ru'))),
    'checkout_ra', pg_temp.err(format('select pg_temp.checkout(1, %L)', pg_temp.id('rasnap'))),
    'amounts_ra', pg_temp.amounts(pg_temp.id('ra'))) $$;
create function pg_temp.refused(p_label text, p_code text, o jsonb, p_message text default 'Selected offering is not eligible') returns setof text language plpgsql as $f$
begin
  return next is(o->>'accept', '22023: Provider is no longer eligible [one_time:' || p_code || ']', p_label || ': the offered request is refused (' || p_code || ')');
  return next is(o->>'outcome', 'pending', p_label || ': its offer stays pending');
  return next is(o->>'source_ru', 'P0001: ' || p_message || ' [one_time:' || p_code || ']', p_label || ': the accepted request''s source names the exception');
  return next ok(o->>'checkout_ra' like 'P0001:%', p_label || ': and the published request''s checkout is refused');
  return next is(o->>'amounts_ra', 'scheduled/65.00/60.00/65.00/true', p_label || ': nothing is repriced');
end $f$;
select * from pg_temp.refused('offering paused (no live revision)', 'package_unavailable', pg_temp.observe(
  $$select pg_temp.vendor_pause('97400000-0000-4000-8000-000000000001')$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('live revision paused after a save', 'package_unavailable', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-pause-0001'); select pg_temp.vendor_pause(pg_temp.head())$$,
  'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('operator suspends and archives the live revision', 'package_unavailable', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-arch-00001');
    select pg_temp.op(format('select public.admin_suspend_package(%L,%L,%L)', pg_temp.head(),
      (select updated_at from public.vendor_packages where id = pg_temp.head()), 'Synthetic suspension'));
    select pg_temp.op(format('select public.admin_archive_package(%L,%L,%L)', pg_temp.head(),
      (select updated_at from public.vendor_packages where id = pg_temp.head()), 'Synthetic archive'))$$,
  'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('operator archives the bound revision', 'package_unavailable', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-barc-00001');
    select pg_temp.op(format('select public.admin_archive_package(%L,%L,%L)', '97400000-0000-4000-8000-000000000001',
      (select updated_at from public.vendor_packages where id = '97400000-0000-4000-8000-000000000001'), 'Synthetic archive of the bound revision'))$$,
  'select pg_temp.refusal_obs()'));
select is(pg_temp.observe(null, $$select to_jsonb((pg_temp.save(pg_temp.content(600, 'Synthetic plan lawn'), 'cs3-save-review-001')->>'needs_review')::boolean)$$),
  'true'::jsonb, 'precondition: an out-of-band price is held in Package Reviews');
select * from pg_temp.refused('live revision held in Package Reviews', 'package_in_review', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(600, 'Synthetic plan lawn'), 'cs3-save-review-001')$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('the live revision no longer offers the one-time cadence', 'package_unavailable', pg_temp.observe(
  $$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn', 5, false), 'cs3-save-cadence-01')$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('provider suspended', 'provider_inactive', pg_temp.observe(
  $$update public.contractors set is_active = false where id = '97200000-0000-4000-8000-000000000001'$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('service inactive', 'service_inactive', pg_temp.observe(
  $$update public.services_catalog set is_active = false where id = 'synthetic-rp-lawn'$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('coverage off', 'coverage_inactive', pg_temp.observe(
  $$update public.coverage_areas set is_active = false where zip_code = '00097'$$, 'select pg_temp.refusal_obs()'));
select * from pg_temp.refused('provider ZIP removed', 'provider_zip', pg_temp.observe(
  $$delete from public.contractor_service_zips where contractor_id = '97200000-0000-4000-8000-000000000001' and zip_code = '00097'$$,
  'select pg_temp.refusal_obs()'));
-- TRACE-126's in-place exposure: an owner-maintenance edit of a bound row no longer reprices. The bound
-- record no longer matches, so acceptance and checkout refuse instead (SQL 097 characterized $66).
select * from pg_temp.refused('owner-maintenance edit of the bound level price', 'terms_inconsistent', pg_temp.observe(
  $$select pg_temp.edit_in_place('update public.package_tiers set price = 66 where id = ''97500000-0000-4000-8000-000000000003''')$$,
  'select pg_temp.refusal_obs()'), 'Offering changed since the request; a new request or quote is required');
-- Legacy promotions can't be enabled on any path (TRACE-134); created under owner maintenance as in
-- SQL 097. Acceptance doesn't read the overlay (unchanged); checkout still refuses it.
select is(pg_temp.observe(
  $$alter table public.package_promotions disable trigger trg_package_promotion_legacy_closed;
    insert into public.package_promotions(package_id, label, promotion_type, percent_off, starts_at, ends_at, is_enabled)
      values ('97400000-0000-4000-8000-000000000001', 'Synthetic promotion', 'percent_off', 10, now() - interval '1 day', now() + interval '1 day', true);
    alter table public.package_promotions enable trigger trg_package_promotion_legacy_closed;
    select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-promo-0001')$$,
  $$select pg_temp.refusal_obs() - 'outcome' - 'amounts_ra' - 'checkout_ra'$$),
  jsonb_build_object('accept', 'ok', 'source_ru', 'P0001: Promotion allocation integration required'),
  'a legacy promotion on the bound package still blocks checkout');
-- Provider matching eligibility (listing exclusion): acceptance refuses; an accepted request's source
-- doesn't read it (unchanged).
select is(pg_temp.observe($$insert into private.r0_public_listing_exclusions(contractor_id, reason, excluded_by)
    values ('97200000-0000-4000-8000-000000000001', 'Synthetic exclusion', '97100000-0000-4000-8000-000000000005')$$,
  $$select pg_temp.refusal_obs() - 'outcome' - 'checkout_ra' - 'amounts_ra'$$),
  jsonb_build_object('accept', '22023: Provider is no longer eligible [one_time:provider_not_matchable]', 'source_ru', 'ok'),
  'a provider excluded from matching cannot accept; an accepted request''s source does not read it (unchanged)');

-- Offer state, authorization and stale actions ---------------------------------------------------------
select is(pg_temp.observe($$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-auth-00001')$$,
  format($$select jsonb_build_array(
    pg_temp.err(format('select pg_temp.call(4, %%L)', format('select to_jsonb(public.vendor_accept_job(%%L))', %L::uuid))),
    pg_temp.err(format('select pg_temp.call(1, %%L)', format('select to_jsonb(public.vendor_accept_job(%%L))', %L::uuid))))$$,
    pg_temp.id('oa'), pg_temp.id('oa'))),
  '["P0001: No open offer is available to accept", "P0001: No open offer is available to accept"]'::jsonb,
  'after a revision, another provider and the homeowner still cannot accept the request');
select is(pg_temp.observe(format($$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-exp-000001');
    update public.job_match_attempts set expires_at = now() - interval '1 minute' where service_request_id = %L and outcome = 'pending'$$, pg_temp.id('op')),
  format($$select to_jsonb(pg_temp.err(format('select pg_temp.accept(%%L)', %L::uuid)))$$, pg_temp.id('op'))),
  '"22023: Offer has expired"'::jsonb, 'an expired offer is still refused');
select is(pg_temp.observe(format($$update public.service_requests set matching_status = 'awaiting_homeowner' where id = %L$$, pg_temp.id('oa')),
  format($$select to_jsonb(pg_temp.err(format('select pg_temp.accept(%%L)', %L::uuid)))$$, pg_temp.id('oa'))),
  '"22023: Offer is no longer actionable"'::jsonb, 'a request no longer offered is still refused');
select is(pg_temp.observe(format($$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-mism-00001');
    update public.job_match_attempts set effective_price = 69 where service_request_id = %L and outcome = 'pending'$$, pg_temp.id('oa')),
  format($$select to_jsonb(pg_temp.err(format('select pg_temp.accept(%%L)', %L::uuid)))$$, pg_temp.id('oa'))),
  '"22023: Provider is no longer eligible [one_time:offer_mismatch]"'::jsonb, 'an offer at another price is refused, never accepted at it');

-- Unchanged paths -----------------------------------------------------------------------------------
-- A request without a pricing-v2 record keeps the earlier rule: commercial-v1 evidence from the current
-- rows, and refused once its package is replaced (constructed directly; hosted has none).
select is(pg_temp.observe(format($$update public.service_requests set pricing_inputs = null where id = %L$$, pg_temp.id('ru')),
  format($$select jsonb_build_array(split_part(pg_temp.hash(%L), ':', 1), private.money_source(%L) ? 'tier')$$, pg_temp.id('ru'), pg_temp.id('ru'))),
  '["commercial-v1", true]'::jsonb, 'a request without a submission record keeps the earlier source (commercial-v1)');
select is(pg_temp.observe(format($$update public.service_requests set pricing_inputs = null where id = %L;
    select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-legacy-001')$$, pg_temp.id('ru')),
  format($$select to_jsonb(pg_temp.err(format('select private.money_source(%%L)', %L::uuid)))$$, pg_temp.id('ru'))),
  '"P0001: Selected offering is not eligible"'::jsonb, 'and is refused after a revision, as before');
-- OPEN (plan R-3): a re-offer at the newer revision (here forced by an operator) is accepted and priced
-- by the earlier rule at the newer price. CS-3 binds only an offer of the submitted package and level.
select is(pg_temp.observe(format($$select pg_temp.save(pg_temp.content(66, 'Synthetic plan lawn'), 'cs3-save-reoff-0001');
    select private.create_job_offer_internal(%L, '97200000-0000-4000-8000-000000000001', null, null, true)$$, pg_temp.id('op')),
  format($$select jsonb_build_array(pg_temp.err(format('select pg_temp.accept(%%L)', %L::uuid)), pg_temp.amounts(%L),
    (select concat_ws('/', s->>'service', split_part(s->>'version', ':', 1)) from private.money_source(%L) s))$$,
    pg_temp.id('op'), pg_temp.id('op'), pg_temp.id('op'))),
  '["ok", "scheduled/66.00/66.00/66.00/false", "6600/commercial-v1"]'::jsonb,
  'OPEN (R-3): a re-offer at the newer revision keeps the earlier rule and its price');
-- Without any catalog change, acceptance and the source are unchanged (applied, not rolled back).
select is(pg_temp.err(format('select pg_temp.accept(%L)', pg_temp.id('oa'))), 'ok', 'without a revision the request is accepted as before');
select is(pg_temp.amounts(pg_temp.id('oa')), 'scheduled/65.00/60.00/65.00/true', 'at its bound amounts');
select is((private.money_source(pg_temp.id('oa'))->>'service')::bigint + (private.money_source(pg_temp.id('oa'))->>'addons')::bigint,
  6500::bigint, 'and its source is the bound $65');

select * from finish();
rollback;
