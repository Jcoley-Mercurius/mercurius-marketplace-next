-- TRACE-154 (Phase 7.2C-1): owner-email ledger for contact-form submissions.
--
-- Plan: governance/PHASE-7-OWNER-EMAIL-LEDGER-PLAN.md (Codex-cleared at fedaf5f, with the
-- 2026-11-12 clarifications recorded in governance/PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1.md).
--
-- 1. A shared ledger for owner emails about saved records other than vendor applications.
--    The vendor-application ledger (TRACE-104) is not changed.
-- 2. Every saved contact submission gets its delivery record in the same transaction, from
--    an AFTER INSERT trigger. The insert path itself is not restated.
-- 3. Claim, outcome, resend, acknowledgement, overview and on-demand contact detail
--    (DEC-2026-066) functions. Only the service key claims and records; operator commands
--    are admin-only through public.vendor_require_operator().
--
-- The renewal-document shape (source kind, FK column, claim payload, overview label) is
-- reserved for 7.2C-2, but no renewal trigger is created here, so no renewal row can exist.
-- No existing table, column, policy, grant, function or trigger is altered or dropped.
-- No row is backfilled: submissions saved before this migration stay untracked and cannot
-- be sent or opened through these functions.

-- 1. Tables --------------------------------------------------------------------------

create table private.owner_email_notifications (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('contact_submission', 'renewal_document')),
  contact_submission_id uuid unique references public.contact_submissions(id) on delete cascade,
  renewal_document_id uuid unique references public.vendor_renewal_documents(id),
  state text not null default 'pending'
    check (state in ('pending','sending','sent','failed','unknown','resend_requested','acknowledged')),
  attempts integer not null default 0 check (attempts between 0 and 10000),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text check (length(provider_message_id) <= 200),
  -- An enumerated category only; provider text may echo submitted content (C-4).
  last_error_code text check (last_error_code in (
    'provider_refused','provider_rate_limited','provider_conflict',
    'provider_server_error','provider_timeout_or_network','provider_not_configured')),
  requested_by uuid references auth.users(id),
  requested_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  acknowledged_reason text check (length(acknowledged_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((source_kind = 'contact_submission') = (contact_submission_id is not null)),
  check ((source_kind = 'renewal_document') = (renewal_document_id is not null)),
  check ((state = 'sending') = (claim_id is not null)),
  check (state <> 'sending' or claimed_at is not null),
  check ((state = 'sent') = (sent_at is not null)),
  check ((state = 'acknowledged') = (acknowledged_at is not null))
);

create index owner_email_notifications_open
  on private.owner_email_notifications (created_at desc, id desc)
  where state <> 'sent' and state <> 'acknowledged';
create index owner_email_notifications_recent
  on private.owner_email_notifications (created_at desc, id desc);

-- Transition audit. No submitter name, address, phone, subject or message is copied in.
-- actor, source_id and reason are restricted administrative data: they are reachable only
-- through the operator-guarded functions and never written to operational logs.
-- Events follow their ledger row, which follows its source record.
create table private.owner_email_notification_events (
  id bigint generated always as identity primary key,
  notification_id uuid not null
    references private.owner_email_notifications(id) on delete cascade,
  source_kind text not null,
  source_id uuid not null,
  previous_state text,
  state text not null,
  attempt integer not null,
  actor uuid,
  error_code text,
  reason text check (length(reason) <= 500),
  -- What the operator attested before acting on an uncertain (missed/unknown) email:
  --   no_matching_email_found  resend: they checked and found no matching email;
  --   inbox_evidence_reviewed  acknowledge: they checked the inbox and provider evidence and
  --                            the reason records what they found (the email may have been found).
  attestation text check (attestation in ('no_matching_email_found', 'inbox_evidence_reviewed')),
  created_at timestamptz not null default now()
);
create index owner_email_notification_events_notification
  on private.owner_email_notification_events (notification_id, id);

alter table private.owner_email_notifications enable row level security;
alter table private.owner_email_notification_events enable row level security;
revoke all on private.owner_email_notifications, private.owner_email_notification_events
  from public, anon, authenticated, service_role;

-- 2. Private helpers -----------------------------------------------------------------

create function private.owner_email_require_kind(p_kind text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('contact_submission', 'renewal_document') then
    raise exception 'Unknown owner email kind' using errcode = '22023';
  end if;
end $$;

-- The state an operator acts on. The claim window reuses the TRACE-104 constant (10 minutes).
create function private.owner_email_state(p_state text, p_created timestamptz, p_claimed timestamptz)
returns text language sql stable set search_path = '' as $$
  select case
    when p_state = 'pending' and p_created < now() - private.r0_notification_stale_after() then 'missed'
    when p_state = 'sending' and p_claimed < now() - private.r0_notification_stale_after() then 'unknown'
    else p_state end
$$;

create function private.owner_email_log(
  p_notification uuid, p_kind text, p_source uuid, p_previous text, p_state text, p_attempt integer,
  p_actor uuid, p_error_code text, p_reason text, p_attestation text
) returns void language sql security definer set search_path = '' as $$
  insert into private.owner_email_notification_events(
    notification_id, source_kind, source_id, previous_state, state, attempt, actor, error_code, reason, attestation)
  values (p_notification, p_kind, p_source, p_previous, p_state, p_attempt, p_actor, p_error_code, p_reason, p_attestation)
$$;

-- The ledger row for one source, locked for the rest of the caller's transaction. A null
-- id means the source has no ledger row (untracked, or no such record).
create function private.owner_email_lock(p_kind text, p_source uuid)
returns private.owner_email_notifications language plpgsql security definer set search_path = '' as $$
declare n private.owner_email_notifications;
begin
  perform private.owner_email_require_kind(p_kind);
  if p_kind = 'contact_submission' then
    select * into n from private.owner_email_notifications where contact_submission_id = p_source for update;
  else
    select * into n from private.owner_email_notifications where renewal_document_id = p_source for update;
  end if;
  return n;
end $$;

-- Refusal for a source without a ledger row: an unknown record, or one saved before tracking.
create function private.owner_email_refuse_untracked(p_kind text, p_source uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_kind = 'contact_submission' and exists (select 1 from public.contact_submissions where id = p_source))
     or (p_kind = 'renewal_document' and exists (select 1 from public.vendor_renewal_documents where id = p_source)) then
    raise exception 'Not tracked; recovery for records saved before tracking is a separate proposal.'
      using errcode = '55000';
  end if;
  raise exception 'Owner email record not found' using errcode = 'P0002';
end $$;

-- 3. Atomic creation -----------------------------------------------------------------

create function private.owner_email_contact_create() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n uuid;
begin
  insert into private.owner_email_notifications(source_kind, contact_submission_id)
    values ('contact_submission', new.id)
  on conflict (contact_submission_id) do nothing
  returning id into n;
  if n is not null then
    perform private.owner_email_log(n, 'contact_submission', new.id, null, 'pending', 0, null, null, null, null);
  end if;
  return new;
end $$;

create trigger owner_email_contact_create
  after insert on public.contact_submissions
  for each row execute function private.owner_email_contact_create();

-- 4. Sender functions (service key only) ----------------------------------------------

-- One caller wins a permitted attempt; the rest learn the current state. `initial` claims
-- only a pending row inside the claim window: an older pending row (missed) may already
-- have been emailed by a previous release and is never claimed automatically. `resend`
-- claims only an operator's resend request. The content comes from the saved record.
-- A raised error rolls this transaction back; a lost response after commit leaves the row
-- `sending`, which reads `unknown` after the window and needs an operator's attestation.
create function public.owner_email_claim(p_kind text, p_source uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n private.owner_email_notifications; claim uuid; view_state text; source jsonb;
begin
  if p_mode is null or p_mode not in ('initial', 'resend') then
    raise exception 'Unknown owner email claim mode' using errcode = '22023';
  end if;
  n := private.owner_email_lock(p_kind, p_source);
  if n.id is null then raise exception 'Owner email record not found' using errcode = 'P0002'; end if;
  view_state := private.owner_email_state(n.state, n.created_at, n.claimed_at);
  if (p_mode = 'initial' and view_state <> 'pending') or (p_mode = 'resend' and n.state <> 'resend_requested') then
    return jsonb_build_object('claimed', false, 'state', view_state);
  end if;
  if p_kind = 'contact_submission' then
    select jsonb_build_object(
        'id', c.id, 'created_at', c.created_at, 'first_name', c.first_name, 'last_name', c.last_name,
        'email', c.email, 'phone', c.phone, 'subject', c.subject, 'message', c.message)
      into strict source
      from public.contact_submissions c where c.id = p_source;
  else
    -- Reserved for 7.2C-2. A null business name is a missing name, not a failure.
    select jsonb_build_object('id', d.id, 'created_at', d.created_at, 'kind', d.kind, 'business_name', k.name)
      into strict source
      from public.vendor_renewal_documents d
      left join public.contractors k on k.id = d.contractor_id
     where d.id = p_source;
  end if;
  claim := gen_random_uuid();
  update private.owner_email_notifications
     set state = 'sending', claim_id = claim, claimed_at = now(), attempts = attempts + 1, updated_at = now()
   where id = n.id;
  perform private.owner_email_log(n.id, p_kind, p_source, view_state, 'sending', n.attempts + 1, null, null, null, null);
  return jsonb_build_object('claimed', true, 'claim_id', claim, 'attempt', n.attempts + 1, 'kind', p_kind, 'source', source);
end $$;

-- The outcome of the current claim only. A stale claim (after an operator's resend request
-- or acknowledgement cleared it) is refused with 40001.
create function public.owner_email_record(
  p_kind text, p_source uuid, p_claim uuid, p_outcome text, p_provider_id text default null, p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n private.owner_email_notifications;
begin
  if p_outcome is null or p_outcome not in ('sent', 'failed', 'unknown') then
    raise exception 'Unknown owner email outcome' using errcode = '22023';
  end if;
  if (p_outcome = 'sent') <> (p_error_code is null) or (p_error_code is not null and p_error_code not in (
      'provider_refused','provider_rate_limited','provider_conflict',
      'provider_server_error','provider_timeout_or_network','provider_not_configured')) then
    raise exception 'Owner email error code must be an enumerated category for a failed or unknown outcome'
      using errcode = '22023';
  end if;
  n := private.owner_email_lock(p_kind, p_source);
  if n.id is null or n.state <> 'sending' or n.claim_id is distinct from p_claim then
    raise exception 'Owner email claim is not current' using errcode = '40001';
  end if;
  update private.owner_email_notifications
     set state = p_outcome, claim_id = null,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_message_id = case when p_outcome = 'sent' then left(nullif(btrim(p_provider_id), ''), 200) end,
         last_error_code = p_error_code,
         updated_at = now()
   where id = n.id;
  perform private.owner_email_log(n.id, p_kind, p_source, 'sending', p_outcome, n.attempts, null, p_error_code, null, null);
  return jsonb_build_object('state', p_outcome, 'attempt', n.attempts);
end $$;

-- 5. Operator commands (admin only) ---------------------------------------------------

-- Allow one more send. A failed email resends directly. A missed or unknown one may already
-- be in the owner inbox, so the operator must attest that they checked the owner inbox and
-- the Resend log and found no matching email. Untracked records are not sendable.
create function public.owner_email_request_resend(p_kind text, p_source uuid, p_confirm_no_email boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; n private.owner_email_notifications; view_state text; attestation text;
begin
  actor := public.vendor_require_operator();
  n := private.owner_email_lock(p_kind, p_source);
  if n.id is null then perform private.owner_email_refuse_untracked(p_kind, p_source); end if;
  view_state := private.owner_email_state(n.state, n.created_at, n.claimed_at);
  if view_state = 'resend_requested' then
    return jsonb_build_object('state', 'resend_requested', 'attempt', n.attempts);
  end if;
  if view_state not in ('failed', 'missed', 'unknown') then
    raise exception 'This owner email cannot be resent from %', view_state using errcode = '55000';
  end if;
  if view_state in ('missed', 'unknown') then
    if p_confirm_no_email is not true then
      raise exception 'Check the owner inbox and the Resend log, and confirm no matching email arrived, before resending'
        using errcode = '55000';
    end if;
    attestation := 'no_matching_email_found';
  end if;
  update private.owner_email_notifications
     set state = 'resend_requested', claim_id = null, requested_by = actor, requested_at = now(), updated_at = now()
   where id = n.id;
  perform private.owner_email_log(n.id, n.source_kind, p_source, view_state, 'resend_requested', n.attempts, actor, null, null, attestation);
  return jsonb_build_object('state', 'resend_requested', 'attempt', n.attempts);
end $$;

-- Record that no further email is needed, with a reason. From missed or unknown the operator
-- must attest that they checked the owner inbox and provider evidence; the reason records
-- what they found (including finding the email). One row per call: no bulk acknowledgement.
create function public.owner_email_acknowledge(p_kind text, p_source uuid, p_reason text, p_inbox_checked boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid; n private.owner_email_notifications; view_state text; attestation text;
  reason text := btrim(coalesce(p_reason, ''));
begin
  actor := public.vendor_require_operator();
  if length(reason) = 0 then raise exception 'Acknowledgement reason required' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Acknowledgement reason too long' using errcode = '22023'; end if;
  n := private.owner_email_lock(p_kind, p_source);
  if n.id is null then perform private.owner_email_refuse_untracked(p_kind, p_source); end if;
  view_state := private.owner_email_state(n.state, n.created_at, n.claimed_at);
  if view_state = 'acknowledged' then return jsonb_build_object('state', 'acknowledged'); end if;
  if view_state not in ('failed', 'resend_requested', 'missed', 'unknown') then
    raise exception 'This owner email cannot be acknowledged from %', view_state using errcode = '55000';
  end if;
  if view_state in ('missed', 'unknown') then
    if p_inbox_checked is not true then
      raise exception 'Check the owner inbox and the Resend log before acknowledging an uncertain email'
        using errcode = '55000';
    end if;
    attestation := 'inbox_evidence_reviewed';
  end if;
  update private.owner_email_notifications
     set state = 'acknowledged', claim_id = null, acknowledged_by = actor, acknowledged_at = now(),
         acknowledged_reason = reason, updated_at = now()
   where id = n.id;
  perform private.owner_email_log(n.id, n.source_kind, p_source, view_state, 'acknowledged', n.attempts, actor, null, reason, attestation);
  return jsonb_build_object('state', 'acknowledged');
end $$;

-- Bounded keyset page, newest first, with exact attention counts over the whole ledger.
-- Never returns a contact submission's name, email, phone, subject or message, nor any
-- actor ID. Without p_include_settled, only rows needing attention are listed.
create function public.owner_email_overview(
  p_kind text default null, p_include_settled boolean default false,
  p_before_created_at timestamptz default null, p_before_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare lim integer := least(100, greatest(1, coalesce(p_limit, 50))); items jsonb; counts jsonb; cursor jsonb;
begin
  perform public.vendor_require_operator();
  if p_kind is not null then perform private.owner_email_require_kind(p_kind); end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'A page cursor needs both its time and its id' using errcode = '22023';
  end if;

  select jsonb_build_object(
      'total', count(*),
      'contact_submission', count(*) filter (where source_kind = 'contact_submission'),
      'renewal_document', count(*) filter (where source_kind = 'renewal_document'))
    into counts
    from private.owner_email_notifications n
   where private.owner_email_state(n.state, n.created_at, n.claimed_at) in ('failed', 'missed', 'unknown', 'resend_requested');

  with candidates as (
    select n.*, private.owner_email_state(n.state, n.created_at, n.claimed_at) as view_state
      from private.owner_email_notifications n
     where (p_kind is null or n.source_kind = p_kind)
       and (p_before_created_at is null or (n.created_at, n.id) < (p_before_created_at, p_before_id))
       and (p_include_settled or (n.state <> 'sent' and n.state <> 'acknowledged'))
  ), listed as (
    select c.*, row_number() over (order by c.created_at desc, c.id desc) as position
      from candidates c
     where p_include_settled or c.view_state in ('failed', 'missed', 'unknown', 'resend_requested')
     order by c.created_at desc, c.id desc
     limit lim + 1
  ), page as (
    select l.*, coalesce(l.contact_submission_id, l.renewal_document_id) as source_id,
           coalesce(cs.created_at, d.created_at) as submitted_at,
           case when l.source_kind = 'contact_submission' then 'Contact submission'
                else coalesce(nullif(btrim(k.name), ''), 'A provider') || ' — '
                     || case d.kind when 'license' then 'License' when 'insurance' then 'Insurance' else 'Compliance' end
           end as label
      from listed l
      left join public.contact_submissions cs on cs.id = l.contact_submission_id
      left join public.vendor_renewal_documents d on d.id = l.renewal_document_id
      left join public.contractors k on k.id = d.contractor_id
     where l.position <= lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', source_kind, 'source_id', source_id, 'label', label, 'reference', left(source_id::text, 8),
      'submitted_at', submitted_at, 'state', view_state, 'attempts', attempts, 'last_error_code', last_error_code,
      'sent_at', sent_at, 'requested_at', requested_at, 'acknowledged_at', acknowledged_at,
      'acknowledged_reason', acknowledged_reason,
      'needs_attention', view_state in ('failed', 'missed', 'unknown', 'resend_requested'))
    order by created_at desc, id desc), '[]'::jsonb),
    case when (select count(*) from listed) > lim then
      (select jsonb_build_object('created_at', p.created_at, 'id', p.id) from page p order by p.created_at, p.id limit 1)
    end
    into items, cursor
    from page;

  return jsonb_build_object(
    'checked_at', now(),
    'stale_after_minutes', extract(epoch from private.r0_notification_stale_after())::integer / 60,
    'limit', lim,
    'attention_count', counts,
    'next_cursor', cursor,
    'items', items);
end $$;

-- DEC-2026-066 (O-1): the stored contact fields of one tracked submission, for an operator
-- handling it. Called only on an explicit operator action; untracked or unknown → P0002.
create function public.owner_email_contact_submission(p_source uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.vendor_require_operator();
  select jsonb_build_object(
      'id', c.id, 'submitted_at', c.created_at, 'first_name', c.first_name, 'last_name', c.last_name,
      'email', c.email, 'phone', c.phone, 'subject', c.subject, 'message', c.message)
    into result
    from public.contact_submissions c
   where c.id = p_source
     and exists (select 1 from private.owner_email_notifications n where n.contact_submission_id = c.id);
  if result is null then raise exception 'Tracked contact submission not found' using errcode = 'P0002'; end if;
  return result;
end $$;

-- 6. Privileges ----------------------------------------------------------------------

revoke all on function
  private.owner_email_require_kind(text),
  private.owner_email_state(text, timestamptz, timestamptz),
  private.owner_email_log(uuid, text, uuid, text, text, integer, uuid, text, text, text),
  private.owner_email_lock(text, uuid),
  private.owner_email_refuse_untracked(text, uuid),
  private.owner_email_contact_create(),
  public.owner_email_claim(text, uuid, text),
  public.owner_email_record(text, uuid, uuid, text, text, text),
  public.owner_email_request_resend(text, uuid, boolean),
  public.owner_email_acknowledge(text, uuid, text, boolean),
  public.owner_email_overview(text, boolean, timestamptz, uuid, integer),
  public.owner_email_contact_submission(uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.owner_email_claim(text, uuid, text),
  public.owner_email_record(text, uuid, uuid, text, text, text)
to service_role;
grant execute on function
  public.owner_email_request_resend(text, uuid, boolean),
  public.owner_email_acknowledge(text, uuid, text, boolean),
  public.owner_email_overview(text, boolean, timestamptz, uuid, integer),
  public.owner_email_contact_submission(uuid)
to authenticated;
