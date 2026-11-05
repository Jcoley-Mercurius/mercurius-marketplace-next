-- TRACE-142 (CS-7, 20261111001000). Synthetic fixtures only.
-- (1) W-4, DEC-2026-056 item 3: no client role reads payouts_paused, payouts_paused_reason or
--     payouts_paused_at, by name, by a broad or whole-row select, or through a predicate.
-- (2) Every other signed-in and anonymous column is unchanged, and client writes stay refused.
-- (3) The deployed client's contractor reads and vendor_own_earnings still work.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('c7100000-0000-4000-8000-000000000001','cs7-operator@example.invalid',now()),
 ('c7100000-0000-4000-8000-000000000002','cs7-vendor@example.invalid',now()),
 ('c7100000-0000-4000-8000-000000000003','cs7-homeowner@example.invalid',now());
delete from public.user_roles where user_id = 'c7100000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values
 ('c7100000-0000-4000-8000-000000000001','admin'),
 ('c7100000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services,location,bio,payouts_paused,payouts_paused_reason,payouts_paused_at) values
 ('c7101000-0000-4000-8000-00000000000a','Synthetic CS-7 vendor',true,true,'c7100000-0000-4000-8000-000000000002','{}','Fort Myers','Synthetic bio',true,'Synthetic internal hold reason',now());

create function pg_temp.as_user(p_n integer) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c7100000-0000-4000-8000-00000000000'||p_n||'"}',true) $$;

-- (1) Privileges as stored.
select is((select count(*)::int from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'contractors'
    and column_name in ('payouts_paused','payouts_paused_reason','payouts_paused_at') and privilege_type = 'SELECT'
    and grantee not in ('postgres','service_role')), 0, 'only the owner and service role hold SELECT on the payout-hold columns');
select is(has_table_privilege('authenticated','public.contractors','SELECT'), false, 'no table-level SELECT overrides the column revoke (signed in)');
select is(has_table_privilege('anon','public.contractors','SELECT'), false, 'no table-level SELECT overrides the column revoke (anonymous)');

-- (2) Every other column is unchanged from the 20260903160000 projection, less special_offer (CS-1).
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
  where attrelid = 'public.contractors'::regclass and attnum > 0 and not attisdropped
    and has_column_privilege('authenticated','public.contractors',attname,'SELECT')),
  'id,name,logo_url,bio,location,rating,badges,services,years_experience,jobs_completed,is_active,created_at,updated_at,user_id,marketing_enabled,our_promise,verified_specialty,video_url,website,tagline',
  'signed-in readable columns are the CS-1 set without the payout-hold columns');
select is((select string_agg(attname, ',' order by attnum) from pg_attribute
  where attrelid = 'public.contractors'::regclass and attnum > 0 and not attisdropped
    and has_column_privilege('anon','public.contractors',attname,'SELECT')),
  'id,name,logo_url,bio,location,rating,badges,services,years_experience,jobs_completed,is_active,created_at,updated_at,user_id,marketing_enabled,our_promise,verified_specialty,video_url,website,tagline',
  'anonymous readable columns match the signed-in set');

-- (1) Every client role and query shape is refused.
create function pg_temp.refused(p_label text) returns setof text language plpgsql as $f$
begin
  return next throws_ok($q$select payouts_paused_reason from public.contractors$q$, '42501', null, p_label || ': hold reason refused');
  return next throws_ok($q$select payouts_paused from public.contractors$q$, '42501', null, p_label || ': hold flag refused');
  return next throws_ok($q$select payouts_paused_at from public.contractors$q$, '42501', null, p_label || ': hold time refused');
  return next throws_ok($q$select * from public.contractors$q$, '42501', null, p_label || ': broad select refused');
  return next throws_ok($q$select to_jsonb(c) from public.contractors c$q$, '42501', null, p_label || ': whole-row reference refused');
  return next throws_ok($q$select id from public.contractors where payouts_paused$q$, '42501', null, p_label || ': predicate on the flag refused');
  return next throws_ok($q$select id from public.contractors where payouts_paused_reason is not null$q$, '42501', null, p_label || ': predicate on the reason refused');
  return next lives_ok($q$select id, name, bio, our_promise, verified_specialty, is_active, user_id from public.contractors$q$, p_label || ': other columns still readable');
end $f$;
grant execute on function pg_temp.refused(text) to anon, authenticated;

set local role anon;
select * from pg_temp.refused('anonymous');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select * from pg_temp.refused('homeowner');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select * from pg_temp.refused('owning vendor');
-- (2) Client writes stay refused by the 6.13 scope trigger.
select throws_ok($q$update public.contractors set payouts_paused = false where id = 'c7101000-0000-4000-8000-00000000000a'$q$, '42501', null, 'owning vendor: clearing the hold refused');
-- (3) The vendor's canonical earnings read still works.
select lives_ok($q$select public.vendor_own_earnings()$q$, 'owning vendor: vendor_own_earnings still callable');
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select * from pg_temp.refused('operator');
select throws_ok($q$update public.contractors set payouts_paused_reason = 'probe' where id = 'c7101000-0000-4000-8000-00000000000a'$q$, '42501', null, 'operator: direct hold-reason write refused');
reset role;

-- Stored values are kept.
select is((select payouts_paused_reason from public.contractors where id = 'c7101000-0000-4000-8000-00000000000a'), 'Synthetic internal hold reason', 'the stored hold reason is unchanged');

select * from finish();
rollback;
