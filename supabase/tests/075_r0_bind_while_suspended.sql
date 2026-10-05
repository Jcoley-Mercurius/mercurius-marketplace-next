begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-105 / DEC-2026-028 synthetic fixtures only. An invitation-onboarded provider
-- activated before its accepted account was bound: activation recorded 'no_account'.
-- Binding is refused while it is live, allowed once it is suspended, and reactivation
-- then grants the vendor role through the unchanged TRACE-068 path. No real provider,
-- account, mailbox or Auth dispatch is represented here.
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('f5000000-0000-4000-8000-000000000001','suspend-bind-operator@example.invalid',now(),null),
 ('f5000000-0000-4000-8000-000000000002','suspend-bind-recipient@example.invalid',now(),now());
insert into public.user_roles(user_id,role) values('f5000000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('f6000000-0000-4000-8000-000000000001','Synthetic unbound active provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('f7000000-0000-4000-8000-000000000001','Synthetic unbound active provider','Test','Recipient',
  'suspend-bind-recipient@example.invalid','synthetic','f6000000-0000-4000-8000-000000000001');

create function pg_temp.revision() returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id='f6000000-0000-4000-8000-000000000001' $$;
create function pg_temp.roles() returns text language sql as $$
 select coalesce(string_agg(role::text,',' order by role),'') from public.user_roles
 where user_id='f5000000-0000-4000-8000-000000000002' $$;
create function pg_temp.overview() returns jsonb language sql as $$
 select public.vendor_account_link_overview('f6000000-0000-4000-8000-000000000001') $$;
create function pg_temp.operator() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"f5000000-0000-4000-8000-000000000001"}',true) $$;

select pg_temp.operator();
select public.vendor_begin_review('f6000000-0000-4000-8000-000000000001',
 (select id from public.vendor_application_versions where application_id='f7000000-0000-4000-8000-000000000001'
  order by revision desc limit 1));

-- The recipient accepts through the real TRACE-063 commands.
create temp table fixture(id uuid);
do $$ declare attempt uuid; begin
 attempt:=public.vendor_prepare_invitation('f6000000-0000-4000-8000-000000000001','suspend-bind-invite',now()+interval '1 day');
 perform public.vendor_claim_invitation(attempt);
 update auth.users set invited_at=clock_timestamp() where id='f5000000-0000-4000-8000-000000000002';
 perform public.vendor_finish_invitation(attempt,'f5000000-0000-4000-8000-000000000002');
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"f5000000-0000-4000-8000-000000000002"}',true);
 perform public.vendor_accept_invitation(attempt);
 perform pg_temp.operator();
 insert into fixture values(attempt);
end $$;
grant select on fixture to authenticated,service_role;

-- Every checklist item is recorded, then the provider is activated with nothing bound.
do $$ declare requirement text; begin
 foreach requirement in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
   perform public.vendor_record_evidence('f6000000-0000-4000-8000-000000000001',requirement,'synthetic-rule',
     'private-synthetic-'||requirement||'-'||gen_random_uuid(),now()-interval '1 hour',now()+interval '1 year',null);
 end loop;
end $$;
select is(public.vendor_decide_onboarding('f6000000-0000-4000-8000-000000000001',1,'activate','Synthetic checks reviewed','suspend-bind-activate-1'),2,
 'The provider activates with no bound account');
select is((select outcome from public.vendor_role_decisions where business_key='role-grant:suspend-bind-activate-1'),'no_account',
 'Activation records that no account was bound');
select is(pg_temp.roles(),'homeowner','The accepted account holds no vendor role');

-- Live: both binding commands refuse and write nothing.
select throws_ok($$select public.vendor_bind_invited_account('f6000000-0000-4000-8000-000000000001',2,
 (select id from fixture),'Bind the accepted account','suspend-bind-live')$$,
 'P0001','Suspend the provider before binding an account','An active provider is not bound from its receipt');
select throws_ok($$select public.vendor_link_existing_account('f6000000-0000-4000-8000-000000000001',2,
 'f5000000-0000-4000-8000-000000000002','Link the accepted account','suspend-link-live')$$,
 'P0001','Suspend the provider before binding an account','An active provider is not linked by account ID');
select is(pg_temp.revision(),2,'The refusals advance no revision');
select ok((select user_id is null from public.contractors where id='f6000000-0000-4000-8000-000000000001'),
 'The refusals bind no account');

-- Suspended: the receipt binds, and the panel facts report it.
select public.vendor_decide_onboarding('f6000000-0000-4000-8000-000000000001',2,'suspend','Synthetic suspension to bind','suspend-bind-suspend-1');
select is(pg_temp.overview()->>'onboarding_status','suspended','The overview reports the suspension');
select is((pg_temp.overview()->'accepted_invitation'->>'for_current_version')::boolean,true,
 'The acceptance still answers the current application version');
select is(public.vendor_bind_invited_account('f6000000-0000-4000-8000-000000000001',3,
 (select id from fixture),'Bind the accepted account','suspend-bind-1')->>'recorded','true',
 'A suspended provider is bound from its receipt');
select is((select after_status from public.vendor_onboarding_events where business_key='invitation-bind:suspend-bind-1'),'suspended',
 'Binding leaves the provider suspended');
select is(pg_temp.overview()->>'link_source','accepted_invitation','The binding is recorded as the accepted invitation');
select is(pg_temp.roles(),'homeowner','Binding grants no role');
select is(public.vendor_is_eligible('f6000000-0000-4000-8000-000000000001'),false,'The bound, suspended provider is not eligible');

-- Reactivation re-checks the checklist and grants the role to the reviewed binding.
select is(public.vendor_decide_onboarding('f6000000-0000-4000-8000-000000000001',4,'activate','Synthetic reactivation','suspend-bind-activate-2'),5,
 'The provider reactivates on its existing evidence');
select is((select outcome||':'||link_decision_key from public.vendor_role_decisions where business_key='role-grant:suspend-bind-activate-2'),
 'granted:suspend-bind-1','Reactivation grants the vendor role through the binding decision');
select is(pg_temp.roles(),'homeowner,vendor','The bound account holds the vendor role');
select is(public.vendor_is_eligible('f6000000-0000-4000-8000-000000000001'),true,'The reactivated provider is eligible');

select * from finish();
rollback;
