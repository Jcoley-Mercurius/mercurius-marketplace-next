-- TRACE-105: bind a provider's account while it is suspended (owner decision
-- 2026-10-05, DEC-2026-028).
--
-- TRACE-068 lets an invitation-onboarded provider activate with no bound account; it
-- records 'no_account' and grants no role. TRACE-067/070 bound accounts only in review,
-- and no transition returns an active provider to review, so such a provider could
-- never be given portal access. The owner hit this with a live provider and expects
-- it again as more operators onboard.
--
-- Both binding commands now also accept a suspended provider. The repair is
-- Suspend -> bind -> Activate: activation from suspension re-checks the MPS §8
-- checklist and grants the vendor role through the unchanged TRACE-068 path, so the
-- role still follows only from a reviewed activation. An active provider is refused
-- with the instruction to suspend first, matching the release command; a rejected
-- provider is still refused.
--
-- Both functions are otherwise unchanged from 20260912002000 and 20260912005000.

create or replace function public.vendor_link_existing_account(p_contractor uuid,p_expected_revision integer,p_auth_user uuid,p_reason text,p_key text)
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
 -- Linking is a vetting step, or the repair of a provider that activated with no
 -- account: suspended, bound, then activated again. A live provider is never bound in
 -- place, and a rejected one is not being onboarded.
 if o.status='active' then raise exception 'Suspend the provider before binding an account'; end if;
 if o.status not in ('review','suspended') then raise exception 'Account linking requires onboarding review'; end if;

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

create or replace function public.vendor_bind_invited_account(p_contractor uuid,p_expected_revision integer,p_attempt uuid,p_reason text,p_key text)
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
 -- As for linking: review, or a suspended provider being repaired before reactivation.
 if o.status='active' then raise exception 'Suspend the provider before binding an account'; end if;
 if o.status not in ('review','suspended') then raise exception 'Account binding requires onboarding review'; end if;

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
