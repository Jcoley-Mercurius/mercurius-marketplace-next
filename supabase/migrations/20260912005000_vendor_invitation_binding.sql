-- TRACE-070: bind the account that accepted a provider invitation to the provider
-- under review, through a reviewed operator decision.
--
-- TRACE-063 acceptance records an immutable receipt and binds nothing. TRACE-068
-- grants the vendor role at activation only to a reviewed binding. So until now an
-- invitation-onboarded provider activated with 'no_account' and no portal access.
--
-- The binding is recorded in the TRACE-067 decision log as a 'link' naming the
-- acceptance receipt it relied on. The existing reviewed-link predicate, the
-- activation grant, the release command and the checklist therefore treat it exactly
-- like any other reviewed binding; none of them is redefined here.
--
-- The identity comes from the receipt, never from operator input and never from an
-- email directory. Attempt status alone is not evidence: a legacy operator assertion
-- can mark an undispatched attempt 'accepted' without any receipt.
--
-- Binding grants no role, accepts no compliance evidence, activates no provider and
-- publishes no listing.

-- Which acceptance receipt a link decision relied on. Null for a link by stated
-- identity (TRACE-067) and for every release. Adding the column rewrites no decision.
alter table public.vendor_account_link_decisions
  add column invitation_attempt_id uuid references public.vendor_invitation_acceptances(attempt_id);
alter table public.vendor_account_link_decisions
  add constraint vendor_account_link_decisions_invitation_link check(invitation_attempt_id is null or action='link');

-- Replaces the TRACE-067 replay helper with the same signature, so the link and
-- release commands keep calling it unchanged. A key recorded by an invitation binding
-- is not an exact replay of a link by stated identity or of a release.
create or replace function private.vendor_account_link_replay(p_key text,p_contractor uuid,p_action text,p_auth_user uuid,p_reason text,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare prior public.vendor_account_link_decisions;
begin
 select * into prior from public.vendor_account_link_decisions where business_key=p_key;
 if not found then return null; end if;
 if prior.contractor_id<>p_contractor or prior.action<>p_action or prior.actor<>p_actor
   or prior.reason is distinct from btrim(p_reason)
   or (p_auth_user is not null and prior.auth_user_id<>p_auth_user)
   or prior.invitation_attempt_id is not null then
   raise exception 'Account linking idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'auth_user_id',prior.auth_user_id,
   'action',prior.action,'onboarding_revision',prior.onboarding_revision,'recorded',false);
end $$;

-- Exact replay of an invitation binding. Volatile, like the helper above, so the
-- re-check under the onboarding lock reads a fresh snapshot.
create function private.vendor_invitation_bind_replay(p_key text,p_contractor uuid,p_attempt uuid,p_reason text,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare prior public.vendor_account_link_decisions;
begin
 select * into prior from public.vendor_account_link_decisions where business_key=p_key;
 if not found then return null; end if;
 if prior.contractor_id<>p_contractor or prior.action<>'link' or prior.actor<>p_actor
   or prior.reason is distinct from btrim(p_reason)
   or prior.invitation_attempt_id is distinct from p_attempt then
   raise exception 'Account linking idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'auth_user_id',prior.auth_user_id,
   'invitation_attempt_id',prior.invitation_attempt_id,'action',prior.action,
   'onboarding_revision',prior.onboarding_revision,'recorded',false);
end $$;

create function public.vendor_bind_invited_account(p_contractor uuid,p_expected_revision integer,p_attempt uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; c public.contractors;
 receipt public.vendor_invitation_acceptances; d public.vendor_invitation_dispatches;
 target auth.users; recipient text; next_revision integer;
begin
 actor:=public.vendor_require_operator();
 -- Exact replays resolve before validation, as for the TRACE-067 commands.
 replay:=private.vendor_invitation_bind_replay(p_key,p_contractor,p_attempt,p_reason,actor);
 if replay is not null then return replay; end if;
 select * into o from public.vendor_onboarding where contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 replay:=private.vendor_invitation_bind_replay(p_key,p_contractor,p_attempt,p_reason,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_reason,'')))=0 or length(btrim(coalesce(p_key,'')))=0 then
   raise exception 'Reason and idempotency key required';
 end if;
 if p_attempt is null then raise exception 'Accepted invitation required'; end if;
 if o.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
 if o.status<>'review' then raise exception 'Account binding requires onboarding review'; end if;

 recipient:=private.vendor_account_link_recipient(p_contractor);

 -- The receipt is the evidence: the verified recipient explicitly accepted this
 -- provider's invitation. An attempt for another provider is reported the same way
 -- as a missing receipt, so this command does not confirm other providers' attempts.
 select r.* into receipt from public.vendor_invitation_acceptances r
  join public.vendor_invitation_attempts a on a.id=r.attempt_id
  where r.attempt_id=p_attempt and a.contractor_id=p_contractor;
 if not found then raise exception 'Accepted invitation required'; end if;
 -- Acceptance answered one application revision. A later revision is a different
 -- review, and the recipient has not accepted an invitation for it.
 if receipt.application_version_id<>o.application_version_id then
   raise exception 'Accepted invitation is for a superseded application version';
 end if;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt;
 if d.auth_user_id is distinct from receipt.auth_user_id or d.recipient_email is distinct from recipient then
   raise exception 'Account identity does not match the reviewed application recipient';
 end if;

 -- Re-prove the account now, by ID: it may have changed since it accepted.
 select * into target from auth.users where id=receipt.auth_user_id;
 if not found then raise exception 'Account identity not found'; end if;
 if target.email_confirmed_at is null then raise exception 'Confirmed account required'; end if;
 if lower(btrim(target.email)) is distinct from recipient then
   raise exception 'Account identity does not match the reviewed application recipient';
 end if;

 select * into strict c from public.contractors where id=p_contractor for update;
 if c.user_id is not null then
   if c.user_id=receipt.auth_user_id and private.vendor_reviewed_link(p_contractor) is not null then
     raise exception 'Account already bound to this provider';
   end if;
   raise exception 'Existing account link requires the compliance cutover path';
 end if;
 if exists(select 1 from public.contractors where user_id=receipt.auth_user_id and id<>p_contractor) then
   raise exception 'Account already linked to another provider';
 end if;
 -- A newer attempt prepared after this acceptance would create a second account
 -- path for the same provider. Close it first.
 if exists(select 1 from public.vendor_invitation_attempts
   where contractor_id=p_contractor and status in ('prepared','submitted','unknown','delivered')) then
   raise exception 'Close the live invitation before binding an account';
 end if;

 next_revision:=o.revision+1;
 begin
   update public.contractors set user_id=receipt.auth_user_id,updated_at=now() where id=p_contractor;
 exception when unique_violation then
   raise exception 'Account already linked to another provider';
 end;
 update public.vendor_onboarding set revision=next_revision where contractor_id=p_contractor;
 insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
   values(p_contractor,next_revision,'invited_account_bound',o.status,o.status,actor,btrim(p_reason),'invitation-bind:'||p_key);
 begin
   insert into public.vendor_account_link_decisions(business_key,contractor_id,application_version_id,action,
     auth_user_id,recipient_email,onboarding_revision,actor,reason,invitation_attempt_id)
     values(p_key,p_contractor,o.application_version_id,'link',receipt.auth_user_id,recipient,next_revision,actor,btrim(p_reason),p_attempt);
 exception when unique_violation then
   raise exception 'Account linking idempotency conflict';
 end;
 -- No role grant, evidence, activation or public listing follows from this.
 return jsonb_build_object('contractor_id',p_contractor,'auth_user_id',receipt.auth_user_id,
   'invitation_attempt_id',p_attempt,'action','link','onboarding_revision',next_revision,'recorded',true);
end $$;

-- Unchanged from 20260912003000 except for the invitation facts: the source of the
-- live link, the receipt each decision relied on, and the newest acceptance receipt
-- for this provider. Still facts only; it writes nothing and permits nothing.
create or replace function public.vendor_account_link_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.vendor_onboarding; c public.contractors; v public.vendor_application_versions;
 live public.vendor_account_link_decisions; recipient text;
 receipt public.vendor_invitation_acceptances; receipt_user auth.users;
begin
 perform public.vendor_require_operator();
 select * into o from public.vendor_onboarding where contractor_id=p_contractor;
 if not found then raise exception 'Onboarding record not found'; end if;
 select * into strict c from public.contractors where id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 recipient:=lower(btrim(v.application->>'email'));
 select * into live from public.vendor_account_link_decisions
  where contractor_id=p_contractor order by sequence desc limit 1;
 select r.* into receipt from public.vendor_invitation_acceptances r
  join public.vendor_invitation_attempts a on a.id=r.attempt_id
  where a.contractor_id=p_contractor order by r.accepted_at desc,r.attempt_id desc limit 1;
 select * into receipt_user from auth.users where id=receipt.auth_user_id;
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',o.status,
  'onboarding_revision',o.revision,
  'application_id',v.application_id,
  'application_version_id',o.application_version_id,
  'version_current',not exists(select 1 from public.vendor_application_versions newer
    where newer.application_id=v.application_id and newer.revision>v.revision),
  'recipient_email',recipient,
  'recipient_valid',recipient is not null
    and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$',
  'linked',c.user_id is not null,
  'linked_user_id',c.user_id,
  'linked_email',(select lower(btrim(u.email)) from auth.users u where u.id=c.user_id),
  'link_reviewed',coalesce(c.user_id is not null and live.action='link' and live.auth_user_id=c.user_id,false),
  -- How the live reviewed binding was established; null when there is none.
  'link_source',case when c.user_id is not null and live.action='link' and live.auth_user_id=c.user_id
    then case when live.invitation_attempt_id is null then 'stated_identity' else 'accepted_invitation' end end,
  'invitation_live',exists(select 1 from public.vendor_invitation_attempts
    where contractor_id=p_contractor and status in ('prepared','submitted','unknown','delivered')),
  -- The newest acceptance receipt and the facts a binding would be checked against.
  'accepted_invitation',case when receipt.attempt_id is null then null else jsonb_build_object(
    'attempt_id',receipt.attempt_id,
    'auth_user_id',receipt.auth_user_id,
    'accepted_at',receipt.accepted_at,
    'account_email',lower(btrim(receipt_user.email)),
    'account_confirmed',receipt_user.email_confirmed_at is not null,
    'for_current_version',receipt.application_version_id=o.application_version_id,
    'bound',coalesce(c.user_id is not null and live.action='link' and live.invitation_attempt_id=receipt.attempt_id
      and live.auth_user_id=c.user_id,false)) end,
  'vendor_role_held',c.user_id is not null and exists(select 1 from public.user_roles r
    where r.user_id=c.user_id and r.role='vendor'),
  'vendor_role_from_activation',c.user_id is not null
    and private.vendor_activation_role_owned(p_contractor,c.user_id),
  'decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'action',d.action,'auth_user_id',d.auth_user_id,'recipient_email',d.recipient_email,
      'invitation_attempt_id',d.invitation_attempt_id,
      'onboarding_revision',d.onboarding_revision,'reason',d.reason,'created_at',d.created_at)
      order by d.sequence desc),'[]'::jsonb)
    from public.vendor_account_link_decisions d where d.contractor_id=p_contractor),
  'role_decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'action',d.action,'outcome',d.outcome,'auth_user_id',d.auth_user_id,
      'onboarding_revision',d.onboarding_revision,'created_at',d.created_at)
      order by d.id desc),'[]'::jsonb)
    from public.vendor_role_decisions d where d.contractor_id=p_contractor));
end $$;

-- Recovery guard. Once this provider's recipient has accepted an invitation, an Auth
-- account exists at that address. A new invitation to it is refused by Auth, recorded
-- as 'unknown', cannot be reconciled (the account's invited_at predates the dispatch)
-- and cannot be closed, so the provider would be left with a permanently live attempt
-- that also blocks linking by account ID. Refuse before the attempt is recorded or
-- reserved; the recovery is linking that account by ID.
-- Read by ID from this provider's own receipts; no email directory is searched.
create function private.vendor_invitation_recipient_account(p_contractor uuid,p_recipient text)
returns uuid language sql stable set search_path='' as $$
 select u.id from public.vendor_invitation_acceptances r
 join public.vendor_invitation_attempts a on a.id=r.attempt_id
 join auth.users u on u.id=r.auth_user_id
 where a.contractor_id=p_contractor and lower(btrim(u.email))=p_recipient
 order by r.accepted_at desc limit 1
$$;

-- Unchanged from 20260905002000 except for the recovery guard.
create or replace function public.vendor_prepare_invitation(p_contractor uuid,p_key text,p_expires timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; v public.vendor_onboarding; a public.vendor_invitation_attempts;
begin
  actor:=public.vendor_require_operator();
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  if v.status in ('suspended','rejected') then raise exception 'Invitation not permitted'; end if;
  select * into a from public.vendor_invitation_attempts where business_key=p_key;
  if found then
    if a.contractor_id<>p_contractor or a.application_version_id<>v.application_version_id or a.expires_at<>p_expires then raise exception 'Invitation idempotency conflict'; end if;
    return a.id;
  end if;
  if p_expires is null or p_expires<=now() then raise exception 'Provider-configured invitation expiry required'; end if;
  if private.vendor_invitation_recipient_account(p_contractor,(select lower(btrim(av.application->>'email'))
      from public.vendor_application_versions av where av.id=v.application_version_id)) is not null then
    raise exception 'Recipient already holds an account; link it by account ID';
  end if;
  insert into public.vendor_invitation_attempts(contractor_id,application_version_id,business_key,expires_at,created_by)
    values(p_contractor,v.application_version_id,p_key,p_expires,actor) returning * into a;
  return a.id;
end $$;

-- Unchanged from 20260909001000 except for the recovery guard, which also covers an
-- attempt prepared before this migration.
create or replace function public.vendor_claim_invitation(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts; o public.vendor_onboarding;
 v public.vendor_application_versions; recipient text;
begin
 actor:=public.vendor_require_operator();
 select onboarding.* into strict o from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 if exists(select 1 from public.vendor_invitation_dispatches where attempt_id=a.id) then
   return jsonb_build_object('claimed',false,'status',a.status);
 end if;
 select * into strict v from public.vendor_application_versions where id=a.application_version_id;
 if a.status<>'prepared' or a.expires_at<=now() or o.status in ('suspended','rejected')
   or o.application_version_id<>a.application_version_id
   or exists(select 1 from public.vendor_application_versions newer where newer.application_id=v.application_id and newer.revision>v.revision)
   or not exists(select 1 from public.vendor_applications app where app.id=v.application_id
     and app.contractor_id=a.contractor_id and app.status not in ('rejected','abandoned')) then
   raise exception 'Current invitation and application required';
 end if;
 if exists(select 1 from public.contractors where id=a.contractor_id and user_id is not null) then
   raise exception 'Existing account requires reviewed account linking';
 end if;
 recipient:=lower(btrim(v.application->>'email'));
 if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception 'Application recipient required';
 end if;
 if private.vendor_invitation_recipient_account(a.contractor_id,recipient) is not null then
   raise exception 'Recipient already holds an account; link it by account ID';
 end if;
 insert into public.vendor_invitation_dispatches(attempt_id,recipient_email,started_by) values(a.id,recipient,actor);
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,'prepared','submitted','Auth dispatch reserved; delivery not yet confirmed',actor);
 update public.vendor_invitation_attempts set status='submitted' where id=a.id;
 return jsonb_build_object('claimed',true,'recipient_email',recipient,'expires_at',a.expires_at);
end $$;

-- Unchanged from 20260912001000 except for recipient_account_id. Still read-only.
create or replace function public.vendor_invitation_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.vendor_onboarding; c public.contractors; v public.vendor_application_versions;
 a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches; recipient text;
begin
 perform public.vendor_require_operator();
 select * into o from public.vendor_onboarding where contractor_id=p_contractor;
 if not found then raise exception 'Onboarding record not found'; end if;
 select * into strict c from public.contractors where id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 -- The bound snapshot recipient, not the editable application row: this is the
 -- address a dispatch would actually use.
 recipient:=lower(btrim(v.application->>'email'));
 -- The current record is the live attempt when one exists, otherwise the newest
 -- closed one: an accepted or revoked attempt is evidence the operator must see,
 -- not history to bury. At most one attempt can be live.
 select * into a from public.vendor_invitation_attempts
  where contractor_id=p_contractor
  order by (status in ('prepared','submitted','unknown','delivered')) desc,created_at desc,id desc
  limit 1;
 select * into d from public.vendor_invitation_dispatches where attempt_id=a.id;
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',o.status,
  'onboarding_revision',o.revision,
  'application_id',v.application_id,
  'application_version_id',o.application_version_id,
  'version_current',not exists(select 1 from public.vendor_application_versions newer
    where newer.application_id=v.application_id and newer.revision>v.revision),
  'recipient_email',recipient,
  'recipient_valid',recipient is not null
    and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$',
  'account_linked',c.user_id is not null,
  -- TRACE-070: this recipient already accepted and holds an account, so a new
  -- invitation would be refused; the recovery is linking that account by ID.
  'recipient_account_id',private.vendor_invitation_recipient_account(p_contractor,recipient),
  'attempt',case when a.id is null then null else jsonb_build_object(
    'attempt_id',a.id,'status',a.status,'expires_at',a.expires_at,'created_at',a.created_at,
    'expired',a.expires_at<=now(),
    -- public.vendor_one_live_invitation permits one attempt in these statuses.
    'live',a.status in ('prepared','submitted','unknown','delivered'),
    'dispatch_state',d.state,'auth_user_id',d.auth_user_id,
    'accepted',exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id)) end,
  'prior_attempts',(select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id',x.id,'status',x.status,'expires_at',x.expires_at,'created_at',x.created_at)
      order by x.created_at desc),'[]'::jsonb)
    from public.vendor_invitation_attempts x
    where x.contractor_id=p_contractor and x.id is distinct from a.id));
end $$;
revoke all on function private.vendor_account_link_replay(text,uuid,text,uuid,text,uuid),
 private.vendor_invitation_bind_replay(text,uuid,uuid,text,uuid),
 public.vendor_bind_invited_account(uuid,integer,uuid,text,text),
 public.vendor_account_link_overview(uuid),
 private.vendor_invitation_recipient_account(uuid,text),
 public.vendor_prepare_invitation(uuid,text,timestamptz),
 public.vendor_claim_invitation(uuid),
 public.vendor_invitation_overview(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_bind_invited_account(uuid,integer,uuid,text,text),
 public.vendor_account_link_overview(uuid),
 public.vendor_prepare_invitation(uuid,text,timestamptz),
 public.vendor_claim_invitation(uuid),
 public.vendor_invitation_overview(uuid) to authenticated;
