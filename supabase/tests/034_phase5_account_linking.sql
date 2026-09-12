begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-067 synthetic fixtures only. Covers the reviewed existing-account link and
-- release commands and their operator readback. No real provider, account or
-- mailbox is represented here.
insert into auth.users(id,email,email_confirmed_at) values
 ('a1000000-0000-4000-8000-000000000001','link-operator@example.invalid',now()),
 ('a1000000-0000-4000-8000-000000000002','link-recipient@example.invalid',now()),
 ('a1000000-0000-4000-8000-000000000003','link-unconfirmed@example.invalid',null),
 ('a1000000-0000-4000-8000-000000000004','link-other@example.invalid',now()),
 ('a1000000-0000-4000-8000-000000000005','link-vendor@example.invalid',now()),
 ('a1000000-0000-4000-8000-000000000006','link-second@example.invalid',now()),
 ('a1000000-0000-4000-8000-000000000007','link-suspended@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a1000000-0000-4000-8000-000000000001','admin'),('a1000000-0000-4000-8000-000000000005','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('a2000000-0000-4000-8000-000000000001','Synthetic linkable provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000002','Synthetic invited provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000003','Synthetic inherited-link provider',false,false,'a1000000-0000-4000-8000-000000000005'),
 ('a2000000-0000-4000-8000-000000000004','Synthetic unreviewed provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000005','Synthetic stale-version provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000006','Synthetic duplicate-recipient provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000007','Synthetic suspended provider',false,false,null),
 ('a2000000-0000-4000-8000-000000000008','Synthetic unconfirmed-recipient provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('a3000000-0000-4000-8000-000000000001','Synthetic linkable provider','Test','Recipient',
  'link-recipient@example.invalid','synthetic','a2000000-0000-4000-8000-000000000001'),
 ('a3000000-0000-4000-8000-000000000002','Synthetic invited provider','Test','Invited',
  'link-second@example.invalid','synthetic','a2000000-0000-4000-8000-000000000002'),
 ('a3000000-0000-4000-8000-000000000003','Synthetic inherited-link provider','Test','Inherited',
  'link-vendor@example.invalid','synthetic','a2000000-0000-4000-8000-000000000003'),
 ('a3000000-0000-4000-8000-000000000005','Synthetic stale-version provider','Test','Stale',
  'link-other@example.invalid','synthetic','a2000000-0000-4000-8000-000000000005'),
 ('a3000000-0000-4000-8000-000000000006','Synthetic duplicate-recipient provider','Test','Duplicate',
  'link-recipient@example.invalid','synthetic','a2000000-0000-4000-8000-000000000006'),
 ('a3000000-0000-4000-8000-000000000007','Synthetic suspended provider','Test','Suspended',
  'link-suspended@example.invalid','synthetic','a2000000-0000-4000-8000-000000000007'),
 ('a3000000-0000-4000-8000-000000000008','Synthetic unconfirmed-recipient provider','Test','Unconfirmed',
  'link-unconfirmed@example.invalid','synthetic','a2000000-0000-4000-8000-000000000008');

create function pg_temp.version(p_application uuid) returns uuid language sql security definer as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
grant execute on function pg_temp.version(uuid) to anon,authenticated,service_role;
-- Fingerprint of every row a linking command could write, so the readback's
-- read-only claim is proved rather than asserted.
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select string_agg(id||':'||coalesce(user_id::text,'-')||':'||is_active||':'||marketing_enabled,',' order by id) from public.contractors),
 (select string_agg(business_key||':'||action||':'||auth_user_id,',' order by business_key) from public.vendor_account_link_decisions),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.user_roles),
 (select count(*) from public.vendor_invitation_attempts))) $$;
create temp table snap(k text primary key,v text);
grant select,insert on snap to anon,authenticated,service_role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000001',pg_temp.version('a3000000-0000-4000-8000-000000000001'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000002',pg_temp.version('a3000000-0000-4000-8000-000000000002'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000003',pg_temp.version('a3000000-0000-4000-8000-000000000003'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000005',pg_temp.version('a3000000-0000-4000-8000-000000000005'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000006',pg_temp.version('a3000000-0000-4000-8000-000000000006'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000007',pg_temp.version('a3000000-0000-4000-8000-000000000007'));
select public.vendor_begin_review('a2000000-0000-4000-8000-000000000008',pg_temp.version('a3000000-0000-4000-8000-000000000008'));

-- Access: refused before any provider lookup.
set local role anon;
select throws_ok($$select public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function vendor_account_link_overview','Anonymous caller cannot read the account panel');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000002','Synthetic','k')$$,
 '42501','permission denied for function vendor_link_existing_account','Anonymous caller cannot link an account');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000002','Synthetic','k')$$,
 '42501','permission denied for function vendor_link_existing_account','Service role cannot link an account');
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',1,'Synthetic','k')$$,
 '42501','permission denied for function vendor_release_linked_account','Service role cannot release an account');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000005"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','A vendor cannot read the account panel');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000005','Self service','k')$$,
 '42501','Onboarding operator required','A vendor cannot link its own account');
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000003',1,'Self service','k')$$,
 '42501','Onboarding operator required','A vendor cannot release its own account');
reset role;

-- The legacy email-scanning entry points are closed to clients and fail closed.
set local role authenticated;
select throws_ok($$select public.admin_link_contractor_to_user('a2000000-0000-4000-8000-000000000001','link-recipient@example.invalid')$$,
 '42501','permission denied for function admin_link_contractor_to_user','Legacy linking is no longer callable by clients');
select throws_ok($$select public.admin_unlink_contractor('a2000000-0000-4000-8000-000000000003')$$,
 '42501','permission denied for function admin_unlink_contractor','Legacy unlinking is no longer callable by clients');
reset role;
select throws_ok($$select public.admin_link_contractor_to_user('a2000000-0000-4000-8000-000000000001','link-recipient@example.invalid')$$,
 'P0001','Reviewed account linking required','Legacy linking fails closed even for a privileged caller');
select throws_ok($$select public.admin_unlink_contractor('a2000000-0000-4000-8000-000000000003')$$,
 'P0001','Reviewed account release required','Legacy unlinking fails closed even for a privileged caller');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"a1000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000004')$$,
 'P0001','Onboarding record not found','A provider without onboarding has no account panel');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000004',1,'a1000000-0000-4000-8000-000000000002','Synthetic','no-onboarding')$$,
 'P0001','Onboarding review required','A provider without onboarding cannot be linked');

-- Before any decision.
insert into snap values('before',pg_temp.state());
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'linked')::boolean,false,
 'An account-less provider is not reported as linked');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'link_reviewed')::boolean,false,
 'An account-less provider has no reviewed link');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'linked_email',null,
 'No bound address is reported before linking');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'recipient_email',
 'link-recipient@example.invalid','The bound snapshot recipient is reported');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'recipient_valid')::boolean,true,
 'A usable snapshot recipient is reported as valid');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'version_current')::boolean,true,
 'The bound application version is reported as current');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'invitation_live')::boolean,false,
 'No live invitation is reported before preparation');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->'decisions','[]'::jsonb,
 'No decisions are reported before linking');
-- An inherited link is reported as unreviewed rather than presented as evidence.
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000003')->>'linked')::boolean,true,
 'An inherited link is reported as linked');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000003')->>'link_reviewed')::boolean,false,
 'An inherited link is not reported as reviewed');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000003')->>'linked_email',
 'link-vendor@example.invalid','The bound identity address is reported for an inherited link');
select is(pg_temp.state(),(select v from snap where k='before'),'Reading the account panel wrote nothing');

-- Refusals. Each names the blocking fact rather than failing generically.
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,null,'Synthetic','no-identity')$$,
 'P0001','Exact account identity required','Linking requires an exact account identity');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000002','   ','no-reason')$$,
 'P0001','Reason and idempotency key required','Linking requires a reason');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000002','Synthetic','')$$,
 'P0001','Reason and idempotency key required','Linking requires an idempotency key');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',9,'a1000000-0000-4000-8000-000000000002','Synthetic','stale-revision')$$,
 'P0001','Stale onboarding revision','A stale onboarding revision cannot link an account');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-00000000000f','Synthetic','unknown-identity')$$,
 'P0001','Account identity not found','An unknown account identity cannot be linked');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000008',1,'a1000000-0000-4000-8000-000000000003','Synthetic','unconfirmed')$$,
 'P0001','Confirmed account required','An unconfirmed account cannot be linked');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000008',1,'a1000000-0000-4000-8000-000000000004','Synthetic','mismatch')$$,
 'P0001','Account identity does not match the reviewed application recipient',
 'An identity that is not the reviewed recipient cannot be linked');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000003',1,'a1000000-0000-4000-8000-000000000005','Synthetic','inherited')$$,
 'P0001','Existing account link requires the compliance cutover path',
 'An inherited link is not adopted by this command');
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000003',1,'Synthetic','inherited-release')$$,
 'P0001','Existing account link requires the compliance cutover path',
 'An inherited link is not released by this command');
update public.vendor_onboarding set status='suspended' where contractor_id='a2000000-0000-4000-8000-000000000007';
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000007',1,'a1000000-0000-4000-8000-000000000007','Synthetic','suspended')$$,
 'P0001','Account linking requires onboarding review','A suspended provider cannot link an account');
-- A newer application revision is reported and refused, never silently adopted.
update public.vendor_applications set business_name='Synthetic stale-version provider v2'
 where id='a3000000-0000-4000-8000-000000000005';
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000005')->>'version_current')::boolean,false,
 'A newer application revision marks the bound version stale');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000005',1,'a1000000-0000-4000-8000-000000000004','Synthetic','stale-version')$$,
 'P0001','Current application version required','A superseded application version cannot bind an identity');

-- The invitation and linking paths are mutually exclusive while an attempt is live.
select public.vendor_prepare_invitation('a2000000-0000-4000-8000-000000000002','account-link-suite-invite',now()+interval '2 days');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000002')->>'invitation_live')::boolean,true,
 'A prepared invitation is reported as live');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000002',1,'a1000000-0000-4000-8000-000000000006','Synthetic','live-invitation')$$,
 'P0001','Close the live invitation before linking an existing account',
 'A live invitation blocks existing-account linking');
-- The reviewed link. The recovered signup trigger already gave this account a
-- homeowner role; linking must leave that set untouched.
insert into snap values('pre-link',pg_temp.state());
insert into snap values('roles-before',(select string_agg(role::text,',' order by role)
 from public.user_roles where user_id='a1000000-0000-4000-8000-000000000002'));
select is(public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,
  'a1000000-0000-4000-8000-000000000002','Applicant already holds a Mercurius account','link-one')
 ->>'recorded','true','The first reviewed link is recorded');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'linked_user_id',
 'a1000000-0000-4000-8000-000000000002','The reviewed identity is bound');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'link_reviewed')::boolean,true,
 'A link created by this command is reported as reviewed');
select is(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'linked_email',
 'link-recipient@example.invalid','The bound address is the reviewed recipient');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'onboarding_revision')::integer,2,
 'Linking advances the onboarding revision');
select is(jsonb_array_length(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->'decisions'),1,
 'One decision is reported after linking');
select is((select count(*) from public.vendor_onboarding_events
  where contractor_id='a2000000-0000-4000-8000-000000000001' and action='account_linked' and revision=2),1::bigint,
 'Linking records exactly one onboarding event');
select is((select status from public.vendor_onboarding where contractor_id='a2000000-0000-4000-8000-000000000001'),'review',
 'Linking does not change onboarding status');
-- The properties this command must not have.
select is((select count(*) from public.user_roles
  where user_id='a1000000-0000-4000-8000-000000000002' and role='vendor'),0::bigint,
 'Linking grants no vendor role');
select is((select string_agg(role::text,',' order by role) from public.user_roles
  where user_id='a1000000-0000-4000-8000-000000000002'),
 (select v from snap where k='roles-before'),'Linking leaves the account roles exactly as they were');
select is((select count(*) from public.contractors where id='a2000000-0000-4000-8000-000000000001'
  and (is_active or marketing_enabled)),0::bigint,'Linking neither activates nor lists the provider');
select is(public.vendor_is_eligible('a2000000-0000-4000-8000-000000000001'),false,
 'Linking does not make a provider match-eligible');
select is((select count(*) from public.vendor_compliance_evidence where contractor_id='a2000000-0000-4000-8000-000000000001'),
 0::bigint,'Linking accepts no compliance evidence');

-- Replay and conflict.
select is(public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,
  'a1000000-0000-4000-8000-000000000002','Applicant already holds a Mercurius account','link-one')
 ->>'recorded','false','An exact replay reports the original decision rather than a new one');
select is((select count(*) from public.vendor_account_link_decisions where contractor_id='a2000000-0000-4000-8000-000000000001'),
 1::bigint,'A replay writes no second decision');
select is((select revision from public.vendor_onboarding where contractor_id='a2000000-0000-4000-8000-000000000001'),2,
 'A replay does not advance the onboarding revision again');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',1,'a1000000-0000-4000-8000-000000000002','A different reason','link-one')$$,
 'P0001','Account linking idempotency conflict','The same key with a different reason is refused');
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000006',1,'a1000000-0000-4000-8000-000000000002','Applicant already holds a Mercurius account','link-one')$$,
 'P0001','Account linking idempotency conflict','The same key cannot be reused for another provider');

-- One account belongs to one provider, even where the recipient address repeats.
select throws_ok($$select public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000006',1,'a1000000-0000-4000-8000-000000000002','Synthetic','duplicate-provider')$$,
 'P0001','Account already linked to another provider','A bound account cannot be linked to a second provider');
select throws_ok($$update public.contractors set user_id='a1000000-0000-4000-8000-000000000002' where id='a2000000-0000-4000-8000-000000000006'$$,
 '23505',null,'The database refuses a second live link for one account');
-- Linking now blocks the new-account invitation path at its own gate.
select public.vendor_prepare_invitation('a2000000-0000-4000-8000-000000000001','account-link-suite-blocked',now()+interval '2 days');
select throws_ok($$select public.vendor_claim_invitation((select id from public.vendor_invitation_attempts where business_key='account-link-suite-blocked'))$$,
 'P0001','Existing account requires reviewed account linking','A linked provider cannot be dispatched a new-account invitation');

-- Closing that attempt releases the mutual exclusion again.
select public.vendor_record_invitation((select id from public.vendor_invitation_attempts
 where business_key='account-link-suite-blocked'),'revoked','synthetic-suite','Closed by the linking suite');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'invitation_live')::boolean,false,
 'A revoked attempt is no longer reported as live');

-- Release.
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',2,'  ','no-reason-release')$$,
 'P0001','Reason and idempotency key required','Releasing requires a reason');
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',1,'Synthetic','stale-release')$$,
 'P0001','Stale onboarding revision','A stale onboarding revision cannot release an account');
update public.vendor_onboarding set status='active' where contractor_id='a2000000-0000-4000-8000-000000000001';
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',2,'Synthetic','active-release')$$,
 'P0001','Suspend the provider before releasing its account','An active provider keeps its account until it is suspended');
update public.vendor_onboarding set status='review' where contractor_id='a2000000-0000-4000-8000-000000000001';
select is(public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',2,'Applicant asked for a different account','release-one')
 ->>'auth_user_id','a1000000-0000-4000-8000-000000000002','The released identity is reported');
select is((select user_id from public.contractors where id='a2000000-0000-4000-8000-000000000001'),null,
 'Releasing clears the live link');
select is((public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->>'linked')::boolean,false,
 'A released provider is not reported as linked');
select is(jsonb_array_length(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->'decisions'),2,
 'Both decisions remain reported after a release');
select is((select string_agg(role::text,',' order by role) from public.user_roles
  where user_id='a1000000-0000-4000-8000-000000000002'),(select v from snap where k='roles-before'),
 'Releasing leaves the account roles exactly as they were');
select throws_ok($$select public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',3,'Synthetic','release-again')$$,
 'P0001','No account is linked','A released provider has nothing further to release');
select is(public.vendor_release_linked_account('a2000000-0000-4000-8000-000000000001',2,'Applicant asked for a different account','release-one')
 ->>'recorded','false','An exact release replay reports the original decision');

-- Recovery: the append-only log does not block a corrected link.
select is(public.vendor_link_existing_account('a2000000-0000-4000-8000-000000000001',3,
  'a1000000-0000-4000-8000-000000000002','Applicant confirmed the original account after all','link-two')
 ->>'recorded','true','A released account can be linked again under a new decision');
select is(jsonb_array_length(public.vendor_account_link_overview('a2000000-0000-4000-8000-000000000001')->'decisions'),3,
 'Every decision is retained');
select is((select revision from public.vendor_onboarding where contractor_id='a2000000-0000-4000-8000-000000000001'),4,
 'Each decision advances the onboarding revision once');

-- Evidence is append-only.
select throws_ok($$update public.vendor_account_link_decisions set reason='Rewritten'$$,'55000',null,
 'A recorded decision cannot be rewritten');
select throws_ok($$delete from public.vendor_account_link_decisions$$,'55000',null,
 'A recorded decision cannot be deleted');

insert into snap values('after',pg_temp.state());
select isnt((select v from snap where k='after'),(select v from snap where k='pre-link'),
 'The reviewed commands did change recorded state');
select is(pg_temp.state(),(select v from snap where k='after'),
 'Repeated readbacks still write nothing');

select * from finish();
rollback;
