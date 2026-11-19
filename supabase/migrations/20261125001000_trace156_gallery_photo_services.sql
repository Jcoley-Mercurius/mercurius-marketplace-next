-- TRACE-156: saved photo-to-service associations for dynamic provider profiles.
-- Checkpoint: docs/agent/PROFILE-MEDIA-CLEANUP.md.
--
-- A provider photo stays one row in public.contractor_gallery. This migration adds a link table
-- that says which of the provider's services a photo shows. A photo with no link is a General
-- business photo, so every existing upload keeps that meaning with no data change: nothing is
-- backfilled, tagged, copied or deleted here.
--
-- 1. public.contractor_gallery_services: one row per photo and service. A composite foreign key
--    ties each link to the photo's own provider, so a link can never name another provider and a
--    linked photo cannot be moved to another provider.
-- 2. Applicability is enforced on insert by a trigger: the service must be active in the catalog
--    and either listed by the provider or backed by one of its active packages.
-- 3. public.set_contractor_gallery_photo_services replaces a photo's links. It is the only client
--    write path. The caller must own the photo's provider or hold the admin role, decided from
--    auth.uid() and the stored row, never from a client-supplied owner or role.
-- 4. public.contractor_photo_service_options gives the same two callers the assignable services.
--
-- A service the provider later stops offering keeps its existing links. They are never rewritten
-- to General business, because that would show the photo under unrelated services.
--
-- Additive: one new table, one new unique constraint on contractor_gallery and new functions. No
-- existing column, policy, grant, function or row is changed. Public reads match the gallery's
-- existing public read. The whole migration runs under a 2-second lock timeout: on contention it
-- aborts cleanly and nothing is applied.

set lock_timeout = '2s';

alter table public.contractor_gallery
  add constraint contractor_gallery_id_contractor_id_key unique (id, contractor_id);

create table public.contractor_gallery_services (
  gallery_id uuid not null,
  contractor_id uuid not null,
  -- Restrict, not cascade: removing a catalog row must not silently turn a tagged photo general.
  service_id text not null references public.services_catalog (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (gallery_id, service_id),
  constraint contractor_gallery_services_photo_fkey
    foreign key (gallery_id, contractor_id)
    references public.contractor_gallery (id, contractor_id)
    on delete cascade
);

comment on table public.contractor_gallery_services is
  'TRACE-156: the services a provider photo shows. No row means a General business photo.';

create index contractor_gallery_services_contractor_service_idx
  on public.contractor_gallery_services (contractor_id, service_id);
create index contractor_gallery_services_service_idx
  on public.contractor_gallery_services (service_id);

alter table public.contractor_gallery_services enable row level security;

create policy "Anyone can view gallery photo services"
  on public.contractor_gallery_services
  for select
  using (true);

revoke all on table public.contractor_gallery_services from public, anon, authenticated;
grant select on table public.contractor_gallery_services to anon, authenticated;
grant all on table public.contractor_gallery_services to service_role;

create function private.contractor_photo_service_is_applicable(p_contractor_id uuid, p_service_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.services_catalog service
      where service.id = p_service_id and service.is_active
    )
    and (
      exists (
        select 1 from public.contractors contractor
        where contractor.id = p_contractor_id and p_service_id = any (contractor.services)
      )
      or exists (
        select 1 from public.vendor_packages package
        where package.contractor_id = p_contractor_id
          and package.service_id = p_service_id
          and package.is_active
      )
    );
$$;

create function private.can_manage_contractor_photos(p_contractor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      or exists (
        select 1 from public.contractors contractor
        where contractor.id = p_contractor_id and contractor.user_id = auth.uid()
      )
    );
$$;

create function private.contractor_gallery_services_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Photo service links are replaced, not edited' using errcode = '55000';
  end if;
  if not private.contractor_photo_service_is_applicable(new.contractor_id, new.service_id) then
    raise exception 'That service is not available for this provider' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger contractor_gallery_services_guard
  before insert or update on public.contractor_gallery_services
  for each row execute function private.contractor_gallery_services_guard();

create function public.set_contractor_gallery_photo_services(p_gallery_id uuid, p_service_ids text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contractor_id uuid;
  v_service_ids text[];
begin
  if p_service_ids is null
    or coalesce(array_ndims(p_service_ids), 1) <> 1
    or cardinality(p_service_ids) > 100
    or exists (select 1 from unnest(p_service_ids) requested(id) where requested.id is null or btrim(requested.id) = '')
  then
    raise exception 'Choose valid services for this photo' using errcode = '22023';
  end if;

  -- Serializes concurrent saves of one photo. A missing photo and another provider's photo give
  -- the same answer, so this function cannot be used to discover photo ids.
  select gallery.contractor_id into v_contractor_id
  from public.contractor_gallery gallery
  where gallery.id = p_gallery_id
  for update;

  if v_contractor_id is null or not private.can_manage_contractor_photos(v_contractor_id) then
    raise exception 'This photo is not available to change' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct requested.id order by requested.id), '{}'::text[])
  into v_service_ids
  from unnest(p_service_ids) requested(id);

  delete from public.contractor_gallery_services link
  where link.gallery_id = p_gallery_id
    and not (link.service_id = any (v_service_ids));

  -- Only new links reach the guard, so a retained link to a withdrawn service does not block a
  -- save. ON CONFLICT would not do: BEFORE INSERT triggers fire before conflicts are detected.
  insert into public.contractor_gallery_services (gallery_id, contractor_id, service_id)
  select p_gallery_id, v_contractor_id, requested.id
  from unnest(v_service_ids) requested(id)
  where not exists (
    select 1 from public.contractor_gallery_services link
    where link.gallery_id = p_gallery_id and link.service_id = requested.id
  );

  return v_service_ids;
end;
$$;

create function public.contractor_photo_service_options(p_contractor_id uuid)
returns table (service_id text, service_name text, is_applicable boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_contractor_id is null or not private.can_manage_contractor_photos(p_contractor_id) then
    raise exception 'These services are not available' using errcode = '42501';
  end if;

  return query
  select service.id, service.name,
    private.contractor_photo_service_is_applicable(p_contractor_id, service.id)
  from public.services_catalog service
  where private.contractor_photo_service_is_applicable(p_contractor_id, service.id)
    or exists (
      select 1 from public.contractor_gallery_services link
      where link.contractor_id = p_contractor_id and link.service_id = service.id
    )
  order by service.name, service.id;
end;
$$;

revoke all on function private.contractor_photo_service_is_applicable(uuid, text) from public, anon, authenticated;
revoke all on function private.can_manage_contractor_photos(uuid) from public, anon, authenticated;
revoke all on function private.contractor_gallery_services_guard() from public, anon, authenticated;
revoke all on function public.set_contractor_gallery_photo_services(uuid, text[]) from public, anon, authenticated;
revoke all on function public.contractor_photo_service_options(uuid) from public, anon, authenticated;
grant execute on function public.set_contractor_gallery_photo_services(uuid, text[]) to authenticated;
grant execute on function public.contractor_photo_service_options(uuid) to authenticated;
