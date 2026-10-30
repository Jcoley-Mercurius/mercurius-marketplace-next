-- Phase 6.8 / TRACE-130: canonical verified reviews, private feedback and review history.
--
-- Builds on the accepted Phase 4 review contract (TRACE-015, 20260904003000: one review per
-- completed, homeowner-confirmed service, every rating published alike, reason-bearing moderation
-- and appeal; DEC-2026-009/010) and the 6.6 visit identities. Additive: new columns default for
-- existing rows, the four review commands restated, new reads, tighter client grants.
--
-- 1. One source of truth. public.reviews is the canonical review record. A review is public only
--    when visibility = 'eligible_for_google' and moderation_state = 'published'. Legacy
--    'internal_only' rows are private feedback (DEC-2026-009: never published retroactively).
--    public.quality_feedback keeps its historical rows for operations to read; it has no writer
--    and its direct client writes are closed (its role is open: DEC-2026-052 item 3).
-- 2. Eligibility in one place (private.review_eligibility), used by submission and the readback:
--    the homeowner of a completed, confirmed service with an assigned provider. A recurring plan is
--    never reviewed; each visit is its own service. An open or resolved issue pauses reviewing
--    until the job returns to completed, as before.
-- 3. submit_job_review: same signature. A retry with the same rating and comment replays; a
--    different second review is refused (the unique constraint stays the backstop).
-- 4. revise_job_review: the author's correction with a reason, refused on a stale revision; the
--    prior content stays in review_history. Edits keep the moderation state (DEC-2026-052 item 2).
-- 5. moderate_job_review: hold or reject names one of the approved criteria (DEC-2026-010: spam,
--    personal information, threats or abuse, unrelated to the service; never a low rating alone);
--    allowed transitions only; refused on a stale decision. Private feedback is never moderated
--    into public view.
-- 6. appeal_job_review: one appeal per moderation decision (as dispute appeals are per resolution
--    version); a retry returns the same support ticket.
-- 7. Reads: public_provider_reviews / public_review_summaries (the only public counts and
--    averages), service_review (participant readback with eligibility and the author's history,
--    no operator identities), admin_reviews (every state, criteria, appeals and full history).
-- 8. Grants: signed-in users no longer read other homeowners' review rows directly (customer_id
--    was readable for every published review); providers read only their public reviews;
--    review_history is read through the readbacks and is append-only.
--
-- Not changed: award_review_points (loyalty points on a long review; Credits are gated
-- separately), track_google_prompt, contractors.rating (DEC-2026-052 item 6), notification
-- delivery, Cron, support-ticket handling (6.10), money and payout.

-- 1. Columns ------------------------------------------------------------------------------------

alter table public.reviews
  add column revision integer not null default 0,
  add column edited_at timestamptz,
  add column moderation_version integer not null default 0,
  add column moderation_criterion text,
  add column moderated_at timestamptz;
alter table public.reviews add constraint reviews_moderation_criterion_check check (moderation_criterion is null
  or moderation_criterion in ('spam', 'personal_information', 'threats_or_abuse', 'unrelated_to_service'));

alter table public.review_history
  add column seq bigint generated always as identity,
  add column from_state text,
  add column to_state text,
  add column criterion text,
  add column revision integer,
  add column moderation_version integer,
  add column ticket_id uuid;
create index review_history_review_seq on public.review_history (review_id, seq);

-- Rows written before this migration: count earlier corrections and moderation decisions.
update public.reviews r set revision = h.corrections, edited_at = h.last_corrected,
    moderation_version = h.decisions, moderated_at = h.last_decided
  from (select review_id,
          count(*) filter (where action = 'corrected')::int corrections,
          max(created_at) filter (where action = 'corrected') last_corrected,
          count(*) filter (where action in ('published', 'held_for_moderation', 'rejected'))::int decisions,
          max(created_at) filter (where action in ('published', 'held_for_moderation', 'rejected')) last_decided
        from public.review_history group by review_id) h
  where h.review_id = r.id;

create function private.review_history_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Review history is append-only' using errcode = '42501';
end $$;
revoke all on function private.review_history_append_only() from public, anon, authenticated;
create trigger review_history_append_only before update or delete on public.review_history
  for each row execute function private.review_history_append_only();

-- 2. Direct access ------------------------------------------------------------------------------

-- Anonymous visitors keep their column-limited read of public reviews (20260903160000). Signed-in
-- users read public reviews through the readbacks; directly they see only their own.
drop policy "Public can view shareable reviews" on public.reviews;
create policy "Public can view shareable reviews" on public.reviews for select to anon
  using (visibility = 'eligible_for_google' and moderation_state = 'published');
drop policy "Participants can view own reviews" on public.reviews;
create policy "Authors can view own reviews" on public.reviews for select to authenticated
  using (customer_id = auth.uid());
create policy "Providers can view own public reviews" on public.reviews for select to authenticated
  using (visibility = 'eligible_for_google' and moderation_state = 'published'
    and exists (select 1 from public.contractors c where c.id = reviews.contractor_id and c.user_id = auth.uid()));

drop policy "Review owner and admin see history" on public.review_history;
revoke all on public.review_history from authenticated;

-- quality_feedback: historical rows stay readable by operations; nothing writes it.
drop policy "Homeowners can submit quality feedback" on public.quality_feedback;
drop policy "Admins can manage quality feedback" on public.quality_feedback;
revoke insert, update, delete, truncate, references, trigger on public.quality_feedback from anon, authenticated;

-- 3. Eligibility --------------------------------------------------------------------------------

create function private.review_eligibility(r public.service_requests) returns text
language sql stable set search_path = '' as $$
  select case
    when r.id is null then 'not_found'
    when r.recurrence_parent_id is null and r.frequency is not null and r.frequency <> 'one-time' then 'plan'
    when exists (select 1 from public.reviews v where v.service_request_id = r.id) then 'submitted'
    when r.status = 'cancelled' then 'cancelled'
    when r.contractor_id is null then 'no_provider'
    when r.status in ('disputed', 'resolved') then 'issue_open'
    when r.status = 'closed' then 'closed'
    when r.homeowner_confirmed_at is null or r.status not in ('completed', 'review_requested') then 'not_confirmed'
    else 'eligible'
  end
$$;
revoke all on function private.review_eligibility(public.service_requests) from public, anon, authenticated, service_role;

create function private.review_public(v public.reviews) returns boolean
language sql immutable set search_path = '' as $$
  select v.visibility = 'eligible_for_google' and v.moderation_state = 'published'
$$;
revoke all on function private.review_public(public.reviews) from public, anon, authenticated, service_role;

create function private.review_criterion_label(p_criterion text) returns text
language sql immutable set search_path = '' as $$
  select case p_criterion
    when 'spam' then 'Spam'
    when 'personal_information' then 'Personal information'
    when 'threats_or_abuse' then 'Threats or abuse'
    when 'unrelated_to_service' then 'Unrelated to the service'
  end
$$;
revoke all on function private.review_criterion_label(text) from public, anon, authenticated, service_role;

-- 4. Submission ---------------------------------------------------------------------------------

create or replace function public.submit_job_review(_job_id uuid, _rating integer, _comment text)
returns table(review_id uuid, visibility public.review_visibility)
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare r public.service_requests; v public.reviews; r_id uuid; c text := nullif(btrim(_comment), '');
begin
  perform pg_advisory_xact_lock(hashtextextended(_job_id::text, 0));
  select * into r from public.service_requests where id = _job_id for update;
  if auth.uid() is null or r.customer_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can review this service' using errcode = '42501';
  end if;
  if _rating is null or _rating not between 1 and 5 then
    raise exception 'Rating must be between 1 and 5' using errcode = '22023';
  end if;
  if length(c) > 2000 then raise exception 'Keep the review to 2,000 characters' using errcode = '22023'; end if;
  select * into v from public.reviews where service_request_id = r.id;
  if v.id is not null then
    -- A retry of the same review after a lost response returns it; anything else is a second review.
    if v.customer_id = auth.uid() and v.revision = 0 and v.rating = _rating and v.comment is not distinct from c then
      return query select v.id, v.visibility;
      return;
    end if;
    raise exception 'This service already has a review' using errcode = '22023';
  end if;
  case private.review_eligibility(r)
    when 'eligible' then null;
    when 'plan' then raise exception 'Reviews are left on each completed visit, not on the recurring plan' using errcode = '22023';
    when 'issue_open' then raise exception 'This service has an open issue report; you can review it once the issue is resolved' using errcode = '22023';
    when 'closed' then raise exception 'This service is closed for reviews' using errcode = '22023';
    else raise exception 'A completed confirmed service is required' using errcode = '22023';
  end case;
  insert into public.reviews(service_request_id, customer_id, contractor_id, rating, comment, visibility, moderation_state)
    values (r.id, auth.uid(), r.contractor_id, _rating, c, 'eligible_for_google', 'published') returning id into r_id;
  perform public.transition_job_status(r.id, 'reviewed', null, jsonb_build_object('review_id', r_id));
  return query select r_id, 'eligible_for_google'::public.review_visibility;
end $$;

-- 5. Author correction --------------------------------------------------------------------------

drop function public.revise_job_review(uuid, integer, text, text);
create function public.revise_job_review(_review_id uuid, _rating integer, _comment text, _reason text,
  _expected_revision integer default null) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.reviews; c text := nullif(btrim(_comment), '');
begin
  select * into v from public.reviews where id = _review_id for update;
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then
    raise exception 'Only the review author can edit it' using errcode = '42501';
  end if;
  if _rating is null or _rating not between 1 and 5 or nullif(btrim(_reason), '') is null then
    raise exception 'Valid rating and correction reason required' using errcode = '22023';
  end if;
  if length(c) > 2000 then raise exception 'Keep the review to 2,000 characters' using errcode = '22023'; end if;
  if _expected_revision is not null and _expected_revision <> v.revision then
    raise exception 'This review changed since you opened it. Refresh to see the current version.' using errcode = '40001';
  end if;
  if v.rating = _rating and v.comment is not distinct from c then
    raise exception 'Change the rating or the review text to save a correction' using errcode = '22023';
  end if;
  insert into public.review_history(review_id, actor_id, action, before_value, reason, from_state, to_state, revision, moderation_version)
    values (v.id, auth.uid(), 'corrected', to_jsonb(v), btrim(_reason), v.moderation_state, v.moderation_state, v.revision + 1, v.moderation_version);
  update public.reviews set rating = _rating, comment = c, revision = v.revision + 1, edited_at = now() where id = v.id;
  return jsonb_build_object('outcome', 'corrected', 'revision', v.revision + 1, 'moderation_state', v.moderation_state);
end $$;
revoke all on function public.revise_job_review(uuid, integer, text, text, integer) from public, anon;
grant execute on function public.revise_job_review(uuid, integer, text, text, integer) to authenticated;

-- 6. Moderation ---------------------------------------------------------------------------------

drop function public.moderate_job_review(uuid, text, text);
create function public.moderate_job_review(_review_id uuid, _state text, _reason text,
  _criterion text default null, _expected_version integer default null) returns jsonb
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.reviews; crit text := nullif(btrim(_criterion), ''); body text;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if _state not in ('published', 'held_for_moderation', 'rejected') or nullif(btrim(_reason), '') is null then
    raise exception 'Moderation state and reason required' using errcode = '22023';
  end if;
  select * into v from public.reviews where id = _review_id for update;
  if v.id is null then raise exception 'Invalid or duplicate moderation' using errcode = '22023'; end if;
  if _expected_version is not null and _expected_version <> v.moderation_version then
    raise exception 'Another moderation decision was recorded. Refresh to see it.' using errcode = '40001';
  end if;
  if v.moderation_state = _state then raise exception 'Invalid or duplicate moderation' using errcode = '22023'; end if;
  if v.visibility = 'internal_only' then
    raise exception 'Legacy private feedback is not public, is not moderated and cannot be published without author consent' using errcode = '42501';
  end if;
  if not ((v.moderation_state = 'published' and _state in ('held_for_moderation', 'rejected'))
       or (v.moderation_state = 'held_for_moderation' and _state in ('published', 'rejected'))
       or (v.moderation_state = 'rejected' and _state = 'published')
       or (v.moderation_state = 'appealed' and _state in ('published', 'rejected'))) then
    raise exception 'A % review cannot move to %', replace(v.moderation_state, '_', ' '), replace(_state, '_', ' ') using errcode = '22023';
  end if;
  -- DEC-2026-010: only the approved criteria hide a review; never a low rating alone.
  if _state <> 'published' and private.review_criterion_label(crit) is null then
    raise exception 'Choose the moderation criterion: spam, personal information, threats or abuse, or unrelated to the service' using errcode = '22023';
  end if;
  if _state = 'published' then crit := null; end if;
  insert into public.review_history(review_id, actor_id, action, before_value, reason, from_state, to_state, criterion, revision, moderation_version)
    values (v.id, auth.uid(), _state, to_jsonb(v), btrim(_reason), v.moderation_state, _state, crit, v.revision, v.moderation_version + 1);
  update public.reviews set moderation_state = _state, moderation_criterion = crit, moderation_version = v.moderation_version + 1,
    moderated_at = now() where id = v.id;
  body := case when _state = 'published' then 'Your review is public again. ' || btrim(_reason)
    else 'Your review is not public: ' || private.review_criterion_label(crit) || '. ' || btrim(_reason)
      || ' You can correct it or appeal from the service.' end;
  perform public.notify_user(v.customer_id, 'job_status', 'info', 'Review moderation updated', body, '/dashboard', v.service_request_id, v.contractor_id);
  return jsonb_build_object('outcome', 'moderated', 'moderation_state', _state, 'moderation_version', v.moderation_version + 1);
end $$;
revoke all on function public.moderate_job_review(uuid, text, text, text, integer) from public, anon;
grant execute on function public.moderate_job_review(uuid, text, text, text, integer) to authenticated;

-- 7. Appeal -------------------------------------------------------------------------------------

drop function public.appeal_job_review(uuid, text);
create function public.appeal_job_review(_review_id uuid, _reason text) returns uuid
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v public.reviews; t_id uuid;
begin
  select * into v from public.reviews where id = _review_id for update;
  if auth.uid() is null or v.customer_id is distinct from auth.uid() then
    raise exception 'Only the review author can appeal' using errcode = '42501';
  end if;
  if nullif(btrim(_reason), '') is null then
    raise exception 'Moderation decision and appeal reason required' using errcode = '22023';
  end if;
  -- One appeal per moderation decision; a retry returns its ticket.
  select h.ticket_id into t_id from public.review_history h
    where h.review_id = v.id and h.action = 'appealed' and h.moderation_version = v.moderation_version;
  if t_id is not null then return t_id; end if;
  if v.visibility = 'internal_only' then
    raise exception 'Private feedback is not public and has no moderation decision to appeal' using errcode = '22023';
  end if;
  if v.moderation_state not in ('held_for_moderation', 'rejected') then
    raise exception 'Moderation decision and appeal reason required' using errcode = '22023';
  end if;
  insert into public.support_tickets(user_id, subject, description, issue_type, job_id, next_action)
    values (auth.uid(), 'Review moderation appeal', btrim(_reason), 'review_appeal', v.service_request_id::text,
      'Review original content and moderation reason') returning id into t_id;
  insert into public.review_history(review_id, actor_id, action, before_value, reason, from_state, to_state, criterion, revision, moderation_version, ticket_id)
    values (v.id, auth.uid(), 'appealed', to_jsonb(v), btrim(_reason), v.moderation_state, 'appealed', v.moderation_criterion, v.revision, v.moderation_version, t_id);
  update public.reviews set moderation_state = 'appealed' where id = v.id;
  return t_id;
end $$;
revoke all on function public.appeal_job_review(uuid, text) from public, anon;
grant execute on function public.appeal_job_review(uuid, text) to authenticated;

-- 8. Public reads -------------------------------------------------------------------------------

-- The only public counts and averages: the same rows the anonymous policy shows.
create function public.public_review_summaries(_contractor_ids uuid[])
returns table(contractor_id uuid, review_count integer, average_rating numeric)
language sql stable security definer set search_path = '' as $$
  select v.contractor_id, count(*)::int, round(avg(v.rating), 2)
  from public.reviews v
  where v.contractor_id = any(_contractor_ids[1:200])
    and v.visibility = 'eligible_for_google' and v.moderation_state = 'published'
  group by v.contractor_id
$$;
revoke all on function public.public_review_summaries(uuid[]) from public;
grant execute on function public.public_review_summaries(uuid[]) to anon, authenticated;

create function public.public_provider_reviews(_contractor_id uuid, _limit integer default 50) returns jsonb
language sql stable security definer set search_path = '' as $$
  with shown as (
    select v.id, v.rating, v.comment, v.created_at, v.edited_at
    from public.reviews v
    where v.contractor_id = _contractor_id
      and v.visibility = 'eligible_for_google' and v.moderation_state = 'published')
  select jsonb_build_object(
    'summary', (select jsonb_build_object('count', count(*), 'average', round(avg(rating), 2)) from shown),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rating', s.rating, 'comment', s.comment,
        'created_at', s.created_at, 'edited', s.edited_at is not null) order by s.created_at desc, s.id)
      from (select * from shown order by created_at desc, id limit greatest(1, least(coalesce(_limit, 50), 100))) s), '[]'::jsonb))
$$;
revoke all on function public.public_provider_reviews(uuid, integer) from public;
grant execute on function public.public_provider_reviews(uuid, integer) to anon, authenticated;

-- 9. Participant readback -----------------------------------------------------------------------

create function public.service_review(_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; v public.reviews; is_admin boolean; is_author boolean; is_vendor boolean;
  eligibility text; history jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see this review' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  is_admin := coalesce(public.has_role(auth.uid(), 'admin'), false);
  is_author := r.id is not null and r.customer_id = auth.uid();
  is_vendor := r.id is not null and exists (select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid());
  if not (is_admin or is_author or is_vendor) then
    raise exception 'Only participants can see this review' using errcode = '42501';
  end if;
  select * into v from public.reviews where service_request_id = r.id;
  eligibility := private.review_eligibility(r);
  -- The provider sees what the public sees.
  if is_vendor and not is_admin and not is_author then
    return jsonb_build_object('role', 'vendor', 'job_id', r.id,
      'review', case when v.id is not null and private.review_public(v) then jsonb_build_object('rating', v.rating,
        'comment', v.comment, 'created_at', v.created_at, 'edited', v.edited_at is not null) end);
  end if;
  -- The author's own history, without operator identities.
  select coalesce(jsonb_agg(jsonb_build_object('action', h.action, 'at', h.created_at, 'from_state', h.from_state,
      'to_state', h.to_state, 'criterion', h.criterion, 'criterion_label', private.review_criterion_label(h.criterion),
      'reason', h.reason, 'by', case when h.actor_id = v.customer_id then 'you' else 'mercurius' end,
      'previous', case when h.action = 'corrected' then jsonb_build_object('rating', h.before_value->'rating', 'comment', h.before_value->'comment') end)
      order by h.seq), '[]'::jsonb) into history
  from public.review_history h where h.review_id = v.id;
  return jsonb_build_object('role', case when is_author then 'homeowner' else 'admin' end, 'job_id', r.id,
    'eligibility', eligibility, 'requested', r.status = 'review_requested',
    'review', case when v.id is not null then jsonb_build_object('id', v.id, 'rating', v.rating, 'comment', v.comment,
      'created_at', v.created_at, 'edited_at', v.edited_at, 'revision', v.revision,
      'state', case when v.visibility = 'internal_only' then 'private' else v.moderation_state end,
      'public', private.review_public(v), 'criterion', v.moderation_criterion,
      'criterion_label', private.review_criterion_label(v.moderation_criterion), 'moderation_version', v.moderation_version,
      'can_edit', is_author, 'can_appeal', is_author and v.visibility <> 'internal_only'
        and v.moderation_state in ('held_for_moderation', 'rejected')) end,
    'history', coalesce(history, '[]'::jsonb));
end $$;
revoke all on function public.service_review(uuid) from public, anon;
grant execute on function public.service_review(uuid) to authenticated;

-- 10. Operations --------------------------------------------------------------------------------

create function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare items jsonb; counts jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
      'public', count(*) filter (where private.review_public(v)),
      'held_for_moderation', count(*) filter (where v.visibility <> 'internal_only' and v.moderation_state = 'held_for_moderation'),
      'rejected', count(*) filter (where v.visibility <> 'internal_only' and v.moderation_state = 'rejected'),
      'appealed', count(*) filter (where v.visibility <> 'internal_only' and v.moderation_state = 'appealed'),
      'private', count(*) filter (where v.visibility = 'internal_only'),
      'public_average', round(avg(v.rating) filter (where private.review_public(v)), 2),
      'quality_feedback', (select count(*) from public.quality_feedback))
    into counts from public.reviews v;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', v.id, 'job_id', v.service_request_id, 'service_type', r.service_type, 'visit', r.recurrence_parent_id is not null,
      'contractor_id', v.contractor_id, 'contractor_name', c.name, 'author_name', coalesce(nullif(btrim(p.full_name), ''), 'Homeowner'),
      'rating', v.rating, 'comment', v.comment, 'created_at', v.created_at, 'edited_at', v.edited_at, 'revision', v.revision,
      'state', case when v.visibility = 'internal_only' then 'private' else v.moderation_state end, 'public', private.review_public(v),
      'criterion', v.moderation_criterion, 'criterion_label', private.review_criterion_label(v.moderation_criterion),
      'moderation_version', v.moderation_version, 'moderated_at', v.moderated_at,
      'history', (select coalesce(jsonb_agg(jsonb_build_object('action', h.action, 'at', h.created_at, 'actor_id', h.actor_id,
          'actor_name', coalesce(nullif(btrim(ap.full_name), ''), case when h.actor_id = v.customer_id then 'Author' else 'Operator' end),
          'from_state', h.from_state, 'to_state', h.to_state, 'criterion', h.criterion,
          'criterion_label', private.review_criterion_label(h.criterion), 'reason', h.reason, 'ticket_id', h.ticket_id,
          'previous', jsonb_build_object('rating', h.before_value->'rating', 'comment', h.before_value->'comment')) order by h.seq), '[]'::jsonb)
        from public.review_history h left join public.profiles ap on ap.user_id = h.actor_id where h.review_id = v.id))
    order by (v.moderation_state = 'appealed' and v.visibility <> 'internal_only') desc, v.created_at desc), '[]'::jsonb)
    into items
  from public.reviews v
  join public.service_requests r on r.id = v.service_request_id
  left join public.contractors c on c.id = v.contractor_id
  left join public.profiles p on p.user_id = v.customer_id;
  return jsonb_build_object('checked_at', now(), 'counts', counts, 'items', items);
end $$;
revoke all on function public.admin_reviews() from public, anon;
grant execute on function public.admin_reviews() to authenticated;
