begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-066 synthetic fixtures only. This suite covers the operator readback the
-- invitation queue reads; the command contracts stay covered by suite 031.
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('f1000000-0000-4000-8000-000000000001','invite-operator@example.invalid',now(),null),
 ('f1000000-0000-4000-8000-000000000002','invite-recipient@example.invalid',now(),now()),
 ('f1000000-0000-4000-8000-000000000003','invite-vendor@example.invalid',now(),null);
insert into public.user_roles(user_id,role) values
 ('f1000000-0000-4000-8000-000000000001','admin'),('f1000000-0000-4000-8000-000000000003','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('f2000000-0000-4000-8000-000000000001','Synthetic invitation queue provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000002','Synthetic linked provider',false,false,'f1000000-0000-4000-8000-000000000003'),
 ('f2000000-0000-4000-8000-000000000003','Synthetic unreviewed provider',false,false,null),
 ('f2000000-0000-4000-8000-000000000004','Synthetic stale-version provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('f3000000-0000-4000-8000-000000000001','Synthetic invitation queue provider','Test','Recipient',
  'invite-recipient@example.invalid','synthetic','f2000000-0000-4000-8000-000000000001'),
 ('f3000000-0000-4000-8000-000000000002','Synthetic linked provider','Test','Linked',
  'invite-vendor@example.invalid','synthetic','f2000000-0000-4000-8000-000000000002'),
 ('f3000000-0000-4000-8000-000000000003','Synthetic stale-version provider','Test','Stale',
  'invite-stale@example.invalid','synthetic','f2000000-0000-4000-8000-000000000004');

create function pg_temp.version(p_application uuid) returns uuid language sql security definer as $$
 select id from public.vendor_application_versions where application_id=p_application order by revision desc limit 1 $$;
grant execute on function pg_temp.version(uuid) to anon,authenticated,service_role;
-- Fingerprint of every row an invitation command could write, so the read-only
-- claim is proved rather than asserted.
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select string_agg(id||':'||status||':'||coalesce(provider_reference,'-'),',' order by id) from public.vendor_invitation_attempts),
 (select count(*) from public.vendor_invitation_events),
 (select string_agg(attempt_id||':'||state,',' order by attempt_id) from public.vendor_invitation_dispatches),
 (select count(*) from public.vendor_invitation_acceptances),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select string_agg(id||':'||coalesce(user_id::text,'-')||':'||is_active,',' order by id) from public.contractors),
 (select count(*) from public.user_roles))) $$;
create temp table snap(k text primary key,v text);
create temp table attempt(k text primary key,id uuid);
grant select,insert on snap,attempt to anon,authenticated,service_role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true);
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000001',pg_temp.version('f3000000-0000-4000-8000-000000000001'));
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000002',pg_temp.version('f3000000-0000-4000-8000-000000000002'));
select public.vendor_begin_review('f2000000-0000-4000-8000-000000000004',pg_temp.version('f3000000-0000-4000-8000-000000000003'));

-- Access: refused before any contractor lookup.
set local role anon;
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function vendor_invitation_overview','Anonymous caller cannot read the invitation queue');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function vendor_invitation_overview','Service role cannot read the invitation queue');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','Vendor cannot read the invitation queue');
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000002')$$,
 '42501','Onboarding operator required','A linked provider cannot read its own invitation queue');
reset role;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000003')$$,
 'P0001','Onboarding record not found','A provider without onboarding has no invitation queue');
select throws_ok($$select public.vendor_invitation_overview('f2000000-0000-4000-8000-00000000000f')$$,
 'P0001','Onboarding record not found','An unknown provider has no invitation queue');

-- Before preparation.
insert into snap values('before',pg_temp.state());
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt','null'::jsonb,
 'No attempt is reported before preparation');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'prior_attempts','[]'::jsonb,
 'No prior attempts are reported before preparation');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'recipient_email',
 'invite-recipient@example.invalid','The bound snapshot recipient is reported');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'recipient_valid')::boolean,true,
 'A usable snapshot recipient is reported as valid');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'account_linked')::boolean,false,
 'An account-less provider is not reported as linked');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000002')->>'account_linked')::boolean,true,
 'A provider with an account is reported as linked');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'version_current')::boolean,true,
 'The bound application version is reported as current');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'onboarding_status','review',
 'Onboarding status is reported');
select is(pg_temp.state(),(select v from snap where k='before'),'Reading the queue wrote nothing');

-- A stale bound version is reported, never silently refreshed. Kept on its own
-- provider so the dispatch path below still runs against a current version.
update public.vendor_applications set business_name='Synthetic stale-version provider v2'
 where id='f3000000-0000-4000-8000-000000000003';
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000004')->>'version_current')::boolean,false,
 'A newer application revision marks the bound version stale');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000004')->>'application_version_id',
 (select application_version_id::text from public.vendor_onboarding where contractor_id='f2000000-0000-4000-8000-000000000004'),
 'The reported version stays the bound one, not the newest');
select isnt(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000004')->>'application_version_id',
 pg_temp.version('f3000000-0000-4000-8000-000000000003')::text,'The newest revision is not reported as bound');

-- Prepared, then dispatched, then reconciled, then accepted.
insert into attempt values('live',public.vendor_prepare_invitation('f2000000-0000-4000-8000-000000000001',
 'queue-1',now()+interval '2 days'));
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'attempt_id',
 (select id::text from attempt where k='live'),'The prepared attempt becomes the current record');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'status','prepared',
 'A prepared attempt reports its status');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'live')::boolean,true,
 'A prepared attempt is reported as live');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'expired')::boolean,false,
 'A future expiry is not reported as expired');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->'dispatch_state','null'::jsonb,
 'A prepared attempt reports no dispatch state');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'accepted')::boolean,false,
 'A prepared attempt is not reported as accepted');

insert into snap values('dispatch',pg_temp.state());
select is((public.vendor_claim_invitation((select id from attempt where k='live'))->>'claimed')::boolean,true,
 'The queue readback did not consume the reservation');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'dispatch_state','started',
 'A reserved dispatch is reported as started');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'status','submitted',
 'A reserved dispatch reports the submitted attempt status');
select isnt(pg_temp.state(),(select v from snap where k='dispatch'),'The dispatch command, not the readback, changed state');

select public.vendor_finish_invitation((select id from attempt where k='live'));
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'dispatch_state','unknown',
 'An uncertain provider result is reported as unknown');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->'auth_user_id','null'::jsonb,
 'An unknown result reports no Auth identity');

select public.vendor_finish_invitation((select id from attempt where k='live'),'f1000000-0000-4000-8000-000000000002');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'dispatch_state','provider_accepted',
 'A reconciled result is reported as provider accepted');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'auth_user_id',
 'f1000000-0000-4000-8000-000000000002','The reconciled Auth identity is reported');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'accepted')::boolean,false,
 'A provider receipt is not reported as recipient acceptance');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000002"}',true);
select public.vendor_accept_invitation((select id from attempt where k='live'));
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1000000-0000-4000-8000-000000000001"}',true);
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'accepted')::boolean,true,
 'A recipient receipt is reported as accepted');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'status','accepted',
 'An accepted attempt stays the current record');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'live')::boolean,false,
 'An accepted attempt is no longer live');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->>'account_linked')::boolean,false,
 'Acceptance did not link an account');
select is((select is_active from public.contractors where id='f2000000-0000-4000-8000-000000000001'),false,
 'Acceptance did not activate the provider');

-- A later live attempt outranks the newest closed one.
insert into attempt values('second',public.vendor_prepare_invitation('f2000000-0000-4000-8000-000000000001',
 'queue-2',now()-interval '1 second'+interval '2 days'));
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'attempt_id',
 (select id::text from attempt where k='second'),'The live attempt is the current record');
select is(jsonb_array_length(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'prior_attempts'),1,
 'The accepted attempt is reported as a prior attempt');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'prior_attempts'->0->>'attempt_id',
 (select id::text from attempt where k='live'),'The prior attempt keeps its identity');
select is(public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'prior_attempts'->0->>'status','accepted',
 'The prior attempt keeps its closed status');

-- Expiry is reported, not enforced, by the readback.
update public.vendor_invitation_attempts set expires_at=now()-interval '1 second'
 where id=(select id from attempt where k='second');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'expired')::boolean,true,
 'A past expiry is reported as expired');
select is((public.vendor_invitation_overview('f2000000-0000-4000-8000-000000000001')->'attempt'->>'live')::boolean,true,
 'An expired attempt still occupies the live slot until it is closed');

select * from finish();
rollback;
