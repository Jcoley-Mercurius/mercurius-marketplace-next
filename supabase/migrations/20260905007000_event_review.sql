create table public.money_event_exclusions (
  event_id text primary key references public.money_webhook_events(event_id),
  actor uuid not null references auth.users(id), approver uuid not null references auth.users(id),
  reason text not null check(length(trim(reason))>0), evidence text not null check(length(trim(evidence))>0),
  created_at timestamptz not null default now(),check(actor<>approver)
);
alter table public.money_event_exclusions enable row level security;
revoke all on public.money_event_exclusions from public,anon,authenticated,service_role;
grant select on public.money_event_exclusions to service_role;
create trigger immutable_evidence before update or delete on public.money_event_exclusions for each row execute function public.money_immutable();
create function public.money_exclude_event(p_event text,p_actor uuid,p_approver uuid,p_reason text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.money_webhook_events;
begin
  perform public.money_require_finance(p_actor); perform public.money_require_finance(p_approver);
  perform public.money_require_review(p_actor,p_approver,jsonb_build_object('operation','event_exclusion','event',p_event,'reason',p_reason,'evidence',p_evidence));
  select * into strict e from public.money_webhook_events where event_id=p_event for update;
  if e.status not in ('failed','dead_letter') or exists(select 1 from public.money_journals where evidence=p_event) then raise exception 'Only failed events with no financial effects may be excluded after provider readback'; end if;
  insert into public.money_event_exclusions(event_id,actor,approver,reason,evidence) values(p_event,p_actor,p_approver,p_reason,p_evidence);
  update public.money_webhook_events set status='dead_letter',next_retry_at=null where event_id=p_event;
end $$;
revoke all on function public.money_exclude_event(text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.money_exclude_event(text,uuid,uuid,text,text) to service_role;
