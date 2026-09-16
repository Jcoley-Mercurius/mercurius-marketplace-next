begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

select is(
  (select count(*)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity),
  0::bigint,
  'every public table has row-level security enabled'
);

select is(
  (select count(*)
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')),
  0::bigint,
  'client roles have no table maintenance privileges'
);

select is(
  (select count(*)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'UPDATE')
       or has_sequence_privilege('authenticated', c.oid, 'UPDATE'))),
  0::bigint,
  'client roles cannot update sequences directly'
);

select ok(
  has_sequence_privilege('authenticated', 'public.support_ticket_seq', 'USAGE'),
  'authenticated may use the support ticket sequence'
);

select ok(
  not has_table_privilege('anon', 'public.internal_worker_tokens', 'SELECT,INSERT,UPDATE,DELETE'),
  'anonymous has no access to worker tokens'
);

select ok(
  not has_table_privilege('authenticated', 'public.internal_worker_tokens', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated has no access to worker tokens'
);

select ok(
  not has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'anonymous has no access to Stripe webhook state'
);

select ok(
  not has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated has no access to Stripe webhook state'
);

select ok(
  not has_column_privilege('anon', 'public.contractors', 'email', 'SELECT')
  and not has_column_privilege('anon', 'public.contractors', 'phone', 'SELECT'),
  'anonymous cannot read contractor contact columns'
);

select ok(
  not has_column_privilege('authenticated', 'public.contractors', 'email', 'SELECT')
  and not has_column_privilege('authenticated', 'public.contractors', 'phone', 'SELECT'),
  'authenticated cannot bypass contact RPCs with direct column reads'
);

select ok(
  has_column_privilege('anon', 'public.contractors', 'name', 'SELECT'),
  'anonymous can read the safe contractor projection'
);

select ok(
  not has_column_privilege('anon', 'public.reviews', 'customer_id', 'SELECT')
  and has_column_privilege('anon', 'public.reviews', 'comment', 'SELECT'),
  'anonymous reviews hide homeowner identity while exposing review content'
);

select ok(
  has_function_privilege('anon', 'public.find_public_eligible_providers(text,text,text)', 'EXECUTE'),
  'anonymous may execute the public provider search RPC'
);

select ok(
  not has_function_privilege('anon', 'public.transition_job_status(uuid,public.request_status,text,jsonb)', 'EXECUTE'),
  'anonymous cannot execute authenticated workflow transitions'
);

select ok(
  has_function_privilege('authenticated', 'public.transition_job_status(uuid,public.request_status,text,jsonb)', 'EXECUTE'),
  'authenticated may execute the guarded workflow transition RPC'
);

select ok(
  not has_function_privilege('authenticated', 'public.update_updated_at_column()', 'EXECUTE'),
  'authenticated cannot execute internal trigger helpers directly'
);

select is(
  (select count(*)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not in (
       'find_public_eligible_providers',
       'get_completed_job_counts',
       'pricing_server_now',
       'resolve_package_tier_price'
     )),
  0::bigint,
  'anonymous can execute only the approved public RPC surface'
);

select is(
  (select count(*)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as permission(name)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relname not like 'money\_%' escape '\'
     and c.relname not in ('vendor_application_versions','vendor_onboarding','vendor_compliance_evidence','vendor_onboarding_events','vendor_invitation_attempts','vendor_invitation_events','vendor_compliance_requirements','vendor_requirement_evidence','vendor_cutover_decisions','vendor_cutover_control','vendor_invitation_dispatches','vendor_invitation_acceptances','vendor_onboarding_review_starts','vendor_account_link_decisions','vendor_role_decisions','vendor_checklist_evidence_requests','vendor_renewal_documents','vendor_renewal_document_decisions')
     and not has_table_privilege('service_role', c.oid, permission.name)),
  0::bigint,
  'service role retains recovered access outside the Phase 5 RPC-only boundary'
);

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p') and (c.relname like 'money\_%' escape '\'
    or c.relname in ('vendor_application_versions','vendor_onboarding','vendor_compliance_evidence','vendor_onboarding_events','vendor_invitation_attempts','vendor_invitation_events','vendor_compliance_requirements','vendor_requirement_evidence','vendor_cutover_decisions','vendor_cutover_control','vendor_invitation_dispatches','vendor_invitation_acceptances','vendor_onboarding_review_starts','vendor_account_link_decisions','vendor_role_decisions','vendor_checklist_evidence_requests','vendor_renewal_documents','vendor_renewal_document_decisions'))
    and has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE')),0::bigint,
  'Phase 5 service writes require invariant-enforcing RPCs');

select * from finish();
rollback;
