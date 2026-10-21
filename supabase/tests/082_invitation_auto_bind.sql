begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-117 / DEC-2026-043 synthetic fixtures only. Covers binding the account that
-- accepted a provider invitation in the acceptance itself, the conditions under which
-- acceptance binds nothing and leaves the operator command as the fallback, and that
-- activation then grants the vendor role through the unchanged TRACE-068 path. No real
-- provider, account, mailbox or Auth dispatch is represented here.
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('f8000000-0000-4000-8000-000000000001','auto-bind-operator@example.invalid',now(),null),
 ('f8000000-0000-4000-8000-000000000002','auto-bind-recipient@example.invalid',now(),now()),
 ('f8000000-0000-4000-8000-000000000003','auto-bind-taken@example.invalid',now(),now());
insert into public.user_roles(user_id,role) values('f8000000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('f9000000-0000-4000-8000-000000000001','Synthetic auto-bound provider',false,false,null),
 ('f9000000-0000-4000-8000-000000000002','Synthetic provider whose recipient is taken',false,false,null),
 ('f9000000-0000-4000-8000-000000000003','Synthetic holder of the taken account',false,false,'f8000000-0000-4000-8000-000000000003');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('fa000000-0000-4000-8000-000000000001','Synthetic auto-bound provider','Test','Recipient','auto-bind-recipient@example.invalid','synthetic','f9000000-0000-4000-8000-000000000001'),
 ('fa000000-0000-4000-8000-000000000002','Synthetic provider whose recipient is taken','Test','Taken','auto-bind-taken@example.invalid','synthetic','f9000000-0000-4000-8000-000000000002');

create function pg_temp.version(p_application uuid) returns uuid language sql as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
create function pg_temp.revision(p_contractor uuid) returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id=p_contractor $$;
create function pg_temp.roles(p_user uuid) returns text language sql as $$
 select coalesce(string_agg(role::text,',' order by role),'') from public.user_roles where user_id=p_user $$;
create function pg_temp.bound(p_contractor uuid) returns uuid language sql as $$
 select user_id from public.contractors where id=p_contractor $$;
create function pg_temp.decisions(p_contractor uuid) returns bigint language sql as $$
 select count(*) from public.vendor_account_link_decisions where contractor_id=p_contractor $$;
create function pg_temp.operator() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8000000-0000-4000-8000-000000000001"}',true) $$;
create function pg_temp.checklist(p_contractor uuid) returns void language plpgsql as $$
declare requirement text;
begin
 foreach requirement in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
   perform public.vendor_record_evidence(p_contractor,requirement,'synthetic-rule','private-synthetic-'||requirement||'-'||gen_random_uuid(),
     now()-interval '1 hour',now()+interval '1 year',null);
 end loop;
end $$;
-- Prepare, reserve and record the Auth receipt as the operator; acceptance is left
-- to the test so it runs as the recipient.
create function pg_temp.dispatched(p_contractor uuid,p_key text,p_recipient uuid) returns uuid language plpgsql as $$
declare attempt uuid;
begin
 perform pg_temp.operator();
 attempt:=public.vendor_prepare_invitation(p_contractor,p_key,now()+interval '1 day');
 perform public.vendor_claim_invitation(attempt);
 update auth.users set invited_at=clock_timestamp() where id=p_recipient;
 perform public.vendor_finish_invitation(attempt,p_recipient);
 return attempt;
end $$;
create function pg_temp.accept(p_attempt uuid,p_recipient uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_recipient)::text,true);
 perform public.vendor_accept_invitation(p_attempt);
 perform pg_temp.operator();
end $$;

select pg_temp.operator();
select public.vendor_begin_review('f9000000-0000-4000-8000-000000000001',pg_temp.version('fa000000-0000-4000-8000-000000000001'));
select public.vendor_begin_review('f9000000-0000-4000-8000-000000000002',pg_temp.version('fa000000-0000-4000-8000-000000000002'));
create temp table fixture(key text primary key,id uuid);
insert into fixture values
 ('first',pg_temp.dispatched('f9000000-0000-4000-8000-000000000001','auto-bind-invite-1','f8000000-0000-4000-8000-000000000002')),
 ('taken',pg_temp.dispatched('f9000000-0000-4000-8000-000000000002','auto-bind-invite-2','f8000000-0000-4000-8000-000000000003'));
grant select on fixture to authenticated,service_role;

-- Acceptance binds the verified recipient.
select is(pg_temp.bound('f9000000-0000-4000-8000-000000000001'),null,'Before acceptance no account is bound');
select pg_temp.accept((select id from fixture where key='first'),'f8000000-0000-4000-8000-000000000002');
select is(pg_temp.bound('f9000000-0000-4000-8000-000000000001'),'f8000000-0000-4000-8000-000000000002'::uuid,
 'Acceptance binds the verified recipient to the provider');
select is(pg_temp.revision('f9000000-0000-4000-8000-000000000001'),2,'Binding advances the onboarding revision once');
select is((select status from public.vendor_invitation_attempts where id=(select id from fixture where key='first')),'accepted',
 'The attempt is recorded as accepted');
select ok(exists(select 1 from public.vendor_account_link_decisions
  where contractor_id='f9000000-0000-4000-8000-000000000001' and action='link'
   and business_key='auto:'||(select id from fixture where key='first')
   and invitation_attempt_id=(select id from fixture where key='first')
   and auth_user_id='f8000000-0000-4000-8000-000000000002' and actor='f8000000-0000-4000-8000-000000000002'
   and recipient_email='auto-bind-recipient@example.invalid' and onboarding_revision=2
   and reason like '%DEC-2026-043%'),
 'A link decision names the acceptance receipt, the recipient as actor and the decision');
select ok(exists(select 1 from public.vendor_onboarding_events
  where contractor_id='f9000000-0000-4000-8000-000000000001' and action='invited_account_bound'
   and revision=2 and before_status='review' and after_status='review'
   and business_key='invitation-bind:auto:'||(select id from fixture where key='first')),
 'An onboarding event records the binding without a status change');
select ok(private.vendor_reviewed_link('f9000000-0000-4000-8000-000000000001') is not null,
 'The reviewed-link predicate accepts the automatic binding');
select is((public.vendor_account_link_overview('f9000000-0000-4000-8000-000000000001')->>'linked')::boolean,true,
 'The operator account panel reports the account as linked');
select is((select status from public.vendor_onboarding where contractor_id='f9000000-0000-4000-8000-000000000001'),'review',
 'The provider stays in review');
select ok((select not is_active from public.contractors where id='f9000000-0000-4000-8000-000000000001'),
 'The provider is not activated');
select is(pg_temp.roles('f8000000-0000-4000-8000-000000000002'),'homeowner','Binding grants no vendor role');

-- A repeated acceptance changes nothing.
select pg_temp.accept((select id from fixture where key='first'),'f8000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions('f9000000-0000-4000-8000-000000000001'),1::bigint,'A repeated acceptance records no second decision');
select is(pg_temp.revision('f9000000-0000-4000-8000-000000000001'),2,'A repeated acceptance leaves the revision unchanged');

-- The operator command reports the binding rather than repeating it.
select throws_ok(format($q$select public.vendor_bind_invited_account('f9000000-0000-4000-8000-000000000001',2,%L,'Synthetic review','auto-bind-manual-1')$q$,
 (select id from fixture where key='first')),'P0001','Account already bound to this provider',
 'The operator command refuses an account already bound automatically');

-- Activation grants the vendor role through the unchanged TRACE-068 path.
select pg_temp.checklist('f9000000-0000-4000-8000-000000000001');
select is(public.vendor_decide_onboarding('f9000000-0000-4000-8000-000000000001',2,'activate','Synthetic checks reviewed','auto-bind-activate-1'),3,
 'The automatically bound provider activates');
select is((select outcome from public.vendor_role_decisions where business_key='role-grant:auto-bind-activate-1'),'granted',
 'Activation grants the vendor role to the bound account');
select is(pg_temp.roles('f8000000-0000-4000-8000-000000000002'),'homeowner,vendor','The bound account holds the vendor role after activation');

-- An account that belongs to another provider is not bound; acceptance still succeeds.
select lives_ok(format($q$select pg_temp.accept(%L,'f8000000-0000-4000-8000-000000000003')$q$,(select id from fixture where key='taken')),
 'Acceptance succeeds when automatic binding does not apply');
select is(pg_temp.bound('f9000000-0000-4000-8000-000000000002'),null,'An account linked to another provider is not bound');
select is(pg_temp.decisions('f9000000-0000-4000-8000-000000000002'),0::bigint,'No link decision is recorded when binding is skipped');
select is(pg_temp.revision('f9000000-0000-4000-8000-000000000002'),1,'A skipped binding leaves the revision unchanged');
select ok(exists(select 1 from public.vendor_invitation_acceptances where attempt_id=(select id from fixture where key='taken')),
 'The acceptance receipt is still recorded');
select throws_ok(format($q$select public.vendor_bind_invited_account('f9000000-0000-4000-8000-000000000002',1,%L,'Synthetic review','auto-bind-manual-2')$q$,
 (select id from fixture where key='taken')),'P0001','Account already linked to another provider',
 'The operator command reports why the binding could not be made');

-- Nobody but the acceptance can call the automatic binding.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f8000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok(format($q$select private.vendor_auto_bind_invited_account(%L,'f8000000-0000-4000-8000-000000000002')$q$,
 (select id from fixture where key='taken')),'42501',null,'A signed-in user cannot call the automatic binding directly');
reset role;

select * from finish();
rollback;
