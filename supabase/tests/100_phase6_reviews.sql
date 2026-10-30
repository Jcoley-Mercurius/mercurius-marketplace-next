-- Phase 6.8 / TRACE-130: canonical verified reviews, private feedback and review history.
-- Synthetic rows only; rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Homeowners A and B, providers V1 (C1) and V2 (C2), an operator.
insert into auth.users(id, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', '{"full_name":"Synthetic homeowner A"}'),
  ('a1000000-0000-4000-8000-000000000002', '{"full_name":"Synthetic homeowner B"}'),
  ('a1000000-0000-4000-8000-000000000003', '{"full_name":"Synthetic vendor one"}'),
  ('a1000000-0000-4000-8000-000000000004', '{"full_name":"Synthetic vendor two"}'),
  ('a1000000-0000-4000-8000-000000000005', '{"full_name":"Synthetic operator"}');
insert into public.user_roles(user_id, role) values
  ('a1000000-0000-4000-8000-000000000003', 'vendor'), ('a1000000-0000-4000-8000-000000000004', 'vendor'),
  ('a1000000-0000-4000-8000-000000000005', 'admin');
insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003', 'Synthetic review provider one', true, true),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000004', 'Synthetic review provider two', true, true);

-- Jobs: 1–4 completed and confirmed (A, C1); 5 pending; 6 completed unconfirmed; 7 a legacy recurring
-- plan already marked completed; 8 a completed, confirmed visit of plan 7; 9 disputed; 10 closed;
-- 11 B's completed job with C2 (legacy private feedback); 12 cancelled.
insert into public.service_requests(id, customer_id, service_type, address, zip_code, frequency)
  select ('a3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    case when n = 11 then 'a1000000-0000-4000-8000-000000000002'::uuid else 'a1000000-0000-4000-8000-000000000001'::uuid end,
    'Synthetic review service ' || n, 'Synthetic address', '00000', 'one-time'
  from generate_series(1, 12) n where n <> 7;
insert into public.service_requests(id, customer_id, service_type, address, zip_code, frequency, status, contractor_id, homeowner_confirmed_at)
  values ('a3000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', 'Synthetic recurring plan',
    'Synthetic address', '00000', 'weekly', 'completed', 'a2000000-0000-4000-8000-000000000001', now());
update public.service_requests set recurrence_parent_id = 'a3000000-0000-4000-8000-000000000007', frequency = 'weekly',
  occurrence_key = 'a5000000-0000-4000-8000-000000000008' where id = 'a3000000-0000-4000-8000-000000000008';
update public.service_requests set contractor_id = case when id = 'a3000000-0000-4000-8000-000000000011'
    then 'a2000000-0000-4000-8000-000000000002'::uuid else 'a2000000-0000-4000-8000-000000000001'::uuid end,
  status = 'vendor_completed', vendor_completed_at = now() - interval '2 hours'
  where id::text like 'a3000000-%' and id not in ('a3000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000012');
update public.service_requests set status = 'completed', homeowner_confirmed_at = now()
  where id in ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000003',
    'a3000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000009',
    'a3000000-0000-4000-8000-000000000010', 'a3000000-0000-4000-8000-000000000011');
update public.service_requests set status = 'disputed' where id = 'a3000000-0000-4000-8000-000000000009';
update public.service_requests set status = 'closed' where id = 'a3000000-0000-4000-8000-000000000010';
update public.service_requests set status = 'cancelled' where id = 'a3000000-0000-4000-8000-000000000012';

-- Legacy rows written before this slice: B's private feedback (Phase 4 kept it held) and a
-- quality_feedback report.
insert into public.reviews(id, service_request_id, customer_id, contractor_id, rating, comment, visibility, moderation_state)
  values ('a4000000-0000-4000-8000-000000000011', 'a3000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000002', 2, 'Synthetic private feedback', 'internal_only', 'held_for_moderation');
insert into public.quality_feedback(service_request_id, customer_id, contractor_id, punctuality, communication, workmanship, would_recommend, internal_notes)
  values ('a3000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002', 2, 3, 2, false, 'Synthetic internal note');

create function pg_temp.act(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true)
$$;
create function pg_temp.job(n int) returns uuid language sql immutable as $$ select ('a3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.review(n int) returns uuid language sql as $$ select id from public.reviews where service_request_id = pg_temp.job(n) $$;
grant execute on function pg_temp.act(text), pg_temp.job(int), pg_temp.review(int) to anon, authenticated;
grant select on public.reviews to postgres;

-- Grants ----------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.submit_job_review(uuid,integer,text)', 'execute'), 'anon cannot submit');
select ok(not has_function_privilege('anon', 'public.service_review(uuid)', 'execute'), 'anon cannot read the participant readback');
select ok(not has_function_privilege('anon', 'public.admin_reviews()', 'execute'), 'anon cannot read the operations list');
select ok(not has_function_privilege('anon', 'public.moderate_job_review(uuid,text,text,text,integer)', 'execute'), 'anon cannot moderate');
select ok(has_function_privilege('anon', 'public.public_review_summaries(uuid[])', 'execute'), 'anon reads public summaries');
select ok(has_function_privilege('anon', 'public.public_provider_reviews(uuid,integer)', 'execute'), 'anon reads public reviews');
select ok(not has_table_privilege('authenticated', 'public.review_history', 'select'), 'review history has no direct client read');
select ok(not has_table_privilege('authenticated', 'public.quality_feedback', 'insert'), 'quality_feedback has no client insert');
select ok(not has_table_privilege('authenticated', 'public.quality_feedback', 'update'), 'quality_feedback has no client update');
select ok(not has_table_privilege('authenticated', 'public.quality_feedback', 'delete'), 'quality_feedback has no client delete');
select ok(not has_column_privilege('anon', 'public.reviews', 'customer_id', 'select'), 'anon never reads the author identity');

-- Eligibility -----------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is(public.service_review(pg_temp.job(1))->>'eligibility', 'eligible', 'completed confirmed service is eligible');
select is(public.service_review(pg_temp.job(5))->>'eligibility', 'no_provider', 'pending service without a provider is not eligible');
select is(public.service_review(pg_temp.job(6))->>'eligibility', 'not_confirmed', 'unconfirmed completion is not eligible');
select is(public.service_review(pg_temp.job(7))->>'eligibility', 'plan', 'a recurring plan is never reviewed');
select is(public.service_review(pg_temp.job(8))->>'eligibility', 'eligible', 'a completed visit is eligible on its own');
select is(public.service_review(pg_temp.job(9))->>'eligibility', 'issue_open', 'an open issue pauses reviewing');
select is(public.service_review(pg_temp.job(10))->>'eligibility', 'closed', 'a closed service is not reviewable');
select is(public.service_review(pg_temp.job(12))->>'eligibility', 'cancelled', 'a cancelled service is not reviewable');
select throws_ok($$select public.submit_job_review(pg_temp.job(5), 4, null)$$, '22023', 'A completed confirmed service is required', 'pending refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(6), 4, null)$$, '22023', 'A completed confirmed service is required', 'unconfirmed refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(7), 4, null)$$, '22023', 'Reviews are left on each completed visit, not on the recurring plan', 'plan refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(9), 4, null)$$, '22023', null, 'disputed refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(10), 4, null)$$, '22023', 'This service is closed for reviews', 'closed refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 6, null)$$, '22023', 'Rating must be between 1 and 5', 'rating above 5 refused');
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 0, null)$$, '22023', 'Rating must be between 1 and 5', 'rating below 1 refused');
select throws_ok(format('select public.submit_job_review(%L, 4, %L)', pg_temp.job(1), repeat('x', 2001)), '22023', 'Keep the review to 2,000 characters', 'overlong comment refused');

-- Ownership -------------------------------------------------------------------------------------
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 1, 'Not mine')$$, '42501', null, 'another homeowner cannot review');
select throws_ok($$select public.service_review(pg_temp.job(1))$$, '42501', null, 'another homeowner cannot read the readback');
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 5, 'Self review')$$, '42501', null, 'the provider cannot review its own job');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select throws_ok($$select public.service_review(pg_temp.job(1))$$, '42501', null, 'an unrelated provider cannot read the readback');
select throws_ok($$select public.service_review('a3000000-0000-4000-8000-000000000099')$$, '42501', null, 'a missing job reads like a refused one');
reset role;
set local role anon;
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 5, null)$$, '42501', null, 'anonymous submission refused');
reset role;

-- Direct-write bypasses -------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$insert into public.reviews(service_request_id, customer_id, contractor_id, rating, visibility, moderation_state)
  values (pg_temp.job(3), 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 5, 'eligible_for_google', 'published')$$,
  '42501', null, 'homeowner cannot insert a review directly');
select throws_ok($$insert into public.quality_feedback(service_request_id, customer_id, contractor_id, punctuality, communication, workmanship)
  values (pg_temp.job(1), 'a1000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 1, 1, 1)$$,
  '42501', null, 'homeowner cannot insert private feedback against any provider');
select throws_ok($$insert into public.review_history(review_id, actor_id, action, before_value, reason)
  values ('a4000000-0000-4000-8000-000000000011', 'a1000000-0000-4000-8000-000000000001', 'corrected', '{}', 'x')$$,
  '42501', null, 'homeowner cannot write review history');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select throws_ok($$update public.reviews set moderation_state = 'published'$$, '42501', null, 'operator cannot bypass moderation with a direct update');
select throws_ok($$delete from public.reviews$$, '42501', null, 'operator cannot delete reviews');
select throws_ok($$update public.quality_feedback set internal_notes = 'changed'$$, '42501', null, 'operator cannot rewrite private feedback');
select throws_ok($$select count(*) from public.review_history$$, '42501', null, 'review history is read through the readbacks');
reset role;

-- Submission, replay and duplicates -------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select lives_ok($$select public.submit_job_review(pg_temp.job(1), 1, '  Low but fair  ')$$, 'one-star review published');
select is((select review_id from public.submit_job_review(pg_temp.job(1), 1, 'Low but fair')), pg_temp.review(1), 'the same review retried replays');
select throws_ok($$select public.submit_job_review(pg_temp.job(1), 2, 'Low but fair')$$, '22023', 'This service already has a review', 'a different second review is refused');
select lives_ok($$select public.submit_job_review(pg_temp.job(2), 5, 'Great work')$$, 'five-star review published');
select lives_ok($$select public.submit_job_review(pg_temp.job(8), 4, 'Visit went well')$$, 'visit review published');
reset role;
select is((select count(*) from public.reviews where service_request_id = pg_temp.job(1)), 1::bigint, 'one review per service');
select is((select comment from public.reviews where id = pg_temp.review(1)), 'Low but fair', 'comment trimmed');
select is((select status::text from public.service_requests where id = pg_temp.job(1)), 'reviewed', 'job records the review');
select is((select service_request_id from public.reviews where id = pg_temp.review(8)), pg_temp.job(8), 'visit review binds to the visit');
select is((select count(*) from public.reviews where service_request_id = pg_temp.job(7)), 0::bigint, 'nothing binds to the plan');
select is((select (visibility::text, moderation_state) from public.reviews where id = pg_temp.review(1)),
  ('eligible_for_google'::text, 'published'::text), 'every rating publishes alike (DEC-2026-009)');

-- Public reads and aggregates -------------------------------------------------------------------
set local role anon;
select is((select (review_count, average_rating) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid])),
  (3, 3.33::numeric), 'public summary: three reviews, average 3.33');
select is((public.public_provider_reviews('a2000000-0000-4000-8000-000000000001')->'summary'->>'count')::int, 3, 'profile list agrees with the summary');
select is((select count(*) from public.reviews where contractor_id = 'a2000000-0000-4000-8000-000000000001'), 3::bigint, 'anonymous direct read agrees');
select is((select count(*) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000002'::uuid])), 0::bigint,
  'legacy private feedback never counts');
select is((select count(*) from public.reviews where contractor_id = 'a2000000-0000-4000-8000-000000000002'), 0::bigint, 'legacy private feedback never shows');
select ok(not (public.public_provider_reviews('a2000000-0000-4000-8000-000000000001')->'reviews'->0 ? 'customer_id'), 'public list carries no author identity');
reset role;
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is((select count(*) from public.reviews), 1::bigint, 'a signed-in homeowner reads only their own rows directly');
select is((select count(*) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid])), 1::bigint, 'and the same public summary');
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select count(*) from public.reviews), 3::bigint, 'the provider reads its public reviews');
select pg_temp.act('a1000000-0000-4000-8000-000000000004');
select is((select count(*) from public.reviews), 0::bigint, 'the provider of private feedback cannot read it');
reset role;

-- Author correction -----------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select throws_ok($$select public.revise_job_review(pg_temp.review(1), 5, 'Hijack', 'Mine now', 0)$$, '42501', null, 'only the author edits');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.revise_job_review(pg_temp.review(1), 2, 'Better after a call', '  ', 0)$$, '22023', null, 'correction reason required');
select is(public.revise_job_review(pg_temp.review(1), 2, 'Better after a call', 'Provider followed up', 0)->>'revision', '1', 'author correction recorded');
select throws_ok($$select public.revise_job_review(pg_temp.review(1), 3, 'Stale', 'Second tab', 0)$$, '40001', null, 'stale correction refused');
select throws_ok($$select public.revise_job_review(pg_temp.review(1), 2, 'Better after a call', 'Same again', 1)$$, '22023', null, 'unchanged correction refused');
select is(public.service_review(pg_temp.job(1))->'history'->0->'previous'->>'comment', 'Low but fair', 'author sees the original content');
select is(public.service_review(pg_temp.job(1))->'history'->0->>'by', 'you', 'history names the author as you');
reset role;
select is((select (revision, edited_at is not null) from public.reviews where id = pg_temp.review(1)), (1, true), 'revision and edit time kept');
select is((select average_rating from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid])), 3.67::numeric,
  'an edit to a public review moves the average');
select ok((public.public_provider_reviews('a2000000-0000-4000-8000-000000000001')->'reviews') @> '[{"rating": 2, "edited": true}]', 'public list marks the edit');

-- Moderation ------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'rejected', 'Mine', 'spam')$$, '42501', null, 'provider cannot moderate');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'rejected', 'Mine', 'spam')$$, '42501', null, 'homeowner cannot moderate');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select throws_ok($$select public.moderate_job_review(pg_temp.review(1), 'rejected', 'Too harsh')$$, '22023', null, 'a low rating alone is not a criterion');
select throws_ok($$select public.moderate_job_review(pg_temp.review(1), 'rejected', 'Too harsh', 'low_rating')$$, '22023', null, 'unknown criterion refused');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'rejected', '  ', 'spam')$$, '22023', null, 'moderation reason required');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'published', 'Already')$$, '22023', null, 'duplicate decision refused');
select is(public.moderate_job_review(pg_temp.review(2), 'rejected', 'Promotional link', 'spam', 0)->>'moderation_version', '1', 'reject with a criterion');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'published', 'Second operator', null, 0)$$, '40001', null, 'stale decision refused');
select throws_ok($$select public.moderate_job_review(pg_temp.review(2), 'held_for_moderation', 'Back to hold', 'spam')$$, '22023', null, 'rejected cannot go back to held');
select throws_ok($$select public.moderate_job_review('a4000000-0000-4000-8000-000000000011', 'published', 'Publish private')$$, '42501', null,
  'private feedback is never published');
select throws_ok($$select public.moderate_job_review('a4000000-0000-4000-8000-000000000011', 'rejected', 'Reject private', 'spam')$$, '42501', null,
  'private feedback is not moderated');
reset role;
select is((select rating from public.reviews where id = pg_temp.review(2)), 5, 'moderation never changes the rating');
select is((select (review_count, average_rating) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid])),
  (2, 3.00::numeric), 'rejected review leaves the count and average');
set local role anon;
select is((select count(*) from public.reviews where contractor_id = 'a2000000-0000-4000-8000-000000000001'), 2::bigint, 'rejected review leaves the anonymous read');
reset role;
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000003');
select is((select count(*) from public.reviews), 2::bigint, 'rejected review leaves the provider read');
select ok(public.service_review(pg_temp.job(2))->'review' = 'null'::jsonb, 'provider readback shows only public reviews');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select is(public.service_review(pg_temp.job(2))->'review'->>'state', 'rejected', 'author sees the decision');
select is(public.service_review(pg_temp.job(2))->'review'->>'criterion_label', 'Spam', 'author sees the criterion');
select ok((public.service_review(pg_temp.job(2))->'review'->>'can_appeal')::boolean, 'author may appeal');
select ok(not (public.service_review(pg_temp.job(2))::text like '%a1000000-0000-4000-8000-000000000005%'), 'author readback carries no operator identity');
select is(public.service_review(pg_temp.job(2))->'history'->0->>'by', 'mercurius', 'decision attributed to Mercurius');
reset role;
select is((select count(*) from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000001'
  and title = 'Review moderation updated' and body like 'Your review is not public: Spam.%'), 1::bigint, 'author notified in-app with the criterion');

-- Appeal ----------------------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select throws_ok($$select public.appeal_job_review(pg_temp.review(2), 'Not mine')$$, '42501', null, 'only the author appeals');
select throws_ok($$select public.appeal_job_review('a4000000-0000-4000-8000-000000000011', 'Publish my feedback')$$, '22023', null,
  'private feedback has no decision to appeal');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.appeal_job_review(pg_temp.review(1), 'Nothing to appeal')$$, '22023', null, 'a public review has nothing to appeal');
create temp table appeal_ticket on commit drop as select public.appeal_job_review(pg_temp.review(2), 'The link is my business page') id;
select is(public.appeal_job_review(pg_temp.review(2), 'Retried'), (select id from appeal_ticket), 'a retried appeal returns its ticket');
select is(public.service_review(pg_temp.job(2))->'review'->>'state', 'appealed', 'review is under appeal');
reset role;
select is((select count(*) from public.support_tickets where issue_type = 'review_appeal' and job_id = pg_temp.job(2)::text), 1::bigint, 'one appeal ticket');
select is((select count(*) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid]) where review_count = 2), 1::bigint,
  'an appealed review stays out of the aggregate');
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select lives_ok($$select public.moderate_job_review(pg_temp.review(2), 'published', 'Appeal upheld: business page is relevant', null, 1)$$, 'appeal upheld');
reset role;
select is((select (review_count, average_rating) from public.public_review_summaries(array['a2000000-0000-4000-8000-000000000001'::uuid])),
  (3, 3.67::numeric), 'upheld appeal returns the review to the aggregate');
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select lives_ok($$select public.moderate_job_review(pg_temp.review(2), 'held_for_moderation', 'Phone number in text', 'personal_information', 2)$$, 'held again');
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select isnt(public.appeal_job_review(pg_temp.review(2), 'Removed the number'), (select id from appeal_ticket), 'a new decision gets its own appeal');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select lives_ok($$select public.moderate_job_review(pg_temp.review(2), 'rejected', 'Appeal denied', 'personal_information', 3)$$, 'appeal denied');
select is((select jsonb_array_length(i->'history') from jsonb_array_elements(public.admin_reviews()->'items') i
  where i->>'id' = pg_temp.review(2)::text), 6, 'operations see every step');
select is((select i->'history'->0->>'actor_name' || ' / ' || (i->'history'->1->>'actor_name') from jsonb_array_elements(public.admin_reviews()->'items') i
  where i->>'id' = pg_temp.review(2)::text), 'Synthetic operator / Synthetic homeowner A', 'operations see who decided and who appealed');
reset role;
select is((select count(*) from public.support_tickets where issue_type = 'review_appeal' and job_id = pg_temp.job(2)::text), 2::bigint, 'two decisions, two appeals');
select is((select array_agg(action order by seq) from public.review_history where review_id = pg_temp.review(2)),
  array['rejected', 'appealed', 'published', 'held_for_moderation', 'appealed', 'rejected'], 'decision history in order');

-- Operations readback ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.act('a1000000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_reviews()$$, '42501', null, 'homeowner cannot read operations list');
select pg_temp.act('a1000000-0000-4000-8000-000000000005');
select is(public.admin_reviews()->'counts', jsonb_build_object('public', 2, 'held_for_moderation', 0, 'rejected', 1, 'appealed', 0,
  'private', 1, 'public_average', 3.00, 'quality_feedback', 1), 'operations counts match the public aggregate');
select is((select count(*) from public.quality_feedback), 1::bigint, 'operations still read historical private feedback');
select is(public.service_review('a3000000-0000-4000-8000-000000000011')->'review'->>'state', 'private', 'legacy private feedback reads as private');
select pg_temp.act('a1000000-0000-4000-8000-000000000002');
select is((select count(*) from public.quality_feedback), 0::bigint, 'homeowner cannot read private feedback reports');
reset role;

-- Append-only history ---------------------------------------------------------------------------
select throws_ok($$update public.review_history set reason = 'rewritten'$$, '42501', 'Review history is append-only', 'history cannot be rewritten');
select throws_ok($$delete from public.review_history$$, '42501', 'Review history is append-only', 'history cannot be deleted');

select * from finish();
rollback;
