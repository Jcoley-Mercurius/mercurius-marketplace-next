-- TRACE-112/113 follow-up: the source comparison of pricing-improvements.md (items 2, 4, 8, 13)
-- and DEC-2026-041 items 4-7. Additive: new guard, index and functions; no data is changed.
--
-- 1. Package names (source item 2): a vendor's active packages for one service have distinct
--    names on every write path, not only operator publication. The vendor editor writes
--    vendor_packages directly, so a trigger refuses the duplicate with the same message and
--    a unique partial index closes the race. Hosted inventory 2026-10-18: no same-name group.
-- 2. Package content for operators (source items 4, 8, 13): admin_package_contents returns
--    the content document of live packages, so the Vendor Prices list shows description,
--    included scope, price meaning and add-ons in the same words as drafts. It also reports
--    each package's recorded approval evidence (DEC-2026-041 item 5) without inferring any.

-- 1. Package names ---------------------------------------------------------------------------

create function private.vendor_package_name_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active and exists (select 1 from public.vendor_packages p
      where p.contractor_id = new.contractor_id and p.service_id = new.service_id and p.is_active
        and p.id <> new.id and p.lineage_id <> new.lineage_id
        and lower(btrim(p.name)) = lower(btrim(new.name))) then
    raise exception 'This vendor already has an active package named "%" for this service; rename it or replace that package',
      btrim(new.name) using errcode = '23505';
  end if;
  return new;
end $$;
revoke all on function private.vendor_package_name_guard() from public, anon, authenticated, service_role;
-- Runs after trg_vendor_package_lineage (alphabetical order), so lineage_id is set.
create trigger trg_vendor_package_name before insert or update of name, is_active, contractor_id, service_id
  on public.vendor_packages for each row execute function private.vendor_package_name_guard();

create unique index vendor_packages_one_active_name
  on public.vendor_packages(contractor_id, service_id, lower(btrim(name))) where is_active;

-- 2. Package content for operators -----------------------------------------------------------

-- What is recorded about a package's approval. vendor_approved: published from an operator
-- draft whose exact revision the vendor approved. operator_published: published from an
-- operator draft without vendor approval (DEC-2026-035). managed_template: activated from a
-- Mercurius template. unrecorded: written by the vendor editor or directly by an admin; no
-- authorship is recorded, so no approval is claimed.
create function private.package_approval_evidence(p_package uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', case
      when exists (select 1 from private.operator_package_drafts d where d.package_id = p.id and d.status = 'published'
        and d.approved_hash is not null and d.approved_hash = d.content_hash) then 'vendor_approved'
      when exists (select 1 from private.operator_package_drafts d where d.package_id = p.id and d.status = 'published') then 'operator_published'
      when p.template_id is not null then 'managed_template'
      else 'unrecorded' end,
    'operator_corrected', exists (select 1 from private.vendor_package_price_corrections h
      where h.package_id = p.id and not h.changes @> '[{"kind":"suspended"}]'),
    'replacement', (select jsonb_build_object('draft_id', d.id, 'approval_state', d.approval_state)
      from private.operator_package_drafts d where d.target_package_id = p.id and d.status = 'draft'
      order by d.created_at desc limit 1))
  from public.vendor_packages p where p.id = p_package
$$;
revoke all on function private.package_approval_evidence(uuid) from public, anon, authenticated, service_role;

-- [{package_id, content, approval}] for one vendor's packages, or every package when p_contractor is null.
create function public.admin_package_contents(p_contractor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  return coalesce((select jsonb_agg(jsonb_build_object('package_id', p.id, 'content', private.package_content(p.id),
        'approval', private.package_approval_evidence(p.id))
      order by p.sort_order, p.name)
    from public.vendor_packages p where p_contractor is null or p.contractor_id = p_contractor), '[]'::jsonb);
end $$;
revoke all on function public.admin_package_contents(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_package_contents(uuid) to authenticated;

-- 3. Unlinked-vendor notice by email (DEC-2026-041 item 6) ------------------------------------
--
-- When no vendor account is bound to the provider, a send goes to the provider's contact
-- email on file through the TRACE-104 delivery pattern: the database records one notice per
-- sent revision; a server route claims it with the service key, sends it with Resend and
-- records the outcome. The email names no price and says that approval needs the linked
-- account; it cannot approve, and replies do nothing. With no contact email the send stays
-- blocked and recorded. A bound account without vendor access stays blocked as before.
-- Approval itself is unchanged: only the bound vendor account approves the sent revision.

create table private.package_draft_email_notices (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references private.operator_package_drafts(id) on delete cascade,
  revision text not null,
  state text not null default 'pending'
    check (state in ('pending', 'sending', 'sent', 'failed', 'unknown', 'resend_requested')),
  attempts integer not null default 0 check (attempts >= 0),
  claim_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text check (length(provider_message_id) <= 200),
  last_error text check (length(last_error) <= 500),
  requested_by uuid,
  requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (draft_id, revision),
  check ((state = 'sending') = (claim_id is not null)),
  check ((state = 'sent') = (sent_at is not null))
);
alter table private.package_draft_email_notices enable row level security;
revoke all on private.package_draft_email_notices from public, anon, authenticated, service_role;

-- The state an operator acts on: a pending or sending notice left by a lost sender is
-- missed or unknown after the TRACE-104 interval.
create function private.package_draft_email_view(p_notice private.package_draft_email_notices) returns text
language sql stable set search_path = '' as $$
  select case
    when p_notice.id is null then 'not_sent'
    when p_notice.state = 'pending' and p_notice.created_at < now() - private.r0_notification_stale_after() then 'missed'
    when p_notice.state = 'sending' and p_notice.claimed_at < now() - private.r0_notification_stale_after() then 'unknown'
    else p_notice.state end
$$;

-- Restates 20261018002000, adding email_on_file. `blocker` still says why no in-app approval
-- request can reach the vendor (promotion offers stay blocked on it); drafts use email_on_file.
create or replace function private.package_draft_vendor_link(p_contractor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'linked', c.user_id is not null,
    'vendor_role', c.user_id is not null and public.has_role(c.user_id, 'vendor'),
    'email_on_file', c.user_id is null and nullif(btrim(coalesce(c.email, '')), '') is not null,
    'blocker', case when c.user_id is null then 'No vendor account is bound to this provider'
                    when not public.has_role(c.user_id, 'vendor') then 'The bound account does not have vendor access yet' end)
  from public.contractors c where c.id = p_contractor
$$;

-- Restates 20261018002000: the email notice of the sent revision is part of delivery.
create or replace function private.package_draft_delivery(p_draft private.operator_package_drafts) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case
    when p_draft.notification_id is not null then
      coalesce((select jsonb_build_object('channel', 'in_app', 'email', 'not_sent', 'sent_at', n.created_at,
          'status', case when n.read_at is null then 'in_inbox' else 'read' end, 'read_at', n.read_at)
        from public.notifications n where n.id = p_draft.notification_id),
        jsonb_build_object('channel', 'in_app', 'email', 'not_sent', 'status', 'removed_by_vendor'))
    when e.id is not null then
      jsonb_build_object('channel', 'email', 'status', 'emailed', 'email', private.package_draft_email_view(e),
        'email_attempts', e.attempts, 'email_sent_at', e.sent_at, 'email_error', e.last_error)
    else jsonb_build_object('channel', 'in_app', 'status', 'not_sent', 'email', 'not_sent')
  end
  from (select 1) one
  left join private.package_draft_email_notices e
    on e.draft_id = p_draft.id and e.revision = p_draft.sent_hash and p_draft.approval_state <> 'draft'
$$;

-- Restates 20261018002000 (TRACE-113): an unbound provider with a contact email is sent to
-- by email instead of being blocked. Everything else is unchanged.
create or replace function public.admin_send_package_draft(p_draft uuid, p_revision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  draft private.operator_package_drafts;
  vendor_user uuid;
  link jsonb;
  notification uuid;
  resend boolean;
  notice uuid;
  reason text;
begin
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if draft.status <> 'draft' then raise exception 'This draft was already published or discarded'; end if;
  if p_revision is null or p_revision <> draft.content_hash then
    raise exception 'Draft changed since it was read; reload before sending' using errcode = '40001';
  end if;
  if draft.approval_state = 'approved' then raise exception 'The vendor already approved this revision'; end if;
  -- The catalog may have changed since the draft was saved.
  perform private.pricing_normalize_content(draft.content, draft.service_id);

  link := private.package_draft_vendor_link(draft.contractor_id);
  resend := draft.approval_state = 'sent' and draft.sent_hash = draft.content_hash;

  if coalesce((link ->> 'email_on_file')::boolean, false) then
    -- DEC-2026-041 item 6: notice only. Approval still needs the bound vendor account.
    insert into private.package_draft_email_notices(draft_id, revision) values (draft.id, draft.content_hash)
      on conflict (draft_id, revision) do nothing returning id into notice;
    update private.operator_package_drafts
       set approval_state = 'sent', sent_hash = draft.content_hash, sent_at = now(), sent_by = actor,
           notification_id = null, change_request = null
     where id = draft.id returning * into draft;
    perform private.record_package_draft_event(draft.id, case when resend then 'resent' else 'sent' end, actor, 'operator',
      draft.content_hash, null, jsonb_build_object('channel', 'email'),
      'No vendor account is bound; notice queued for the contact email on file. Email is not approval.');
    return jsonb_build_object('status', 'sent', 'channel', 'email', 'email_queued', notice is not null,
      'draft', private.operator_package_draft_json(draft));
  end if;

  if not coalesce((link ->> 'vendor_role')::boolean, false) then
    reason := (link ->> 'blocker') || case when not (link ->> 'linked')::boolean then ' and no contact email is on file' else '' end;
    perform private.record_package_draft_event(draft.id, 'send_blocked', actor, 'operator', draft.content_hash, null, null, reason);
    return jsonb_build_object('status', 'blocked', 'reason', reason, 'draft', private.operator_package_draft_json(draft));
  end if;
  select c.user_id into vendor_user from public.contractors c where c.id = draft.contractor_id;

  insert into public.notifications(user_id, type, severity, title, body, link, related_contractor_id)
    values (vendor_user, 'pricing', 'info', 'A price is waiting for your approval',
      draft.name || ': review the price Mercurius prepared and approve it or ask for changes.',
      '/vendor/packages#price-approvals', draft.contractor_id)
    returning id into notification;
  update private.operator_package_drafts
     set approval_state = 'sent', sent_hash = draft.content_hash, sent_at = now(), sent_by = actor,
         notification_id = notification, change_request = null
   where id = draft.id returning * into draft;
  perform private.record_package_draft_event(draft.id, case when resend then 'resent' else 'sent' end, actor, 'operator',
    draft.content_hash, null, jsonb_build_object('notification_id', notification), null);
  return jsonb_build_object('status', 'sent', 'channel', 'in_app', 'draft', private.operator_package_draft_json(draft));
end $$;

-- Service key only: the delivery route claims the notice of a draft's sent revision.
-- mode `initial` claims a pending notice; `resend` one an operator asked to resend.
-- The recipient is the provider's contact email read now; the content names no price.
create function public.pricing_claim_draft_email(p_draft uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare draft private.operator_package_drafts; notice private.package_draft_email_notices; claim uuid;
  recipient text; vendor_name text;
begin
  if p_mode not in ('initial', 'resend') then raise exception 'Unknown notification claim mode'; end if;
  select * into draft from private.operator_package_drafts where id = p_draft;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  select * into notice from private.package_draft_email_notices
   where draft_id = p_draft and revision = draft.sent_hash and draft.approval_state = 'sent' for update;
  if not found then return jsonb_build_object('claimed', false, 'state', 'not_sent'); end if;
  if (p_mode = 'initial' and notice.state <> 'pending') or (p_mode = 'resend' and notice.state <> 'resend_requested') then
    return jsonb_build_object('claimed', false, 'state', private.package_draft_email_view(notice));
  end if;
  select nullif(btrim(c.email), ''), c.name into recipient, vendor_name
    from public.contractors c where c.id = draft.contractor_id and c.user_id is null;
  if recipient is null then
    -- Linked since, or the contact email was removed: nothing to send by email.
    update private.package_draft_email_notices
       set state = 'failed', last_error = 'No contact email on file, or a vendor account is now bound', updated_at = now()
     where id = notice.id;
    return jsonb_build_object('claimed', false, 'state', 'failed');
  end if;
  claim := gen_random_uuid();
  update private.package_draft_email_notices
     set state = 'sending', claim_id = claim, claimed_at = now(), attempts = attempts + 1, updated_at = now()
   where id = notice.id;
  return jsonb_build_object('claimed', true, 'claim_id', claim, 'attempt', notice.attempts + 1,
    'notice_id', notice.id, 'recipient', recipient, 'vendor_name', vendor_name);
end $$;

create function public.pricing_record_draft_email(
  p_draft uuid, p_claim uuid, p_outcome text, p_provider_id text default null, p_error text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare notice private.package_draft_email_notices; detail text;
begin
  if p_outcome not in ('sent', 'failed', 'unknown') then raise exception 'Unknown notification outcome'; end if;
  select * into notice from private.package_draft_email_notices
   where draft_id = p_draft and claim_id = p_claim and state = 'sending' for update;
  if not found then raise exception 'Notification claim is not current' using errcode = '40001'; end if;
  detail := private.r0_notification_redact(p_error);
  update private.package_draft_email_notices
     set state = p_outcome, claim_id = null,
         sent_at = case when p_outcome = 'sent' then now() end,
         provider_message_id = case when p_outcome = 'sent' then left(nullif(btrim(p_provider_id), ''), 200) end,
         last_error = case when p_outcome = 'sent' then null else detail end,
         updated_at = now()
   where id = notice.id;
  return jsonb_build_object('state', p_outcome, 'attempt', notice.attempts);
end $$;

-- Operator: allow one more email for the sent revision. Failed or missed can resend
-- directly; unknown may already be in the inbox, so the operator confirms first.
create function public.admin_request_draft_email(p_draft uuid, p_resend boolean, p_confirm_unknown boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := public.vendor_require_operator(); draft private.operator_package_drafts;
  notice private.package_draft_email_notices; view_state text;
begin
  select * into draft from private.operator_package_drafts where id = p_draft for update;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  select * into notice from private.package_draft_email_notices
   where draft_id = p_draft and revision = draft.sent_hash and draft.approval_state = 'sent' for update;
  if not found then raise exception 'No email notice for the sent revision' using errcode = 'P0002'; end if;
  view_state := private.package_draft_email_view(notice);
  if not p_resend then return jsonb_build_object('state', view_state, 'attempt', notice.attempts); end if;
  if view_state = 'resend_requested' then return jsonb_build_object('state', view_state, 'attempt', notice.attempts); end if;
  if view_state not in ('failed', 'missed', 'unknown') then
    raise exception 'This email cannot be resent from %', view_state using errcode = '55000';
  end if;
  if view_state = 'unknown' and p_confirm_unknown is not true then
    raise exception 'Confirm the earlier email did not arrive before resending' using errcode = '55000';
  end if;
  update private.package_draft_email_notices
     set state = 'resend_requested', claim_id = null, requested_by = actor, requested_at = now(), updated_at = now()
   where id = notice.id;
  perform private.record_package_draft_event(draft.id, 'resent', actor, 'operator', draft.content_hash, null,
    jsonb_build_object('channel', 'email', 'previous_email_state', view_state), null);
  return jsonb_build_object('state', 'resend_requested', 'attempt', notice.attempts);
end $$;

revoke all on function
  private.package_draft_email_view(private.package_draft_email_notices),
  public.pricing_claim_draft_email(uuid, text),
  public.pricing_record_draft_email(uuid, uuid, text, text, text),
  public.admin_request_draft_email(uuid, boolean, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.pricing_claim_draft_email(uuid, text),
  public.pricing_record_draft_email(uuid, uuid, text, text, text) to service_role;
grant execute on function public.admin_request_draft_email(uuid, boolean, boolean) to authenticated;

-- 4. Material corrections need the vendor's approval (DEC-2026-041 items 4 and 5) ---------------
--
-- A price correction no longer changes a live package. The operator proposes it as a
-- replacement draft that starts from the live package's content; the vendor approves that
-- revision and the operator publishes it (TRACE-113), which pauses the old revision in the
-- same transaction. The live revision stays live until then. The same copy creates the
-- replacement drafts for the legacy operator-published packages (item 5). Operators may
-- suspend an incorrect listing while approval is obtained; accepted bookings keep their terms
-- (requests store their own pricing). Spelling or formatting fixes may stay operator-managed,
-- but no operator text-only edit exists yet, so they also go through a replacement draft.

-- A live package's content in the shape drafts validate: legacy single rules become
-- conditions, and a legacy quote level without a price meaning becomes "starting at" (its
-- amount was a lower estimate). Each conversion is reported for the operator and vendor.
create function private.pricing_draft_content_from_package(p_package uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with content as (select private.package_content(p_package) c)
  select jsonb_build_object(
    'content', (c - 'package_id' - 'lineage_id' - 'revision_number' - 'contractor_id' - 'service_id' - 'default_frequency')
      || jsonb_build_object('tiers', coalesce((select jsonb_agg(
          (t - 'rule_question_key' - 'rule_min' - 'rule_max' - 'sort_order')
          || jsonb_build_object('conditions', private.pricing_tier_conditions(t),
               'price_kind', coalesce(t ->> 'price_kind', case when c ->> 'pricing_mode' = 'fixed' then 'exact' else 'starting_at' end)))
        from jsonb_array_elements(c -> 'tiers') t), '[]'::jsonb),
        'addons', coalesce((select jsonb_agg((a - 'sort_order')
          || jsonb_build_object('price_kind', coalesce(a ->> 'price_kind', 'exact')))
        from jsonb_array_elements(c -> 'addons') a), '[]'::jsonb)),
    'conversions', coalesce((select jsonb_agg(note) from (
        select format('%s: legacy rule kept as a condition', t ->> 'name') note
          from jsonb_array_elements(c -> 'tiers') t where nullif(btrim(coalesce(t ->> 'rule_question_key', '')), '') is not null
        union all
        select format('%s: shown as "starting at" (no price meaning was recorded)', t ->> 'name')
          from jsonb_array_elements(c -> 'tiers') t where t ->> 'price_kind' is null and c ->> 'pricing_mode' <> 'fixed') notes), '[]'::jsonb))
  from content
$$;

-- Starts a replacement draft from a live package, optionally with corrected prices
-- ({tiers|addons: [{id, from, price}], deposit, deposit_from}, the correction shape). One open
-- replacement draft per package. The reason is kept with the draft's first history entry.
create function public.admin_draft_from_package(
  p_package uuid, p_expected_updated_at timestamptz, p_prices jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  pkg public.vendor_packages;
  copied jsonb;
  content jsonb;
  entry jsonb;
  list text;
  pos integer;
  current_item jsonb;
  seen text[] := '{}';
  changed integer := 0;
  draft private.operator_package_drafts;
  reason text := btrim(coalesce(p_reason, ''));
begin
  if length(reason) = 0 then raise exception 'Enter the reason. The vendor will see it.' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into pkg from public.vendor_packages where id = p_package for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and pkg.updated_at <> p_expected_updated_at then
    raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
  end if;
  if exists (select 1 from private.operator_package_drafts d where d.target_package_id = pkg.id and d.status = 'draft') then
    raise exception 'A replacement draft for this package is already open; edit that draft instead' using errcode = '55000';
  end if;

  copied := private.pricing_draft_content_from_package(pkg.id);
  content := copied -> 'content';
  if p_prices is not null then
    if jsonb_typeof(p_prices) <> 'object' then raise exception 'Price changes required' using errcode = '22023'; end if;
    foreach list in array array['tiers', 'addons'] loop
      for entry in select value from jsonb_array_elements(coalesce(p_prices -> list, '[]'::jsonb)) loop
        if (entry ->> 'id') = any(seen) then raise exception 'Each price may be changed once per correction'; end if;
        seen := seen || (entry ->> 'id');
        select ord - 1, value into pos, current_item from jsonb_array_elements(content -> list) with ordinality x(value, ord)
         where value ->> 'id' = entry ->> 'id';
        if pos is null then
          raise exception '%', case list when 'tiers' then 'Tier does not belong to this package'
            else 'Add-on does not belong to this package, or is not offered' end;
        end if;
        if (entry ->> 'from')::numeric is distinct from (current_item ->> 'price')::numeric then
          raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
        end if;
        if private.price_amount(entry -> 'price') is null then
          raise exception 'Each price must be a positive amount in whole cents' using errcode = '22023';
        end if;
        if (entry ->> 'price')::numeric <> (current_item ->> 'price')::numeric then
          content := jsonb_set(content, array[list, pos::text, 'price'], entry -> 'price');
          changed := changed + 1;
        end if;
        pos := null;
      end loop;
    end loop;
    if p_prices ? 'deposit' then
      if pkg.pricing_mode <> 'deposit_quote' then raise exception 'Only a quote + deposit package has a deposit'; end if;
      if (p_prices ->> 'deposit_from')::numeric is distinct from pkg.deposit_amount then
        raise exception 'Package changed since it was read; reload before correcting prices' using errcode = '40001';
      end if;
      if (p_prices ->> 'deposit')::numeric is distinct from pkg.deposit_amount then
        content := jsonb_set(content, '{deposit_amount}', p_prices -> 'deposit');
        changed := changed + 1;
      end if;
    end if;
    if changed = 0 then raise exception 'No price changed' using errcode = '22023'; end if;
  end if;

  draft := private.save_package_draft(null, null, pkg.contractor_id, pkg.service_id, pkg.id, content, null, null);
  update private.package_draft_events e set note = reason
   where e.sequence = (select max(x.sequence) from private.package_draft_events x where x.draft_id = draft.id);
  return jsonb_build_object('draft', private.operator_package_draft_json(draft), 'prices_changed', changed,
    'conversions', copied -> 'conversions');
end $$;

-- Replaces DEC-2026-034 publication: a price correction would change a live price without the
-- vendor's approval, so it is refused and points to the replacement draft.
create or replace function public.admin_correct_package_prices(
  p_package uuid, p_expected_updated_at timestamptz, p_prices jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.vendor_require_operator();
  raise exception 'A price change needs the vendor''s approval: propose it as a replacement draft' using errcode = '55000';
end $$;

-- An operator suspends a live package while a correction is approved. Recorded in the
-- package's correction history and told to the bound vendor, with the reason.
create function public.admin_suspend_package(p_package uuid, p_expected_updated_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := public.vendor_require_operator();
  pkg public.vendor_packages;
  reason text := btrim(coalesce(p_reason, ''));
  vendor_user uuid;
begin
  if length(reason) = 0 then raise exception 'Enter the reason. The vendor will see it.' using errcode = '22023'; end if;
  if length(reason) > 500 then raise exception 'Reason too long' using errcode = '22023'; end if;
  select * into pkg from public.vendor_packages where id = p_package for update;
  if not found then raise exception 'Package not found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or pkg.updated_at <> p_expected_updated_at then
    raise exception 'Package changed since it was read; reload before suspending' using errcode = '40001';
  end if;
  if not pkg.is_active then raise exception 'This package is already paused' using errcode = '55000'; end if;
  update public.vendor_packages set is_active = false where id = pkg.id returning * into pkg;
  insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor)
    values (pkg.id, pkg.contractor_id, pkg.name, jsonb_build_array(jsonb_build_object('kind', 'suspended')), reason, actor);
  select c.user_id into vendor_user from public.contractors c where c.id = pkg.contractor_id;
  if vendor_user is not null then
    insert into public.notifications(user_id, type, severity, title, body, link, related_contractor_id)
      values (vendor_user, 'pricing', 'warning', 'Mercurius paused one of your prices',
        pkg.name || ': ' || reason, '/vendor/packages', pkg.contractor_id);
  end if;
  return jsonb_build_object('package_id', pkg.id, 'updated_at', pkg.updated_at, 'vendor_notified', vendor_user is not null);
end $$;

revoke all on function
  private.pricing_draft_content_from_package(uuid),
  public.admin_draft_from_package(uuid, timestamptz, jsonb, text),
  public.admin_suspend_package(uuid, timestamptz, text)
from public, anon, authenticated, service_role;
grant execute on function public.admin_draft_from_package(uuid, timestamptz, jsonb, text),
  public.admin_suspend_package(uuid, timestamptz, text) to authenticated;
