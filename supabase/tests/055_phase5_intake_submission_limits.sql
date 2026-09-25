begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-088 synthetic keys only. Each key is the SHA-256 of a synthetic label, never of a
-- real email address. The public intake routes may record at most 3 accepted submissions per
-- email hash per form in any rolling day; the counters are private and only the service key
-- can call the recording function.
create function pg_temp.key(p_label text) returns text language sql as $$
 select encode(extensions.digest('intake-limit-synthetic-' || p_label, 'sha256'), 'hex') $$;
create function pg_temp.record(p_form text, p_label text) returns boolean language sql as $$
 select public.intake_record_submission(p_form, pg_temp.key(p_label), null) = 'accepted' $$;
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
 select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',p_user)::text,true) $$;
create function pg_temp.as_service() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
insert into auth.users(id,email,email_confirmed_at) values
 ('b9f00000-0000-4000-8000-000000000001','intake-limit-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b9f00000-0000-4000-8000-000000000001','admin');

-- Structure.
select has_table('private','intake_submissions','The intake counters table exists in the private schema');
select ok((select relrowsecurity from pg_class where oid='private.intake_submissions'::regclass),
 'Row level security is enabled on the intake counters');
select ok(not exists(select 1 from pg_policies where schemaname='private' and tablename='intake_submissions'),
 'No policy exposes the intake counters');
select ok(not has_schema_privilege('anon','private','USAGE'),'An anonymous caller cannot use the private schema');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'A signed-in caller cannot use the private schema');
select ok(not has_table_privilege('anon','private.intake_submissions','SELECT,INSERT,UPDATE,DELETE'),
 'An anonymous caller holds no privilege on the intake counters');
select ok(not has_table_privilege('authenticated','private.intake_submissions','SELECT,INSERT,UPDATE,DELETE'),
 'A signed-in caller holds no privilege on the intake counters');
select ok(not has_table_privilege('service_role','private.intake_submissions','SELECT,INSERT,UPDATE,DELETE'),
 'The service key holds no direct privilege on the intake counters');
select ok(not exists(select 1 from information_schema.columns where table_schema='private'
 and table_name='intake_submissions' and column_name ilike '%email' ),'The intake counters have no email column');
select ok(not has_function_privilege('anon','public.intake_record_submission(text,text,text)','EXECUTE'),
 'An anonymous caller cannot record an intake submission');
select ok(not has_function_privilege('authenticated','public.intake_record_submission(text,text,text)','EXECUTE'),
 'A signed-in caller cannot record an intake submission');
select ok(has_function_privilege('service_role','public.intake_record_submission(text,text,text)','EXECUTE'),
 'The service key records intake submissions');
select ok((select prosecdef from pg_proc where oid='public.intake_record_submission(text,text,text)'::regprocedure),
 'The recording function runs as its owner');
select is((select proconfig from pg_proc where oid='public.intake_record_submission(text,text,text)'::regprocedure),
 array['search_path=""'],'The recording function has a fixed empty search path');

-- Client roles are refused.
select pg_temp.as_user('b9f00000-0000-4000-8000-000000000001');
set local role anon;
select throws_ok($$select pg_temp.record('contact','anon')$$,'42501',null,'An anonymous caller is refused');
select throws_ok($$select count(*) from private.intake_submissions$$,'42501',null,'An anonymous caller cannot read the counters');
reset role;
set local role authenticated;
select throws_ok($$select pg_temp.record('contact','admin')$$,'42501',null,'A signed-in admin is refused');
select throws_ok($$select count(*) from private.intake_submissions$$,'42501',null,'A signed-in admin cannot read the counters');
reset role;

-- The service key: three per email hash per form, then refused.
select pg_temp.as_service();
set local role service_role;
select ok(pg_temp.record('contact','a'),'First contact submission is accepted');
select ok(pg_temp.record('contact','a'),'Second contact submission is accepted');
select ok(pg_temp.record('contact','a'),'Third contact submission is accepted');
select ok(not pg_temp.record('contact','a'),'Fourth contact submission in a day is refused');
select ok(not pg_temp.record('contact','a'),'A refused submission does not change the outcome');
select ok(pg_temp.record('vendor_application','a'),'The same email is counted separately for the vendor application form');
select ok(pg_temp.record('contact','b'),'Another email has its own contact allowance');
select throws_ok($$select count(*) from private.intake_submissions$$,'42501',null,'The service key cannot read the counters directly');
select throws_ok($$select public.intake_record_submission('newsletter',pg_temp.key('a'),null)$$,'22023',null,'An unknown form is rejected');
select throws_ok($$select public.intake_record_submission(null,pg_temp.key('a'),null)$$,'22023',null,'A missing form is rejected');
select throws_ok($$select public.intake_record_submission('contact','intake-limit-synthetic-a@example.invalid',null)$$,'22023',null,
 'A raw email is rejected as a key');
select throws_ok($$select public.intake_record_submission('contact',upper(pg_temp.key('a')),null)$$,'22023',null,'An uppercase key is rejected');
select throws_ok($$select public.intake_record_submission('contact',null,null)$$,'22023',null,'A missing key is rejected');
reset role;

select is((select count(*) from private.intake_submissions where email_hash=pg_temp.key('a') and form='contact'),3::bigint,
 'Only accepted contact submissions are recorded');
select is((select count(*) from private.intake_submissions where email_hash in (pg_temp.key('a'),pg_temp.key('b'))),5::bigint,
 'Five accepted submissions are recorded in total');

-- The window rolls: submissions older than a day no longer count and are pruned.
insert into private.intake_submissions(form,email_hash,created_at)
 select 'contact',pg_temp.key('c'),now()-interval '1 day 1 minute' from generate_series(1,3);
insert into private.intake_submissions(form,email_hash,created_at)
 select 'contact',pg_temp.key('d'),now()-interval '23 hours' from generate_series(1,3);
set local role service_role;
select ok(pg_temp.record('contact','c'),'Submissions older than a day no longer count');
select ok(not pg_temp.record('contact','d'),'Submissions within the last day still count');
reset role;
select is((select count(*) from private.intake_submissions where created_at < now()-interval '1 day'),0::bigint,
 'Rows older than a day are pruned when a submission is recorded');
select is((select count(*) from private.intake_submissions where email_hash=pg_temp.key('d')),3::bigint,
 'Rows within the last day are kept');

select * from finish();
rollback;
