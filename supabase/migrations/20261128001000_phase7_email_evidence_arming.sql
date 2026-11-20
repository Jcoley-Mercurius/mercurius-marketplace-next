-- TRACE-155 (Phase 7.3D-1): audited arm/disarm commands, interval coverage and probe readback.
--
-- Plan: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md §8.3, §8.4, §11.4 and §12, as amended in
-- the same PR. Readiness: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md §3–§4,
-- cleared for local, dormant implementation by Codex review 5997315152 (R3D-1..R3D-4). Record:
-- governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-1.md.
--
-- 1. private.email_evidence_arming_events: the append-only arming history. One row per
--    transition; `seq` is contiguous from 1 and odd rows are arms, so two arms (or two disarms)
--    in a row cannot be stored. A trigger refuses update, delete, truncate, a non-next `seq` and a
--    time that does not move forward.
-- 2. public.email_evidence_arm and public.email_evidence_disarm (operator only, R3D-1): the actor
--    is the session's auth.uid() through vendor_require_operator; there is no actor parameter.
--    Each call serializes on the arming-record row, refuses a duplicate transition, takes its
--    time from clock_timestamp() after the lock, appends one event and sets or clears
--    email_evidence_config.armed_at in the same transaction.
-- 3. Coverage (R3D-2): private.email_evidence_retry_horizon and private.email_evidence_coverage
--    read the audited intervals. private.email_evidence_summary is DELIBERATELY RESTATED: rules
--    1–8 are byte-for-byte the same expressions over trusted facts; rule 9 now needs the attempt
--    to have been claimed inside an audited armed interval (instead of the single armed_at), and
--    the result gains a `coverage` key. It is the only existing function restated. Its callers
--    (the 7.3C-1 and 7.3C-2 readbacks) are not restated and pick it up unchanged.
-- 4. public.email_evidence_arming_readback (operator only): history, intervals and the retention
--    readback (total retained and expired counts, no content). Purge duty lasts while any receipt
--    is retained, expired or not.
-- 5. public.email_evidence_probe_authorize and public.email_evidence_probe_readback (operator
--    only, R3D-3/R3D-4): the probe route's authorization check, and the unlinked receipts for one
--    provider email ID the route itself received. Never returns the ID, a recipient, a payload or
--    content. Receipts of ledger sends are not returned, and nothing is rematched.
--
-- Not changed: the receipt table and its guard, the receive and purge functions, the 7.3C-1
-- functions other than the summary, the 7.3C-2 functions, every ledger function and every
-- money-fingerprinted function. Nothing is armed, sent, purged or scheduled here.

set lock_timeout = '2s';

-- 0. Precondition ------------------------------------------------------------------------------
-- An armed_at written before this migration would have no audit event. Production's arming
-- record was empty at the last readback (7.3C-2 record §5.1); refuse rather than guess.
do $$
begin
  if exists (select 1 from private.email_evidence_config where armed_at is not null) then
    raise exception 'The arming record holds an armed_at without audit history; resolve it before this migration'
      using errcode = '55000';
  end if;
end $$;

-- 1. Arming history -----------------------------------------------------------------------------

create table private.email_evidence_arming_events (
  seq integer primary key check (seq >= 1),
  action text not null check (action in ('arm', 'disarm')),
  occurred_at timestamptz not null,
  actor uuid not null,
  reason text not null check (reason = btrim(reason) and char_length(reason) between 1 and 500
                              and reason !~ '[[:cntrl:]]'),
  -- Arms and disarms alternate, starting with an arm.
  check ((seq % 2 = 1) = (action = 'arm'))
);

alter table private.email_evidence_arming_events enable row level security;
revoke all on private.email_evidence_arming_events from public, anon, authenticated, service_role;

-- Append-only and ordered: only the next seq, at a strictly later time, may be inserted.
create function private.email_evidence_arming_events_guard() returns trigger
language plpgsql set search_path = '' as $$
declare prior_event private.email_evidence_arming_events;
begin
  if tg_op <> 'INSERT' then
    raise exception 'The arming history is append-only' using errcode = '55000';
  end if;
  select * into prior_event from private.email_evidence_arming_events order by seq desc limit 1;
  if new.seq <> coalesce(prior_event.seq, 0) + 1 then
    raise exception 'An arming event must follow the latest one' using errcode = '55000';
  end if;
  if prior_event.seq is not null and new.occurred_at <= prior_event.occurred_at then
    raise exception 'An arming event must be later than the latest one' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger email_evidence_arming_events_guard
  before insert or update or delete on private.email_evidence_arming_events
  for each row execute function private.email_evidence_arming_events_guard();
create trigger email_evidence_arming_events_no_truncate
  before truncate on private.email_evidence_arming_events
  for each statement execute function private.email_evidence_arming_events_guard();

-- 2. Arm and disarm (R3D-1) ----------------------------------------------------------------------

-- One transition. Serializes on the arming-record row (created on first use), checks that the
-- record agrees with the history, refuses a duplicate transition, then appends and updates
-- together. Any failure rolls back both.
create function private.email_evidence_transition(p_action text, p_reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  actor uuid;
  reason text := btrim(coalesce(p_reason, ''));
  cfg private.email_evidence_config;
  prior_event private.email_evidence_arming_events;
  at_ts timestamptz;
  next_seq integer;
begin
  actor := public.vendor_require_operator();
  if p_action is null or p_action not in ('arm', 'disarm') then
    raise exception 'Unknown arming action' using errcode = '22023';
  end if;
  if reason = '' or char_length(reason) > 500 or reason ~ '[[:cntrl:]]' then
    raise exception 'Give a reason of 1 to 500 characters on one line' using errcode = '22023';
  end if;
  insert into private.email_evidence_config(singleton) values (true) on conflict (singleton) do nothing;
  select * into strict cfg from private.email_evidence_config where singleton for update;
  select * into prior_event from private.email_evidence_arming_events order by seq desc limit 1;
  if cfg.armed_at is distinct from (case when prior_event.action = 'arm' then prior_event.occurred_at end) then
    raise exception 'The arming record disagrees with its audit history' using errcode = '55000';
  end if;
  if p_action = 'arm' and prior_event.action = 'arm' then
    raise exception 'Delivery evidence is already armed' using errcode = '55000';
  end if;
  if p_action = 'disarm' and coalesce(prior_event.action, 'disarm') = 'disarm' then
    raise exception 'Delivery evidence is not armed' using errcode = '55000';
  end if;
  at_ts := clock_timestamp();
  next_seq := coalesce(prior_event.seq, 0) + 1;
  insert into private.email_evidence_arming_events(seq, action, occurred_at, actor, reason)
    values (next_seq, p_action, at_ts, actor, reason);
  update private.email_evidence_config
     set armed_at = case when p_action = 'arm' then at_ts end, updated_at = at_ts
   where singleton;
  return jsonb_build_object('seq', next_seq, 'action', p_action, 'occurred_at', at_ts, 'armed', p_action = 'arm');
end $$;

create function public.email_evidence_arm(p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.email_evidence_transition('arm', p_reason)
$$;

create function public.email_evidence_disarm(p_reason text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.email_evidence_transition('disarm', p_reason)
$$;

-- 3. Coverage (R3D-2) -----------------------------------------------------------------------------

-- How long after a send the receiver must stay armed for that send's reports to be collected
-- through Resend's documented retry schedule (verified 2026-11-20 from
-- https://resend.com/docs/webhooks/retries-and-replays): an immediate attempt, then waits of
-- 5 s, 5 min, 30 min, 2 h, 5 h, 10 h and 10 h, 27 h 35 min 5 s in total. Rounded up to 28 hours
-- for the attempts' own response time. It bounds webhook retries for an event raised at send
-- time; an event the provider raises later (for example a late bounce) is not covered by it.
create function private.email_evidence_retry_horizon() returns interval
language sql immutable set search_path = '' as $$
  select interval '28 hours'
$$;

-- The collection coverage of an attempt claimed at p_claimed_at, from the audited intervals
-- [arm, next disarm):
--   unknown           no claim time is known
--   before_first_arm  claimed before any arming
--   gap               claimed after a disarm and before the next arm
--   partial           claimed while armed, but disarmed before claim + horizon
--   collecting        claimed while armed, still armed, and claim + horizon not yet reached
--   complete          claimed while armed, and armed through claim + horizon
-- An interval includes its arming instant and excludes its disarming instant. A partial
-- interval stays partial even if a later arm covers the rest of the horizon.
create function private.email_evidence_coverage(p_claimed_at timestamptz)
returns text language sql stable set search_path = '' as $$
  with intervals as (
    select x.occurred_at as armed_from, x.disarmed_at
      from (select e.action, e.occurred_at, lead(e.occurred_at) over (order by e.seq) as disarmed_at
              from private.email_evidence_arming_events e) x
     where x.action = 'arm'
  ), hit as (
    select i.disarmed_at from intervals i
     where i.armed_from <= p_claimed_at and (i.disarmed_at is null or p_claimed_at < i.disarmed_at)
  )
  select case
    when p_claimed_at is null then 'unknown'
    when not exists (select 1 from intervals i where i.armed_from <= p_claimed_at) then 'before_first_arm'
    when not exists (select 1 from hit) then 'gap'
    when exists (select 1 from hit h where h.disarmed_at is not null
                    and h.disarmed_at < p_claimed_at + private.email_evidence_retry_horizon()) then 'partial'
    when exists (select 1 from hit h where h.disarmed_at is null
                    and now() < p_claimed_at + private.email_evidence_retry_horizon()) then 'collecting'
    else 'complete' end
$$;

-- RESTATED (7.3D-1, R3D-2). Rules 1–8 are unchanged. Rule 9 ("no report") applies to an empty
-- fact set claimed inside an audited armed interval (coverage collecting, complete or partial);
-- every other empty fact set is rule 10. `coverage` is returned for every attempt, so a label can
-- say whether reports were collected and never claim more than the history shows.
create or replace function private.email_evidence_summary(p_facts text[], p_claimed_at timestamptz)
returns jsonb language sql stable set search_path = '' as $$
  with f as (select coalesce(p_facts, '{}'::text[]) as facts, private.email_evidence_coverage(p_claimed_at) as coverage),
  r as (
    select f.facts, f.coverage, case
      when 'complained' = any(f.facts) then 1
      when 'delivered' = any(f.facts) and f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 2
      when 'delivered' = any(f.facts) and f.facts && array['bounced_transient', 'bounced_undetermined'] then 3
      when 'delivered' = any(f.facts) then 4
      when f.facts && array['bounced_permanent', 'provider_failed', 'provider_suppressed'] then 5
      when f.facts && array['bounced_transient', 'bounced_undetermined'] then 6
      when 'delayed' = any(f.facts) then 7
      when 'accepted' = any(f.facts) then 8
      when cardinality(f.facts) = 0 and f.coverage in ('collecting', 'complete', 'partial') then 9
      else 10 end as rule
    from f
  )
  select jsonb_build_object(
    'rule', r.rule,
    'coverage', r.coverage,
    'delivered_fact', r.rule in (1, 2, 3, 4),
    'non_delivery_proven', r.rule = 5,
    'needs_review', r.rule in (1, 2, 3, 5, 6),
    'reported', case when r.rule in (2, 5) then to_jsonb(array(
      select x from unnest(array['bounced_permanent', 'provider_failed', 'provider_suppressed']) x
       where x = any(r.facts) order by x)) else '[]'::jsonb end)
  from r
$$;

-- 4. Arming and retention readback -----------------------------------------------------------------

-- The arming state, its full history and intervals, and the retention readback. Retention gives
-- counts only: every stored receipt (expired or not, linked or not), the expired ones and their
-- oldest expiry, the latest expiry still stored, and the last operator purge run. `purge_duty`
-- is true while any receipt is stored: a disarm, rollback or empty expired backlog ends nothing.
create function public.email_evidence_arming_readback()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.vendor_require_operator();
  with stored as (
    select e.expires_at <= now() as expired,
           num_nonnulls(e.application_notification, e.owner_email_notification, e.package_draft_notice) = 1 as linked,
           e.expires_at
      from private.email_provider_events e
  )
  select jsonb_build_object(
    'checked_at', now(),
    'armed', coalesce((select c.armed_at is not null from private.email_evidence_config c where c.singleton), false),
    'armed_at', (select c.armed_at from private.email_evidence_config c where c.singleton),
    'retry_horizon_seconds', extract(epoch from private.email_evidence_retry_horizon())::integer,
    'history', coalesce((select jsonb_agg(jsonb_build_object('seq', a.seq, 'action', a.action, 'occurred_at', a.occurred_at,
                                                              'actor', a.actor, 'reason', a.reason) order by a.seq)
                           from private.email_evidence_arming_events a), '[]'::jsonb),
    'intervals', coalesce((select jsonb_agg(jsonb_build_object('armed_from', x.occurred_at, 'disarmed_at', x.disarmed_at) order by x.seq)
                             from (select a.seq, a.action, a.occurred_at, lead(a.occurred_at) over (order by a.seq) as disarmed_at
                                     from private.email_evidence_arming_events a) x
                            where x.action = 'arm'), '[]'::jsonb),
    'retention', jsonb_build_object(
      'retained', (select count(*) from stored),
      'retained_linked', (select count(*) from stored where linked),
      'retained_unlinked', (select count(*) from stored where not linked),
      'expired', (select count(*) from stored where expired),
      'oldest_expired_expires_at', (select min(s.expires_at) from stored s where s.expired),
      'latest_expires_at', (select max(s.expires_at) from stored s),
      'purge_duty', exists (select 1 from stored),
      'last_purge', (select jsonb_build_object('ran_at', p.ran_at, 'deleted', p.deleted,
                                               'remaining_expired', p.remaining_expired, 'remaining_over_cap', p.remaining_over_cap)
                       from private.email_provider_event_purges p order by p.id desc limit 1)))
    into result;
  return result;
end $$;

-- 5. Probe authorization and readback (R3D-3, R3D-4) -----------------------------------------------

-- The probe route's per-invocation authorization: an operator session, or 42501.
create function public.email_evidence_probe_authorize()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return true;
end $$;

-- The unexpired receipts for one provider email ID that the probe route received from its own
-- send. A probe is untagged and sent to a test address, so its receipts are `unmatched`: they
-- prove provider transport and event behaviour only, never a ledger rule. If any receipt for the
-- ID is linked, tagged or conflicted, the ID is not a probe's and nothing is returned. The ID,
-- svix-id, tags, recipient and payload are never returned.
create function public.email_evidence_probe_readback(p_provider_email_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare not_probe boolean; receipts jsonb;
begin
  perform public.vendor_require_operator();
  if p_provider_email_id is null or p_provider_email_id !~ '^[A-Za-z0-9._:-]{1,100}$' then
    raise exception 'A provider email ID is required' using errcode = '22023';
  end if;
  select exists (select 1 from private.email_provider_events e
                  where e.provider_email_id = p_provider_email_id
                    and (e.identity_class <> 'unmatched' or e.tag_ledger is not null))
    into not_probe;
  if not not_probe then
    select coalesce(jsonb_agg(jsonb_build_object(
             'event_type', e.event_type,
             'fact', private.email_evidence_fact(e.event_type, e.bounce_type),
             'bounce_type', e.bounce_type,
             'bounce_subtype', e.bounce_subtype,
             'provider_created_at', e.provider_created_at,
             'received_at', e.received_at,
             'state', private.email_evidence_receipt_state(e))
           order by e.provider_created_at nulls last, e.received_at, e.svix_id), '[]'::jsonb)
      into receipts
      from private.email_provider_events e
     where e.provider_email_id = p_provider_email_id and e.expires_at > now();
  end if;
  return jsonb_build_object('checked_at', now(), 'not_probe', not_probe,
                            'receipts', coalesce(receipts, '[]'::jsonb));
end $$;

-- 6. Privileges ---------------------------------------------------------------------------------

revoke all on function
  private.email_evidence_arming_events_guard(),
  private.email_evidence_transition(text, text),
  public.email_evidence_arm(text),
  public.email_evidence_disarm(text),
  private.email_evidence_retry_horizon(),
  private.email_evidence_coverage(timestamptz),
  public.email_evidence_arming_readback(),
  public.email_evidence_probe_authorize(),
  public.email_evidence_probe_readback(text)
from public, anon, authenticated, service_role;

grant execute on function
  public.email_evidence_arm(text),
  public.email_evidence_disarm(text),
  public.email_evidence_arming_readback(),
  public.email_evidence_probe_authorize(),
  public.email_evidence_probe_readback(text)
to authenticated;

reset lock_timeout;
