begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-071 / DEC-2026-029: the provider invitation email link lasts 24 hours. Both operator
-- queues that flag a lapsed link read the one shared lifetime instead of a hardcoded 3 hours.
-- No fixtures: this checks the lifetime, the queue definitions and the helper's privileges.

select is(private.provider_invitation_link_lifetime(), interval '24 hours',
  'The invitation email link lifetime is 24 hours');

select ok(position('provider_invitation_link_lifetime()' in pg_get_functiondef('public.r0_invitation_attention()'::regprocedure)) > 0,
  'Application invitation attention reads the shared link lifetime');
select ok(position('provider_invitation_link_lifetime()' in pg_get_functiondef('public.r0_provider_access_queue()'::regprocedure)) > 0,
  'Existing-provider access queue reads the shared link lifetime');
select ok(position('3 hours' in pg_get_functiondef('public.r0_invitation_attention()'::regprocedure)) = 0,
  'Application invitation attention no longer hardcodes 3 hours');
select ok(position('3 hours' in pg_get_functiondef('public.r0_provider_access_queue()'::regprocedure)) = 0,
  'Existing-provider access queue no longer hardcodes 3 hours');

select ok(not has_function_privilege(r, 'private.provider_invitation_link_lifetime()', 'execute'),
  format('%s cannot execute the private link lifetime', r))
  from unnest(array['anon', 'authenticated', 'service_role']) r;

select * from finish();
rollback;
