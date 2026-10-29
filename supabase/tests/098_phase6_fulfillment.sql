-- Phase 6.7 / TRACE-128: provider fulfillment, completion evidence and homeowner confirmation on a
-- one-time job and on individual recurring visits. Work starts only on an accepted assignment by its
-- provider or operations; completion needs this visit's own evidence; the homeowner's decision is
-- bound to the completion they reviewed; payout keeps the confirmation + 48 h and hold guards. The
-- unpaid-start matrix is characterized as unchanged (DEC-2026-050 open). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 plan provider, 4 other provider, 5–6 operators (and the two
-- finance actors).
insert into auth.users(id,email) select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fulfillment-'||n||'@example.invalid'
  from generate_series(1,6) n;
delete from public.user_roles where user_id in ('98100000-0000-4000-8000-000000000003','98100000-0000-4000-8000-000000000004','98100000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('98100000-0000-4000-8000-000000000003','vendor'),('98100000-0000-4000-8000-000000000004','vendor'),
 ('98100000-0000-4000-8000-000000000005','admin'),('98100000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('98100000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000006','Synthetic'),
 ('98100000-0000-4000-8000-000000000006','98100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-ff-cat','Synthetic fulfillment');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-ff-lawn','Synthetic fulfillment lawn','synthetic-ff-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00098','Synthetic',true,false);
insert into private.r0_lee_zips values ('00098');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00098','synthetic-ff-lawn','98100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('98200000-0000-4000-8000-000000000001','98100000-0000-4000-8000-000000000003','Synthetic plan provider',true,true),
 ('98200000-0000-4000-8000-000000000002','98100000-0000-4000-8000-000000000004','Synthetic other provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('98200000-0000-4000-8000-000000000001','00098'),('98200000-0000-4000-8000-000000000002','00098');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('98400000-0000-4000-8000-000000000001','98200000-0000-4000-8000-000000000001','synthetic-ff-lawn','Synthetic fulfillment lawn','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('98500000-0000-4000-8000-000000000001','98400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('98500000-0000-4000-8000-000000000003','98400000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]');

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create temp table at_(key text primary key, at timestamptz);
grant select on at_ to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('98100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('98700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
create function pg_temp.run(p_user integer, p_sql text) returns void language plpgsql as $$
declare previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute p_sql;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.submit(p_user integer, p_key text, p_frequency text, p_tier uuid, p_total numeric) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00098'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_build_object(
      'service_id','synthetic-ff-lawn','frequency',p_frequency,'package_id','98400000-0000-4000-8000-000000000001','tier_id',p_tier,
      'preferred_contractor_id','98200000-0000-4000-8000-000000000001',
      'expected',jsonb_build_object('pricing_mode','fixed','total',p_total))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.accept_plan(p_request uuid) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;
create function pg_temp.day(n integer) returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + time '09:00' $$;
create function pg_temp.visit(p_series uuid, p_key integer, p_day integer) returns uuid language sql as $$
  select (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), pg_temp.day(p_day) at time zone 'America/New_York', pg_temp.day(p_day), 'Synthetic fulfillment visit'))->>'occurrence_id')::uuid $$;
create function pg_temp.accept(p_visit uuid) returns void language sql as $$
  select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_visit)) $$;
create function pg_temp.terms(request uuid, service bigint) returns jsonb language sql as $$
  select jsonb_build_object('service',service,'addons',0,'discount',0,'adjustment',0,'subtotal',service,'tax',0,'tip',0,
    'deposit',0,'total',service,'currency','usd','source_version',private.money_source(request)->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic visit review','expires_at',now()+interval '2 days') $$;
create function pg_temp.publish(request uuid) returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request, 4000); prior text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"98100000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('98100000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent visit review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'98100000-0000-4000-8000-000000000005','98100000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.checkout(p_snapshot uuid) returns uuid language sql as $$
  select (pg_temp.call(1, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', p_snapshot))->>'id')::uuid $$;
create function pg_temp.event(p_id text, p_type text, p_payload jsonb) returns text language plpgsql as $$
begin
  perform public.money_receive_event(p_id, p_type, p_payload);
  return public.money_process_event(p_id);
end $$;
-- A paid visit: reviewed, checked out and captured in full.
create function pg_temp.paid(p_visit uuid, p_n integer) returns void language plpgsql as $$
declare attempt uuid := pg_temp.checkout(pg_temp.publish(p_visit));
begin
  perform pg_temp.event('evt_ff_cap_'||p_n,'capture',jsonb_build_object('attempt_id',attempt,'payment_id','pi_ff_'||p_n,'amount',4000,'currency','usd'));
end $$;
-- A stored completion photo uploaded by p_uploader into p_job's folder.
create function pg_temp.photo(p_uploader integer, p_job uuid, p_name text) returns text language plpgsql as $$
declare path text := pg_temp.u(p_uploader)::text||'/'||p_job::text||'/'||p_name;
begin
  insert into storage.objects(bucket_id, name, owner) values ('job-photos', path, pg_temp.u(p_uploader));
  return path;
end $$;
create function pg_temp.start(p_user integer, p_job uuid, p_key integer, p_reason text default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.start_job(%L,%L,%L)', p_job, pg_temp.k(p_key), p_reason)) $$;
create function pg_temp.complete(p_user integer, p_job uuid, p_paths text[]) returns void language sql as $$
  select pg_temp.run(p_user, format('select public.vendor_complete_job(%L,%L)', p_job, p_paths)) $$;
create function pg_temp.confirm(p_user integer, p_job uuid, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_confirm_completion(%L,%L)', p_job, p_at)) $$;
create function pg_temp.dispute(p_user integer, p_job uuid, p_at timestamptz, p_reason text default 'Synthetic: the back corner was missed') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.homeowner_dispute_completion(%L,%L,%L)', p_job, p_at, p_reason)) $$;
create function pg_temp.ff(p_user integer, p_job uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.job_fulfillment(%L)', p_job)) $$;
create function pg_temp.st(p_job uuid) returns text language sql as $$ select status::text from public.service_requests where id = p_job $$;
create function pg_temp.done_at(p_job uuid) returns timestamptz language sql as $$ select vendor_completed_at from public.service_requests where id = p_job $$;
create function pg_temp.started_payment(p_job uuid) returns text language sql as $$
  select metadata#>>'{payment_at_start,state}' from public.job_events where job_id = p_job and metadata->>'to' = 'in_progress'
   order by created_at desc limit 1 $$;
create function pg_temp.blocker(p_job uuid) returns text language sql as $$
  select private.money_ach_payable(o.id)->>'blocker' from public.money_obligations o where o.service_request_id = p_job $$;
create function pg_temp.item(p_job uuid, p_kind text) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.call(5, 'select public.admin_fulfillment_queue()')->'items') i
   where i->>'request_id' = p_job::text and i->>'kind' = p_kind $$;
create function pg_temp.follow_up(p_user integer, p_job uuid, p_key integer, p_item text, p_reason text default 'Synthetic: called both parties') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_record_fulfillment_follow_up(%L,%L,%L,%L)', p_job, pg_temp.k(p_key), p_item, p_reason)) $$;
-- Historical confirmation fixture (database owner only, as SQL 024 does): the visit is completed and
-- confirmed at p_at with the matching immutable receipt.
create function pg_temp.historical(p_visit uuid, p_at timestamptz) returns void language plpgsql as $$
begin
  update public.service_requests set status = 'completed', vendor_completed_at = p_at - interval '1 hour', homeowner_confirmed_at = p_at
   where id = p_visit;
  insert into public.money_lifecycle_confirmations(request_id, homeowner_id, contractor_id, confirmed_at)
    select id, customer_id, contractor_id, p_at from public.service_requests where id = p_visit;
end $$;

-- Two-photo completion rule for the synthetic service.
select pg_temp.run(5, $$select public.set_completion_evidence_rule('synthetic-ff-lawn', 2, 'Synthetic two-photo rule')$$);

-- Plans: S1 weekly (homeowner A), S2 weekly (homeowner A), S3 weekly (homeowner B). R1: a one-time job.
insert into fx values ('s1', pg_temp.submit(1,'ff-s1-000000000001','weekly','98500000-0000-4000-8000-000000000001',40));
insert into fx values ('s2', pg_temp.submit(1,'ff-s2-000000000001','weekly','98500000-0000-4000-8000-000000000001',40));
insert into fx values ('s3', pg_temp.submit(2,'ff-s3-000000000001','weekly','98500000-0000-4000-8000-000000000001',40));
insert into fx values ('r1', pg_temp.submit(1,'ff-r1-000000000001','one-time','98500000-0000-4000-8000-000000000003',60));
select pg_temp.accept_plan(pg_temp.id('s1'));
select pg_temp.accept_plan(pg_temp.id('s2'));
select pg_temp.accept_plan(pg_temp.id('s3'));
select pg_temp.accept_plan(pg_temp.id('r1'));
select is(pg_temp.st(pg_temp.id('r1')), 'scheduled', 'the one-time job is accepted and scheduled');

-- Access ----------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.start_job(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.homeowner_confirm_completion(uuid,timestamptz)','execute')
  and not has_function_privilege('anon','public.homeowner_dispute_completion(uuid,timestamptz,text)','execute')
  and not has_function_privilege('anon','public.job_fulfillment(uuid)','execute')
  and not has_function_privilege('anon','public.admin_fulfillment_queue()','execute')
  and not has_function_privilege('anon','public.admin_record_fulfillment_follow_up(uuid,uuid,text,text)','execute'),
  'no fulfillment command or read is callable signed out');
select ok(has_function_privilege('authenticated','public.start_job(uuid,uuid,text)','execute')
  and has_function_privilege('authenticated','public.job_fulfillment(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_fulfillment_queue()','execute'),
  'signed-in callers reach the commands, which check the role themselves');
select ok(not has_function_privilege('authenticated','private.fulfillment_payment_state(public.service_requests)','execute')
  and not has_function_privilege('authenticated','private.fulfillment_queue_items(timestamptz)','execute')
  and not has_function_privilege('authenticated','private.guard_fulfillment_start()','execute'),
  'the helpers are not client-callable');

-- Starting work ---------------------------------------------------------------------------------------
insert into fx values ('v1', pg_temp.visit(pg_temp.id('s1'), 1, 10));
insert into fx values ('v2', pg_temp.visit(pg_temp.id('s1'), 2, 11));
select is((select matching_status from public.service_requests where id = pg_temp.id('v1')), 'offered', 'a new visit is only offered to the plan provider');
select throws_ok($$select pg_temp.start(3, pg_temp.id('v1'), 1)$$, '40001', null, 'the provider cannot start an offered visit');
select throws_ok($$select pg_temp.run(3, format('select public.transition_job_status(%L,''in_progress'')', pg_temp.id('v1')))$$,
  '42501', 'Accept the offer before starting work', 'nor through the lifecycle command directly');
select throws_ok($$select pg_temp.run(5, format('select public.transition_job_status(%L,''in_progress'',''Synthetic override'')', pg_temp.id('v1')))$$,
  '42501', 'Work starts only after the assigned provider accepts this service',
  'operations cannot start work the provider has not accepted (an open offer already names the provider)');
select pg_temp.accept(pg_temp.id('v1'));
select pg_temp.accept(pg_temp.id('v2'));
select is(pg_temp.st(pg_temp.id('v1')), 'scheduled', 'the provider accepts the visit');
select throws_ok($$select pg_temp.start(1, pg_temp.id('v1'), 1)$$, '42501', null, 'the homeowner cannot start work');
select throws_ok($$select pg_temp.start(2, pg_temp.id('v1'), 1)$$, '42501', null, 'another homeowner cannot start work');
select throws_ok($$select pg_temp.start(4, pg_temp.id('v1'), 1)$$, '42501', null, 'another provider cannot start work');
select throws_ok($$select pg_temp.start(5, pg_temp.id('v1'), 1)$$, '22023', 'Operations must give a reason to start work', 'operations needs a reason');
select throws_ok($$select pg_temp.start(3, pg_temp.id('s1'), 1)$$, '22023', 'Work is recorded on each recurring visit, not on the plan', 'the plan itself is never started');
select throws_ok($$select pg_temp.run(5, format('select public.transition_job_status(%L,''in_progress'',''Synthetic override'')', pg_temp.id('s1')))$$,
  '22023', null, 'not even by operations through the lifecycle command');
select is(pg_temp.start(3, pg_temp.id('v1'), 1)->>'outcome', 'started', 'the assigned provider starts the visit');
select is(pg_temp.st(pg_temp.id('v1')), 'in_progress', 'which is in progress');
select is(pg_temp.st(pg_temp.id('v2')), 'scheduled', 'the plan''s other visit is untouched');
select is(pg_temp.start(3, pg_temp.id('v1'), 1)->>'outcome', 'replayed', 'a retry with the same key replays');
select is((select count(*) from public.job_events where job_id = pg_temp.id('v1') and metadata->>'to' = 'in_progress'), 1::bigint,
  'and starts the work once');
select throws_ok($$select pg_temp.start(3, pg_temp.id('v1'), 2)$$, '40001', null, 'a second start is refused as stale');
select throws_ok($$select pg_temp.start(5, pg_temp.id('v1'), 1, 'Synthetic')$$, '22023', 'Operation key reused with different intent',
  'another actor cannot reuse the key');
select throws_ok($$select pg_temp.run(3, format('select public.transition_job_status(%L,''in_progress'')', pg_temp.id('v1')))$$,
  '22023', 'Duplicate job transition', 'the lifecycle command refuses the duplicate too');

-- Direct writes ---------------------------------------------------------------------------------------
select throws_ok($$select pg_temp.run(3, format('update public.service_requests set status = ''in_progress'' where id = %L', pg_temp.id('v2')))$$,
  '42501', null, 'the provider cannot start by writing the row');
select throws_ok($$select pg_temp.run(3, format('update public.service_requests set vendor_completed_at = now(), photo_proof_urls = ''{x}'' where id = %L', pg_temp.id('v1')))$$,
  '42501', 'Lifecycle fields must be changed through authorized RPCs', 'nor complete by writing the row');
select throws_ok($$select pg_temp.run(5, format('update public.service_requests set status = ''vendor_completed'' where id = %L', pg_temp.id('v1')))$$,
  '42501', 'Lifecycle fields must be changed through authorized RPCs', 'operations cannot write the status either');
select is(pg_temp.st(pg_temp.id('v2')), 'scheduled', 'nothing changed');

-- Completion evidence ---------------------------------------------------------------------------------
select is(pg_temp.start(3, pg_temp.id('v2'), 3)->>'outcome', 'started', 'the plan''s second visit starts separately');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L])$$, pg_temp.id('v1'), pg_temp.photo(3, pg_temp.id('v1'), 'one.png')),
  'P0001', 'This service requires at least 2 completion photos', 'one photo is not enough for a two-photo service');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/never-uploaded.png'),
  '22023', 'A completion photo was not found in storage. Upload it again', 'an incomplete upload does not count');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.photo(3, pg_temp.id('v2'), 'other-visit.png')),
  '22023', 'A completion photo was uploaded for a different job', 'a photo from the plan''s other visit never counts');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.photo(4, pg_temp.id('v1'), 'foreign.png')),
  '22023', 'A completion photo was not uploaded by this job''s provider', 'another provider''s upload does not count');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.photo(1, pg_temp.id('v1'), 'homeowner.png')),
  '22023', 'A completion photo was not uploaded by this job''s provider', 'nor the homeowner''s');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png'),
  '22023', 'The same completion photo cannot be counted twice', 'nor the same photo twice');
select throws_ok(format($$select pg_temp.complete(4, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.photo(3, pg_temp.id('v1'), 'two.png')),
  'P0001', 'Not authorized', 'another provider cannot complete the visit');
select throws_ok(format($$select pg_temp.complete(1, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/two.png'),
  'P0001', 'Not authorized', 'nor the homeowner');
select is(pg_temp.st(pg_temp.id('v1')), 'in_progress', 'every refusal left the visit in progress');
select is((select count(*) from public.job_completion_evidence where job_id = pg_temp.id('v1')), 0::bigint, 'with no evidence recorded');
select lives_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/two.png'), 'two of the provider''s own photos for this visit complete it');
select is(pg_temp.st(pg_temp.id('v1')), 'vendor_completed', 'the visit waits for the homeowner');
select is((select count(*) from public.job_completion_evidence where job_id = pg_temp.id('v1') and attempt = 1), 2::bigint, 'attempt 1 records both photos');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/two.png'), '22023', 'Duplicate job transition', 'a repeated completion is refused');
select is((select count(distinct attempt) from public.job_completion_evidence where job_id = pg_temp.id('v1')), 1::bigint, 'one attempt only');
select throws_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v2'), pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png',
  pg_temp.u(3)||'/'||pg_temp.id('v1')||'/two.png'), '22023', 'A completion photo was uploaded for a different job',
  'one visit''s recorded evidence never satisfies another');
select throws_ok($$select pg_temp.run(3, format('insert into public.job_completion_evidence(job_id,attempt,position,bucket_id,object_name,object_id,uploader_id,minimum_photos,rule_version) select %L,9,1,''job-photos'',''x'',gen_random_uuid(),%L,0,0', pg_temp.id('v2'), pg_temp.u(3)))$$,
  '42501', null, 'the provider cannot write evidence rows directly');
select is(pg_temp.call(3, format('select to_jsonb(public.job_photo_delete_allowed(''job-photos'', %L))', pg_temp.u(3)||'/'||pg_temp.id('v1')||'/one.png')),
  'false'::jsonb, 'the provider may not delete recorded proof (Storage API path: scripts/phase4-completion-integrity.mjs)');

-- Provider completion is not homeowner confirmation ---------------------------------------------------
select is((select homeowner_confirmed_at from public.service_requests where id = pg_temp.id('v1')), null, 'provider completion sets no homeowner confirmation');
select is((select count(*) from public.money_lifecycle_confirmations where request_id = pg_temp.id('v1')), 0::bigint, 'and records no confirmation receipt');
select is(pg_temp.ff(1, pg_temp.id('v1'))#>>'{completion,by}', 'provider', 'the homeowner sees the provider completed it');
select is((pg_temp.ff(1, pg_temp.id('v1'))#>>'{completion,attempt}')::int, 1, 'attempt 1');
select is((pg_temp.ff(1, pg_temp.id('v1'))#>>'{completion,photos}')::int, 2, 'with two photos');
select is(pg_temp.ff(1, pg_temp.id('v1'))->'confirmation', 'null'::jsonb, 'and no confirmation yet');
select is(pg_temp.ff(1, pg_temp.id('v1'))#>>'{started,by}', 'provider', 'started by the provider');
select is((pg_temp.ff(1, pg_temp.id('v1'))->>'dispute_window_ends_at')::timestamptz, pg_temp.done_at(pg_temp.id('v1')) + interval '48 hours',
  'the dispute window ends 48 hours after completion');
select is((pg_temp.ff(1, pg_temp.id('v1'))->>'review_at')::timestamptz, pg_temp.done_at(pg_temp.id('v1')) + interval '72 hours',
  'operations review an unanswered completion after 72 hours');
select is(pg_temp.ff(1, pg_temp.id('v1'))->'payout', 'null'::jsonb, 'the homeowner sees no payout state');
select is(pg_temp.ff(3, pg_temp.id('v1'))#>>'{payout,state}', 'no_payment_record', 'the provider sees there is no payment record yet');
select is(pg_temp.ff(3, pg_temp.id('v1'))->'payout' ? 'blocker', false, 'without the operator detail');
select is(pg_temp.ff(5, pg_temp.id('v1'))#>>'{started,payment_at_start,state}', 'review_pending', 'operations see the payment state when work started');
select is(pg_temp.ff(3, pg_temp.id('v1'))#>>'{started,payment_at_start}', null, 'the provider does not');
select throws_ok($$select pg_temp.ff(2, pg_temp.id('v1'))$$, '42501', null, 'another homeowner cannot read the fulfillment');
select throws_ok($$select pg_temp.ff(4, pg_temp.id('v1'))$$, '42501', null, 'nor another provider');
select is(pg_temp.ff(1, pg_temp.id('s1'))->>'plan', 'true', 'the plan reads as a plan, never as worked');

-- The homeowner's decision is bound to the completion they reviewed ------------------------------------
select throws_ok($$select pg_temp.confirm(3, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))$$, '42501', null, 'the provider cannot confirm');
select throws_ok($$select pg_temp.confirm(5, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))$$, '42501', null, 'operations cannot confirm');
select throws_ok($$select pg_temp.confirm(2, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))$$, '42501', null, 'another homeowner cannot confirm');
select throws_ok($$select pg_temp.run(3, format('select public.transition_job_status(%L,''homeowner_confirmed'')', pg_temp.id('v1')))$$,
  '42501', null, 'the provider cannot confirm through the lifecycle command');
-- Rework: completions in different transactions carry different times. This test runs in one
-- transaction (now() is fixed), so attempt 1 is moved an hour back by the database owner.
update public.service_requests set vendor_completed_at = now() - interval '1 hour', confirmation_sent_at = now() - interval '1 hour' where id = pg_temp.id('v1');
update public.job_events set created_at = created_at - interval '1 hour' where job_id = pg_temp.id('v1');
insert into at_ values ('v1-attempt1', pg_temp.done_at(pg_temp.id('v1')));
select lives_ok($$select pg_temp.run(5, format('select public.transition_job_status(%L,''in_progress'',''Synthetic: redo the back corner'')', pg_temp.id('v1')))$$,
  'operations return the visit for rework');
select is(pg_temp.ff(1, pg_temp.id('v1'))#>>'{started,rework}', 'true', 'the restart is shown as rework');
select is(pg_temp.ff(1, pg_temp.id('v1'))#>>'{started,by}', 'operations', 'by operations');
select lives_ok(format($$select pg_temp.complete(3, %L, array[%L, %L])$$, pg_temp.id('v1'), pg_temp.photo(3, pg_temp.id('v1'), 'three.png'),
  pg_temp.photo(3, pg_temp.id('v1'), 'four.png')), 'the provider completes again with new proof');
select is((pg_temp.ff(1, pg_temp.id('v1'))#>>'{completion,attempt}')::int, 2, 'attempt 2 is current');
select throws_ok($$select pg_temp.confirm(1, pg_temp.id('v1'), (select at from at_ where key = 'v1-attempt1'))$$, '40001',
  'The provider submitted new completion proof. Review it before you confirm.', 'confirming the proof seen before the rework is refused');
select throws_ok($$select pg_temp.dispute(1, pg_temp.id('v1'), (select at from at_ where key = 'v1-attempt1'))$$, '40001',
  'The provider submitted new completion proof. Review it before you report an issue.', 'so is disputing it');
select is(pg_temp.st(pg_temp.id('v1')), 'vendor_completed', 'nothing changed');
select is(pg_temp.confirm(1, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))->>'outcome', 'confirmed', 'the homeowner confirms the current completion');
select is(pg_temp.st(pg_temp.id('v1')), 'completed', 'the visit is completed');
select is((select count(*) from public.money_lifecycle_confirmations where request_id = pg_temp.id('v1')), 1::bigint, 'with one confirmation receipt');
select is(pg_temp.confirm(1, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))->>'outcome', 'replayed', 'a retry replays');
select is((select count(*) from public.money_lifecycle_confirmations where request_id = pg_temp.id('v1')), 1::bigint, 'and records nothing more');
select is(pg_temp.ff(3, pg_temp.id('v1'))#>>'{confirmation,by}', 'homeowner', 'the provider sees the homeowner confirmed');
select is((pg_temp.ff(3, pg_temp.id('v1'))#>>'{confirmation,at}')::timestamptz,
  (select homeowner_confirmed_at from public.service_requests where id = pg_temp.id('v1')), 'and when');
select throws_ok($$select pg_temp.dispute(1, pg_temp.id('v1'), pg_temp.done_at(pg_temp.id('v1')))$$, '40001', null,
  'a dispute sent from the confirmation view after confirming is refused as stale');
select is(pg_temp.st(pg_temp.id('v2')), 'in_progress', 'confirming one visit leaves the plan''s other visit in progress');
select throws_ok($$update public.service_requests set status = 'in_progress' where id = pg_temp.id('v1')$$, '22023',
  'Work starts only from a scheduled service (now completed)', 'no path, not even the database owner, restarts completed work outside rework');

-- Disputes --------------------------------------------------------------------------------------------
insert into fx values ('v3', pg_temp.visit(pg_temp.id('s1'), 4, 12));
select pg_temp.accept(pg_temp.id('v3'));
select pg_temp.start(3, pg_temp.id('v3'), 5);
select pg_temp.complete(3, pg_temp.id('v3'), array[pg_temp.photo(3, pg_temp.id('v3'), 'a.png'), pg_temp.photo(3, pg_temp.id('v3'), 'b.png')]);
select throws_ok($$select pg_temp.dispute(3, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')))$$, '42501', null, 'the provider cannot open the homeowner''s dispute');
select throws_ok($$select pg_temp.dispute(1, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')), '  ')$$, '22023', 'Dispute reason required', 'a reason is required');
select is(pg_temp.dispute(1, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')))->>'outcome', 'disputed', 'the homeowner reports an issue');
select is(pg_temp.st(pg_temp.id('v3')), 'disputed', 'the visit is disputed');
select is(pg_temp.dispute(1, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')))->>'outcome', 'replayed', 'a retry replays');
select is((select count(*) from public.disputes where job_id = pg_temp.id('v3')), 1::bigint, 'one dispute');
select is((select count(*) from public.support_tickets where job_id = pg_temp.id('v3')::text), 1::bigint, 'with one ticket');
select throws_ok($$select pg_temp.dispute(1, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')), 'Synthetic: something else')$$, '22023',
  'A dispute is already open', 'a different second dispute is refused');
select throws_ok($$select pg_temp.confirm(1, pg_temp.id('v3'), pg_temp.done_at(pg_temp.id('v3')))$$, '40001', null,
  'confirming after the dispute is refused as stale');
select is((select count(*) from public.money_lifecycle_confirmations where request_id = pg_temp.id('v3')), 0::bigint, 'and records no receipt');
select is(pg_temp.ff(3, pg_temp.id('v3'))#>>'{dispute,status}', 'open', 'the provider sees the open dispute');
-- The 48-hour dispute window (Phase 4) is unchanged; confirmation has no window.
insert into fx values ('v4', pg_temp.visit(pg_temp.id('s1'), 5, 13));
select pg_temp.accept(pg_temp.id('v4'));
select pg_temp.start(3, pg_temp.id('v4'), 6);
select pg_temp.complete(3, pg_temp.id('v4'), array[pg_temp.photo(3, pg_temp.id('v4'), 'a.png'), pg_temp.photo(3, pg_temp.id('v4'), 'b.png')]);
update public.service_requests set vendor_completed_at = now() - interval '48 hours' + interval '1 microsecond' where id = pg_temp.id('v4');
select is((pg_temp.ff(1, pg_temp.id('v4'))->>'dispute_window_ends_at')::timestamptz, now() + interval '1 microsecond', 'one microsecond of the window is left');
update public.service_requests set vendor_completed_at = now() - interval '48 hours' where id = pg_temp.id('v4');
select throws_ok($$select pg_temp.dispute(1, pg_temp.id('v4'), pg_temp.done_at(pg_temp.id('v4')))$$, '22023',
  'The 48-hour dispute window has ended; contact support', 'at 48 hours the window has closed');
select is(pg_temp.confirm(1, pg_temp.id('v4'), pg_temp.done_at(pg_temp.id('v4')))->>'outcome', 'confirmed', 'the homeowner can still confirm');

-- Payout keeps its guards: confirmation + 48 hours, payment and holds -----------------------------------
insert into fx values ('v5', pg_temp.visit(pg_temp.id('s2'), 6, 10));
select pg_temp.accept(pg_temp.id('v5'));
select pg_temp.paid(pg_temp.id('v5'), 5);
select pg_temp.start(3, pg_temp.id('v5'), 7);
select is(pg_temp.started_payment(pg_temp.id('v5')), 'paid', 'a paid visit starts with its payment recorded as paid');
select pg_temp.complete(3, pg_temp.id('v5'), array[pg_temp.photo(3, pg_temp.id('v5'), 'a.png'), pg_temp.photo(3, pg_temp.id('v5'), 'b.png')]);
select is(pg_temp.blocker(pg_temp.id('v5')), 'awaiting_confirmation', 'a paid, provider-completed visit is not payout-eligible');
select is(pg_temp.ff(3, pg_temp.id('v5'))#>>'{payout,state}', 'awaiting_confirmation', 'the provider reads the same');
select pg_temp.confirm(1, pg_temp.id('v5'), pg_temp.done_at(pg_temp.id('v5')));
select is(pg_temp.blocker(pg_temp.id('v5')), 'confirmation_window', 'once confirmed, the 48-hour window holds it');
select is((pg_temp.ff(3, pg_temp.id('v5'))#>>'{payout,eligible_at}')::timestamptz,
  (select homeowner_confirmed_at from public.service_requests where id = pg_temp.id('v5')) + interval '48 hours', 'the provider sees when it opens');
select is(pg_temp.ff(5, pg_temp.id('v5'))#>>'{payout,blocker}', 'confirmation_window', 'operations see the blocker');
-- Boundaries on historical confirmations (receipt and request agree, as the payout check requires).
insert into fx values ('h1', pg_temp.visit(pg_temp.id('s2'), 7, 11));
insert into fx values ('h2', pg_temp.visit(pg_temp.id('s2'), 8, 12));
insert into fx values ('h3', pg_temp.visit(pg_temp.id('s2'), 9, 13));
insert into fx values ('h4', pg_temp.visit(pg_temp.id('s2'), 10, 14));
select pg_temp.accept(pg_temp.id(k)) from unnest(array['h1','h2','h3','h4']) k;
select pg_temp.paid(pg_temp.id('h1'), 11);
select pg_temp.paid(pg_temp.id('h2'), 12);
select pg_temp.paid(pg_temp.id('h3'), 13);
select pg_temp.publish(pg_temp.id('h4'));
select pg_temp.historical(pg_temp.id('h1'), now() - interval '48 hours' + interval '1 microsecond');
select pg_temp.historical(pg_temp.id('h2'), now() - interval '48 hours');
select pg_temp.historical(pg_temp.id('h3'), now() - interval '49 hours');
select pg_temp.historical(pg_temp.id('h4'), now() - interval '49 hours');
select is(pg_temp.blocker(pg_temp.id('h1')), 'confirmation_window', 'one microsecond before 48 hours: still held by the window');
select is(pg_temp.blocker(pg_temp.id('h2')), 'payout_onboarding', 'at exactly 48 hours the window opens (this synthetic provider has no payout onboarding)');
select is(pg_temp.blocker(pg_temp.id('h3')), 'payout_onboarding', 'after 48 hours, likewise');
select is(pg_temp.blocker(pg_temp.id('h4')), 'payment_incomplete', 'an unpaid visit is never payable, however long ago it was confirmed');
select is(pg_temp.ff(3, pg_temp.id('h4'))#>>'{payout,state}', 'payment_incomplete', 'the provider sees the payment is incomplete');
insert into public.money_holds(obligation_id, business_key, reason, actor, evidence)
  select o.id, 'ff-hold-h3', 'Synthetic payout hold', pg_temp.u(5), 'synthetic' from public.money_obligations o where o.service_request_id = pg_temp.id('h3');
select is(pg_temp.blocker(pg_temp.id('h3')), 'payout_hold', 'an unresolved payout hold holds it');
insert into public.disputes(job_id, homeowner_id, vendor_id, reason)
  select id, customer_id, contractor_id, 'Synthetic late dispute' from public.service_requests where id = pg_temp.id('h3');
select is(pg_temp.blocker(pg_temp.id('h3')), 'dispute_hold', 'an open dispute holds it first');
select is(pg_temp.ff(3, pg_temp.id('h3'))#>>'{payout,state}', 'held', 'the provider sees it held');
select is(pg_temp.ff(5, pg_temp.id('h3'))#>>'{payout,blocker}', 'dispute_hold', 'operations see why');

-- Unpaid start: CURRENT behavior, characterized (DEC-2026-050 open; no payment prerequisite exists) -----
insert into fx values ('m_ready', pg_temp.visit(pg_temp.id('s1'), 11, 14));
insert into fx values ('m_proc', pg_temp.visit(pg_temp.id('s1'), 12, 15));
insert into fx values ('m_fail', pg_temp.visit(pg_temp.id('s1'), 13, 16));
insert into fx values ('m_unk', pg_temp.visit(pg_temp.id('s1'), 14, 17));
insert into fx values ('m_held', pg_temp.visit(pg_temp.id('s1'), 15, 18));
select pg_temp.accept(pg_temp.id(k)) from unnest(array['m_ready','m_proc','m_fail','m_unk','m_held']) k;
select pg_temp.publish(pg_temp.id('m_ready'));
select pg_temp.checkout(pg_temp.publish(pg_temp.id('m_proc')));
insert into fx values ('m_fail_a', pg_temp.checkout(pg_temp.publish(pg_temp.id('m_fail'))));
select pg_temp.event('evt_ff_exp_fail','checkout_expired',jsonb_build_object('attempt_id',pg_temp.id('m_fail_a'),'session_id','cs_ff_fail'));
insert into fx values ('m_unk_a', pg_temp.checkout(pg_temp.publish(pg_temp.id('m_unk'))));
select public.money_flag_checkout(pg_temp.id('m_unk_a'), 'synthetic_lost_response');
select pg_temp.publish(pg_temp.id('m_held'));
update public.money_obligations set dispute_open = true where service_request_id = pg_temp.id('m_held');
select is(pg_temp.start(3, pg_temp.id(k), 20 + n::int)->>'outcome', 'started', 'CURRENT: '||k||' visit can be started')
  from unnest(array['m_ready','m_proc','m_fail','m_unk','m_held']) with ordinality as t(k, n);
select is((select metadata#>>'{payment_at_start,state}' from public.job_events where job_id = pg_temp.id('v1') and metadata->>'start_key' = pg_temp.k(1)::text),
  'review_pending', 'recorded at start: review missing');
select is(pg_temp.started_payment(pg_temp.id('m_ready')), 'ready', 'recorded at start: ready but unpaid');
select is(pg_temp.started_payment(pg_temp.id('m_proc')), 'processing', 'recorded at start: processing');
select is(pg_temp.started_payment(pg_temp.id('m_fail')), 'failed', 'recorded at start: confirmed failure');
select is(pg_temp.started_payment(pg_temp.id('m_unk')), 'unknown', 'recorded at start: unknown outcome');
select is((select metadata#>>'{payment_at_start,reason}' from public.job_events where job_id = pg_temp.id('m_held') and metadata->>'to' = 'in_progress'),
  'held', 'recorded at start: held');
select is(pg_temp.start(3, pg_temp.id('r1'), 30)->>'outcome', 'started', 'CURRENT: an unpaid one-time job can be started');
select is(pg_temp.started_payment(pg_temp.id('r1')), 'no_obligation', 'recorded at start: no payment record');

-- Stopping the plan never cancels or rewrites an existing visit ------------------------------------------
insert into fx values ('v6', pg_temp.visit(pg_temp.id('s3'), 16, 10));
select pg_temp.accept(pg_temp.id('v6'));
select is(pg_temp.call(5, format('select public.admin_set_recurring_plan_state(%L,%L,''stop'',''active'',''Synthetic stop'')',
  pg_temp.id('s3'), pg_temp.k(40)))->>'to_state', 'ended', 'operations stop future visits');
select is(pg_temp.st(pg_temp.id('v6')), 'scheduled', 'the existing visit stays scheduled');
select is(pg_temp.start(3, pg_temp.id('v6'), 41)->>'outcome', 'started', 'and can still be worked');
select pg_temp.complete(3, pg_temp.id('v6'), array[pg_temp.photo(3, pg_temp.id('v6'), 'a.png'), pg_temp.photo(3, pg_temp.id('v6'), 'b.png')]);
select is(pg_temp.confirm(2, pg_temp.id('v6'), pg_temp.done_at(pg_temp.id('v6')))->>'outcome', 'confirmed', 'completed and confirmed by its homeowner');
select is((select count(*) from public.job_events where job_id = pg_temp.id('v6') and metadata->>'to' in ('in_progress','vendor_completed','homeowner_confirmed','completed')),
  4::bigint, 'with its whole history');

-- Operations queue and follow-up ------------------------------------------------------------------------
select throws_ok($$select pg_temp.call(1, 'select public.admin_fulfillment_queue()')$$, '42501', null, 'the homeowner cannot read the queue');
select throws_ok($$select pg_temp.call(3, 'select public.admin_fulfillment_queue()')$$, '42501', null, 'nor the provider');
select lives_ok($$select pg_temp.call(3, format('select public.record_job_operation(%L,%L,''unable_to_complete'',''Synthetic: gate locked'')', pg_temp.id('v2'), pg_temp.k(50)))$$,
  'the provider reports they cannot complete the visit');
select is(pg_temp.item(pg_temp.id('v2'), 'fulfillment_exception')->>'detail', 'unable_to_complete', 'operations see it in the queue');
select is(pg_temp.st(pg_temp.id('v2')), 'in_progress', 'the report changes no state');
select throws_ok($$select pg_temp.follow_up(3, pg_temp.id('v2'), 51, 'fulfillment_exception')$$, '42501', null, 'the provider cannot record the follow-up');
select throws_ok($$select pg_temp.follow_up(5, pg_temp.id('v2'), 51, 'fulfillment_exception', ' ')$$, '22023', null, 'operations give a reason');
select throws_ok($$select pg_temp.follow_up(5, pg_temp.id('v2'), 51, 'confirmation_overdue')$$, '40001', null, 'an item that is not open is refused');
select set_config('t.notices', (select count(*)::text from public.notifications), true);
select is(pg_temp.follow_up(5, pg_temp.id('v2'), 51, 'fulfillment_exception')->>'outcome', 'recorded', 'operations record the follow-up');
select is(pg_temp.item(pg_temp.id('v2'), 'fulfillment_exception'), null, 'which closes the item');
select is(pg_temp.follow_up(5, pg_temp.id('v2'), 51, 'fulfillment_exception')->>'outcome', 'replayed', 'a retry replays');
select throws_ok($$select pg_temp.follow_up(5, pg_temp.id('v2'), 51, 'fulfillment_exception', 'Synthetic: different')$$, '22023',
  'Operation key reused with different intent', 'the key cannot carry a different reason');
select is(pg_temp.st(pg_temp.id('v2')), 'in_progress', 'the follow-up changes no state');
select is((select count(*)::text from public.notifications), current_setting('t.notices'), 'and notifies nobody');
select is(pg_temp.ff(1, pg_temp.id('v2'))#>>'{operations,0,kind}', 'unable_to_complete', 'the homeowner sees the reported exception');
select is(pg_temp.ff(1, pg_temp.id('v2'))#>>'{operations,0,by}', 'provider', 'reported by the provider');
-- Each of the four reports opens an item; a newer report after a follow-up reopens it.
insert into fx values ('v7', pg_temp.visit(pg_temp.id('s1'), 17, 19));
select pg_temp.accept(pg_temp.id('v7'));
select pg_temp.call(3, format('select public.record_job_operation(%L,%L,''customer_unavailable'',''Synthetic: nobody home'')', pg_temp.id('v7'), pg_temp.k(52)));
select is(pg_temp.item(pg_temp.id('v7'), 'fulfillment_exception')->>'detail', 'customer_unavailable', 'customer unavailable is queued');
select pg_temp.follow_up(5, pg_temp.id('v7'), 53, 'fulfillment_exception');
select is(pg_temp.item(pg_temp.id('v7'), 'fulfillment_exception'), null, 'the follow-up closes it');
-- The next report comes later; the follow-up is moved back because now() is fixed in this transaction.
update public.job_events set created_at = now() - interval '1 minute' where job_id = pg_temp.id('v7') and metadata->>'action' = 'fulfillment_follow_up';
select pg_temp.call(3, format('select public.record_job_operation(%L,%L,''partial_completion'',''Synthetic: half the lawn'')', pg_temp.id('v7'), pg_temp.k(54)));
select isnt(pg_temp.item(pg_temp.id('v7'), 'fulfillment_exception'), null, 'a later partial-completion report reopens the item');
insert into fx values ('v8', pg_temp.visit(pg_temp.id('s1'), 18, 20));
select pg_temp.accept(pg_temp.id('v8'));
select pg_temp.call(1, format('select public.record_job_operation(%L,%L,''no_show'',''Synthetic: provider never came'')', pg_temp.id('v8'), pg_temp.k(55)));
select is(pg_temp.item(pg_temp.id('v8'), 'fulfillment_exception')->>'detail', 'no_show', 'a homeowner-reported no-show is queued');
-- An unanswered completion is queued at the approved 72-hour review time, not before.
insert into fx values ('v9', pg_temp.visit(pg_temp.id('s1'), 19, 21));
select pg_temp.accept(pg_temp.id('v9'));
select pg_temp.start(3, pg_temp.id('v9'), 56);
select pg_temp.complete(3, pg_temp.id('v9'), array[pg_temp.photo(3, pg_temp.id('v9'), 'a.png'), pg_temp.photo(3, pg_temp.id('v9'), 'b.png')]);
update public.service_requests set confirmation_sent_at = now() - interval '72 hours' + interval '1 microsecond' where id = pg_temp.id('v9');
select is(pg_temp.item(pg_temp.id('v9'), 'confirmation_overdue'), null, 'one microsecond before 72 hours: not queued');
update public.service_requests set confirmation_sent_at = now() - interval '72 hours' where id = pg_temp.id('v9');
select isnt(pg_temp.item(pg_temp.id('v9'), 'confirmation_overdue'), null, 'at 72 hours: queued for review');
select is(pg_temp.st(pg_temp.id('v9')), 'vendor_completed', 'the visit is still not confirmed: silence confirms nothing');
select is((select homeowner_confirmed_at from public.service_requests where id = pg_temp.id('v9')), null, 'and has no confirmation time');
select is(pg_temp.confirm(1, pg_temp.id('v9'), pg_temp.done_at(pg_temp.id('v9')))->>'outcome', 'confirmed', 'the homeowner can still confirm');
select is(pg_temp.item(pg_temp.id('v9'), 'confirmation_overdue'), null, 'which closes the item');
-- A legacy completion without recorded evidence is queued for operations (Phase 4 D4).
update public.service_requests set status = 'vendor_completed', vendor_completed_at = now() - interval '1 day', photo_proof_urls = '{synthetic-legacy}'
 where id = pg_temp.id('v8');
select isnt(pg_temp.item(pg_temp.id('v8'), 'evidence_unverified'), null, 'a completion without recorded evidence is queued');

select * from finish();
rollback;
