begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-089 synthetic keys only. Each key is the SHA-256 of a synthetic label, never of a
-- real email or IP address. Each form accepts at most 5 submissions per network hash in any
-- rolling hour, alongside 3 per email hash per rolling day; a null network skips that limit.
create function pg_temp.key(p_label text) returns text language sql as $$
 select encode(extensions.digest('intake-ip-synthetic-' || p_label, 'sha256'), 'hex') $$;
create function pg_temp.record(p_form text, p_email text, p_net text) returns text language sql as $$
 select public.intake_record_submission(p_form, pg_temp.key(p_email),
   case when p_net is null then null else pg_temp.key('net-' || p_net) end) $$;
create function pg_temp.as_service() returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- Structure.
select has_column('private','intake_submissions','ip_hash','The intake counters have a network key column');
select col_is_null('private','intake_submissions','ip_hash','The network key is optional');
select ok(not exists(select 1 from information_schema.columns where table_schema='private'
 and table_name='intake_submissions' and column_name in ('ip','ip_address','address')),
 'The intake counters have no raw address column');
select hasnt_function('public','intake_record_submission',array['text','text'],
 'The boolean two-argument recording function is gone');
select is((select prorettype::regtype::text from pg_proc
 where oid='public.intake_record_submission(text,text,text)'::regprocedure),'text',
 'The recording function names the outcome');
select ok(not has_function_privilege('anon','public.intake_record_submission(text,text,text)','EXECUTE'),
 'An anonymous caller cannot record an intake submission');
select ok(not has_function_privilege('authenticated','public.intake_record_submission(text,text,text)','EXECUTE'),
 'A signed-in caller cannot record an intake submission');

select pg_temp.as_service();
set local role service_role;

-- Five per network per form per hour, whatever the email.
select is(pg_temp.record('contact','e1','n1'),'accepted','First submission from a network is accepted');
select is(pg_temp.record('contact','e2','n1'),'accepted','Second is accepted');
select is(pg_temp.record('contact','e3','n1'),'accepted','Third is accepted');
select is(pg_temp.record('contact','e4','n1'),'accepted','Fourth is accepted');
select is(pg_temp.record('contact','e5','n1'),'accepted','Fifth is accepted');
select is(pg_temp.record('contact','e6','n1'),'ip_limit','A sixth from the network in an hour is refused, even with a new email');
select is(pg_temp.record('vendor_application','e6','n1'),'accepted','The network is counted separately for the application form');
select is(pg_temp.record('contact','e6','n2'),'accepted','Another network has its own allowance');
select is(pg_temp.record('contact','e7',null),'accepted','An unknown network skips the network limit');

-- The email limit still applies and is reported first.
select is(pg_temp.record('contact','e8','n3'),'accepted','Email e8 first');
select is(pg_temp.record('contact','e8','n4'),'accepted','Email e8 second, from another network');
select is(pg_temp.record('contact','e8',null),'accepted','Email e8 third, network unknown');
select is(pg_temp.record('contact','e8','n5'),'email_limit','A fourth for the email in a day is refused from a fresh network');
select is(pg_temp.record('contact','e8','n1'),'email_limit','When both limits are reached the email limit is reported');

select throws_ok($$select public.intake_record_submission('contact',pg_temp.key('e9'),'203.0.113.7')$$,'22023',null,
 'A raw address is rejected as a network key');
select throws_ok($$select public.intake_record_submission('contact',pg_temp.key('e9'),upper(pg_temp.key('n9')))$$,'22023',null,
 'An uppercase network key is rejected');
select throws_ok($$select public.intake_record_submission('contact',pg_temp.key('e9'),'')$$,'22023',null,
 'An empty network key is rejected');
reset role;

select is((select count(*) from private.intake_submissions where ip_hash=pg_temp.key('net-n1') and form='contact'),5::bigint,
 'Refusals record nothing against the network');
select is((select count(*) from private.intake_submissions where email_hash=pg_temp.key('e8')),3::bigint,
 'Refusals record nothing against the email');
select is((select count(*) from private.intake_submissions where email_hash=pg_temp.key('e9')),0::bigint,
 'Rejected keys record nothing');

-- The network window is one hour; older rows still count toward the email's day.
insert into private.intake_submissions(form,email_hash,ip_hash,created_at)
 select 'contact',pg_temp.key('old-'||g),pg_temp.key('net-n6'),now()-interval '61 minutes' from generate_series(1,5) g;
insert into private.intake_submissions(form,email_hash,ip_hash,created_at)
 select 'contact',pg_temp.key('recent-'||g),pg_temp.key('net-n7'),now()-interval '59 minutes' from generate_series(1,5) g;
insert into private.intake_submissions(form,email_hash,ip_hash,created_at)
 select 'contact',pg_temp.key('e10'),pg_temp.key('net-n8'),now()-interval '2 hours' from generate_series(1,3);
set local role service_role;
select is(pg_temp.record('contact','e11','n6'),'accepted','Network submissions older than an hour no longer count');
select is(pg_temp.record('contact','e12','n7'),'ip_limit','Network submissions within the hour still count');
select is(pg_temp.record('contact','e10','n9'),'email_limit','An email''s day outlasts the network hour');
reset role;

select * from finish();
rollback;
