-- Phase 7.5D (TRACE-159): support "overdue" means awaiting a first reply past its target (DF-3).
-- Contract: governance/PHASE-7-OPERATIONS-QUEUES-CONTRACT.md §5.3 DF-3 and §9 CD-1, with Codex's
-- 7.5D directions R-1..R-7. Record: governance/PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md.
--
-- Before: overdue = open or in progress and response_due_at < now(). That measures "still open after
-- the target", so a ticket answered in time became overdue once its due time passed.
-- After: overdue = open or in progress, no qualifying reply, and response_due_at < now().
--
-- A qualifying reply is the earliest support message with author_role = 'operations' and
-- visibility = 'participant' (the message row itself; CD-1, R-2). It is a recorded reply only: not
-- proof that any requester could open it, received a notice or read it. Internal notes, requester
-- messages, assignment, next-action and status changes are not replies.
--
-- Unchanged: the CFG-010 target and its routing (support_response_deadline, route_support_ticket,
-- protect_ticket_queue_fields); a reopened ticket keeps its original response_due_at and its first
-- reply. Queue membership and order, every other key, grants, requester access and the requester
-- payload are unchanged. admin_operations_summary is not restated: it reads the queue items' overdue.
-- No table, column, index, policy, trigger or data change. No new SLA policy.
--
-- 1. One predicate for every reader: the first qualifying reply's time, or null.
create function private.support_first_response_at(_ticket_id uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select min(m.created_at) from public.support_ticket_messages m
  where m.ticket_id = _ticket_id and m.author_role = 'operations' and m.visibility = 'participant'
$$;
revoke all on function private.support_first_response_at(uuid) from public, anon, authenticated;

-- 2. Ticket detail: the operator branch gains first_response_at and the repaired overdue. The
-- requester branch is unchanged. Otherwise the 20261103001000 body, verbatim.
create or replace function private.support_ticket_json(t public.support_tickets, operator boolean) returns jsonb
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
      'first_response_at', private.support_first_response_at(t.id),
      'overdue', t.status in ('open', 'in-progress') and t.response_due_at < now() and private.support_first_response_at(t.id) is null,
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

-- 3. Operations queue: counts.overdue and items[].overdue use the repaired rule; items gain
-- first_response_at. Membership filter, ordering and every other key unchanged. Otherwise the
-- 20261103001000 body, verbatim.
create or replace function public.admin_support_queue(_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.support_is_operator() then raise exception 'Operations access required' using errcode = '42501'; end if;
  return jsonb_build_object('checked_at', now(),
    'counts', (select jsonb_build_object(
        'open', count(*) filter (where status in ('open', 'in-progress')),
        'overdue', count(*) filter (where status in ('open', 'in-progress') and response_due_at < now() and private.support_first_response_at(id) is null),
        'same_day', count(*) filter (where status in ('open', 'in-progress') and priority = 'same_day'),
        'unassigned', count(*) filter (where status in ('open', 'in-progress') and assigned_to is null))
      from public.support_tickets),
    'operators', (select coalesce(jsonb_agg(jsonb_build_object('user_id', ur.user_id,
        'name', coalesce((select p.full_name from public.profiles p where p.user_id = ur.user_id), 'Operator')) order by ur.user_id), '[]'::jsonb)
      from public.user_roles ur where ur.role = 'admin'),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('ticket_id', t.id, 'ticket_number', t.ticket_number, 'subject', t.subject,
        'kind', t.issue_type, 'status', t.status, 'priority', t.priority, 'created_at', t.created_at, 'updated_at', t.updated_at,
        'response_due_at', t.response_due_at, 'first_response_at', private.support_first_response_at(t.id),
        'overdue', t.status in ('open', 'in-progress') and t.response_due_at < now() and private.support_first_response_at(t.id) is null,
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
