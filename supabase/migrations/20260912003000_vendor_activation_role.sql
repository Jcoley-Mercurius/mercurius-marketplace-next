-- TRACE-068: the vendor role follows from reviewed activation, and only to an
-- account a reviewed decision bound. TRACE-067 removed the last legacy grant, so
-- before this migration no reviewed path gave a provider portal access at all.
--
-- Owner decisions (2026-09-12):
--  * A provider with no account bound through a reviewed link still activates;
--    no role is granted and the outcome is recorded. Binding an accepted
--    invitation to the provider is a separate slice.
--  * Suspension keeps the role. Matching and offer acceptance are already closed
--    by eligibility; the portal stays reachable for assigned work and payout status.
--
-- The role is withdrawn only when the reviewed binding itself is released, and only
-- if activation is what granted it. A role the account already held is never taken.

-- Forward fix to TRACE-067. The live link was chosen by (created_at, business_key),
-- but created_at is the transaction start time: a release and a relink in one
-- transaction tie and fall back to key order, and a command that waited on the
-- onboarding lock can carry an earlier timestamp than the one it waited behind.
-- Role ownership depends on that choice, so order by write sequence instead. Every
-- write happens under the onboarding row lock, so sequence order is decision order
-- per provider. Adding the column rewrites no stored decision.
alter table public.vendor_account_link_decisions add column sequence bigint generated always as identity;
alter table public.vendor_account_link_decisions add constraint vendor_account_link_decisions_sequence unique(sequence);
create index vendor_account_link_decisions_live on public.vendor_account_link_decisions(contractor_id,sequence desc);

-- Append-only record of every role outcome. Ordered by id, not time: an activation
-- and a release can share one transaction timestamp.
create table public.vendor_role_decisions (
  id bigint generated always as identity primary key,
  business_key text not null unique check(length(btrim(business_key))>0),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  onboarding_revision integer not null,
  action text not null check(action in ('grant','revoke')),
  outcome text not null check(outcome in ('granted','already_held','no_account','inherited_link','revoked','already_absent')),
  auth_user_id uuid references auth.users(id),
  link_decision_key text references public.vendor_account_link_decisions(business_key),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check((action='grant')=(outcome in ('granted','already_held','no_account','inherited_link'))),
  check((outcome='no_account')=(auth_user_id is null)),
  check((outcome in ('no_account','inherited_link'))=(link_decision_key is null))
);
create index vendor_role_decisions_contractor on public.vendor_role_decisions(contractor_id,id desc);
alter table public.vendor_role_decisions enable row level security;
revoke all on public.vendor_role_decisions from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_role_decisions
 for each row execute function public.money_immutable();

-- The live reviewed link for a provider, or null when the current binding is
-- absent or inherited. Same predicate as the overview's link_reviewed.
create function private.vendor_reviewed_link(p_contractor uuid)
returns public.vendor_account_link_decisions language plpgsql stable set search_path='' as $$
declare c public.contractors; live public.vendor_account_link_decisions;
begin
 select * into strict c from public.contractors where id=p_contractor;
 select * into live from public.vendor_account_link_decisions
  where contractor_id=p_contractor order by sequence desc limit 1;
 if c.user_id is null or live.action is distinct from 'link' or live.auth_user_id is distinct from c.user_id then
   return null;
 end if;
 return live;
end $$;

-- Whether activation granted this account its vendor role for this provider and
-- nothing has withdrawn it since. 'already_held' rows never confer ownership.
create function private.vendor_activation_role_owned(p_contractor uuid,p_auth_user uuid)
returns boolean language sql stable set search_path='' as $$
 select coalesce((select d.outcome='granted' from public.vendor_role_decisions d
   where d.contractor_id=p_contractor and d.auth_user_id=p_auth_user and d.outcome in ('granted','revoked','already_absent')
   order by d.id desc limit 1),false)
$$;

-- Called with the onboarding row locked, after the transition is validated.
create function private.vendor_grant_activation_role(p_contractor uuid,p_revision integer,p_key text,p_actor uuid)
returns text language plpgsql set search_path='' as $$
declare c public.contractors; live public.vendor_account_link_decisions; target auth.users;
 recipient text; inserted integer; result text;
begin
 select * into strict c from public.contractors where id=p_contractor for update;
 live:=private.vendor_reviewed_link(p_contractor);
 if c.user_id is null then
   result:='no_account';
 elsif live.business_key is null then
   -- An inherited link is cutover evidence, not a reviewed identity. It is not
   -- promoted to provider access here.
   result:='inherited_link';
 else
   -- The binding was proven at link time; prove it again against what is being
   -- activated, since the application or the account may have changed since.
   recipient:=private.vendor_account_link_recipient(p_contractor);
   select * into target from auth.users where id=c.user_id;
   if not found or target.email_confirmed_at is null or lower(btrim(target.email)) is distinct from recipient then
     raise exception 'Bound account no longer matches the reviewed application recipient';
   end if;
   insert into public.user_roles(user_id,role) values(c.user_id,'vendor') on conflict(user_id,role) do nothing;
   get diagnostics inserted=row_count;
   result:=case when inserted=1 then 'granted' else 'already_held' end;
 end if;
 insert into public.vendor_role_decisions(business_key,contractor_id,onboarding_revision,action,outcome,auth_user_id,link_decision_key,actor)
   values('role-grant:'||p_key,p_contractor,p_revision,'grant',result,c.user_id,
     case when result in ('granted','already_held') then live.business_key end,p_actor);
 return result;
end $$;

-- Unchanged from 20260905002000 except for the activation grant.
create or replace function public.vendor_decide_onboarding(p_contractor uuid,p_expected_revision integer,p_action text,p_reason text,p_key text)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid; v public.vendor_onboarding; prior public.vendor_onboarding_events; next_status text; ids uuid[];
begin
  actor:=public.vendor_require_operator();
  select * into strict v from public.vendor_onboarding where contractor_id=p_contractor for update;
  select * into prior from public.vendor_onboarding_events where business_key=p_key;
  if found then
    if prior.contractor_id<>p_contractor or prior.actor<>actor or prior.reason<>p_reason or prior.action<>p_action then raise exception 'Onboarding idempotency conflict'; end if;
    return prior.revision;
  end if;
  if v.revision<>p_expected_revision then raise exception 'Stale onboarding revision'; end if;
  if p_action='activate' and v.status in ('review','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Activation checklist incomplete or expired'; end if;
    next_status:='active';
  elsif p_action='suspend' and v.status='active' then next_status:='suspended';
  elsif p_action='reject' and v.status='review' then next_status:='rejected';
  elsif p_action='renew' and v.status in ('active','suspended') then
    if not public.vendor_evidence_current(p_contractor,now()) then raise exception 'Renewal checklist incomplete or expired'; end if;
    next_status:=v.status; -- Renewal does not silently lift an operator suspension.
  else raise exception 'Invalid onboarding transition'; end if;
  select coalesce(array_agg(e.id order by e.kind),'{}') into ids from public.vendor_compliance_evidence e where e.contractor_id=p_contractor
    and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
  insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,evidence_ids)
    values(p_contractor,v.revision+1,p_action,v.status,next_status,actor,p_reason,p_key,ids);
  update public.vendor_onboarding set status=next_status,revision=revision+1 where contractor_id=p_contractor;
  -- Activation is where the MPS §8 checklist is enforced, so it is the only place
  -- the vendor role is granted. Suspension, renewal and rejection leave roles alone.
  if p_action='activate' then
    perform private.vendor_grant_activation_role(p_contractor,v.revision+1,p_key,actor);
  end if;
  return v.revision+1;
end $$;

-- Unchanged from 20260912002000 except for sequence ordering and that releasing the
-- binding withdraws a vendor role activation granted to it.
create or replace function public.vendor_release_linked_account(p_contractor uuid,p_expected_revision integer,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; c public.contractors;
 live public.vendor_account_link_decisions; next_revision integer; removed integer;
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
  where contractor_id=p_contractor order by sequence desc limit 1;
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
 -- A role activation granted to this binding ends with it. A role the account held
 -- before activation is not this command's to take, and no evidence is withdrawn.
 if private.vendor_activation_role_owned(p_contractor,live.auth_user_id) then
   delete from public.user_roles where user_id=live.auth_user_id and role='vendor';
   get diagnostics removed=row_count;
   insert into public.vendor_role_decisions(business_key,contractor_id,onboarding_revision,action,outcome,auth_user_id,link_decision_key,actor)
     values('role-revoke:'||p_key,p_contractor,next_revision,'revoke',
       case when removed=1 then 'revoked' else 'already_absent' end,live.auth_user_id,p_key,actor);
 end if;
 return jsonb_build_object('contractor_id',p_contractor,'auth_user_id',live.auth_user_id,
   'action','release','onboarding_revision',next_revision,'recorded',true);
end $$;

-- Unchanged from 20260912002000 except for sequence ordering and the role facts.
-- Still facts only.
create or replace function public.vendor_account_link_overview(p_contractor uuid)
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
  where contractor_id=p_contractor order by sequence desc limit 1;
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
  -- Whether the bound account holds the vendor role, and whether activation is
  -- what granted it. A release withdraws only the latter.
  'vendor_role_held',c.user_id is not null and exists(select 1 from public.user_roles r
    where r.user_id=c.user_id and r.role='vendor'),
  'vendor_role_from_activation',c.user_id is not null
    and private.vendor_activation_role_owned(p_contractor,c.user_id),
  'decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'action',d.action,'auth_user_id',d.auth_user_id,'recipient_email',d.recipient_email,
      'onboarding_revision',d.onboarding_revision,'reason',d.reason,'created_at',d.created_at)
      order by d.sequence desc),'[]'::jsonb)
    from public.vendor_account_link_decisions d where d.contractor_id=p_contractor),
  'role_decisions',(select coalesce(jsonb_agg(jsonb_build_object(
      'action',d.action,'outcome',d.outcome,'auth_user_id',d.auth_user_id,
      'onboarding_revision',d.onboarding_revision,'created_at',d.created_at)
      order by d.id desc),'[]'::jsonb)
    from public.vendor_role_decisions d where d.contractor_id=p_contractor));
end $$;

revoke all on function private.vendor_reviewed_link(uuid),private.vendor_activation_role_owned(uuid,uuid),
 private.vendor_grant_activation_role(uuid,integer,text,uuid),
 public.vendor_decide_onboarding(uuid,integer,text,text,text),
 public.vendor_release_linked_account(uuid,integer,text,text),
 public.vendor_account_link_overview(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_decide_onboarding(uuid,integer,text,text,text),
 public.vendor_release_linked_account(uuid,integer,text,text),
 public.vendor_account_link_overview(uuid) to authenticated;
