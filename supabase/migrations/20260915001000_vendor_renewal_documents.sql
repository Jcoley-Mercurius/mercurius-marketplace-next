-- TRACE-073: renewed license and insurance documents bound to the provider, not the
-- application. Before this, documents reached Mercurius only through the application
-- upload; a changed application creates a new version and returns an active provider to
-- review, so a renewed certificate could not be recorded without re-vetting.
--
-- Owner decisions (2026-09-15): the provider (vendor portal) and an operator (on the
-- provider's behalf) may submit; a decline carries a required note the provider sees;
-- a provider submission sends the existing owner notification (application code); and
-- the legacy anonymous upload policy on the private bucket is removed here.
--
-- A submission records a file only. It creates no evidence, changes no onboarding
-- status, revision, eligibility or application version, grants no role and lists
-- nothing. Acceptance happens only through vendor_record_checklist_evidence, which
-- records the evidence and the acceptance in one transaction.

-- The 2026-07-31 policy let anyone, signed in or not, insert objects under
-- applications/ in the private vendor-documents bucket. The application form uploads
-- through server-issued signed upload URLs at <application id>/..., so nothing uses it.
drop policy if exists "Applicants can upload application documents" on storage.objects;

create table public.vendor_renewal_documents (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.vendor_onboarding(contractor_id),
  kind text not null check(kind in ('license','insurance')),
  storage_path text not null unique,
  file_name text not null check(length(btrim(file_name))>0),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif')),
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
  submitted_by uuid not null references auth.users(id),
  submitted_as text not null check(submitted_as in ('provider','operator')),
  created_at timestamptz not null default now(),
  check (storage_path ~ ('^renewals/'||contractor_id::text||'/'||kind||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif)$'))
);
create index vendor_renewal_documents_contractor on public.vendor_renewal_documents(contractor_id,kind);

-- One decision per document. Accepted names the evidence it became; declined carries
-- the note shown to the provider.
create table public.vendor_renewal_document_decisions (
  document_id uuid primary key references public.vendor_renewal_documents(id),
  outcome text not null check(outcome in ('accepted','declined')),
  evidence_id uuid unique references public.vendor_compliance_evidence(id),
  note text check(note is null or length(note)<=1000),
  business_key text not null unique check(length(btrim(business_key))>0),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((outcome='accepted' and evidence_id is not null and note is null)
    or (outcome='declined' and evidence_id is null and length(btrim(coalesce(note,'')))>0))
);

alter table public.vendor_renewal_documents enable row level security;
alter table public.vendor_renewal_document_decisions enable row level security;
revoke all on public.vendor_renewal_documents, public.vendor_renewal_document_decisions
  from public,anon,authenticated,service_role;
create trigger immutable_evidence before update or delete on public.vendor_renewal_documents
  for each row execute function public.money_immutable();
create trigger immutable_evidence before update or delete on public.vendor_renewal_document_decisions
  for each row execute function public.money_immutable();

-- Undecided submissions a provider may hold per item, so an account cannot fill the
-- private bucket's review queue. The single definition.
create function private.vendor_renewal_open_limit() returns integer language sql immutable set search_path='' as $$ select 5 $$;

-- Resolves who is submitting for which provider. An operator names the provider; a
-- vendor submits only for the provider linked to its own account. Either way the
-- provider must be active or suspended: applicants under review use the application.
create function private.vendor_renewal_submitter(p_contractor uuid)
returns table(contractor_id uuid,actor uuid,submitted_as text)
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=auth.uid(); resolved uuid; role_value text; status_value text;
begin
 if caller is null then raise exception 'Renewal document submitter required' using errcode='42501'; end if;
 if p_contractor is not null then
   if not public.has_role(caller,'admin') then raise exception 'Onboarding operator required' using errcode='42501'; end if;
   resolved:=p_contractor; role_value:='operator';
 else
   if not public.has_role(caller,'vendor') then raise exception 'Vendor account required' using errcode='42501'; end if;
   select c.id into resolved from public.contractors c where c.user_id=caller;
   if resolved is null then raise exception 'Linked provider required' using errcode='42501'; end if;
   role_value:='provider';
 end if;
 select o.status into status_value from public.vendor_onboarding o where o.contractor_id=resolved;
 if status_value is null or status_value not in ('active','suspended') then
   raise exception 'Renewal documents are accepted only for active or suspended providers';
 end if;
 return query select resolved,caller,role_value;
end $$;

-- Pre-check for the upload route before it issues a signed upload URL. Writes nothing.
create function public.vendor_authorize_renewal_upload(p_kind text,p_contractor uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record;
begin
 select * into strict s from private.vendor_renewal_submitter(p_contractor);
 if p_kind is null or p_kind not in ('license','insurance') then raise exception 'Renewal documents are for license or insurance only'; end if;
 if (select count(*) from public.vendor_renewal_documents d where d.contractor_id=s.contractor_id and d.kind=p_kind
     and not exists(select 1 from public.vendor_renewal_document_decisions x where x.document_id=d.id))>=private.vendor_renewal_open_limit() then
   raise exception 'Too many renewal documents are awaiting review';
 end if;
 return jsonb_build_object('contractor_id',s.contractor_id,'kind',p_kind,'submitted_as',s.submitted_as);
end $$;

-- Records an uploaded object as a submission. The object's existence, size and type
-- are read from storage, not from the caller. The path is the idempotency key: the same
-- submitter replays, anyone else is refused.
create function public.vendor_submit_renewal_document(p_path text,p_contractor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record; prior public.vendor_renewal_documents; parts text[]; object_metadata jsonb; size_value bigint; mime_value text; result uuid;
begin
 select * into strict s from private.vendor_renewal_submitter(p_contractor);
 -- Serialises submissions per provider so the open limit is exact.
 perform 1 from public.vendor_onboarding o where o.contractor_id=s.contractor_id for update;
 select * into prior from public.vendor_renewal_documents d where d.storage_path=p_path;
 if found then
   if prior.contractor_id<>s.contractor_id or prior.submitted_by<>s.actor then raise exception 'Renewal document already submitted'; end if;
   return jsonb_build_object('document_id',prior.id,'contractor_id',prior.contractor_id,'kind',prior.kind,'submitted_as',prior.submitted_as,'recorded',false);
 end if;
 parts:=regexp_match(coalesce(p_path,''),'^renewals/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(license|insurance)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-([A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif))$');
 if parts is null or parts[1]<>s.contractor_id::text then raise exception 'Document path does not belong to this provider'; end if;
 select o.metadata into object_metadata from storage.objects o where o.bucket_id='vendor-documents' and o.name=p_path;
 if not found then raise exception 'Uploaded document not found'; end if;
 size_value:=case when coalesce(object_metadata->>'size','') ~ '^[0-9]{1,12}$' then (object_metadata->>'size')::bigint end;
 mime_value:=lower(coalesce(object_metadata->>'mimetype',''));
 if size_value is null or size_value<=0 or size_value>10485760
   or mime_value not in ('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif') then
   raise exception 'Uploaded document failed verification';
 end if;
 if (select count(*) from public.vendor_renewal_documents d where d.contractor_id=s.contractor_id and d.kind=parts[2]
     and not exists(select 1 from public.vendor_renewal_document_decisions x where x.document_id=d.id))>=private.vendor_renewal_open_limit() then
   raise exception 'Too many renewal documents are awaiting review';
 end if;
 insert into public.vendor_renewal_documents(contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
   values(s.contractor_id,parts[2],p_path,parts[3],mime_value,size_value,s.actor,s.submitted_as) returning id into result;
 -- A submission is a file only: no evidence, status, revision, role or listing.
 return jsonb_build_object('document_id',result,'contractor_id',s.contractor_id,'kind',parts[2],'submitted_as',s.submitted_as,'recorded',true);
end $$;

-- Declines an undecided submission with a note the provider sees. Only the exact
-- request replays.
create function public.vendor_decline_renewal_document(p_document uuid,p_note text,p_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; d public.vendor_renewal_documents; prior public.vendor_renewal_document_decisions;
begin
 actor:=public.vendor_require_operator();
 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 select * into d from public.vendor_renewal_documents where id=p_document;
 if not found then raise exception 'Renewal document not found'; end if;
 -- The same lock the checklist command takes, so accept and decline serialise.
 perform 1 from public.vendor_onboarding o where o.contractor_id=d.contractor_id for update;
 select * into prior from public.vendor_renewal_document_decisions where business_key=p_key;
 if found then
   if prior.document_id<>p_document or prior.outcome<>'declined' or prior.actor<>actor or prior.note is distinct from btrim(p_note) then
     raise exception 'Renewal decision idempotency conflict';
   end if;
   return jsonb_build_object('document_id',p_document,'outcome','declined','recorded',false);
 end if;
 if length(btrim(coalesce(p_note,'')))=0 then raise exception 'A note for the provider is required'; end if;
 if exists(select 1 from public.vendor_renewal_document_decisions where document_id=p_document) then
   raise exception 'Renewal document already decided';
 end if;
 insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor)
   values(p_document,'declined',btrim(p_note),p_key,actor);
 return jsonb_build_object('document_id',p_document,'outcome','declined','recorded',true);
end $$;

-- The TRACE-069 command, unchanged except that license and insurance may also reference
-- one of this provider's undecided renewal submissions for the same item. Accepting one
-- records the decision with the evidence. The evidence is still recorded on the
-- reviewed application version, so no new version or re-review follows.
create or replace function public.vendor_record_checklist_evidence(p_contractor uuid,p_kind text,p_requirement text,
  p_reference text,p_accepted timestamptz,p_expires timestamptz default null,p_supersedes uuid default null,p_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; replay jsonb; o public.vendor_onboarding; v public.vendor_application_versions; result uuid;
  renewal public.vendor_renewal_documents;
begin
 actor:=public.vendor_require_operator();
 replay:=private.vendor_checklist_evidence_replay(p_key,p_contractor,p_kind,p_requirement,p_reference,p_accepted,p_expires,p_supersedes,actor);
 if replay is not null then return replay; end if;
 select * into o from public.vendor_onboarding where contractor_id=p_contractor for update;
 if not found then raise exception 'Onboarding review required'; end if;
 replay:=private.vendor_checklist_evidence_replay(p_key,p_contractor,p_kind,p_requirement,p_reference,p_accepted,p_expires,p_supersedes,actor);
 if replay is not null then return replay; end if;

 if length(btrim(coalesce(p_key,'')))=0 then raise exception 'Idempotency key required'; end if;
 if p_kind is null or p_kind not in ('identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification') then
   raise exception 'Unknown checklist item';
 end if;
 if length(btrim(coalesce(p_requirement,'')))=0 or length(btrim(coalesce(p_reference,'')))=0 then
   raise exception 'Requirement version and evidence reference required';
 end if;
 if p_accepted is null then raise exception 'Review time required'; end if;
 if o.status='rejected' then raise exception 'A rejected provider takes no further evidence'; end if;
 select * into strict v from public.vendor_application_versions where id=o.application_version_id;
 if exists(select 1 from public.vendor_application_versions newer where newer.application_id=v.application_id and newer.revision>v.revision)
   or not exists(select 1 from public.vendor_applications app where app.id=v.application_id
     and app.contractor_id=p_contractor and app.status not in ('rejected','abandoned')) then
   raise exception 'Current application version required';
 end if;
 if p_kind in ('license','insurance') then
   -- The TRACE-062 document rule without its service/ZIP scope, or a TRACE-073 renewal.
   if not coalesce(v.application->'document_urls' ? btrim(p_reference),false) then
     select * into renewal from public.vendor_renewal_documents d where d.storage_path=btrim(p_reference) and d.contractor_id=p_contractor;
     if not found then raise exception 'Document must belong to the current provider application'; end if;
     if renewal.kind<>p_kind then raise exception 'Renewal document was submitted for a different item'; end if;
     if exists(select 1 from public.vendor_renewal_document_decisions x where x.document_id=renewal.id) then
       raise exception 'Renewal document already decided';
     end if;
   end if;
   if p_expires is null then raise exception 'License and insurance evidence requires an expiry'; end if;
 end if;

 -- The kernel enforces operator, freshness, expiry and the stale-supersede guard.
 result:=public.vendor_record_evidence(p_contractor,p_kind,btrim(p_requirement),btrim(p_reference),p_accepted,p_expires,p_supersedes);
 begin
   insert into public.vendor_checklist_evidence_requests(business_key,contractor_id,evidence_id,kind,requirement_version,
     evidence_ref,accepted_at,expires_at,supersedes,actor)
     values(p_key,p_contractor,result,p_kind,btrim(p_requirement),btrim(p_reference),p_accepted,p_expires,p_supersedes,actor);
 exception when unique_violation then
   -- The same key concurrently recorded evidence for another provider.
   raise exception 'Checklist evidence idempotency conflict';
 end;
 if renewal.id is not null then
   insert into public.vendor_renewal_document_decisions(document_id,outcome,evidence_id,business_key,actor)
     values(renewal.id,'accepted',result,p_key,actor);
 end if;
 -- Recording evidence activates nothing, grants no role and changes no revision.
 return jsonb_build_object('contractor_id',p_contractor,'evidence_id',result,'kind',p_kind,'recorded',true);
end $$;

create function private.vendor_renewal_document_json(d public.vendor_renewal_documents,p_operator boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'kind',d.kind,'file_name',d.file_name,'submitted_as',d.submitted_as,'created_at',d.created_at,
   'state',coalesce(x.outcome,'submitted'),'note',x.note,'decided_at',x.created_at)
  || case when p_operator then jsonb_build_object('contractor_id',d.contractor_id,'storage_path',d.storage_path,
       'mime_type',d.mime_type,'size_bytes',d.size_bytes,'evidence_id',x.evidence_id) else '{}'::jsonb end
 from (select 1) one left join public.vendor_renewal_document_decisions x on x.document_id=d.id
$$;

-- Operator readback for one provider, newest first. Writes nothing.
create function public.vendor_renewal_document_overview(p_contractor uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'contractor_id',p_contractor,
  'onboarding_status',(select o.status from public.vendor_onboarding o where o.contractor_id=p_contractor),
  'open_limit',private.vendor_renewal_open_limit(),
  'documents',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,true) order by d.created_at desc,d.id)
    from public.vendor_renewal_documents d where d.contractor_id=p_contractor),'[]'::jsonb));
end $$;

-- Operator queue of undecided submissions across providers, oldest first. Writes nothing.
create function public.vendor_renewal_document_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',now(),
  'entries',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,true)
      || jsonb_build_object('name',c.name,'onboarding_status',o.status) order by d.created_at,d.id)
    from public.vendor_renewal_documents d
    join public.contractors c on c.id=d.contractor_id
    join public.vendor_onboarding o on o.contractor_id=d.contractor_id
    where not exists(select 1 from public.vendor_renewal_document_decisions x where x.document_id=d.id)),'[]'::jsonb));
end $$;

-- The vendor's own submissions: item, file name, time, state and any decline note. No
-- storage path, evidence, reviewer or other provider.
create function public.vendor_own_renewal_documents()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare contractor uuid; status_value text;
begin
 if auth.uid() is null or not public.has_role(auth.uid(),'vendor') then
   raise exception 'Vendor account required' using errcode='42501';
 end if;
 select c.id into contractor from public.contractors c where c.user_id=auth.uid();
 select o.status into status_value from public.vendor_onboarding o where o.contractor_id=contractor;
 return jsonb_build_object(
  'accepting',coalesce(status_value in ('active','suspended'),false),
  'open_limit',private.vendor_renewal_open_limit(),
  'documents',coalesce((select jsonb_agg(private.vendor_renewal_document_json(d,false) order by d.created_at desc,d.id)
    from public.vendor_renewal_documents d where contractor is not null and d.contractor_id=contractor),'[]'::jsonb));
end $$;

revoke all on function private.vendor_renewal_open_limit(),
 private.vendor_renewal_submitter(uuid),
 private.vendor_renewal_document_json(public.vendor_renewal_documents,boolean)
 from public,anon,authenticated,service_role;
revoke all on function public.vendor_authorize_renewal_upload(text,uuid),
 public.vendor_submit_renewal_document(text,uuid),
 public.vendor_decline_renewal_document(uuid,text,text),
 public.vendor_renewal_document_overview(uuid),
 public.vendor_renewal_document_queue(),
 public.vendor_own_renewal_documents()
 from public,anon,authenticated,service_role;
grant execute on function public.vendor_authorize_renewal_upload(text,uuid),
 public.vendor_submit_renewal_document(text,uuid),
 public.vendor_decline_renewal_document(uuid,text,text),
 public.vendor_renewal_document_overview(uuid),
 public.vendor_renewal_document_queue(),
 public.vendor_own_renewal_documents()
 to authenticated;
-- create or replace keeps the TRACE-069 grants on vendor_record_checklist_evidence.
