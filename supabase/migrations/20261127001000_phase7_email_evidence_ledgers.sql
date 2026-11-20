-- TRACE-155 (Phase 7.3C-2): application and price-draft delivery-evidence readbacks.
--
-- Plan: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md §7.3, §8.3, §8.4, §9.1 and §11.4.
-- Record: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-2.md. Codex review 5985392153 on #180
-- cleared the shared 7.3C-1 source for this local, dormant slice.
--
-- Functions and grants only. No table, column, constraint, trigger, policy or existing grant
-- changes, and no existing function is restated: the application ledger (r0_*notification*),
-- the price-draft notice functions, the 7.3B receiver and purge, the 7.3C-1 functions and every
-- money-fingerprinted function keep their definitions. Neither ledger needs a correlation
-- lookup: an application row's key is its application_id, and a price-draft claim already
-- returns the claimed notice_id, so the senders build their tags from the claim itself.
--
-- Reuse, not reinterpretation. Every receipt is judged by 7.3C-1's single trust and expiry
-- predicate (private.email_evidence_receipt_state, which applies the §7.3 recheck across all
-- three ledgers, including the conservative whole-row check accepted in Codex review
-- 5985392153), mapped by private.email_evidence_fact and summarized by
-- private.email_evidence_summary. The per-row functions below only choose which receipts concern
-- a row and when its attempts were claimed; they have the same structure as the owner-email
-- helpers so the three readbacks agree (SQL 124 compares them on identical scenarios).
--
-- Claim times come from existing evidence only (rule 9 versus 10, §8.4):
--   application    the attempt's `sending` audit event, or the row's claimed_at for its current
--                  attempt;
--   price draft    the notice's claimed_at for its current attempt only. Notices keep no
--                  per-attempt history, so an earlier attempt's claim time is unknown and stays
--                  null; an empty fact set then reads rule 10, never rule 9.
--
-- Counts keep two scopes apart: `ledger` counts concern only that ledger's rows; `all_emails`
-- (receiver state, conflicting and unmatched reports, retention backlog) is global, because an
-- unlinked or conflicted receipt belongs to no single ledger. Existing attention counts are
-- unchanged and stay in their overviews.
--
-- Every function here is STABLE and performs no write: no purge, flag, quarantine row or
-- arming-record write happens on the read side.

set lock_timeout = '2s';

-- 1. Claim times -----------------------------------------------------------------------------

create function private.email_evidence_ledger_claimed_at(p_ledger text, p_ref uuid, p_attempt integer)
returns timestamptz language sql stable set search_path = '' as $$
  select case p_ledger
    when 'application' then coalesce(
      (select min(ev.created_at) from private.r0_application_notification_events ev
        where ev.application_id = p_ref and ev.state = 'sending' and ev.attempt = p_attempt),
      (select n.claimed_at from private.r0_application_notifications n
        where n.application_id = p_ref and n.attempts = p_attempt))
    when 'package_draft' then
      (select n.claimed_at from private.package_draft_email_notices n where n.id = p_ref and n.attempts = p_attempt)
  end
$$;

-- 2. Receipts that concern one row -----------------------------------------------------------

-- Every unexpired receipt that concerns one application or price-draft ledger row, with its
-- read-time state:
--   linked receipts, on their linked attempt;
--   stored identity conflicts whose tag names the row, on their tag attempt;
--   stored identity conflicts whose provider ID is the row's recorded ID, on its sent attempt.
-- An unmatched receipt is never rematched on read, even if the row later records its ID. Any
-- other ledger name selects no row.
create function private.email_evidence_ledger_receipts(p_ledger text, p_ref uuid)
returns table(attempt integer, receipt_state text, fact text, provider_created_at timestamptz,
              bounce_type text, bounce_subtype text, received_at timestamptz, svix_id text)
language sql stable set search_path = '' as $$
  with n as (
    select x.application_id as id, x.attempts, x.provider_message_id
      from private.r0_application_notifications x where p_ledger = 'application' and x.application_id = p_ref
    union all
    select x.id, x.attempts, x.provider_message_id
      from private.package_draft_email_notices x where p_ledger = 'package_draft' and x.id = p_ref
  ), hits as (
    select e as r, e.linked_attempt as attempt
      from private.email_provider_events e join n on p_ledger = 'application' and e.application_notification = n.id
    union all
    select e, e.linked_attempt
      from private.email_provider_events e join n on p_ledger = 'package_draft' and e.package_draft_notice = n.id
    union all
    select e, e.tag_attempt
      from private.email_provider_events e join n on e.tag_ledger = p_ledger and e.tag_ref = n.id
     where e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
    union all
    select e, n.attempts
      from private.email_provider_events e join n on n.provider_message_id is not null and e.provider_email_id = n.provider_message_id
     where e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
       and not coalesce(e.tag_ledger = p_ledger and e.tag_ref = n.id, false)
  )
  select h.attempt, s.state, private.email_evidence_fact((h.r).event_type, (h.r).bounce_type),
         (h.r).provider_created_at, (h.r).bounce_type, (h.r).bounce_subtype, (h.r).received_at, (h.r).svix_id
    from hits h cross join lateral (select private.email_evidence_receipt_state(h.r) as state) s
   where s.state <> 'expired'
$$;

-- 3. One row's evidence ----------------------------------------------------------------------

-- The current attempt's summary (C3C-6), the conflict signal and reasons, and the per-attempt
-- history, in the same shape as the owner-email readback. History carries the fact, provider
-- time as received, bounce category and an exclusion reason; never an ID, tag, svix-id, email ID
-- or secret slot. Null for a row that does not exist.
create function private.email_evidence_ledger_row(p_ledger text, p_ref uuid)
returns jsonb language sql stable set search_path = '' as $$
  with n as (
    select x.application_id as id, x.attempts
      from private.r0_application_notifications x where p_ledger = 'application' and x.application_id = p_ref
    union all
    select x.id, x.attempts
      from private.package_draft_email_notices x where p_ledger = 'package_draft' and x.id = p_ref
  ), r as (
    select * from private.email_evidence_ledger_receipts(p_ledger, p_ref)
  ), att as (
    select distinct r.attempt from r
    union
    select n.attempts from n where n.attempts > 0
  ), per as (
    select a.attempt,
           private.email_evidence_summary(
             coalesce((select array_agg(distinct r.fact order by r.fact) from r
                        where r.attempt = a.attempt and r.receipt_state = 'trusted'), '{}'::text[]),
             private.email_evidence_ledger_claimed_at(p_ledger, p_ref, a.attempt)) as summary,
           exists (select 1 from r where r.attempt = a.attempt
                    and r.receipt_state in ('stored_conflict', 'content_conflict', 'current_conflict')) as has_conflict,
           coalesce((select jsonb_agg(jsonb_build_object(
                        'fact', r.fact, 'provider_created_at', r.provider_created_at,
                        'bounce_type', r.bounce_type, 'bounce_subtype', r.bounce_subtype,
                        'excluded', case when r.receipt_state = 'trusted' then null else r.receipt_state end)
                      order by r.provider_created_at nulls last, r.received_at, r.svix_id)
                       from r where r.attempt = a.attempt), '[]'::jsonb) as reports
      from att a
  )
  select jsonb_build_object(
    'attempt', n.attempts,
    'summary', coalesce((select p.summary from per p where p.attempt = n.attempts),
                        private.email_evidence_summary('{}'::text[], null)),
    'has_conflict', exists (select 1 from r where r.receipt_state in ('stored_conflict', 'content_conflict', 'current_conflict')),
    'conflict_reasons', to_jsonb(array(select distinct r.receipt_state from r
                                        where r.receipt_state in ('stored_conflict', 'content_conflict', 'current_conflict')
                                        order by 1)),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('attempt', p.attempt, 'has_conflict', p.has_conflict, 'reports', p.reports)
                                           || p.summary order by p.attempt)
                            from per p where jsonb_array_length(p.reports) > 0), '[]'::jsonb))
  from n
$$;

-- 4. Counts ----------------------------------------------------------------------------------

-- The ledger-specific §9.1 counts, from the same row evidence:
--   not_delivered     sent rows whose sent attempt proves non-delivery (S-47)
--   to_review         rows whose current attempt needs review without proving non-delivery
--   conflicting_rows  rows with any excluded conflicting report
-- Only rows that some receipt concerns are evaluated; every other row reads rule 9 or 10.
create function private.email_evidence_ledger_counts(p_ledger text)
returns jsonb language sql stable set search_path = '' as $$
  with ids as (
    select e.application_notification as id from private.email_provider_events e
     where p_ledger = 'application' and e.application_notification is not null
    union
    select e.package_draft_notice from private.email_provider_events e
     where p_ledger = 'package_draft' and e.package_draft_notice is not null
    union
    select e.tag_ref from private.email_provider_events e
     where e.tag_ledger = p_ledger and e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
    union
    select n.application_id from private.r0_application_notifications n
      join private.email_provider_events e on e.provider_email_id = n.provider_message_id
     where p_ledger = 'application' and e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
    union
    select n.id from private.package_draft_email_notices n
      join private.email_provider_events e on e.provider_email_id = n.provider_message_id
     where p_ledger = 'package_draft' and e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
  ), rows as (
    select n.application_id as id, n.state from private.r0_application_notifications n join ids on ids.id = n.application_id
     where p_ledger = 'application'
    union all
    select n.id, n.state from private.package_draft_email_notices n join ids on ids.id = n.id
     where p_ledger = 'package_draft'
  ), evidence as (
    select r.state, private.email_evidence_ledger_row(p_ledger, r.id) as ev from rows r
  )
  select jsonb_build_object(
    'not_delivered', (select count(*) from evidence v
                       where v.state = 'sent' and (v.ev->'summary'->>'non_delivery_proven')::boolean),
    'to_review', (select count(*) from evidence v
                   where (v.ev->'summary'->>'needs_review')::boolean and not (v.ev->'summary'->>'non_delivery_proven')::boolean),
    'conflicting_rows', (select count(*) from evidence v where (v.ev->>'has_conflict')::boolean))
$$;

-- The global counts, across every receipt: whether the receiver is armed, unexpired stored
-- identity conflicts by class plus content conflicts, unexpired unmatched and id_missing
-- receipts by event type, and expired receipts still stored (counted to 10,000) with the oldest
-- expiry. Same values as the global keys of owner_email_evidence_counts (SQL 124 compares them).
create function private.email_evidence_global_counts()
returns jsonb language sql stable set search_path = '' as $$
  with unlinked as (
    select e.identity_class, e.event_type, private.email_evidence_receipt_state(e) as state
      from private.email_provider_events e
     where e.identity_class not in ('id_only', 'tag_only', 'tag_and_id') or e.content_conflict
  )
  select jsonb_build_object(
    'receiver_armed', exists (select 1 from private.email_evidence_config c where c.armed_at is not null),
    'conflicting_reports', (select jsonb_build_object(
        'conflict_disagree', count(*) filter (where u.state = 'stored_conflict' and u.identity_class = 'conflict_disagree'),
        'conflict_id_ambiguous', count(*) filter (where u.state = 'stored_conflict' and u.identity_class = 'conflict_id_ambiguous'),
        'conflict_tag_invalid', count(*) filter (where u.state = 'stored_conflict' and u.identity_class = 'conflict_tag_invalid'),
        'content_conflict', count(*) filter (where u.state = 'content_conflict'))
      from unlinked u),
    'unmatched_reports', jsonb_build_object(
        'total', (select count(*) from unlinked u where u.state = 'unlinked'),
        'by_type', (select coalesce(jsonb_object_agg(t.event_type, t.n order by t.event_type), '{}'::jsonb)
                      from (select u.event_type, count(*) as n from unlinked u where u.state = 'unlinked' group by u.event_type) t)),
    'retention_backlog', jsonb_build_object(
        'expired', least(10000, (select count(*) from (select 1 from private.email_provider_events e
                                                         where e.expires_at <= now() limit 10001) x)),
        'expired_over_cap', (select count(*) from (select 1 from private.email_provider_events e
                                                    where e.expires_at <= now() limit 10001) x) > 10000,
        'oldest_expires_at', (select min(e.expires_at) from private.email_provider_events e where e.expires_at <= now())))
$$;

-- 5. Recruiting: application emails ----------------------------------------------------------

-- The visible applications' evidence. p_applications are the overview rows' application IDs (at
-- most 100 per read; the page reads in batches). Applications without a ledger row (untracked)
-- are omitted.
create function public.application_email_evidence(p_applications uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  perform public.vendor_require_operator();
  if p_applications is null then
    raise exception 'A list of vendor applications is required' using errcode = '22023';
  end if;
  if cardinality(p_applications) > 100 then
    raise exception 'At most 100 vendor applications per evidence read' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('application_id', n.application_id)
           || private.email_evidence_ledger_row('application', n.application_id)
           order by n.created_at desc, n.application_id desc), '[]'::jsonb)
    into items
    from private.r0_application_notifications n
   where n.application_id = any(p_applications);
  return jsonb_build_object('checked_at', now(), 'items', items);
end $$;

create function public.application_email_evidence_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return jsonb_build_object('checked_at', now(),
    'ledger', private.email_evidence_ledger_counts('application'),
    'all_emails', private.email_evidence_global_counts());
end $$;

-- 6. Price drafts: notices to an unbound vendor's contact email -------------------------------

-- The visible drafts' notice evidence, one entry per notice (one per sent revision). `current`
-- marks the notice of the draft's sent revision, exactly as the panel's delivery readback joins
-- it; `queued_at` is when that revision's notice was queued and `state` the existing notice view.
-- Drafts without any notice are omitted; no notice, draft-internal or provider ID is returned
-- beyond the caller's own draft ID.
create function public.package_draft_email_evidence(p_drafts uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  perform public.vendor_require_operator();
  if p_drafts is null then
    raise exception 'A list of price drafts is required' using errcode = '22023';
  end if;
  if cardinality(p_drafts) > 100 then
    raise exception 'At most 100 price drafts per evidence read' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('draft_id', d.id, 'notices', (
           select jsonb_agg(
                    jsonb_build_object(
                      'current', coalesce(e.revision = d.sent_hash and d.approval_state <> 'draft', false),
                      'queued_at', e.created_at,
                      'state', private.package_draft_email_view(e))
                    || private.email_evidence_ledger_row('package_draft', e.id)
                    order by e.created_at desc, e.id desc)
             from private.package_draft_email_notices e where e.draft_id = d.id))
           order by d.updated_at desc, d.id), '[]'::jsonb)
    into items
    from private.operator_package_drafts d
   where d.id = any(p_drafts)
     and exists (select 1 from private.package_draft_email_notices e where e.draft_id = d.id);
  return jsonb_build_object('checked_at', now(), 'items', items);
end $$;

create function public.package_draft_email_evidence_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return jsonb_build_object('checked_at', now(),
    'ledger', private.email_evidence_ledger_counts('package_draft'),
    'all_emails', private.email_evidence_global_counts());
end $$;

-- 7. Privileges ------------------------------------------------------------------------------

revoke all on function
  private.email_evidence_ledger_claimed_at(text, uuid, integer),
  private.email_evidence_ledger_receipts(text, uuid),
  private.email_evidence_ledger_row(text, uuid),
  private.email_evidence_ledger_counts(text),
  private.email_evidence_global_counts(),
  public.application_email_evidence(uuid[]),
  public.application_email_evidence_counts(),
  public.package_draft_email_evidence(uuid[]),
  public.package_draft_email_evidence_counts()
from public, anon, authenticated, service_role;

grant execute on function
  public.application_email_evidence(uuid[]),
  public.application_email_evidence_counts(),
  public.package_draft_email_evidence(uuid[]),
  public.package_draft_email_evidence_counts()
to authenticated;

reset lock_timeout;
