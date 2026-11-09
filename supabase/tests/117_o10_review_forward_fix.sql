-- Forward fix for Codex's review of #154 (TRACE-150; DEC-2026-063; migration 20261118001000).
--   1. A homeowner's recorded decline survives a failed re-match: the provider stays unassigned, the
--      declined offer is never actionable again, and operations sees and retries the request.
--      (The deterministic decline-versus-vendor-save race is C22 in scripts/offer-terms-concurrency.mjs;
--      here the re-match failure is forced so every consequence can be asserted in one transaction.)
--   2. A fixed one-time request without bound terms is refused by name at preview, publication and
--      checkout; no current-catalog price.
--   3. Required scope: a candidate at other terms is offered only when the request's required work is
--      established from the records (template level, included work, required add-ons). Missing
--      required work is refused; an optional add-on the candidate lacks is omitted and disclosed.
-- Synthetic data only; amounts are test examples.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1-2 homeowners, 3 P1 (submitted), 4 P2, 7 P3, 8 P4, 9 P5, 10 P6, 11 P7; 5-6 operators.
insert into auth.users(id,email) select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'o10fix-'||n||'@example.invalid'
  from generate_series(1,11) n;
delete from public.user_roles where user_id in (select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(3,11) n);
insert into public.user_roles(user_id,role)
  select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, case when n in (5,6) then 'admin' else 'vendor' end::public.app_role
  from generate_series(3,11) n;
insert into public.money_authorities(user_id,granted_by,reason) values
 ('99100000-0000-4000-8000-000000000005','99100000-0000-4000-8000-000000000006','Synthetic'),
 ('99100000-0000-4000-8000-000000000006','99100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-o10fix-cat','Synthetic forward fix');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-o10fix-lawn','Synthetic fix lawn','synthetic-o10fix-cat',60,40,120,'one-time','{one-time}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00099','Synthetic',true,false);
insert into private.r0_lee_zips values ('00099');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00099','synthetic-o10fix-lawn','99100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;

-- One pricing template: two levels and two add-ons, shared by the template-based offerings.
insert into public.pricing_templates(id,service_id,name) values ('99300000-0000-4000-8000-000000000001','synthetic-o10fix-lawn','Synthetic template');
insert into public.pricing_template_tiers(id,template_id,name,min_price,max_price,suggested_price,sort_order) values
 ('99310000-0000-4000-8000-000000000001','99300000-0000-4000-8000-000000000001','Small yard',50,100,60,0),
 ('99310000-0000-4000-8000-000000000002','99300000-0000-4000-8000-000000000001','Large yard',80,150,100,1);
insert into public.pricing_template_addons(id,template_id,addon_key,label,default_price,price_min,price_max) values
 ('99320000-0000-4000-8000-000000000001','99300000-0000-4000-8000-000000000001','haul_away','Haul away',10,5,20),
 ('99320000-0000-4000-8000-000000000002','99300000-0000-4000-8000-000000000001','edge_trim','Edge trimming',5,3,10);

create function pg_temp.u(n integer) returns uuid language sql as $$ select ('99100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql as $$ select ('99200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.pk(n integer) returns uuid language sql as $$ select ('99400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.tr(n integer) returns uuid language sql as $$ select ('99500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.ad(n integer) returns uuid language sql as $$ select ('99600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;

-- Providers n = 1..7 (users 3,4,7,8,9,10,11): offering, level, included work and add-ons.
--   P1 submitted: Small yard $60, required Haul away $10, optional Edge trimming $5; includes Mowing.
--   P2: Small yard $70, required Haul away $12; includes Mowing, Blowing        -> meets the required work.
--   P3: Large yard $90 only; includes Mowing                                    -> another level.
--   P4: Small yard $65, no Haul away; includes Mowing                           -> required add-on missing.
--   P5: custom offering (no template) $55; includes Mowing, Haul away           -> level not established.
--   P6: Small yard $75; includes Mowing, Haul away                              -> required add-on met by included work.
--   P7: Small yard $72, required Haul away $10; includes Blowing only           -> included work missing.
insert into public.contractors(id,user_id,name,is_active,marketing_enabled)
  select pg_temp.c(n), pg_temp.u((array[3,4,7,8,9,10,11])[n]), 'Synthetic fix provider P'||n, true, true from generate_series(1,7) n;
insert into public.contractor_service_zips(contractor_id,zip_code) select pg_temp.c(n),'00099' from generate_series(1,7) n;
insert into public.vendor_packages(id,contractor_id,service_id,template_id,name,pricing_mode,default_frequency,is_active,needs_review,included_scope)
  select pg_temp.pk(n), pg_temp.c(n), 'synthetic-o10fix-lawn',
    case when n = 5 then null else '99300000-0000-4000-8000-000000000001'::uuid end,
    'Synthetic fix lawn P'||n, 'fixed', 'one-time', false, false,
    (array['{Mowing}','{Mowing,Blowing}','{Mowing}','{Mowing}','{Mowing,"Haul away"}','{Mowing,"Haul away"}','{Blowing}'])[n]::text[]
  from generate_series(1,7) n;
insert into public.package_tiers(id,package_id,template_tier_id,name,price,frequency,sort_order,rule_conditions)
  select pg_temp.tr(n), pg_temp.pk(n),
    case n when 3 then '99310000-0000-4000-8000-000000000002'::uuid when 5 then null else '99310000-0000-4000-8000-000000000001'::uuid end,
    case n when 3 then 'Large yard' when 5 then 'Custom yard' else 'Small yard' end,
    (array[60,70,90,65,55,75,72])[n], 'one-time', 0, '[]'
  from generate_series(1,7) n;
insert into public.package_addons(id,package_id,template_addon_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 (pg_temp.ad(1),pg_temp.pk(1),'99320000-0000-4000-8000-000000000001','Haul away',10,'exact','visit',1,1,true,'{one-time}',0),
 (pg_temp.ad(2),pg_temp.pk(1),'99320000-0000-4000-8000-000000000002','Edge trimming',5,'exact','visit',0,1,false,'{one-time}',1),
 (pg_temp.ad(3),pg_temp.pk(2),'99320000-0000-4000-8000-000000000001','Haul away',12,'exact','visit',1,1,true,'{one-time}',0),
 (pg_temp.ad(7),pg_temp.pk(7),'99320000-0000-4000-8000-000000000001','Haul away',10,'exact','visit',1,1,true,'{one-time}',0);
update public.vendor_packages set is_active = true where id in (select pg_temp.pk(n) from generate_series(1,7) n);

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
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
create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
declare d text;
begin
  execute p_sql; return 'ok';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return sqlstate || ': ' || sqlerrm || coalesce(' [' || nullif(d, '') || ']', '');
end $f$;
-- A homeowner submits a one-time request for P1's Small yard ($60 + required haul $10 [+ edge $5]).
create function pg_temp.submit(p_user integer, p_key text, p_edge boolean) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00099'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'service_id','synthetic-o10fix-lawn','frequency','one-time','package_id',pg_temp.pk(1),'tier_id',pg_temp.tr(1),
      'addons',case when p_edge then jsonb_build_array(jsonb_build_object('id',pg_temp.ad(2),'quantity',1)) end,
      'expected',jsonb_build_object('pricing_mode','fixed','total',case when p_edge then 75 else 70 end)))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.request(p_id uuid) returns public.service_requests language sql as $$ select * from public.service_requests where id = p_id $$;
-- How candidate n would be offered for a request, with the gate on.
create function pg_temp.basis(p_request uuid, n integer) returns jsonb language sql as $$
  select private.one_time_offer_basis(pg_temp.request(p_request), pg_temp.c(n), pg_temp.pk(n), pg_temp.tr(n), 'fixed', null, true) $$;
create function pg_temp.missing(p_request uuid, n integer) returns text language sql as $$
  select coalesce(string_agg(m->>'kind' || coalesce(':' || coalesce(m->>'name', m->>'item'), ''), ',' order by m->>'kind', m->>'name', m->>'item'), '-')
  from jsonb_array_elements(pg_temp.basis(p_request, n)->'missing') m $$;
create function pg_temp.offer(p_request uuid) returns uuid language sql as $$ select private.offer_next_for_request_internal(p_request) $$;
create function pg_temp.accept(p_user integer, p_request uuid) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(%s, %L)', p_user, format('select to_jsonb(public.vendor_accept_job(%L))', p_request))) $$;
create function pg_temp.state(p_request uuid) returns text language sql as $$
  select concat_ws('/', r.status, r.matching_status, coalesce(c.name, '-'), coalesce(round(r.total_amount, 2)::text, '-'))
  from public.service_requests r left join public.contractors c on c.id = r.contractor_id where r.id = p_request $$;
create function pg_temp.terms_of(p_request uuid) returns public.job_offer_terms language sql as $$
  select t.* from public.job_offer_terms t join public.job_match_attempts a on a.id = t.offer_id
  where t.request_id = p_request order by a.attempt_number desc limit 1 $$;
create function pg_temp.respond(p_user integer, p_terms uuid, p_key text, p_accept boolean, p_expected jsonb) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(%s, %L)', p_user,
    format('select public.homeowner_respond_offer_terms(%L,%L,%L,%L::jsonb)', p_terms, p_key, p_accept, p_expected))) $$;
create function pg_temp.queue() returns jsonb language sql as $$ select pg_temp.call(5, 'select public.admin_offer_terms_queue()') $$;
create function pg_temp.queue_kind(p_request uuid) returns text language sql as $$
  select coalesce(string_agg(i->>'kind', ',' order by i->>'kind'), '-') from jsonb_array_elements(pg_temp.queue()->'items') i
  where i->>'request_id' = p_request::text $$;
create function pg_temp.retry(p_request uuid, p_key text) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(5, %L)',
    format('select public.admin_retry_offer_terms_matching(%L,%L,%L)', p_request, p_key, 'Synthetic retry after a failed re-match'))) $$;
create function pg_temp.review_terms(request uuid, p_version text) returns jsonb language sql as $$
  select jsonb_build_object('service',7000,'addons',0,'discount',0,'adjustment',0,'subtotal',7000,'tax',0,'tip',0,'deposit',0,
    'total',7000,'currency','usd','source_version',p_version,'policy_version','CFG-005','tax_evidence','synthetic-tax-decision',
    'reason','Synthetic review','expires_at',now()+interval '2 days') $$;
create function pg_temp.publish(request uuid, terms jsonb) returns uuid language plpgsql as $$
declare prior text := current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"99100000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('99100000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'99100000-0000-4000-8000-000000000005','99100000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.source_terms(request uuid) returns jsonb language sql as $$
  select jsonb_build_object('service',(s->>'service')::bigint,'addons',coalesce((s->>'addons')::bigint,0),'discount',0,'adjustment',0,
    'subtotal',(s->>'service')::bigint+coalesce((s->>'addons')::bigint,0),'tax',0,'tip',0,'deposit',0,
    'total',(s->>'service')::bigint+coalesce((s->>'addons')::bigint,0),'currency','usd','source_version',s->>'version',
    'policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic review','expires_at',now()+interval '2 days')
  from private.money_source(request) s $$;

select is((select enabled from private.money_feature_gates where name = 'offer_terms'), false, 'the offer_terms gate starts off');
select ok(not has_function_privilege('authenticated','private.offer_terms_required_work(public.service_requests,uuid,jsonb)','execute')
  and not has_function_privilege('authenticated','private.offer_terms_rematch(uuid,uuid,text)','execute')
  and not has_table_privilege('authenticated','private.offer_terms_rematch_failures','select'),
  'the required-work rule, the re-match wrapper and its record are not client-reachable');

-- 2. Missing binding evidence: refused by name at preview, publication and checkout ---------------------
-- While P1's offering is live, a request is submitted, offered and accepted on CS-3's bound path.
insert into fx values ('pay', pg_temp.submit(2, 'o10fix-pay-0000001', false));
select pg_temp.offer(pg_temp.id('pay'));
select is(pg_temp.accept(3, pg_temp.id('pay')), 'ok', 'P1 accepts the submitted terms');
select is((select split_part(s->>'version', ':', 1) || '/' || (s->>'service') || '/' || (s->>'addons') from private.money_source(pg_temp.id('pay')) s),
  'commercial-v2/6000/1000', 'with its submission record, the request is priced from the bound terms');
insert into fx values ('snap', pg_temp.publish(pg_temp.id('pay'), pg_temp.source_terms(pg_temp.id('pay'))));
select ok(pg_temp.id('snap') is not null, 'a snapshot is published while the evidence is present');
-- The evidence is removed (constructed directly; no product command does this).
update public.service_requests set pricing_inputs = null where id = pg_temp.id('pay');
select is(pg_temp.err(format('select private.money_source(%L)', pg_temp.id('pay'))),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'preview: without evidence the request is refused by name');
select is(pg_temp.err(format('select pg_temp.call(2, %L)', format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', pg_temp.id('snap')))),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'checkout: the published snapshot can''t be checked out once the evidence is gone; refused by name');
select is(pg_temp.err(format('select pg_temp.publish(%L, pg_temp.review_terms(%L, %L))', pg_temp.id('pay'), pg_temp.id('pay'), 'commercial-v1:synthetic')),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'publication: a new snapshot is refused by name');
select is((select count(*)::integer from public.money_checkout_attempts a join public.money_snapshots s on s.id = a.snapshot_id
    join public.money_obligations o on o.id = s.obligation_id where o.service_request_id = pg_temp.id('pay')), 0, 'no checkout attempt was written');
-- The earlier residue: a fixed one-time row with neither a submission record nor any offer, which the
-- current-catalog rule used to price. Constructed directly.
insert into fx values ('bare', '99700000-0000-4000-8000-000000000001');
insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,status,frequency,
    pricing_mode,package_id,package_tier_id,total_amount)
  values (pg_temp.id('bare'),pg_temp.u(2),pg_temp.c(2),'Synthetic fix lawn','synthetic-o10fix-lawn','1 Synthetic Way','Synthetic','FL','00099',
    'scheduled','one-time','fixed',pg_temp.pk(2),pg_temp.tr(2),82);
select is(pg_temp.err(format('select private.money_source(%L)', pg_temp.id('bare'))),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'a row with neither a submission record nor an offer is refused by name, not priced from the current catalog');
select is(pg_temp.err(format('select pg_temp.publish(%L, pg_temp.review_terms(%L, %L))', pg_temp.id('bare'), pg_temp.id('bare'), 'commercial-v1:synthetic')),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'and its publication is refused by name');
select is(pg_temp.err(format('select pg_temp.call(5, %L)', format('select public.money_preview_commercial_source(%L)', pg_temp.id('bare')))),
  'P0001: This request''s agreed price wasn''t recorded; a new request or quote is required [one_time:terms_missing]',
  'and the operator preview names the refusal');

-- 3. Required scope ---------------------------------------------------------------------------------------
-- Requests are submitted while P1's offering is live; then P1 pauses it, so matching looks at other providers.
insert into fx values ('r1', pg_temp.submit(1, 'o10fix-r1-00000001', true));
insert into fx values ('r2', pg_temp.submit(2, 'o10fix-r2-00000001', false));
select pg_temp.call(3, format('select public.vendor_set_package_active(%L,false,%L)', pg_temp.pk(1),
  (select updated_at from public.vendor_packages where id = pg_temp.pk(1))));
update private.money_feature_gates set enabled = true, reason = 'Synthetic activation' where name = 'offer_terms';
select is((select jsonb_build_object('level', (pricing_inputs->>'tier_id')::uuid = pg_temp.tr(1), 'included', pricing_inputs->'included_scope',
    'addons', (select jsonb_agg((l->>'name') || ':' || (l->>'required') order by l->>'name') from jsonb_array_elements(pricing_inputs->'lines') l where l->>'kind' = 'addon'))
  from public.service_requests where id = pg_temp.id('r1')),
  '{"level": true, "included": ["Mowing"], "addons": ["Edge trimming:false", "Haul away:true"]}'::jsonb,
  'the submission records the required work: the level, the included work, the required and optional add-ons');
select is(pg_temp.basis(pg_temp.id('r1'), 2)->>'basis', 'terms', 'P2: same template level, includes Mowing, its own required Haul away: offered');
select is(pg_temp.basis(pg_temp.id('r1'), 6)->>'basis', 'terms', 'P6: Haul away named in its included work: offered');
select is(pg_temp.basis(pg_temp.id('r1'), 4)->>'reason', 'required_work', 'P4: priced exactly, yet missing required work: refused');
select is(pg_temp.missing(pg_temp.id('r1'), 4), 'required_addon:Haul away', 'P4: the missing required add-on is named');
select is(pg_temp.missing(pg_temp.id('r1'), 3), 'level:Small yard,required_addon:Haul away', 'P3: another template level is not the submitted level (and it has no Haul away)');
select is(pg_temp.missing(pg_temp.id('r1'), 5), 'level:Small yard', 'P5: a custom level can''t establish a template level''s work');
select is(pg_temp.missing(pg_temp.id('r1'), 7), 'included:mowing', 'P7: included work missing (Mowing) is refused');
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,%L,%L,true)', pg_temp.id('r1'), pg_temp.c(4), pg_temp.pk(4), pg_temp.tr(4))),
  '22023: This offering doesn''t establish the work this request requires [offer_terms:required_work]',
  'even an operator force offer of P4 is refused by name');
-- Without a submission record nothing establishes the required work.
create function pg_temp.basis_without_record(p_request uuid, n integer) returns jsonb language plpgsql as $$
declare r public.service_requests := pg_temp.request(p_request);
begin
  r.pricing_inputs := null;
  return private.one_time_offer_basis(r, pg_temp.c(n), pg_temp.pk(n), pg_temp.tr(n), 'fixed', null, true);
end $$;
select is(pg_temp.basis_without_record(pg_temp.id('r1'), 2)->>'reason' || '|' || (pg_temp.basis_without_record(pg_temp.id('r1'), 2)#>>'{missing,0,kind}'),
  'required_work|submission', 'with no submission record, no candidate at other terms is offered');

-- Matching offers only a candidate that meets the required work; the optional add-on is disclosed.
select pg_temp.offer(pg_temp.id('r1'));
select ok((select contractor_id from public.service_requests where id = pg_temp.id('r1')) in (pg_temp.c(2), pg_temp.c(6)),
  'matching offers P2 or P6 and skips P3, P4, P5 and P7');
insert into fx select 'first', contractor_id from public.service_requests where id = pg_temp.id('r1');
insert into fx select 'second', case when pg_temp.id('first') = pg_temp.c(2) then pg_temp.c(6) else pg_temp.c(2) end;
select is((select t.terms->'exclusions'->'earlier_addons_not_included' from pg_temp.terms_of(pg_temp.id('r1')) t),
  format('[{"id": "%s", "name": "Edge trimming", "quantity": 1, "amount_cents": 500, "required_by_earlier_offering": false}]', pg_temp.ad(2))::jsonb,
  'the optional Edge trimming is omitted and disclosed, separately from the required work');
select is((select t.terms->>'version' || '|' || (t.terms#>'{scope,required_work,addons}'->0->>'name') || ':' || (t.terms#>'{scope,required_work,addons}'->0->>'met_by')
    || '|' || (t.terms#>>'{scope,required_work,included}') from pg_temp.terms_of(pg_temp.id('r1')) t),
  'offer-terms-v2|Haul away:' || case when pg_temp.id('first') = pg_temp.c(2) then 'line' else 'included_scope' end || '|["mowing"]',
  'the bound terms carry how the required work is met');

-- 1. A recorded decline survives a failed re-match ----------------------------------------------------------
select is(pg_temp.accept((select (array[3,4,7,8,9,10,11])[n] from generate_series(1,7) n where pg_temp.c(n) = pg_temp.id('first')), pg_temp.id('r1')),
  'ok', 'the offered provider accepts');
select is(split_part(pg_temp.state(pg_temp.id('r1')), '/', 2), 'awaiting_terms', 'the request waits for the homeowner');
insert into fx select 'terms', (pg_temp.terms_of(pg_temp.id('r1'))).id;
insert into fx select 'declined_offer', (pg_temp.terms_of(pg_temp.id('r1'))).offer_id;
-- Matching after the decline is forced to fail where offer creation writes its offer (as a provider
-- save between matching's selection and offer creation does; C22 runs that race for real).
create function pg_temp.refuse_offer() returns trigger language plpgsql as $$
begin
  raise exception 'Selected contractor/package is no longer eligible for this request';
end $$;
create trigger o10fix_refuse_offer before insert on public.job_match_attempts for each row execute function pg_temp.refuse_offer();
-- Without the fix the whole answer rolls back with the failure: the decline is lost.
select is(pg_temp.respond(1, pg_temp.id('terms'), '99800000-0000-4000-8000-000000000001', false,
    jsonb_build_object('terms_id', pg_temp.id('terms'), 'consent_hash', (pg_temp.terms_of(pg_temp.id('r1'))).consent_hash)),
  'ok', 'the homeowner''s decline succeeds although matching after it fails');
select is((select concat_ws('/', accepted::text, via) from public.job_offer_terms_responses where terms_id = pg_temp.id('terms')), 'false/terms',
  'the decline is recorded');
select is(pg_temp.state(pg_temp.id('r1')), 'pending/awaiting_match/-/' || (select round(total_amount, 2)::text from public.service_requests where id = pg_temp.id('r1')),
  'the provider stays unassigned and the request waits for matching');
select is((select outcome from public.job_match_attempts where id = pg_temp.id('declined_offer')), 'withdrawn', 'the declined offer stays withdrawn');
select is((select needs_admin_review from public.service_requests where id = pg_temp.id('r1')), true, 'the request is flagged for operations');
select is((select concat_ws('|', via, sqlstate, message, (terms_id = pg_temp.id('terms'))::text) from private.offer_terms_rematch_failures where request_id = pg_temp.id('r1')),
  'terms|P0001|Selected contractor/package is no longer eligible for this request|true', 'the failed re-match is recorded with its error');
select is((select count(*)::integer from public.job_events where job_id = pg_temp.id('r1') and metadata->>'action' = 'offer_terms_rematch_failed'), 1,
  'and logged on the request');
select is(pg_temp.queue_kind(pg_temp.id('r1')), 'rematch_failed', 'operations sees it in Offers at other terms');
-- The declined offer can't become actionable again.
select is(pg_temp.accept((select (array[3,4,7,8,9,10,11])[n] from generate_series(1,7) n where pg_temp.c(n) = pg_temp.id('first')), pg_temp.id('r1')),
  'P0001: No open offer is available to accept', 'the declined provider can''t accept again');
select is(pg_temp.respond(1, pg_temp.id('terms'), '99800000-0000-4000-8000-000000000002', true,
    jsonb_build_object('terms_id', pg_temp.id('terms'), 'consent_hash', (select consent_hash from public.job_offer_terms where id = pg_temp.id('terms')))),
  '22023: You already answered these terms', 'the homeowner can''t accept the declined terms afterwards');
select is(pg_temp.respond(1, pg_temp.id('terms'), '99800000-0000-4000-8000-000000000001', false,
    jsonb_build_object('terms_id', pg_temp.id('terms'), 'consent_hash', (select consent_hash from public.job_offer_terms where id = pg_temp.id('terms')))),
  'ok', 'a retry of the same answer replays it');
select is((select count(*)::integer from public.job_offer_terms_responses where terms_id = pg_temp.id('terms')), 1, 'one recorded answer');
select is(pg_temp.err(format('select private.money_source(%L)', pg_temp.id('r1'))), 'P0001: Scheduled commercial parties required',
  'nothing is payable');
-- Recovery: operations retries once matching can succeed; the gate being off doesn't stop it.
drop trigger o10fix_refuse_offer on public.job_match_attempts;
update private.money_feature_gates set enabled = false, reason = 'Synthetic switch-off' where name = 'offer_terms';
select is(pg_temp.err(format('select pg_temp.call(1, %L)', format('select public.admin_retry_offer_terms_matching(%L,%L,%L)',
    pg_temp.id('r1'), '99900000-0000-4000-8000-000000000001', 'Not an operator'))), '42501: Admin access required', 'only operations retries');
select is(pg_temp.retry(pg_temp.id('r1'), '99900000-0000-4000-8000-000000000001'), 'ok', 'the retry runs with the gate off');
select is(split_part(pg_temp.state(pg_temp.id('r1')), '/', 2), 'exhausted',
  'with the gate off, matching skips offers at other terms (recorded for recovery) and never re-offers the declined provider');
select is(pg_temp.queue_kind(pg_temp.id('r1')), 'blocked_inactive', 'the request moves from the failed re-match to the gate queue');
update private.money_feature_gates set enabled = true, reason = 'Synthetic activation' where name = 'offer_terms';
select is(pg_temp.retry(pg_temp.id('r1'), '99900000-0000-4000-8000-000000000002'), 'ok', 'after activation, the gate retry offers the request');
select is((select contractor_id from public.service_requests where id = pg_temp.id('r1')), pg_temp.id('second'),
  'it is offered to the other provider meeting the required work, never the declined one');
select is(pg_temp.queue_kind(pg_temp.id('r1')), '-', 'and leaves the operations queue');
select is(pg_temp.retry(pg_temp.id('r1'), '99900000-0000-4000-8000-000000000001'), 'ok', 'a retry key replays');
select is(pg_temp.retry(pg_temp.id('r1'), '99900000-0000-4000-8000-000000000003'), '22023: This request isn''t waiting on offers at other terms',
  'a new retry of a request no longer waiting is refused');

-- A decline whose re-match succeeds is unchanged: no failure is recorded.
select pg_temp.offer(pg_temp.id('r2'));
select is(pg_temp.accept((select (array[3,4,7,8,9,10,11])[n] from generate_series(1,7) n
    where pg_temp.c(n) = (select contractor_id from public.service_requests where id = pg_temp.id('r2'))), pg_temp.id('r2')), 'ok', 'r2 accepted by its provider');
select is(pg_temp.respond(2, (pg_temp.terms_of(pg_temp.id('r2'))).id, '99800000-0000-4000-8000-000000000010', false,
    jsonb_build_object('terms_id', (pg_temp.terms_of(pg_temp.id('r2'))).id, 'consent_hash', (pg_temp.terms_of(pg_temp.id('r2'))).consent_hash)),
  'ok', 'r2 declined');
select is(split_part(pg_temp.state(pg_temp.id('r2')), '/', 2), 'offered', 'matching after the decline offers the next provider');
select is((select count(*)::integer from private.offer_terms_rematch_failures where request_id = pg_temp.id('r2')), 0, 'no failure recorded');

select * from finish();
rollback;
