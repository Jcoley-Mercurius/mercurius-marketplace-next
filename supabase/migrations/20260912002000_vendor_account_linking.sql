-- TRACE-067: reviewed linking of an existing Mercurius account to a provider under
-- onboarding review. This is the path TRACE-063 refuses with
-- 'Existing account requires reviewed account linking'.
--
-- Linking binds an identity and records why. It grants no role, accepts no
-- compliance evidence, activates no provider and publishes no listing: activation
-- stays with public.vendor_decide_onboarding and its evidence checklist.
--
-- Auth users are read by ID and never scanned by email. The operator states which
-- identity to bind; the database proves that identity against the reviewed
-- application snapshot before anything is written.

-- One account belongs to at most one provider. The legacy linking function tried
-- to enforce this by query and could not hold it under concurrency.
create unique index contractors_one_linked_account on public.contractors(user_id) where user_id is not null;

-- Append-only decision log. contractors.user_id remains the live link; a release
-- followed by a later link is two records, so the table is never rewritten.
create table public.vendor_account_link_decisions (
  business_key text primary key check(length(btrim(business_key))>0),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  application_version_id uuid not null references public.vendor_application_versions(id),
  action text not null check(action in ('link','release')),
  auth_user_id uuid not null references auth.users(id),
  recipient_email text not null check(length(btrim(recipient_email))>0),
  onboarding_revision integer not null,
  actor uuid not null references auth.users(id),
  reason text not null check(length(btrim(reason))>0),
  created_at timestamptz not null default now()
);
create index vendor_account_link_decisions_contractor on public.vendor_account_link_decisions(contractor_id,created_at desc);
alter table public.vendor_account_link_decisions enable row level security;
revoke all on public.vendor_account_link_decisions from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_account_link_decisions
 for each row execute function public.money_immutable();

-- Only the creating command is stored, so only its exact identity replays. Volatile
-- so the re-check under the onboarding lock reads a fresh snapshot.
create function private.vendor_account_link_replay(p_key text,p_contractor uuid,p_action text,p_auth_user uuid,p_reason text,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare prior public.vendor_account_link_decisions;
begin
 select * into prior from public.vendor_account_link_decisions where business_key=p_key;
 if not found then return null; end if;
 if prior.contractor_id<>p_contractor or prior.action<>p_action or prior.actor<>p_actor
   or prior.reason is distinct from btrim(p_reason)
   or (p_auth_user is not null and prior.auth_user_id<>p_auth_user) then
   raise exception 'Account linking idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'auth_user_id',prior.auth_user_id,
   'action',prior.action,'onboarding_revision',prior.onboarding_revision,'recorded',false);
end $$;

-- The reviewed application snapshot bound to onboarding. Returns the recipient
-- address a link must match, and raises the same freshness errors the invitation
-- commands raise rather than binding an identity to a superseded review.
create function private.vendor_account_link_recipient(p_contractor uuid)
returns text language plpgsql set search_path='' as $$
declare o public.vendor_onboarding; v public.vendor_application_versions; recipient text;
begin
 select * into strict o from public.vendor_onboarding where contractor_id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 if exists(select 1 from public.vendor_application_versions newer
     where newer.application_id=v.application_id and newer.revision>v.revision)
   or not exists(select 1 from public.vendor_applications app where app.id=v.application_id
     and app.contractor_id=p_contractor and app.status not in ('rejected','abandoned')) then
   raise exception 'Current application version required';
 end if;
 recipient:=lower(btrim(v.application->>'email'));
 if recipient is null or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   raise exception 'Application recipient required';
 end if;
 return recipient;
end $$;

create function public.vendor_link_existing_account(p_contractor uuid,p_expected_revision integer,p_auth_user uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; c public.contractors;
 target auth.users; recipient text; next_revision integer;
begin
 actor:=public.vendor_require_operator();
 -- Exact replays resolve before validation: a retry after a later application edit
 -- returns the original result rather than a freshness error.
 replay:=private.vendor_account_link_replay(p_key,p_contractor,'link',p_auth_user,p_reason,actor);
 if replay is not null then return replay; end if;
 select * into o from public.vendor_onboarding where contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 replay:=private.vendor_account_link_replay(p_key,p_contractor,'link',p_auth_user,p_reason,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_reason,'')))=0 or length(btrim(coalesce(p_key,'')))=0 then
   raise exception 'Reason and idempotency key required';
 end if;
 if p_auth_user is null then raise exception 'Exact account identity required'; end if;
 if o.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
 -- Linking is a vetting step. An active provider is already bound; a suspended or
 -- rejected one is not being onboarded.
 if o.status<>'review' then raise exception 'Account linking requires onboarding review'; end if;

 recipient:=private.vendor_account_link_recipient(p_contractor);

 -- Read by ID. Scanning an email directory would let a typo bind the wrong person.
 select * into target from auth.users where id=p_auth_user;
 if not found then raise exception 'Account identity not found'; end if;
 if target.email_confirmed_at is null then raise exception 'Confirmed account required'; end if;
 if lower(btrim(target.email)) is distinct from recipient then
   raise exception 'Account identity does not match the reviewed application recipient';
 end if;

 select * into strict c from public.contractors where id=p_contractor for update;
 if c.user_id is not null then
   -- Either an inherited link that no reviewed decision created, or a different
   -- identity. Both belong to the compliance cutover path, not to this command.
   raise exception 'Existing account link requires the compliance cutover path';
 end if;
 if exists(select 1 from public.contractors where user_id=p_auth_user and id<>p_contractor) then
   raise exception 'Account already linked to another provider';
 end if;
 -- The invitation path creates a new account for this provider; the two are
 -- mutually exclusive while an attempt is live.
 if exists(select 1 from public.vendor_invitation_attempts
   where contractor_id=p_contractor and status in ('prepared','submitted','unknown','delivered')) then
   raise exception 'Close the live invitation before linking an existing account';
 end if;

 next_revision:=o.revision+1;
 begin
   update public.contractors set user_id=p_auth_user,updated_at=now() where id=p_contractor;
 exception when unique_violation then
   -- Two providers locked separately can both read the identity as free. The
   -- partial unique index is what actually decides; report its outcome plainly.
   raise exception 'Account already linked to another provider';
 end;
 update public.vendor_onboarding set revision=next_revision where contractor_id=p_contractor;
 insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
   values(p_contractor,next_revision,'account_linked',o.status,o.status,actor,btrim(p_reason),'account-link:'||p_key);
 begin
   insert into public.vendor_account_link_decisions(business_key,contractor_id,application_version_id,action,
     auth_user_id,recipient_email,onboarding_revision,actor,reason)
     values(p_key,p_contractor,o.application_version_id,'link',p_auth_user,recipient,next_revision,actor,btrim(p_reason));
 exception when unique_violation then
   -- The same key concurrently recorded a decision for a different provider.
   raise exception 'Account linking idempotency conflict';
 end;
 -- No role grant, evidence, activation or public listing follows from this.
 return jsonb_build_object('contractor_id',p_contractor,'auth_user_id',p_auth_user,
   'action','link','onboarding_revision',next_revision,'recorded',true);
end $$;

create function public.vendor_release_linked_account(p_contractor uuid,p_expected_revision integer,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; c public.contractors;
 live public.vendor_account_link_decisions; next_revision integer;
begin
 actor:=public.vendor_require_operator();
 replay:=private.vendor_account_link_replay(p_key,p_contractor,'release',null,p_reason,actor);
 if replay is not null then return replay; end if;
 select * into o from public.vendor_onboarding where contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 replay:=private.vendor_account_link_replay(p_key,p_contractor,'release',null,p_reason,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_reason,'')))=0 or length(btrim(coalesce(p_key,'')))=0 then
   raise exception 'Reason and idempotency key required';
 end if;
 if o.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
 -- An active provider is holding assigned work. Suspend it first, so releasing an
 -- account is never the thing that quietly takes a live provider offline.
 if o.status not in ('review','suspended') then
   raise exception 'Suspend the provider before releasing its account';
 end if;

 select * into strict c from public.contractors where id=p_contractor for update;
 if c.user_id is null then raise exception 'No account is linked'; end if;
 -- Only a link this command created may be released. An inherited link is cutover
 -- evidence, and this command will not erase it.
 select * into live from public.vendor_account_link_decisions
  where contractor_id=p_contractor order by created_at desc,business_key desc limit 1;
 if live.action is distinct from 'link' or live.auth_user_id is distinct from c.user_id then
   raise exception 'Existing account link requires the compliance cutover path';
 end if;

 next_revision:=o.revision+1;
 update public.contractors set user_id=null,updated_at=now() where id=p_contractor;
 update public.vendor_onboarding set revision=next_revision where contractor_id=p_contractor;
 insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
   values(p_contractor,next_revision,'account_released',o.status,o.status,actor,btrim(p_reason),'account-release:'||p_key);
 begin
   insert into public.vendor_account_link_decisions(business_key,contractor_id,application_version_id,action,
     auth_user_id,recipient_email,onboarding_revision,actor,reason)
     values(p_key,p_contractor,o.application_version_id,'release',live.auth_user_id,live.recipient_email,next_revision,actor,btrim(p_reason));
 exception when unique_violation then
   raise exception 'Account linking idempotency conflict';
 end;
 -- Releasing removes the binding only. Any role this account holds elsewhere is
 -- unchanged, and no compliance evidence or decision is withdrawn.
 return jsonb_build_object('contractor_id',p_contractor,'auth_user_id',live.auth_user_id,
   'action','release','onboarding_revision',next_revision,'recorded',true);
end $$;

-- Operator readback for the account panel. Facts only: every permission decision
-- stays inside the commands above, so this cannot become a second, weaker copy of
-- their predicates. It writes nothing.
create function public.vendor_account_link_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o public.vendor_onboarding; c public.contractors; v public.vendor_application_versions;
 live public.vendor_account_link_decisions; recipient text;
begin
 perform public.vendor_require_operator();
 select * into o from public.vendor_onboarding where contractor_id=p_contractor;
 if not found then raise exception 'Onboarding record not found'; end if;
 select * into strict c from public.contractors where id=p_contractor;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 recipient:=lower(btrim(v.application->>'email'));
 select * into live from public.vendor_account_link_decisions
  where contractor_id=p_contractor order by created_at desc,business_key desc limit 1;
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
  -- The address of the bound identity, so the operator can see what was bound
  -- without this function ever searching the directory for one.
  'linked_email',(select lower(btrim(u.email)) from auth.users u where u.id=c.user_id),
  -- A link no reviewed decision created is inherited: the cutover path owns it.
  'link_reviewed',coalesce(c.user_id is not null and live.action='link' and live.auth_user_id=c.user_id,false),
  'invitation_live',exists(select 1 from public.vendor_invitation_attempts
    where contractor_id=p_contractor and status in ('prepared','submitted','unknown','delivered')),
  'decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'action',d.action,'auth_user_id',d.auth_user_id,'recipient_email',d.recipient_email,
      'onboarding_revision',d.onboarding_revision,'reason',d.reason,'created_at',d.created_at)
      order by d.created_at desc),'[]'::jsonb)
    from public.vendor_account_link_decisions d where d.contractor_id=p_contractor));
end $$;

-- Legacy linking granted the vendor role from an email-directory scan, with no
-- onboarding review, evidence, reason or record. Both entry points fail closed and
-- lose their grant; the reviewed commands above replace them.
create or replace function public.admin_link_contractor_to_user(_contractor_id uuid,_email text)
returns table(user_id uuid,email text) language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Reviewed account linking required';
end $$;
create or replace function public.admin_unlink_contractor(_contractor_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Reviewed account release required';
end $$;

revoke all on function public.admin_link_contractor_to_user(uuid,text),public.admin_unlink_contractor(uuid),
 private.vendor_account_link_replay(text,uuid,text,uuid,text,uuid),private.vendor_account_link_recipient(uuid),
 public.vendor_link_existing_account(uuid,integer,uuid,text,text),
 public.vendor_release_linked_account(uuid,integer,text,text),
 public.vendor_account_link_overview(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_link_existing_account(uuid,integer,uuid,text,text),
 public.vendor_release_linked_account(uuid,integer,text,text),
 public.vendor_account_link_overview(uuid) to authenticated;
