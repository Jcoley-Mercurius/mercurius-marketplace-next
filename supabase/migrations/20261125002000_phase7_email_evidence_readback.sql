-- TRACE-155 (Phase 7.3C-1): owner-email correlation reference and read-only delivery evidence.
--
-- Plan: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md §7.3, §8.3, §8.4, §9.1 and §11.4, as
-- amended in the same PR. Handoff: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1-HANDOFF.md,
-- cleared by Codex review 5926523770 (C3C-1..C3C-6). Record:
-- governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1.md.
--
-- Functions and grants only. No table, column, constraint, trigger, policy or existing grant
-- changes, and no existing function is restated: owner_email_claim, owner_email_overview, the
-- 7.3B receive and purge functions and every money-fingerprinted function keep their definitions.
--
-- 1. public.owner_email_correlation_ref (service role only): the exact owner-email ledger row ID
--    for one (kind, source). The sender tags an attempt with it after a successful claim.
-- 2. private.email_evidence_receipt_state: the single trust and expiry predicate. Every summary,
--    history, count and conflict signal below reads receipts only through it.
-- 3. private.email_evidence_summary: fact set F and the first-match rules 1–10 (§8.3).
-- 4. public.owner_email_evidence and public.owner_email_evidence_counts (operator only): the
--    Owner Emails readback. Labels are mapped in TypeScript; SQL decides every value.
--
-- Every function here is STABLE and performs no write: no purge, flag, quarantine row or
-- arming-record write happens on the read side. Physical deletion stays with receipt-time purge
-- and email_provider_events_purge.
--
-- Correction to 20261124001000 (not restated; Codex review 5926513941): its receive-function
-- comment says the purge "runs first, so an expired receipt never answers as a duplicate". That
-- holds only while the target is among the 100 oldest unlocked expired rows. With a larger
-- backlog, or a locked target, the expired receipt is still stored and insert-or-detect answers
-- `duplicate` (or `conflict` for a changed payload, setting the flag) without moving its expiry.
-- The readback below excludes expired receipts regardless of that answer (SQL 121 §9, SQL 122).

set lock_timeout = '2s';

-- 1. Correlation reference ----------------------------------------------------------------

-- The ledger row ID for exactly this (kind, source), or null. An unknown or null kind, a source
-- of the other kind, or a source without a ledger row returns null; no other row is selected.
create function public.owner_email_correlation_ref(p_kind text, p_source uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select n.id from private.owner_email_notifications n
   where p_kind = 'contact_submission' and n.source_kind = 'contact_submission' and n.contact_submission_id = p_source
  union all
  select n.id from private.owner_email_notifications n
   where p_kind = 'renewal_document' and n.source_kind = 'renewal_document' and n.renewal_document_id = p_source
$$;

-- 2. Receipt facts and trust ------------------------------------------------------------------

-- The provider-evidence fact a receipt reports (§5). A bounce of unknown category is
-- undetermined, so it can never prove non-delivery.
create function private.email_evidence_fact(p_event_type text, p_bounce_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_event_type
    when 'email.sent' then 'accepted'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then case p_bounce_type
      when 'permanent' then 'bounced_permanent'
      when 'transient' then 'bounced_transient'
      else 'bounced_undetermined' end
    when 'email.complained' then 'complained'
    when 'email.failed' then 'provider_failed'
    when 'email.suppressed' then 'provider_suppressed'
  end
$$;

-- The §7.3 read-time recheck of a linked receipt against the current ledger snapshot. True only
-- when all three checks hold:
--   1. the provider-ID candidate I' (all three ledgers) is none, or exactly the linked ledger,
--      row and attempt; a different row, a different attempt or an ambiguous I' fails;
--   2. for tag_only and tag_and_id: if the linked row now holds a provider ID, it is this
--      receipt's ID (this fails even when I' is none, because the row recorded another ID);
--   3. for id_only: I' is still exactly the linked row and attempt.
-- A receipt without an ID, or not linked, never passes. Derived, never stored.
create function private.email_evidence_identity_holds(e private.email_provider_events)
returns boolean language sql stable set search_path = '' as $$
  with link as (
    select case when e.application_notification is not null then 'application'
                when e.owner_email_notification is not null then 'owner_email'
                when e.package_draft_notice is not null then 'package_draft' end as ledger,
           coalesce(e.application_notification, e.owner_email_notification, e.package_draft_notice) as ref
  ), current_snapshot as (
    select l.ledger, l.ref,
           case l.ledger
             when 'application' then (select n.provider_message_id from private.r0_application_notifications n where n.application_id = l.ref)
             when 'owner_email' then (select n.provider_message_id from private.owner_email_notifications n where n.id = l.ref)
             when 'package_draft' then (select n.provider_message_id from private.package_draft_email_notices n where n.id = l.ref)
           end as row_provider_id,
           private.email_provider_id_candidate(e.provider_email_id) as candidate
      from link l
     where l.ledger is not null and e.provider_email_id is not null and e.linked_attempt is not null
  ), checked as (
    select s.*, s.candidate->>'kind' as kind,
           coalesce(s.candidate->>'kind' = 'one' and s.candidate->>'ledger' = s.ledger
                    and (s.candidate->>'ref')::uuid = s.ref
                    and (s.candidate->>'attempt')::integer = e.linked_attempt, false) as same
      from current_snapshot s
  )
  select coalesce((
    select (c.kind = 'none' or c.same)
       and (e.identity_class not in ('tag_only', 'tag_and_id') or c.row_provider_id is null
            or c.row_provider_id = e.provider_email_id)
       and (e.identity_class <> 'id_only' or c.same)
      from checked c), false)
$$;

-- The one trust and expiry predicate (§8.3, §11.4 item 3). Every read below uses it:
--   expired           expires_at <= now(); never shown, counted or used, except as backlog
--   stored_conflict   a receipt-time identity conflict; excluded for the receipt's stored life
--   content_conflict  the permanent content-conflict flag; excluded for the receipt's stored life
--   unlinked          unmatched or id_missing (never evidence for any row)
--   current_conflict  linked, but the §7.3 recheck fails on the current snapshot; excluded only
--                     while the disagreement exists, so it can count again if the competing
--                     record disappears (current-snapshot exclusion, C3C-3)
--   trusted           linked, recorded, unflagged, unexpired and passing the recheck
create function private.email_evidence_receipt_state(e private.email_provider_events)
returns text language sql stable set search_path = '' as $$
  select case
    when e.expires_at <= now() then 'expired'
    when e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid') then 'stored_conflict'
    when e.content_conflict then 'content_conflict'
    when e.processing <> 'recorded' or e.identity_class not in ('id_only', 'tag_only', 'tag_and_id') then 'unlinked'
    when private.email_evidence_identity_holds(e) then 'trusted'
    else 'current_conflict' end
$$;

-- 3. Summary --------------------------------------------------------------------------------

-- Fact set F of one attempt's trusted receipts and the first matching rule (§8.3). Set-based, so
-- arrival order never matters. Rules 9 and 10 apply only to an empty F: rule 9 needs an arming
-- record whose armed_at is at or before the attempt's claim time (§8.4); otherwise rule 10.
-- `reported` lists the non-delivery facts behind rules 2 and 5, for their labels.
create function private.email_evidence_summary(p_facts text[], p_claimed_at timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  with f as (select coalesce(p_facts, '{}'::text[]) as facts),
  r as (
    select f.facts, case
      when 'complained' = any(f.facts) then 1
      when 'delivered' = any(f.facts) and f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 2
      when 'delivered' = any(f.facts) and f.facts && array['bounced_transient', 'bounced_undetermined'] then 3
      when 'delivered' = any(f.facts) then 4
      when f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 5
      when f.facts && array['bounced_transient', 'bounced_undetermined'] then 6
      when 'delayed' = any(f.facts) then 7
      when 'accepted' = any(f.facts) then 8
      when cardinality(f.facts) = 0 and p_claimed_at is not null and exists (
        select 1 from private.email_evidence_config c where c.singleton and c.armed_at is not null and c.armed_at <= p_claimed_at) then 9
      else 10 end as rule
    from f
  )
  select jsonb_build_object(
    'rule', r.rule,
    'delivered_fact', r.rule in (1, 2, 3, 4),
    'non_delivery_proven', r.rule = 5,
    'needs_review', r.rule in (1, 2, 3, 5, 6),
    'reported', case when r.rule in (2, 5) then to_jsonb(array(
      select x from unnest(array['bounced_permanent', 'provider_failed', 'provider_suppressed']) x
       where x = any(r.facts) order by x)) else '[]'::jsonb end)
  from r
$$;

-- 4. Owner-email readback -------------------------------------------------------------------

-- When attempt p_attempt of an owner-email row was claimed: its `sending` audit event, or the
-- row's claim time for its current attempt. Used only for rule 9 versus 10.
create function private.email_evidence_owner_claimed_at(p_notification uuid, p_attempt integer)
returns timestamptz language sql stable set search_path = '' as $$
  select coalesce(
    (select min(ev.created_at) from private.owner_email_notification_events ev
      where ev.notification_id = p_notification and ev.state = 'sending' and ev.attempt = p_attempt),
    (select n.claimed_at from private.owner_email_notifications n where n.id = p_notification and n.attempts = p_attempt))
$$;

-- Every unexpired receipt that concerns one owner-email row, with its read-time state:
--   linked receipts, on their linked attempt;
--   stored identity conflicts whose tag names the row, on their tag attempt;
--   stored identity conflicts whose provider ID is the row's recorded ID, on its sent attempt.
-- An unmatched receipt is never rematched on read, even if the row later records its ID.
create function private.email_evidence_owner_receipts(p_notification uuid)
returns table(attempt integer, receipt_state text, fact text, provider_created_at timestamptz,
              bounce_type text, bounce_subtype text, received_at timestamptz, svix_id text)
language sql stable set search_path = '' as $$
  with n as (
    select x.id, x.attempts, x.provider_message_id from private.owner_email_notifications x where x.id = p_notification
  ), hits as (
    select e as r, e.linked_attempt as attempt
      from private.email_provider_events e join n on e.owner_email_notification = n.id
    union all
    select e, e.tag_attempt
      from private.email_provider_events e join n on e.tag_ledger = 'owner_email' and e.tag_ref = n.id
     where e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
    union all
    select e, n.attempts
      from private.email_provider_events e join n on n.provider_message_id is not null and e.provider_email_id = n.provider_message_id
     where e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
       and not coalesce(e.tag_ledger = 'owner_email' and e.tag_ref = n.id, false)
  )
  select h.attempt, s.state, private.email_evidence_fact((h.r).event_type, (h.r).bounce_type),
         (h.r).provider_created_at, (h.r).bounce_type, (h.r).bounce_subtype, (h.r).received_at, (h.r).svix_id
    from hits h cross join lateral (select private.email_evidence_receipt_state(h.r) as state) s
   where s.state <> 'expired'
$$;

-- One row's evidence: the current attempt's summary (C3C-6), the conflict signal and reasons,
-- and the per-attempt history. History carries the fact, provider time as received, bounce
-- category and an exclusion reason; never an ID, tag, svix-id, email ID or secret slot.
create function private.email_evidence_owner_row(p_notification uuid)
returns jsonb language sql stable set search_path = '' as $$
  with n as (
    select x.id, x.attempts from private.owner_email_notifications x where x.id = p_notification
  ), r as (
    select * from private.email_evidence_owner_receipts(p_notification)
  ), att as (
    select distinct r.attempt from r
    union
    select n.attempts from n where n.attempts > 0
  ), per as (
    select a.attempt,
           private.email_evidence_summary(
             coalesce((select array_agg(distinct r.fact order by r.fact) from r
                        where r.attempt = a.attempt and r.receipt_state = 'trusted'), '{}'::text[]),
             private.email_evidence_owner_claimed_at(p_notification, a.attempt)) as summary,
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

-- The visible page's evidence. p_sources are the overview rows' source IDs (at most 100, the
-- overview's page ceiling); p_kind null reads both kinds. Rows without a ledger row are omitted.
create function public.owner_email_evidence(p_kind text, p_sources uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare items jsonb;
begin
  perform public.vendor_require_operator();
  if p_kind is not null then perform private.owner_email_require_kind(p_kind); end if;
  if p_sources is null then
    raise exception 'A list of owner-email source records is required' using errcode = '22023';
  end if;
  if cardinality(p_sources) > 100 then
    raise exception 'At most 100 owner-email records per evidence read' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
           jsonb_build_object('kind', n.source_kind, 'source_id', coalesce(n.contact_submission_id, n.renewal_document_id))
           || private.email_evidence_owner_row(n.id)
           order by n.created_at desc, n.id desc), '[]'::jsonb)
    into items
    from private.owner_email_notifications n
   where (p_kind is null or n.source_kind = p_kind)
     and (n.contact_submission_id = any(p_sources) or n.renewal_document_id = any(p_sources));
  return jsonb_build_object('checked_at', now(), 'items', items);
end $$;

-- The additive Owner Emails counts (§9.1). Existing attention counts are unchanged and stay in
-- owner_email_overview. Every value comes from the same receipt-state predicate:
--   not_delivered        sent rows whose sent attempt proves non-delivery (S-47)
--   to_review            rows whose current attempt needs review without proving non-delivery
--   conflicting_rows     rows with any excluded conflicting report
--   conflicting_reports  unexpired stored identity conflicts by class, plus content conflicts
--   unmatched_reports    unexpired unmatched and id_missing receipts, by event type
--   retention_backlog    expired receipts still stored (counted to 10,000) and the oldest expiry
create function public.owner_email_evidence_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.vendor_require_operator();
  with ids as (
    select e.owner_email_notification as id from private.email_provider_events e
     where e.owner_email_notification is not null
    union
    select e.tag_ref from private.email_provider_events e
     where e.tag_ledger = 'owner_email' and e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
    union
    select n.id from private.owner_email_notifications n
      join private.email_provider_events e on e.provider_email_id = n.provider_message_id
     where e.identity_class in ('conflict_disagree', 'conflict_id_ambiguous', 'conflict_tag_invalid')
  ), evidence as (
    select n.state, private.email_evidence_owner_row(n.id) as ev
      from private.owner_email_notifications n join ids on ids.id = n.id
  ), unlinked as (
    select e.identity_class, e.event_type, private.email_evidence_receipt_state(e) as state
      from private.email_provider_events e
     where e.identity_class not in ('id_only', 'tag_only', 'tag_and_id') or e.content_conflict
  )
  select jsonb_build_object(
    'checked_at', now(),
    'receiver_armed', exists (select 1 from private.email_evidence_config c where c.armed_at is not null),
    'not_delivered', (select count(*) from evidence v
                       where v.state = 'sent' and (v.ev->'summary'->>'non_delivery_proven')::boolean),
    'to_review', (select count(*) from evidence v
                   where (v.ev->'summary'->>'needs_review')::boolean and not (v.ev->'summary'->>'non_delivery_proven')::boolean),
    'conflicting_rows', (select count(*) from evidence v where (v.ev->>'has_conflict')::boolean),
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
    into result;
  return result;
end $$;

-- 5. Privileges -----------------------------------------------------------------------------

revoke all on function
  public.owner_email_correlation_ref(text, uuid),
  private.email_evidence_fact(text, text),
  private.email_evidence_identity_holds(private.email_provider_events),
  private.email_evidence_receipt_state(private.email_provider_events),
  private.email_evidence_summary(text[], timestamptz),
  private.email_evidence_owner_claimed_at(uuid, integer),
  private.email_evidence_owner_receipts(uuid),
  private.email_evidence_owner_row(uuid),
  public.owner_email_evidence(text, uuid[]),
  public.owner_email_evidence_counts()
from public, anon, authenticated, service_role;

grant execute on function public.owner_email_correlation_ref(text, uuid) to service_role;
grant execute on function
  public.owner_email_evidence(text, uuid[]),
  public.owner_email_evidence_counts()
to authenticated;

reset lock_timeout;
