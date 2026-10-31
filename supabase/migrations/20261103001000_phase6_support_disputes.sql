-- Phase 6.10 / TRACE-133: support tickets, disputes, evidence, resolution and appeals.
-- Record: governance/PHASE-6-SUPPORT-BRIEF.md. Additive; requires 20261102001000.
--
-- 1. support_tickets is closed to direct client writes (F11: forged kinds, links and statuses were
--    accepted from the browser). General support opens through open_support_ticket; replies and
--    internal notes are append-only messages; triage is a versioned, reasoned operator command with
--    an append-only history. Dispute and dispute-appeal tickets follow the dispute decision.
-- 2. Disputes bind to the completion they question, keep an append-only decision history, and take
--    stale-guarded, keyed decisions and appeals. Homeowner and provider add statements and their own
--    photos of this job while the dispute is open.
-- 3. job_photos rows must name an object in the uploader's folder, and the storage read policy
--    matches the exact path (a suffix match let any participant read a known foreign path).
--
-- Not changed: money and payout kernels (fingerprint), the 48-hour window (DEC-2026-009), the
-- 72-hour review (DEC-2026-006), notification delivery, Cron, refunds and payouts. Opening support,
-- messaging, triage and evidence change no service state, money row or hold.

-- ── Tickets ────────────────────────────────────────────────────────────────────────────────────

alter table public.support_tickets
  add column opened_by uuid references auth.users(id),
  add column request_key uuid,
  add column version integer not null default 0,
  add column assigned_to uuid references auth.users(id),
  add column closed_at timestamptz,
  add constraint support_tickets_status_check check (status in ('open', 'in-progress', 'resolved', 'closed'));
create unique index support_tickets_request_key on public.support_tickets(opened_by, request_key) where request_key is not null;
create index support_tickets_queue on public.support_tickets(status, priority, response_due_at);

drop policy if exists "Users can create own tickets" on public.support_tickets;
drop policy if exists "Users can update own open tickets" on public.support_tickets;
drop policy if exists "Users can view own tickets" on public.support_tickets;
drop policy if exists "Admins can update all tickets" on public.support_tickets;
-- Operators keep direct reads until the rebuilt queue deploys; requesters read through my_support_tickets.
revoke insert, update, delete, truncate, references, trigger on public.support_tickets from public, anon, authenticated;
revoke all on public.support_tickets from anon;

create table public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id),
  author_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('requester', 'operations')),
  visibility text not null check (visibility in ('participant', 'internal')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  check (visibility = 'participant' or author_role = 'operations'),
  unique (author_id, request_key)
);
create index support_ticket_messages_ticket on public.support_ticket_messages(ticket_id, created_at);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  ticket_id uuid not null references public.support_tickets(id),
  actor_id uuid references auth.users(id),
  action text not null check (action in ('opened', 'status', 'assigned', 'next_action')),
  from_value text,
  to_value text,
  reason text,
  version integer not null,
  request_key uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);
create unique index support_ticket_events_key on public.support_ticket_events(actor_id, request_key, action) where request_key is not null;
create index support_ticket_events_ticket on public.support_ticket_events(ticket_id, seq);

alter table public.support_ticket_messages enable row level security;
alter table public.support_ticket_events enable row level security;
revoke all on public.support_ticket_messages, public.support_ticket_events from public, anon, authenticated;
grant all on public.support_ticket_messages, public.support_ticket_events to service_role;

-- Append-only records. Owner maintenance (6.9A convention) is the only way to correct one.
create function private.support_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('mercurius.owner_maintenance', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
revoke all on function private.support_append_only() from public, anon, authenticated;
create trigger support_ticket_messages_append_only before update or delete on public.support_ticket_messages
  for each row execute function private.support_append_only();
create trigger support_ticket_events_append_only before update or delete on public.support_ticket_events
  for each row execute function private.support_append_only();

-- Who opened a ticket (the requester for general support; the actor for command-generated tickets).
create function private.support_ticket_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.opened_by := coalesce(new.opened_by, auth.uid());
  new.version := 0;
  new.assigned_to := null;
  new.closed_at := case when new.status in ('resolved', 'closed') then now() end;
  return new;
end $$;
revoke all on function private.support_ticket_stamp() from public, anon, authenticated;
create trigger support_ticket_stamp before insert on public.support_tickets
  for each row execute function private.support_ticket_stamp();

-- Every status, assignment or next-action change bumps the version and is recorded, whichever
-- command made it (triage, a dispute decision or an appeal). The triage command supplies its
-- reason and key through transaction-local settings.
create function private.support_ticket_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.status, new.assigned_to, new.next_action) is distinct from (old.status, old.assigned_to, old.next_action) then
    new.version := old.version + 1;
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.closed_at := now();
    elsif new.status not in ('resolved', 'closed') then new.closed_at := null;
    end if;
  else
    new.version := old.version;
    new.closed_at := old.closed_at;
  end if;
  return new;
end $$;
revoke all on function private.support_ticket_version() from public, anon, authenticated;
create trigger support_ticket_version before update on public.support_tickets
  for each row execute function private.support_ticket_version();

create function private.support_ticket_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k uuid := nullif(current_setting('mercurius.support_key', true), '')::uuid;
  why text := nullif(current_setting('mercurius.support_reason', true), '');
  body jsonb := nullif(current_setting('mercurius.support_payload', true), '')::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.support_ticket_events(ticket_id, actor_id, action, to_value, version, request_key, payload)
      values (new.id, new.opened_by, 'opened', new.status, new.version, new.request_key, null);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.support_ticket_events(ticket_id, actor_id, action, from_value, to_value, reason, version, request_key, payload)
      values (new.id, auth.uid(), 'status', old.status, new.status, why, new.version, k, body);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.support_ticket_events(ticket_id, actor_id, action, from_value, to_value, reason, version, request_key, payload)
      values (new.id, auth.uid(), 'assigned', old.assigned_to::text, new.assigned_to::text, why, new.version, k, body);
  end if;
  if new.next_action is distinct from old.next_action then
    insert into public.support_ticket_events(ticket_id, actor_id, action, from_value, to_value, reason, version, request_key, payload)
      values (new.id, auth.uid(), 'next_action', old.next_action, new.next_action, why, new.version, k, body);
  end if;
  return new;
end $$;
revoke all on function private.support_ticket_history() from public, anon, authenticated;
create trigger support_ticket_history after insert or update on public.support_tickets
  for each row execute function private.support_ticket_history();

-- CFG-010 same-day priority covers the job's provider as well as its homeowner.
create or replace function private.route_support_ticket() returns trigger
language plpgsql security definer set search_path = public, private, pg_temp as $$
declare local_now timestamp := now() at time zone 'America/New_York'; appointment date;
begin
  new.queue_owner := 'project_owner';
  new.next_action := case when nullif(btrim(new.next_action), '') is not null then new.next_action else
    case new.issue_type
      when 'dispute' then 'Review completion evidence and contact both parties'
      when 'dispute_appeal' then 'Review the prior resolution and homeowner appeal'
      when 'review_appeal' then 'Review original content and moderation reason'
      when 'schedule_exception' then 'Review service exception, replacement options and policy consequences'
      else 'Review and respond to the customer' end
    end;
  new.priority := 'standard';
  new.response_due_at := private.support_response_deadline(now());
  select coalesce((sr.scheduled_start_at at time zone 'America/New_York')::date, sr.preferred_date)
    into appointment from public.service_requests sr left join public.contractors c on c.id = sr.contractor_id
    where sr.id::text = new.job_id and (sr.customer_id = new.user_id or c.user_id = new.user_id);
  if appointment = local_now::date and extract(isodow from local_now) <= 5 and local_now::time >= time '09:00' and local_now::time < time '17:00' then
    new.priority := 'same_day'; new.response_due_at := (local_now::date + time '17:00') at time zone 'America/New_York';
  end if;
  return new;
end $$;

-- A ticket's requester view: the caller requested it and opened it themselves (or it predates 6.10).
-- Operator-filed work items on a homeowner's service stay in the operations queue.
create function private.support_is_requester(t public.support_tickets) returns boolean
language sql stable set search_path = '' as $$
  select auth.uid() is not null and t.user_id = auth.uid() and (t.opened_by is null or t.opened_by = auth.uid())
$$;
revoke all on function private.support_is_requester(public.support_tickets) from public, anon, authenticated;

create function private.support_is_operator() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(public.has_role(auth.uid(), 'admin'), false)
$$;
revoke all on function private.support_is_operator() from public, anon, authenticated;

create function public.open_support_ticket(_request_key uuid, _subject text, _description text, _job_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; r public.service_requests; subj text := btrim(coalesce(_subject, ''));
  body text := btrim(coalesce(_description, '')); admin_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to contact support' using errcode = '42501'; end if;
  if _request_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  if length(subj) not between 1 and 160 then raise exception 'Add a subject of up to 160 characters' using errcode = '22023'; end if;
  if length(body) not between 1 and 4000 then raise exception 'Describe the issue in up to 4,000 characters' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('support:' || auth.uid()::text || ':' || _request_key::text, 0));
  select * into t from public.support_tickets where opened_by = auth.uid() and request_key = _request_key;
  if t.id is not null then
    if (t.subject, t.description, t.job_id) is distinct from (subj, body, _job_id::text) then
      raise exception 'This request key was already used for a different request' using errcode = '22023';
    end if;
    return jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'replayed', true);
  end if;
  if _job_id is not null then
    select sr.* into r from public.service_requests sr where sr.id = _job_id;
    if r.id is null or not (r.customer_id = auth.uid()
        or exists(select 1 from public.contractors c where c.id = r.contractor_id and c.user_id = auth.uid())) then
      raise exception 'Link a service you are part of' using errcode = '42501';
    end if;
  end if;
  insert into public.support_tickets(user_id, subject, description, issue_type, job_id, opened_by, request_key)
    values (auth.uid(), subj, body, 'general', _job_id::text, auth.uid(), _request_key) returning * into t;
  for admin_id in select user_id from public.user_roles where role = 'admin' loop
    perform public.notify_user(admin_id, 'support', 'info', 'Support request ' || t.ticket_number, subj, '/admin/tickets', _job_id, r.contractor_id);
  end loop;
  return jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'replayed', false);
end $$;

create function private.support_message_insert(t public.support_tickets, k uuid, b text, role text, vis text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.support_ticket_messages; body text := btrim(coalesce(b, ''));
begin
  if k is null then raise exception 'Request key required' using errcode = '22023'; end if;
  if length(body) not between 1 and 4000 then raise exception 'Write a message of up to 4,000 characters' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('support-message:' || auth.uid()::text || ':' || k::text, 0));
  select * into m from public.support_ticket_messages where author_id = auth.uid() and request_key = k;
  if m.id is not null then
    if (m.ticket_id, m.body, m.visibility) is distinct from (t.id, body, vis) then
      raise exception 'This request key was already used for a different message' using errcode = '22023';
    end if;
    return jsonb_build_object('message_id', m.id, 'replayed', true);
  end if;
  insert into public.support_ticket_messages(ticket_id, author_id, author_role, visibility, body, request_key)
    values (t.id, auth.uid(), role, vis, body, k) returning * into m;
  update public.support_tickets set updated_at = now() where id = t.id;
  return jsonb_build_object('message_id', m.id, 'replayed', false);
end $$;
revoke all on function private.support_message_insert(public.support_tickets, uuid, text, text, text) from public, anon, authenticated;

create function public.post_support_message(_ticket_id uuid, _request_key uuid, _body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; operator boolean := private.support_is_operator(); admin_id uuid; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to contact support' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = _ticket_id for update;
  if t.id is null or not (operator or private.support_is_requester(t)) then
    raise exception 'Not your support request' using errcode = '42501';
  end if;
  if not operator and t.status not in ('open', 'in-progress')
      and not exists(select 1 from public.support_ticket_messages where author_id = auth.uid() and request_key = _request_key) then
    raise exception 'This request is %. Open a new request if you still need help', t.status using errcode = '22023';
  end if;
  result := private.support_message_insert(t, _request_key, _body, case when operator then 'operations' else 'requester' end, 'participant');
  if not operator and not (result->>'replayed')::boolean then
    for admin_id in select user_id from public.user_roles where role = 'admin' loop
      perform public.notify_user(admin_id, 'support', 'info', 'Reply on ' || t.ticket_number, t.subject, '/admin/tickets', null, null);
    end loop;
  elsif operator and not (result->>'replayed')::boolean then
    perform public.notify_user(t.user_id, 'support', 'info', 'Mercurius replied on ' || t.ticket_number, t.subject, '/support', null, null);
  end if;
  return result;
end $$;

create function public.add_support_note(_ticket_id uuid, _request_key uuid, _body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets;
begin
  if not private.support_is_operator() then raise exception 'Operations access required' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = _ticket_id for update;
  if t.id is null then raise exception 'Support request not found' using errcode = '22023'; end if;
  return private.support_message_insert(t, _request_key, _body, 'operations', 'internal');
end $$;

create function public.admin_update_support_ticket(_ticket_id uuid, _request_key uuid, _expected_version integer,
  _status text default null, _assigned_to uuid default null, _next_action text default null, _reason text default null,
  _unassign boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.support_tickets; prior public.support_ticket_events; job uuid; why text := btrim(coalesce(_reason, ''));
  next_status text; next_owner uuid; next_step text; payload jsonb; review public.reviews;
begin
  if not private.support_is_operator() then raise exception 'Operations access required' using errcode = '42501'; end if;
  if _request_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  payload := jsonb_build_object('ticket_id', _ticket_id, 'expected_version', _expected_version, 'status', _status,
    'assigned_to', _assigned_to, 'unassign', coalesce(_unassign, false), 'next_action', nullif(btrim(coalesce(_next_action, '')), ''), 'reason', why);
  select * into t from public.support_tickets where id = _ticket_id;
  if t.id is null then raise exception 'Support request not found' using errcode = '22023'; end if;
  -- Same lock order as the dispute commands: request, then ticket.
  if t.job_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    job := t.job_id::uuid;
    perform pg_advisory_xact_lock(hashtextextended(job::text, 0));
  end if;
  select * into t from public.support_tickets where id = _ticket_id for update;
  select * into prior from public.support_ticket_events where actor_id = auth.uid() and request_key = _request_key order by seq limit 1;
  if prior.id is not null then
    if prior.payload is distinct from payload then
      raise exception 'This request key was already used for a different change' using errcode = '22023';
    end if;
    return jsonb_build_object('ticket_id', t.id, 'version', t.version, 'status', t.status, 'replayed', true);
  end if;
  if length(why) not between 1 and 2000 then raise exception 'Record a reason for this change' using errcode = '22023'; end if;
  if _expected_version is distinct from t.version then
    raise exception 'This request changed since you opened it. Reload and try again' using errcode = '40001';
  end if;
  next_status := coalesce(_status, t.status);
  next_owner := case when coalesce(_unassign, false) then null else coalesce(_assigned_to, t.assigned_to) end;
  next_step := coalesce(nullif(btrim(coalesce(_next_action, '')), ''), t.next_action);
  if next_status not in ('open', 'in-progress', 'resolved', 'closed') then
    raise exception 'Unknown status %', next_status using errcode = '22023';
  end if;
  if next_status is distinct from t.status then
    if t.issue_type in ('dispute', 'dispute_appeal') then
      raise exception 'This ticket follows its dispute. Record the dispute decision instead' using errcode = '22023';
    end if;
    if t.issue_type = 'review_appeal' and next_status in ('resolved', 'closed') then
      select rv.* into review from public.review_history h join public.reviews rv on rv.id = h.review_id where h.ticket_id = t.id limit 1;
      if review.id is not null and review.moderation_state = 'appealed' then
        raise exception 'Decide the review appeal before closing its ticket' using errcode = '22023';
      end if;
    end if;
  end if;
  if next_owner is not null and next_owner is distinct from t.assigned_to and not coalesce(public.has_role(next_owner, 'admin'), false) then
    raise exception 'Assign the request to an operator' using errcode = '22023';
  end if;
  if (next_status, next_owner, next_step) is not distinct from (t.status, t.assigned_to, t.next_action) then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  perform set_config('mercurius.support_key', _request_key::text, true);
  perform set_config('mercurius.support_reason', why, true);
  perform set_config('mercurius.support_payload', payload::text, true);
  update public.support_tickets set status = next_status, assigned_to = next_owner, next_action = next_step, updated_at = now()
    where id = t.id returning * into t;
  perform set_config('mercurius.support_key', '', true);
  perform set_config('mercurius.support_reason', '', true);
  perform set_config('mercurius.support_payload', '', true);
  return jsonb_build_object('ticket_id', t.id, 'version', t.version, 'status', t.status, 'replayed', false);
end $$;

-- ── Disputes ───────────────────────────────────────────────────────────────────────────────────

alter table public.disputes add column completion_at timestamptz;

-- A dispute questions the completion recorded when it was filed (rework later changes the job's
-- completion time, not this record).
create function private.dispute_bind_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select vendor_completed_at into new.completion_at from public.service_requests where id = new.job_id;
  return new;
end $$;
revoke all on function private.dispute_bind_completion() from public, anon, authenticated;
create trigger dispute_bind_completion before insert on public.disputes
  for each row execute function private.dispute_bind_completion();
create function private.dispute_completion_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.completion_at is distinct from old.completion_at and coalesce(current_setting('mercurius.owner_maintenance', true), '') <> 'on' then
    raise exception 'A dispute stays bound to the completion it questioned' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.dispute_completion_immutable() from public, anon, authenticated;
create trigger dispute_completion_immutable before update on public.disputes
  for each row execute function private.dispute_completion_immutable();

create table public.dispute_decisions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  dispute_id uuid not null references public.disputes(id),
  actor_id uuid references auth.users(id),
  action text not null check (action in ('decided', 'appealed')),
  from_status public.dispute_status not null,
  to_status public.dispute_status not null,
  from_version integer not null,
  to_version integer not null,
  notes text,
  request_key uuid,
  created_at timestamptz not null default now()
);
create unique index dispute_decisions_key on public.dispute_decisions(actor_id, request_key) where request_key is not null;
create index dispute_decisions_dispute on public.dispute_decisions(dispute_id, seq);
alter table public.dispute_decisions enable row level security;
revoke all on public.dispute_decisions from public, anon, authenticated;
grant all on public.dispute_decisions to service_role;
create trigger dispute_decisions_append_only before update or delete on public.dispute_decisions
  for each row execute function private.support_append_only();

-- Every status change is recorded, through the old or the new command.
create function private.dispute_record_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.dispute_decisions(dispute_id, actor_id, action, from_status, to_status, from_version, to_version, notes, request_key)
      values (new.id, auth.uid(), case when new.status = 'escalated' then 'appealed' else 'decided' end, old.status, new.status,
        old.resolution_version, new.resolution_version,
        case when new.status = 'escalated' then null else new.resolution_notes end,
        nullif(current_setting('mercurius.dispute_key', true), '')::uuid);
  end if;
  return new;
end $$;
revoke all on function private.dispute_record_decision() from public, anon, authenticated;
create trigger dispute_record_decision after update on public.disputes
  for each row execute function private.dispute_record_decision();

create function public.admin_decide_dispute(_dispute_id uuid, _request_key uuid, _expected_status public.dispute_status,
  _expected_version integer, _status public.dispute_status, _notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.disputes; prior public.dispute_decisions; why text := btrim(coalesce(_notes, ''));
begin
  if not private.support_is_operator() then raise exception 'Only operations can decide disputes' using errcode = '42501'; end if;
  if _request_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  select * into d from public.disputes where id = _dispute_id;
  if d.id is null then raise exception 'Dispute not found' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(d.job_id::text, 0));
  select * into d from public.disputes where id = _dispute_id for update;
  select * into prior from public.dispute_decisions where actor_id = auth.uid() and request_key = _request_key;
  if prior.id is not null then
    if (prior.dispute_id, prior.to_status, prior.notes) is distinct from (d.id, _status, why) then
      raise exception 'This request key was already used for a different decision' using errcode = '22023';
    end if;
    return jsonb_build_object('dispute_id', d.id, 'status', d.status, 'resolution_version', d.resolution_version, 'replayed', true);
  end if;
  if (d.status, d.resolution_version) is distinct from (_expected_status, _expected_version) then
    raise exception 'This dispute changed since you opened it. Reload and try again' using errcode = '40001';
  end if;
  perform set_config('mercurius.dispute_key', _request_key::text, true);
  perform public.admin_resolve_dispute(_dispute_id, _status, why);
  perform set_config('mercurius.dispute_key', '', true);
  select * into d from public.disputes where id = _dispute_id;
  return jsonb_build_object('dispute_id', d.id, 'status', d.status, 'resolution_version', d.resolution_version, 'replayed', false);
end $$;

-- An appeal answers the decision the homeowner read.
create function public.appeal_dispute_resolution(_dispute_id uuid, _reason text, _expected_version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.disputes; existing uuid;
begin
  select * into d from public.disputes where id = _dispute_id;
  if auth.uid() is null or d.homeowner_id is distinct from auth.uid() then
    raise exception 'Only the homeowner can appeal' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(d.job_id::text, 0));
  select * into d from public.disputes where id = _dispute_id for update;
  select ticket_id into existing from public.dispute_appeals where dispute_id = d.id and resolution_version = _expected_version;
  if existing is not null then return existing; end if;
  if d.resolution_version is distinct from _expected_version then
    raise exception 'The decision changed since you read it. Reload to see the current decision' using errcode = '40001';
  end if;
  return public.appeal_dispute_resolution(_dispute_id, _reason);
end $$;

create table public.dispute_submissions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  dispute_id uuid not null references public.disputes(id),
  author_id uuid not null references auth.users(id),
  author_role text not null check (author_role in ('homeowner', 'provider')),
  statement text check (statement is null or length(btrim(statement)) between 1 and 2000),
  photo_id uuid references public.job_photos(id),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  check (statement is not null or photo_id is not null),
  unique (author_id, request_key)
);
create unique index dispute_submissions_photo on public.dispute_submissions(dispute_id, photo_id) where photo_id is not null;
create index dispute_submissions_dispute on public.dispute_submissions(dispute_id, seq);
alter table public.dispute_submissions enable row level security;
revoke all on public.dispute_submissions from public, anon, authenticated;
grant all on public.dispute_submissions to service_role;
create trigger dispute_submissions_append_only before update or delete on public.dispute_submissions
  for each row execute function private.support_append_only();

-- A photo is evidence only for its own job, from its own uploader's folder.
create function private.dispute_photo_retained() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.dispute_submissions s where s.photo_id = old.id) then
    raise exception 'This photo is dispute evidence and is kept' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function private.dispute_photo_retained() from public, anon, authenticated;
create trigger dispute_photo_retained before delete on public.job_photos
  for each row execute function private.dispute_photo_retained();

create function public.add_dispute_submission(_dispute_id uuid, _request_key uuid, _statement text default null, _photo_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.disputes; s public.dispute_submissions; p public.job_photos; role text;
  stmt text := nullif(btrim(coalesce(_statement, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in to add evidence' using errcode = '42501'; end if;
  if _request_key is null then raise exception 'Request key required' using errcode = '22023'; end if;
  select * into d from public.disputes where id = _dispute_id;
  if d.id is null then raise exception 'Not a participant in this dispute' using errcode = '42501'; end if;
  role := case when d.homeowner_id = auth.uid() then 'homeowner'
    when exists(select 1 from public.contractors c join public.service_requests sr on sr.contractor_id = c.id
      where c.id = d.vendor_id and sr.id = d.job_id and c.user_id = auth.uid()) then 'provider' end;
  if role is null then raise exception 'Not a participant in this dispute' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(d.job_id::text, 0));
  select * into d from public.disputes where id = _dispute_id for update;
  select * into s from public.dispute_submissions where author_id = auth.uid() and request_key = _request_key;
  if s.id is not null then
    if (s.dispute_id, s.statement, s.photo_id) is distinct from (d.id, stmt, _photo_id) then
      raise exception 'This request key was already used for a different submission' using errcode = '22023';
    end if;
    return jsonb_build_object('submission_id', s.id, 'replayed', true);
  end if;
  if d.status = 'resolved' then
    raise exception 'This dispute has a decision. Appeal the decision instead' using errcode = '22023';
  end if;
  if stmt is null and _photo_id is null then raise exception 'Add a statement or a photo' using errcode = '22023'; end if;
  if length(stmt) > 2000 then raise exception 'Keep the statement to 2,000 characters' using errcode = '22023'; end if;
  if _photo_id is not null then
    select * into p from public.job_photos where id = _photo_id;
    if p.id is null or p.service_request_id <> d.job_id or p.uploaded_by <> auth.uid()
        or split_part(p.photo_url, '/', 1) <> auth.uid()::text then
      raise exception 'Attach a photo you uploaded to this service' using errcode = '42501';
    end if;
    if exists(select 1 from public.dispute_submissions where dispute_id = d.id and photo_id = _photo_id) then
      raise exception 'That photo is already attached' using errcode = '22023';
    end if;
  end if;
  insert into public.dispute_submissions(dispute_id, author_id, author_role, statement, photo_id, request_key)
    values (d.id, auth.uid(), role, stmt, _photo_id, _request_key) returning * into s;
  perform public.log_job_event(d.job_id, 'status_changed', auth.uid(), jsonb_build_object('action', 'dispute_submission',
    'dispute_id', d.id, 'submission_id', s.id, 'role', role, 'photo', _photo_id is not null));
  return jsonb_build_object('submission_id', s.id, 'replayed', false);
end $$;

-- ── Reads ──────────────────────────────────────────────────────────────────────────────────────

-- Refund authorization and movement for a service, from the money tables (no entitlement claim).
create function private.support_refund_state(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; authorized bigint := 0; settled bigint := 0; in_flight bigint := 0; failed bigint := 0;
  unknown bigint := 0; not_sent bigint := 0;
begin
  select * into o from public.money_obligations where service_request_id = p_request;
  if o.id is null then return jsonb_build_object('authorization', 'none', 'movement', 'none', 'payment_record', false); end if;
  select coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null), 0),
         coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is not null
           and not exists(select 1 from public.money_refund_late_failures lf where lf.authorization_id = a.id
             and not exists(select 1 from public.money_refund_resettlements rs where rs.authorization_id = a.id))), 0),
         coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null and t.status = 'pending'), 0),
         coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and (
           (f.authorization_id is null and t.status = 'failed') or exists(select 1 from public.money_refund_late_failures lf
             where lf.authorization_id = a.id and not exists(select 1 from public.money_refund_resettlements rs where rs.authorization_id = a.id)))), 0),
         coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null and t.status = 'reconcile'), 0),
         coalesce(sum(a.service + a.tax + a.tip) filter (where z.authorization_id is null and f.authorization_id is null
           and (t.authorization_id is null or t.status = 'prepared')), 0)
    into authorized, settled, in_flight, failed, unknown, not_sent
    from public.money_refund_authorizations a
    left join public.money_refund_releases z on z.authorization_id = a.id
    left join public.money_refunds f on f.authorization_id = a.id
    left join public.money_refund_attempts t on t.authorization_id = a.id
    where a.obligation_id = o.id;
  return jsonb_build_object('payment_record', true,
    'authorization', case when authorized = 0 then 'none' else 'authorized' end, 'authorized', authorized,
    'movement', case when authorized = 0 then 'none' when failed > 0 then 'failed' when unknown > 0 then 'unknown'
      when in_flight > 0 then 'in_flight' when not_sent > 0 then 'not_sent' when settled >= authorized then 'settled'
      when settled > 0 then 'partly_settled' else 'none' end,
    'settled', settled, 'in_flight', in_flight, 'failed', failed, 'unknown', unknown, 'not_sent', not_sent);
end $$;
revoke all on function private.support_refund_state(uuid) from public, anon, authenticated;

-- Provider payout as the payout kernel reports it (same mapping as job_fulfillment).
create function private.support_payout_state(p_request uuid, p_admin boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o public.money_obligations; blocker text;
begin
  select * into o from public.money_obligations where service_request_id = p_request;
  if o.id is null then return jsonb_build_object('state', 'no_payment_record'); end if;
  begin
    blocker := private.money_ach_payable(o.id)->>'blocker';
  exception when others then
    blocker := 'unavailable';
  end;
  return jsonb_build_object('state', case
      when blocker is null then 'eligible'
      when blocker = 'dispute_hold' then 'dispute_hold'
      when blocker = 'awaiting_confirmation' then 'awaiting_confirmation'
      when blocker = 'confirmation_window' then 'confirmation_window'
      when blocker = 'payment_incomplete' then 'payment_incomplete'
      when blocker = 'payout_onboarding' then 'onboarding'
      when blocker = 'already_paid' then 'paid'
      when blocker = 'no_payable' then 'nothing_payable'
      when blocker = 'unavailable' then 'unavailable'
      else 'held' end)
    || case when p_admin then jsonb_build_object('blocker', blocker) else '{}'::jsonb end;
end $$;
revoke all on function private.support_payout_state(uuid, boolean) from public, anon, authenticated;

create function public.dispute_detail(_job_id uuid) returns jsonb
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
      'dispute_id', d.id, 'status', d.status, 'raised_at', d.raised_at, 'reason', d.reason,
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

create function private.support_ticket_json(t public.support_tickets, operator boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'subject', t.subject, 'description', t.description,
      'kind', t.issue_type, 'status', t.status, 'created_at', t.created_at, 'updated_at', t.updated_at, 'closed_at', t.closed_at,
      'response_due_at', t.response_due_at, 'priority', t.priority, 'version', t.version,
      'job', (select jsonb_build_object('id', sr.id, 'service_type', sr.service_type, 'status', sr.status)
        from public.service_requests sr where sr.id::text = t.job_id),
      'can_reply', operator or t.status in ('open', 'in-progress'),
      'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'role', m.author_role, 'visibility', m.visibility,
          'body', m.body, 'at', m.created_at, 'mine', m.author_id = auth.uid())
          || case when operator then jsonb_build_object('author', (select p.full_name from public.profiles p where p.user_id = m.author_id)) else '{}'::jsonb end
          order by m.created_at, m.id), '[]'::jsonb)
        from public.support_ticket_messages m where m.ticket_id = t.id and (operator or m.visibility = 'participant')))
  || case when operator then jsonb_build_object(
      'requester', jsonb_build_object('user_id', t.user_id, 'name', (select p.full_name from public.profiles p where p.user_id = t.user_id),
        'role', case when exists(select 1 from public.contractors c where c.user_id = t.user_id) then 'provider' else 'homeowner' end),
      'opened_by', (select p.full_name from public.profiles p where p.user_id = t.opened_by),
      'queue_owner', t.queue_owner, 'next_action', t.next_action,
      'assigned_to', t.assigned_to, 'assignee', (select p.full_name from public.profiles p where p.user_id = t.assigned_to),
      'overdue', t.status in ('open', 'in-progress') and t.response_due_at < now(),
      'dispute', (select jsonb_build_object('dispute_id', d.id, 'status', d.status, 'resolution_version', d.resolution_version)
        from public.disputes d where d.ticket_id = t.id or d.id = (select a.dispute_id from public.dispute_appeals a where a.ticket_id = t.id)),
      'review_appeal', (select jsonb_build_object('review_id', rv.id, 'moderation_state', rv.moderation_state,
          'decided', rv.moderation_state <> 'appealed')
        from public.review_history h join public.reviews rv on rv.id = h.review_id where h.ticket_id = t.id limit 1),
      'history', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'from', e.from_value, 'to', e.to_value,
          'reason', e.reason, 'version', e.version, 'at', e.created_at,
          'by', (select p.full_name from public.profiles p where p.user_id = e.actor_id)) order by e.seq), '[]'::jsonb)
        from public.support_ticket_events e where e.ticket_id = t.id))
    else '{}'::jsonb end
$$;
revoke all on function private.support_ticket_json(public.support_tickets, boolean) from public, anon, authenticated;

create function public.my_support_tickets() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in to view your support requests' using errcode = '42501'; end if;
  return jsonb_build_object('checked_at', now(), 'items', (select coalesce(jsonb_agg(private.support_ticket_json(t, false)
      order by (t.status in ('open', 'in-progress')) desc, t.updated_at desc), '[]'::jsonb)
    from public.support_tickets t where private.support_is_requester(t)));
end $$;

create function public.support_ticket_detail(_ticket_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.support_tickets; operator boolean := private.support_is_operator();
begin
  if auth.uid() is null then raise exception 'Sign in to view this request' using errcode = '42501'; end if;
  select * into t from public.support_tickets where id = _ticket_id;
  if t.id is null or not (operator or private.support_is_requester(t)) then
    raise exception 'Not your support request' using errcode = '42501';
  end if;
  return private.support_ticket_json(t, operator);
end $$;

create function public.admin_support_queue(_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.support_is_operator() then raise exception 'Operations access required' using errcode = '42501'; end if;
  return jsonb_build_object('checked_at', now(),
    'counts', (select jsonb_build_object(
        'open', count(*) filter (where status in ('open', 'in-progress')),
        'overdue', count(*) filter (where status in ('open', 'in-progress') and response_due_at < now()),
        'same_day', count(*) filter (where status in ('open', 'in-progress') and priority = 'same_day'),
        'unassigned', count(*) filter (where status in ('open', 'in-progress') and assigned_to is null))
      from public.support_tickets),
    'operators', (select coalesce(jsonb_agg(jsonb_build_object('user_id', ur.user_id,
        'name', coalesce((select p.full_name from public.profiles p where p.user_id = ur.user_id), 'Operator')) order by ur.user_id), '[]'::jsonb)
      from public.user_roles ur where ur.role = 'admin'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'subject', t.subject,
        'kind', t.issue_type, 'status', t.status, 'priority', t.priority, 'created_at', t.created_at, 'updated_at', t.updated_at,
        'response_due_at', t.response_due_at, 'overdue', t.status in ('open', 'in-progress') and t.response_due_at < now(),
        'next_action', t.next_action, 'queue_owner', t.queue_owner, 'version', t.version,
        'assigned_to', t.assigned_to, 'assignee', (select p.full_name from public.profiles p where p.user_id = t.assigned_to),
        'requester', (select p.full_name from public.profiles p where p.user_id = t.user_id),
        'job_id', t.job_id,
        'dispute_status', (select d.status from public.disputes d where d.ticket_id = t.id
          or d.id = (select a.dispute_id from public.dispute_appeals a where a.ticket_id = t.id)),
        'decision_recorded', case when t.issue_type = 'review_appeal' then (select rv.moderation_state <> 'appealed'
          from public.review_history h join public.reviews rv on rv.id = h.review_id where h.ticket_id = t.id limit 1) end,
        'messages', (select count(*) from public.support_ticket_messages m where m.ticket_id = t.id and m.visibility = 'participant'))
        order by (t.status in ('open', 'in-progress')) desc, (t.priority = 'same_day') desc, t.response_due_at nulls last, t.created_at), '[]'::jsonb)
      from public.support_tickets t where _include_closed or t.status in ('open', 'in-progress')));
end $$;

revoke all on function public.open_support_ticket(uuid, text, text, uuid), public.post_support_message(uuid, uuid, text),
  public.add_support_note(uuid, uuid, text),
  public.admin_update_support_ticket(uuid, uuid, integer, text, uuid, text, text, boolean),
  public.admin_decide_dispute(uuid, uuid, public.dispute_status, integer, public.dispute_status, text),
  public.appeal_dispute_resolution(uuid, text, integer), public.add_dispute_submission(uuid, uuid, text, uuid),
  public.dispute_detail(uuid), public.my_support_tickets(), public.support_ticket_detail(uuid), public.admin_support_queue(boolean)
  from public, anon;
grant execute on function public.open_support_ticket(uuid, text, text, uuid), public.post_support_message(uuid, uuid, text),
  public.add_support_note(uuid, uuid, text),
  public.admin_update_support_ticket(uuid, uuid, integer, text, uuid, text, text, boolean),
  public.admin_decide_dispute(uuid, uuid, public.dispute_status, integer, public.dispute_status, text),
  public.appeal_dispute_resolution(uuid, text, integer), public.add_dispute_submission(uuid, uuid, text, uuid),
  public.dispute_detail(uuid), public.my_support_tickets(), public.support_ticket_detail(uuid), public.admin_support_queue(boolean)
  to authenticated;

-- ── Evidence access ────────────────────────────────────────────────────────────────────────────

create function private.job_photo_own_folder() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and split_part(new.photo_url, '/', 1) is distinct from auth.uid()::text then
    raise exception 'A photo record must point at your own upload' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.job_photo_own_folder() from public, anon, authenticated;
create trigger job_photo_own_folder before insert or update on public.job_photos
  for each row execute function private.job_photo_own_folder();

drop policy if exists "Job participants can view job photos" on storage.objects;
create policy "Job participants can view job photos" on storage.objects for select to authenticated using (
  bucket_id = 'job-photos' and (
    (auth.uid())::text = (storage.foldername(name))[1]
    or public.has_role(auth.uid(), 'admin')
    or exists (select 1 from public.job_photos jp
      join public.service_requests sr on sr.id = jp.service_request_id
      left join public.contractors c on c.id = sr.contractor_id
      where jp.photo_url = objects.name and (sr.customer_id = auth.uid() or c.user_id = auth.uid()))));
