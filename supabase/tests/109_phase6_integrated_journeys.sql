-- Phase 6 closeout (integrated acceptance): the critical journeys run end to end through the real
-- commands of slices 6.1–6.13 instead of per-slice fixtures. request → offer → quote/schedule →
-- payment → start → completion → homeowner confirmation → review; a recurring plan with two visits;
-- cancellation and reschedule; provider withdrawal; support, dispute and appeal; vendor earnings.
-- Role boundaries, accepted terms, retries, cross-visit isolation and financial holds are checked
-- along the way. Payments are synthetic events only: nothing is sent to Stripe or a bank, no refund
-- or ACH is executed, and promotions stay refused. Rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 provider P, 4 provider Q, 5–6 operators with finance
-- authority (two-person review), 7 operator without finance authority.
insert into auth.users(id,email) select ('10900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'journey-'||n||'@example.invalid'
  from generate_series(1,7) n;
delete from public.user_roles where user_id in (select ('10900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(3,7) n);
insert into public.user_roles(user_id,role) values
 ('10900000-0000-4000-8000-000000000003','vendor'),('10900000-0000-4000-8000-000000000004','vendor'),
 ('10900000-0000-4000-8000-000000000005','admin'),('10900000-0000-4000-8000-000000000006','admin'),
 ('10900000-0000-4000-8000-000000000007','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('10900000-0000-4000-8000-000000000005','10900000-0000-4000-8000-000000000006','Synthetic'),
 ('10900000-0000-4000-8000-000000000006','10900000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-ij-cat','Synthetic journeys');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active,pricing_mode) values
 ('synthetic-ij-lawn','Synthetic journey lawn','synthetic-ij-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true,'fixed'),
 ('synthetic-ij-tree','Synthetic journey tree work','synthetic-ij-cat',0,null,0,'one-time','{one-time}',true,'custom_quote');
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00109','Synthetic',true,false);
insert into private.r0_lee_zips values ('00109');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('10900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00109',s,'10900000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n, unnest(array['synthetic-ij-lawn','synthetic-ij-tree']) s;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('10920000-0000-4000-8000-000000000001','10900000-0000-4000-8000-000000000003','Synthetic journey provider P',true,true),
 ('10920000-0000-4000-8000-000000000002','10900000-0000-4000-8000-000000000004','Synthetic journey provider Q',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('10920000-0000-4000-8000-000000000001','00109'),('10920000-0000-4000-8000-000000000002','00109');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('10940000-0000-4000-8000-000000000001','10920000-0000-4000-8000-000000000001','synthetic-ij-lawn','Synthetic journey lawn','fixed','weekly',true,false),
 ('10940000-0000-4000-8000-000000000002','10920000-0000-4000-8000-000000000001','synthetic-ij-tree','Synthetic journey tree quote','custom_quote','one-time',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('10950000-0000-4000-8000-000000000001','10940000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('10950000-0000-4000-8000-000000000002','10940000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]');

-- Harness (as SQL 098) ----------------------------------------------------------------------------
create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('10900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('10970000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
exception when others then
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  raise;
end $$;
-- The SQLSTATE a call raises, or 'ok'.
create function pg_temp.err(p_user integer, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.call(p_user, 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from ('||p_sql||') x');
  return 'ok';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.submit_raw(p_user integer, p_key text, p_selection jsonb) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00109'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(p_selection)))) $$;
create function pg_temp.lawn(p_frequency text, p_tier uuid, p_total numeric) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-ij-lawn','frequency',p_frequency,'package_id','10940000-0000-4000-8000-000000000001',
    'tier_id',p_tier,'preferred_contractor_id','10920000-0000-4000-8000-000000000001',
    'expected',jsonb_build_object('pricing_mode','fixed','total',p_total)) $$;
create function pg_temp.submit(p_user integer, p_key text, p_selection jsonb) returns uuid language sql as $$
  select (pg_temp.submit_raw(p_user, p_key, p_selection)#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.one_time(p_user integer, p_key text) returns uuid language sql as $$
  select pg_temp.submit(p_user, p_key, pg_temp.lawn('one-time','10950000-0000-4000-8000-000000000002',60)) $$;
create function pg_temp.offer(p_request uuid) returns void language sql as $$
  select private.offer_next_for_request_internal(p_request) $$;
create function pg_temp.accept(p_user integer, p_request uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select to_jsonb(public.vendor_accept_job(%L))', p_request)) $$;
create function pg_temp.day(n integer) returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + time '09:00' $$;
create function pg_temp.appointment(p_job uuid, p_key integer, p_day integer) returns jsonb language sql as $$
  select pg_temp.call(5, format('select public.admin_record_appointment(%L,%L,%L,%L,null,%L)',
    p_job, pg_temp.k(p_key), pg_temp.day(p_day) at time zone 'America/New_York', pg_temp.day(p_day), 'Synthetic: agreed by phone')) $$;
create function pg_temp.terms(request uuid, service bigint) returns jsonb language sql as $$
  select jsonb_build_object('service',service,'addons',0,'discount',0,'adjustment',0,'subtotal',service,'tax',0,'tip',0,
    'deposit',0,'total',service,'currency','usd','source_version',private.money_source(request)->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic journey review','expires_at',now()+interval '2 days') $$;
-- Two-person commercial review: operator 6 approves, operator 5 publishes.
create function pg_temp.publish(request uuid, cents bigint) returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request, cents); prior text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"10900000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('10900000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent journey review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'10900000-0000-4000-8000-000000000005','10900000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.checkout(p_user integer, p_snapshot uuid) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', p_snapshot))->>'id')::uuid $$;
-- A synthetic payment-provider event, received and processed as the webhook does (no network).
create function pg_temp.event(p_id text, p_type text, p_payload jsonb) returns text language plpgsql as $$
begin
  perform public.money_receive_event(p_id, p_type, p_payload);
  return public.money_process_event(p_id);
end $$;
create function pg_temp.pay(p_job uuid, p_cents bigint, p_n text) returns void language plpgsql as $$
declare attempt uuid := pg_temp.checkout(1, pg_temp.publish(p_job, p_cents));
begin
  perform pg_temp.event('evt_ij_cap_'||p_n,'capture',jsonb_build_object('attempt_id',attempt,'payment_id','pi_ij_'||p_n,'amount',p_cents,'currency','usd'));
end $$;
create function pg_temp.photo(p_uploader integer, p_job uuid, p_name text) returns text language plpgsql as $$
declare path text := pg_temp.u(p_uploader)::text||'/'||p_job::text||'/'||p_name;
begin
  insert into storage.objects(bucket_id, name, owner) values ('job-photos', path, pg_temp.u(p_uploader));
  return path;
end $$;
create function pg_temp.start(p_user integer, p_job uuid, p_key integer) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.start_job(%L,%L,null)', p_job, pg_temp.k(p_key))) $$;
create function pg_temp.complete(p_user integer, p_job uuid, p_paths text[]) returns text language sql as $$
  select pg_temp.err(p_user, format('select to_jsonb(public.vendor_complete_job(%L,%L))', p_job, p_paths)) $$;
create function pg_temp.done_at(p_job uuid) returns timestamptz language sql as $$ select vendor_completed_at from public.service_requests where id = p_job $$;
create function pg_temp.confirm(p_user integer, p_job uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_confirm_completion(%L,%L)', p_job, pg_temp.done_at(p_job))) $$;
create function pg_temp.st(p_job uuid) returns text language sql as $$ select status::text from public.service_requests where id = p_job $$;
create function pg_temp.obligation(p_job uuid) returns uuid language sql as $$ select id from public.money_obligations where service_request_id = p_job $$;
create function pg_temp.blocker(p_job uuid) returns text language sql as $$ select private.money_ach_payable(pg_temp.obligation(p_job))->>'blocker' $$;
create function pg_temp.earning(p_user integer, p_job uuid) returns jsonb language sql as $$
  select j from jsonb_array_elements(pg_temp.call(p_user, 'select public.vendor_own_earnings()')->'jobs') j where j->>'job_id' = p_job::text $$;
create function pg_temp.op(p_user integer, p_job uuid, p_key integer, p_kind text, p_expected jsonb default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.record_job_operation(%L,%L,%L,''Synthetic journey operation'',null,false,%L)',
    p_job, pg_temp.k(p_key), p_kind, p_expected)) $$;
create function pg_temp.preview(p_user integer, p_job uuid, p_kind text) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.job_cancellation_preview(%L,%L,false)', p_job, p_kind)) $$;
-- Money that must never move in these journeys.
create function pg_temp.money_moved() returns text language sql security definer as $$
  select concat_ws('|',(select count(*) from public.money_refund_authorizations),(select count(*) from public.money_refund_attempts),
    (select count(*) from public.money_ach_items),(select count(*) from public.money_ach_attempts)) $$;
create temp table money_start as select pg_temp.money_moved() as moved;

select pg_temp.call(5, $$select to_jsonb(public.set_completion_evidence_rule('synthetic-ij-lawn', 2, 'Synthetic two-photo rule'))$$);

-- J1 One-time fixed job: request → offer → schedule → payment → start → completion → confirmation → review
-- 6.1 submission: covered, eligible, priced on the server; a retry reuses its result.
insert into fx values ('j1', pg_temp.one_time(1, 'ij-j1-00000000001'));
select is(pg_temp.submit(1, 'ij-j1-00000000001', pg_temp.lawn('one-time','10950000-0000-4000-8000-000000000002',60)), pg_temp.id('j1'),
  'J1 submit: a retry with the same key returns the same request');
select is((select count(*)::int from public.service_requests where customer_id = pg_temp.u(1) and service_catalog_id = 'synthetic-ij-lawn'), 1,
  'J1 submit: exactly one request exists after the retry');
select is(pg_temp.submit_raw(1, 'ij-j1-00000000002', pg_temp.lawn('one-time','10950000-0000-4000-8000-000000000002',1))#>>'{outcomes,0,outcome}',
  'price_changed', 'J1 submit: a tampered total is refused and re-shown, never charged');
select is(pg_temp.call(2, format('select coalesce(jsonb_agg(r.id), ''[]'') from public.service_requests r where id = %L', pg_temp.id('j1'))),
  '[]'::jsonb, 'J1 isolation: another homeowner''s direct read returns no row (RLS)');
select is(pg_temp.err(1, format('select to_jsonb(r) from public.service_requests r where id = %L', pg_temp.id('j1'))), '42501',
  'J1 isolation: even the owner cannot select the closed notes column (6.13 column grants)');

-- 6.3 offer: the selected provider gets the exclusive offer; another provider cannot take it.
select pg_temp.offer(pg_temp.id('j1'));
select is((select matching_status from public.service_requests where id = pg_temp.id('j1')), 'offered', 'J1 offer: selected provider offered first');
select is(pg_temp.err(4, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('j1'))), 'P0001',
  'J1 offer: a provider without the offer cannot accept it');
select is(pg_temp.err(1, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('j1'))), 'P0001',
  'J1 offer: the homeowner cannot accept for the provider');
select pg_temp.accept(3, pg_temp.id('j1'));
select is(pg_temp.st(pg_temp.id('j1')), 'scheduled', 'J1 offer: provider P accepts; the job is scheduled');

-- 6.5 appointment: operators record it in Eastern Time; participants read it, others cannot.
select isnt(pg_temp.err(3, format('select public.admin_record_appointment(%L,%L,now()+interval ''5 days'',null,null,''x'')', pg_temp.id('j1'), pg_temp.k(10))),
  'ok', 'J1 appointment: the provider cannot record it');
select pg_temp.appointment(pg_temp.id('j1'), 11, 5);
select isnt(pg_temp.call(1, format('select public.job_schedule(%L)', pg_temp.id('j1')))->'appointment', 'null'::jsonb,
  'J1 appointment: homeowner reads the recorded appointment');
select isnt(pg_temp.call(3, format('select public.job_schedule(%L)', pg_temp.id('j1')))->'appointment', 'null'::jsonb,
  'J1 appointment: assigned provider reads it');
select is(pg_temp.err(2, format('select public.job_schedule(%L)', pg_temp.id('j1'))), '42501', 'J1 appointment: another homeowner is refused');
select is(pg_temp.err(4, format('select public.job_schedule(%L)', pg_temp.id('j1'))), '42501', 'J1 appointment: another provider is refused');

-- Payment (Phase 5 kernel, synthetic events): the reviewed terms are the ones accepted.
insert into fx values ('j1-snap', pg_temp.publish(pg_temp.id('j1'), 6000));
select is(pg_temp.err(2, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', pg_temp.id('j1-snap'))), '42501',
  'J1 payment: another homeowner cannot check out this job');
insert into fx values ('j1-attempt', pg_temp.checkout(1, pg_temp.id('j1-snap')));
select is(pg_temp.checkout(1, pg_temp.id('j1-snap')), pg_temp.id('j1-attempt'), 'J1 payment: a checkout retry reuses the same attempt');
select pg_temp.event('evt_ij_cap_j1','capture',jsonb_build_object('attempt_id',pg_temp.id('j1-attempt'),'payment_id','pi_ij_j1','amount',6000,'currency','usd'));
select is((select captured::bigint from public.money_obligations where id = pg_temp.obligation(pg_temp.id('j1'))), 6000::bigint, 'J1 payment: captured in full');
select pg_temp.event('evt_ij_cap_j1','capture',jsonb_build_object('attempt_id',pg_temp.id('j1-attempt'),'payment_id','pi_ij_j1','amount',6000,'currency','usd'));
select is((select captured::bigint from public.money_obligations where id = pg_temp.obligation(pg_temp.id('j1'))), 6000::bigint,
  'J1 payment: a duplicate webhook event captures nothing twice');
select is((select total::bigint from public.money_snapshots where id = pg_temp.id('j1-snap')), 6000::bigint,
  'J1 accepted terms: the reviewed snapshot holds the accepted $60.00');

-- 6.7 start: only the assigned provider (or operations); a retry replays.
select is(pg_temp.err(4, format('select public.start_job(%L,%L,null)', pg_temp.id('j1'), pg_temp.k(20))), '42501', 'J1 start: another provider is refused');
select is(pg_temp.err(1, format('select public.start_job(%L,%L,null)', pg_temp.id('j1'), pg_temp.k(20))), '42501', 'J1 start: the homeowner is refused');
insert into fx values ('j1-start-event', (pg_temp.start(3, pg_temp.id('j1'), 21)->>'event_id')::uuid);
select is(pg_temp.start(3, pg_temp.id('j1'), 21)->>'event_id', pg_temp.id('j1-start-event')::text, 'J1 start: a retry with the same key replays the same start');
select is(pg_temp.st(pg_temp.id('j1')), 'in_progress', 'J1 start: work is in progress');
select is((select metadata#>>'{payment_at_start,state}' from public.job_events where job_id = pg_temp.id('j1') and metadata->>'to' = 'in_progress' limit 1),
  'paid', 'J1 start: the start event records the payment state (paid)');

-- 6.7 completion: this job's own stored evidence, from its own provider, under the two-photo rule.
insert into fx values ('j1-other', pg_temp.one_time(1, 'ij-j1-other-0001'));
select is(pg_temp.complete(3, pg_temp.id('j1'), array[pg_temp.photo(3, pg_temp.id('j1'), 'a.jpg')]), 'P0001', 'J1 completion: one photo under a two-photo rule is refused');
select is(pg_temp.complete(3, pg_temp.id('j1'), array[pg_temp.photo(3, pg_temp.id('j1'), 'b.jpg'), pg_temp.photo(3, pg_temp.id('j1-other'), 'x.jpg')]), '22023',
  'J1 completion: a photo stored for another job is refused');
select is(pg_temp.complete(4, pg_temp.id('j1'), array[pg_temp.u(3)::text||'/'||pg_temp.id('j1')||'/a.jpg', pg_temp.u(3)::text||'/'||pg_temp.id('j1')||'/b.jpg']), 'P0001',
  'J1 completion: another provider cannot complete the job');
select is(pg_temp.complete(3, pg_temp.id('j1'), array[pg_temp.u(3)::text||'/'||pg_temp.id('j1')||'/a.jpg', pg_temp.u(3)::text||'/'||pg_temp.id('j1')||'/b.jpg']), 'ok',
  'J1 completion: provider P completes with two of its own photos');
select is(pg_temp.st(pg_temp.id('j1')), 'vendor_completed', 'J1 completion: awaiting homeowner confirmation');
select is(pg_temp.blocker(pg_temp.id('j1')) is not null, true, 'J1 hold: no payout before homeowner confirmation');

-- 6.7 confirmation: bound to the completion the homeowner reviewed; others refused; retry safe.
select is(pg_temp.err(2, format('select public.homeowner_confirm_completion(%L,%L)', pg_temp.id('j1'), pg_temp.done_at(pg_temp.id('j1')))), '42501',
  'J1 confirmation: another homeowner is refused');
select is(pg_temp.err(3, format('select public.homeowner_confirm_completion(%L,%L)', pg_temp.id('j1'), pg_temp.done_at(pg_temp.id('j1')))), '42501',
  'J1 confirmation: the provider cannot confirm its own work');
select is(pg_temp.err(1, format('select public.homeowner_confirm_completion(%L,%L)', pg_temp.id('j1'), pg_temp.done_at(pg_temp.id('j1')) - interval '1 minute')), '40001',
  'J1 confirmation: a stale view of the completion is refused');
select is(pg_temp.confirm(1, pg_temp.id('j1'))->>'outcome', 'confirmed', 'J1 confirmation: the homeowner confirms');
select is(pg_temp.confirm(1, pg_temp.id('j1'))->>'outcome', 'replayed', 'J1 confirmation: a retry replays the confirmation');
select is((select count(*)::int from public.money_lifecycle_confirmations where request_id = pg_temp.id('j1')), 1, 'J1 confirmation: one immutable confirmation receipt');
select is(pg_temp.st(pg_temp.id('j1')), 'completed', 'J1 confirmation: the job is completed');

-- Payout (CFG-008): eligible only 48 h after confirmation; nothing executes here.
select isnt(pg_temp.blocker(pg_temp.id('j1')), null, 'J1 hold: inside the 48-hour window the payout is still blocked');
select is(pg_temp.earning(3, pg_temp.id('j1'))->>'job_id', pg_temp.id('j1')::text, 'J1 earnings: provider P sees the job in its earnings');
select is(pg_temp.earning(4, pg_temp.id('j1')), null, 'J1 earnings: provider Q does not see P''s job');

-- 6.8 review: one verified review by the confirming homeowner; public summary from verified reviews.
select is(pg_temp.call(1, format('select public.service_review(%L)', pg_temp.id('j1')))->>'eligibility', 'eligible', 'J1 review: the confirmed job is eligible');
select is(pg_temp.err(2, format('select to_jsonb(public.submit_job_review(%L,5,''x''))', pg_temp.id('j1'))), '42501', 'J1 review: another homeowner cannot review');
select is(pg_temp.err(3, format('select to_jsonb(public.submit_job_review(%L,5,''x''))', pg_temp.id('j1'))), '42501', 'J1 review: the provider cannot review itself');
select is(pg_temp.err(1, format('select to_jsonb(public.submit_job_review(%L,5,''Synthetic: edges were tidy''))', pg_temp.id('j1'))), 'ok', 'J1 review: the homeowner reviews');
select is(pg_temp.err(1, format('select to_jsonb(public.submit_job_review(%L,5,''Synthetic: edges were tidy''))', pg_temp.id('j1'))), 'ok', 'J1 review: a retry is safe');
select is((select count(*)::int from public.reviews where service_request_id = pg_temp.id('j1')), 1, 'J1 review: exactly one review');
select is((select review_count from public.public_review_summaries(array['10920000-0000-4000-8000-000000000001'::uuid])), 1,
  'J1 review: the public summary counts the verified review');

-- J2 Quote: proposal → operator send → homeowner approval refused while tax is pending ----------
insert into fx values ('j2', pg_temp.submit(1, 'ij-j2-00000000001', jsonb_build_object('service_id','synthetic-ij-tree','frequency','one-time',
  'package_id','10940000-0000-4000-8000-000000000002','preferred_contractor_id','10920000-0000-4000-8000-000000000001',
  'expected',jsonb_build_object('pricing_mode','quote'))));
select is((select pricing_mode from public.service_requests where id = pg_temp.id('j2')), 'custom_quote', 'J2 submit: a quote request with no price');
select pg_temp.offer(pg_temp.id('j2'));
select pg_temp.accept(3, pg_temp.id('j2'));
select is(pg_temp.err(4, format('select public.vendor_propose_quote(%L,''[{"kind":"labor","description":"Limb removal","quantity":1,"unit_cents":30000}]'',''Scope'',0)', pg_temp.id('j2'))),
  '42501', 'J2 quote: a provider not assigned cannot propose');
select is(pg_temp.err(3, format('select public.vendor_propose_quote(%L,''[{"kind":"labor","description":"Limb removal","quantity":1,"unit_cents":30000}]'',''Scope'',0)', pg_temp.id('j2'))),
  'ok', 'J2 quote: the assigned provider proposes an itemized estimate');
select is(pg_temp.err(5, format('select public.admin_send_itemized_quote(%L,''[{"kind":"labor","description":"Limb removal","quantity":1,"unit_cents":30000}]'',''Scope'',''Send'',0)', pg_temp.id('j2'))),
  'ok', 'J2 quote: an operator sends the itemized quote');
select is(pg_temp.err(1, format('select public.homeowner_respond_to_quote(%L,true,(select current_quote_id from public.service_requests where id=%L))', pg_temp.id('j2'), pg_temp.id('j2'))),
  '22023', 'J2 quote (GAP, DEC-2026-015 §4): approval is refused while tax is pending; no command confirms tax');
select is(pg_temp.obligation(pg_temp.id('j2')), null, 'J2 quote: no payment obligation exists for the unapproved quote');

-- J3 Recurring plan: two visits, each its own identity, payment, evidence and confirmation --------
insert into fx values ('plan', pg_temp.submit(1, 'ij-plan-0000000001', pg_temp.lawn('weekly','10950000-0000-4000-8000-000000000001',40)));
select pg_temp.offer(pg_temp.id('plan'));
select pg_temp.accept(3, pg_temp.id('plan'));
insert into fx values ('v1', (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)', pg_temp.id('plan'), pg_temp.k(30),
  pg_temp.day(3) at time zone 'America/New_York', pg_temp.day(3), 'Synthetic visit 1'))->>'occurrence_id')::uuid);
select is((pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)', pg_temp.id('plan'), pg_temp.k(30),
  pg_temp.day(3) at time zone 'America/New_York', pg_temp.day(3), 'Synthetic visit 1'))->>'occurrence_id')::uuid, pg_temp.id('v1'),
  'J3 recurring: a retried visit creation returns the same visit');
insert into fx values ('v2', (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)', pg_temp.id('plan'), pg_temp.k(31),
  pg_temp.day(10) at time zone 'America/New_York', pg_temp.day(10), 'Synthetic visit 2'))->>'occurrence_id')::uuid);
select isnt(pg_temp.id('v1'), pg_temp.id('v2'), 'J3 recurring: two distinct visit identities');
select is(pg_temp.err(4, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('v1'))), 'P0001', 'J3 recurring: only the plan provider can accept a visit');
select pg_temp.accept(3, pg_temp.id('v1'));
select pg_temp.accept(3, pg_temp.id('v2'));
select pg_temp.pay(pg_temp.id('v1'), 4000, 'v1');
select is((select captured::bigint from public.money_obligations where id = pg_temp.obligation(pg_temp.id('v1'))), 4000::bigint, 'J3 recurring: visit 1 is paid at the plan price');
select is((select coalesce(captured,0)::bigint from public.money_obligations where service_request_id = pg_temp.id('v2')), null,
  'J3 isolation: visit 2 has no payment from visit 1');
select pg_temp.start(3, pg_temp.id('v1'), 32);
select is(pg_temp.complete(3, pg_temp.id('v1'), array[pg_temp.photo(3, pg_temp.id('v2'), 'a.jpg'), pg_temp.photo(3, pg_temp.id('v2'), 'b.jpg')]), '22023',
  'J3 isolation: visit 2''s photos cannot complete visit 1');
select is(pg_temp.complete(3, pg_temp.id('v1'), array[pg_temp.photo(3, pg_temp.id('v1'), 'a.jpg'), pg_temp.photo(3, pg_temp.id('v1'), 'b.jpg')]), 'ok',
  'J3 recurring: visit 1 completes with its own photos');
select is(pg_temp.confirm(1, pg_temp.id('v1'))->>'outcome', 'confirmed', 'J3 recurring: the homeowner confirms visit 1');
select is(pg_temp.st(pg_temp.id('v2')), 'scheduled', 'J3 isolation: confirming visit 1 leaves visit 2 scheduled');
select is((select count(*)::int from public.money_lifecycle_confirmations where request_id = pg_temp.id('v2')), 0, 'J3 isolation: no confirmation receipt for visit 2');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.call(5, 'select public.admin_recurring_payment_queue()')->'items') i
  where i->>'request_id' = pg_temp.id('v2')::text), 'J3 recurring: unpaid visit 2 (10 days out) is not queued before appointment − 24 h (DEC-2026-049 item 5)');
-- DEC-2026-050 A (approved by DEC-2026-060 D-4; CS-5): a recurring visit starts only when paid.
select is(pg_temp.err(3, format('select public.start_job(%L,%L,null)', pg_temp.id('v2'), pg_temp.k(33))), '22023',
  'J3 (CS-5, DEC-2026-050 A): an unpaid visit cannot be started');
select is(pg_temp.st(pg_temp.id('v2')), 'scheduled', 'J3: the unpaid visit stays scheduled, with no start event');

-- J4 Cancellation and reschedule (CFG-006) ------------------------------------------------------
insert into fx values ('j4', pg_temp.one_time(1, 'ij-j4-00000000001'));
select pg_temp.offer(pg_temp.id('j4'));
select pg_temp.accept(3, pg_temp.id('j4'));
select pg_temp.appointment(pg_temp.id('j4'), 40, 6);
select pg_temp.pay(pg_temp.id('j4'), 6000, 'j4');
select is(pg_temp.preview(1, pg_temp.id('j4'), 'reschedule_request')#>>'{assessment,fee}', '0', 'J4 reschedule: ≥ 48 h before the appointment is free');
select is(pg_temp.err(2, format('select public.job_cancellation_preview(%L,''customer_cancel'',false)', pg_temp.id('j4'))), '42501',
  'J4 cancellation: another homeowner cannot preview');
create temp table j4_preview as select pg_temp.preview(1, pg_temp.id('j4'), 'customer_cancel') p;
select is((select p#>>'{assessment,refund_percent}' from j4_preview), '100', 'J4 cancellation: ≥ 72 h before the appointment refunds 100%');
select is(pg_temp.err(1, format('select public.record_job_operation(%L,%L,''customer_cancel'',''x'',null,false,%L)', pg_temp.id('j4'), pg_temp.k(41),
  '{"stale":true}')), '40001', 'J4 cancellation: a stale preview is refused');
insert into fx values ('j4-op', (pg_temp.op(1, pg_temp.id('j4'), 42, 'customer_cancel', (select p->'expected' from j4_preview))->>'operation_id')::uuid);
select isnt(pg_temp.id('j4-op'), null, 'J4 cancellation: the homeowner cancels');
select is((pg_temp.op(1, pg_temp.id('j4'), 42, 'customer_cancel', (select p->'expected' from j4_preview))->>'operation_id')::uuid, pg_temp.id('j4-op'),
  'J4 cancellation: a retry replays the same operation');
select is(pg_temp.st(pg_temp.id('j4')), 'cancelled', 'J4 cancellation: the job is cancelled');
select is(pg_temp.call(1, format('select public.job_cancellation_outcome(%L)', pg_temp.id('j4')))#>>'{entitlement,refund_percent}', '100',
  'J4 cancellation: the outcome records a 100% refund entitlement');
select is(pg_temp.call(1, format('select public.job_cancellation_outcome(%L)', pg_temp.id('j4')))#>>'{authorization,state}', 'none',
  'J4 hold: the entitlement is not executed; refund authorization stays with the reviewed two-person command');

-- J5 Provider withdrawal (CFG-007, DEC-2026-053 E5/E12) -----------------------------------------
insert into fx values ('j5', pg_temp.one_time(1, 'ij-j5-00000000001'));
select pg_temp.offer(pg_temp.id('j5'));
select pg_temp.accept(3, pg_temp.id('j5'));
select pg_temp.appointment(pg_temp.id('j5'), 50, 6);
select pg_temp.pay(pg_temp.id('j5'), 6000, 'j5');
select is(pg_temp.err(4, format('select public.record_job_operation(%L,%L,''provider_cancel'',''x'',null,false)', pg_temp.id('j5'), pg_temp.k(51))), '42501',
  'J5 withdrawal: another provider cannot withdraw P from the job');
select is(pg_temp.err(3, format('select public.record_job_operation(%L,%L,''provider_cancel'',''Synthetic: truck broke down'',null,false)', pg_temp.id('j5'), pg_temp.k(52))), 'ok',
  'J5 withdrawal: provider P withdraws');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.call(5, 'select public.admin_provider_quality_events()')->'items') e
  where e->>'job_id' = pg_temp.id('j5')::text), 'J5 withdrawal: a provider quality event is recorded');
create temp table j5_preview as select pg_temp.preview(1, pg_temp.id('j5'), 'customer_cancel') p;
select is(pg_temp.op(1, pg_temp.id('j5'), 53, 'customer_cancel', (select p->'expected' from j5_preview))->>'basis', 'provider_withdrawal_open',
  'J5 withdrawal: cancelling while a replacement is open is a provider withdrawal, not a homeowner cancellation');
select is(pg_temp.call(1, format('select public.job_cancellation_outcome(%L)', pg_temp.id('j5')))#>>'{entitlement,refund_percent}', '100',
  'J5 withdrawal: the homeowner is entitled to a full refund, no penalty (E12)');

-- J6 Support, dispute, evidence, decision and appeal (6.10) -------------------------------------
insert into fx values ('j6', pg_temp.one_time(1, 'ij-j6-00000000001'));
select pg_temp.offer(pg_temp.id('j6'));
select pg_temp.accept(3, pg_temp.id('j6'));
select pg_temp.pay(pg_temp.id('j6'), 6000, 'j6');
select pg_temp.start(3, pg_temp.id('j6'), 60);
select pg_temp.complete(3, pg_temp.id('j6'), array[pg_temp.photo(3, pg_temp.id('j6'), 'a.jpg'), pg_temp.photo(3, pg_temp.id('j6'), 'b.jpg')]) = 'ok' as completed;
select is(pg_temp.err(2, format('select public.homeowner_dispute_completion(%L,%L,''x'')', pg_temp.id('j6'), pg_temp.done_at(pg_temp.id('j6')))), '42501',
  'J6 dispute: another homeowner cannot report an issue');
select is(pg_temp.call(1, format('select public.homeowner_dispute_completion(%L,%L,''Synthetic: back corner missed'')', pg_temp.id('j6'), pg_temp.done_at(pg_temp.id('j6'))))->>'outcome',
  'disputed', 'J6 dispute: the homeowner reports an issue within 48 hours');
insert into fx values ('d6', (select id from public.disputes where job_id = pg_temp.id('j6')));
select isnt(pg_temp.blocker(pg_temp.id('j6')), null, 'J6 hold: the disputed job''s payout is held');
select is(pg_temp.earning(3, pg_temp.id('j6')) is not null, true, 'J6 earnings: the provider sees the held job');
select is(pg_temp.err(2, format('select public.dispute_detail(%L)', pg_temp.id('j6'))), '42501', 'J6 dispute: another homeowner cannot read it');
select is(pg_temp.err(4, format('select public.dispute_detail(%L)', pg_temp.id('j6'))), '42501', 'J6 dispute: another provider cannot read it');
select is(pg_temp.call(3, format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d6'), pg_temp.k(61), 'Synthetic: corner done, see photos'))->'replayed',
  'false'::jsonb, 'J6 evidence: the provider adds a statement');
select is(pg_temp.call(3, format('select public.add_dispute_submission(%L,%L,%L,null)', pg_temp.id('d6'), pg_temp.k(61), 'Synthetic: corner done, see photos'))->'replayed',
  'true'::jsonb, 'J6 evidence: a retry replays');
select is(pg_temp.err(1, format('select public.admin_decide_dispute(%L,%L,''open'',0,''resolved'',''Self'')', pg_temp.id('d6'), pg_temp.k(62))), '42501',
  'J6 decision: the homeowner cannot decide its own dispute');
select is(pg_temp.call(5, format('select public.admin_decide_dispute(%L,%L,''open'',0,''resolved'',''Synthetic: provider returns to finish'')', pg_temp.id('d6'), pg_temp.k(63)))->>'status',
  'resolved', 'J6 decision: operations resolves the dispute');
select is(pg_temp.err(1, format('select to_jsonb(public.appeal_dispute_resolution(%L,''Synthetic: still not done'',1))', pg_temp.id('d6'))), 'ok',
  'J6 appeal: the homeowner appeals the decision');
select is(pg_temp.err(4, format('select to_jsonb(public.appeal_dispute_resolution(%L,''x'',1))', pg_temp.id('d6'))), '42501',
  'J6 appeal: an unrelated provider cannot appeal');
select is(pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(64), 'Synthetic question', 'When is my refund shown?'))->'replayed',
  'false'::jsonb, 'J6 support: a general support ticket opens');
select is(pg_temp.call(1, format('select public.open_support_ticket(%L,%L,%L,null)', pg_temp.k(64), 'Synthetic question', 'When is my refund shown?'))->'replayed',
  'true'::jsonb, 'J6 support: a retry replays');

-- Operator boundary and financial invariants --------------------------------------------------------
select is((select q->>'state' from jsonb_array_elements(pg_temp.call(7, 'select public.admin_operations_summary()')->'queues') q where q->>'queue' = 'finance_exceptions'), 'restricted',
  'Operators: an admin without finance authority sees the finance queue as restricted');
select is(pg_temp.err(1, 'select public.admin_operations_summary()'), '42501', 'Operators: a homeowner cannot read the operations summary');
select is(pg_temp.money_moved(), (select moved from money_start),
  'Money: no refund was authorized or attempted and no ACH item or transfer was created by any journey');
select is((select count(*)::int from public.money_checkout_attempts a join public.money_obligations o on o.id = a.obligation_id
  where o.service_request_id = pg_temp.id('j1')), 1, 'Money: J1 has one checkout attempt despite retries');

select * from finish();
rollback;
