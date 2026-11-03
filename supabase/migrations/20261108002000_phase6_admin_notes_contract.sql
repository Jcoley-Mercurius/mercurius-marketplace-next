-- Phase 6.13 / TRACE-136, DEC-2026-057 item 8 (correction 1). Contract step of the expand/contract
-- release (brief §12.5). Push only after the client from PR #132 is the production deployment
-- and the earlier client is no longer a rollback target: the earlier admin requests page selects
-- service_requests.notes and would fail to load (closed, nothing disclosed) against this schema.
--
-- Signed-in roles read every service_requests column except notes. Writes were closed by the
-- expand migration 20261108001000. Historical values stay in the column, unchanged, readable by
-- operators only through admin_request_notes. Privilege-only: no table, column or value changes.
-- A new service_requests column added after this needs an explicit column grant (SQL 109).
revoke select on public.service_requests from authenticated;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'service_requests' and column_name <> 'notes';
  execute format('grant select (%s) on public.service_requests to authenticated', cols);
end $$;
