-- TRACE-156: atomic bulk assignments, caption conflict detection, order and explicit pairs.
-- Forward-only addition after the already-hosted 20261125001000. No photo backfill.
set lock_timeout = '2s';

create table public.contractor_gallery_pairs (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  before_id uuid not null,
  after_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  check (before_id <> after_id),
  constraint contractor_gallery_pairs_before_photo_fkey foreign key (before_id, contractor_id)
    references public.contractor_gallery(id, contractor_id) on delete cascade,
  constraint contractor_gallery_pairs_after_photo_fkey foreign key (after_id, contractor_id)
    references public.contractor_gallery(id, contractor_id) on delete cascade
);
create index contractor_gallery_pairs_contractor_idx on public.contractor_gallery_pairs(contractor_id);
create unique index contractor_gallery_pairs_before_idx on public.contractor_gallery_pairs(before_id);
create unique index contractor_gallery_pairs_after_idx on public.contractor_gallery_pairs(after_id);
alter table public.contractor_gallery_pairs enable row level security;
create policy "Anyone can read explicit photo pairs" on public.contractor_gallery_pairs for select using (true);
revoke all on public.contractor_gallery_pairs from public, anon, authenticated;
grant select on public.contractor_gallery_pairs to anon, authenticated;
grant all on public.contractor_gallery_pairs to service_role;

-- Serializes pairs for a provider, including cross-role membership and direct trusted writes.
create function private.contractor_gallery_pair_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.contractors where id = new.contractor_id for update;
  if exists (select 1 from public.contractor_gallery_pairs p where p.id <> new.id
    and (p.before_id in (new.before_id, new.after_id) or p.after_id in (new.before_id, new.after_id))) then
    raise exception 'A photo can belong to only one before and after pair' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger contractor_gallery_pair_guard before insert or update on public.contractor_gallery_pairs
  for each row execute function private.contractor_gallery_pair_guard();

create function public.bulk_contractor_gallery_services(p_contractor_id uuid, p_gallery_ids uuid[], p_service_ids text[], p_mode text)
returns table (gallery_id uuid, service_ids text[])
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_services text[];
begin
  if not private.can_manage_contractor_photos(p_contractor_id) then
    raise exception 'This gallery is not available to change' using errcode = '42501';
  end if;
  if p_gallery_ids is null or cardinality(p_gallery_ids) not between 1 and 100
    or coalesce(array_ndims(p_gallery_ids), 1) <> 1
    or array_position(p_gallery_ids, null) is not null
    or p_service_ids is null or cardinality(p_service_ids) > 100
    or coalesce(array_ndims(p_service_ids), 1) <> 1
    or p_mode is null or p_mode not in ('add', 'replace', 'clear') then
    raise exception 'Choose up to 100 photos and valid services' using errcode = '22023';
  end if;
  perform 1 from public.contractors where id = p_contractor_id for update;
  perform 1 from public.contractor_gallery where contractor_id = p_contractor_id and id = any(p_gallery_ids) order by id for update;
  if (select count(*) from public.contractor_gallery where contractor_id = p_contractor_id and id = any(p_gallery_ids))
    <> (select count(distinct x) from unnest(p_gallery_ids) x) then
    raise exception 'Some photos are no longer available. Reload the gallery' using errcode = '40001';
  end if;
  for v_id in select distinct x from unnest(p_gallery_ids) x order by x loop
    v_services := case when p_mode = 'clear' then '{}'::text[] else p_service_ids end;
    if p_mode = 'add' then
      select coalesce(array_agg(distinct x), '{}'::text[]) into v_services
      from (select unnest(v_services) x union select l.service_id from public.contractor_gallery_services l where l.gallery_id = v_id) s;
    end if;
    gallery_id := v_id;
    service_ids := public.set_contractor_gallery_photo_services(v_id, v_services);
    return next;
  end loop;
end $$;

create function public.save_contractor_gallery_caption(p_gallery_id uuid, p_caption text, p_expected_caption text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_photo public.contractor_gallery; v_caption text := nullif(btrim(p_caption), '');
begin
  select * into v_photo from public.contractor_gallery where id = p_gallery_id for update;
  if v_photo.id is null or not private.can_manage_contractor_photos(v_photo.contractor_id) then
    raise exception 'This photo is not available to change' using errcode = '42501';
  end if;
  if length(v_caption) > 500 then raise exception 'Use a caption of 500 characters or fewer' using errcode = '22023'; end if;
  if v_photo.caption is distinct from p_expected_caption then
    raise exception 'This caption changed elsewhere. Reload before saving' using errcode = '40001';
  end if;
  update public.contractor_gallery set caption = v_caption where id = p_gallery_id;
  return v_caption;
end $$;

create function public.reorder_contractor_gallery(p_contractor_id uuid, p_expected_ids uuid[], p_ordered_ids uuid[])
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare v_current uuid[];
begin
  if not private.can_manage_contractor_photos(p_contractor_id) then
    raise exception 'This gallery is not available to change' using errcode = '42501';
  end if;
  if p_expected_ids is null or p_ordered_ids is null or cardinality(p_ordered_ids) not between 1 and 1000
    or cardinality(p_expected_ids) > 1000
    or coalesce(array_ndims(p_expected_ids), 1) <> 1 or coalesce(array_ndims(p_ordered_ids), 1) <> 1
    or array_position(p_ordered_ids, null) is not null then
    raise exception 'Choose a valid gallery order' using errcode = '22023';
  end if;
  perform 1 from public.contractors where id = p_contractor_id for update;
  perform 1 from public.contractor_gallery where contractor_id = p_contractor_id order by id for update;
  select coalesce(array_agg(id order by sort_order, id), '{}'::uuid[]) into v_current from public.contractor_gallery where contractor_id = p_contractor_id;
  if v_current <> p_expected_ids then raise exception 'The gallery changed. Reload before reordering' using errcode = '40001'; end if;
  if cardinality(p_ordered_ids) <> cardinality(v_current)
    or (select count(distinct x) from unnest(p_ordered_ids) x) <> cardinality(v_current)
    or not (p_ordered_ids @> v_current and p_ordered_ids <@ v_current) then
    raise exception 'The order must contain every gallery photo exactly once' using errcode = '22023';
  end if;
  update public.contractor_gallery g set sort_order = o.position::integer - 1
    from unnest(p_ordered_ids) with ordinality o(id, position) where g.id = o.id and g.contractor_id = p_contractor_id;
  return p_ordered_ids;
end $$;

create function public.create_contractor_gallery_pair(p_contractor_id uuid, p_before_id uuid, p_after_id uuid, p_title text)
returns public.contractor_gallery_pairs language plpgsql security definer set search_path = '' as $$
declare v_pair public.contractor_gallery_pairs;
begin
  if not private.can_manage_contractor_photos(p_contractor_id) then
    raise exception 'This gallery is not available to change' using errcode = '42501';
  end if;
  perform 1 from public.contractors where id = p_contractor_id for update;
  perform 1 from public.contractor_gallery where contractor_id = p_contractor_id and id in (p_before_id, p_after_id) order by id for update;
  if p_before_id is null or p_after_id is null or p_before_id = p_after_id
    or (select count(*) from public.contractor_gallery where contractor_id = p_contractor_id and id in (p_before_id, p_after_id)) <> 2 then
    raise exception 'Choose two different photos from this gallery' using errcode = '22023';
  end if;
  insert into public.contractor_gallery_pairs(contractor_id, before_id, after_id, title)
    values(p_contractor_id, p_before_id, p_after_id, btrim(p_title)) returning * into v_pair;
  return v_pair;
end $$;

create function public.remove_contractor_gallery_pair(p_pair_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_contractor uuid;
begin
  select contractor_id into v_contractor from public.contractor_gallery_pairs where id = p_pair_id;
  if v_contractor is null or not private.can_manage_contractor_photos(v_contractor) then
    raise exception 'This pair is not available to change' using errcode = '42501';
  end if;
  perform 1 from public.contractors where id = v_contractor for update;
  delete from public.contractor_gallery_pairs where id = p_pair_id and contractor_id = v_contractor;
end $$;

revoke all on function private.contractor_gallery_pair_guard() from public, anon, authenticated;
revoke all on function public.bulk_contractor_gallery_services(uuid, uuid[], text[], text) from public, anon, authenticated;
revoke all on function public.save_contractor_gallery_caption(uuid, text, text) from public, anon, authenticated;
revoke all on function public.reorder_contractor_gallery(uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke all on function public.create_contractor_gallery_pair(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_contractor_gallery_pair(uuid) from public, anon, authenticated;
grant execute on function public.bulk_contractor_gallery_services(uuid, uuid[], text[], text) to authenticated;
grant execute on function public.save_contractor_gallery_caption(uuid, text, text) to authenticated;
grant execute on function public.reorder_contractor_gallery(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_contractor_gallery_pair(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.remove_contractor_gallery_pair(uuid) to authenticated;
