-- TRACE-117 (DEC-2026-043): bind the account that accepted a provider invitation in
-- the same transaction as the acceptance, instead of waiting for an operator to run
-- public.vendor_bind_invited_account.
--
-- The automatic binding proves exactly what the reviewed command proves: the
-- provider is under review, the acceptance receipt answers the current application
-- version, the Auth dispatch and the receipt name the same confirmed account, that
-- account's address is the reviewed application recipient, the provider has no
-- account, the account belongs to no other provider and no other invitation is live.
-- When any of those does not hold the acceptance still succeeds and binds nothing;
-- the operator command remains the fallback and reports the specific reason.
--
-- The decision is recorded in the TRACE-067 log as a 'link' naming the receipt it
-- relied on, with the recipient as actor, so the reviewed-link predicate, activation
-- role grant, release command and checklist treat it like any other binding.
--
-- Application-based invitations only. Existing-provider access (DEC-2026-024) grants
-- the vendor role at binding and keeps its operator-reviewed binding.
--
-- Binding grants no role, accepts no compliance evidence, activates no provider and
-- publishes no listing.

create function private.vendor_auto_bind_invited_account(p_attempt uuid,p_recipient uuid)
returns boolean language plpgsql set search_path='' as $$
declare o public.vendor_onboarding; a public.vendor_invitation_attempts;
 receipt public.vendor_invitation_acceptances; d public.vendor_invitation_dispatches;
 c public.contractors; target auth.users; recipient text; next_revision integer;
 reason constant text:='Bound automatically when the verified recipient accepted the invitation (DEC-2026-043)';
begin
 -- The caller holds the onboarding and attempt locks.
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt;
 select * into strict o from public.vendor_onboarding where contractor_id=a.contractor_id;
 if o.status<>'review' then return false; end if;
 begin
   recipient:=private.vendor_account_link_recipient(a.contractor_id);
 exception when raise_exception then
   return false;
 end;

 select * into receipt from public.vendor_invitation_acceptances where attempt_id=p_attempt;
 if not found or receipt.auth_user_id<>p_recipient
   or receipt.application_version_id<>o.application_version_id then return false; end if;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt;
 if d.auth_user_id is distinct from receipt.auth_user_id or d.recipient_email is distinct from recipient then
   return false;
 end if;
 select * into target from auth.users where id=receipt.auth_user_id;
 if not found or target.email_confirmed_at is null or lower(btrim(target.email)) is distinct from recipient then
   return false;
 end if;

 select * into strict c from public.contractors where id=a.contractor_id for update;
 if c.user_id is not null then return false; end if;
 if exists(select 1 from public.contractors where user_id=receipt.auth_user_id and id<>a.contractor_id) then
   return false;
 end if;
 if exists(select 1 from public.vendor_invitation_attempts
   where contractor_id=a.contractor_id and id<>p_attempt and status in ('prepared','submitted','unknown','delivered')) then
   return false;
 end if;

 next_revision:=o.revision+1;
 begin
   update public.contractors set user_id=receipt.auth_user_id,updated_at=now() where id=a.contractor_id;
 exception when unique_violation then
   -- Another provider took the identity concurrently; the operator path reports it.
   return false;
 end;
 update public.vendor_onboarding set revision=next_revision where contractor_id=a.contractor_id;
 insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
   values(a.contractor_id,next_revision,'invited_account_bound',o.status,o.status,p_recipient,reason,'invitation-bind:auto:'||p_attempt);
 insert into public.vendor_account_link_decisions(business_key,contractor_id,application_version_id,action,
   auth_user_id,recipient_email,onboarding_revision,actor,reason,invitation_attempt_id)
   values('auto:'||p_attempt,a.contractor_id,o.application_version_id,'link',receipt.auth_user_id,recipient,
     next_revision,p_recipient,reason,p_attempt);
 return true;
end $$;
revoke all on function private.vendor_auto_bind_invited_account(uuid,uuid) from public,anon,authenticated,service_role;

-- Unchanged from 20260909001000 except the automatic binding after the receipt.
create or replace function public.vendor_accept_invitation(p_attempt uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches;
 o public.vendor_onboarding; v public.vendor_application_versions;
begin
 if actor is null then raise exception 'Authenticated recipient required' using errcode='42501'; end if;
 select onboarding.* into strict o from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt;
 if d.auth_user_id is distinct from actor or not exists(select 1 from auth.users u where u.id=actor
     and u.email_confirmed_at is not null and lower(btrim(u.email))=d.recipient_email) then
   raise exception 'Verified invitation recipient required' using errcode='42501';
 end if;
 if exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id and auth_user_id=actor) then return; end if;
 select * into strict v from public.vendor_application_versions where id=a.application_version_id;
 if exists(select 1 from public.contractors where id=a.contractor_id and user_id is not null and user_id<>actor) then raise exception 'Invitation identity conflict'; end if;
 if d.state<>'provider_accepted' or a.status<>'submitted' or a.expires_at<=now()
   or o.status in ('suspended','rejected') or o.application_version_id<>a.application_version_id
   or exists(select 1 from public.vendor_application_versions newer where newer.application_id=v.application_id and newer.revision>v.revision)
   or not exists(select 1 from public.vendor_applications app where app.id=v.application_id
     and app.contractor_id=a.contractor_id and app.status not in ('rejected','abandoned')) then
   raise exception 'Current invitation and application required';
 end if;
 insert into public.vendor_invitation_acceptances(attempt_id,application_version_id,auth_user_id)
   values(a.id,a.application_version_id,actor);
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,a.status,'accepted','Verified recipient explicitly accepted invitation',actor);
 update public.vendor_invitation_attempts set status='accepted' where id=a.id;
 -- DEC-2026-043: bind the accepted account when every reviewed-binding condition
 -- holds. No role grant, compliance approval or activation follows from this.
 perform private.vendor_auto_bind_invited_account(a.id,actor);
end $$;
