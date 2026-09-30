-- TRACE-105 forward fix found by the R0.5 production-shaped rehearsal (2026-09-30).
--
-- Production's migration history records 20260729233955, whose trigger bypasses only
-- when the PostgREST role is not `authenticated` (current_setting('role')). The live
-- function had later been replaced outside the history with a `current_user` test.
-- In a SECURITY DEFINER function current_user is the owner, never `authenticated`, so
-- that version always bypassed: a signed-in vendor could change activation, listing,
-- payout and ownership columns on its own provider row.
--
-- This re-applies the reviewed body from 20260729233955 unchanged and re-asserts the
-- trigger. It is a no-op where the reviewed body is already present.
create or replace function public.enforce_contractor_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_cols text[] := array[
    'name','bio','location','phone','email','services','years_experience',
    'special_offer','our_promise','tagline','website','video_url','logo_url','updated_at'
  ];
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  k text;
begin
  -- Bypass unless the invoking PostgREST role is authenticated.
  if current_setting('role', true) <> 'authenticated' then
    return new;
  end if;

  -- Bypass for admins
  if public.has_role(auth.uid(), 'admin') then
    return new;
  end if;

  -- Only applies to the vendor who owns this contractor row
  if auth.uid() is null or old.user_id is null or auth.uid() <> old.user_id then
    return new;
  end if;

  -- Ownership can never be changed by a vendor
  if new.user_id is distinct from old.user_id then
    raise exception 'Vendors cannot change ownership of a provider profile'
      using errcode = '42501';
  end if;

  for k in select jsonb_object_keys(new_j) loop
    if (old_j -> k) is distinct from (new_j -> k) and not (k = any (allowed_cols)) then
      raise exception 'Vendors are not allowed to modify "%" on a provider profile', k
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$$;
revoke all on function public.enforce_contractor_update_scope() from public, anon, authenticated;
drop trigger if exists trg_enforce_contractor_update_scope on public.contractors;
create trigger trg_enforce_contractor_update_scope
before update on public.contractors
for each row execute function public.enforce_contractor_update_scope();
