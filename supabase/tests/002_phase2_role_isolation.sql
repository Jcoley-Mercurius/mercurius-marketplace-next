begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- Synthetic, transaction-scoped identities. No passwords or customer records.
insert into auth.users (id, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', '{"full_name":"Test Homeowner A","role":"admin"}'),
  ('10000000-0000-4000-8000-000000000002', '{"full_name":"Test Homeowner B"}'),
  ('10000000-0000-4000-8000-000000000003', '{"full_name":"Test Vendor"}'),
  ('10000000-0000-4000-8000-000000000004', '{"full_name":"Test Admin"}');

select ok(
  not public.has_role('10000000-0000-4000-8000-000000000001', 'admin')
  and public.has_role('10000000-0000-4000-8000-000000000001', 'homeowner'),
  'signup metadata cannot self-assign the admin role'
);

insert into public.user_roles (user_id, role) values
  ('10000000-0000-4000-8000-000000000003', 'vendor'),
  ('10000000-0000-4000-8000-000000000004', 'admin');

insert into public.contractors (id, user_id, name, is_active) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'Synthetic Test Vendor', false);

insert into public.service_requests (id, customer_id, contractor_id, service_type, address) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'house-cleaning', 'Synthetic fixture A'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', null, 'house-cleaning', 'Synthetic fixture B');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok('select id from public.profiles', '42501', 'permission denied for table profiles', 'anonymous cannot read private profiles');
select throws_ok('select id from public.service_requests', '42501', 'permission denied for table service_requests', 'anonymous cannot read service requests');
select throws_ok('select email from public.contractors', '42501', 'permission denied for table contractors', 'anonymous cannot read contractor email');
select is((select count(*) from public.contractors where id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'anonymous cannot see an inactive contractor');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001"}', true);
select is((select count(*) from public.profiles where user_id in ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002')), 1::bigint, 'homeowner sees only their own profile');
select is((select count(*) from public.service_requests where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')), 1::bigint, 'homeowner sees only their own request');
with changed as (update public.service_requests set description = 'unauthorized' where id = '30000000-0000-4000-8000-000000000002' returning id)
select is((select count(*) from changed), 0::bigint, 'homeowner cannot update another homeowner request');
-- TRACE-009: trigger helpers must enforce the invoking browser role even though
-- the trigger functions themselves run as SECURITY DEFINER.
select throws_ok(
  $$update public.service_requests set status = 'matched' where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', 'Homeowners are not allowed to modify "status" on a service request',
  'homeowner cannot update protected service request columns'
);
select throws_ok(
  $$insert into public.user_roles (user_id, role) values ('10000000-0000-4000-8000-000000000001', 'admin')$$,
  '42501', 'new row violates row-level security policy for table "user_roles"',
  'homeowner cannot elevate their own role'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000003"}', true);
select is((select count(*) from public.service_requests where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')), 1::bigint, 'vendor sees only their assigned request');
select is((select count(*) from public.profiles where user_id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'vendor cannot directly read the homeowner profile');
with changed as (update public.service_requests set description = 'unauthorized' where id = '30000000-0000-4000-8000-000000000002' returning id)
select is((select count(*) from changed), 0::bigint, 'vendor cannot update an unassigned request');
select throws_ok(
  $$update public.contractors set is_active = true where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', 'Vendors are not allowed to modify "is_active" on a provider profile',
  'vendor cannot update protected provider profile columns'
);
select throws_ok('select token from public.internal_worker_tokens', '42501', 'permission denied for table internal_worker_tokens', 'vendor cannot read worker credentials');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000004"}', true);
select is((select count(*) from public.service_requests where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')), 2::bigint, 'admin can review both homeowner requests');
select throws_ok('select token from public.internal_worker_tokens', '42501', 'permission denied for table internal_worker_tokens', 'admin browser role cannot read worker credentials');
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*) from public.service_requests where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')), 2::bigint, 'trusted service role can process both requests');
select lives_ok('select name from public.internal_worker_tokens', 'trusted service role can access worker state');
reset role;

select * from finish();
rollback;
