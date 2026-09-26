-- TRACE-097 (Codex Phase 4 review P4-R1/P4-R2): completion counts only distinct stored
-- job-photos objects for this job, uploaded by its provider or an admin; rejected completions
-- change nothing; verified evidence is recorded, readable by the job's participants and kept
-- through confirmation. Synthetic fixtures only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('97100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.j(n int) returns uuid language sql immutable as $$ select ('97300000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.p(uploader int, job int, name text) returns text language sql immutable as $$ select pg_temp.u(uploader) || '/' || pg_temp.j(job) || '/' || name $$;
create function pg_temp.act(n int) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('role','authenticated','sub',pg_temp.u(n))::text, true) $$;
-- Everything a completion could change, in one comparable value.
create function pg_temp.state(job int) returns text language sql as $$
  select concat_ws('|', sr.status, sr.photo_proof_urls::text, sr.vendor_completed_at, sr.confirmation_sent_at,
    (select count(*) from public.job_events e where e.job_id = sr.id),
    (select count(*) from public.notifications n where n.related_request_id = sr.id),
    (select count(*) from public.job_status_rejections r where r.job_id = sr.id),
    (select count(*) from public.job_completion_evidence x where x.job_id = sr.id))
  from public.service_requests sr where sr.id = pg_temp.j(job) $$;
create function pg_temp.remove(path text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'job-photos' and name = path;
  get diagnostics n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- 1 homeowner, 2 assigned provider, 3 other provider, 4 admin, 5 other homeowner.
insert into auth.users(id, raw_user_meta_data) select pg_temp.u(n), jsonb_build_object('full_name', 'Synthetic completion user ' || n) from generate_series(1,5) n;
insert into public.user_roles(user_id, role) values (pg_temp.u(2),'vendor'), (pg_temp.u(3),'vendor'), (pg_temp.u(4),'admin');
insert into public.contractors(id, user_id, name) values
 ('97200000-0000-4000-8000-000000000001', pg_temp.u(2), 'Synthetic completion provider'),
 ('97200000-0000-4000-8000-000000000002', pg_temp.u(3), 'Synthetic other provider');
-- Jobs 1 and 2 use a two-photo category; job 4 uses a category without a rule (baseline one).
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, service_catalog_id) values
 (pg_temp.j(1), pg_temp.u(1), '97200000-0000-4000-8000-000000000001', 'Synthetic completion', 'Synthetic fixture', 'in_progress', (select id from public.services_catalog order by id limit 1)),
 (pg_temp.j(2), pg_temp.u(5), '97200000-0000-4000-8000-000000000001', 'Synthetic other job', 'Synthetic fixture', 'in_progress', (select id from public.services_catalog order by id limit 1)),
 (pg_temp.j(4), pg_temp.u(1), '97200000-0000-4000-8000-000000000001', 'Synthetic baseline job', 'Synthetic fixture', 'in_progress', (select id from public.services_catalog order by id offset 1 limit 1));
-- Legacy completion from before verification: a reference that names no stored object.
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, service_catalog_id, vendor_completed_at, confirmation_sent_at, photo_proof_urls) values
 (pg_temp.j(3), pg_temp.u(1), '97200000-0000-4000-8000-000000000001', 'Synthetic legacy job', 'Synthetic fixture', 'vendor_completed', (select id from public.services_catalog order by id limit 1), now() - interval '1 day', now() - interval '1 day', array['synthetic-legacy-proof']);
insert into storage.objects(bucket_id, name, owner) values
 ('job-photos', pg_temp.p(2,1,'a.png'), pg_temp.u(2)),
 ('job-photos', pg_temp.p(2,1,'b.png'), pg_temp.u(2)),
 ('job-photos', pg_temp.p(2,1,'c.png'), pg_temp.u(2)),
 ('job-photos', pg_temp.p(2,1,'d.png'), pg_temp.u(2)),
 ('job-photos', pg_temp.p(2,2,'x.png'), pg_temp.u(2)),       -- same provider, other job
 ('job-photos', pg_temp.p(3,1,'y.png'), pg_temp.u(3)),       -- provider not assigned to job 1
 ('job-photos', pg_temp.p(2,1,'forged.png'), pg_temp.u(3)),  -- provider's folder, someone else's upload
 ('job-photos', pg_temp.p(1,1,'home.png'), pg_temp.u(1)),    -- the homeowner's own upload
 ('job-photos', pg_temp.p(4,1,'admin.png'), pg_temp.u(4)),   -- an admin's upload
 ('job-photos', pg_temp.p(2,1,'placed.png'), pg_temp.u(4)),  -- an admin's upload in the provider's folder
 ('job-photos', pg_temp.p(2,4,'one.png'), pg_temp.u(2)),
 ('vendor-documents', pg_temp.p(2,1,'elsewhere.png'), pg_temp.u(2));  -- right path, wrong bucket

set local role authenticated;
select pg_temp.act(4);
select lives_ok($$select public.set_completion_evidence_rule((select id from public.services_catalog order by id limit 1), 2, 'Synthetic before and after')$$, 'admin sets a two-photo category rule');
reset role;
create temp table before_state as select pg_temp.state(1) as job1;
grant select on before_state to authenticated;

-- P4-R1: malformed and foreign references are refused.
set local role authenticated;
select pg_temp.act(2);
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[null,null]::text[])$$, '22023', 'Each completion photo must be an uploaded file', 'two NULL slots no longer satisfy a two-photo rule');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), null])$$, '22023', 'Each completion photo must be an uploaded file', 'a NULL slot beside a real photo is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array['', '  '])$$, '22023', 'Each completion photo must be an uploaded file', 'blank references are refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'a.png')])$$, '22023', 'The same completion photo cannot be counted twice', 'one photo named twice is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'missing.png')])$$, '22023', 'A completion photo was not found in storage. Upload it again', 'a reference with no stored object is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'elsewhere.png')])$$, '22023', 'A completion photo was not found in storage. Upload it again', 'an object in another bucket is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,2,'x.png')])$$, '22023', 'A completion photo was uploaded for a different job', 'a photo from another job is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(3,1,'y.png')])$$, '22023', 'A completion photo was not uploaded by this job''s provider', 'an unassigned provider''s upload is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'forged.png')])$$, '22023', 'A completion photo was not uploaded by this job''s provider', 'an object whose owner differs from its folder is refused');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'placed.png')])$$, '22023', 'A completion photo was not uploaded by this job''s provider', 'an admin''s object in the provider''s folder is refused, so evidence never names the wrong uploader');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(1,1,'home.png')])$$, '22023', 'A completion photo was not uploaded by this job''s provider', 'the homeowner''s own upload is not provider proof');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png')])$$, 'P0001', 'This service requires at least 2 completion photos', 'one verified photo is below the category minimum');
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[]::text[])$$, 'P0001', 'At least one completion photo is required', 'an empty submission is refused');
select throws_ok($$update public.service_requests set photo_proof_urls = array['anything'] where id = pg_temp.j(1)$$, '42501', null, 'the provider cannot write proof references directly');
select pg_temp.act(3);
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(3,1,'y.png'), pg_temp.p(2,1,'a.png')])$$, 'P0001', 'Not authorized', 'an unassigned provider cannot complete the job');
reset role;
select is(pg_temp.state(1), (select job1 from before_state), 'refused completions leave status, proof, events, notices, rejections and evidence unchanged');

-- Direct transition callers are held to the same verified evidence.
update public.service_requests set photo_proof_urls = array[null, null]::text[] where id = pg_temp.j(1);
set local role authenticated;
select pg_temp.act(4);
select throws_ok($$select public.transition_job_status(pg_temp.j(1), 'vendor_completed', 'Synthetic admin completion')$$, '22023', 'Each completion photo must be an uploaded file', 'an admin transition cannot complete on NULL slots');
reset role;
update public.service_requests set photo_proof_urls = array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,2,'x.png')] where id = pg_temp.j(1);
set local role authenticated;
select pg_temp.act(4);
select throws_ok($$select public.transition_job_status(pg_temp.j(1), 'vendor_completed', 'Synthetic admin completion')$$, '22023', 'A completion photo was uploaded for a different job', 'an admin transition cannot complete on another job''s photo');
reset role;
update public.service_requests set photo_proof_urls = '{}' where id = pg_temp.j(1);
select is(pg_temp.state(1), (select job1 from before_state), 'job 1 is back to its starting state');

-- A verified completion records its evidence.
set local role authenticated;
select pg_temp.act(2);
select lives_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'b.png')])$$, 'two verified provider photos complete the job');
reset role;
select is((select status::text from public.service_requests where id = pg_temp.j(1)), 'vendor_completed', 'job awaits homeowner confirmation');
select results_eq(
  $$select attempt, position, object_name, uploader_id, minimum_photos, rule_version, recorded_by from public.job_completion_evidence where job_id = pg_temp.j(1) order by position$$,
  $$values (1, 1, pg_temp.p(2,1,'a.png'), pg_temp.u(2), 2, 1, pg_temp.u(2)), (1, 2, pg_temp.p(2,1,'b.png'), pg_temp.u(2), 2, 1, pg_temp.u(2))$$,
  'evidence records each verified photo, its uploader and the rule applied');
select is((select count(*)::int from public.job_completion_evidence e join storage.objects o on o.id = e.object_id and o.name = e.object_name where e.job_id = pg_temp.j(1)), 2, 'evidence rows name the stored objects by id');
select is((select metadata->>'completion_rule_version' || '/' || (metadata->>'completion_evidence_attempt') from public.job_events where job_id = pg_temp.j(1) and event_type = 'job_completed_by_vendor'), '1/1', 'completion event records the rule version and evidence attempt');
select is((select count(*)::int from public.notifications where related_request_id = pg_temp.j(1) and user_id = pg_temp.u(1)), 1, 'homeowner receives one completion notice');
select throws_ok($$update public.job_completion_evidence set object_name = 'other' where job_id = pg_temp.j(1)$$, '42501', 'Completion evidence is immutable', 'evidence cannot be rewritten');
select throws_ok($$delete from public.job_completion_evidence where job_id = pg_temp.j(1)$$, '42501', 'Completion evidence is immutable', 'evidence cannot be deleted');

-- Duplicate completion changes nothing.
create temp table completed_state as select pg_temp.state(1) as job1;
grant select on completed_state to authenticated;
set local role authenticated;
select pg_temp.act(2);
select throws_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'c.png'), pg_temp.p(4,1,'admin.png')])$$, '22023', 'Duplicate job transition', 'a second completion is refused');
select throws_ok($$insert into public.job_completion_evidence(job_id, attempt, position, bucket_id, object_name, object_id, uploader_id, minimum_photos, rule_version) values (pg_temp.j(1), 9, 1, 'job-photos', 'x', gen_random_uuid(), pg_temp.u(2), 1, 0)$$, '42501', null, 'the provider cannot insert evidence');
reset role;
select is(pg_temp.state(1), (select job1 from completed_state), 'the refused duplicate keeps the recorded proof');

-- Participants read evidence; others do not. Recorded evidence cannot be deleted in Storage.
set local role authenticated;
select pg_temp.act(1);
select is((select count(*)::int from public.job_completion_evidence where job_id = pg_temp.j(1)), 2, 'homeowner reads the job''s evidence rows');
select is((select count(*)::int from storage.objects where bucket_id = 'job-photos' and name in (pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'b.png'))), 2, 'homeowner can open the recorded proof photos');
select is((select count(*)::int from storage.objects where bucket_id = 'job-photos' and name = pg_temp.p(2,1,'c.png')), 0, 'homeowner cannot open the provider''s unsubmitted uploads');
select pg_temp.act(5);
select is((select count(*)::int from public.job_completion_evidence where job_id = pg_temp.j(1)), 0, 'another homeowner reads no evidence rows');
select is((select count(*)::int from storage.objects where bucket_id = 'job-photos' and name = pg_temp.p(2,1,'a.png')), 0, 'another homeowner cannot open the proof');
select pg_temp.act(3);
select is((select count(*)::int from public.job_completion_evidence where job_id = pg_temp.j(1)), 0, 'an unassigned provider reads no evidence rows');
select pg_temp.act(2);
select is(pg_temp.remove(pg_temp.p(2,1,'a.png')), 0, 'the provider cannot delete recorded proof');
select is(pg_temp.remove(pg_temp.p(2,1,'d.png')), 1, 'the provider can still delete an unsubmitted upload');
select pg_temp.act(4);
select is(pg_temp.remove(pg_temp.p(2,1,'b.png')), 0, 'an admin cannot delete recorded proof through Storage either');
reset role;

-- Rework, then a new completion with an admin's upload: a second attempt, the first kept.
set local role authenticated;
select pg_temp.act(4);
select lives_ok($$select public.transition_job_status(pg_temp.j(1), 'in_progress', 'Synthetic rework')$$, 'admin returns the job for rework');
select pg_temp.act(2);
select lives_ok($$select public.vendor_complete_job(pg_temp.j(1), array[pg_temp.p(2,1,'c.png'), pg_temp.p(4,1,'admin.png')])$$, 'rework completes with a provider and an admin upload');
reset role;
select results_eq($$select attempt, count(*)::int from public.job_completion_evidence where job_id = pg_temp.j(1) group by attempt order by attempt$$, $$values (1, 2), (2, 2)$$, 'both completion attempts keep their evidence');
select is((select photo_proof_urls from public.service_requests where id = pg_temp.j(1)), array[pg_temp.p(2,1,'c.png'), pg_temp.p(4,1,'admin.png')], 'the job shows the latest proof');

-- Proof is retained through homeowner confirmation.
set local role authenticated;
select pg_temp.act(1);
select lives_ok($$select public.homeowner_confirm_job(pg_temp.j(1))$$, 'homeowner confirms the verified completion');
select pg_temp.act(2);
select is(pg_temp.remove(pg_temp.p(2,1,'c.png')), 0, 'proof cannot be deleted after confirmation');
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'job-photos' and name in (pg_temp.p(2,1,'a.png'), pg_temp.p(2,1,'b.png'), pg_temp.p(2,1,'c.png'), pg_temp.p(4,1,'admin.png'))), 4, 'every recorded proof object still exists');

-- Baseline category (no rule) needs one verified photo; version 0 is recorded.
set local role authenticated;
select pg_temp.act(2);
select lives_ok($$select public.vendor_complete_job(pg_temp.j(4), array[pg_temp.p(2,4,'one.png')])$$, 'one verified photo meets the baseline');
reset role;
select is((select minimum_photos || '/' || rule_version from public.job_completion_evidence where job_id = pg_temp.j(4)), '1/0', 'baseline completion records minimum 1, rule version 0');

-- Legacy: nothing fabricated; operators can see unverified open completions.
select is((select count(*)::int from public.job_completion_evidence where job_id = pg_temp.j(3)), 0, 'legacy completion gets no evidence rows');
set local role authenticated;
select pg_temp.act(4);
select results_eq($$select job_id, status::text, reference_count from public.completion_evidence_unverified() where job_id::text like '97300000-%'$$, $$values (pg_temp.j(3), 'vendor_completed', 1)$$, 'admin readback lists only the unverified legacy completion');
select pg_temp.act(2);
select throws_ok($$select * from public.completion_evidence_unverified()$$, '42501', 'Admin access required', 'providers cannot read the operator list');
select pg_temp.act(1);
select lives_ok($$select public.homeowner_confirm_job(pg_temp.j(3))$$, 'legacy homeowner confirmation is unchanged');
reset role;
select is((select photo_proof_urls from public.service_requests where id = pg_temp.j(3)), array['synthetic-legacy-proof'], 'legacy references are kept as stored');

-- P4-R2: completion takes the advisory lock before the row lock.
select ok(position('pg_advisory_xact_lock' in prosrc) between 1 and position('FOR UPDATE OF sr' in prosrc), 'completion takes the per-request advisory lock before the row lock')
  from pg_proc where oid = 'public.vendor_complete_job(uuid,text[])'::regprocedure;
select ok(position('FOR UPDATE OF sr' in prosrc) < position('has_role' in prosrc), 'completion authorizes only after both locks')
  from pg_proc where oid = 'public.vendor_complete_job(uuid,text[])'::regprocedure;

select * from finish();
rollback;
