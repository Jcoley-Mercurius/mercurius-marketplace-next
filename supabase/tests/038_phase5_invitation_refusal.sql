begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-063 forward fix: a definite Auth refusal is recorded as failed and releases the
-- provider, instead of wedging an unreconcilable, unclosable unknown attempt.
-- Synthetic identities only. Accounts that exist "from somewhere else" were confirmed a
-- day before any dispatch and never invited.
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('e1000000-0000-4000-8000-000000000001','refusal-operator@example.invalid',now(),null),
 ('e1000000-0000-4000-8000-000000000002','homeowner@example.invalid',now()-interval '1 day',null),
 ('e1000000-0000-4000-8000-000000000003','refusal-member@example.invalid',now(),null),
 ('e1000000-0000-4000-8000-000000000004','shopper@example.invalid',now()-interval '1 day',null),
 ('e1000000-0000-4000-8000-000000000005','fresh-invitee@example.invalid',null,now());
insert into public.user_roles(user_id,role) values('e1000000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('e2000000-0000-4000-8000-000000000001','Synthetic refusal provider',false,false),
 ('e2000000-0000-4000-8000-000000000002','Synthetic wedged provider',false,false),
 ('e2000000-0000-4000-8000-000000000003','Synthetic accepted provider',false,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('e3000000-0000-4000-8000-000000000001','Synthetic refusal provider','Test','Homeowner','homeowner@example.invalid','synthetic','e2000000-0000-4000-8000-000000000001'),
 ('e3000000-0000-4000-8000-000000000002','Synthetic wedged provider','Test','Shopper','Shopper@Example.invalid ','synthetic','e2000000-0000-4000-8000-000000000002'),
 ('e3000000-0000-4000-8000-000000000003','Synthetic accepted provider','Test','Invitee','fresh-invitee@example.invalid','synthetic','e2000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1000000-0000-4000-8000-000000000001"}',true);
create function pg_temp.op() returns uuid language sql as $$ select 'e1000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.revision(p_contractor uuid) returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id=p_contractor $$;
create function pg_temp.events(p_attempt uuid,p_status text) returns bigint language sql as $$
 select count(*) from public.vendor_invitation_events where attempt_id=p_attempt and status=p_status $$;
select public.vendor_begin_review(c.id,(select id from public.vendor_application_versions where application_id=a.id))
 from public.contractors c join public.vendor_applications a on a.contractor_id=c.id
 where c.id::text like 'e2000000-%' order by c.id;
create temp table refusal_fixture(key text primary key,id uuid);
grant select on refusal_fixture to authenticated,service_role;
create function pg_temp.fx(p_key text) returns uuid language sql as $$ select id from refusal_fixture where key=p_key $$;

-- Characterization: the TRACE-070 receipt guard does not see an account from elsewhere.
insert into refusal_fixture values('live',public.vendor_prepare_invitation('e2000000-0000-4000-8000-000000000001','refusal-1',now()+interval '1 day'));
select is((public.vendor_claim_invitation(pg_temp.fx('live'))->>'claimed')::boolean,true,
 'An address holding an account from elsewhere is still prepared and reserved');
select is((select state from public.vendor_invitation_dispatches where attempt_id=pg_temp.fx('live')),'started','Reservation has no outcome yet');

-- Only the service role records a refusal, and only for an operator actor.
select ok(not has_function_privilege('anon','public.vendor_refuse_invitation(uuid,text,uuid,uuid)','EXECUTE'),'Anonymous users cannot record a refusal');
select ok(not has_function_privilege('authenticated','public.vendor_refuse_invitation(uuid,text,uuid,uuid)','EXECUTE'),'Browsers cannot record a refusal');
select ok(has_function_privilege('service_role','public.vendor_refuse_invitation(uuid,text,uuid,uuid)','EXECUTE'),'The dispatch handler can record a refusal');
set local role authenticated;
select throws_ok($$select public.vendor_refuse_invitation((select id from refusal_fixture where key='live'),'email_exists','e1000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function vendor_refuse_invitation','An operator session cannot call the service-only command');
reset role;
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),'email_exists',null)$$,'42501','Onboarding operator required','A refusal needs an actor');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),'email_exists','e1000000-0000-4000-8000-000000000003')$$,'42501','Onboarding operator required','A non-operator actor is refused');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),'validation_failed',pg_temp.op())$$,'P0001','Definite Auth refusal required','Other Auth errors stay unknown');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),null,pg_temp.op())$$,'P0001','Definite Auth refusal required','A refusal needs a code');
select is((select state from public.vendor_invitation_dispatches where attempt_id=pg_temp.fx('live')),'started','Refused calls write nothing');
select is(pg_temp.events(pg_temp.fx('live'),'failed'),0::bigint,'Refused calls record no event');

-- The handler's own report of the structured refusal.
select lives_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),'email_exists',pg_temp.op())$$,'The handler records Auth''s refusal');
select results_eq($$select state,refusal_code,refused_account_id,resolved_at is not null,auth_user_id from public.vendor_invitation_dispatches where attempt_id=pg_temp.fx('live')$$,
 $$select 'failed'::text,'email_exists'::text,null::uuid,true,null::uuid$$,'Dispatch records the refusal and no identity');
select is((select status from public.vendor_invitation_attempts where id=pg_temp.fx('live')),'failed','Attempt is recorded as failed');
select is(pg_temp.events(pg_temp.fx('live'),'failed'),1::bigint,'One failure event');
select is((select actor from public.vendor_invitation_events where attempt_id=pg_temp.fx('live') and status='failed'),pg_temp.op(),'The failure names the operator');
select lives_ok($$select public.vendor_refuse_invitation(pg_temp.fx('live'),'email_exists',pg_temp.op())$$,'A repeated report replays');
select is(pg_temp.events(pg_temp.fx('live'),'failed'),1::bigint,'Replay records nothing');

-- A refusal is final.
select public.vendor_finish_invitation(pg_temp.fx('live'),null,pg_temp.op());
select is((select state from public.vendor_invitation_dispatches where attempt_id=pg_temp.fx('live')),'failed','A late unknown report cannot reopen a refusal');
select is(pg_temp.events(pg_temp.fx('live'),'unknown'),0::bigint,'No unknown event after a refusal');
select throws_ok($$select public.vendor_finish_invitation(pg_temp.fx('live'),'e1000000-0000-4000-8000-000000000002',pg_temp.op())$$,
 'P0001','Invitation already refused by Auth','No identity can be attached to a refused invitation');
select throws_ok($$select public.vendor_close_dispatched_invitation(pg_temp.fx('live'),'revoked','Synthetic stop')$$,
 'P0001','Reconcile invitation before closure','A failed attempt is already closed and is not re-closed');
select throws_ok($$update public.vendor_invitation_dispatches set refusal_code=null where attempt_id=pg_temp.fx('live')$$,
 '23514',null,'A failed dispatch cannot lose its refusal');
select throws_ok($$update public.vendor_invitation_dispatches set state='started' where attempt_id=pg_temp.fx('live')$$,
 '23514',null,'A refusal code cannot sit on another state');

-- Readback, and nothing else changed.
select results_eq($$select o->'attempt'->>'status',o->'attempt'->>'dispatch_state',o->'attempt'->>'refusal_code',(o->'attempt'->>'live')::boolean
  from public.vendor_invitation_overview('e2000000-0000-4000-8000-000000000001') o$$,
 $$select 'failed'::text,'failed'::text,'email_exists'::text,false$$,'The overview reports the refusal and a closed attempt');
select is(public.vendor_invitation_status(pg_temp.fx('live'))->>'refusal_code','email_exists','Operator status reports the refusal');
select ok((select user_id is null and not is_active from public.contractors where id='e2000000-0000-4000-8000-000000000001'),'A refusal neither links nor activates');
select is((select status from public.vendor_onboarding where contractor_id='e2000000-0000-4000-8000-000000000001'),'review','Onboarding stays in review');
select is((select count(*) from public.user_roles where user_id='e1000000-0000-4000-8000-000000000002' and role='vendor'),0::bigint,'A refusal grants no vendor role');

-- The provider is released: linking the existing account by ID now works.
select is(public.vendor_link_existing_account('e2000000-0000-4000-8000-000000000001',pg_temp.revision('e2000000-0000-4000-8000-000000000001'),
 'e1000000-0000-4000-8000-000000000002','Operator verified the homeowner account','refusal-link')->>'recorded','true',
 'Linking the existing account by ID is no longer blocked');

-- An attempt already wedged as unknown (for example before this fix).
insert into refusal_fixture values('wedged',public.vendor_prepare_invitation('e2000000-0000-4000-8000-000000000002','refusal-2',now()+interval '1 day'));
select public.vendor_claim_invitation(pg_temp.fx('wedged'));
select public.vendor_finish_invitation(pg_temp.fx('wedged'),null,pg_temp.op());
select is((select status from public.vendor_invitation_attempts where id=pg_temp.fx('wedged')),'unknown','Fixture: the attempt is wedged as unknown');
select throws_ok($$select public.vendor_finish_invitation(pg_temp.fx('wedged'),'e1000000-0000-4000-8000-000000000004',pg_temp.op())$$,
 'P0001','Auth invitation identity evidence mismatch','Characterization: the existing account cannot reconcile it');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op())$$,
 'P0001','Unknown invitation requires account evidence','An unknown outcome is not converted on a bare report');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e9000000-0000-4000-8000-000000000009')$$,
 'P0001','Account identity not found','A missing account is refused');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000002')$$,
 'P0001','Auth refusal evidence mismatch','An account at another address is refused');
update auth.users set email_confirmed_at=null where id='e1000000-0000-4000-8000-000000000004';
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000004')$$,
 'P0001','Auth refusal evidence mismatch','An unconfirmed account is refused (Auth re-invites those)');
update auth.users set email_confirmed_at=now() where id='e1000000-0000-4000-8000-000000000004';
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000004')$$,
 'P0001','Auth refusal evidence mismatch','An account confirmed at or after dispatch is refused');
update auth.users set email_confirmed_at=now()-interval '1 day',invited_at=now() where id='e1000000-0000-4000-8000-000000000004';
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000004')$$,
 'P0001','Auth refusal evidence mismatch','An account invited at or after dispatch is refused');
update auth.users set invited_at=null where id='e1000000-0000-4000-8000-000000000004';
select is(pg_temp.events(pg_temp.fx('wedged'),'failed'),0::bigint,'Refused evidence writes nothing');
select lives_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000004')$$,
 'An account that held the address before dispatch proves the refusal');
select results_eq($$select d.state,d.refusal_code,d.refused_account_id,a.status from public.vendor_invitation_dispatches d
  join public.vendor_invitation_attempts a on a.id=d.attempt_id where d.attempt_id=pg_temp.fx('wedged')$$,
 $$select 'failed'::text,'email_exists'::text,'e1000000-0000-4000-8000-000000000004'::uuid,'failed'::text$$,'The wedged attempt is failed and names its evidence');
select ok((select evidence like '%e1000000-0000-4000-8000-000000000004%' from public.vendor_invitation_events where attempt_id=pg_temp.fx('wedged') and status='failed'),'The event names the corroborating account');
select lives_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000004')$$,'Exact corroborated replay');
select lives_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op())$$,'A bare replay of a recorded refusal');
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('wedged'),'email_exists',pg_temp.op(),'e1000000-0000-4000-8000-000000000002')$$,
 'P0001','Invitation refusal conflict','A different corroborating account conflicts');
select is(pg_temp.events(pg_temp.fx('wedged'),'failed'),1::bigint,'Replays record nothing');
select is(public.vendor_invitation_overview('e2000000-0000-4000-8000-000000000002')->'attempt'->>'refused_account_id',
 'e1000000-0000-4000-8000-000000000004','The overview names the corroborating account');
-- The slot is free again.
select lives_ok($$select public.vendor_prepare_invitation('e2000000-0000-4000-8000-000000000002','refusal-3',now()+interval '1 day')$$,
 'A failed attempt no longer holds the live slot');

-- Auth accepted: a refusal cannot overwrite a provider receipt.
insert into refusal_fixture values('accepted',public.vendor_prepare_invitation('e2000000-0000-4000-8000-000000000003','refusal-4',now()+interval '1 day'));
select public.vendor_claim_invitation(pg_temp.fx('accepted'));
select public.vendor_finish_invitation(pg_temp.fx('accepted'),'e1000000-0000-4000-8000-000000000005',pg_temp.op());
select throws_ok($$select public.vendor_refuse_invitation(pg_temp.fx('accepted'),'email_exists',pg_temp.op())$$,
 'P0001','Invitation identity conflict','A provider-accepted dispatch cannot be recorded as refused');
select is((select state from public.vendor_invitation_dispatches where attempt_id=pg_temp.fx('accepted')),'provider_accepted','The receipt is unchanged');
-- An undispatched attempt has nothing to refuse.
select throws_ok($$select public.vendor_refuse_invitation((select id from public.vendor_invitation_attempts where business_key='refusal-3'),'email_exists',pg_temp.op())$$,
 'P0002',null,'An undispatched attempt cannot be refused');

select ok(not has_table_privilege('service_role','public.vendor_invitation_dispatches','UPDATE'),'Service role still cannot bypass the receipt commands');
select * from finish();
rollback;
