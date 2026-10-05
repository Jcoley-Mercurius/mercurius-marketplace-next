begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-070 synthetic fixtures only. Covers binding the account that accepted a
-- provider invitation to the provider under review, and that activation then grants
-- it the vendor role through the unchanged TRACE-068 path. No real provider, account,
-- mailbox or Auth dispatch is represented here.
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('f1000000-0000-4000-8000-000000000001','bind-operator@example.invalid',now(),null),
 ('f1000000-0000-4000-8000-000000000002','bind-recipient@example.invalid',now(),now()),
 ('f1000000-0000-4000-8000-000000000003','bind-second@example.invalid',now(),now()),
 ('f1000000-0000-4000-8000-000000000004','bind-legacy@example.invalid',now(),now()),
 ('f1000000-0000-4000-8000-000000000005','bind-revised@example.invalid',now(),now()),
 ('f1000000-0000-4000-8000-000000000006','bind-unrelated@example.invalid',now(),null);
insert into public.user_roles(user_id,role) values('f1000000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('f2000000-0000-4000-8000-000000000001','Synthetic invited provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000002','Synthetic second invited provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000003','Synthetic legacy-accepted provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000004','Synthetic revised provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('f3000000-0000-4000-8000-000000000001','Synthetic invited provider','Test','Recipient','bind-recipient@example.invalid','synthetic','f2000000-0000-4000-8000-000000000001'),
 ('f3000000-0000-4000-8000-000000000002','Synthetic second invited provider','Test','Second','bind-second@example.invalid','synthetic','f2000000-0000-4000-8000-000000000002'),
 ('f3000000-0000-4000-8000-000000000003','Synthetic legacy-accepted provider','Test','Legacy','bind-legacy@example.invalid','synthetic','f2000000-0000-4000-8000-000000000003'),
 ('f3000000-0000-4000-8000-000000000004','Synthetic revised provider','Test','Revised','bind-revised@example.invalid','synthetic','f2000000-0000-4000-8000-000000000004');

create function pg_temp.version(p_application uuid) returns uuid language sql as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
create function pg_temp.revision(p_contractor uuid) returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id=p_contractor $$;
create function pg_temp.roles(p_user uuid) returns text language sql as $$
 select coalesce(string_agg(role::text,',' order by role),'') from public.user_roles where user_id=p_user $$;
create function pg_temp.overview(p_contractor uuid) returns jsonb language sql as $$
 select public.vendor_account_link_overview(p_contractor) $$;
create function pg_temp.operator() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true) $$;
create function pg_temp.checklist(p_contractor uuid) returns void language plpgsql as $$
declare requirement text; previous uuid;
begin
 foreach requirement in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
   select e.id into previous from public.vendor_compliance_evidence e where e.contractor_id=p_contractor and e.kind=requirement
     and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
   perform public.vendor_record_evidence(p_contractor,requirement,'synthetic-rule','private-synthetic-'||requirement||'-'||gen_random_uuid(),
     now()-interval '1 hour',now()+interval '1 year',previous);
 end loop;
end $$;
-- Prepare, reserve, record the Auth receipt and accept as the recipient: the full
-- TRACE-063 path, so every receipt below is one the real commands wrote.
create function pg_temp.accepted(p_contractor uuid,p_key text,p_recipient uuid) returns uuid language plpgsql as $$
declare attempt uuid;
begin
 perform pg_temp.operator();
 attempt:=public.vendor_prepare_invitation(p_contractor,p_key,now()+interval '1 day');
 perform public.vendor_claim_invitation(attempt);
 update auth.users set invited_at=clock_timestamp() where id=p_recipient;
 perform public.vendor_finish_invitation(attempt,p_recipient);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',p_recipient)::text,true);
 perform public.vendor_accept_invitation(attempt);
 perform pg_temp.operator();
 return attempt;
end $$;

select pg_temp.operator();
do $$ declare n integer; begin
 for n in 1..4 loop
   perform public.vendor_begin_review(('f2000000-0000-4000-8000-00000000000'||n)::uuid,
     pg_temp.version(('f3000000-0000-4000-8000-00000000000'||n)::uuid));
 end loop;
end $$;
create temp table bind_fixture(key text primary key,id uuid);
insert into bind_fixture values
 ('first',pg_temp.accepted('f2000000-0000-4000-8000-000000000001','bind-invite-1','f1000000-0000-4000-8000-000000000002')),
 ('second',pg_temp.accepted('f2000000-0000-4000-8000-000000000002','bind-invite-2','f1000000-0000-4000-8000-000000000003'));
grant select on bind_fixture to authenticated,service_role;
select is(pg_temp.revision('f2000000-0000-4000-8000-000000000001'),1,'Acceptance leaves the onboarding revision unchanged');
select ok((select user_id is null from public.contractors where id='f2000000-0000-4000-8000-000000000001'),
 'Acceptance alone binds no account');

-- Permissions.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000006"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Operator reviewed acceptance','bind-1')$$,
 '42501','Onboarding operator required','A signed-in non-operator cannot bind an account');
select throws_ok($$select public.vendor_account_link_overview('f2000000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','A signed-in non-operator cannot read the receipt facts');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Self binding','bind-self')$$,
 '42501','Onboarding operator required','The recipient cannot bind itself to the provider');
reset role;
set local role anon;
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 'f1000000-0000-4000-8000-000000000009','Anonymous','bind-anon')$$,'42501',null,'Anonymous callers cannot execute binding');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 'f1000000-0000-4000-8000-000000000009','Service','bind-service')$$,'42501',null,'The service role cannot execute binding');
reset role;
select is((select count(*) from information_schema.routine_privileges where routine_schema='private'
  and routine_name='vendor_invitation_bind_replay' and grantee in ('anon','authenticated','service_role','PUBLIC')),0::bigint,
 'The binding replay helper is not executable by clients');
select pg_temp.operator();

-- Refusals, each writing nothing.
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'  ','bind-blank')$$,'P0001','Reason and idempotency key required','A reason is required');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 null,'Operator reviewed acceptance','bind-null')$$,'P0001','Accepted invitation required','An attempt is required');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',0,
 (select id from bind_fixture where key='first'),'Operator reviewed acceptance','bind-stale')$$,'P0001','Stale onboarding revision','A stale revision is refused');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000009',1,
 (select id from bind_fixture where key='first'),'Operator reviewed acceptance','bind-missing')$$,'P0001','Onboarding review required','A provider with no onboarding is refused');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='second'),'Operator reviewed acceptance','bind-cross')$$,
 'P0001','Accepted invitation required','Another provider''s receipt cannot be bound');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 'f1000000-0000-4000-8000-000000000009','Operator reviewed acceptance','bind-unknown')$$,
 'P0001','Accepted invitation required','An unknown attempt is refused');
update auth.users set email_confirmed_at=null where id='f1000000-0000-4000-8000-000000000002';
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Operator reviewed acceptance','bind-unconfirmed')$$,
 'P0001','Confirmed account required','An account no longer confirmed is refused');
update auth.users set email_confirmed_at=now(),email='bind-changed@example.invalid' where id='f1000000-0000-4000-8000-000000000002';
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Operator reviewed acceptance','bind-changed')$$,
 'P0001','Account identity does not match the reviewed application recipient','An account whose address changed is refused');
update auth.users set email='bind-recipient@example.invalid' where id='f1000000-0000-4000-8000-000000000002';
select is((select count(*) from public.vendor_account_link_decisions where contractor_id='f2000000-0000-4000-8000-000000000001'),0::bigint,
 'Refused bindings record no decision');
select is(pg_temp.revision('f2000000-0000-4000-8000-000000000001'),1,'Refused bindings change no revision');

-- The readback reports the receipt before binding.
select is(pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'accepted_invitation'->>'auth_user_id',
 'f1000000-0000-4000-8000-000000000002','The panel reports the accepting account');
select is((pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'accepted_invitation'->>'for_current_version')::boolean,true,
 'The panel reports the receipt answers the current application version');
select is((pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'accepted_invitation'->>'bound')::boolean,false,
 'The panel reports the receipt as not yet bound');
select ok(pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'link_source'='null'::jsonb,
 'There is no link source before binding');

-- The reviewed binding.
select is(public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Recipient accepted the reviewed invitation','bind-1')->>'recorded','true',
 'The accepted recipient is bound');
select is((select user_id from public.contractors where id='f2000000-0000-4000-8000-000000000001'),
 'f1000000-0000-4000-8000-000000000002'::uuid,'The provider is bound to the receipt''s account');
select is((select action||':'||auth_user_id||':'||invitation_attempt_id||':'||onboarding_revision from public.vendor_account_link_decisions
  where business_key='bind-1'),
 'link:f1000000-0000-4000-8000-000000000002:'||(select id from bind_fixture where key='first')||':2',
 'The decision names the account, the receipt and the new revision');
select is((select action||':'||business_key from public.vendor_onboarding_events
  where contractor_id='f2000000-0000-4000-8000-000000000001' and revision=2),'invited_account_bound:invitation-bind:bind-1',
 'One onboarding event records the binding');
select is(pg_temp.overview('f2000000-0000-4000-8000-000000000001')->>'link_source','accepted_invitation',
 'The panel reports the binding came from an accepted invitation');
select is((pg_temp.overview('f2000000-0000-4000-8000-000000000001')->>'link_reviewed')::boolean,true,
 'An invitation binding is a reviewed link');
select is((pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'accepted_invitation'->>'bound')::boolean,true,
 'The panel reports the receipt as bound');
select is((public.vendor_onboarding_checklist('f2000000-0000-4000-8000-000000000001')->>'account_reviewed')::boolean,true,
 'The activation checklist reports the reviewed account');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000002'),'homeowner','Binding grants no vendor role');
select is((select status from public.vendor_onboarding where contractor_id='f2000000-0000-4000-8000-000000000001'),'review',
 'Binding activates nothing');

-- Replay and key conflicts.
select is(public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'Recipient accepted the reviewed invitation','bind-1')->>'recorded','false',
 'An exact replay returns the original decision');
select is((select count(*) from public.vendor_account_link_decisions where contractor_id='f2000000-0000-4000-8000-000000000001'),1::bigint,
 'A replay records nothing further');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',1,
 (select id from bind_fixture where key='first'),'A different reason','bind-1')$$,
 'P0001','Account linking idempotency conflict','A reused key with a different reason conflicts');
select throws_ok($$select public.vendor_link_existing_account('f2000000-0000-4000-8000-000000000001',1,
 'f1000000-0000-4000-8000-000000000002','Recipient accepted the reviewed invitation','bind-1')$$,
 'P0001','Account linking idempotency conflict','A binding key is not a replay of a link by stated identity');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',2,
 (select id from bind_fixture where key='first'),'Recipient accepted the reviewed invitation','bind-1b')$$,
 'P0001','Account already bound to this provider','Binding the same receipt twice is refused');

-- Activation grants the role through the unchanged TRACE-068 path.
select pg_temp.checklist('f2000000-0000-4000-8000-000000000001');
select is(public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000001',2,'activate','Synthetic checks reviewed','bind-activate-1'),3,
 'The invited provider activates');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000002'),'homeowner,vendor','Activation grants the vendor role to the invited account');
select is((select outcome||':'||link_decision_key from public.vendor_role_decisions where business_key='role-grant:bind-activate-1'),
 'granted:bind-1','The grant names the invitation binding decision');

-- Release withdraws it and records a plain release.
select public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000001',3,'suspend','Synthetic suspension','bind-suspend-1');
select public.vendor_release_linked_account('f2000000-0000-4000-8000-000000000001',4,'Synthetic correction','bind-release-1');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000002'),'homeowner','Release withdraws the activation-granted role');
select ok((select invitation_attempt_id is null from public.vendor_account_link_decisions where business_key='bind-release-1'),
 'A release names no receipt');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',5,
 (select id from bind_fixture where key='first'),'Rebinding after release','bind-release-1')$$,
 'P0001','Account linking idempotency conflict','A release key is not a replay of a binding');
select ok(pg_temp.overview('f2000000-0000-4000-8000-000000000001')->'link_source'='null'::jsonb,
 'A released provider reports no link source');
-- DEC-2026-028: the suspended provider can be bound again, and reactivation grants
-- the role through the same path.
select is(public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000001',5,
 (select id from bind_fixture where key='first'),'Rebinding after release','bind-2')->>'recorded','true',
 'A suspended provider can be bound');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000002'),'homeowner','Binding while suspended grants no role');
select is(public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000001',6,'activate','Synthetic reactivation','bind-activate-2'),7,
 'The rebound provider reactivates');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000002'),'homeowner,vendor','Reactivation grants the vendor role again');

-- The account belongs to one provider.
update auth.users set email='bind-second-moved@example.invalid' where id='f1000000-0000-4000-8000-000000000003';
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000002',1,
 (select id from bind_fixture where key='second'),'Operator reviewed acceptance','bind-second-moved')$$,
 'P0001','Account identity does not match the reviewed application recipient','A moved account address blocks binding');
update auth.users set email='bind-second@example.invalid' where id='f1000000-0000-4000-8000-000000000003';
update public.contractors set user_id='f1000000-0000-4000-8000-000000000003' where id='f2000000-0000-4000-8000-000000000004';
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000002',1,
 (select id from bind_fixture where key='second'),'Operator reviewed acceptance','bind-second-taken')$$,
 'P0001','Account already linked to another provider','An account linked elsewhere cannot be bound');
update public.contractors set user_id=null where id='f2000000-0000-4000-8000-000000000004';

-- After acceptance the recipient holds an account, so a new invitation is refused
-- before any attempt is recorded: Auth would refuse it and leave an unclosable attempt.
select throws_ok($$select public.vendor_prepare_invitation('f2000000-0000-4000-8000-000000000002','bind-invite-2b',now()+interval '1 day')$$,
 'P0001','Recipient already holds an account; link it by account ID','A new invitation to an accepted recipient is refused');
select is((select count(*) from public.vendor_invitation_attempts where business_key='bind-invite-2b'),0::bigint,
 'The refused preparation records no attempt');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000002')->>'recipient_account_id',
 'f1000000-0000-4000-8000-000000000003','The invitation panel reports the recipient''s existing account');
-- An attempt recorded before this guard existed is refused at dispatch instead.
insert into public.vendor_invitation_attempts(contractor_id,application_version_id,business_key,expires_at,created_by)
 select contractor_id,application_version_id,'bind-invite-2b',now()+interval '1 day','f1000000-0000-4000-8000-000000000001'
 from public.vendor_onboarding where contractor_id='f2000000-0000-4000-8000-000000000002';
select throws_ok($$select public.vendor_claim_invitation((select id from public.vendor_invitation_attempts where business_key='bind-invite-2b'))$$,
 'P0001','Recipient already holds an account; link it by account ID','A pre-existing attempt to an accepted recipient is not dispatched');
select is((select count(*) from public.vendor_invitation_dispatches d join public.vendor_invitation_attempts a on a.id=d.attempt_id
  where a.business_key='bind-invite-2b'),0::bigint,'The refused dispatch reserves nothing');
-- A newer live attempt blocks binding until it is closed.
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000002',1,
 (select id from bind_fixture where key='second'),'Operator reviewed acceptance','bind-second-live')$$,
 'P0001','Close the live invitation before binding an account','A live attempt blocks binding');
update public.vendor_invitation_attempts set status='revoked' where business_key='bind-invite-2b';
select is(public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000002',1,
 (select id from bind_fixture where key='second'),'Operator reviewed acceptance','bind-second')->>'recorded','true',
 'Binding proceeds once no attempt is live');
select is((select count(*) from public.vendor_account_link_decisions where contractor_id='f2000000-0000-4000-8000-000000000002'),1::bigint,
 'The second provider has one binding decision');

-- A legacy 'accepted' status with no receipt is not evidence.
insert into bind_fixture values('legacy',public.vendor_prepare_invitation('f2000000-0000-4000-8000-000000000003','bind-legacy',now()+interval '1 day'));
select public.vendor_record_invitation((select id from bind_fixture where key='legacy'),'submitted','synthetic-legacy-ref','Synthetic legacy');
select public.vendor_record_invitation((select id from bind_fixture where key='legacy'),'delivered','synthetic-legacy-ref','Synthetic legacy');
select public.vendor_record_invitation((select id from bind_fixture where key='legacy'),'accepted','synthetic-legacy-ref','Synthetic legacy');
select is((select status from public.vendor_invitation_attempts where id=(select id from bind_fixture where key='legacy')),'accepted',
 'A legacy assertion can mark an undispatched attempt accepted');
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000003',1,
 (select id from bind_fixture where key='legacy'),'Legacy acceptance','bind-legacy')$$,
 'P0001','Accepted invitation required','A legacy accepted status without a receipt cannot be bound');
select ok(pg_temp.overview('f2000000-0000-4000-8000-000000000003')->'accepted_invitation'='null'::jsonb,
 'The panel reports no receipt for a legacy acceptance');

-- A receipt for a superseded application version cannot be bound.
insert into bind_fixture values('revised',pg_temp.accepted('f2000000-0000-4000-8000-000000000004','bind-invite-4','f1000000-0000-4000-8000-000000000005'));
update public.vendor_applications set business_name='Synthetic revised provider v2' where id='f3000000-0000-4000-8000-000000000004';
select throws_ok($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000004',1,
 (select id from bind_fixture where key='revised'),'Operator reviewed acceptance','bind-revised-stale')$$,
 'P0001','Current application version required','A newer revision refuses binding before onboarding is rebound');
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000004',pg_temp.version('f3000000-0000-4000-8000-000000000004'));
select is((pg_temp.overview('f2000000-0000-4000-8000-000000000004')->'accepted_invitation'->>'for_current_version')::boolean,false,
 'The panel reports the receipt answers a superseded version');
select throws_ok(format($$select public.vendor_bind_invited_account('f2000000-0000-4000-8000-000000000004',%s,
 (select id from bind_fixture where key='revised'),'Operator reviewed acceptance','bind-revised')$$,pg_temp.revision('f2000000-0000-4000-8000-000000000004')),
 'P0001','Accepted invitation is for a superseded application version','A receipt for a superseded version cannot be bound');
-- Recovery for a superseded receipt: a new invitation is refused (the account exists),
-- and linking that account by ID binds it, after which activation grants the role.
select throws_ok($$select public.vendor_prepare_invitation('f2000000-0000-4000-8000-000000000004','bind-invite-4b',now()+interval '1 day')$$,
 'P0001','Recipient already holds an account; link it by account ID','A superseded receipt''s recipient is not re-invited');
select is(public.vendor_link_existing_account('f2000000-0000-4000-8000-000000000004',pg_temp.revision('f2000000-0000-4000-8000-000000000004'),
 'f1000000-0000-4000-8000-000000000005','Recipient accepted an earlier revision; linked by account ID','bind-revised-link')->>'recorded','true',
 'The recipient of a superseded receipt is linked by account ID');
select is(pg_temp.overview('f2000000-0000-4000-8000-000000000004')->>'link_source','stated_identity',
 'The recovery binding is reported as a stated-identity link');
select pg_temp.checklist('f2000000-0000-4000-8000-000000000004');
select public.vendor_decide_onboarding('f2000000-0000-4000-8000-000000000004',pg_temp.revision('f2000000-0000-4000-8000-000000000004'),
 'activate','Revised application reviewed','bind-revised-activate');
select is(pg_temp.roles('f1000000-0000-4000-8000-000000000005'),'homeowner,vendor','The recovered provider receives the vendor role at activation');

-- The readback writes nothing.
create function pg_temp.fingerprint() returns text language sql volatile as $$
 select md5(string_agg(t,'|' order by t)) from (
   select row(c.id,c.user_id,c.updated_at)::text as t from public.contractors c where c.id::text like 'f2000000-%'
   union all select row(d.*)::text from public.vendor_account_link_decisions d where d.contractor_id::text like 'f2000000-%'
   union all select row(e.id)::text from public.vendor_onboarding_events e where e.contractor_id::text like 'f2000000-%'
   union all select row(r.*)::text from public.user_roles r where r.user_id::text like 'f1000000-%'
   union all select row(o.*)::text from public.vendor_onboarding o where o.contractor_id::text like 'f2000000-%') x $$;
create temp table bind_fingerprint as select pg_temp.fingerprint() as before;
select count(pg_temp.overview(id)) from public.contractors where id::text like 'f2000000-%';
select is(pg_temp.fingerprint(),(select before from bind_fingerprint),'Reading the overview for every provider writes nothing');

-- Nothing here activates a listing, and the evidence is append-only.
select is((select count(*) from public.contractors where id::text like 'f2000000-%' and (is_active or marketing_enabled)),0::bigint,
 'Binding neither activates nor lists a contractor record');
select throws_ok($$update public.vendor_account_link_decisions set invitation_attempt_id=null where business_key='bind-1'$$,'55000',null,
 'A binding decision cannot be rewritten');
select throws_ok($$insert into public.vendor_account_link_decisions(business_key,contractor_id,application_version_id,action,auth_user_id,
  recipient_email,onboarding_revision,actor,reason,invitation_attempt_id)
  select 'bind-bad-release',contractor_id,application_version_id,'release',auth_user_id,recipient_email,99,actor,reason,invitation_attempt_id
  from public.vendor_account_link_decisions where business_key='bind-1'$$,'23514',null,'A release cannot name a receipt');

select * from finish();
rollback;
