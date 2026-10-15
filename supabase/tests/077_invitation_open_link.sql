begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- DEC-2026-029 follow-up: a Mercurius invitation link valid for the whole invitation.
-- vendor-invite records one key hash per reserved dispatch; /api/invitations/open checks it
-- against a live attempt before minting a sign-in. Synthetic identities only; rolls back.

-- 1 operator; 2 existing-provider recipient; 3 application recipient; 4 unrelated provider's recipient.
insert into auth.users(id,email,email_confirmed_at,invited_at,raw_user_meta_data) values
 ('e7700000-0000-4000-8000-000000000001','open-operator@example.invalid',now(),null,'{}');
insert into public.user_roles(user_id,role) values ('e7700000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,bio,services,is_active,marketing_enabled,user_id) values
 ('e7710000-0000-4000-8000-00000000000a','Synthetic Open Legacy A','Real description','{lawn-mowing}',true,true,null),
 ('e7710000-0000-4000-8000-00000000000b','Synthetic Open Legacy B','Real description','{lawn-mowing}',true,true,null),
 ('e7710000-0000-4000-8000-00000000000c','Synthetic Open Applicant C',null,'{}',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('e7720000-0000-4000-8000-000000000001','Synthetic Open Applicant C','Test','Applicant','open-applicant@example.invalid','synthetic','e7710000-0000-4000-8000-00000000000c');

create function pg_temp.operator() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"e7700000-0000-4000-8000-000000000001"}',true) $$;
create function pg_temp.hash(p_key text) returns text language sql as $$
 select encode(extensions.digest(p_key,'sha256'),'hex') $$;
create function pg_temp.open(p_source text, p_attempt uuid, p_key text) returns jsonb language sql as $$
 select public.provider_invitation_open(p_source,p_attempt,pg_temp.hash(p_key)) $$;
-- Contact, prepare and reserve an existing-provider access invitation as the operator.
create function pg_temp.reserve(p_contractor uuid, p_email text, p_key text) returns uuid language plpgsql as $$
declare attempt uuid;
begin
 perform pg_temp.operator();
 perform public.r0_record_provider_contact(p_contractor,p_email,'Owner confirmed mapping (synthetic)','R0 access','c-'||p_key);
 attempt:=(public.r0_prepare_provider_access(p_contractor,'p-'||p_key,now()+interval '7 days',null)->>'attempt_id')::uuid;
 perform public.r0_claim_provider_access(attempt);
 return attempt;
end $$;
create temp table t(k text primary key, id uuid);

-- Least privilege ---------------------------------------------------------------------
select ok(not has_table_privilege(r,'private.'||tbl,'SELECT') and not has_table_privilege(r,'private.'||tbl,'INSERT'),
 format('%s cannot touch %s',r,tbl))
 from unnest(array['anon','authenticated','service_role']) r,
      unnest(array['provider_invitation_open_keys','provider_invitation_opens']) tbl;
select ok(has_function_privilege('service_role',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE')
  and not has_function_privilege('anon',f,'EXECUTE'),'service key only: '||f)
 from unnest(array['public.provider_invitation_set_open_key(text,uuid,text)','public.provider_invitation_open(text,uuid,text)']) f;
select ok(not has_function_privilege(r,'private.provider_invitation_open_limit()','EXECUTE'),
 format('%s cannot execute the private open limit',r)) from unnest(array['anon','authenticated','service_role']) r;

-- Recording the key ---------------------------------------------------------------------
insert into t values ('a', pg_temp.reserve('e7710000-0000-4000-8000-00000000000a','open-owner-a@example.invalid','a'));
select throws_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','existing_provider',(select id from t where k='a'),'not-a-hash'),
 '22023','Invalid invitation open key','a malformed hash is refused');
select throws_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','legacy',(select id from t where k='a'),pg_temp.hash('key-a')),
 '22023','Invalid invitation open key','an unknown source is refused');
select throws_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','application',(select id from t where k='a'),pg_temp.hash('key-a')),
 'P0001','An open key needs a reserved, unsent dispatch','the key must name the attempt''s own source');
select lives_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','existing_provider',(select id from t where k='a'),pg_temp.hash('key-a')),
 'the claiming request records the key for its reserved dispatch');
select throws_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','existing_provider',(select id from t where k='a'),pg_temp.hash('key-a2')),
 '23505',null,'a second key for the same attempt is refused');
select is((select key_hash from private.provider_invitation_open_keys where attempt_id=(select id from t where k='a')),pg_temp.hash('key-a'),
 'only the hash is stored, and the first key stands');

-- Opening ---------------------------------------------------------------------------------
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','a link opens nothing before Auth accepts the invitation');
insert into auth.users(id,email,invited_at,raw_user_meta_data)
 values ('e7700000-0000-4000-8000-000000000002','open-owner-a@example.invalid',now(),'{}');
select lives_ok(format('select public.r0_finish_provider_access(%L,%L,%L)',(select id from t where k='a'),
 'e7700000-0000-4000-8000-000000000002','e7700000-0000-4000-8000-000000000001'),'Auth accepted the invitation');
select throws_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','existing_provider',(select id from t where k='a'),pg_temp.hash('key-late')),
 'P0001','An open key needs a reserved, unsent dispatch','no key can be added once Auth has the invitation');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'wrong-key'),
 'P0001','Invitation link not valid','a wrong key is refused');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','application',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','the right key under another source is refused');
select is(pg_temp.open('existing_provider',(select id from t where k='a'),'key-a'),
 '{"email": "open-owner-a@example.invalid", "auth_user_id": "e7700000-0000-4000-8000-000000000002"}'::jsonb,
 'the right key returns the invited recipient');
select is((select count(*)::int from private.provider_invitation_opens where attempt_id=(select id from t where k='a')),1,'the open is recorded');

-- The link outlives the 24-hour Auth link, up to the invitation's own expiry.
update private.r0_provider_access_dispatches set resolved_at=now()-interval '3 days',started_at=now()-interval '3 days'
 where attempt_id=(select id from t where k='a');
select lives_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'three days after the email the link still opens');
select pg_temp.operator();
select isnt((select item->>'attention' from jsonb_array_elements(public.r0_provider_access_queue()->'items') item
  where item->>'contractor_id'='e7710000-0000-4000-8000-00000000000a'),'link_lapsed',
 'an attempt with an open link is not reported as a lapsed link');
update private.r0_provider_access_attempts set expires_at=now()-interval '1 minute' where id=(select id from t where k='a');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','an expired invitation''s link is refused');
update private.r0_provider_access_attempts set expires_at=now()+interval '4 days' where id=(select id from t where k='a');

-- The recipient's address must still be the invited one.
update auth.users set email='changed@example.invalid' where id='e7700000-0000-4000-8000-000000000002';
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','a recipient whose address changed is refused');
update auth.users set email='open-owner-a@example.invalid' where id='e7700000-0000-4000-8000-000000000002';

-- Hourly limit: 10 opens per link per rolling hour (2 so far).
select lives_ok(format('select pg_temp.open(%L,%L,%L) from generate_series(1,8)','existing_provider',(select id from t where k='a'),'key-a'),
 'opens up to the hourly limit succeed');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','the eleventh open within an hour is refused');
select is((select count(*)::int from private.provider_invitation_opens where attempt_id=(select id from t where k='a')),10,
 'a refused open is not recorded');
update private.provider_invitation_opens set opened_at=now()-interval '61 minutes' where attempt_id=(select id from t where k='a');
select lives_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'the limit is a rolling hour');

-- Acceptance ends the link.
update auth.users set email_confirmed_at=now() where id='e7700000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e7700000-0000-4000-8000-000000000002"}',true);
select is(public.r0_accept_provider_access((select id from t where k='a'))->>'recorded','true','the recipient accepts');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','existing_provider',(select id from t where k='a'),'key-a'),
 'P0001','Invitation link not valid','an accepted invitation''s link is refused');

-- Without a key (dispatched before this change) the lapsed-link attention still applies.
insert into t values ('b', pg_temp.reserve('e7710000-0000-4000-8000-00000000000b','open-owner-b@example.invalid','b'));
insert into auth.users(id,email,invited_at,raw_user_meta_data)
 values ('e7700000-0000-4000-8000-000000000004','open-owner-b@example.invalid',now(),'{}');
select public.r0_finish_provider_access((select id from t where k='b'),'e7700000-0000-4000-8000-000000000004','e7700000-0000-4000-8000-000000000001');
update private.r0_provider_access_dispatches set resolved_at=now()-interval '2 days' where attempt_id=(select id from t where k='b');
select pg_temp.operator();
select is((select item->>'attention' from jsonb_array_elements(public.r0_provider_access_queue()->'items') item
  where item->>'contractor_id'='e7710000-0000-4000-8000-00000000000b'),'link_lapsed',
 'an attempt without an open link still reports its lapsed 24-hour Auth link');

-- Application invitations: the same rules through the TRACE-063 commands.
select pg_temp.operator();
select public.vendor_begin_review('e7710000-0000-4000-8000-00000000000c',
 (select id from public.vendor_application_versions where application_id='e7720000-0000-4000-8000-000000000001' order by revision desc limit 1));
insert into t values ('c', public.vendor_prepare_invitation('e7710000-0000-4000-8000-00000000000c','open-app-c',now()+interval '7 days'));
select public.vendor_claim_invitation((select id from t where k='c'));
select lives_ok(format('select public.provider_invitation_set_open_key(%L,%L,%L)','application',(select id from t where k='c'),pg_temp.hash('key-c')),
 'an application dispatch records its key');
insert into auth.users(id,email,invited_at,raw_user_meta_data)
 values ('e7700000-0000-4000-8000-000000000003','open-applicant@example.invalid',clock_timestamp(),'{}');
select public.vendor_finish_invitation((select id from t where k='c'),'e7700000-0000-4000-8000-000000000003');
select is(pg_temp.open('application',(select id from t where k='c'),'key-c')->>'auth_user_id','e7700000-0000-4000-8000-000000000003',
 'an application link returns its recipient');
update public.vendor_invitation_dispatches set resolved_at=now()-interval '2 days' where attempt_id=(select id from t where k='c');
select pg_temp.operator();
select ok(not exists(select 1 from jsonb_array_elements(public.r0_invitation_attention()->'items') item
  where item->>'attempt_id'=(select id::text from t where k='c') and item->>'reason'='link_lapsed'),
 'an application attempt with an open link is not reported as a lapsed link');
update auth.users set email_confirmed_at=now() where id='e7700000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e7700000-0000-4000-8000-000000000003"}',true);
select lives_ok(format('select public.vendor_accept_invitation(%L)',(select id from t where k='c')),'the applicant accepts');
select throws_ok(format('select pg_temp.open(%L,%L,%L)','application',(select id from t where k='c'),'key-c'),
 'P0001','Invitation link not valid','an accepted application invitation''s link is refused');

select * from finish();
rollback;
