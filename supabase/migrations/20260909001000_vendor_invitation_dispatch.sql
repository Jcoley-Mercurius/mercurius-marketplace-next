-- TRACE-063: durable Auth dispatch and recipient-owned acceptance receipts.
-- Provider acceptance of a send is not proof of mailbox delivery or activation.
create table public.vendor_invitation_dispatches (
  attempt_id uuid primary key references public.vendor_invitation_attempts(id),
  recipient_email text not null check(length(btrim(recipient_email))>0),
  started_at timestamptz not null default now(),
  started_by uuid not null references auth.users(id),
  state text not null default 'started' check(state in ('started','unknown','provider_accepted')),
  auth_user_id uuid references auth.users(id),
  resolved_at timestamptz,
  check ((state='provider_accepted')=(auth_user_id is not null))
);
create table public.vendor_invitation_acceptances (
  attempt_id uuid primary key references public.vendor_invitation_dispatches(attempt_id),
  application_version_id uuid not null references public.vendor_application_versions(id),
  auth_user_id uuid not null references auth.users(id),
  accepted_at timestamptz not null default now()
);
alter table public.vendor_invitation_dispatches enable row level security;
alter table public.vendor_invitation_acceptances enable row level security;
revoke all on public.vendor_invitation_dispatches,public.vendor_invitation_acceptances from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_invitation_acceptances
 for each row execute function public.money_immutable();

create function public.vendor_claim_invitation(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts; o public.vendor_onboarding;
 v public.vendor_application_versions; recipient text;
begin
 actor:=public.vendor_require_operator();
 -- Lock the onboarding aggregate before its attempt, matching all delivery operations.
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
 insert into public.vendor_invitation_dispatches(attempt_id,recipient_email,started_by) values(a.id,recipient,actor);
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,'prepared','submitted','Auth dispatch reserved; delivery not yet confirmed',actor);
 update public.vendor_invitation_attempts set status='submitted' where id=a.id;
 return jsonb_build_object('claimed',true,'recipient_email',recipient,'expires_at',a.expires_at);
end $$;

-- Service-only receipt writer. Auth users are read by ID; never scan an email directory.
create function public.vendor_finish_invitation(p_attempt uuid,p_auth_user uuid default null,p_actor uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches; target auth.users;
begin
 perform 1 from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 select * into strict d from public.vendor_invitation_dispatches where attempt_id=p_attempt for update;
 if p_actor is not null and not public.has_role(p_actor,'admin') then raise exception 'Onboarding operator required' using errcode='42501'; end if;
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

create function public.vendor_accept_invitation(p_attempt uuid)
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
 -- No contractor linking, role grants, compliance approval or activation here.
end $$;

create function public.vendor_close_dispatched_invitation(p_attempt uuid,p_status text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts;
begin
 actor:=public.vendor_require_operator();
 perform 1 from public.vendor_onboarding onboarding
 join public.vendor_invitation_attempts attempt on attempt.contractor_id=onboarding.contractor_id
 where attempt.id=p_attempt for update of onboarding;
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
 if p_status is null or p_status not in ('revoked','expired') or length(btrim(coalesce(p_reason,'')))=0 then
   raise exception 'Reviewed closure and reason required';
 end if;
 if a.status not in ('submitted','revoked','expired') or not exists(select 1 from public.vendor_invitation_dispatches
   where attempt_id=a.id and state='provider_accepted') then raise exception 'Reconcile invitation before closure'; end if;
 if p_status='expired' and a.expires_at>now() then raise exception 'Invitation not expired'; end if;
 if a.status=p_status then return; end if;
 if a.status<>'submitted' then raise exception 'Invitation already closed'; end if;
 insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor)
   values(a.id,a.status,p_status,btrim(p_reason),actor);
 update public.vendor_invitation_attempts set status=p_status where id=a.id;
end $$;

-- Legacy operator assertions cannot manufacture verified delivery/acceptance evidence.
alter function public.vendor_record_invitation(uuid,text,text,text) rename to vendor_record_legacy_invitation;
revoke all on function public.vendor_record_legacy_invitation(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.vendor_record_invitation(p_attempt uuid,p_status text,p_ref text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 perform 1 from public.vendor_invitation_attempts where id=p_attempt for update;
 if exists(select 1 from public.vendor_invitation_dispatches where attempt_id=p_attempt) then
   raise exception 'Dispatched invitations require verified receipts';
 end if;
 perform public.vendor_record_legacy_invitation(p_attempt,p_status,p_ref,p_evidence);
end $$;

create function public.vendor_invitation_status(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts; d public.vendor_invitation_dispatches;
begin
 actor:=public.vendor_require_operator();
 select * into strict a from public.vendor_invitation_attempts where id=p_attempt;
 select * into d from public.vendor_invitation_dispatches where attempt_id=p_attempt;
 return jsonb_build_object('attempt_id',a.id,'status',a.status,'dispatch_state',d.state,
   'auth_user_id',d.auth_user_id,'expires_at',a.expires_at,
   'accepted',exists(select 1 from public.vendor_invitation_acceptances where attempt_id=a.id));
end $$;
revoke all on function public.vendor_claim_invitation(uuid),public.vendor_finish_invitation(uuid,uuid,uuid),
 public.vendor_close_dispatched_invitation(uuid,text,text),public.vendor_accept_invitation(uuid),public.vendor_invitation_status(uuid),public.vendor_record_invitation(uuid,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_claim_invitation(uuid),public.vendor_close_dispatched_invitation(uuid,text,text),public.vendor_accept_invitation(uuid),
 public.vendor_invitation_status(uuid),public.vendor_record_invitation(uuid,text,text,text) to authenticated;
grant execute on function public.vendor_finish_invitation(uuid,uuid,uuid) to service_role;
