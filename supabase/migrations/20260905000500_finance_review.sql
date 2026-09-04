-- No members are granted by this migration. A second operator must authenticate
-- separately and approve the exact command; supplying another admin UUID is insufficient.
create table public.money_review_approvals (
  id uuid primary key default gen_random_uuid(), requested_by uuid not null references auth.users(id),
  approved_by uuid not null references auth.users(id), command_hash text not null,
  reason text not null check(length(trim(reason))>0), created_at timestamptz not null default now(),
  unique(requested_by,approved_by,command_hash),check(requested_by<>approved_by)
);
alter table public.money_review_approvals enable row level security;
revoke all on public.money_review_approvals from public,anon,authenticated,service_role;
grant select on public.money_review_approvals to service_role;
create function public.money_approve_review(p_requested_by uuid,p_command jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
  perform public.money_require_finance(auth.uid()); perform public.money_require_finance(p_requested_by);
  if p_command is null or jsonb_typeof(p_command)<>'object' then raise exception 'Review command required'; end if;
  insert into public.money_review_approvals(requested_by,approved_by,command_hash,reason)
    values(p_requested_by,auth.uid(),encode(sha256(convert_to(p_command::text,'UTF8')),'hex'),p_reason)
    on conflict(requested_by,approved_by,command_hash) do nothing;
  select id into strict result from public.money_review_approvals where requested_by=p_requested_by and approved_by=auth.uid() and command_hash=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  return result;
end $$;
create function public.money_require_review(p_actor uuid,p_approver uuid,p_command jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.money_review_approvals where requested_by=p_actor and approved_by=p_approver and command_hash=encode(sha256(convert_to(p_command::text,'UTF8')),'hex'))
    then raise exception 'Separate authenticated approval of exact financial command required' using errcode='42501'; end if;
end $$;
revoke all on function public.money_approve_review(uuid,jsonb,text),public.money_require_review(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.money_approve_review(uuid,jsonb,text) to authenticated;
