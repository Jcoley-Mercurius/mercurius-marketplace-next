-- TRACE-089: per-IP submission limit on the public intake routes (DEC-2026-012 item 1;
-- DEC-2026-014 settles the client-IP source deferred by DEC-2026-013 item 2).
--
-- Each form accepts at most 5 submissions per client network in any rolling hour, alongside
-- the existing 3 per email address per rolling day. A network is an IPv4 address or an IPv6
-- /64 prefix; the route hashes it before calling, so the table holds no address. When the
-- route cannot establish the client IP it passes null and only the per-email limit applies.
-- Only accepted submissions are recorded, and a refusal by either limit records nothing.
--
-- The boolean two-argument function from TRACE-088 is replaced: callers now learn which
-- limit refused, for the server log. The routes never tell the sender.

alter table private.intake_submissions
  add column ip_hash text check (ip_hash ~ '^[0-9a-f]{64}$');
create index intake_submissions_ip_key_idx
  on private.intake_submissions (form, ip_hash, created_at)
  where ip_hash is not null;

drop function public.intake_record_submission(text, text);

-- Records one accepted submission and returns 'accepted', or returns 'email_limit' when the
-- email hash already has 3 submissions for this form in the last day, or 'ip_limit' when the
-- network hash already has 5 for this form in the last hour. Locks are always taken email
-- first, then network, so two calls cannot deadlock.
create function public.intake_record_submission(p_form text, p_email_hash text, p_ip_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare recent integer;
begin
  if p_form is null or p_form not in ('contact', 'vendor_application') then
    raise exception 'Unknown intake form' using errcode = '22023';
  end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid intake key' using errcode = '22023';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid intake network key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake:' || p_form || ':' || p_email_hash, 0));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('intake-ip:' || p_form || ':' || p_ip_hash, 0));
  end if;

  delete from private.intake_submissions where created_at < now() - interval '1 day';

  select count(*) into recent from private.intake_submissions
   where form = p_form and email_hash = p_email_hash and created_at >= now() - interval '1 day';
  if recent >= 3 then
    return 'email_limit';
  end if;

  if p_ip_hash is not null then
    select count(*) into recent from private.intake_submissions
     where form = p_form and ip_hash = p_ip_hash and created_at >= now() - interval '1 hour';
    if recent >= 5 then
      return 'ip_limit';
    end if;
  end if;

  insert into private.intake_submissions (form, email_hash, ip_hash)
    values (p_form, p_email_hash, p_ip_hash);
  return 'accepted';
end $$;

revoke all on function public.intake_record_submission(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.intake_record_submission(text, text, text) to service_role;
