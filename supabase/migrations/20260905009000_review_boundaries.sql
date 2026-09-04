-- TRACE-050/053: restrict review metadata and permit revocation before provider submission.
revoke select on public.money_snapshots, public.money_checkout_attempts from authenticated;
grant select (id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,policy_version,promotion_terms,expires_at,created_at)
  on public.money_snapshots to authenticated;
grant select (id,obligation_id,snapshot_id,customer_id,mode,attempt_number,amount,currency,stripe_session_id,checkout_url,status,expires_at,created_at,completed_at)
  on public.money_checkout_attempts to authenticated;
-- policy_version is displayed with the homeowner invoice. Internal author/reviewer/reason/tax evidence stays private.
create or replace function public.vendor_record_invitation(p_attempt uuid,p_status text,p_ref text,p_evidence text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.vendor_invitation_attempts;
begin
  actor:=public.vendor_require_operator();
  select * into strict a from public.vendor_invitation_attempts where id=p_attempt for update;
  if not ((a.status='prepared' and p_status in ('submitted','revoked'))
    or (a.status in ('submitted','unknown') and p_status in ('unknown','delivered','failed','revoked'))
    or (a.status='delivered' and p_status in ('accepted','expired','revoked')))
    then raise exception 'Invalid invitation transition'; end if;
  if p_status='accepted' and a.expires_at<=now() then raise exception 'Invitation expired'; end if;
  if p_status='expired' and a.expires_at>now() then raise exception 'Invitation not expired'; end if;
  if not (a.status='prepared' and p_status='revoked') and (p_ref is null or length(trim(p_ref))=0) then raise exception 'Invitation provider reference required'; end if;
  if a.provider_reference is not null and a.provider_reference<>p_ref then raise exception 'Invitation reference conflict'; end if;
  insert into public.vendor_invitation_events(attempt_id,previous_status,status,evidence,actor) values(a.id,a.status,p_status,p_evidence,actor);
  update public.vendor_invitation_attempts set status=p_status,provider_reference=p_ref where id=a.id;
  -- Accepted invite is identity delivery evidence, not vendor activation or a role grant.
end $$;
