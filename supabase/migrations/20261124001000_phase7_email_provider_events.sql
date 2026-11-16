-- TRACE-155 (Phase 7.3B): dormant authenticated receipt of Resend email provider events.
--
-- Plan: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md §6–§8, §11.4 and §13.2 (Codex plan
-- clearance at 5e8b813). Record: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md.
--
-- 1. private.email_provider_events: one minimal, address-free receipt per svix-id. A receipt is
--    linked at receipt time to at most one send-attempt ledger row through one of three
--    cascading FKs, and only when its tag candidate and its provider-ID candidate (searched in
--    all three ledgers) agree or exactly one is present (§7.2). Conflicted receipts are never
--    linked. Every receipt has an expiry fixed once at insert; a trigger rejects any change to
--    it and to every other stored field except the one-way content-conflict flag.
-- 2. private.email_evidence_config: the single arming-record row, created empty (7.3D sets it).
-- 3. public.email_receive_provider_event (service role only): purge up to 100 expired receipts,
--    insert-or-detect, independent identity resolution and linkage, content-conflict flag. One
--    transaction; it never changes a ledger row.
-- 4. public.email_provider_events_purge (operator only): clamped 1–1,000, oldest first,
--    skip locked, counts-only audit.
-- 5. Non-unique provider_message_id indexes on the three existing ledgers, last, under a
--    5-second statement timeout. The whole migration runs under a 2-second lock timeout: on
--    contention it aborts cleanly and nothing is applied. Do not retry in a loop on production;
--    return to Codex with a nontransactional concurrent-index rollout instead (7.3B record §7).
--
-- No existing table, column, constraint, policy, grant, function or trigger is altered or
-- dropped. The FKs live on the new table, but they make a ledger-row delete also delete that
-- row's linked receipts, and they take SHARE ROW EXCLUSIVE locks on the three ledgers until
-- this migration commits. Nothing is armed: the receiving route answers 503 until its secret
-- exists, and no secret, webhook, sender tag or scheduler is created here.

set lock_timeout = '2s';

-- 1. Receipts ---------------------------------------------------------------------------

create table private.email_provider_events (
  svix_id text primary key check (svix_id ~ '^[!-~]{1,128}$'),
  received_at timestamptz not null default now(),
  -- Set once by the receive function and never updated (trigger below).
  expires_at timestamptz not null,
  -- Which configured secret verified the request. Stored here only; never logged.
  secret_slot text not null check (secret_slot in ('current','previous')),
  processing text not null check (processing in ('recorded','invalid_payload')),
  event_type text not null check (event_type in (
    'email.sent','email.delivered','email.delivery_delayed','email.bounced',
    'email.complained','email.failed','email.suppressed','other')),
  provider_type text check (provider_type ~ '^[a-z_.]{1,64}$'),
  provider_created_at timestamptz,
  provider_email_id text check (provider_email_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
  bounce_type text check (bounce_type in ('permanent','transient','undetermined','other')),
  bounce_subtype text check (bounce_subtype in ('general','no_email','mailbox_full','message_too_large',
    'content_rejected','attachment_rejected','suppressed','message_rejected','undetermined','other')),
  tag_ledger text check (tag_ledger in ('application','owner_email','package_draft')),
  tag_ref uuid,
  tag_attempt integer check (tag_attempt between 1 and 10000),
  application_notification uuid
    references private.r0_application_notifications(application_id) on delete cascade,
  owner_email_notification uuid
    references private.owner_email_notifications(id) on delete cascade,
  package_draft_notice uuid
    references private.package_draft_email_notices(id) on delete cascade,
  linked_attempt integer check (linked_attempt between 1 and 10000),
  identity_class text not null check (identity_class in (
    'unmatched','id_only','tag_only','tag_and_id',
    'conflict_disagree','conflict_id_ambiguous','conflict_tag_invalid','id_missing')),
  content_conflict boolean not null default false,
  conflict_seen_at timestamptz,
  check (num_nonnulls(application_notification, owner_email_notification, package_draft_notice) <= 1),
  -- Linked if and only if the class is a non-conflict match.
  check ((num_nonnulls(application_notification, owner_email_notification, package_draft_notice) = 1)
         = (identity_class in ('id_only','tag_only','tag_and_id'))),
  check ((linked_attempt is not null) = (identity_class in ('id_only','tag_only','tag_and_id'))),
  -- Tag-based links point at the tagged row and attempt in the tagged ledger.
  check (identity_class not in ('tag_only','tag_and_id') or (tag_attempt = linked_attempt and (
         (tag_ledger = 'application'   and application_notification = tag_ref) or
         (tag_ledger = 'owner_email'   and owner_email_notification = tag_ref) or
         (tag_ledger = 'package_draft' and package_draft_notice     = tag_ref)))),
  check (identity_class not in ('id_only','unmatched') or tag_ledger is null),
  -- Tags are stored only as a complete, well-formed set.
  check (num_nonnulls(tag_ledger, tag_ref, tag_attempt) in (0, 3)),
  check (identity_class <> 'id_missing' or provider_email_id is null),
  check (content_conflict = (conflict_seen_at is not null)),
  check ((processing = 'invalid_payload') = (event_type = 'other' and provider_email_id is null and provider_type is null)),
  check (event_type <> 'other' or (provider_email_id is null and identity_class = 'unmatched' and bounce_type is null)),
  check (event_type = 'email.bounced' or (bounce_type is null and bounce_subtype is null)),
  check (expires_at > received_at)
);

create index email_provider_events_provider_email_id
  on private.email_provider_events (provider_email_id) where provider_email_id is not null;
create index email_provider_events_tag
  on private.email_provider_events (tag_ledger, tag_ref, tag_attempt) where tag_ledger is not null;
create index email_provider_events_application_notification
  on private.email_provider_events (application_notification) where application_notification is not null;
create index email_provider_events_owner_email_notification
  on private.email_provider_events (owner_email_notification) where owner_email_notification is not null;
create index email_provider_events_package_draft_notice
  on private.email_provider_events (package_draft_notice) where package_draft_notice is not null;
create index email_provider_events_expiry
  on private.email_provider_events (expires_at, svix_id);

-- A stored receipt is immutable. The only permitted change is the one-way content-conflict
-- flag (false → true, with its time). So a receipt-time identity conflict and a content
-- conflict, once stored, can never be cleared, and duplicates or retries never move expiry.
create function private.email_provider_events_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.expires_at is distinct from old.expires_at then
    raise exception 'A provider receipt''s expiry is fixed when it is received' using errcode = '55000';
  end if;
  if old.content_conflict and (not new.content_conflict or new.conflict_seen_at is distinct from old.conflict_seen_at) then
    raise exception 'A provider receipt''s content conflict is permanent' using errcode = '55000';
  end if;
  if (to_jsonb(new) - 'content_conflict' - 'conflict_seen_at') is distinct from
     (to_jsonb(old) - 'content_conflict' - 'conflict_seen_at') then
    raise exception 'A provider receipt is immutable except for its content-conflict flag' using errcode = '55000';
  end if;
  return new;
end $$;

create trigger email_provider_events_guard
  before update on private.email_provider_events
  for each row execute function private.email_provider_events_guard();

-- Operator purge runs: counts only, never a receipt's content.
create table private.email_provider_event_purges (
  id bigint generated always as identity primary key,
  actor uuid not null,
  applied_limit integer not null check (applied_limit between 1 and 1000),
  deleted integer not null check (deleted >= 0),
  remaining_expired integer not null check (remaining_expired between 0 and 10000),
  remaining_over_cap boolean not null,
  ran_at timestamptz not null default now()
);

-- 2. Arming record (empty until 7.3D) ----------------------------------------------------

create table private.email_evidence_config (
  singleton boolean primary key default true check (singleton),
  armed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table private.email_provider_events enable row level security;
alter table private.email_provider_event_purges enable row level security;
alter table private.email_evidence_config enable row level security;
revoke all on private.email_provider_events, private.email_provider_event_purges, private.email_evidence_config
  from public, anon, authenticated, service_role;

-- 3. Helpers ----------------------------------------------------------------------------

-- PROPOSAL pending owner decision EO-2 (plan §11.4): linked receipts 90 days, every other
-- receipt 30 days. The receiver must not be armed until EO-2 is decided; a different decision
-- replaces this function in a reviewed migration before arming.
create function private.email_provider_event_retention(p_linked boolean) returns interval
language sql immutable set search_path = '' as $$
  select case when p_linked then interval '90 days' else interval '30 days' end
$$;

-- The provider-ID candidate (§7.2): the ledger rows in all three ledgers whose stored provider
-- message ID equals p_email_id. 'missing' for no ID, 'none', 'one' (with that row's sent
-- attempt: IDs are stored only on `sent`, which is terminal) or 'ambiguous'. A read-time
-- recheck (7.3C) is expected to reuse this function.
create function private.email_provider_id_candidate(p_email_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with hits as (
    select 'application'::text as ledger, n.application_id as ref, n.attempts
      from private.r0_application_notifications n where n.provider_message_id = p_email_id
    union all
    select 'owner_email', n.id, n.attempts
      from private.owner_email_notifications n where n.provider_message_id = p_email_id
    union all
    select 'package_draft', n.id, n.attempts
      from private.package_draft_email_notices n where n.provider_message_id = p_email_id
  ), bounded as (select * from hits limit 2)
  select case
    when p_email_id is null then jsonb_build_object('kind', 'missing')
    when (select count(*) from bounded) = 0 then jsonb_build_object('kind', 'none')
    when (select count(*) from bounded) = 1 then
      (select jsonb_build_object('kind', 'one', 'ledger', ledger, 'ref', ref, 'attempt', attempts) from bounded)
    else jsonb_build_object('kind', 'ambiguous') end
$$;

-- Whether a well-formed tag names an existing ledger row and an attempt it has made.
create function private.email_provider_tag_exists(p_ledger text, p_ref uuid, p_attempt integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_ledger
    when 'application' then exists (select 1 from private.r0_application_notifications
                                     where application_id = p_ref and attempts >= p_attempt)
    when 'owner_email' then exists (select 1 from private.owner_email_notifications
                                     where id = p_ref and attempts >= p_attempt)
    when 'package_draft' then exists (select 1 from private.package_draft_email_notices
                                       where id = p_ref and attempts >= p_attempt)
    else false end
$$;

-- 4. Receive (service role only) ---------------------------------------------------------

-- Called by the route only after the request is authenticated and normalized (plan §6.2).
-- p_tag_status is 'absent' (no mm_* tag), 'valid' (a complete, well-formed set, passed in the
-- three tag arguments) or 'invalid' (any other mm_* tag set; the tag arguments are null).
-- Returns {"result": "recorded" | "duplicate" | "conflict"}. A raised error rolls everything
-- back, so the route answers 5xx and the provider retries.
create function public.email_receive_provider_event(
  p_svix_id text,
  p_secret_slot text,
  p_processing text,
  p_event_type text,
  p_provider_type text default null,
  p_provider_created_at timestamptz default null,
  p_provider_email_id text default null,
  p_bounce_type text default null,
  p_bounce_subtype text default null,
  p_tag_status text default 'absent',
  p_tag_ledger text default null,
  p_tag_ref uuid default null,
  p_tag_attempt integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  now_ts timestamptz := now();
  email_event boolean;
  v_type text; v_created timestamptz; v_email text; v_bounce text; v_subtype text;
  v_tags text; v_ledger text; v_ref uuid; v_attempt integer;
  candidate jsonb; kind text;
  class text; link_app uuid; link_owner uuid; link_draft uuid; link_attempt integer;
  inserted text;
  existing private.email_provider_events;
  existing_tags text;
begin
  if p_secret_slot is null or p_secret_slot not in ('current', 'previous') then
    raise exception 'Unknown secret slot' using errcode = '22023';
  end if;
  if p_processing is null or p_processing not in ('recorded', 'invalid_payload') then
    raise exception 'Unknown processing state' using errcode = '22023';
  end if;
  if p_tag_status is null or p_tag_status not in ('absent', 'valid', 'invalid') then
    raise exception 'Unknown tag status' using errcode = '22023';
  end if;
  if (p_tag_status = 'valid') <> (num_nonnulls(p_tag_ledger, p_tag_ref, p_tag_attempt) = 3)
     or (p_tag_status <> 'valid' and num_nonnulls(p_tag_ledger, p_tag_ref, p_tag_attempt) > 0) then
    raise exception 'Tag arguments do not match the tag status' using errcode = '22023';
  end if;
  if p_processing = 'invalid_payload' and (p_event_type is distinct from 'other'
     or num_nonnulls(p_provider_type, p_provider_created_at, p_provider_email_id, p_bounce_type, p_bounce_subtype) > 0
     or p_tag_status <> 'absent') then
    raise exception 'An invalid payload receipt carries no data' using errcode = '22023';
  end if;

  -- The normalized form stored (and compared for duplicates): an `other` event keeps only its
  -- provider type and time; bounce fields belong to bounces only.
  email_event := p_processing = 'recorded' and p_event_type is distinct from 'other';
  v_type := p_provider_type;
  v_created := p_provider_created_at;
  v_email := case when email_event then p_provider_email_id end;
  v_bounce := case when p_event_type = 'email.bounced' then p_bounce_type end;
  v_subtype := case when p_event_type = 'email.bounced' then p_bounce_subtype end;
  v_tags := case when email_event then p_tag_status else 'absent' end;
  if v_tags = 'valid' then
    v_ledger := p_tag_ledger; v_ref := p_tag_ref; v_attempt := p_tag_attempt;
  end if;

  -- Bounded purge on receipt: up to 100 expired receipts, oldest first, skipping rows another
  -- transaction holds. It runs first, so an expired receipt never answers as a duplicate.
  with doomed as (
    select e.svix_id from private.email_provider_events e
     where e.expires_at <= now_ts
     order by e.expires_at, e.svix_id
     limit 100
     for update skip locked
  )
  delete from private.email_provider_events e using doomed d where e.svix_id = d.svix_id;

  -- Independent identity resolution (§7.2). Neither candidate is computed from the other.
  if not email_event then
    class := 'unmatched';
  else
    candidate := private.email_provider_id_candidate(v_email);
    kind := candidate->>'kind';
    if v_tags = 'invalid' or (v_tags = 'valid' and not private.email_provider_tag_exists(v_ledger, v_ref, v_attempt)) then
      class := 'conflict_tag_invalid';      -- a present invalid tag never falls back to the ID
    elsif kind = 'ambiguous' then
      class := 'conflict_id_ambiguous';
    elsif kind = 'missing' then
      class := 'id_missing';
    elsif v_tags = 'absent' then
      if kind = 'none' then
        class := 'unmatched';
      else
        class := 'id_only';
        link_attempt := (candidate->>'attempt')::integer;
        case candidate->>'ledger'
          when 'application' then link_app := (candidate->>'ref')::uuid;
          when 'owner_email' then link_owner := (candidate->>'ref')::uuid;
          else link_draft := (candidate->>'ref')::uuid;
        end case;
      end if;
    elsif kind = 'none' or (candidate->>'ledger' = v_ledger and (candidate->>'ref')::uuid = v_ref
                            and (candidate->>'attempt')::integer = v_attempt) then
      class := case when kind = 'none' then 'tag_only' else 'tag_and_id' end;
      link_attempt := v_attempt;
      case v_ledger
        when 'application' then link_app := v_ref;
        when 'owner_email' then link_owner := v_ref;
        else link_draft := v_ref;
      end case;
    else
      class := 'conflict_disagree';
    end if;
  end if;

  insert into private.email_provider_events(
    svix_id, received_at, expires_at, secret_slot, processing, event_type, provider_type,
    provider_created_at, provider_email_id, bounce_type, bounce_subtype, tag_ledger, tag_ref,
    tag_attempt, application_notification, owner_email_notification, package_draft_notice,
    linked_attempt, identity_class)
  values (
    p_svix_id, now_ts,
    now_ts + private.email_provider_event_retention(class in ('id_only', 'tag_only', 'tag_and_id')),
    p_secret_slot, p_processing, p_event_type, v_type, v_created, v_email, v_bounce, v_subtype,
    v_ledger, v_ref, v_attempt, link_app, link_owner, link_draft, link_attempt, class)
  on conflict (svix_id) do nothing
  returning svix_id into inserted;
  if inserted is not null then
    return jsonb_build_object('result', 'recorded');
  end if;

  -- Same svix-id already stored (a retry, a replay or a concurrent delivery that committed
  -- first). Compare normalized content only; identity class and secret slot depend on when it
  -- arrived, not on what it says. The first receipt is kept unchanged.
  select * into existing from private.email_provider_events where svix_id = p_svix_id for update;
  if not found then
    raise exception 'The stored receipt changed during receipt; retry' using errcode = '40001';
  end if;
  existing_tags := case when existing.tag_ledger is not null then 'valid'
                        when existing.identity_class = 'conflict_tag_invalid' then 'invalid'
                        else 'absent' end;
  if (existing.processing, existing.event_type, existing.provider_type, existing.provider_created_at,
      existing.provider_email_id, existing.bounce_type, existing.bounce_subtype, existing_tags,
      existing.tag_ledger, existing.tag_ref, existing.tag_attempt)
     is not distinct from
     (p_processing, p_event_type, v_type, v_created, v_email, v_bounce, v_subtype, v_tags,
      v_ledger, v_ref, v_attempt) then
    return jsonb_build_object('result', 'duplicate');
  end if;
  if not existing.content_conflict then
    update private.email_provider_events
       set content_conflict = true, conflict_seen_at = now_ts
     where svix_id = p_svix_id;
  end if;
  return jsonb_build_object('result', 'conflict');
end $$;

-- 5. Operator purge ----------------------------------------------------------------------

-- Deletes up to p_limit (clamped to 1–1,000; default 100) expired receipts, oldest first by
-- (expires_at, svix_id), skipping rows another transaction holds. Returns the number deleted,
-- the expired rows still stored (counted up to 10,000) and the oldest remaining expiry.
-- Running it is the operator's responsibility; nothing schedules it (EO-2).
create function public.email_provider_events_purge(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  lim integer := least(1000, greatest(1, coalesce(p_limit, 100)));
  now_ts timestamptz := now();
  removed integer; remaining integer; oldest timestamptz;
begin
  actor := public.vendor_require_operator();
  with doomed as (
    select e.svix_id from private.email_provider_events e
     where e.expires_at <= now_ts
     order by e.expires_at, e.svix_id
     limit lim
     for update skip locked
  ), gone as (
    delete from private.email_provider_events e using doomed d where e.svix_id = d.svix_id returning 1
  )
  select count(*) into removed from gone;
  select count(*) into remaining from (
    select 1 from private.email_provider_events e where e.expires_at <= now_ts limit 10001) r;
  select min(e.expires_at) into oldest from private.email_provider_events e where e.expires_at <= now_ts;
  insert into private.email_provider_event_purges(actor, applied_limit, deleted, remaining_expired, remaining_over_cap)
    values (actor, lim, removed, least(remaining, 10000), remaining > 10000);
  return jsonb_build_object(
    'checked_at', now_ts,
    'limit', lim,
    'deleted', removed,
    'remaining_expired', least(remaining, 10000),
    'remaining_over_cap', remaining > 10000,
    'oldest_remaining_expires_at', oldest);
end $$;

-- 6. Privileges --------------------------------------------------------------------------

revoke all on function
  private.email_provider_events_guard(),
  private.email_provider_event_retention(boolean),
  private.email_provider_id_candidate(text),
  private.email_provider_tag_exists(text, uuid, integer),
  public.email_receive_provider_event(text, text, text, text, text, timestamptz, text, text, text, text, text, uuid, integer),
  public.email_provider_events_purge(integer)
from public, anon, authenticated, service_role;

grant execute on function
  public.email_receive_provider_event(text, text, text, text, text, timestamptz, text, text, text, text, text, uuid, integer)
to service_role;
grant execute on function public.email_provider_events_purge(integer) to authenticated;

-- 7. Existing-ledger lookup indexes (last; see the header) ---------------------------------
-- Ordinary, non-unique and partial: each existing ledger was a few rows on 2026-11-16
-- (Codex clearance #5920917095). The SHARE locks they take are held until commit, which
-- follows immediately.

set statement_timeout = '5s';
create index r0_application_notifications_provider_message_id
  on private.r0_application_notifications (provider_message_id) where provider_message_id is not null;
create index owner_email_notifications_provider_message_id
  on private.owner_email_notifications (provider_message_id) where provider_message_id is not null;
create index package_draft_email_notices_provider_message_id
  on private.package_draft_email_notices (provider_message_id) where provider_message_id is not null;
reset statement_timeout;
reset lock_timeout;
