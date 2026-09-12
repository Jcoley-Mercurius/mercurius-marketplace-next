begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-068 synthetic fixtures only. Covers the vendor role granted by reviewed
-- activation, its retention through suspension, and its withdrawal with the
-- reviewed binding. No real provider, account or mailbox is represented here.
insert into auth.users(id,email,email_confirmed_at) values
 ('e1000000-0000-4000-8000-000000000001','role-operator@example.invalid',now()),
 ('e1000000-0000-4000-8000-000000000002','role-recipient@example.invalid',now()),
 ('e1000000-0000-4000-8000-000000000003','role-holder@example.invalid',now()),
 ('e1000000-0000-4000-8000-000000000004','role-inherited@example.invalid',now()),
 ('e1000000-0000-4000-8000-000000000005','role-changed@example.invalid',now()),
 ('e1000000-0000-4000-8000-000000000006','role-incomplete@example.invalid',now());
-- The holder already carries the vendor role from before this path existed.
insert into public.user_roles(user_id,role) values
 ('e1000000-0000-4000-8000-000000000001','admin'),('e1000000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('e2000000-0000-4000-8000-000000000001','Synthetic reviewed-link provider',false,false,null),
 ('e2000000-0000-4000-8000-000000000002','Synthetic account-less provider',false,false,null),
 ('e2000000-0000-4000-8000-000000000003','Synthetic role-holder provider',false,false,null),
 ('e2000000-0000-4000-8000-000000000004','Synthetic inherited-link provider',false,false,'e1000000-0000-4000-8000-000000000004'),
 ('e2000000-0000-4000-8000-000000000005','Synthetic changed-identity provider',false,false,null),
 ('e2000000-0000-4000-8000-000000000006','Synthetic incomplete provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('e3000000-0000-4000-8000-000000000001','Synthetic reviewed-link provider','Test','Recipient','role-recipient@example.invalid','synthetic','e2000000-0000-4000-8000-000000000001'),
 ('e3000000-0000-4000-8000-000000000002','Synthetic account-less provider','Test','Absent','role-absent@example.invalid','synthetic','e2000000-0000-4000-8000-000000000002'),
 ('e3000000-0000-4000-8000-000000000003','Synthetic role-holder provider','Test','Holder','role-holder@example.invalid','synthetic','e2000000-0000-4000-8000-000000000003'),
 ('e3000000-0000-4000-8000-000000000004','Synthetic inherited-link provider','Test','Inherited','role-inherited@example.invalid','synthetic','e2000000-0000-4000-8000-000000000004'),
 ('e3000000-0000-4000-8000-000000000005','Synthetic changed-identity provider','Test','Changed','role-changed@example.invalid','synthetic','e2000000-0000-4000-8000-000000000005'),
 ('e3000000-0000-4000-8000-000000000006','Synthetic incomplete provider','Test','Incomplete','role-incomplete@example.invalid','synthetic','e2000000-0000-4000-8000-000000000006');

create function pg_temp.version(p_application uuid) returns uuid language sql as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
create function pg_temp.revision(p_contractor uuid) returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id=p_contractor $$;
-- Records the full MPS §8 checklist against the provider's bound version, superseding
-- whatever evidence is current for each kind.
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
create function pg_temp.roles(p_user uuid) returns text language sql as $$
 select coalesce(string_agg(role::text,',' order by role),'') from public.user_roles where user_id=p_user $$;
create function pg_temp.overview(p_contractor uuid) returns jsonb language sql as $$
 select public.vendor_account_link_overview(p_contractor) $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
do $$ declare n integer; begin
 for n in 1..6 loop
   perform public.vendor_begin_review(('e2000000-0000-4000-8000-00000000000'||n)::uuid,
     pg_temp.version(('e3000000-0000-4000-8000-00000000000'||n)::uuid));
 end loop;
end $$;

-- The decision log is private and append-only.
set local role authenticated;
select throws_ok($$select * from public.vendor_role_decisions$$,'42501','permission denied for table vendor_role_decisions',
 'Clients cannot read role decisions directly');
reset role;
set local role service_role;
select throws_ok($$select * from public.vendor_role_decisions$$,'42501','permission denied for table vendor_role_decisions',
 'The service role cannot read role decisions directly');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000003',1,'activate','Self service','self')$$,
 '42501','Onboarding operator required','A vendor cannot activate itself into a role');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);

-- Reviewed link, then activation: the one path that grants.
select public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000001',1,
 'e1000000-0000-4000-8000-000000000002','Applicant already holds a Mercurius account','role-link-1');
select pg_temp.checklist('e2000000-0000-4000-8000-000000000001');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000002'),'homeowner','A linked account holds no vendor role before activation');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_held')::boolean,false,
 'The panel reports no vendor role before activation');
select is(public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',2,'activate','All synthetic checks reviewed','role-activate-1'),3,
 'A reviewed-link provider activates');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000002'),'homeowner,vendor','Activation grants the vendor role to the reviewed account');
select is((select outcome||':'||auth_user_id||':'||link_decision_key||':'||onboarding_revision from public.vendor_role_decisions
  where business_key='role-grant:role-activate-1'),
 'granted:e1000000-0000-4000-8000-000000000002:role-link-1:3','The grant names the account, the link decision and the activation revision');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_held')::boolean,true,
 'The panel reports the vendor role as held');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_from_activation')::boolean,true,
 'The panel reports that activation granted it');
select is(jsonb_array_length(pg_temp.overview('e2000000-0000-4000-8000-000000000001')->'role_decisions'),1,
 'The panel reports one role decision');
-- Replay.
select is(public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',2,'activate','All synthetic checks reviewed','role-activate-1'),3,
 'An activation replay returns the original revision');
select is((select count(*) from public.vendor_role_decisions where contractor_id='e2000000-0000-4000-8000-000000000001'),1::bigint,
 'An activation replay records no second role decision');

-- Suspension, renewal and reactivation keep the role and never re-grant it.
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',3,'suspend','Synthetic suspension','role-suspend-1');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000002'),'homeowner,vendor','Suspension keeps the vendor role');
select is(public.vendor_is_eligible('e2000000-0000-4000-8000-000000000001'),false,'A suspended provider is still not eligible');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',4,'renew','Synthetic renewal','role-renew-1');
select is((select count(*) from public.vendor_role_decisions where contractor_id='e2000000-0000-4000-8000-000000000001'),1::bigint,
 'Suspension and renewal record no role decision');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',5,'activate','Reviewed reactivation','role-activate-2');
select is((select outcome from public.vendor_role_decisions where business_key='role-grant:role-activate-2'),'already_held',
 'Reactivation records that the role was already held');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_from_activation')::boolean,true,
 'An already-held reactivation does not erase activation ownership');

-- Releasing the binding withdraws the role activation granted, and nothing else.
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',6,'suspend','Synthetic suspension before release','role-suspend-2');
select public.vendor_release_linked_account('e2000000-0000-4000-8000-000000000001',7,'Applicant asked to use a different account','role-release-1');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000002'),'homeowner','Release withdraws the activation-granted vendor role only');
select is((select outcome||':'||onboarding_revision||':'||link_decision_key from public.vendor_role_decisions
  where business_key='role-revoke:role-release-1'),'revoked:8:role-release-1','The withdrawal is recorded against the release decision');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_held')::boolean,false,
 'A released provider reports no held role');
select is(public.vendor_release_linked_account('e2000000-0000-4000-8000-000000000001',7,'Applicant asked to use a different account','role-release-1')->>'recorded',
 'false','A release replay reports the original decision');
select is((select count(*) from public.vendor_role_decisions where contractor_id='e2000000-0000-4000-8000-000000000001' and action='revoke'),1::bigint,
 'A release replay withdraws nothing further');

-- Recovery: a new application revision, a new link and a new activation grant again.
update public.vendor_applications set business_name='Synthetic reviewed-link provider v2' where id='e3000000-0000-4000-8000-000000000001';
select public.vendor_begin_review('e2000000-0000-4000-8000-000000000001',pg_temp.version('e3000000-0000-4000-8000-000000000001'));
select public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000001',pg_temp.revision('e2000000-0000-4000-8000-000000000001'),
 'e1000000-0000-4000-8000-000000000002','Applicant confirmed the original account','role-link-2');
-- Regression for the TRACE-067 ordering fix: this release and relink share one
-- transaction timestamp, and the release's key sorts after the link's.
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'link_reviewed')::boolean,true,
 'A relink written after a release is the live link even with a tied timestamp');
select pg_temp.checklist('e2000000-0000-4000-8000-000000000001');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',pg_temp.revision('e2000000-0000-4000-8000-000000000001'),
 'activate','Revised application reviewed','role-activate-3');
select is((select outcome||':'||link_decision_key from public.vendor_role_decisions where business_key='role-grant:role-activate-3'),
 'granted:role-link-2','A later activation grants again under the new link');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000002'),'homeowner,vendor','The re-granted role is held');
-- A role removed out of band is reported, not silently assumed withdrawn by release.
delete from public.user_roles where user_id='e1000000-0000-4000-8000-000000000002' and role='vendor';
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000001',pg_temp.revision('e2000000-0000-4000-8000-000000000001'),
 'suspend','Synthetic suspension','role-suspend-3');
select public.vendor_release_linked_account('e2000000-0000-4000-8000-000000000001',pg_temp.revision('e2000000-0000-4000-8000-000000000001'),
 'Synthetic release after out-of-band removal','role-release-2');
select is((select outcome from public.vendor_role_decisions where business_key='role-revoke:role-release-2'),'already_absent',
 'A release records that the owned role was already absent');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000001')->>'vendor_role_from_activation')::boolean,false,
 'Nothing is reported as activation-owned after the release');

-- No account: activation proceeds, grants nothing, and says so.
select pg_temp.checklist('e2000000-0000-4000-8000-000000000002');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000002',1,'activate','Synthetic review without an account','role-activate-absent');
select is((select status from public.vendor_onboarding where contractor_id='e2000000-0000-4000-8000-000000000002'),'active',
 'A provider with no bound account still activates');
select is((select outcome||':'||coalesce(auth_user_id::text,'-')||':'||coalesce(link_decision_key,'-') from public.vendor_role_decisions
  where business_key='role-grant:role-activate-absent'),'no_account:-:-','The absent account is recorded as the reason nothing was granted');
select is((select count(*) from public.user_roles r join auth.users u on u.id=r.user_id
  where u.email='role-absent@example.invalid'),0::bigint,'No role is granted by recipient address');

-- Inherited link: activation proceeds without promoting the unreviewed account.
select pg_temp.checklist('e2000000-0000-4000-8000-000000000004');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000004',1,'activate','Synthetic review of an inherited link','role-activate-inherited');
select is((select outcome||':'||auth_user_id from public.vendor_role_decisions where business_key='role-grant:role-activate-inherited'),
 'inherited_link:e1000000-0000-4000-8000-000000000004','An inherited link is recorded and not granted');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000004'),'homeowner','An inherited account gains no vendor role');

-- A role held before activation is recorded as held and never withdrawn by release.
select public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000003',1,
 'e1000000-0000-4000-8000-000000000003','Applicant already holds a Mercurius account','role-link-holder');
select pg_temp.checklist('e2000000-0000-4000-8000-000000000003');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000003',2,'activate','Synthetic review','role-activate-holder');
select is((select outcome from public.vendor_role_decisions where business_key='role-grant:role-activate-holder'),'already_held',
 'A pre-existing vendor role is recorded as already held');
select is((pg_temp.overview('e2000000-0000-4000-8000-000000000003')->>'vendor_role_from_activation')::boolean,false,
 'A pre-existing role is not reported as activation-granted');
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000003',3,'suspend','Synthetic suspension','role-suspend-holder');
select public.vendor_release_linked_account('e2000000-0000-4000-8000-000000000003',4,'Synthetic release','role-release-holder');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000003'),'homeowner,vendor','Release keeps a role activation did not grant');
select is((select count(*) from public.vendor_role_decisions where contractor_id='e2000000-0000-4000-8000-000000000003' and action='revoke'),0::bigint,
 'Release records no withdrawal for a role it does not own');

-- A bound identity that no longer matches the reviewed recipient fails closed.
select public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000005',1,
 'e1000000-0000-4000-8000-000000000005','Applicant already holds a Mercurius account','role-link-changed');
select pg_temp.checklist('e2000000-0000-4000-8000-000000000005');
update auth.users set email='role-someone-else@example.invalid' where id='e1000000-0000-4000-8000-000000000005';
select throws_ok($$select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000005',2,'activate','Synthetic review','role-activate-changed')$$,
 'P0001','Bound account no longer matches the reviewed application recipient','A changed account address blocks activation');
update auth.users set email='role-changed@example.invalid',email_confirmed_at=null where id='e1000000-0000-4000-8000-000000000005';
select throws_ok($$select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000005',2,'activate','Synthetic review','role-activate-changed')$$,
 'P0001','Bound account no longer matches the reviewed application recipient','An unconfirmed bound account blocks activation');
select is((select status||':'||revision from public.vendor_onboarding where contractor_id='e2000000-0000-4000-8000-000000000005'),'review:2',
 'A refused activation changes no onboarding state');
select is((select count(*) from public.vendor_onboarding_events where business_key='role-activate-changed'),0::bigint,
 'A refused activation records no event');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000005'),'homeowner','A refused activation grants no role');

-- An incomplete checklist refuses before any role is considered.
select public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000006',1,
 'e1000000-0000-4000-8000-000000000006','Applicant already holds a Mercurius account','role-link-incomplete');
select throws_ok($$select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000006',2,'activate','Synthetic review','role-activate-incomplete')$$,
 'P0001','Activation checklist incomplete or expired','An incomplete checklist still refuses activation');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000006'),'homeowner','An incomplete checklist grants no role');
select is((select count(*) from public.vendor_role_decisions where contractor_id='e2000000-0000-4000-8000-000000000006'),0::bigint,
 'An incomplete checklist records no role decision');
-- Rejection is not activation.
select public.vendor_decide_onboarding('e2000000-0000-4000-8000-000000000006',2,'reject','Synthetic rejection','role-reject-incomplete');
select is(pg_temp.roles('e1000000-0000-4000-8000-000000000006'),'homeowner','Rejection grants no role');

-- Nothing here activates a listing.
select is((select count(*) from public.contractors where id::text like 'e2000000-%' and (is_active or marketing_enabled)),0::bigint,
 'Granting a role neither activates nor lists a contractor record');

-- Evidence is append-only.
select throws_ok($$update public.vendor_role_decisions set outcome='granted'$$,'55000',null,'A role decision cannot be rewritten');
select throws_ok($$delete from public.vendor_role_decisions$$,'55000',null,'A role decision cannot be deleted');

select * from finish();
rollback;
