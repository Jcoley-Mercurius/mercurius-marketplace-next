-- TRACE-144 (CS-9, 20261112001000): dispute reason categories, DEC-2026-054 item 1. The category is
-- required by the new command overloads, recorded once on the dispute, shown by dispute_detail, and
-- for reporting only: it changes no hold, money, window or ticket behavior. The existing signatures
-- keep working for the deployed client. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 assigned provider, 4 operator.
insert into auth.users(id,email) select ('c9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, 'cs9-'||n||'@example.invalid'
  from generate_series(1,4) n;
delete from public.user_roles where user_id in ('c9100000-0000-4000-8000-000000000003','c9100000-0000-4000-8000-000000000004');
insert into public.user_roles(user_id,role) values
 ('c9100000-0000-4000-8000-000000000003','vendor'),('c9100000-0000-4000-8000-000000000004','admin');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('c9200000-0000-4000-8000-000000000001','c9100000-0000-4000-8000-000000000003','Synthetic CS-9 provider',true,true);
-- Jobs 1–4: homeowner A, completed 1 h ago. Job 5: homeowner B. Job 6: completed 49 h ago.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,service_catalog_id,frequency,zip_code,status,vendor_completed_at)
 select ('c9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
   case when n = 5 then 'c9100000-0000-4000-8000-000000000002'::uuid else 'c9100000-0000-4000-8000-000000000001'::uuid end,
   'c9200000-0000-4000-8000-000000000001','Synthetic CS-9 service','Synthetic address',
   (select id from public.services_catalog order by id limit 1),'one-time','00000','vendor_completed',
   now() - case when n = 6 then interval '49 hours' else interval '1 hour' end
 from generate_series(1,6) n;

create function pg_temp.u(n integer) returns uuid language sql as $$ select ('c9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.j(n integer) returns uuid language sql as $$ select ('c9300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.done(n integer) returns timestamptz language sql as $$ select vendor_completed_at from public.service_requests where id = pg_temp.j(n) $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;
create function pg_temp.fails(p_user integer, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.call(p_user, p_sql);
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end $$;
create function pg_temp.category(n integer) returns text language sql as $$
  select reason_category from public.disputes where job_id = pg_temp.j(n) order by created_at desc limit 1 $$;

create temp table money_before as select (select count(*) from public.money_refund_authorizations) refunds,
  (select count(*) from public.money_holds) holds, (select count(*) from public.money_obligations) obligations;

-- ── Schema and grants ───────────────────────────────────────────────────────────────────────
select has_column('public', 'disputes', 'reason_category', 'disputes carry a reason category');
select col_is_null('public', 'disputes', 'reason_category', 'the category is nullable for disputes filed before CS-9');
select ok(has_function_privilege('authenticated','public.homeowner_raise_dispute(uuid,text,text)','EXECUTE'), 'signed in: the categorized follow-up command is callable');
select ok(has_function_privilege('authenticated','public.homeowner_dispute_completion(uuid,timestamptz,text,text)','EXECUTE'), 'signed in: the categorized completion command is callable');
select ok(not has_function_privilege('anon','public.homeowner_raise_dispute(uuid,text,text)','EXECUTE'), 'anon: categorized follow-up refused');
select ok(not has_function_privilege('anon','public.homeowner_dispute_completion(uuid,timestamptz,text,text)','EXECUTE'), 'anon: categorized completion refused');
select ok(has_function_privilege('authenticated','public.homeowner_raise_dispute(uuid,text)','EXECUTE'), 'the deployed follow-up signature is kept');
select ok(has_function_privilege('authenticated','public.homeowner_dispute_completion(uuid,timestamptz,text)','EXECUTE'), 'the deployed completion signature is kept');
select ok(not has_function_privilege('authenticated','private.dispute_set_category(uuid,text)','EXECUTE'), 'clients cannot call the category setter');

-- ── Validation ──────────────────────────────────────────────────────────────────────────────
select is(pg_temp.fails(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L,%L))', pg_temp.j(1), 'Synthetic reason', 'refund_please')), '22023', 'an unknown category is refused');
select is(pg_temp.fails(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L,%L))', pg_temp.j(1), 'Synthetic reason', null)), '22023', 'a missing category is refused');
select is((select count(*)::int from public.disputes where job_id = pg_temp.j(1)), 0, 'a refused category opens no dispute');

-- ── Follow-up path (JobFollowUp) ────────────────────────────────────────────────────────────
select ok(pg_temp.call(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L,%L))', pg_temp.j(1), 'Synthetic missed area', 'not_as_agreed')) is not null, 'homeowner files with a category');
select is(pg_temp.category(1), 'not_as_agreed', 'the category is recorded on the dispute');
select is((select status from public.service_requests where id = pg_temp.j(1)), 'disputed', 'the job is disputed as before');
select is(pg_temp.fails(2, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L,%L))', pg_temp.j(1), 'Not mine', 'quality')), '42501', 'another homeowner is refused');
select is(pg_temp.fails(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L,%L))', pg_temp.j(6), 'Too late', 'quality')), '22023', 'the 48-hour window still applies');

-- ── Completion path (HomeownerJobDetailDialog), with replay ─────────────────────────────────
select is(pg_temp.call(1, format('select public.homeowner_dispute_completion(%L,%L,%L,%L)', pg_temp.j(2), pg_temp.done(2), 'Synthetic scratch', 'damage')) ->> 'outcome', 'disputed', 'completion dispute with a category');
select is(pg_temp.category(2), 'damage', 'its category is recorded');
select is(pg_temp.call(1, format('select public.homeowner_dispute_completion(%L,%L,%L,%L)', pg_temp.j(2), pg_temp.done(2), 'Synthetic scratch', 'damage')) ->> 'outcome', 'replayed', 'the same report replays');
select is(pg_temp.fails(1, format('select public.homeowner_dispute_completion(%L,%L,%L,%L)', pg_temp.j(2), pg_temp.done(2), 'Synthetic scratch', 'quality')), '22023', 'a replay with another category is refused');
select is(pg_temp.category(2), 'damage', 'the recorded category is unchanged');
select is((select count(*)::int from public.disputes where job_id = pg_temp.j(2)), 1, 'one dispute for the job');

-- ── Deployed signatures still work, with no category ────────────────────────────────────────
select is(pg_temp.call(1, format('select public.homeowner_dispute_completion(%L,%L,%L)', pg_temp.j(3), pg_temp.done(3), 'Synthetic legacy client')) ->> 'outcome', 'disputed', 'the deployed completion signature files a dispute');
select is(pg_temp.category(3), null, 'without a category it stays null');
select ok(pg_temp.call(1, format('select to_jsonb(public.homeowner_raise_dispute(%L,%L))', pg_temp.j(4), 'Synthetic legacy follow-up')) is not null, 'the deployed follow-up signature files a dispute');

-- ── Direct writes cannot set or change it ───────────────────────────────────────────────────
select is(pg_temp.fails(4, format('update public.disputes set reason_category = %L where job_id = %L returning to_jsonb(id)', 'other', pg_temp.j(3))), '42501', 'operator: direct set refused');
select is(pg_temp.fails(4, format('update public.disputes set reason_category = %L where job_id = %L returning to_jsonb(id)', 'quality', pg_temp.j(1))), '42501', 'operator: direct change refused');
select throws_ok(format($q$update public.disputes set reason_category = 'quality' where job_id = %L$q$, pg_temp.j(1)), '42501', null, 'the guard refuses a change even with table privileges');
select is(pg_temp.category(1), 'not_as_agreed', 'the category is unchanged');
select throws_ok(format($q$insert into public.disputes(job_id,homeowner_id,vendor_id,reason,reason_category) values (%L,%L,%L,'x','other')$q$,
  pg_temp.j(5), pg_temp.u(2), 'c9200000-0000-4000-8000-000000000001'), '42501', null, 'an insert carrying a category is refused');

-- ── Shown by dispute_detail to the homeowner, provider and operations ───────────────────────
select is(pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(1))) -> 'disputes' -> 0 ->> 'reason_category', 'not_as_agreed', 'homeowner sees the category');
select is(pg_temp.call(3, format('select public.dispute_detail(%L)', pg_temp.j(1))) -> 'disputes' -> 0 ->> 'reason_category', 'not_as_agreed', 'provider sees the category');
select is(pg_temp.call(4, format('select public.dispute_detail(%L)', pg_temp.j(1))) -> 'disputes' -> 0 ->> 'reason_category', 'not_as_agreed', 'operations sees the category');
select ok((pg_temp.call(1, format('select public.dispute_detail(%L)', pg_temp.j(3))) -> 'disputes' -> 0) ? 'reason_category', 'a pre-CS-9 dispute reports the key as null');

-- ── Reporting only: no money or hold record is created ──────────────────────────────────────
select is((select count(*) from public.money_refund_authorizations), (select refunds from money_before), 'no refund authorization');
select is((select count(*) from public.money_holds), (select holds from money_before), 'no money hold row');
select is((select count(*) from public.money_obligations), (select obligations from money_before), 'no obligation');

select * from finish();
rollback;
