-- TRACE-105 (R0.5): existing-provider profile-setup access. Owner-confirmed contacts,
-- access invitations with the TRACE-063 reservation/receipt protections, reviewed
-- binding with the vendor role for setup (TRACE-068 timing change), release, and the
-- guarantee that setup access is not approval, eligibility, listing or job access.
-- Synthetic identities only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 invited recipient (created by "Auth" below); 3 unrelated signed-in user;
-- 4 existing confirmed account at provider B's contact; 5 unconfirmed account;
-- 6 account already linked to provider L; 7 account that already holds the vendor role.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e7200000-0000-4000-8000-000000000001','operator@example.test',now(),'{}'),
 ('e7200000-0000-4000-8000-000000000003','someone@example.test',now(),'{}'),
 ('e7200000-0000-4000-8000-000000000004','owner-b@example.test',now() - interval '1 day','{}'),
 ('e7200000-0000-4000-8000-000000000005','owner-u@example.test',null,'{}'),
 ('e7200000-0000-4000-8000-000000000006','owner-l@example.test',now(),'{}'),
 ('e7200000-0000-4000-8000-000000000007','owner-r@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e7200000-0000-4000-8000-000000000001','admin'),
 ('e7200000-0000-4000-8000-000000000007','vendor');

-- Legacy providers: A (new account), B (existing account), C (onboarding provider),
-- X (excluded sample), L (already linked), R (existing vendor-role holder), U (unconfirmed).
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled,email,user_id) values
 ('e7210000-0000-4000-8000-00000000000a','Synthetic Legacy A','Real description','{lawn-mowing}',true,true,'Owner-A@Example.test',null),
 ('e7210000-0000-4000-8000-00000000000b','Synthetic Legacy B','Real description','{lawn-mowing}',true,true,null,null),
 ('e7210000-0000-4000-8000-00000000000c','Synthetic Applicant C','Real description','{lawn-mowing}',false,false,null,null),
 ('e7210000-0000-4000-8000-00000000000d','Synthetic Sample X','Real description','{lawn-mowing}',true,true,null,null),
 ('e7210000-0000-4000-8000-00000000000e','Synthetic Linked L','Real description','{lawn-mowing}',true,true,null,'e7200000-0000-4000-8000-000000000006'),
 ('e7210000-0000-4000-8000-00000000000f','Synthetic Legacy R','Real description','{lawn-mowing}',true,true,null,null),
 ('e7210000-0000-4000-8000-000000000010','Synthetic Legacy U','Real description','{lawn-mowing}',true,true,null,null),
 ('e7210000-0000-4000-8000-000000000011','Synthetic Legacy V','Real description','{lawn-mowing}',true,true,null,null);
insert into private.r0_public_listing_exclusions(contractor_id,reason,excluded_by)
 values ('e7210000-0000-4000-8000-00000000000d','Synthetic sample','e7200000-0000-4000-8000-000000000001');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,document_urls,contractor_id)
 values ('e7220000-0000-4000-8000-000000000001','Synthetic Applicant C','Cy','Applicant','applicant-c@example.test','synthetic',3,'{lawn-mowing}','pending','{}','e7210000-0000-4000-8000-00000000000c');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select 'e7210000-0000-4000-8000-00000000000c',v.id,1,'review' from public.vendor_application_versions v
  where v.application_id='e7220000-0000-4000-8000-000000000001';

create function pg_temp.run(p_sub uuid, p_role text, p_sql text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role',p_role,'sub',p_sub)::text,true);
 execute format('set local role %I', p_role);
 execute p_sql into result;
 reset role;
 return result;
end $$;
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$ select pg_temp.run(null,'service_role',p_sql) $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$
 select pg_temp.run('e7200000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e7200000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;
create function pg_temp.eligible(p uuid) returns boolean language sql as $$ select private.vendor_matching_eligible(p) $$;
create function pg_temp.contact(p uuid, p_email text, p_key text) returns jsonb language sql as $$
 select pg_temp.op(format('select public.r0_record_provider_contact(%L,%L,''Owner confirmed mapping (synthetic)'',''R0 access'',%L)',p,p_email,p_key)) $$;
create function pg_temp.prepare(p uuid, p_key text, p_account uuid default null, p_expires timestamptz default now()+interval '7 days')
returns jsonb language sql as $$
 select pg_temp.op(format('select public.r0_prepare_provider_access(%L,%L,%L,%L)',p,p_key,p_expires,p_account)) $$;

-- Least privilege ------------------------------------------------------------------
select ok(not has_table_privilege(r,'private.'||t,'SELECT') and not has_table_privilege(r,'private.'||t,'INSERT'),
 'no client or service role touches '||t||': '||r)
 from unnest(array['anon','authenticated','service_role']) r,
      unnest(array['r0_provider_contacts','r0_provider_current_contacts','r0_provider_access_attempts',
        'r0_provider_access_dispatches','r0_provider_access_acceptances','r0_provider_access_bindings',
        'r0_provider_access_events']) t;
select ok(has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('anon',f,'EXECUTE')
  and not has_function_privilege('service_role',f,'EXECUTE'),'signed-in only: '||f)
 from unnest(array['public.r0_record_provider_contact(uuid,text,text,text,text)',
  'public.r0_prepare_provider_access(uuid,text,timestamptz,uuid)','public.r0_claim_provider_access(uuid)',
  'public.r0_accept_provider_access(uuid)','public.r0_close_provider_access(uuid,text,text)',
  'public.r0_bind_provider_access(uuid,uuid,text,text)','public.r0_release_provider_access(uuid,text,text)',
  'public.r0_provider_access_overview(uuid)','public.r0_provider_access_queue()','public.r0_excluded_provider_ids()']) f;
select ok(has_function_privilege('service_role',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE')
  and not has_function_privilege('anon',f,'EXECUTE'),'service key only: '||f)
 from unnest(array['public.r0_finish_provider_access(uuid,uuid,uuid)','public.r0_refuse_provider_access(uuid,text,uuid,uuid)']) f;

-- The contractor update-scope trigger must test the PostgREST role, not current_user
-- (always the owner inside SECURITY DEFINER), or it never enforces (R0.5 rehearsal finding).
select ok((select prosrc ~ 'current_setting\(''role'', true\) <> ''authenticated''' and prosrc !~* 'current_user'
  from pg_proc where proname='enforce_contractor_update_scope'), 'contractor update-scope trigger tests the request role');
select ok(exists(select 1 from pg_trigger where tgname='trg_enforce_contractor_update_scope' and tgrelid='public.contractors'::regclass and tgenabled='O'),
 'contractor update-scope trigger is attached and enabled');

-- Owner-confirmed contact ---------------------------------------------------------------
select ok(pg_temp.eligible('e7210000-0000-4000-8000-00000000000a'),'before a contact, legacy is_active still admits provider A (TRACE-060 compatibility)');
select throws_ok($$select pg_temp.user(3,'select public.r0_record_provider_contact(''e7210000-0000-4000-8000-00000000000a'',''a@example.test'',''c'',''r'',''k'')')$$,
 '42501','Onboarding operator required','a non-operator cannot record a contact');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000a','not-an-email','c-bad')$$,
 'P0001','Valid contact email required','an invalid address is refused');
select throws_ok($$select pg_temp.op('select public.r0_record_provider_contact(''e7210000-0000-4000-8000-00000000000a'',''a@example.test'','''',''r'',''k'')')$$,
 'P0001','Owner confirmation, reason and idempotency key required','owner confirmation is required');
select is(pg_temp.contact('e7210000-0000-4000-8000-00000000000a','  Owner-A@Example.TEST ','c-a')->>'recorded','true','operator records provider A''s confirmed contact');
select is((select email from private.r0_provider_current_contacts where contractor_id='e7210000-0000-4000-8000-00000000000a'),
 'owner-a@example.test','the contact is stored trimmed and lower-cased');
select is((select email from public.contractors where id='e7210000-0000-4000-8000-00000000000a'),'owner-a@example.test',
 'the profile business email is normalized to the confirmed contact');
select is((select name||'|'||bio from public.contractors where id='e7210000-0000-4000-8000-00000000000a'),'Synthetic Legacy A|Real description',
 'profile identity and content are preserved');
select is(pg_temp.contact('e7210000-0000-4000-8000-00000000000a','owner-a@example.test','c-a')->>'recorded','false','exact replay records nothing new');
select throws_ok($$select pg_temp.op('select public.r0_record_provider_contact(''e7210000-0000-4000-8000-00000000000a'',''other@example.test'',''Owner confirmed mapping (synthetic)'',''R0 access'',''c-a'')')$$,
 'P0001','Contact idempotency conflict','a reused key with different content conflicts');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000b','owner-a@example.test','c-b-dup')$$,
 'P0001','Contact email belongs to another provider','one mailbox cannot be the contact for two providers');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000c','applicant-c@example.test','c-c')$$,
 'P0001','Provider follows application onboarding','an onboarding provider keeps its application recipient');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000d','x@example.test','c-d')$$,
 'P0001','Excluded provider cannot receive access','an excluded sample cannot receive access');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000e','owner-l@example.test','c-e')$$,
 'P0001','Provider already has a linked account','an already linked provider follows the cutover path');
select ok(not pg_temp.eligible('e7210000-0000-4000-8000-00000000000a'),'an access-managed provider is not eligible on legacy is_active');
select ok(not public.r0_provider_listable('e7210000-0000-4000-8000-00000000000a'),'an access-managed provider is not publicly listed');
select is((select count(*)::int from public.r0_public_providers('e7210000-0000-4000-8000-00000000000a')),0,'its direct public profile projection is empty');
select is((select count(*)::int from private.r0_provider_access_events where contractor_id='e7210000-0000-4000-8000-00000000000a'
  and event='contact_recorded' and evidence !~* 'example'),1,'the contact audit names no address');

-- Prepare -------------------------------------------------------------------------------
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-00000000000f','p-r-none')$$,
 'P0001','Owner-confirmed contact required','access requires a confirmed contact');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-00000000000a','p-a-past',null,now()-interval '1 minute')$$,
 'P0001','Operator-entered expiry within 30 days required','a past expiry is refused');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-00000000000a','p-a-far',null,now()+interval '31 days')$$,
 'P0001','Operator-entered expiry within 30 days required','an expiry beyond 30 days is refused');
create temp table t(k text primary key, v jsonb);
grant all on t to authenticated, service_role;
insert into t values ('a1', pg_temp.prepare('e7210000-0000-4000-8000-00000000000a','p-a-1'));
select is((select v->>'mode' from t where k='a1'),'new_account','provider A gets a new-account attempt');
select is((select pg_temp.op(format('select public.r0_prepare_provider_access(%L,%L,%L,null)','e7210000-0000-4000-8000-00000000000a','p-a-1',
  (select expires_at from private.r0_provider_access_attempts where business_key='p-a-1')))->>'created'),'false','exact replay returns the same attempt');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-00000000000a','p-a-2')$$,
 'P0001','Close the live access invitation first','one live attempt per provider');
select throws_ok($$select pg_temp.contact('e7210000-0000-4000-8000-00000000000a','changed@example.test','c-a-2')$$,
 'P0001','Close the live access invitation before changing the contact','the contact cannot change under a live attempt');
select throws_ok($$insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
  select 'e7210000-0000-4000-8000-00000000000a',application_version_id,1,'review' from public.vendor_onboarding limit 1$$,
 'P0001','Close the live access invitation before starting application onboarding','application onboarding cannot start under a live access attempt');

-- Claim, finish and receipts -------------------------------------------------------------
select throws_ok(format('select pg_temp.user(3,%L)',format('select public.r0_claim_provider_access(%L)',(select v->>'attempt_id' from t where k='a1'))),
 '42501','Onboarding operator required','a non-operator cannot reserve a dispatch');
insert into t values ('claim1', pg_temp.op(format('select public.r0_claim_provider_access(%L)',(select v->>'attempt_id' from t where k='a1'))));
insert into t values ('claim2', pg_temp.op(format('select public.r0_claim_provider_access(%L)',(select v->>'attempt_id' from t where k='a1'))));
select ok((select (v->>'claimed')::boolean from t where k='claim1'),'the first claim reserves the dispatch');
select is((select v->>'recipient_email' from t where k='claim1'),'owner-a@example.test','the recipient comes from the confirmed contact');
select is((select v->>'business_name' from t where k='claim1'),'Synthetic Legacy A','the claim names the existing profile for the email');
select is((select v->>'claimed' from t where k='claim2'),'false','a second claim does not send again');
select throws_ok(format('select pg_temp.user(3,%L)',format('select to_jsonb(true) from public.r0_finish_provider_access(%L,null,null)',(select v->>'attempt_id' from t where k='a1'))),
 '42501',null,'a signed-in user cannot write a receipt');
-- Auth creates the invited user.
insert into auth.users(id,email,invited_at,raw_user_meta_data)
 values ('e7200000-0000-4000-8000-000000000002','owner-a@example.test',now(),'{}');
select throws_ok(format('select pg_temp.svc(%L)',format('select to_jsonb(true) from public.r0_finish_provider_access(%L,%L,%L)',(select v->>'attempt_id' from t where k='a1'),
  'e7200000-0000-4000-8000-000000000003','e7200000-0000-4000-8000-000000000001')),
 'P0001','Auth invitation identity evidence mismatch','a receipt for another account is refused');
select lives_ok(format('select pg_temp.svc(%L)',format('select to_jsonb(true) from public.r0_finish_provider_access(%L,%L,%L)',(select v->>'attempt_id' from t where k='a1'),
  'e7200000-0000-4000-8000-000000000002','e7200000-0000-4000-8000-000000000001')),'the handler records the Auth-accepted identity');
select is((select state from private.r0_provider_access_dispatches where attempt_id=(select (v->>'attempt_id')::uuid from t where k='a1')),
 'provider_accepted','dispatch reads provider accepted, not delivered');
select is((select count(*)::int from private.r0_provider_access_events where attempt_id=(select (v->>'attempt_id')::uuid from t where k='a1')
  and evidence ~* 'mailbox delivery not asserted'),1,'the event says mailbox delivery is not asserted');

-- Acceptance -------------------------------------------------------------------------
select throws_ok(format('select pg_temp.user(2,%L)',format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='a1'))),
 '42501','Verified invitation recipient required','an unconfirmed invited account cannot accept yet');
update auth.users set email_confirmed_at=now() where id='e7200000-0000-4000-8000-000000000002';
select throws_ok(format('select pg_temp.user(3,%L)',format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='a1'))),
 '42501','Verified invitation recipient required','another account cannot accept');
select is(pg_temp.user(2,format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='a1')))->>'recorded','true',
 'the verified recipient explicitly accepts');
select is(pg_temp.user(2,format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='a1')))->>'recorded','false',
 'a repeated acceptance records nothing new');
select is((select user_id from public.contractors where id='e7210000-0000-4000-8000-00000000000a'),null::uuid,'acceptance links nothing');
select ok(not exists(select 1 from public.user_roles where user_id='e7200000-0000-4000-8000-000000000002' and role in ('vendor','admin')),'acceptance grants no vendor or admin role');
select is(pg_temp.op('select public.r0_provider_access_queue()')->'items'->0->>'attention','awaiting_binding','the queue shows the receipt awaiting review');

-- Reviewed binding ---------------------------------------------------------------------
select throws_ok(format('select pg_temp.user(2,%L)',format('select public.r0_bind_provider_access(%L,%L,''r'',''b-x'')','e7210000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='a1'))),
 '42501','Onboarding operator required','the recipient cannot bind itself');
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_bind_provider_access(%L,%L,''r'',''b-wrong'')','e7210000-0000-4000-8000-00000000000b',(select v->>'attempt_id' from t where k='a1'))),
 'P0001','Accepted access invitation required','another provider''s receipt reads as missing');
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_bind_provider_access(%L,%L,'''',''b-a'')','e7210000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='a1'))),
 'P0001','Reason and idempotency key required','binding requires a reason');
insert into t values ('bind', pg_temp.op(format('select public.r0_bind_provider_access(%L,%L,''Owner-confirmed contact accepted'',''b-a'')','e7210000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='a1'))));
select is((select v->>'vendor_role_granted' from t where k='bind'),'true','reviewed binding grants the vendor role for setup');
select is((select user_id from public.contractors where id='e7210000-0000-4000-8000-00000000000a'),'e7200000-0000-4000-8000-000000000002'::uuid,
 'the account is bound to the exact existing provider');
select is(pg_temp.op(format('select public.r0_bind_provider_access(%L,%L,''Owner-confirmed contact accepted'',''b-a'')','e7210000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='a1')))->>'recorded',
 'false','exact binding replay records nothing new');
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_bind_provider_access(%L,%L,''again'',''b-a-2'')','e7210000-0000-4000-8000-00000000000a',(select v->>'attempt_id' from t where k='a1'))),
 'P0001','Account already bound to this provider','a second binding is refused');
select is((select count(*)::int from public.contractors where user_id='e7200000-0000-4000-8000-000000000002'),1,'no duplicate provider was created or linked');
select ok(not exists(select 1 from public.vendor_onboarding where contractor_id='e7210000-0000-4000-8000-00000000000a')
  and not exists(select 1 from public.vendor_applications where contractor_id='e7210000-0000-4000-8000-00000000000a')
  and not exists(select 1 from public.vendor_compliance_evidence where contractor_id='e7210000-0000-4000-8000-00000000000a'),
 'binding fabricates no application, onboarding or compliance evidence');
select ok(not pg_temp.eligible('e7210000-0000-4000-8000-00000000000a') and not public.r0_provider_listable('e7210000-0000-4000-8000-00000000000a'),
 'setup access is not eligibility or listing');

-- Setup access: own profile only, no jobs or approval flags -------------------------------
select is(pg_temp.user(2,'select public.r0_my_provider_listing()')->>'setup_access','true','the vendor reads a setup-access state');
select is(pg_temp.user(2,'select public.r0_my_provider_listing()')->>'approved','false','the vendor is not shown as approved');
select lives_ok($$select pg_temp.user(2,'with u as (update public.contractors set bio=''Updated by owner'' where id=''e7210000-0000-4000-8000-00000000000a'' returning 1) select to_jsonb(count(*)) from u')$$,
 'the vendor edits its own profile description');
select is((select bio from public.contractors where id='e7210000-0000-4000-8000-00000000000a'),'Updated by owner','the profile edit persisted');
select throws_ok($$select pg_temp.user(2,'with u as (update public.contractors set is_active=not is_active where id=''e7210000-0000-4000-8000-00000000000a'' returning 1) select to_jsonb(count(*)) from u')$$,
 '42501',null,'the vendor cannot change its activation flag');
select throws_ok($$select pg_temp.user(2,'with u as (update public.contractors set marketing_enabled=not marketing_enabled where id=''e7210000-0000-4000-8000-00000000000a'' returning 1) select to_jsonb(count(*)) from u')$$,
 '42501',null,'the vendor cannot change its listing flag');
select throws_ok($$select pg_temp.user(2,'with u as (update public.contractors set payouts_paused=true where id=''e7210000-0000-4000-8000-00000000000a'' returning 1) select to_jsonb(count(*)) from u')$$,
 '42501',null,'the vendor cannot change payout controls');
select is(pg_temp.user(2,'with u as (update public.contractors set bio=''hijack'' where id=''e7210000-0000-4000-8000-00000000000b'' returning 1) select to_jsonb(count(*)) from u'),
 '0'::jsonb,'the vendor cannot edit another provider');
select throws_ok($$select pg_temp.user(2,'select to_jsonb(public.vendor_accept_job(gen_random_uuid()))')$$,
 'P0001','No open offer is available to accept','the vendor has no job to accept');
select throws_ok($$select pg_temp.user(2,'select public.r0_provider_access_queue()')$$,'42501','Onboarding operator required',
 'the vendor cannot read other providers'' access records');
select throws_ok($$select pg_temp.user(2,'select to_jsonb(public.money_operator_request_ach(current_date,array[gen_random_uuid()],''synthetic-bank-ref'',''Authorization test'',''k''))')$$,
 '42501','Restricted finance authority required','the vendor cannot request an ACH payout');

-- Refusal and recovery (provider R: a confirmed account already exists at the contact) ----
select is(pg_temp.contact('e7210000-0000-4000-8000-00000000000f','owner-r@example.test','c-r')->>'recorded','true','provider R contact recorded');
insert into t values ('r1', pg_temp.prepare('e7210000-0000-4000-8000-00000000000f','p-r-1'));
insert into t values ('rclaim', pg_temp.op(format('select public.r0_claim_provider_access(%L)',(select v->>'attempt_id' from t where k='r1'))));
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_close_provider_access(%L,''revoked'',''x'')',(select v->>'attempt_id' from t where k='r1'))),
 'P0001','Reconcile access invitation before closure','a reserved dispatch cannot be closed before its outcome');
select lives_ok(format('select pg_temp.svc(%L)',format('select to_jsonb(true) from public.r0_refuse_provider_access(%L,''email_exists'',%L)',(select v->>'attempt_id' from t where k='r1'),'e7200000-0000-4000-8000-000000000001')),
 'the handler records Auth''s email_exists refusal');
select is((select status from private.r0_provider_access_attempts where id=(select (v->>'attempt_id')::uuid from t where k='r1')),'failed','the refusal is final and frees the slot');
insert into t values ('r2', pg_temp.prepare('e7210000-0000-4000-8000-00000000000f','p-r-2','e7200000-0000-4000-8000-000000000007'));
select is((select v->>'mode' from t where k='r2'),'existing_account','recovery prepares existing-account access by account ID');
select throws_ok(format('select pg_temp.op(%L)',format('select public.r0_claim_provider_access(%L)',(select v->>'attempt_id' from t where k='r2'))),
 'P0001','Existing-account access is not emailed by Auth','no new-account email is sent to a registered address');
select throws_ok(format('select pg_temp.user(3,%L)',format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='r2'))),
 '42501','Verified invitation recipient required','only the named account can accept');
select is(pg_temp.user(7,format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='r2')))->>'recorded','true',
 'the signed-in existing account proves ownership by accepting');
select is(pg_temp.op(format('select public.r0_bind_provider_access(%L,%L,''Existing account accepted'',''b-r'')','e7210000-0000-4000-8000-00000000000f',(select v->>'attempt_id' from t where k='r2')))->>'vendor_role_granted',
 'false','a vendor role the account already held is recorded as not granted here');
select is(pg_temp.op('select public.r0_release_provider_access(''e7210000-0000-4000-8000-00000000000f'',''Correction test'',''rel-r'')')->>'vendor_role_removed',
 'false','release never removes a role this path did not grant');
select ok(exists(select 1 from public.user_roles where user_id='e7200000-0000-4000-8000-000000000007' and role='vendor'),'the pre-existing role survives');
select is((select user_id from public.contractors where id='e7210000-0000-4000-8000-00000000000f'),null::uuid,'release clears the binding');

-- Existing-account preconditions ---------------------------------------------------------
select is(pg_temp.contact('e7210000-0000-4000-8000-000000000010','owner-u@example.test','c-u')->>'recorded','true','provider U contact recorded');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-000000000010','p-u','e7200000-0000-4000-8000-000000000005')$$,
 'P0001','Confirmed account required','an unconfirmed account cannot be named');
select is(pg_temp.contact('e7210000-0000-4000-8000-00000000000b','owner-b@example.test','c-b')->>'recorded','true','provider B contact recorded');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-00000000000b','p-b-wrong','e7200000-0000-4000-8000-000000000003')$$,
 'P0001','Account does not match the confirmed contact','a named account must match the confirmed contact');
select is(pg_temp.contact('e7210000-0000-4000-8000-000000000011','owner-l@example.test','c-v')->>'recorded','true','provider V contact recorded at an address whose account is linked elsewhere');
select throws_ok($$select pg_temp.prepare('e7210000-0000-4000-8000-000000000011','p-v-linked','e7200000-0000-4000-8000-000000000006')$$,
 'P0001','Account already linked to another provider','an account linked to another provider cannot be named');

-- Expiry, closure and release of A ------------------------------------------------------
insert into t values ('b1', pg_temp.prepare('e7210000-0000-4000-8000-00000000000b','p-b-1','e7200000-0000-4000-8000-000000000004'));
update private.r0_provider_access_attempts set expires_at=now()-interval '1 second' where business_key='p-b-1';
select throws_ok(format('select pg_temp.user(4,%L)',format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='b1'))),
 'P0001','Current access invitation required','an expired attempt cannot be accepted');
select is(pg_temp.op(format('select public.r0_close_provider_access(%L,''expired'',''Lapsed'')',(select v->>'attempt_id' from t where k='b1')))->>'changed','true',
 'the operator records the expiry with a reason');
select throws_ok(format('select pg_temp.user(4,%L)',format('select public.r0_accept_provider_access(%L)',(select v->>'attempt_id' from t where k='b1'))),
 'P0001','Current access invitation required','a closed attempt cannot be reused');
select throws_ok($$select pg_temp.op('select public.r0_release_provider_access(''e7210000-0000-4000-8000-00000000000e'',''x'',''rel-e'')')$$,
 'P0001','No access binding to release','an inherited link is not released here');
select is(pg_temp.op('select public.r0_release_provider_access(''e7210000-0000-4000-8000-00000000000a'',''Correction test'',''rel-a'')')->>'vendor_role_removed',
 'true','release removes the setup role this path granted');
select ok(not exists(select 1 from public.user_roles where user_id='e7200000-0000-4000-8000-000000000002' and role='vendor'),'the setup role is gone');
select ok(exists(select 1 from private.r0_provider_access_acceptances where attempt_id=(select (v->>'attempt_id')::uuid from t where k='a1')),
 'the acceptance receipt is preserved after release');
select throws_ok($$update private.r0_provider_access_bindings set reason='x'$$,null,null,'binding decisions are immutable');
select throws_ok($$delete from private.r0_provider_access_events$$,null,null,'access audit events are immutable');

-- Application-based onboarding is unaffected -----------------------------------------
select ok(pg_temp.op('select to_jsonb(public.vendor_prepare_invitation(''e7210000-0000-4000-8000-00000000000c'',''app-c-1'',now()+interval ''7 days''))') is not null,
 'an application provider still prepares its canonical invitation');
select is(pg_temp.op('select public.r0_provider_access_overview(''e7210000-0000-4000-8000-00000000000c'')')->>'application_onboarding','true',
 'the overview reports application onboarding for provider C');
select is(pg_temp.op('select to_jsonb(array_agg(x)) from public.r0_excluded_provider_ids() x'),'["e7210000-0000-4000-8000-00000000000d"]'::jsonb,
 'operators read the archived provider list');
select is(pg_temp.user(3,'select to_jsonb(count(*)) from public.r0_excluded_provider_ids() x'),'0'::jsonb,
 'non-operators read no archived ids');

select * from finish();
rollback;
