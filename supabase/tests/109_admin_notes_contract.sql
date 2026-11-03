-- TRACE-136 (Phase 6.13, DEC-2026-057 item 8): contract step 20261108002000 (brief §12.5).
-- Signed-in roles read every service_requests column except notes. The new admin requests select
-- still loads (C1 × S2); the previous one is refused, closed (C0 × S2, excluded by the order).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
 ('c6130000-0000-4000-8000-000000000011','p613c-admin@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000012','p613c-home@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000013','p613c-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('c6130000-0000-4000-8000-000000000011','admin'),('c6130000-0000-4000-8000-000000000012','homeowner'),
 ('c6130000-0000-4000-8000-000000000013','vendor') on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('c6131000-0000-4000-8000-0000000000aa','Contract probe vendor',true,false,'c6130000-0000-4000-8000-000000000013');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,matching_status,description) values
 ('c6132000-0000-4000-8000-0000000000aa','c6130000-0000-4000-8000-000000000012','c6131000-0000-4000-8000-0000000000aa','house-cleaning','1 Probe St','Fort Myers','FL','33901','matched','Customer scope');
update public.service_requests set notes='LEGACY shared note' where id='c6132000-0000-4000-8000-0000000000aa';

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c6130000-0000-4000-8000-0000000000'||n||'"}',true) $$;
create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v; return coalesce(v,'<null>');
exception when others then return 'REFUSED '||sqlstate;
end $$;
grant execute on function pg_temp.val(text) to authenticated, anon;

set local role authenticated;
select pg_temp.as_user('11');
select is(pg_temp.val($q$select count(*)::text from (select id, service_type, status, address, city, state, zip_code, preferred_date, preferred_time, created_at, updated_at, customer_id, contractor_id, description, total_amount, quote_amount, assigned_at, match_expires_at, match_attempt_count, declined_contractor_ids, payment_status, needs_admin_review, matching_status, preferred_contractor_id, quote_revision, quote_status, quote_expires_at, current_quote_id, pricing_mode, pricing_inputs, frequency, scheduled_start_at, recurrence_parent_id from public.service_requests where id::text like 'c6132000-%') s$q$), '1', 'C1 x S2: new admin requests select loads');
select is(pg_temp.val($q$select count(*)::text from (select id, service_type, status, address, city, state, zip_code, preferred_date, preferred_time, created_at, updated_at, customer_id, contractor_id, description, notes, total_amount, quote_amount, assigned_at, match_expires_at, match_attempt_count, declined_contractor_ids, payment_status, needs_admin_review, matching_status, preferred_contractor_id, quote_revision, quote_status, quote_expires_at, current_quote_id, pricing_mode, pricing_inputs, frequency, scheduled_start_at, recurrence_parent_id from public.service_requests where id::text like 'c6132000-%') s$q$), 'REFUSED 42501', 'C0 x S2: previous select refused, closed (excluded by the order)');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'$q$), 'REFUSED 42501', 'admin reads notes column directly');
select is(pg_temp.val($q$select public.admin_request_notes('c6132000-0000-4000-8000-0000000000aa')->>'legacy_note'$q$), 'LEGACY shared note', 'operators read the legacy note through the readback');
select pg_temp.as_user('12');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'$q$), 'REFUSED 42501', 'homeowner reads notes');
select is(pg_temp.val($q$select count(*)::text from (select * from public.service_requests) s$q$), 'REFUSED 42501', 'homeowner broad select *');
select is(pg_temp.val($q$select address from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'$q$), '1 Probe St', 'homeowner reads own request (listed columns)');
select pg_temp.as_user('13');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'$q$), 'REFUSED 42501', 'assigned vendor reads notes');
select is(pg_temp.val($q$select address from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'$q$), '1 Probe St', 'assigned vendor reads the request (listed columns)');
reset role; set local role anon; select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(pg_temp.val($q$select notes from public.service_requests limit 1$q$), 'REFUSED 42501', 'anon reads notes');
reset role;

-- A new service_requests column without a grant fails here.
select is((select count(*)::int from information_schema.columns c where c.table_schema='public' and c.table_name='service_requests'
  and c.column_name <> 'notes' and not has_column_privilege('authenticated', 'public.service_requests', c.column_name, 'SELECT')), 0,
  'authenticated reads every service_requests column except notes');
select ok(not has_column_privilege('authenticated', 'public.service_requests', 'notes', 'SELECT'), 'authenticated cannot read notes');
select is((select notes from public.service_requests where id='c6132000-0000-4000-8000-0000000000aa'), 'LEGACY shared note', 'legacy note kept in place');

select * from finish();
rollback;
