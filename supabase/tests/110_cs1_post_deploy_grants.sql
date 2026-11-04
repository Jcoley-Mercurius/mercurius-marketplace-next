-- TRACE-138 (CS-1, 20261110001000). Synthetic fixtures only.
-- (1) W-1, DEC-2026-055 item 1: no client role reads contractors.special_offer, by name, by a broad
--     or whole-row select, or through a predicate; operators still read it through
--     admin_vendor_special_offer, and every other signed-in column is unchanged.
-- (2) W-2, DEC-2026-056 item 1: no client role executes get_vendor_earnings_metrics; the function is
--     kept, and vendor_own_earnings is unchanged.
-- (3) The deployed client's contractor reads still work.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('c1100000-0000-4000-8000-000000000001','cs1-operator@example.invalid',now()),
 ('c1100000-0000-4000-8000-000000000002','cs1-vendor-a@example.invalid',now()),
 ('c1100000-0000-4000-8000-000000000003','cs1-vendor-b@example.invalid',now()),
 ('c1100000-0000-4000-8000-000000000004','cs1-homeowner@example.invalid',now());
delete from public.user_roles where user_id in ('c1100000-0000-4000-8000-000000000002','c1100000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('c1100000-0000-4000-8000-000000000001','admin'),
 ('c1100000-0000-4000-8000-000000000002','vendor'),
 ('c1100000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services,location,bio,special_offer) values
 ('c1101000-0000-4000-8000-00000000000a','Synthetic CS-1 vendor A',true,true,'c1100000-0000-4000-8000-000000000002','{}','Fort Myers','Synthetic bio','Synthetic 20% off'),
 ('c1101000-0000-4000-8000-00000000000b','Synthetic CS-1 vendor B',true,true,'c1100000-0000-4000-8000-000000000003','{}','Fort Myers','Synthetic bio',null);

create function pg_temp.as_user(p_n integer) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1100000-0000-4000-8000-00000000000'||p_n||'"}',true) $$;

-- (1) Privileges as stored.
select is(has_column_privilege('authenticated','public.contractors','special_offer','SELECT'), false, 'signed-in users hold no SELECT on special_offer');
select is(has_column_privilege('anon','public.contractors','special_offer','SELECT'), false, 'anonymous visitors hold none (since 20261105001000)');
select is(has_table_privilege('authenticated','public.contractors','SELECT'), false, 'no table-level SELECT overrides the column revoke (signed in)');
select is(has_table_privilege('anon','public.contractors','SELECT'), false, 'no table-level SELECT overrides the column revoke (anonymous)');
select is((select count(*)::int from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'contractors' and column_name = 'special_offer' and privilege_type = 'SELECT'
    and grantee not in ('postgres','service_role')), 0, 'only the owner and service role hold SELECT on special_offer');
select is((select count(*)::int from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'contractors' and grantee in ('PUBLIC','anon','authenticated') and privilege_type = 'SELECT'), 0,
  'no client role or PUBLIC holds table SELECT on contractors');
-- Every other signed-in column is unchanged from the 20260903160000 projection.
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
  where attrelid = 'public.contractors'::regclass and attnum > 0 and not attisdropped
    and has_column_privilege('authenticated','public.contractors',attname,'SELECT')),
  'id,name,logo_url,bio,location,rating,badges,services,years_experience,jobs_completed,is_active,created_at,updated_at,user_id,marketing_enabled,our_promise,verified_specialty,video_url,website,tagline',
  'signed-in readable columns are the previous set without special_offer (and, since CS-7 / 20261111001000, without the payout-hold columns)');
select is(has_function_privilege('authenticated','public.admin_vendor_special_offer(uuid)','EXECUTE'), true, 'the operator readback stays callable; its body checks the operator');
select is(has_function_privilege('anon','public.admin_vendor_special_offer(uuid)','EXECUTE'), false, 'anonymous visitors cannot call the operator readback');
select is((select prosecdef from pg_proc where oid = 'public.admin_vendor_special_offer(uuid)'::regprocedure), true, 'the operator readback is security definer');

-- (1) Every client role and query shape is refused.
set local role anon;
select throws_ok($$select special_offer from public.contractors$$, '42501', null, 'anonymous: named column refused');
select throws_ok($$select * from public.contractors$$, '42501', null, 'anonymous: broad select refused');
reset role;

-- Homeowner (4), owning vendor (2), other vendor (3) and operator (1): direct reads refused for all.
create function pg_temp.refused(p_label text) returns setof text language plpgsql as $f$
begin
  return next throws_ok($q$select special_offer from public.contractors$q$, '42501', null, p_label || ': named column refused');
  return next throws_ok($q$select c.special_offer from public.contractors c where c.id = 'c1101000-0000-4000-8000-00000000000a'$q$, '42501', null, p_label || ': qualified named column for one row refused');
  return next throws_ok($q$select * from public.contractors$q$, '42501', null, p_label || ': broad select refused');
  return next throws_ok($q$select to_jsonb(c) from public.contractors c$q$, '42501', null, p_label || ': whole-row reference refused');
  return next throws_ok($q$select id from public.contractors where special_offer is not null$q$, '42501', null, p_label || ': predicate on the column refused');
  return next throws_ok($q$select id from public.contractors order by special_offer$q$, '42501', null, p_label || ': ordering by the column refused');
  return next throws_ok($q$update public.contractors set bio = bio where id = 'c1101000-0000-4000-8000-00000000000a' returning special_offer$q$, '42501', null, p_label || ': RETURNING the column refused');
  return next lives_ok($q$select id, name, bio, our_promise, verified_specialty from public.contractors$q$, p_label || ': other columns still readable');
end $f$;
grant execute on function pg_temp.refused(text) to authenticated;

select pg_temp.as_user(4);
set local role authenticated;
select * from pg_temp.refused('homeowner');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select * from pg_temp.refused('owning vendor');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select * from pg_temp.refused('other vendor');
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select * from pg_temp.refused('operator');
-- The operator readback still returns the stored text (DEC-2026-055 item 1: kept for operator access).
select is(public.admin_vendor_special_offer('c1101000-0000-4000-8000-00000000000a'), 'Synthetic 20% off', 'operator readback returns the stored text');
select is(public.admin_vendor_special_offer('c1101000-0000-4000-8000-00000000000b'), null, 'operator readback returns null when none is recorded');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$select public.admin_vendor_special_offer('c1101000-0000-4000-8000-00000000000a')$$, '42501', null, 'the owning vendor cannot use the operator readback');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select throws_ok($$select public.admin_vendor_special_offer('c1101000-0000-4000-8000-00000000000a')$$, '42501', null, 'a homeowner cannot use the operator readback');
reset role;
select is((select special_offer from public.contractors where id = 'c1101000-0000-4000-8000-00000000000a'), 'Synthetic 20% off', 'the stored text is unchanged');

-- (2) Legacy earnings metrics: kept, not executable by any client role.
select is((select count(*)::int from pg_proc where oid = 'public.get_vendor_earnings_metrics(uuid)'::regprocedure), 1, 'the legacy function is kept');
select is(has_function_privilege('authenticated','public.get_vendor_earnings_metrics(uuid)','EXECUTE'), false, 'signed-in users cannot execute the legacy metrics');
select is(has_function_privilege('anon','public.get_vendor_earnings_metrics(uuid)','EXECUTE'), false, 'anonymous visitors cannot execute the legacy metrics');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a
  where p.oid = 'public.get_vendor_earnings_metrics(uuid)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 0, 'PUBLIC holds no execute on the legacy metrics');
select is(has_function_privilege('authenticated','public.vendor_own_earnings()','EXECUTE'), true, 'the canonical earnings readback stays callable; its body checks the vendor');
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$select * from public.get_vendor_earnings_metrics('c1101000-0000-4000-8000-00000000000a')$$, '42501', null, 'the owning vendor is refused the legacy metrics');
select lives_ok($$select public.vendor_own_earnings()$$, 'the owning vendor still reads canonical earnings');
select is((public.vendor_own_earnings()->>'provider_found')::boolean, true, 'canonical earnings resolve the vendor''s provider');
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select throws_ok($$select * from public.get_vendor_earnings_metrics('c1101000-0000-4000-8000-00000000000a')$$, '42501', null, 'an operator is refused the legacy metrics');
reset role;
set local role anon;
select throws_ok($$select * from public.get_vendor_earnings_metrics('c1101000-0000-4000-8000-00000000000a')$$, '42501', null, 'anonymous callers are refused the legacy metrics');
reset role;

-- (3) Contractor reads of the deployed client (85bb7c6) keep working.
select pg_temp.as_user(1);
set local role authenticated;
select lives_ok($$select id, name, tagline, bio, location, website, video_url, logo_url, services, badges, years_experience, our_promise, verified_specialty, is_active, marketing_enabled
  from public.contractors where id = 'c1101000-0000-4000-8000-00000000000a'$$, 'operator vendor detail select (admin/vendors/[id])');
select lives_ok($$select id, name, logo_url, bio, location, badges, services, years_experience, is_active, created_at, user_id, marketing_enabled, our_promise, verified_specialty
  from public.contractors$$, 'operator vendor list select (admin/vendors)');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select lives_ok($$select id, name, logo_url, is_active, marketing_enabled, bio, location, services, our_promise, years_experience, verified_specialty
  from public.contractors where user_id = auth.uid()$$, 'vendor profile select');
select lives_ok($$update public.contractors set bio = 'Synthetic bio, edited' where user_id = auth.uid()$$, 'vendor profile save still works');
reset role;
set local role anon;
select lives_ok($$select * from public.r0_public_providers('c1101000-0000-4000-8000-00000000000a')$$, 'public listing still works');
reset role;

select * from finish();
rollback;
