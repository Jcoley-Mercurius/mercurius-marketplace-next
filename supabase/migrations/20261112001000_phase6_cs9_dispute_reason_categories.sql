-- Phase 6 corrective slice CS-9 / TRACE-144: dispute reason categories. Record:
-- governance/PHASE-6-CLOSURE-REPORT.md §8 CS-9; DEC-2026-054 item 1, approved by DEC-2026-060 D-6b.
-- Additive. The categories are for reporting only: they change no hold, money, window, routing or
-- ticket behavior, and no fingerprinted function changes (45 | 34c51131… before and after).
--
-- The existing commands keep their signatures and behavior for the deployed client (the migration
-- is pushed before the client merges, DEC-2026-037). The new overloads take a category, call the
-- existing command, then record the category on the dispute that command returned.

alter table public.disputes add column reason_category text
  constraint disputes_reason_category_check
  check (reason_category in ('work_not_done', 'not_as_agreed', 'quality', 'damage', 'no_show', 'other'));
comment on column public.disputes.reason_category is
  'DEC-2026-054 item 1: the homeowner''s reason category, for reporting only. Null on disputes filed before CS-9. Set once, by the dispute commands.';

-- Only the dispute commands set it, once. Direct writes (the admin UPDATE policy, the legacy insert
-- policy) cannot set or change it.
create function private.dispute_category_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mercurius.owner_maintenance', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.reason_category is not null then
      raise exception 'Report the category through the dispute command' using errcode = '42501';
    end if;
  elsif new.reason_category is distinct from old.reason_category then
    if old.reason_category is not null or coalesce(current_setting('mercurius.dispute_category', true), '') <> new.id::text then
      raise exception 'A dispute keeps the category it was reported with' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.dispute_category_guard() from public, anon, authenticated;
create trigger dispute_category_guard before insert or update of reason_category on public.disputes
  for each row execute function private.dispute_category_guard();

create function private.dispute_set_category(p_dispute uuid, p_category text) returns void
language plpgsql security definer set search_path = '' as $$
declare current_category text;
begin
  select reason_category into current_category from public.disputes where id = p_dispute for update;
  if current_category is null then
    perform set_config('mercurius.dispute_category', p_dispute::text, true);
    update public.disputes set reason_category = p_category where id = p_dispute;
    perform set_config('mercurius.dispute_category', '', true);
  elsif current_category <> p_category then
    raise exception 'This issue was already reported with a different category' using errcode = '22023';
  end if;
end $$;
revoke all on function private.dispute_set_category(uuid, text) from public, anon, authenticated;

create function private.dispute_category_valid(p_category text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_category is null or p_category not in ('work_not_done', 'not_as_agreed', 'quality', 'damage', 'no_show', 'other') then
    raise exception 'Choose what the issue is about' using errcode = '22023';
  end if;
  return p_category;
end $$;
revoke all on function private.dispute_category_valid(text) from public, anon, authenticated;

-- JobFollowUp (completed service, inside the 48-hour window).
create function public.homeowner_raise_dispute(_job_id uuid, _reason text, _category text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare category text := private.dispute_category_valid(_category); d_id uuid;
begin
  d_id := public.homeowner_raise_dispute(_job_id, _reason);
  perform private.dispute_set_category(d_id, category);
  return d_id;
end $$;
revoke all on function public.homeowner_raise_dispute(uuid, text, text) from public, anon;
grant execute on function public.homeowner_raise_dispute(uuid, text, text) to authenticated;

-- HomeownerJobDetailDialog (the completion awaiting the homeowner's decision). A replay of the same
-- report returns the same dispute; a replay with another category is refused.
create function public.homeowner_dispute_completion(_job_id uuid, _completed_at timestamptz, _reason text, _category text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare category text := private.dispute_category_valid(_category); result jsonb;
begin
  result := public.homeowner_dispute_completion(_job_id, _completed_at, _reason);
  perform private.dispute_set_category((result ->> 'dispute_id')::uuid, category);
  return result;
end $$;
revoke all on function public.homeowner_dispute_completion(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.homeowner_dispute_completion(uuid, timestamptz, text, text) to authenticated;

-- dispute_detail: restated from 20261103001000 with one added key, reason_category.
create or replace function public.dispute_detail(_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.service_requests; viewer text; items jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view this dispute' using errcode = '42501'; end if;
  select * into r from public.service_requests where id = _job_id;
  viewer := case when private.support_is_operator() then 'operations'
    when r.customer_id = auth.uid() then 'homeowner'
    when exists(select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid()) then 'provider' end;
  if r.id is null or viewer is null then raise exception 'Not a participant in this service' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'dispute_id', d.id, 'status', d.status, 'raised_at', d.raised_at, 'reason', d.reason, 'reason_category', d.reason_category,
      'completion_at', d.completion_at, 'window_ends_at', d.completion_at + interval '48 hours',
      'resolution_version', d.resolution_version, 'resolution_notes', d.resolution_notes, 'resolved_at', d.resolved_at,
      'ticket_number', case when viewer <> 'provider' then (select t.ticket_number from public.support_tickets t where t.id = d.ticket_id) end,
      'decisions', (select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'from', x.from_status, 'to', x.to_status,
          'version', x.to_version, 'notes', x.notes, 'at', x.created_at,
          'by', case when viewer = 'operations' then coalesce((select p.full_name from public.profiles p where p.user_id = x.actor_id), 'Unknown')
            when x.action = 'appealed' then 'homeowner' else 'operations' end) order by x.seq), '[]'::jsonb)
        from public.dispute_decisions x where x.dispute_id = d.id),
      'appeals', case when viewer = 'provider' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
          'resolution_version', a.resolution_version, 'reason', a.reason, 'at', a.created_at,
          'ticket_number', t.ticket_number, 'ticket_status', t.status) order by a.created_at), '[]'::jsonb)
        from public.dispute_appeals a left join public.support_tickets t on t.id = a.ticket_id where a.dispute_id = d.id) end,
      'can_appeal', viewer = 'homeowner' and d.status = 'resolved'
        and not exists(select 1 from public.dispute_appeals a where a.dispute_id = d.id and a.resolution_version = d.resolution_version),
      'can_submit', viewer in ('homeowner', 'provider') and d.status <> 'resolved'
        and (viewer = 'homeowner' or d.vendor_id = r.contractor_id),
      'submissions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'role', s.author_role, 'statement', s.statement,
          'photo_path', jp.photo_url, 'mine', s.author_id = auth.uid(), 'at', s.created_at) order by s.seq), '[]'::jsonb)
        from public.dispute_submissions s left join public.job_photos jp on jp.id = s.photo_id where s.dispute_id = d.id)
    ) order by d.raised_at desc), '[]'::jsonb) into items
    from public.disputes d where d.job_id = r.id;
  return jsonb_build_object('job_id', r.id, 'viewer', viewer, 'status', r.status, 'checked_at', now(),
    'vendor_completed_at', r.vendor_completed_at,
    'disputes', items,
    -- Separate facts: a resolution is not a refund; an authorization is not money moved; a payout hold is the provider's.
    'refund', case when viewer in ('homeowner', 'operations') then private.support_refund_state(r.id) end,
    'payout', case when viewer in ('provider', 'operations') then private.support_payout_state(r.id, viewer = 'operations') end);
end $$;
