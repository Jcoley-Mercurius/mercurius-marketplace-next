-- TRACE-102: R0 early-access/expansion interest, independent marketing consent, verified
-- account linkage, update/withdrawal/suppression and R2+90-day list-only retention.
-- Synthetic identities only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 confirmed homeowner, 2 unconfirmed homeowner, 3 admin operator, 4 admin (not operator),
-- 5 confirmed homeowner holding an older linked interest, 6 confirmed homeowner B.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e6900000-0000-4000-8000-000000000001','verified.one@example.test',now(),'{}'),
 ('e6900000-0000-4000-8000-000000000002','pending.two@example.test',null,'{}'),
 ('e6900000-0000-4000-8000-000000000003','operator@example.test',now(),'{}'),
 ('e6900000-0000-4000-8000-000000000004','admin@example.test',now(),'{}'),
 ('e6900000-0000-4000-8000-000000000005','merge.five@example.test',now(),'{}'),
 ('e6900000-0000-4000-8000-000000000006','other.six@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e6900000-0000-4000-8000-000000000003','admin'),
 ('e6900000-0000-4000-8000-000000000004','admin');
insert into private.r0_trial_operators(user_id,reason)
 values ('e6900000-0000-4000-8000-000000000003','Synthetic operator');

-- Runs one statement as a role with JWT claims, as PostgREST would.
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
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$
 select pg_temp.run(null,'service_role',p_sql) $$;
create function pg_temp.join(p_kind text,p_email text,p_zip text,p_services text[],
 p_exploring boolean,p_marketing boolean,p_first text default null) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.r0_submit_interest(%L,%L,%L,%L,%L::text[],%L,%L)',
 p_kind,p_email,p_first,p_zip,p_services,p_exploring,p_marketing)) $$;
create function pg_temp.interest(p_email text,p_kind text default 'early_access')
returns private.r0_interests language sql as $$
 select * from private.r0_interests where kind=p_kind
 and email_hash=encode(extensions.digest(lower(p_email),'sha256'),'hex') $$;
create function pg_temp.hash(p_email text) returns text language sql as $$
 select encode(extensions.digest(lower(p_email),'sha256'),'hex') $$;

-- Least privilege and minimal collection.
select ok(not has_table_privilege(r,t,'SELECT') and not has_table_privilege(r,t,'INSERT'),
 format('%s has no direct access to %s',r,t))
 from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.r0_interests','private.r0_marketing_preferences',
 'private.r0_email_suppressions','private.r0_link_tokens','private.r0_interest_events',
 'private.r0_release_events','private.r0_retention_runs']) t;
select ok(not has_function_privilege(r,'public.r0_submit_interest(text,text,text,text,text[],boolean,boolean)','EXECUTE'),
 format('%s cannot call the public-form command directly',r))
 from unnest(array['anon','authenticated']) r;
select ok(not has_function_privilege(r,f,'EXECUTE'), format('%s cannot call %s',r,f))
 from unnest(array['anon','authenticated']) r,
 unnest(array['public.r0_manage_interest(text,text,text,text,text[],boolean)',
 'public.r0_unsubscribe_marketing(text)','public.r0_issue_link_token(text,text,text)',
 'public.r0_email_allowed(text,text)','public.r0_record_email_suppression(text,text,text)',
 'public.r0_zip_in_lee(text)']) f;
select ok(not has_function_privilege('anon','public.r0_my_interest()','EXECUTE'),
 'anonymous visitor has no account interest command');
select ok(not has_function_privilege('service_role','public.r0_record_r2_opening(timestamptz,text)','EXECUTE'),
 'service key cannot record the R2 opening');
select ok(not has_function_privilege('authenticated','private.r0_deidentify(uuid,text,uuid)','EXECUTE'),
 'browser cannot reach private helpers');
select is(array(select column_name::text from information_schema.columns
 where table_schema='private' and table_name='r0_interests'
 and column_name ~ '(phone|address|street|photo|payment|card|sms)'), '{}'::text[],
 'interest record has no phone, address, photo, payment or SMS field');

-- Public form: Lee boundary, content rules and honest outcomes.
select is(pg_temp.join('early_access','  List.Only@Example.TEST ','33901','{lawn-mowing}',false,false,' Pat '),
 '{"outcome":"saved"}','Lee ZIP early-access interest is saved');
select is((pg_temp.interest('list.only@example.test')).email,'list.only@example.test',
 'email is normalized');
select is((pg_temp.interest('list.only@example.test')).first_name,'Pat','first name is trimmed');
select ok((pg_temp.interest('list.only@example.test')).user_id is null,'form join creates no account link');
select ok(not exists(select 1 from private.r0_marketing_preferences
 where email_hash=pg_temp.hash('list.only@example.test')),'unchecked marketing records no consent');
select is(pg_temp.join('early_access','outside@example.test','10001','{}',true,false),
 '{"outcome":"boundary"}','out-of-Lee early access gets the boundary outcome');
select ok((pg_temp.interest('outside@example.test')).id is null,'boundary saves nothing');
select is(pg_temp.join('expansion','inside@example.test','33901','{}',true,false),
 '{"outcome":"boundary"}','expansion interest refuses a Lee ZIP');
select is(pg_temp.join('expansion','outside@example.test','10001','{}',true,false),
 '{"outcome":"saved"}','separate expansion interest accepts another ZIP');
select throws_ok($$select pg_temp.join('early_access','both@example.test','33901','{lawn-mowing}',true,false)$$,
 '22023',null,'services and still exploring are exclusive');
select throws_ok($$select pg_temp.join('early_access','none@example.test','33901','{}',false,false)$$,
 '22023',null,'an interest or still exploring is required');
select throws_ok($$select pg_temp.join('early_access','bad@example.test','33901','{not-a-service}',false,false)$$,
 '22023',null,'unknown services are refused');
select throws_ok($$select pg_temp.join('early_access','not-an-email','33901','{}',true,false)$$,
 '22023',null,'invalid email is refused');
select throws_ok($$select pg_temp.join('early_access','x@example.test','3390','{}',true,false)$$,
 '22023',null,'non-five-digit ZIP is refused');
select throws_ok($$select pg_temp.svc('select public.r0_submit_interest(''early_access'',''n@example.test'',null,''33901'',''{}''::text[],true,null)')$$,
 '22023',null,'marketing choice must be explicit');

-- Deduplication: the anonymous form never overwrites an existing live interest.
select is(pg_temp.join('early_access','LIST.ONLY@example.test','33908','{}',true,false,'Other'),
 '{"outcome":"saved"}','duplicate join gets the same response');
select is((select count(*) from private.r0_interests where email_hash=pg_temp.hash('list.only@example.test')),
 1::bigint,'no duplicate interest is created');
select is((pg_temp.interest('list.only@example.test')).zip_code,'33901',
 'anonymous duplicate cannot change the stored ZIP');

-- Independent marketing consent.
select is(pg_temp.join('early_access','market@example.test','33901','{}',true,true),
 '{"outcome":"saved"}','join with marketing opt-in');
select ok((select opted_in from private.r0_marketing_preferences where email_hash=pg_temp.hash('market@example.test')),
 'checked choice records marketing consent');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('market@example.test','marketing'))$$),
 'true','opted-in address may receive marketing');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('list.only@example.test','marketing'))$$),
 'false','early-access interest alone does not permit marketing');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('list.only@example.test','early_access'))$$),
 'true','live interest may receive early-access status mail');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('nobody@example.test','early_access'))$$),
 'false','unknown address receives no early-access mail');

-- Promotional unsubscribe and suppression.
create temp table tokens(name text primary key, token text);
insert into tokens select 'unsub', pg_temp.svc(
 $$select to_jsonb(public.r0_issue_link_token('unsubscribe','market@example.test'))$$)#>>'{}';
select ok((select token from tokens where name='unsub') ~ '^[0-9a-f]{64}$','unsubscribe link token issued');
select ok(not exists(select 1 from private.r0_link_tokens where token_hash=(select token from tokens where name='unsub')),
 'raw token is not stored');
select is(pg_temp.svc(format('select public.r0_unsubscribe_marketing(%L)',(select token from tokens where name='unsub'))),
 '{"outcome":"unsubscribed"}','unsubscribe link ends marketing consent');
select is(pg_temp.svc(format('select public.r0_unsubscribe_marketing(%L)',(select token from tokens where name='unsub'))),
 '{"outcome":"unsubscribed"}','unsubscribe is idempotent');
select ok((select email is null and not opted_in from private.r0_marketing_preferences
 where email_hash=pg_temp.hash('market@example.test')),'opted-out preference keeps no plaintext email');
select ok(exists(select 1 from private.r0_email_suppressions
 where email_hash=pg_temp.hash('market@example.test') and scope='marketing'),'unsubscribe suppresses marketing');
select is(pg_temp.join('early_access','market@example.test','33901','{}',true,true),
 '{"outcome":"saved"}','later anonymous join still saves');
select ok(not (select opted_in from private.r0_marketing_preferences where email_hash=pg_temp.hash('market@example.test')),
 'anonymous form cannot lift an unsubscribe');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('market@example.test','early_access'))$$),
 'true','marketing unsubscribe does not stop early-access status mail');
select is(pg_temp.svc($$select to_jsonb(public.r0_issue_link_token('unsubscribe','market@example.test'))$$),
 null,'no unsubscribe link for an address that is not opted in');
select is(pg_temp.svc($$select public.r0_unsubscribe_marketing('not-a-token')$$),
 '{"outcome":"invalid"}','malformed unsubscribe token is refused');

-- Email-link management: read, update, boundary, withdraw.
insert into tokens select 'manage', pg_temp.svc(
 $$select to_jsonb(public.r0_issue_link_token('manage','list.only@example.test','early_access'))$$)#>>'{}';
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''read'')',(select token from tokens where name='manage')))#>>'{interest,zip_code}',
 '33901','manage link reads its interest');
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''update'',''Pat'',''10001'',''{}''::text[],true)',
 (select token from tokens where name='manage')))->>'outcome','boundary','manage link cannot move early access outside Lee');
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''update'',null,''33908'',''{carpet-cleaning}''::text[],false)',
 (select token from tokens where name='manage')))#>>'{interest,service_ids,0}','carpet-cleaning','manage link updates interests');
select ok((pg_temp.interest('list.only@example.test')).first_name is null,'first name can be cleared');
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''read'')',repeat('0',64))),
 '{"outcome":"invalid"}','unknown manage token reveals nothing');
select is(pg_temp.svc($$select to_jsonb(public.r0_issue_link_token('manage','nobody@example.test','early_access'))$$),
 null,'no manage link for an address without interest');

-- Holds keep a withdrawn record; releasing the hold lets retention remove it.
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000004','authenticated',
 'select public.r0_set_interest_hold(''list.only@example.test'',''early_access'',true,''Privacy request review'')')$$,
 '42501',null,'admin outside the R0 operator roster cannot place holds');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_set_interest_hold('list.only@example.test','early_access',true,'Privacy request review')$$),
 '{"outcome":"held"}','operator places a legitimate hold');
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''withdraw'')',(select token from tokens where name='manage'))),
 '{"outcome":"withdrawn_held"}','held withdrawal is recorded but retained');
select is((pg_temp.interest('list.only@example.test')).status,'withdrawn','held record is withdrawn, not live');
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('list.only@example.test','early_access'))$$),
 'false','withdrawn interest receives no early-access mail');
select is(pg_temp.svc(format('select public.r0_manage_interest(%L,''read'')',(select token from tokens where name='manage'))),
 '{"outcome":"invalid"}','withdrawn interest is no longer manageable');
select is(pg_temp.join('early_access','list.only@example.test','33901','{}',true,false),
 '{"outcome":"saved"}','anonymous rejoin of a held withdrawal gets the usual answer');
select is((pg_temp.interest('list.only@example.test')).status,'withdrawn',
 'anonymous form cannot reverse a withdrawal');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_set_interest_hold('list.only@example.test','early_access',false,'Review complete')$$),
 '{"outcome":"released"}','operator releases the hold');

-- Retention before R2: only released withdrawals are removed; the pass is recorded.
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated',
 'select public.r0_run_interest_retention(100)')$$,'42501',null,'homeowner cannot run retention');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_run_interest_retention(100)$$)->>'deidentified','1',
 'pre-R2 pass removes only the released withdrawal');
select ok((select status='deidentified' and email is null and email_hash is null and first_name is null
 from private.r0_interests where zip_code='33908' and service_ids='{carpet-cleaning}'),
 'withdrawn interest is de-identified');
select ok(not exists(select 1 from private.r0_link_tokens t join private.r0_interests i on i.id=t.interest_id
 where i.status='deidentified'),'de-identification removes its link tokens');
select ok((pg_temp.interest('outside@example.test','expansion')).status='active',
 'live list-only interest is kept before R2');
select is((select count(*) from private.r0_retention_runs where r2_opened_at is null),1::bigint,
 'the pre-R2 pass is observable');

-- Verified account linkage and deduplication.
select is(pg_temp.join('early_access','VERIFIED.ONE@example.test','33901','{ac-maintenance}',false,false),
 '{"outcome":"saved"}','list-only interest before account creation');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000002','authenticated','select public.r0_my_interest()'),
 '{"verified":false}','unconfirmed account sees only its verification state');
select is(pg_temp.join('early_access','pending.two@example.test','33901','{}',true,false),
 '{"outcome":"saved"}','list-only interest matching an unconfirmed account');
select ok((pg_temp.interest('pending.two@example.test')).user_id is null,'unconfirmed account links nothing');
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000002','authenticated',
 'select public.r0_save_my_interest(''early_access'',null,''33901'',''{}''::text[],true)')$$,
 '42501',null,'unconfirmed account cannot save interest');
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000002','authenticated',
 'select public.r0_set_my_marketing(true)')$$,'42501',null,'unconfirmed account cannot opt in');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated','select public.r0_my_interest()')#>>'{interests,0,linked}',
 'true','confirmed account links its email-matched interest');
select is((pg_temp.interest('verified.one@example.test')).user_id,'e6900000-0000-4000-8000-000000000001'::uuid,
 'link binds the verified account');
select is(jsonb_array_length(pg_temp.run('e6900000-0000-4000-8000-000000000006','authenticated','select public.r0_my_interest()')->'interests'),
 0,'another account sees none of it');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated',
 $$select public.r0_save_my_interest('early_access','Sam','33908','{appliance-repair}'::text[],false)$$)#>>'{interest,zip_code}',
 '33908','account holder edits the linked interest');
select is((select count(*) from private.r0_interests where user_id='e6900000-0000-4000-8000-000000000001'),
 1::bigint,'editing keeps one interest per account and kind');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated',
 $$select public.r0_save_my_interest('early_access',null,'10001','{}'::text[],true)$$),
 '{"outcome":"boundary"}','account holder gets the Lee boundary outcome');
-- Account 5 already holds a linked interest from an earlier email; its current email also
-- has an unlinked list-only interest. Linking keeps one identity.
insert into private.r0_interests(kind,email,email_hash,zip_code,still_exploring,user_id,linked_at)
 values ('early_access','old.five@example.test',pg_temp.hash('old.five@example.test'),'33901',true,
 'e6900000-0000-4000-8000-000000000005',now());
select is(pg_temp.join('early_access','merge.five@example.test','33901','{}',true,false),
 '{"outcome":"saved"}','list-only duplicate of an account holder');
select is(jsonb_array_length(pg_temp.run('e6900000-0000-4000-8000-000000000005','authenticated','select public.r0_my_interest()')->'interests'),
 1,'account keeps a single early-access interest');
select ok((pg_temp.interest('merge.five@example.test')).id is null,'unlinked duplicate is removed');
select ok(exists(select 1 from private.r0_interest_events where action='merged'
 and actor_id='e6900000-0000-4000-8000-000000000005'),'merge is audited');

-- Verified account consent lifts only its own marketing unsubscribe.
update auth.users set email='market@example.test' where id='e6900000-0000-4000-8000-000000000006';
select is(pg_temp.run('e6900000-0000-4000-8000-000000000006','authenticated','select public.r0_set_my_marketing(true)'),
 '{"marketing_opted_in":true}','verified account holder can opt back in');
select ok(not exists(select 1 from private.r0_email_suppressions where email_hash=pg_temp.hash('market@example.test')
 and scope='marketing'),'verified opt-in lifts the marketing suppression');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000006','authenticated','select public.r0_set_my_marketing(false)'),
 '{"marketing_opted_in":false}','account holder opts out');
select ok(exists(select 1 from private.r0_email_suppressions where email_hash=pg_temp.hash('market@example.test')
 and reason='account'),'account opt-out suppresses marketing');

-- Provider reasons survive consent revocation for either scope, including retries.
create temp table provider_cases as
 select scope, reason, scope || '.' || reason || '@example.test' as email
 from unnest(array['marketing','all']) scope,
      unnest(array['bounce','complaint','operator']) reason;
select private.r0_set_marketing(email,true,'early_access_form',null,false,'public_form')
 from provider_cases;
select pg_temp.svc(format('select to_jsonb(public.r0_record_email_suppression(%L,%L,%L))',
 email,scope,reason)) from provider_cases;
select pg_temp.svc(format('select to_jsonb(public.r0_record_email_suppression(%L,%L,%L))',
 email,scope,reason)) from provider_cases;
select is((select s.reason from private.r0_email_suppressions s
 where s.email_hash=pg_temp.hash(c.email) and s.scope=c.scope), c.reason,
 format('%s/%s preserves the requested suppression reason on retry',c.scope,c.reason))
 from provider_cases c;
select is((select s.reason from private.r0_email_suppressions s
 where s.email_hash=pg_temp.hash(c.email) and s.scope='marketing'), c.reason,
 format('%s/%s preserves the provider reason for marketing',c.scope,c.reason))
 from provider_cases c;
select ok((select not opted_in and email is null and source='provider'
 from private.r0_marketing_preferences where email_hash=pg_temp.hash(c.email)),
 format('%s/%s ends consent and clears the address',c.scope,c.reason))
 from provider_cases c;
select is((select count(*) from private.r0_email_suppressions s
 where s.email_hash=pg_temp.hash(c.email)), case when c.scope='all' then 2 else 1 end::bigint,
 format('%s/%s creates only the intended suppression scopes',c.scope,c.reason))
 from provider_cases c;

-- Provider suppression ('all') stops every mail class and ends consent.
select pg_temp.svc($$select to_jsonb(public.r0_record_email_suppression('outside@example.test','all','complaint'))$$);
select is(pg_temp.svc($$select to_jsonb(public.r0_email_allowed('outside@example.test','early_access'))$$),
 'false','complaint suppresses early-access mail');
select is(pg_temp.svc($$select to_jsonb(public.r0_issue_link_token('manage','outside@example.test','expansion'))$$),
 null,'no new email link for a fully suppressed address');
select throws_ok($$select pg_temp.svc('select to_jsonb(public.r0_record_email_suppression(''a@example.test'',''all'',''unsubscribe''))')$$,
 '22023',null,'suppression reasons are constrained');

-- R2 opening: operator only, once, never in the future.
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000004','authenticated',
 'select public.r0_record_r2_opening(now(),''Owner decision'')')$$,'42501',null,
 'admin outside the roster cannot record R2');
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 'select public.r0_record_r2_opening(now() + interval ''1 day'',''Owner decision'')')$$,'22023',null,
 'R2 cannot be recorded in the future');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_record_r2_opening(now() - interval '91 days','Synthetic owner decision')$$)->>'retention_due_at' is not null,
 true,'operator records the actual R2 opening');
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 'select public.r0_record_r2_opening(now() - interval ''1 day'',''Second attempt'')')$$,'23505',null,
 'R2 opening is recorded only once');

-- Retention after R2 + 90 days: list-only removed, account-linked and held kept.
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_set_interest_hold('pending.two@example.test','early_access',true,'Legal hold')$$),
 '{"outcome":"held"}','hold on one list-only record');
select is(pg_temp.svc('select public.r0_run_interest_retention(1000)')->>'held','1',
 'service-key pass reports the held record');
select ok(not exists(select 1 from private.r0_interests where user_id is null and status<>'deidentified'
 and hold_reason is null),'every unheld list-only interest is de-identified after R2 + 90 days');
select ok((pg_temp.interest('pending.two@example.test')).status='active','held list-only interest is kept');
select is((select count(*) from private.r0_interests where user_id is not null and status='active'),2::bigint,
 'account-linked interests are kept');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 'select public.r0_interest_retention_status()')->>'held','1','status reports held records');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 'select public.r0_interest_retention_status()')#>>'{last_run,actor}','service','status reports the last pass');
select throws_ok($$select pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated',
 'select public.r0_interest_retention_status()')$$,'42501',null,'homeowner cannot read retention status');
select ok(not exists(select 1 from private.r0_interest_events e
 where to_jsonb(e)::text ~* '@example'),'audit events hold no email');

-- Verified withdrawal and account deletion.
select is(pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated',
 $$select public.r0_withdraw_my_interest('early_access')$$),'{"outcome":"withdrawn"}',
 'account holder withdraws');
select is(jsonb_array_length(pg_temp.run('e6900000-0000-4000-8000-000000000001','authenticated','select public.r0_my_interest()')->'interests'),
 0,'withdrawn account interest is removed from the account');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_set_interest_hold('old.five@example.test','early_access',true,'Privacy review')$$),
 '{"outcome":"held"}','hold on an account-linked interest');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000005','authenticated',
 $$select public.r0_withdraw_my_interest('early_access')$$),'{"outcome":"withdrawn_held"}',
 'held account withdrawal is kept');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000003','authenticated',
 $$select public.r0_set_interest_hold('old.five@example.test','early_access',false,'Review complete')$$),
 '{"outcome":"released"}','hold released');
select is(pg_temp.svc('select public.r0_run_interest_retention(10)')->>'deidentified','1',
 'retention removes a released account-linked withdrawal');
select is(pg_temp.run('e6900000-0000-4000-8000-000000000005','authenticated',
 $$select public.r0_save_my_interest('expansion',null,'10001','{}'::text[],true)$$)->>'outcome','saved',
 'account holder saves expansion interest');
delete from auth.users where id='e6900000-0000-4000-8000-000000000005';
select ok(not exists(select 1 from private.r0_interests where email_hash=pg_temp.hash('merge.five@example.test')),
 'account deletion removes its linked interest');

-- The public route's limiter accepts the early-access form.
select is(pg_temp.svc(format('select to_jsonb(public.intake_record_submission(''early_access'',%L,null))',
 pg_temp.hash('limit@example.test'))),'"accepted"','intake limiter records early-access submissions');

select * from finish();
rollback;
