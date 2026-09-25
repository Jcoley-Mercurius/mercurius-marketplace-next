-- TRACE-088: per-email submission limits on the public intake routes (owner decisions
-- 2026-09-24, DEC-2026-012 item 1 as amended by DEC-2026-013).
--
-- The vendor application route and the contact route (used by /contact and /request) each
-- accept at most 3 submissions per email address in any rolling day, counted separately for
-- each form. Only accepted submissions are recorded. The routes hash the normalized email
-- before calling, so the table holds no email address. The per-IP limit is deferred until the
-- production domain's proxy path is known (DEC-2026-013); a later additive migration adds it.
--
-- The counters live in the private schema, which the API does not expose. No client role and
-- not even the service key can read or write the table directly; the routes use the service
-- key to call one function that locks the key, prunes rows older than a day, counts and
-- records in a single transaction, so two parallel submissions cannot both take the last slot.

create table private.intake_submissions (
  id bigint generated always as identity primary key,
  form text not null check (form in ('contact', 'vendor_application')),
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index intake_submissions_key_idx
  on private.intake_submissions (form, email_hash, created_at);
create index intake_submissions_created_at_idx
  on private.intake_submissions (created_at);

alter table private.intake_submissions enable row level security;
revoke all on private.intake_submissions from public, anon, authenticated, service_role;

-- Records one accepted submission and returns true, or returns false when the email hash
-- already has 3 submissions for this form in the last day.
create function public.intake_record_submission(p_form text, p_email_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare recent integer;
begin
  if p_form is null or p_form not in ('contact', 'vendor_application') then
    raise exception 'Unknown intake form' using errcode = '22023';
  end if;
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid intake key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('intake:' || p_form || ':' || p_email_hash, 0));

  delete from private.intake_submissions where created_at < now() - interval '1 day';

  select count(*) into recent from private.intake_submissions
   where form = p_form and email_hash = p_email_hash and created_at >= now() - interval '1 day';
  if recent >= 3 then
    return false;
  end if;

  insert into private.intake_submissions (form, email_hash) values (p_form, p_email_hash);
  return true;
end $$;

revoke all on function public.intake_record_submission(text, text) from public, anon, authenticated, service_role;
grant execute on function public.intake_record_submission(text, text) to service_role;
