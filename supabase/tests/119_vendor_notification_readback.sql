-- Phase 7.2B / TRACE-153 (DEC-2026-065; contract G1-01/G2-01, §8 items 1-4 and 6). Two parts:
-- A. The vendor readback's database contract: a vendor reads, counts and marks only its own rows;
--    keyset paging on (created_at desc, id desc) reaches every row once, including rows that share a
--    timestamp across a page boundary; marking sets read_at only where it is null, only on the ids
--    given, and is idempotent; anon reads nothing. The queries mirror useVendorNotifications.
-- B. DEC-2026-063 (O-11) producer evidence through the real commands: one homeowner row when a
--    provider accepts other terms, one provider row per homeowner answer, none to anyone else; a
--    failed notification write rolls the business change back; a replayed key writes no row; a second
--    answer writes none. Switch-off (SQL 116:332-339 preserved): gate off creates no other-terms offer
--    and no entry into awaiting_terms (no N-QTE-09), but an answer to terms accepted before switch-off
--    still succeeds and writes exactly one N-QTE-10, and a decline whose re-match fails writes N-QTE-11.
-- Concurrency of answers is in scripts/offer-terms-concurrency.mjs (C16, C17). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner, 3 provider P1 (submitted terms), 4 provider P2 (other terms), 5-6 admins,
-- 7 vendor V (readback isolation peer, no provider record).
insert into auth.users(id,email) select ('9b910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'n119-'||n||'@example.invalid'
  from unnest(array[1,3,4,5,6,7]) n;
delete from public.user_roles where user_id in (select ('9b910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from unnest(array[3,4,5,6,7]) n);
insert into public.user_roles(user_id,role) values
 ('9b910000-0000-4000-8000-000000000003','vendor'),('9b910000-0000-4000-8000-000000000004','vendor'),
 ('9b910000-0000-4000-8000-000000000007','vendor'),
 ('9b910000-0000-4000-8000-000000000005','admin'),('9b910000-0000-4000-8000-000000000006','admin');

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('9b910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql as $$ select ('9b920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.n(k integer) returns uuid language sql as $$ select ('9b990000-0000-4000-8000-'||lpad(k::text,12,'0'))::uuid $$;
create function pg_temp.key(n integer) returns uuid language sql as $$ select ('9b970000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as $$
declare r text; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  set local role anon;
  begin
    execute p_sql; r := 'ok';
  exception when others then r := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;

-- =====================================================================================================
-- A. Readback contract
-- =====================================================================================================
-- V has 9 rows: three share t3 and three share t1, so pages of 2 and 4 split equal-timestamp groups.
-- Unread: n1, n2, n4, n6, n8 (5). P2 and the homeowner each have rows V must never see or change.
insert into public.notifications(id,user_id,type,severity,title,body,link,read_at,created_at) values
 (pg_temp.n(1), pg_temp.u(7),'job_status','info','Service update','reschedule request: synthetic reason','/notifications',null,'2026-01-05 10:00:00.000007+00'),
 (pg_temp.n(2), pg_temp.u(7),'job_offer','warning','New job offer — respond within four hours','Accept or decline.','/vendor/jobs',null,'2026-01-04 10:00:00.000003+00'),
 (pg_temp.n(3), pg_temp.u(7),'pricing','info','Price published','Synthetic','/vendor/packages','2026-01-06 00:00:00+00','2026-01-04 10:00:00.000003+00'),
 (pg_temp.n(4), pg_temp.u(7),'job_status','info','Job cancelled','Synthetic','/vendor/jobs',null,'2026-01-04 10:00:00.000003+00'),
 (pg_temp.n(5), pg_temp.u(7),'support','info','Mercurius replied on MS-1','Synthetic','/support','2026-01-06 00:00:00+00','2026-01-03 10:00:00+00'),
 (pg_temp.n(6), pg_temp.u(7),'legacy','info','Legacy','Synthetic',null,null,'2026-01-02 10:00:00.5+00'),
 (pg_temp.n(7), pg_temp.u(7),'job_status','info','Job completed','Synthetic','/vendor/jobs','2026-01-06 00:00:00+00','2026-01-01 10:00:00+00'),
 (pg_temp.n(8), pg_temp.u(7),'job_status','info','Job completed','Synthetic','/vendor/jobs',null,'2026-01-01 10:00:00+00'),
 (pg_temp.n(9), pg_temp.u(7),'job_status','info','Job completed','Synthetic','/vendor/jobs','2026-01-06 00:00:00+00','2026-01-01 10:00:00+00'),
 (pg_temp.n(20), pg_temp.u(4),'job_status','info','Job completed','Synthetic','/vendor/jobs',null,'2026-01-05 10:00:00+00'),
 (pg_temp.n(21), pg_temp.u(1),'job_status','info','Job complete','Synthetic','/dashboard',null,'2026-01-05 10:00:00+00');

-- The client's page query and keyset cursor, run as the given user until no more rows.
create function pg_temp.walk(p_user integer, p_size integer) returns jsonb language plpgsql as $$
declare acc jsonb := '[]'::jsonb; page jsonb; c_at text; c_id text; guard integer := 0;
begin
  loop
    guard := guard + 1;
    if guard > 50 then raise exception 'paging did not end'; end if;
    page := pg_temp.call(p_user, format($q$select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', created_at) order by created_at desc, id desc), '[]'::jsonb)
      from (select id, created_at from public.notifications where user_id = auth.uid()
        and (%1$L::timestamptz is null or created_at < %1$L::timestamptz or (created_at = %1$L::timestamptz and id < %2$L::uuid))
        order by created_at desc, id desc limit %3$s) s$q$, c_at, c_id, p_size + 1));
    acc := acc || coalesce((select jsonb_agg(e->'id' order by o) from jsonb_array_elements(page) with ordinality x(e, o) where o <= p_size), '[]'::jsonb);
    exit when jsonb_array_length(page) <= p_size;
    c_at := page->(p_size - 1)->>'at';
    c_id := page->(p_size - 1)->>'id';
  end loop;
  return acc;
end $$;
create function pg_temp.expected_order(p_user integer) returns jsonb language sql as $$
  select jsonb_agg(to_jsonb(id) order by created_at desc, id desc) from public.notifications where user_id = pg_temp.u(p_user) $$;
create function pg_temp.unread(p_user integer) returns bigint language sql as $$
  select (pg_temp.call(p_user, 'select to_jsonb(count(*)) from public.notifications where user_id = auth.uid() and read_at is null'))::text::bigint $$;
create function pg_temp.mark(p_user integer, p_ids uuid[]) returns bigint language sql as $$
  select (pg_temp.call(p_user, format($q$with u as (update public.notifications set read_at = now()
    where user_id = auth.uid() and id = any(%L::uuid[]) and read_at is null returning 1) select to_jsonb(count(*)) from u$q$, p_ids)))::text::bigint $$;

select is(pg_temp.call(7, 'select to_jsonb(count(*)) from public.notifications')::text, '9', 'RLS: a vendor reads only its own nine rows, unfiltered');
select is(pg_temp.call(7, format('select to_jsonb(count(*)) from public.notifications where user_id in (%L, %L)', pg_temp.u(4), pg_temp.u(1)))::text, '0',
  'RLS: another vendor''s and a homeowner''s rows are not readable');
select is(pg_temp.call(4, format('select to_jsonb(count(*)) from public.notifications where user_id = %L', pg_temp.u(7)))::text, '0',
  'RLS: and the other vendor cannot read V''s rows either');
select is(pg_temp.as_anon('select count(*) from public.notifications'), '42501', 'anon has no access to notifications');

select is(pg_temp.walk(7, 2), pg_temp.expected_order(7), 'keyset pages of 2 reach every row once, in order, across equal timestamps');
select is(pg_temp.walk(7, 4), pg_temp.expected_order(7), 'keyset pages of 4: the same rows in the same order');
select is(pg_temp.walk(7, 25), pg_temp.expected_order(7), 'one page of 25: the same rows');
select is((select count(distinct e) from jsonb_array_elements(pg_temp.walk(7, 2)) e), 9::bigint, 'no row is repeated');
select is(pg_temp.walk(7, 2)->>0, pg_temp.n(1)::text, 'newest first');
select is((select jsonb_agg(e) from jsonb_array_elements(pg_temp.walk(7, 2)) with ordinality x(e, o) where o between 2 and 4),
  jsonb_build_array(pg_temp.n(4), pg_temp.n(3), pg_temp.n(2)), 'rows sharing a timestamp are ordered by id, descending');

select is(pg_temp.unread(7), 5::bigint, 'the exact unread count covers the whole history, not only a page');
select is(pg_temp.unread(4), 1::bigint, 'and only the caller''s rows');

-- Cross-account writes change nothing.
select is(pg_temp.call(7, format('with u as (update public.notifications set read_at = now() where id = %L returning 1) select to_jsonb(count(*)) from u', pg_temp.n(20)))::text, '0',
  'a vendor cannot mark another vendor''s row read');
select is(pg_temp.call(7, format('with u as (update public.notifications set read_at = now() where id = %L returning 1) select to_jsonb(count(*)) from u', pg_temp.n(21)))::text, '0',
  'a vendor cannot mark a homeowner''s row read');
select is(pg_temp.call(7, format('with d as (delete from public.notifications where id in (%L, %L) returning 1) select to_jsonb(count(*)) from d', pg_temp.n(20), pg_temp.n(21)))::text, '0',
  'a vendor cannot delete other accounts'' rows');
select is((select count(*) from public.notifications where id in (pg_temp.n(20), pg_temp.n(21)) and read_at is null), 2::bigint, 'those rows are unchanged');
select is(pg_temp.err(format('select pg_temp.call(7, %L)', format($q$with i as (insert into public.notifications(user_id,type,severity,title) values (%L,'x','info','x') returning 1) select to_jsonb(count(*)) from i$q$, pg_temp.u(7)))),
  '42501: new row violates row-level security policy for table "notifications"', 'a vendor cannot write a notice, even to itself');
select is(pg_temp.err(format('select pg_temp.call(7, %L)', format($q$with i as (insert into public.notifications(user_id,type,severity,title) values (%L,'x','info','x') returning 1) select to_jsonb(count(*)) from i$q$, pg_temp.u(4)))),
  '42501: new row violates row-level security policy for table "notifications"', 'or to another account');
select is(pg_temp.mark(7, array[pg_temp.n(20), pg_temp.n(21)]), 0::bigint, 'marking with other accounts'' ids changes nothing');

-- "Mark visible as read": only the ids loaded and shown (here the first page of 4: n1, n4, n3, n2).
create temp table before_mark as select id, read_at from public.notifications where user_id = pg_temp.u(7);
select is(pg_temp.mark(7, array[pg_temp.n(1), pg_temp.n(4), pg_temp.n(3), pg_temp.n(2)]), 3::bigint, 'mark visible updates the three unread rows shown');
select is(pg_temp.unread(7), 2::bigint, 'the exact count drops by three');
select is((select array_agg(id order by id) from public.notifications where user_id = pg_temp.u(7) and read_at is null), array[pg_temp.n(6), pg_temp.n(8)],
  'rows not loaded stay unread');
select is((select read_at from public.notifications where id = pg_temp.n(3)), (select read_at from before_mark where id = pg_temp.n(3)),
  'an already read row shown on the page keeps its read_at');
create temp table after_mark as select id, read_at from public.notifications where user_id = pg_temp.u(7);
select is(pg_temp.mark(7, array[pg_temp.n(1), pg_temp.n(4), pg_temp.n(3), pg_temp.n(2)]), 0::bigint, 'marking again is idempotent: no row changes');
select is((select count(*) from public.notifications n join after_mark a using (id) where n.read_at is distinct from a.read_at), 0::bigint,
  'and every read_at is exactly as before');
-- Opening one row: read_at only while null.
select is(pg_temp.mark(7, array[pg_temp.n(8)]), 1::bigint, 'opening an unread row marks it');
select is(pg_temp.mark(7, array[pg_temp.n(8)]), 0::bigint, 'opening it again changes nothing');
select is(pg_temp.unread(7), 1::bigint, 'count after opening one');
select is((select count(*) from public.notifications where id in (pg_temp.n(20), pg_temp.n(21)) and read_at is null), 2::bigint,
  'other accounts'' rows are still unread');

-- =====================================================================================================
-- B. DEC-2026-063 producers
-- =====================================================================================================
insert into public.service_categories(id,name) values ('synthetic-119-cat','Synthetic notices');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-119-lawn','Synthetic notice lawn','synthetic-119-cat',60,40,120,'weekly','{one-time,weekly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00119','Synthetic',true,false);
insert into private.r0_lee_zips values ('00119');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by) values (pg_temp.u(1),'00119','synthetic-119-lawn',pg_temp.u(5));
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 (pg_temp.c(1), pg_temp.u(3), 'Synthetic submitted provider', true, true),
 (pg_temp.c(2), pg_temp.u(4), 'Synthetic other provider', true, true);
insert into public.contractor_service_zips(contractor_id,zip_code) values (pg_temp.c(1),'00119'),(pg_temp.c(2),'00119');
insert into public.vendor_packages(id,contractor_id,service_id,name,description,pricing_mode,default_frequency,is_active,needs_review,included_scope,policy_notes) values
 ('9b940000-0000-4000-8000-000000000001',pg_temp.c(1),'synthetic-119-lawn','Synthetic submitted lawn',null,'fixed','one-time',true,false,'{Mowing}',null),
 ('9b940000-0000-4000-8000-000000000002',pg_temp.c(2),'synthetic-119-lawn','Synthetic other lawn',null,'fixed','one-time',true,false,'{Mowing}',null);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('9b950000-0000-4000-8000-000000000001','9b940000-0000-4000-8000-000000000001','One time',60,'one-time',0,'[]'),
 ('9b950000-0000-4000-8000-000000000002','9b940000-0000-4000-8000-000000000002','Standard',70,'one-time',0,'[]');

create function pg_temp.submit(p_key text) returns uuid language sql as $$
  select (pg_temp.call(1, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00119'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_build_object(
      'service_id','synthetic-119-lawn','frequency','one-time','package_id','9b940000-0000-4000-8000-000000000001',
      'tier_id','9b950000-0000-4000-8000-000000000001','expected',jsonb_build_object('pricing_mode','fixed','total',60))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.offer(p_request uuid) returns uuid language sql as $$ select private.offer_next_for_request_internal(p_request) $$;
create function pg_temp.accept(p_user integer, p_request uuid) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(%s, %L)', p_user, format('select to_jsonb(public.vendor_accept_job(%L))', p_request))) $$;
create function pg_temp.matching(p_request uuid) returns text language sql as $$
  select status || '/' || matching_status from public.service_requests where id = p_request $$;
create function pg_temp.terms_of(p_request uuid) returns public.job_offer_terms language sql as $$
  select t.* from public.job_offer_terms t join public.job_match_attempts a on a.id = t.offer_id
  where t.request_id = p_request order by a.attempt_number desc limit 1 $$;
create function pg_temp.respond(p_request uuid, p_key uuid, p_accept boolean, p_reason text default null) returns text language sql as $$
  select pg_temp.err(format('select pg_temp.call(1, %L)', format('select public.homeowner_respond_offer_terms(%L,%L,%L,%L::jsonb,%L)',
    (pg_temp.terms_of(p_request)).id, p_key, p_accept,
    jsonb_build_object('terms_id', (pg_temp.terms_of(p_request)).id, 'consent_hash', (pg_temp.terms_of(p_request)).consent_hash), p_reason))) $$;
create function pg_temp.replayed(p_request uuid, p_key uuid, p_accept boolean) returns text language sql as $$
  select pg_temp.call(1, format('select public.homeowner_respond_offer_terms(%L,%L,%L,%L::jsonb,null)',
    (pg_temp.terms_of(p_request)).id, p_key, p_accept,
    jsonb_build_object('terms_id', (pg_temp.terms_of(p_request)).id, 'consent_hash', (pg_temp.terms_of(p_request)).consent_hash)))->>'replayed' $$;
create function pg_temp.p1_active(p_on boolean) returns jsonb language sql as $$
  select pg_temp.call(3, format('select public.vendor_set_package_active(%L,%L,%L)', '9b940000-0000-4000-8000-000000000001', p_on,
    (select updated_at from public.vendor_packages where id = '9b940000-0000-4000-8000-000000000001'))) $$;
create function pg_temp.gate(p_on boolean, p_reason text) returns void language sql as $$
  update private.money_feature_gates set enabled = p_on, reason = p_reason where name = 'offer_terms' $$;
-- Rows with this title for this request: total, and how many went to the given recipient.
create function pg_temp.rows(p_request uuid, p_title text) returns bigint language sql as $$
  select count(*) from public.notifications where related_request_id = p_request and title = p_title $$;
create function pg_temp.rows_to(p_request uuid, p_title text, p_user uuid) returns bigint language sql as $$
  select count(*) from public.notifications where related_request_id = p_request and title = p_title and user_id = p_user $$;
-- A failed notification write, as SQL 003 forces it.
create function pg_temp.fail_notifications() returns trigger language plpgsql as $$
begin raise exception 'Synthetic notification failure'; end $$;

select is((select enabled from private.money_feature_gates where name = 'offer_terms'), false, 'the offer_terms gate starts off');
insert into fx select 'r' || n, pg_temp.submit('n119-r' || n || '-000000001') from generate_series(1, 6) n;
select is((select count(*) from fx where key like 'r%' and id is not null), 6::bigint, 'six requests submitted for P1''s offering');
select pg_temp.p1_active(false);

-- Gate off from the start: no other-terms offer, no notice.
select is(pg_temp.offer(pg_temp.id('r5')), null::uuid, 'gate off: no offer at other terms is made');
select is((select count(*) from public.notifications where related_request_id = pg_temp.id('r5')), 0::bigint,
  'gate off: no offer notice and no terms notice for that request');

select pg_temp.gate(true, 'Synthetic owner activation');

-- N-REQ-01 and N-QTE-09: provider accepts other terms -> one homeowner row --------------------------------
select ok(pg_temp.offer(pg_temp.id('r1')) is not null, 'r1 is offered to P2 at other terms');
select is(pg_temp.rows_to(pg_temp.id('r1'), 'New job offer — respond within four hours', pg_temp.u(4)), 1::bigint, 'the offered provider gets one offer notice');
select is(pg_temp.rows(pg_temp.id('r1'), 'New job offer — respond within four hours'), 1::bigint, 'and no one else does');
-- Rollback: a failed notification write leaves the provider's acceptance unrecorded.
create trigger n119_fail_notifications before insert on public.notifications for each row execute function pg_temp.fail_notifications();
select is(pg_temp.accept(4, pg_temp.id('r1')), 'P0001: Synthetic notification failure', 'a failed homeowner notice fails the acceptance');
drop trigger n119_fail_notifications on public.notifications;
select is(pg_temp.matching(pg_temp.id('r1')), 'matched/offered', 'rolled back: the request still waits for the provider');
select is(pg_temp.rows(pg_temp.id('r1'), 'Review this provider''s terms'), 0::bigint, 'rolled back: no terms notice');
select is(pg_temp.accept(4, pg_temp.id('r1')), 'ok', 'P2 accepts');
select is(pg_temp.matching(pg_temp.id('r1')), 'matched/awaiting_terms', 'the request waits for the homeowner');
select is(pg_temp.rows_to(pg_temp.id('r1'), 'Review this provider''s terms', pg_temp.u(1)), 1::bigint, 'N-QTE-09: exactly one row, to the homeowner');
select is(pg_temp.rows(pg_temp.id('r1'), 'Review this provider''s terms'), 1::bigint, 'N-QTE-09: no row to anyone else');
select is((select type || '|' || link from public.notifications where related_request_id = pg_temp.id('r1') and title = 'Review this provider''s terms'),
  'job_status|/dashboard', 'N-QTE-09 type and link');

-- N-QTE-10 accept: one provider row; failure rolls back; replay and second answer write none -----------
create trigger n119_fail_notifications before insert on public.notifications for each row execute function pg_temp.fail_notifications();
select is(pg_temp.respond(pg_temp.id('r1'), pg_temp.key(1), true), 'P0001: Synthetic notification failure', 'a failed provider notice fails the answer');
drop trigger n119_fail_notifications on public.notifications;
select is((select count(*) from public.job_offer_terms_responses where request_id = pg_temp.id('r1')), 0::bigint, 'rolled back: no answer is recorded');
select is(pg_temp.matching(pg_temp.id('r1')), 'matched/awaiting_terms', 'rolled back: still waiting for the homeowner');
select is(pg_temp.respond(pg_temp.id('r1'), pg_temp.key(1), true), 'ok', 'the homeowner accepts');
select is(pg_temp.rows_to(pg_temp.id('r1'), 'Homeowner accepted your terms', pg_temp.u(4)), 1::bigint, 'N-QTE-10: exactly one row, to the terms'' provider');
select is(pg_temp.rows(pg_temp.id('r1'), 'Homeowner accepted your terms'), 1::bigint, 'N-QTE-10: no row to the homeowner, P1, V or admins');
select is((select concat_ws('|', type, link, body) from public.notifications where related_request_id = pg_temp.id('r1') and title = 'Homeowner accepted your terms'),
  'job_status|/vendor/jobs|The homeowner accepted the terms you accepted. The service is scheduled.',
  'N-QTE-10 accept: the type, title and link the vendor presenter recognizes');
select is(pg_temp.replayed(pg_temp.id('r1'), pg_temp.key(1), true), 'true', 'a replay with the same key is replayed');
select is(pg_temp.rows(pg_temp.id('r1'), 'Homeowner accepted your terms'), 1::bigint, 'the replay writes no row');
select is(pg_temp.respond(pg_temp.id('r1'), pg_temp.key(2), true), '22023: You already answered these terms', 'a second answer with another key is refused');
select is(pg_temp.rows(pg_temp.id('r1'), 'Homeowner accepted your terms') + pg_temp.rows(pg_temp.id('r1'), 'Homeowner declined your terms'), 1::bigint,
  'and writes no row');

-- N-QTE-10 decline: one provider row, fixed text (the homeowner's reason is not in it) ------------------
select ok(pg_temp.offer(pg_temp.id('r2')) is not null, 'r2 is offered to P2');
select is(pg_temp.accept(4, pg_temp.id('r2')), 'ok', 'P2 accepts r2');
select is(pg_temp.respond(pg_temp.id('r2'), pg_temp.key(3), false, 'Synthetic private reason: gate code 4471'), 'ok', 'the homeowner declines with a reason');
select is(pg_temp.rows_to(pg_temp.id('r2'), 'Homeowner declined your terms', pg_temp.u(4)), 1::bigint, 'N-QTE-10 decline: one row to the provider');
select is(pg_temp.rows(pg_temp.id('r2'), 'Homeowner declined your terms'), 1::bigint, 'and to no one else');
select is((select concat_ws('|', type, link, body) from public.notifications where related_request_id = pg_temp.id('r2') and title = 'Homeowner declined your terms'),
  'job_status|/vendor/jobs|The homeowner declined these terms. The request is no longer assigned to you.', 'the decline notice is fixed text');
select is((select count(*) from public.notifications where related_request_id = pg_temp.id('r2') and (body like '%4471%' or title like '%4471%')), 0::bigint,
  'the homeowner''s decline reason is in no notice');
select is(pg_temp.rows(pg_temp.id('r2'), 'Matching after a decline needs attention'), 0::bigint, 'a re-match that finds no one is not a failure: no N-QTE-11');

-- Switch-off --------------------------------------------------------------------------------------------
select ok(pg_temp.offer(pg_temp.id('r3')) is not null, 'r3 is offered to P2');
select is(pg_temp.accept(4, pg_temp.id('r3')), 'ok', 'P2 accepts r3 before switch-off');
select ok(pg_temp.offer(pg_temp.id('r4')) is not null, 'r4 is offered to P2, not yet accepted');
select ok(pg_temp.offer(pg_temp.id('r6')) is not null, 'r6 is offered to P2');
select is(pg_temp.accept(4, pg_temp.id('r6')), 'ok', 'P2 accepts r6 before switch-off');
select is(pg_temp.rows(pg_temp.id('r3'), 'Review this provider''s terms') + pg_temp.rows(pg_temp.id('r6'), 'Review this provider''s terms'), 2::bigint,
  'one N-QTE-09 row each before switch-off');
select pg_temp.gate(false, 'Synthetic switch-off');
select is(pg_temp.accept(4, pg_temp.id('r4')), '22023: Offers at other terms are paused; Mercurius will follow up [offer_terms:inactive]',
  'gate off: a pending other-terms offer cannot be accepted');
select is(pg_temp.matching(pg_temp.id('r4')), 'matched/offered', 'gate off: no entry into awaiting_terms');
select is(pg_temp.rows(pg_temp.id('r4'), 'Review this provider''s terms'), 0::bigint, 'gate off: no N-QTE-09 row');
select is(pg_temp.respond(pg_temp.id('r3'), pg_temp.key(4), true), 'ok', 'gate off: terms accepted before switch-off can still be answered');
select is(pg_temp.matching(pg_temp.id('r3')), 'scheduled/matched', 'and the answer takes effect');
select is(pg_temp.rows_to(pg_temp.id('r3'), 'Homeowner accepted your terms', pg_temp.u(4)), 1::bigint, 'gate off: exactly one N-QTE-10 row to the provider');
select is(pg_temp.rows(pg_temp.id('r3'), 'Homeowner accepted your terms'), 1::bigint, 'and none to anyone else');

-- Gate off, decline whose re-match fails -> N-QTE-11 to every admin (as SQL 117 forces the failure).
-- P1's offering is live again, so matching after the decline selects it at the submitted terms (allowed
-- with the gate off); offer creation is then refused.
select pg_temp.p1_active(true);
create function pg_temp.refuse_offer() returns trigger language plpgsql as $$
begin raise exception 'Selected contractor/package is no longer eligible for this request'; end $$;
create trigger n119_refuse_offer before insert on public.job_match_attempts for each row execute function pg_temp.refuse_offer();
select is(pg_temp.respond(pg_temp.id('r6'), pg_temp.key(5), false), 'ok', 'gate off: the decline succeeds although matching after it fails');
drop trigger n119_refuse_offer on public.job_match_attempts;
select is(pg_temp.matching(pg_temp.id('r6')), 'pending/awaiting_match', 'the request waits for operations');
select is(pg_temp.rows_to(pg_temp.id('r6'), 'Homeowner declined your terms', pg_temp.u(4)), 1::bigint, 'N-QTE-10: one decline row to the provider');
select is(pg_temp.rows(pg_temp.id('r6'), 'Homeowner declined your terms'), 1::bigint, 'and to no one else');
select is(pg_temp.rows(pg_temp.id('r6'), 'Matching after a decline needs attention'),
  (select count(*) from public.user_roles where role = 'admin'), 'N-QTE-11: one row per admin');
select is((select count(distinct user_id) from public.notifications where related_request_id = pg_temp.id('r6') and title = 'Matching after a decline needs attention'),
  (select count(*) from public.user_roles where role = 'admin'), 'each admin once');
select is((select count(*) from public.notifications n where n.related_request_id = pg_temp.id('r6') and n.title = 'Matching after a decline needs attention'
    and not exists (select 1 from public.user_roles r where r.user_id = n.user_id and r.role = 'admin')), 0::bigint, 'N-QTE-11: no row to a non-admin');

-- The vendor reads its DEC-2026-063 notices through the readback query, and V sees none of them.
select is(pg_temp.call(4, $q$select to_jsonb(count(*)) from public.notifications where user_id = auth.uid()
    and title in ('Homeowner accepted your terms', 'Homeowner declined your terms')$q$)::text, '4',
  'P2 reads its four terms answers (r1, r2, r3 accepted or declined; r6 declined)');
select is(pg_temp.call(7, $q$select to_jsonb(count(*)) from public.notifications where related_request_id is not null and title like 'Homeowner%'$q$)::text, '0',
  'V reads none of them');
select is(pg_temp.call(3, $q$select to_jsonb(count(*)) from public.notifications where title like 'Homeowner%terms'$q$)::text, '0',
  'P1, never offered at other terms, reads none of them');

select * from finish();
rollback;
