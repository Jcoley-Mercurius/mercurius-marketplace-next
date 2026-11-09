-- O-10 / TRACE-150 (DEC-2026-063, approved 2026-11-08 with O-11 and P-3): one-time fixed requests
-- offered at terms other than those priced at submission. The offer binds that provider's complete
-- commercial terms when it is created; the provider accepts first; only the homeowner's keyed
-- acceptance of that exact offer, terms row and consent hash schedules it and makes it payable;
-- declining re-matches without offering the same content again. Catalog edits never reprice; live
-- refusals block by name. While the owner's offer_terms gate is off, no such offer is created and no
-- request enters 'awaiting_terms'; requests left without an offer are recovered after activation.
-- Every action goes through the real commands. Synthetic data only; amounts are test examples.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 provider P1 (submitted), 4 provider P2 (other terms),
-- 5-6 operators and finance actors, 7 provider P3 (can't meet the request's scope), 8 provider P4.
insert into auth.users(id,email) select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'o10-'||n||'@example.invalid'
  from generate_series(1,8) n;
delete from public.user_roles where user_id in (select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from unnest(array[3,4,5,6,7,8]) n);
insert into public.user_roles(user_id,role) values
 ('98100000-0000-4000-8000-000000000003','vendor'),('98100000-0000-4000-8000-000000000004','vendor'),
 ('98100000-0000-4000-8000-000000000007','vendor'),('98100000-0000-4000-8000-000000000008','vendor'),
 ('98100000-0000-4000-8000-000000000005','admin'),('98100000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('98100000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000006','Synthetic'),
 ('98100000-0000-4000-8000-000000000006','98100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-o10-cat','Synthetic offer terms');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-o10-lawn','Synthetic terms lawn','synthetic-o10-cat',60,40,120,'weekly','{one-time,weekly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00098','Synthetic',true,false);
insert into private.r0_lee_zips values ('00098');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00098','synthetic-o10-lawn','98100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000003','Synthetic submitted provider',true,true),
 ('98200000-0000-4000-8000-000000000002','98100000-0000-4000-8000-000000000004','Synthetic other provider',true,true),
 ('98200000-0000-4000-8000-000000000003','98100000-0000-4000-8000-000000000007','Synthetic scoped provider',true,true),
 ('98200000-0000-4000-8000-000000000004','98100000-0000-4000-8000-000000000008','Synthetic replacement provider',true,false);
insert into public.contractor_service_zips(contractor_id,zip_code)
  select ('98200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00098' from generate_series(1,4) n;
insert into public.vendor_packages(id,contractor_id,service_id,name,description,pricing_mode,default_frequency,is_active,needs_review,included_scope,policy_notes) values
 ('98400000-0000-4000-8000-000000000001','98200000-0000-4000-8000-000000000001','synthetic-o10-lawn','Synthetic submitted lawn',null,'fixed','weekly',true,false,'{Mowing}',null),
 ('98400000-0000-4000-8000-000000000002','98200000-0000-4000-8000-000000000002','synthetic-o10-lawn','Synthetic other lawn','Mow and haul','fixed','one-time',true,false,'{Mowing,Edging}','Synthetic policy notes'),
 ('98400000-0000-4000-8000-000000000003','98200000-0000-4000-8000-000000000003','synthetic-o10-lawn','Synthetic scoped lawn',null,'fixed','one-time',true,false,'{}',null),
 ('98400000-0000-4000-8000-000000000004','98200000-0000-4000-8000-000000000004','synthetic-o10-lawn','Synthetic replacement lawn',null,'fixed','one-time',true,false,'{Mowing}',null);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('98500000-0000-4000-8000-000000000001','98400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('98500000-0000-4000-8000-000000000002','98400000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]'),
 ('98500000-0000-4000-8000-000000000003','98400000-0000-4000-8000-000000000002','Standard',70,'one-time',0,'[]'),
 ('98500000-0000-4000-8000-000000000004','98400000-0000-4000-8000-000000000003','Scoped',50,'one-time',0,'[]'),
 ('98500000-0000-4000-8000-000000000005','98400000-0000-4000-8000-000000000004','Replacement',60,'one-time',0,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('98600000-0000-4000-8000-000000000001','98400000-0000-4000-8000-000000000001','Edge trimming',5,'exact','visit',0,1,false,'{weekly,one-time}',0),
 ('98600000-0000-4000-8000-000000000002','98400000-0000-4000-8000-000000000002','Haul away',10,'exact','visit',1,1,true,'{one-time}',0);
-- Required work (20261118001000, finding 3): the submitted offering names its included work (Mowing),
-- which P2 and the replacement P4 include; without it no candidate at other terms is offered.
-- P3's offering needs an answer the request doesn't give: it can't meet the request's scope (P-3).
insert into public.package_qualifying_questions(package_id,question_key,question_label,input_type,is_required)
  values ('98400000-0000-4000-8000-000000000003','gate_code','Gate code','text',true);

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql as $$ select ('98200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
-- A homeowner submits a one-time request for P1's offering ($60, + $5 edge trimming when p_addon).
create function pg_temp.submit(p_user integer, p_key text, p_addon boolean) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00098'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'service_id','synthetic-o10-lawn','frequency','one-time','package_id','98400000-0000-4000-8000-000000000001',
      'tier_id','98500000-0000-4000-8000-000000000002',
      'addons',case when p_addon then jsonb_build_array(jsonb_build_object('id','98600000-0000-4000-8000-000000000001','quantity',1)) end,
      'expected',jsonb_build_object('pricing_mode','fixed','total',case when p_addon then 65 else 60 end)))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.offer(p_request uuid) returns uuid language sql as $$ select private.offer_next_for_request_internal(p_request) $$;
create function pg_temp.accept(p_user integer, p_request uuid) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(%s, %L)', p_user, format('select to_jsonb(public.vendor_accept_job(%L))', p_request))) $$;
create function pg_temp.state(p_request uuid) returns text language sql as $$
  select concat_ws('/', r.status, r.matching_status, coalesce(c.name, '-'), coalesce(round(r.total_amount, 2)::text, '-'))
  from public.service_requests r left join public.contractors c on c.id = r.contractor_id where r.id = p_request $$;
create function pg_temp.terms_of(p_request uuid) returns public.job_offer_terms language sql as $$
  select t.* from public.job_offer_terms t join public.job_match_attempts a on a.id = t.offer_id
  where t.request_id = p_request order by a.attempt_number desc limit 1 $$;
create function pg_temp.expected(p_request uuid) returns jsonb language sql as $$
  select jsonb_build_object('terms_id', t.id, 'consent_hash', t.consent_hash) from pg_temp.terms_of(p_request) t $$;
create function pg_temp.respond(p_user integer, p_terms uuid, p_key uuid, p_accept boolean, p_expected jsonb, p_reason text default null) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(%s, %L)', p_user,
    format('select public.homeowner_respond_offer_terms(%L,%L,%L,%L::jsonb,%L)', p_terms, p_key, p_accept, p_expected, p_reason))) $$;
create function pg_temp.respond_json(p_user integer, p_terms uuid, p_key uuid, p_accept boolean, p_expected jsonb, p_reason text default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_respond_offer_terms(%L,%L,%L,%L::jsonb,%L)', p_terms, p_key, p_accept, p_expected, p_reason)) $$;
create function pg_temp.key(n integer) returns uuid language sql as $$ select ('98700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.head(p_lineage uuid) returns uuid language sql security definer as $$
  select id from public.vendor_packages where coalesce(lineage_id, id) = p_lineage order by revision_number desc limit 1 $$;
-- A provider saves and publishes its offering's head revision through vendor_save_package.
create function pg_temp.save(p_user integer, p_lineage uuid, p_content jsonb, p_key text) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.vendor_save_package(%L,%L,%L::jsonb,true,%L)',
    pg_temp.head(p_lineage), private.package_revision_hash(pg_temp.head(p_lineage)), p_content, p_key)) $$;
create function pg_temp.p1_content(p_one numeric) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-o10-lawn',
    'package', jsonb_build_object('name','Synthetic submitted lawn','description',null,'pricing_mode','fixed','default_frequency','weekly',
      'included_scope',jsonb_build_array('Mowing')),
    'questions','[]'::jsonb,
    'tiers', jsonb_build_array(jsonb_build_object('name','Weekly','price',40,'frequency','weekly'),
      jsonb_build_object('name','One time','price',p_one,'frequency','one-time')),
    'addons', jsonb_build_array(jsonb_build_object('name','Edge trimming','price',5,'frequencies',jsonb_build_array('weekly','one-time')))) $$;
create function pg_temp.p2_content(p_price numeric) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-o10-lawn',
    'package', jsonb_build_object('name','Synthetic other lawn','description','Mow and haul','pricing_mode','fixed','default_frequency','one-time',
      'included_scope',jsonb_build_array('Mowing','Edging'),'policy_notes','Synthetic policy notes'),
    'questions','[]'::jsonb,
    'tiers', jsonb_build_array(jsonb_build_object('name','Standard','price',p_price,'frequency','one-time')),
    'addons', jsonb_build_array(jsonb_build_object('name','Haul away','price',10,'is_required',true,'min_quantity',1,'max_quantity',1,
      'frequencies',jsonb_build_array('one-time')))) $$;
create function pg_temp.p1_pause() returns jsonb language sql as $$
  select pg_temp.call(3, format('select public.vendor_set_package_active(%L,false,%L)', pg_temp.head('98400000-0000-4000-8000-000000000001'),
    (select updated_at from public.vendor_packages where id = pg_temp.head('98400000-0000-4000-8000-000000000001')))) $$;
create function pg_temp.gate(p_on boolean, p_reason text) returns void language sql as $$
  update private.money_feature_gates set enabled = p_on, reason = p_reason where name = 'offer_terms' $$;
create function pg_temp.terms_for_review(request uuid) returns jsonb language sql as $$
  select jsonb_build_object('service',(s->>'service')::bigint,'addons',coalesce((s->>'addons')::bigint,0),'discount',0,'adjustment',0,
    'subtotal',(s->>'service')::bigint+coalesce((s->>'addons')::bigint,0),'tax',0,'tip',0,'deposit',0,
    'total',(s->>'service')::bigint+coalesce((s->>'addons')::bigint,0),'currency','usd','source_version',s->>'version',
    'policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic review','expires_at',now()+interval '2 days')
  from private.money_source(request) s $$;
create function pg_temp.publish(request uuid) returns uuid language plpgsql as $$
declare terms jsonb := pg_temp.terms_for_review(request); prior text := current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"98100000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('98100000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'98100000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.queue() returns jsonb language sql as $$ select pg_temp.call(5, 'select public.admin_offer_terms_queue()') $$;
create function pg_temp.queue_kind(p_request uuid) returns text language sql as $$
  select i->>'kind' from jsonb_array_elements(pg_temp.queue()->'items') i where i->>'request_id' = p_request::text limit 1 $$;
create function pg_temp.op(p_sql text) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(5, %L)', p_sql)) $$;

-- Access -----------------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.homeowner_respond_offer_terms(uuid,uuid,boolean,jsonb,text)','execute')
  and not has_function_privilege('anon','public.homeowner_respond_offer_terms(uuid,uuid,boolean,jsonb,text)','execute'),
  'the homeowner''s answer is signed-in only');
select ok(not has_function_privilege('authenticated','private.one_time_offer_basis(public.service_requests,uuid,uuid,uuid,text,uuid,boolean)','execute')
  and not has_function_privilege('authenticated','private.offer_terms_problem(public.service_requests,public.job_match_attempts,public.job_offer_terms)','execute')
  and not has_function_privilege('authenticated','private.offer_terms_build(public.service_requests,uuid,uuid,uuid)','execute'),
  'the binding and checking rules are not client-callable');
select ok(not has_table_privilege('authenticated','public.job_offer_terms','insert')
  and not has_table_privilege('authenticated','public.job_offer_terms','update')
  and not has_table_privilege('authenticated','public.job_offer_terms_responses','insert'),
  'no client writes bound terms or answers');
select is((select enabled from private.money_feature_gates where name = 'offer_terms'), false, 'the offer_terms gate starts off');

-- Gate off: no offer at other terms; the request is recorded for recovery -----------------------------------
-- Every request is submitted while P1's offering is live; P1 pauses it before matching, so matching
-- has to look at other providers.
insert into fx values ('r1', pg_temp.submit(1, 'o10-r1-00000000001', true));
insert into fx values ('r2', pg_temp.submit(2, 'o10-r2-00000000001', false));
insert into fx values ('r3', pg_temp.submit(1, 'o10-r3-00000000001', false));
insert into fx values ('r4', pg_temp.submit(2, 'o10-r4-00000000001', false));
insert into fx values ('r5', pg_temp.submit(2, 'o10-r5-00000000001', false));
insert into fx values ('r6', pg_temp.submit(1, 'o10-r6-00000000001', false));
select is((select count(*) from fx where id is not null), 6::bigint, 'six one-time requests submitted for P1''s offering');
select pg_temp.p1_pause();
select is(pg_temp.offer(pg_temp.id('r1')), null::uuid, 'gate off: no offer at other terms is made');
select is(pg_temp.state(pg_temp.id('r1')), 'pending/exhausted/-/65.00', 'gate off: the request is left without an offer (Not available yet)');
select is((select count(*) from public.job_offer_terms where request_id = pg_temp.id('r1')), 0::bigint, 'gate off: no terms are bound');
select is((select count(*) from private.offer_terms_blocks where request_id = pg_temp.id('r1')), 1::bigint, 'gate off: the request is recorded for recovery');
select is(pg_temp.queue_kind(pg_temp.id('r1')), 'blocked_inactive', 'operations sees it as waiting on activation');
select is(pg_temp.op(format('select public.admin_retry_offer_terms_matching(%L,%L,%L)', pg_temp.id('r1'), pg_temp.key(1), 'Synthetic retry')),
  '22023: Offers at other terms are not active yet [offer_terms:inactive]', 'the retry is refused while the gate is off');
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,true)', pg_temp.id('r1'), pg_temp.c(2))),
  'P0001: Selected contractor/package is no longer eligible for this request',
  'gate off: a request priced with add-ons lists no other-terms candidate, so a force offer is refused');
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,true)', pg_temp.id('r3'), pg_temp.c(2))),
  '22023: Offers at terms other than the submitted ones are not active yet [offer_terms:inactive]',
  'gate off: an operator force offer at other terms is refused by name');

-- P-2 (gate off): the same provider's newer revision is offered at the submitted terms ---------------------
select pg_temp.save(3, '98400000-0000-4000-8000-000000000001', pg_temp.p1_content(66), 'o10-p1-save-000001');
select ok(pg_temp.offer(pg_temp.id('r2')) is not null, 'P-2: the same provider''s live revision is offered');
select is((select row(a.package_id, round(a.base_price,2), round(a.effective_price,2))::text from public.job_match_attempts a
    where a.service_request_id = pg_temp.id('r2') and a.outcome = 'pending'),
  '(98400000-0000-4000-8000-000000000001,60.00,60.00)', 'P-2: at the submitted row, level and $60 (not the newer $66)');
select is(pg_temp.accept(3, pg_temp.id('r2')), 'ok', 'P-2: the provider accepts');
select is(pg_temp.state(pg_temp.id('r2')), 'scheduled/matched/Synthetic submitted provider/60.00', 'P-2: scheduled at the submitted terms, no new consent');
select is((select count(*) from public.job_offer_terms where request_id = pg_temp.id('r2')), 0::bigint, 'P-2: no other terms are bound');
select is((select concat_ws('/', s->>'service', split_part(s->>'version', ':', 1)) from private.money_source(pg_temp.id('r2')) s),
  '6000/commercial-v2', 'P-2: payable at the submitted $60');
select pg_temp.p1_pause();

-- The owner turns the gate on (audited) ---------------------------------------------------------------------
select is(pg_temp.err($$update private.money_feature_gates set enabled = true, reason = null where name = 'offer_terms'$$),
  '22023: Changing the offer_terms gate needs a reason', 'changing the gate needs a reason');
select pg_temp.gate(true, 'Synthetic owner activation');
select is((select count(*) from private.money_feature_gate_events where name = 'offer_terms' and enabled and reason = 'Synthetic owner activation'),
  1::bigint, 'the activation is recorded');
select is(pg_temp.err($$update private.money_feature_gate_events set reason = 'x' where name = 'offer_terms'$$),
  '42501: Gate history is append-only', 'gate history is append-only');

-- Recovery: the operator retries the blocked request; terms are bound at offer creation ---------------------
select is((pg_temp.call(5, format('select public.admin_retry_offer_terms_matching(%L,%L,%L)', pg_temp.id('r1'), pg_temp.key(2), 'Synthetic retry')))->>'matching_status',
  'offered', 'recovery: after activation the retry offers the request');
select is((pg_temp.call(5, format('select public.admin_retry_offer_terms_matching(%L,%L,%L)', pg_temp.id('r1'), pg_temp.key(2), 'Synthetic retry')))->>'replayed',
  'true', 'recovery: a retried retry is replayed');
select is(pg_temp.queue_kind(pg_temp.id('r1')), null, 'recovery: it leaves the queue');
select is(pg_temp.state(pg_temp.id('r1')), 'matched/offered/Synthetic other provider/80.00', 'P2 is offered at its own complete price, $70 + required $10');
select is((select row(t.level_cents, t.addon_cents, t.total_cents, t.terms#>>'{offering,revision}' = private.package_revision_hash(t.package_id))::text
    from pg_temp.terms_of(pg_temp.id('r1')) t), '(7000,1000,8000,t)', 'the bound terms name the exact revision and amounts');
select is((select t.terms->'exclusions'->'earlier_addons_not_included' from pg_temp.terms_of(pg_temp.id('r1')) t),
  '[{"id": "98600000-0000-4000-8000-000000000001", "name": "Edge trimming", "quantity": 1, "amount_cents": 500, "required_by_earlier_offering": false}]'::jsonb,
  'P-3: the earlier optional add-on is not carried, and is disclosed');
select is((select concat_ws('|', t.terms->'exclusions'->>'promotion', t.terms#>>'{scope,included}', t.terms#>>'{offering,policy_notes}',
    (select string_agg(l->>'name' || ':' || (l->>'required'), ',') from jsonb_array_elements(t.terms->'lines') l))
    from pg_temp.terms_of(pg_temp.id('r1')) t),
  'none|["Edging", "Mowing"]|Synthetic policy notes|Standard:true,Haul away:true', 'complete scope: included work, policy, the provider''s required add-on, no promotion');
select is((select count(*) from public.job_match_attempts where service_request_id = pg_temp.id('r1') and contractor_id = pg_temp.c(3)), 0::bigint,
  'P-3: a provider that can''t meet the request''s required scope is skipped');
select ok((select t.consent_hash <> t.content_hash and t.consent_hash = private.offer_terms_consent_hash(t.request_id, t.offer_id, t.id, t.content_hash)
    from pg_temp.terms_of(pg_temp.id('r1')) t), 'the consent hash is identity-bound and separate from the content hash');
select is(pg_temp.err(format($$update public.job_offer_terms set total_cents = 1 where id = %L$$, (pg_temp.terms_of(pg_temp.id('r1'))).id)),
  '42501: Bound terms and answers are append-only; changed terms need a new offer', 'bound terms are append-only');

-- A catalog edit after binding doesn't reprice ------------------------------------------------------------------
select pg_temp.save(4, '98400000-0000-4000-8000-000000000002', pg_temp.p2_content(90), 'o10-p2-save-000001');
select is(pg_temp.accept(4, pg_temp.id('r1')), 'ok', 'P2 accepts after a price edit');
select is(pg_temp.state(pg_temp.id('r1')), 'matched/awaiting_terms/Synthetic other provider/80.00',
  'provider acceptance waits for the homeowner, at the bound $80 (not the edited $100)');

-- Provider acceptance is not consent: nothing schedules, starts or charges ---------------------------------------
select is(pg_temp.err(format('select private.money_source(%L)', pg_temp.id('r1'))),
  'P0001: Scheduled commercial parties required', 'no payment source while terms are pending');
select is(pg_temp.op(format('select public.admin_transition_job_status_expected(%L,%L,%L,''scheduled'',''Synthetic'')', pg_temp.id('r1'),
    (select updated_at from public.service_requests where id = pg_temp.id('r1')), pg_temp.key(5))),
  '42501: The homeowner must accept this provider''s terms first [offer_terms:awaiting_homeowner]', 'an operator can''t schedule it');
select ok(pg_temp.err(format('select pg_temp.call(4, %L)', format('select to_jsonb(public.start_job(%L,%L,''Synthetic start''))', pg_temp.id('r1'), pg_temp.key(6)))) <> 'ok',
  'the provider can''t start it');
select is((select status::text from public.service_requests where id = pg_temp.id('r1')), 'matched', 'and nothing started or scheduled');
select is(pg_temp.err(format('select pg_temp.call(1, %L)', format('select public.record_job_operation(%L,%L,''reschedule_request'',''Synthetic'',now()+interval ''3 days'')',
    pg_temp.id('r1'), pg_temp.key(3)))), '42501: The homeowner must accept this provider''s terms first [offer_terms:awaiting_homeowner]',
  'no reschedule request while terms are pending');
select is(pg_temp.op(format('select public.admin_record_appointment(%L,%L,%L,%L,null,''Synthetic'')', pg_temp.id('r1'), pg_temp.key(4),
    date_trunc('minute', now() + interval '3 days'), (date_trunc('minute', now() + interval '3 days') at time zone 'America/New_York'))),
  '22023: An appointment can be recorded only after a provider accepts and before work starts',
  'no appointment while terms are pending (the appointment command refuses first; the guards back it)');
select is(pg_temp.err(format($$update public.service_requests set status = 'scheduled' where id = %L$$, pg_temp.id('r1'))),
  '42501: The homeowner must accept this provider''s terms first [offer_terms:awaiting_homeowner]', 'no direct write schedules it either');
select is(pg_temp.err(format($$update public.service_requests set matching_status = 'awaiting_terms' where id = %L$$, pg_temp.id('r2'))),
  '42501: Only a provider''s acceptance of bound terms waits for the homeowner', 'only the acceptance command enters awaiting_terms');

-- The homeowner's answer: identity, staleness, retries ------------------------------------------------------------
insert into fx values ('t1', (pg_temp.terms_of(pg_temp.id('r1'))).id);
select is(pg_temp.respond(2, pg_temp.id('t1'), pg_temp.key(10), true, pg_temp.expected(pg_temp.id('r1'))),
  '42501: Only the homeowner can answer these terms', 'another homeowner can''t answer');
select is(pg_temp.respond(4, pg_temp.id('t1'), pg_temp.key(10), true, pg_temp.expected(pg_temp.id('r1'))),
  '42501: Only the homeowner can answer these terms', 'the provider can''t answer for the homeowner');
select is(pg_temp.respond(1, pg_temp.id('t1'), pg_temp.key(10), true, jsonb_build_object('terms_id', pg_temp.id('t1'), 'consent_hash', (pg_temp.terms_of(pg_temp.id('r1'))).content_hash)),
  '40001: These terms changed since you opened them. Review the current terms.', 'the content hash is not the consent hash: refused as stale');
select is(pg_temp.respond(1, pg_temp.id('t1'), pg_temp.key(10), true, pg_temp.expected(pg_temp.id('r1'))), 'ok', 'the homeowner accepts the exact terms');
select is(pg_temp.state(pg_temp.id('r1')), 'scheduled/matched/Synthetic other provider/80.00', 'now it is scheduled');
select is(pg_temp.respond_json(1, pg_temp.id('t1'), pg_temp.key(10), true, pg_temp.expected(pg_temp.id('r1')))->>'replayed', 'true', 'a retry is replayed');
select is(pg_temp.respond(1, pg_temp.id('t1'), pg_temp.key(10), false, pg_temp.expected(pg_temp.id('r1'))),
  '22023: Response key reused with different intent', 'the same key with another answer is refused');
select is(pg_temp.respond(1, pg_temp.id('t1'), pg_temp.key(11), false, pg_temp.expected(pg_temp.id('r1'))),
  '22023: You already answered these terms', 'a second answer is refused');
select is((select count(*) from public.job_offer_terms_responses where terms_id = pg_temp.id('t1')), 1::bigint, 'exactly one answer');

-- Payment uses the accepted terms only, and later edits don't move it -------------------------------------------
select is((select concat_ws('/', s->>'service', s->>'addons', split_part(s->>'version', ':', 1), s->'offer_terms'->>'terms_id' = pg_temp.id('t1')::text)
    from private.money_source(pg_temp.id('r1')) s), '7000/1000/commercial-v2/t', 'payable at the accepted $70 + $10');
create temp table h as select private.money_source(pg_temp.id('r1'))->>'version' as v;
select pg_temp.save(4, '98400000-0000-4000-8000-000000000002', pg_temp.p2_content(95), 'o10-p2-save-000002');
select is(private.money_source(pg_temp.id('r1'))->>'version', (select v from h), 'a later edit leaves the source hash unchanged');
select ok(pg_temp.publish(pg_temp.id('r1')) is not null, 'the two-person review publishes the accepted amounts');

-- Decline: withdraw, re-match, no identical re-offer, fresh consent for changed terms ------------------------------
select ok(pg_temp.offer(pg_temp.id('r3')) is not null, 'r3 is offered to P2 (P1 paused)');
select is(pg_temp.accept(4, pg_temp.id('r3')), 'ok', 'P2 accepts r3');
insert into fx values ('t3', (pg_temp.terms_of(pg_temp.id('r3'))).id);
select is(pg_temp.respond(1, pg_temp.id('t3'), pg_temp.key(20), false, pg_temp.expected(pg_temp.id('r3')), 'Too expensive'), 'ok', 'the homeowner declines');
select is(pg_temp.state(pg_temp.id('r3')), 'pending/exhausted/-/105.00', 'withdrawn and re-matched (no other eligible provider: not available yet)');
select is((select outcome || ':' || reason from public.job_match_attempts where id = (select offer_id from public.job_offer_terms where id = pg_temp.id('t3'))),
  'withdrawn:Homeowner declined the terms', 'the accepted offer is withdrawn');
select is((pg_temp.call(4, format('select to_jsonb(count(*)) from public.service_requests where id = %L', pg_temp.id('r3'))))::text, '0',
  'the declined provider no longer sees the request (disclosure ends with the assignment)');
select is((pg_temp.call(4, format('select to_jsonb(count(*)) from public.job_offer_terms where id = %L', pg_temp.id('t3'))))::text, '1',
  'but keeps its own offer''s terms record');
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,true)', pg_temp.id('r3'), pg_temp.c(2))),
  '22023: The homeowner declined these terms [offer_terms:declined]', 'the same terms are not offered again, even by force');
select pg_temp.save(4, '98400000-0000-4000-8000-000000000002', pg_temp.p2_content(85), 'o10-p2-save-000003');
select ok(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,true)', pg_temp.id('r3'), pg_temp.c(2))) = 'ok',
  'changed terms can be offered by force');
select ok((pg_temp.terms_of(pg_temp.id('r3'))).id <> pg_temp.id('t3') and (pg_temp.terms_of(pg_temp.id('r3'))).total_cents = 9500,
  'as a new terms row at the new price');
select is(pg_temp.accept(4, pg_temp.id('r3')), 'ok', 'P2 accepts the changed terms');
select is(pg_temp.respond(1, (pg_temp.terms_of(pg_temp.id('r3'))).id, pg_temp.key(21), true,
    jsonb_build_object('terms_id', pg_temp.id('t3'), 'consent_hash', (select consent_hash from public.job_offer_terms where id = pg_temp.id('t3')))),
  '40001: These terms changed since you opened them. Review the current terms.', 'the earlier consent doesn''t carry to the new terms');

-- Changed eligibility while pending: refused by name, nothing written; decline still possible ----------------------
update public.contractors set is_active = false where id = pg_temp.c(2);
select is(pg_temp.respond(1, (pg_temp.terms_of(pg_temp.id('r3'))).id, pg_temp.key(22), true, pg_temp.expected(pg_temp.id('r3'))),
  '22023: This provider can''t take the service at these terms right now. You can decline them; Mercurius will follow up. [offer_terms:provider_inactive]',
  'acceptance is refused by name when the provider is suspended');
select is((select count(*) from public.job_offer_terms_responses where request_id = pg_temp.id('r3') and response_key = pg_temp.key(22)), 0::bigint, 'nothing is written');
select is(pg_temp.queue_kind(pg_temp.id('r3')), 'not_acceptable', 'operations sees terms that can''t be accepted');
update public.contractors set is_active = true where id = pg_temp.c(2);

-- Unanswered after 24 hours (O-11): operations sees it; nothing changes automatically -----------------------------
select is(pg_temp.queue_kind(pg_temp.id('r3')), null, 'not in the queue before 24 hours');
update public.job_match_attempts set accepted_at = now() - interval '25 hours' where id = (pg_temp.terms_of(pg_temp.id('r3'))).offer_id;
select is(pg_temp.queue_kind(pg_temp.id('r3')), 'unanswered', 'after 24 hours operations sees it unanswered');
select is((select matching_status from public.service_requests where id = pg_temp.id('r3')), 'awaiting_terms', 'and it still waits for the homeowner');

-- Switch-off while pending: no new entry into awaiting_terms; pending answers still work --------------------------
select ok(pg_temp.offer(pg_temp.id('r4')) is not null, 'r4 is offered to P2 at other terms');
select pg_temp.gate(false, 'Synthetic switch-off');
select is(pg_temp.accept(4, pg_temp.id('r4')), '22023: Offers at other terms are paused; Mercurius will follow up [offer_terms:inactive]',
  'gate off: a pending offer at other terms can''t be accepted');
select is(pg_temp.respond(1, (pg_temp.terms_of(pg_temp.id('r3'))).id, pg_temp.key(23), true, pg_temp.expected(pg_temp.id('r3'))), 'ok',
  'gate off: terms already accepted by the provider can still be answered');
select pg_temp.gate(true, 'Synthetic reactivation');

-- Provider withdrawal and force offer while pending ----------------------------------------------------------------
select is(pg_temp.accept(4, pg_temp.id('r4')), 'ok', 'P2 accepts r4 once active');
select is(pg_temp.err(format('select pg_temp.call(4, %L)', format('select public.record_job_operation(%L,%L,''provider_cancel'',''Synthetic withdrawal'')',
    pg_temp.id('r4'), pg_temp.key(30)))), 'ok', 'P2 withdraws before the homeowner answers');
select is(pg_temp.state(pg_temp.id('r4')), 'pending/exhausted/-/95.00', 'an ordinary re-match follows (P-9)');
select is((select private.provider_withdrawal_open(r) from public.service_requests r where r.id = pg_temp.id('r4')), false,
  'not an E5/E6 replacement');
select is((select outcome from public.job_match_attempts where id = (pg_temp.terms_of(pg_temp.id('r4'))).offer_id), 'withdrawn', 'the accepted offer is withdrawn');
select is(pg_temp.respond(2, (pg_temp.terms_of(pg_temp.id('r4'))).id, pg_temp.key(31), true, pg_temp.expected(pg_temp.id('r4'))),
  '40001: These terms changed since you opened them. Review the current terms.', 'an answer to withdrawn terms is stale');

select pg_temp.offer(pg_temp.id('r5'));
select is(pg_temp.accept(4, pg_temp.id('r5')), 'ok', 'P2 accepts r5');
insert into fx values ('t5', (pg_temp.terms_of(pg_temp.id('r5'))).id);
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,false)', pg_temp.id('r5'), pg_temp.c(4))),
  '22023: The homeowner must answer this provider''s terms first', 'no automatic new offer while terms are pending');
update public.contractors set marketing_enabled = true where id = pg_temp.c(4);
select is(pg_temp.err(format('select private.create_job_offer_internal(%L,%L,null,null,true)', pg_temp.id('r5'), pg_temp.c(4))), 'ok',
  'an operator force offer supersedes the pending terms');
select is(pg_temp.respond(2, pg_temp.id('t5'), pg_temp.key(40), true,
    jsonb_build_object('terms_id', pg_temp.id('t5'), 'consent_hash', (select consent_hash from public.job_offer_terms where id = pg_temp.id('t5')))),
  '40001: These terms changed since you opened them. Review the current terms.', 'the superseded terms can''t be accepted');
update public.contractors set marketing_enabled = false where id = pg_temp.c(4);

-- Cancellation while pending -------------------------------------------------------------------------------------
select pg_temp.offer(pg_temp.id('r6'));
select is(pg_temp.accept(4, pg_temp.id('r6')), 'ok', 'P2 accepts r6');
select is(pg_temp.err(format('select pg_temp.call(1, %L)', format('select public.record_job_operation(%L,%L,''customer_cancel'',''Synthetic cancel'')',
    pg_temp.id('r6'), pg_temp.key(50)))), 'ok', 'the homeowner can cancel while terms are pending');
select is((select status::text from public.service_requests where id = pg_temp.id('r6')), 'cancelled', 'cancelled');

-- E6 replacement of another provider carries bound terms; the homeowner's answer records them (P-5) ----
-- r2 is scheduled with P1 at the submitted $60. P1 withdraws; P4 (same $60, other offering) is the only
-- eligible replacement while P2 is off the marketplace.
update public.contractors set marketing_enabled = false where id = pg_temp.c(2);
update public.contractors set marketing_enabled = true where id = pg_temp.c(4);
select is(pg_temp.err(format('select pg_temp.call(3, %L)', format('select public.record_job_operation(%L,%L,''provider_cancel'',''Synthetic withdrawal'')',
    pg_temp.id('r2'), pg_temp.key(60)))), 'ok', 'E6: P1 withdraws from a scheduled request');
select is((select row(t.contractor_id = pg_temp.c(4), t.total_cents)::text from pg_temp.terms_of(pg_temp.id('r2')) t), '(t,6000)',
  'E6: the replacement offer binds P4''s complete terms ($60)');
select is(pg_temp.accept(8, pg_temp.id('r2')), 'ok', 'E6: P4 accepts');
select is((select matching_status from public.service_requests where id = pg_temp.id('r2')), 'awaiting_homeowner', 'E6: the replacement flow, not awaiting_terms');
insert into fx select 'p2', ((pg_temp.call(5, format('select to_jsonb(public.admin_propose_replacement(%L,%L,%L,%L,%L::jsonb,''Synthetic proposal''))',
    pg_temp.id('r2'), pg_temp.key(61), date_trunc('minute', now() + interval '4 days'),
    (date_trunc('minute', now() + interval '4 days') at time zone 'America/New_York'),
    jsonb_build_object('contractor_id', pg_temp.c(4), 'proposal_id', null))))->>'id')::uuid;
select ok(pg_temp.id('p2') is not null, 'E6: operations proposes the replacement at the agreed amount');
select is((pg_temp.call(2, format('select public.job_schedule(%L)', pg_temp.id('r2'))))#>>'{replacement,expected,consent_hash}',
  (pg_temp.terms_of(pg_temp.id('r2'))).consent_hash, 'E6: the homeowner''s screen is given the bound terms to name');
select is(((pg_temp.call(2, format('select public.job_schedule(%L)', pg_temp.id('r2'))))#>>'{replacement,proposal,terms,total_cents}')::bigint,
  6000::bigint, 'E6: and shows them');
select is(pg_temp.err(format('select pg_temp.call(2, %L)', format('select public.homeowner_respond_replacement(%L,%L,true,%L::jsonb)', pg_temp.id('p2'), pg_temp.key(62),
    (select jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id, 'starts_at', p.starts_at) from public.job_replacement_proposals p where p.id = pg_temp.id('p2'))))),
  '40001: This proposal changed since you opened it. Review the current details.', 'E6: an answer that doesn''t name the bound terms is refused as stale');
select is(pg_temp.err(format('select pg_temp.call(2, %L)', format('select public.homeowner_respond_replacement(%L,%L,true,%L::jsonb)', pg_temp.id('p2'), pg_temp.key(62),
    (select jsonb_build_object('proposal_id', p.id, 'contractor_id', p.contractor_id, 'starts_at', p.starts_at) from public.job_replacement_proposals p where p.id = pg_temp.id('p2'))
      || pg_temp.expected(pg_temp.id('r2'))))), 'ok', 'E6: the homeowner accepts the provider, time and bound terms');
select is((select row(x.accepted, x.via, x.consent_hash = t.consent_hash)::text from public.job_offer_terms_responses x
    join public.job_offer_terms t on t.id = x.terms_id where x.request_id = pg_temp.id('r2')), '(t,replacement,t)', 'E6: the terms answer is recorded');
select is((select concat_ws('/', s->>'service', split_part(s->>'version', ':', 1), s ? 'offer_terms') from private.money_source(pg_temp.id('r2')) s),
  '6000/commercial-v2/t', 'E6: payable from the replacement''s accepted terms');
update public.contractors set marketing_enabled = true where id = pg_temp.c(2);
update public.contractors set marketing_enabled = false where id = pg_temp.c(4);

-- Promotions never move to other terms ------------------------------------------------------------------------------
select is((select private.one_time_offer_basis(r, pg_temp.c(2), '98400000-0000-4000-8000-000000000002', '98500000-0000-4000-8000-000000000003', 'fixed',
    '98400000-0000-4000-8000-000000000002', true)->>'reason' from public.service_requests r where r.id = pg_temp.id('r6')),
  'promotion', 'a candidate carrying a promotion is never offered at other terms');

select * from finish();
rollback;
