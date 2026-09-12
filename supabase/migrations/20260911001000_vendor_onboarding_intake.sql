-- TRACE-065: start onboarding review for a new applicant. Creation-only.
-- Creates a hidden, account-less contractor anchor and review revision 1. No Auth user,
-- role grant, email, invitation, evidence, activation, public listing or legacy status change.
create table public.vendor_onboarding_review_starts (
  business_key text primary key check(length(btrim(business_key))>0),
  application_id uuid not null unique references public.vendor_applications(id),
  expected_version_id uuid not null references public.vendor_application_versions(id),
  contractor_id uuid not null unique references public.vendor_onboarding(contractor_id),
  actor uuid not null references auth.users(id),
  reason text not null check(length(btrim(reason))>0),
  created_at timestamptz not null default now()
);
alter table public.vendor_onboarding_review_starts enable row level security;
revoke all on public.vendor_onboarding_review_starts from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_onboarding_review_starts
 for each row execute function public.money_immutable();

-- Only the creating command is stored, so only its exact identity replays.
-- Volatile so the re-check under the application lock reads a fresh snapshot.
create function private.vendor_review_start_replay(p_key text,p_application uuid,p_expected_version uuid,p_reason text,p_actor uuid)
returns jsonb language plpgsql set search_path='' as $$
declare prior public.vendor_onboarding_review_starts;
begin
 select * into prior from public.vendor_onboarding_review_starts where business_key=p_key;
 if not found then return null; end if;
 if prior.application_id<>p_application or prior.expected_version_id is distinct from p_expected_version
   or prior.actor<>p_actor or prior.reason is distinct from btrim(p_reason) then
   raise exception 'Onboarding review idempotency conflict';
 end if;
 return jsonb_build_object('contractor_id',prior.contractor_id,'onboarding_status','review','onboarding_revision',1,'created',true);
end $$;

create function public.vendor_start_onboarding_review(p_application uuid,p_expected_version uuid,p_reason text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; app public.vendor_applications; started public.vendor_onboarding_review_starts;
 o public.vendor_onboarding; contractor uuid;
begin
 actor:=public.vendor_require_operator();
 -- Exact replays resolve before validation: a retry after a later application edit
 -- returns the original result rather than a freshness error.
 replay:=private.vendor_review_start_replay(p_key,p_application,p_expected_version,p_reason,actor);
 if replay is not null then return replay; end if;
 select * into app from public.vendor_applications where id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 replay:=private.vendor_review_start_replay(p_key,p_application,p_expected_version,p_reason,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_reason,'')))=0 or length(btrim(coalesce(p_key,'')))=0 then
   raise exception 'Reason and idempotency key required';
 end if;
 if app.status in ('rejected','abandoned') then raise exception 'Closed application cannot start onboarding'; end if;
 if p_expected_version is null or not exists(select 1 from public.vendor_application_versions v
   where v.id=p_expected_version and v.application_id=app.id
     and not exists(select 1 from public.vendor_application_versions newer where newer.application_id=app.id and newer.revision>v.revision)) then
   raise exception 'Latest application version required';
 end if;

 -- Existing state is reported or rejected, never mutated.
 select * into started from public.vendor_onboarding_review_starts where application_id=app.id;
 if found then
   select * into o from public.vendor_onboarding where contractor_id=started.contractor_id;
   if app.contractor_id is distinct from started.contractor_id or o.status<>'review' or o.application_version_id<>p_expected_version then
     raise exception 'Onboarding already exists';
   end if;
   return jsonb_build_object('contractor_id',o.contractor_id,'onboarding_status',o.status,'onboarding_revision',o.revision,'created',false);
 end if;
 if app.contractor_id is not null then
   -- Legacy or cut-over providers keep their explicit TRACE-060/061 path.
   raise exception 'Existing provider requires the cutover review path';
 end if;

 insert into public.contractors(name,is_active,marketing_enabled,user_id)
   values(btrim(app.business_name),false,false,null) returning id into contractor;
 update public.vendor_applications set contractor_id=contractor where id=app.id;
 insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
   values(contractor,p_expected_version,1,'review');
 insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key)
   values(contractor,1,'review_started','review','review',actor,btrim(p_reason),'review-start:'||p_key);
 begin
   insert into public.vendor_onboarding_review_starts(business_key,application_id,expected_version_id,contractor_id,actor,reason)
     values(p_key,app.id,p_expected_version,contractor,actor,btrim(p_reason));
 exception when unique_violation then
   -- The same key concurrently created a review for a different application.
   raise exception 'Onboarding review idempotency conflict';
 end;
 return jsonb_build_object('contractor_id',contractor,'onboarding_status','review','onboarding_revision',1,'created',true);
end $$;

-- Operator readback for the Applications queue; supplies the expected version.
create function public.vendor_onboarding_intake_status(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare app public.vendor_applications; latest public.vendor_application_versions; o public.vendor_onboarding;
begin
 perform public.vendor_require_operator();
 select * into app from public.vendor_applications where id=p_application;
 if not found then raise exception 'Application not found'; end if;
 select * into latest from public.vendor_application_versions where application_id=app.id order by revision desc limit 1;
 select * into o from public.vendor_onboarding where contractor_id=app.contractor_id;
 return jsonb_build_object('application_id',app.id,'application_status',app.status,
   'latest_version_id',latest.id,'latest_revision',latest.revision,'contractor_id',app.contractor_id,
   'onboarding_status',o.status,'onboarding_revision',o.revision,'onboarding_version_id',o.application_version_id,
   'review_started',exists(select 1 from public.vendor_onboarding_review_starts where application_id=app.id));
end $$;

revoke all on function private.vendor_review_start_replay(text,uuid,uuid,text,uuid),
 public.vendor_start_onboarding_review(uuid,uuid,text,text),public.vendor_onboarding_intake_status(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_start_onboarding_review(uuid,uuid,text,text),
 public.vendor_onboarding_intake_status(uuid) to authenticated;
