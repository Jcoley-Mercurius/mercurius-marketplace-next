-- TRACE-094: attaching finalized application uploads can no longer lose an attachment
-- (Codex Phase 5 closure review P2, 2026-09-26; TRACE-052, TRACE-060, TRACE-084, TRACE-090).
--
-- The finalize route read document_urls, merged the verified paths in the route and wrote
-- the whole column back with the service key. The grant allows any subset of its paths, so
-- two requests could read the same list and each write back only its own addition: both
-- answered success and the current application kept one of the two documents. Version
-- snapshots kept both historically but did not repair the current row.
--
-- The merge now happens in one transaction that locks the application row and appends to
-- the list it holds, so concurrent finalizations serialise and each sees the other's paths.
-- The route keeps its checks (signed grant, application id, path prefix, stored size and
-- type through Storage); the database also refuses a path outside the application's upload
-- layout or with no stored object. Paths already listed are not added again, and a request
-- that adds nothing leaves the row, and so its versions, unchanged.

create function public.vendor_application_attach_documents(p_application uuid,p_paths text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare listed text[]; path text; added integer:=0;
begin
 if p_application is null or p_paths is null or cardinality(p_paths)=0 or cardinality(p_paths)>12 then
   raise exception 'Choose between 1 and 12 documents to attach';
 end if;
 select coalesce(a.document_urls,'{}'::text[]) into listed from public.vendor_applications a where a.id=p_application for update;
 if not found then raise exception 'Application not found'; end if;
 foreach path in array p_paths loop
   if path is null or path !~ private.vendor_application_upload_pattern(p_application) then
     raise exception 'Document path does not belong to this application';
   end if;
   if not exists(select 1 from storage.objects o where o.bucket_id='vendor-documents' and o.name=path) then
     raise exception 'Uploaded document not found';
   end if;
   if not path=any(listed) then
     listed:=listed||path;
     added:=added+1;
   end if;
 end loop;
 if added>0 then
   update public.vendor_applications set document_urls=listed where id=p_application;
 end if;
 return jsonb_build_object('application_id',p_application,'document_paths',to_jsonb(listed),'added',added);
end $$;

revoke all on function public.vendor_application_attach_documents(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.vendor_application_attach_documents(uuid,text[]) to service_role;
