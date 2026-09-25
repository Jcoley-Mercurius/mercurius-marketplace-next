-- TRACE-090: retention for application uploads that were never attached (DEC-2026-012
-- item 5, owner 2026-09-24).
--
-- The application route creates the application row and then issues one signed upload URL
-- per document; the browser uploads each file and asks the finalize route to add the paths
-- to document_urls. A file whose upload succeeded but was never finalized stays in
-- vendor-documents under the application's folder indefinitely. TRACE-084 left these
-- outside retention because nothing lists them.
--
-- Owner decision: such a file becomes due 7 days after its signed upload grant expires,
-- when neither the application's document_urls nor any compliance evidence references it.
-- It then follows the TRACE-084 operator-run quarantine, 14-day wait and permanent
-- deletion, with application and provider holds respected. Orphaned renewal uploads are
-- not part of this decision.
--
-- The grant's expiry is not stored. Grants are issued only when the application is
-- created, and Supabase Storage signed upload URLs last 2 hours (the finalize token lasts
-- 110 minutes, so the upload URL is the later of the two). An object can only be created
-- after its grant was issued, so the object's created_at plus 2 hours is never earlier
-- than the grant's expiry; the clock may start up to 2 hours late, never early.
--
-- "Never attached" means listed by neither the current row nor any application version,
-- the same set TRACE-084 calls the application's files. Nothing here changes an
-- application, version, closure, evidence or hold; the route, buckets, ledger table and
-- storage verification are TRACE-084's, unchanged.

create function private.vendor_application_upload_grant_hours() returns integer
  language sql immutable set search_path='' as $$ select 2 $$;
create function private.vendor_unattached_upload_days() returns integer
  language sql immutable set search_path='' as $$ select 7 $$;

-- The form's upload layout under one application's folder, as TRACE-084 matches it.
create function private.vendor_application_upload_pattern(p_application uuid) returns text
  language sql immutable set search_path='' as $$
 select '^'||p_application::text||'/(license|insurance|other)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif)$'
$$;

-- Files in the application's folder that no version or current row lists: those stored in
-- either bucket, and those the retention ledger has already moved or deleted. uploaded_at
-- is the earliest created_at storage shows, or null once the file is gone.
create function private.vendor_application_unattached_files(p_application uuid)
returns table(path text,uploaded_at timestamptz)
language sql stable security definer set search_path='' as $$
 with attached as (select f as path from private.vendor_application_files(p_application) f)
 select c.path,min(c.created_at) from (
   select o.name as path,o.created_at from storage.objects o
    where o.bucket_id in ('vendor-documents','vendor-documents-quarantine')
      and o.name like p_application::text||'/%'
   union all
   select a.storage_path,null::timestamptz from public.vendor_application_retention_actions a
    where a.application_id=p_application
 ) c
 where c.path ~ private.vendor_application_upload_pattern(p_application)
   and not exists(select 1 from attached t where t.path=c.path)
 group by c.path
$$;

create function private.vendor_application_unattached_due_at(p_uploaded_at timestamptz) returns timestamptz
  language sql immutable set search_path='' as $$
 select p_uploaded_at+make_interval(hours=>private.vendor_application_upload_grant_hours(),
   days=>private.vendor_unattached_upload_days())
$$;

-- TRACE-084's refusal, extended: an attached file keeps the closure clock; an unattached
-- file is due 7 days after its upload grant expired, whatever the application's status.
-- Evidence, deletion-once, quarantine-first and the 14-day wait apply to both. A deletion
-- is recorded after storage no longer holds the file, so its upload time is gone; the
-- file is then in quarantine, and its clock was checked when it was quarantined.
-- (Storage's move keeps an object's created_at, so a quarantine is checked with the
-- original upload time.)
create or replace function private.vendor_application_retention_refusal(p_application uuid,p_path text,p_action text)
returns text language plpgsql stable security definer set search_path='' as $$
declare r record; c record; attached boolean; uploaded timestamptz;
begin
 if not exists(select 1 from public.vendor_applications a where a.id=p_application) then return 'Application not found'; end if;
 attached:=p_path is not null and exists(select 1 from private.vendor_application_files(p_application) f where f=p_path);
 if not attached then
   select u.uploaded_at into uploaded from private.vendor_application_unattached_files(p_application) u where u.path=p_path;
   if p_path is null or not found then return 'Document does not belong to this application'; end if;
 end if;
 select * into strict r from private.vendor_application_retention_state(p_path);
 if r.state='deleted' then return 'Application document already deleted'; end if;
 if p_action not in ('quarantined','restored','deleted') then return 'Unknown retention action'; end if;
 if p_action='restored' then
   if r.state<>'quarantined' then return 'Application document is not in quarantine'; end if;
   return null;
 end if;
 if p_action='quarantined' and r.state<>'retained' then return 'Application document already quarantined'; end if;
 if p_action='deleted' and r.state<>'quarantined' then return 'Application document must be quarantined before deletion'; end if;
 if private.vendor_application_file_bound(p_path) then return 'Documents bound to compliance evidence are kept'; end if;
 if attached then
   select * into c from private.vendor_application_closure(p_application);
   if not found then return 'Only documents of a rejected or abandoned application are subject to retention'; end if;
   if c.closed_at is null or c.closed_at>now()-make_interval(days=>private.vendor_document_retention_days()) then
     return 'Documents of a closed application are kept for '||private.vendor_document_retention_days()||' days';
   end if;
 elsif (uploaded is null and p_action<>'deleted') or private.vendor_application_unattached_due_at(uploaded)>now() then
   return 'Uploads never attached to an application are kept for '||private.vendor_unattached_upload_days()
     ||' days after their upload link expires';
 end if;
 if p_action='deleted' and r.since>now()-make_interval(days=>private.vendor_document_quarantine_days()) then
   return 'Quarantined documents are kept for '||private.vendor_document_quarantine_days()||' days before deletion';
 end if;
 return null;
end $$;

-- TRACE-084's file readback with three added fields: attached, uploaded_at, and for an
-- unattached file a retention_ends_at from its upload clock instead of the closure.
create or replace function private.vendor_application_file_json(p_application uuid,p_path text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('application_id',a.id,'business_name',a.business_name,'application_status',a.status,
   'path',p_path,'kind',split_part(p_path,'/',2),
   'file_name',regexp_replace(split_part(p_path,'/',3),'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-',''),
   'attached',u.path is null,
   'uploaded_at',u.uploaded_at,
   'closure_outcome',c.outcome,'closed_at',c.closed_at,'closure_source',c.source,
   'retention_ends_at',case when u.path is null
     then c.closed_at+make_interval(days=>private.vendor_document_retention_days())
     else private.vendor_application_unattached_due_at(u.uploaded_at) end,
   'retention_state',s.state,'retention_since',s.since,
   'quarantine_ends_at',case when s.state='quarantined' then s.since+make_interval(days=>private.vendor_document_quarantine_days()) end,
   'object_location',private.vendor_renewal_object_location(p_path),
   'bound_to_evidence',private.vendor_application_file_bound(p_path),
   'held',private.vendor_application_held(a.id))
 from public.vendor_applications a
 left join lateral private.vendor_application_closure(a.id) c on true
 left join lateral (select x.path,x.uploaded_at from private.vendor_application_unattached_files(a.id) x where x.path=p_path) u on true
 cross join lateral private.vendor_application_retention_state(p_path) s
 where a.id=p_application
$$;

-- TRACE-084's queue with two added lists. unattached_due: never-attached uploads whose
-- clock has passed, still retained and not bound to evidence (held applications included,
-- marked held). unattached_kept: never-attached uploads bound to evidence. Quarantined
-- unattached files appear in quarantined, marked attached=false.
create or replace function public.vendor_application_retention_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform public.vendor_require_operator();
 return jsonb_build_object(
  'evaluated_at',now(),
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
  'unattached_days',private.vendor_unattached_upload_days(),
  'upload_grant_hours',private.vendor_application_upload_grant_hours(),
  'due',coalesce((select jsonb_agg(e.value order by e.value->>'closed_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,f) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_closure(a.id) c
      cross join lateral private.vendor_application_files(a.id) f
      where c.closed_at<=now()-make_interval(days=>private.vendor_document_retention_days())
    ) e where e.value->>'retention_state'='retained' and not (e.value->>'bound_to_evidence')::boolean),'[]'::jsonb),
  'unattached_due',coalesce((select jsonb_agg(e.value order by e.value->>'uploaded_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,u.path) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_unattached_files(a.id) u
      where private.vendor_application_unattached_due_at(u.uploaded_at)<=now()
    ) e where e.value->>'retention_state'='retained' and not (e.value->>'bound_to_evidence')::boolean),'[]'::jsonb),
  'quarantined',coalesce((select jsonb_agg(e.value order by e.value->>'retention_since',e.value->>'path') from (
      select private.vendor_application_file_json(p.application_id,p.storage_path) as value
      from (select distinct application_id,storage_path from public.vendor_application_retention_actions) p
    ) e where e.value->>'retention_state'='quarantined'),'[]'::jsonb),
  'kept',coalesce((select jsonb_agg(e.value order by e.value->>'closed_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,f) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_closure(a.id) c
      cross join lateral private.vendor_application_files(a.id) f
      where private.vendor_application_file_bound(f)
    ) e),'[]'::jsonb),
  'unattached_kept',coalesce((select jsonb_agg(e.value order by e.value->>'uploaded_at',e.value->>'path') from (
      select private.vendor_application_file_json(a.id,u.path) as value
      from public.vendor_applications a
      cross join lateral private.vendor_application_unattached_files(a.id) u
      where private.vendor_application_file_bound(u.path)
    ) e),'[]'::jsonb),
  'unrecorded',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,'business_name',a.business_name,'status',a.status,
        'has_provider',exists(select 1 from private.vendor_application_contractors(a.id)))
      order by a.created_at,a.id)
    from public.vendor_applications a
    where a.status in ('rejected','abandoned') and not exists(select 1 from private.vendor_application_closure(a.id))),'[]'::jsonb),
  'holds',coalesce((select jsonb_agg(jsonb_build_object('application_id',a.id,'business_name',a.business_name,'reason',h.reason,'placed_at',h.placed_at)
      order by h.placed_at,a.id)
    from public.vendor_applications a
    cross join lateral private.vendor_application_hold(a.id) h),'[]'::jsonb));
end $$;

-- TRACE-084's overview with the application's never-attached uploads added.
create or replace function public.vendor_application_retention_overview(p_application uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare app public.vendor_applications; has_provider boolean; closure jsonb;
begin
 perform public.vendor_require_operator();
 select * into app from public.vendor_applications where id=p_application;
 if not found then raise exception 'Application not found'; end if;
 has_provider:=exists(select 1 from private.vendor_application_contractors(p_application));
 select jsonb_build_object('outcome',c.outcome,'closed_at',c.closed_at,'source',c.source,'reason',c.reason) into closure
   from private.vendor_application_closure(p_application) c;
 return jsonb_build_object(
  'application_id',app.id,
  'application_status',app.status,
  'has_provider',has_provider,
  'closure',closure,
  'closable',not has_provider and closure is null,
  'close_outcomes',case when has_provider or closure is not null then '[]'::jsonb
    when app.status in ('pending','approved') then '["rejected","abandoned"]'::jsonb
    when app.status in ('rejected','abandoned') then jsonb_build_array(app.status)
    else '[]'::jsonb end,
  'retention_days',private.vendor_document_retention_days(),
  'quarantine_days',private.vendor_document_quarantine_days(),
  'unattached_days',private.vendor_unattached_upload_days(),
  'hold',(select jsonb_build_object('reason',h.reason,'placed_at',h.placed_at) from private.vendor_application_hold(p_application) h),
  'provider_held',exists(select 1 from private.vendor_application_contractors(p_application) c cross join lateral private.vendor_retention_hold(c) h),
  'files',coalesce((select jsonb_agg(private.vendor_application_file_json(p_application,f) order by f)
    from private.vendor_application_files(p_application) f),'[]'::jsonb),
  'unattached_files',coalesce((select jsonb_agg(private.vendor_application_file_json(p_application,u.path) order by u.path)
    from private.vendor_application_unattached_files(p_application) u),'[]'::jsonb));
end $$;

revoke all on function private.vendor_application_upload_grant_hours(),
 private.vendor_unattached_upload_days(),
 private.vendor_application_upload_pattern(uuid),
 private.vendor_application_unattached_files(uuid),
 private.vendor_application_unattached_due_at(timestamptz)
 from public,anon,authenticated,service_role;
