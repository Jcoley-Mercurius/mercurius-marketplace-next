-- TRACE-063 forward fix: a definite Auth refusal is a recorded failure, not an
-- unknown outcome.
--
-- Auth refuses to invite an address that already holds a confirmed account (for
-- example a homeowner signup): it returns 422 `email_exists`, creates no user and
-- sends nothing. The TRACE-063 handler recorded every Auth error as `unknown`. That
-- attempt could not be reconciled (the account's invited_at predates the dispatch),
-- could not be closed, and held the provider's one live slot, blocking another
-- invitation and TRACE-067 linking by account ID. TRACE-070 only guarded addresses
-- found in this provider's own acceptance receipts.
--
-- `unknown` keeps its meaning: an outcome nobody can state. A refusal is recorded as
-- `failed` only on evidence:
--   * the dispatching handler's own report of Auth's structured refusal, while the
--     reservation is still `started` (no outcome recorded yet); or
--   * for a reservation already recorded `unknown`, an account read back by ID that
--     held the recipient address, confirmed, before the dispatch started and was not
--     invited after it. Auth refuses such an address, so the dispatch cannot have
--     created or invited an account. This is the exact complement of the
--     reconciliation predicate, so one reservation can never satisfy both.
-- No email directory is searched. `failed` is terminal and not live, so the slot is
-- released. Recording a refusal grants no role, links no account and activates nothing.

alter table public.vendor_invitation_dispatches
  drop constraint vendor_invitation_dispatches_state_check;
alter table public.vendor_invitation_dispatches
  add constraint vendor_invitation_dispatches_state_check
  check(state in ('started','unknown','provider_accepted','failed'));
-- The refusal Auth reported, and the account that corroborated it when one was read
-- back. No foreign key on the account: refusal evidence must not block, or be
-- erased by, a later account deletion.
alter table public.vendor_invitation_dispatches
  add column refusal_code text,
  add column refused_account_id uuid;
alter table public.vendor_invitation_dispatches
  add constraint vendor_invitation_dispatches_refusal
  check((state='failed')=(refusal_code is not null) and (refused_account_id is null or state='failed'));

-- Service-only. The Edge function is the only caller: it alone observes the Auth
-- response, and it reads any corroborating account back by ID first.
create function public.vendor_refuse_invitation(p_attempt uuid,p_code text,p_actor uuid,p_existing_account uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches; target auth.users;
begin
 perform 1 from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt for update;
 if p_actor is null or not public.has_role(p_actor,'admin') then
   raise exception 'Onboarding operator required' using errcode='42501';
 end if;
 -- Only refusals Auth issues before creating or inviting anyone.
 if p_code is null or p_code<>'email_exists' then raise exception 'Definite Auth refusal required'; end if;
 if d.state='failed' then
   if d.refusal_code=p_code and (p_existing_account is null or p_existing_account=d.refused_account_id
     or d.refused_account_id is null) then return; end if;
   raise exception 'Invitation refusal conflict';
 end if;
 if d.state='provider_accepted' then raise exception 'Invitation identity conflict'; end if;
 if p_existing_account is null then
   -- A bare report is the handler's first and only outcome for this reservation.
   if d.state<>'started' then raise exception 'Unknown invitation requires account evidence'; end if;
 else
   select * into target from auth.users where id=p_existing_account;
   if not found then raise exception 'Account identity not found'; end if;
   if lower(btrim(target.email)) is distinct from d.recipient_email
     or target.email_confirmed_at is null or target.email_confirmed_at>=d.started_at
     or (target.invited_at is not null and target.invited_at>=d.started_at) then
     raise exception 'Auth refusal evidence mismatch';
   end if;
 end if;
 if a.status not in ('submitted','unknown') then raise exception 'Invitation already closed'; end if;
 update public.vendor_invitation_dispatches
   set state='failed',refusal_code=p_code,refused_account_id=p_existing_account,resolved_at=now()
   where attempt_id=a.id;
 update public.vendor_invitation_attempts set status='failed' where id=a.id;
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,a.status,'failed',
     case when p_existing_account is null
       then 'Auth refused invitation: recipient address already holds an account; nothing sent'
       else 'Auth refusal reconciled: account '||p_existing_account||' held the recipient address before dispatch; nothing sent' end,
     p_actor);
end $$;

-- Unchanged from 20260909001000 except that a recorded refusal is final: a late
-- unknown report cannot reopen it and no identity can be attached to it.
create or replace function public.vendor_finish_invitation(p_attempt uuid,p_auth_user uuid default null,p_actor uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches; target auth.users;
begin
 perform 1 from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt for update;
 if p_actor is not null and not public.has_role(p_actor,'admin') then raise exception 'Onboarding operator required' using errcode='42501'; end if;
 if d.state='failed' then
   if p_auth_user is null then return; end if;
   raise exception 'Invitation already refused by Auth';
 end if;
 if d.state='provider_accepted' then
   if p_auth_user is null or p_auth_user=d.auth_user_id then return; end if;
   raise exception 'Invitation identity conflict';
 end if;
 if p_auth_user is null then
   if d.state='unknown' then return; end if;
   update public.vendor_invitation_dispatches set state='unknown' where attempt_id=a.id;
   update public.vendor_invitation_attempts set status='unknown' where id=a.id;
   insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
     values(a.id,a.status,'unknown','Auth outcome unknown; reconcile before any further dispatch',coalesce(p_actor,d.started_by));
   return;
 end if;
 select * into strict target from auth.users where id=p_auth_user;
 if lower(btrim(target.email)) is distinct from d.recipient_email
   or target.invited_at is null or target.invited_at<d.started_at then
   raise exception 'Auth invitation identity evidence mismatch';
 end if;
 if exists(select 1 from public.contractors where id=a.contractor_id and user_id is not null and user_id<>p_auth_user) then
   raise exception 'Invitation identity conflict';
 end if;
 update public.vendor_invitation_dispatches set state='provider_accepted',auth_user_id=p_auth_user,resolved_at=now() where attempt_id=a.id;
 update public.vendor_invitation_attempts set status='submitted',provider_reference='supabase-auth:'||a.id||':'||p_auth_user where id=a.id;
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,a.status,'submitted','Auth accepted invitation; mailbox delivery not asserted',coalesce(p_actor,d.started_by));
end $$;

-- Unchanged from 20260909001000 except for the refusal facts. Still read-only.
create or replace function public.vendor_invitation_status(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches;
begin
 actor:=public.vendor_require_operator();
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt;
 select * into d from public.vendor_invitation_dispatches where attempt_id=p_attempt;
 return jsonb_build_object('attempt_id',a.id,'status',a.status,'dispatch_state',d.state,
   'auth_user_id',d.auth_user_id,'expires_at',a.expires_at,
   'refusal_code',d.refusal_code,'refused_account_id',d.refused_account_id,
   'accepted',exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id));
end $$;

-- Unchanged from 20260912005000 except for the refusal facts. Still read-only.
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
    -- TRACE-063 refusal: Auth refused the recipient address; nothing was sent.
    'refusal_code',d.refusal_code,'refused_account_id',d.refused_account_id,
    'accepted',exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id)) end,
  'prior_attempts',(select coalesce(jsonb_agg(jsonb_build_object(
      'attempt_id',x.id,'status',x.status,'expires_at',x.expires_at,'created_at',x.created_at)
      order by x.created_at desc),'[]'::jsonb)
    from public.vendor_invitation_attempts x
    where x.contractor_id=p_contractor and x.id is distinct from a.id));
end $$;

revoke all on function public.vendor_refuse_invitation(uuid,text,uuid,uuid),
 public.vendor_finish_invitation(uuid,uuid,uuid),
 public.vendor_invitation_status(uuid),
 public.vendor_invitation_overview(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_refuse_invitation(uuid,text,uuid,uuid),
 public.vendor_finish_invitation(uuid,uuid,uuid) to service_role;
grant execute on function public.vendor_invitation_status(uuid),
 public.vendor_invitation_overview(uuid) to authenticated;
