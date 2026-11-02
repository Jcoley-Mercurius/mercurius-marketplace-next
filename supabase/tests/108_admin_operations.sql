-- TRACE-136 (Phase 6.13, DEC-2026-057): admin operations closures and commands. Generated from
-- governance/review-evidence/trace-136-admin-bypass.sql (same fixtures and expectations) plus grant,
-- summary-parity and replay checks.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Fixtures (as owner). Replica mode skips FK checks for the onboarding row only.
insert into auth.users(id,email,email_confirmed_at) values
 ('c6130000-0000-4000-8000-000000000001','p613-admin@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000002','p613-home@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000003','p613-vendor@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000004','p613-home-b@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000005','p613-dual@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('c6130000-0000-4000-8000-000000000001','admin'),('c6130000-0000-4000-8000-000000000002','homeowner'),
 ('c6130000-0000-4000-8000-000000000003','vendor'),('c6130000-0000-4000-8000-000000000004','homeowner'),
 ('c6130000-0000-4000-8000-000000000005','admin'),('c6130000-0000-4000-8000-000000000005','homeowner')
 on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('c6131000-0000-4000-8000-00000000000a','Probe vendor',true,false,'c6130000-0000-4000-8000-000000000003'),
 ('c6131000-0000-4000-8000-00000000000b','Probe onboarded',true,false,null),
 ('c6131000-0000-4000-8000-00000000000c','Probe legacy',true,false,null);
set local session_replication_role = replica;
insert into public.vendor_onboarding(contractor_id,application_version_id,status) values
 ('c6131000-0000-4000-8000-00000000000b',gen_random_uuid(),'active');
set local session_replication_role = origin;
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,matching_status,description) values
 ('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','house-cleaning','1 Probe St','Fort Myers','FL','33901','matched','Customer scope'),
 ('c6132000-0000-4000-8000-000000000002','c6130000-0000-4000-8000-000000000002',null,'house-cleaning','3 Probe St','Fort Myers','FL','33901','awaiting_match','Unbound scope'),
 ('c6132000-0000-4000-8000-000000000003','c6130000-0000-4000-8000-000000000005',null,'house-cleaning','5 Probe St','Fort Myers','FL','33901','awaiting_match','Dual-role own request');
update public.service_requests set notes='LEGACY shared note' where id='c6132000-0000-4000-8000-000000000001';
insert into public.invoices(id,invoice_number,customer_id,contractor_id,service_request_id,amount,platform_fee,vendor_payout,status) values
 ('c6134000-0000-4000-8000-000000000009','P613-SEED','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','c6132000-0000-4000-8000-000000000001',100,15,85,'pending');
insert into public.disputes(id,job_id,homeowner_id,vendor_id,reason,status) values
 ('c6133000-0000-4000-8000-000000000001','c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','probe','open');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,is_active,needs_review) values
 ('c6135000-0000-4000-8000-000000000001','c6131000-0000-4000-8000-00000000000a','house-cleaning','Probe package','custom_quote',false,true);
update public.vendor_packages set needs_review=true where id='c6135000-0000-4000-8000-000000000001';

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c6130000-0000-4000-8000-00000000000'||n||'"}',true) $$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  return 'ALLOWED rows='||n;
exception when others then return 'REFUSED '||sqlstate;
end $$;
create function pg_temp.val(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt into v; return coalesce(v,'<null>');
exception when others then return 'REFUSED '||sqlstate;
end $$;
grant execute on function pg_temp.try(text), pg_temp.val(text) to authenticated, anon;

set local role authenticated;
-- Admin without finance authority: direct API writes.
select pg_temp.as_user('1');
select is(pg_temp.try($q$insert into public.invoices(invoice_number,customer_id,amount,status) values('P613-1','c6130000-0000-4000-8000-000000000002',400,'paid')$q$), 'REFUSED 42501', 'A1 invoices insert paid');
select is(pg_temp.try($q$update public.invoices set vendor_payout=9999, status='released' where id='c6134000-0000-4000-8000-000000000009'$q$), 'REFUSED 42501', 'A2 invoices update payout/released');
select is(pg_temp.try($q$delete from public.invoices where id='c6134000-0000-4000-8000-000000000009'$q$), 'REFUSED 42501', 'A16 invoices delete');
select is(pg_temp.try($q$update public.contractors set payouts_paused=true, payouts_paused_reason='probe' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'A3 contractors payouts_paused');
select is(pg_temp.try($q$update public.contractors set rating=4.9 where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'A4 contractors rating');
select is(pg_temp.try($q$update public.contractors set jobs_completed=99 where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'A4b contractors jobs_completed');
select is(pg_temp.try($q$update public.contractors set badges=array['Top Rated'] where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'A4c contractors badges direct');
select is(pg_temp.try($q$update public.contractors set user_id='c6130000-0000-4000-8000-000000000004' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'A5 contractors user_id reassigned');
select is(pg_temp.try($q$insert into public.contractors(name,user_id) values('Probe linked','c6130000-0000-4000-8000-000000000004')$q$), 'REFUSED 42501', 'A5b contractors insert with user_id');
select is(pg_temp.try($q$insert into public.contractors(name,is_active) values('Probe new',true)$q$), 'ALLOWED rows=1', 'A5c contractors insert unlinked (legacy create)');
select is(pg_temp.try($q$update public.contractors set is_active=false where id='c6131000-0000-4000-8000-00000000000b'$q$), 'REFUSED 42501', 'A20 is_active on onboarded provider');
select is(pg_temp.try($q$update public.contractors set is_active=false where id='c6131000-0000-4000-8000-00000000000c'$q$), 'ALLOWED rows=1', 'A20b is_active on legacy provider (gap kept)');
select is(pg_temp.try($q$update public.contractors set tagline='Probe tagline' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'ALLOWED rows=1', 'A20c profile text edit still saves');
select is(pg_temp.try($q$insert into public.coverage_areas(zip_code,city,state,is_active) values('99999','Nowhere','ZZ',true)$q$), 'REFUSED 42501', 'A6 coverage insert');
select is(pg_temp.try($q$update public.coverage_areas set is_active=false where zip_code='33901'$q$), 'REFUSED 42501', 'A7 coverage deactivate');
select is(pg_temp.try($q$delete from public.coverage_areas where zip_code='33901'$q$), 'REFUSED 42501', 'A8 coverage delete');
select is(pg_temp.try($q$update public.services_catalog set pricing_mode=case when pricing_mode='quote' then 'fixed' else 'quote' end where id='house-cleaning'$q$), 'REFUSED 23514', 'A9 catalog pricing_mode');
select is(pg_temp.try($q$update public.services_catalog set is_active=false where id='house-cleaning'$q$), 'REFUSED 42501', 'A18 catalog is_active direct');
select is(pg_temp.try($q$update public.services_catalog set is_popular = not is_popular where id='house-cleaning'$q$), 'ALLOWED rows=1', 'A18b catalog is_popular direct (unchanged)');
select is(pg_temp.try($q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-rated','c6131000-0000-4000-8000-00000000000a')$q$), 'REFUSED 42501', 'A10 smart_picks insert');
select is(pg_temp.try($q$select 1 from public.smart_picks$q$), 'REFUSED 42501', 'A10b smart_picks read');
select is(pg_temp.try($q$update public.disputes set status='resolved' where id='c6133000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A11 disputes direct status');
select is(pg_temp.try($q$select public.admin_resolve_dispute('c6133000-0000-4000-8000-000000000001','resolved','probe')$q$), 'REFUSED 42501', 'A17 legacy admin_resolve_dispute');
select is(pg_temp.try($q$update public.service_requests set notes='INTERNAL probe' where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A12 service_requests notes write');
select is(pg_temp.try($q$update public.service_requests set address='2 Changed St' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501', 'A13 address write');
select is(pg_temp.try($q$update public.service_requests set description='changed' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501', 'A13b description write');
select is(pg_temp.try($q$update public.service_requests set zip_code='33902' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501', 'A13c zip write');
select is(pg_temp.try($q$update public.service_requests set status='completed' where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A14 lifecycle status direct');
select is(pg_temp.try($q$delete from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A15 request delete');
select is(pg_temp.try($q$update public.vendor_packages set needs_review=false where id='c6135000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A19 package needs_review direct');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','homeowner','spoof')$q$), 'REFUSED 42501', 'A21 admin message as homeowner sender_id');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000001','admin','Support reply')$q$), 'ALLOWED rows=1', 'A22 admin message as admin');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'A23 admin reads notes column directly');
select is(pg_temp.val($q$select public.admin_request_notes('c6132000-0000-4000-8000-000000000001')->>'legacy_note'$q$), 'LEGACY shared note', 'A24 admin legacy note readback');
select is(pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Operator-only probe')->>'replayed'$q$), 'false', 'N1 add operator note');
select is(pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Operator-only probe')->>'replayed'$q$), 'true', 'N2 replay same key');
select is(pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Changed')::text$q$), 'REFUSED 22023', 'N3 same key, different text');
select is(pg_temp.val($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000002','cancelled','probe')::text$q$), 'REFUSED 40001', 'S1 status change, stale version');
select is(pg_temp.val($q$select (public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000002'),'c6136000-0000-4000-8000-000000000003','4 Probe St','Fort Myers','FL','33901','Corrected scope','Homeowner called with the right address')->'after'->>'address')$q$), '4 Probe St', 'C1 correction before offer');
select is(pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000003','4 Probe St','Fort Myers','FL','33901','Corrected scope','Homeowner called with the right address')->>'replayed'$q$), 'true', 'C2 correction replay');
select is(pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000004','6 Probe St','Fort Myers','FL','33901','x','x')::text$q$), 'REFUSED 40001', 'C3 correction, stale version (new key)');
select is(pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000001',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000001'),'c6136000-0000-4000-8000-000000000005','7 Probe St','Fort Myers','FL','33901','x','x')::text$q$), 'REFUSED 55000', 'C4 correction after match');
select is(pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000002'),'c6136000-0000-4000-8000-000000000006','4 Probe St','Miami','FL','33101','x','x')::text$q$), 'REFUSED 22023', 'C5 correction to an uncovered ZIP');
select is(pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a',array['Insured'],array['Licensed'],'probe','c6136000-0000-4000-8000-000000000007')::text$q$), 'REFUSED 40001', 'G1 badges, stale expectation');
select is(pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a','{}',array['Licensed'],'License verified','c6136000-0000-4000-8000-000000000008')->>'replayed'$q$), 'false', 'G2 badges with reason');
select is(pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a','{}',array['Licensed'],'License verified','c6136000-0000-4000-8000-000000000008')->>'replayed'$q$), 'true', 'G3 badges replay');
select is(pg_temp.val($q$select public.admin_set_catalog_service_visibility('house-cleaning',true,false,'probe',null,'c6136000-0000-4000-8000-000000000009')::text$q$), 'REFUSED 22023', 'K1 hide service without owner approval');
select is(pg_temp.val($q$select public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001',(select updated_at from public.vendor_packages where id='c6135000-0000-4000-8000-000000000001'),' ')::text$q$), 'REFUSED 22023', 'P1 clear package review without reason');
select is(pg_temp.val($q$select public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001','2000-01-01','Reviewed')::text$q$), 'REFUSED 40001', 'P2 clear package review, stale');
select is(pg_temp.val($q$select (public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001',(select updated_at from public.vendor_packages where id='c6135000-0000-4000-8000-000000000001'),'Quote-only package reviewed')->>'package_id')$q$), 'c6135000-0000-4000-8000-000000000001', 'P3 clear package review with reason');
select is(pg_temp.val($q$select q->>'state' from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'queue'='finance_exceptions'$q$), 'restricted', 'Q1 summary finance row (no authority)');
select is(pg_temp.val($q$select ((select (q->>'count')::int from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'queue'='quote') = jsonb_array_length(public.admin_quote_queue()->'items'))::text$q$), 'true', 'Q2 summary quote count = queue count');

-- Homeowner A.
select pg_temp.as_user('2');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'H1 homeowner reads notes');
select is(pg_temp.val($q$select count(*)::text from (select * from public.service_requests) s$q$), 'REFUSED 42501', 'H1b homeowner broad select *');
select is(pg_temp.val($q$select count(*)::text from public.service_requests where customer_id='c6130000-0000-4000-8000-000000000002'$q$), '2', 'H1c homeowner reads own request (listed columns)');
select is(pg_temp.val($q$select public.admin_request_notes('c6132000-0000-4000-8000-000000000001')::text$q$), 'REFUSED 42501', 'H1d homeowner operator-note readback');
select is(pg_temp.val($q$select count(*)::text from private.request_operator_notes$q$), 'REFUSED 42501', 'H1e homeowner reads operator-note table');
select is(pg_temp.val($q$select count(*)::text from public.invoices where customer_id='c6130000-0000-4000-8000-000000000002'$q$), '1', 'H2 homeowner still sees own invoice');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','admin','spoof')$q$), 'REFUSED 42501', 'H5 homeowner posts as admin');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','vendor','spoof')$q$), 'REFUSED 42501', 'H6 homeowner posts as vendor');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','homeowner','Hello')$q$), 'ALLOWED rows=1', 'H7 homeowner posts as homeowner');
select is(pg_temp.try($q$update public.service_requests set description='mine' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501', 'H8 homeowner edits description directly (pending)');
select is(pg_temp.val($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000002',now(),gen_random_uuid(),'cancelled','x')::text$q$), 'REFUSED 42501', 'H9 homeowner status-change command');
select is(pg_temp.val($q$select public.admin_operations_summary()::text$q$), 'REFUSED 42501', 'H10 homeowner operations summary');
select is(pg_temp.try($q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-value','c6131000-0000-4000-8000-00000000000a')$q$), 'REFUSED 42501', 'H3 homeowner smart_picks insert');
select is(pg_temp.try($q$insert into public.coverage_areas(zip_code,city,state) values('99998','X','ZZ')$q$), 'REFUSED 42501', 'H4 homeowner coverage insert');

-- Vendor A (assigned to request 1).
select pg_temp.as_user('3');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501', 'V1 vendor reads notes');
select is(pg_temp.val($q$select address from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), '1 Probe St', 'V1b vendor reads assigned request (listed columns)');
select is(pg_temp.try($q$update public.contractors set payouts_paused=true where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'V2 vendor payouts_paused=true');
select is(pg_temp.try($q$update public.invoices set vendor_payout=1 where contractor_id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501', 'V3 vendor invoices update');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000003','vendor','On my way')$q$), 'ALLOWED rows=1', 'V4 vendor posts as vendor');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000003','homeowner','spoof')$q$), 'REFUSED 42501', 'V5 vendor posts as homeowner');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000002','c6130000-0000-4000-8000-000000000003','vendor','x')$q$), 'REFUSED 42501', 'V6 vendor posts on unassigned request');

-- Dual-role account (admin + homeowner).
select pg_temp.as_user('5');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000003','c6130000-0000-4000-8000-000000000005','homeowner','Mine')$q$), 'ALLOWED rows=1', 'D1 dual posts as homeowner on own request');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','admin','Support')$q$), 'ALLOWED rows=1', 'D2 dual posts as admin on another request');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','homeowner','x')$q$), 'REFUSED 42501', 'D3 dual posts as homeowner on another''s request');
select is(pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','vendor','x')$q$), 'REFUSED 42501', 'D4 dual posts as vendor');
select is(pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000003'$q$), 'REFUSED 42501', 'D5 dual reads notes on own request');

-- Homeowner B.
select pg_temp.as_user('4');
select is(pg_temp.val($q$select count(*)::text from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), '0', 'B1 homeowner B reads A''s request');

-- Anonymous.
reset role; set local role anon; select set_config('request.jwt.claims','{"role":"anon"}',true);
select is(pg_temp.try($q$select 1 from public.smart_picks$q$), 'REFUSED 42501', 'Z1 anon reads smart_picks');
select is(pg_temp.val($q$select notes from public.service_requests limit 1$q$), 'REFUSED 42501', 'Z2 anon reads notes');

reset role;
select is((select status||' payout='||vendor_payout from public.invoices where id='c6134000-0000-4000-8000-000000000009'), 'pending payout=85.00', 'X1 seeded invoice unchanged');
select is((select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'), 'LEGACY shared note', 'X2 legacy note kept in place');
select is((select changes->0->>'kind'||' / '||reason from private.vendor_package_price_corrections where package_id='c6135000-0000-4000-8000-000000000001'), 'review_cleared / Quote-only package reviewed', 'X3 vendor-visible review history');
select is((select count(*)::text from private.admin_request_actions where request_id='c6132000-0000-4000-8000-000000000002'), '1', 'X4 correction history row');
select is((select before_badges::text||'->'||after_badges::text from private.provider_badge_events where contractor_id='c6131000-0000-4000-8000-00000000000a'), '{}->{Licensed}', 'X5 badge history row');
select is((select user_id::text from public.contractors where id='c6131000-0000-4000-8000-00000000000a'), 'c6130000-0000-4000-8000-000000000003', 'X6 provider owner unchanged');

-- Column grants: signed-in roles read every service_requests column except notes, and write
-- none of notes, address, ZIP or description. A new column without a grant fails here.
select is((select count(*)::int from information_schema.columns c where c.table_schema='public' and c.table_name='service_requests'
  and c.column_name <> 'notes' and not has_column_privilege('authenticated', 'public.service_requests', c.column_name, 'SELECT')), 0,
  'authenticated reads every service_requests column except notes');
select ok(not has_column_privilege('authenticated', 'public.service_requests', 'notes', 'SELECT'), 'authenticated cannot read notes');
select ok(not has_column_privilege('anon', 'public.service_requests', 'notes', 'SELECT'), 'anon cannot read notes');
select is((select array_agg(c order by c) from unnest(array['notes','address','city','state','zip_code','description','status']) c
  where has_column_privilege('authenticated', 'public.service_requests', c, 'UPDATE')), null, 'authenticated updates none of the protected request columns');
select ok(not has_table_privilege('authenticated', 'public.invoices', 'INSERT') and not has_table_privilege('authenticated', 'public.invoices', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invoices', 'DELETE') and has_table_privilege('authenticated', 'public.invoices', 'SELECT'),
  'invoices: read kept, client writes closed');
select ok(not has_table_privilege('authenticated', 'public.coverage_areas', 'INSERT') and not has_table_privilege('authenticated', 'public.coverage_areas', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.coverage_areas', 'DELETE') and has_table_privilege('anon', 'public.coverage_areas', 'SELECT'),
  'coverage: read kept, client writes closed');
select ok(not has_table_privilege('anon', 'public.smart_picks', 'SELECT') and not has_table_privilege('authenticated', 'public.smart_picks', 'SELECT'), 'smart_picks: no client access');
select ok(not has_function_privilege('authenticated', 'public.admin_resolve_dispute(uuid, public.dispute_status, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.admin_resolve_dispute(uuid, public.dispute_status, text)', 'EXECUTE'), 'legacy dispute decision closed to clients');
select ok(has_function_privilege('authenticated', 'public.admin_decide_dispute(uuid, uuid, public.dispute_status, integer, public.dispute_status, text)', 'EXECUTE'), 'keyed dispute decision kept');
select is((select count(*)::int from pg_proc p where p.proname in ('admin_add_request_note','admin_request_notes','admin_set_provider_badges','admin_provider_badge_history',
  'admin_set_catalog_service_visibility','admin_catalog_visibility_history','admin_transition_job_status_expected','admin_correct_request_details',
  'admin_request_action_history','admin_clear_package_review','admin_operations_summary','admin_provider_is_onboarded')
  and p.pronamespace='public'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'no new command is executable by anon');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'private history tables stay unreachable');
select throws_ok($$update private.request_operator_notes set body = 'x'$$, '42501', 'Operator notes are append-only', 'operator notes cannot be edited even by the owner');
select throws_ok($$delete from private.request_operator_notes$$, '42501', 'Operator notes are append-only', 'operator notes cannot be deleted even by the owner');

-- Summary parity: every ready queue count equals its queue function, in the same transaction.
set local role authenticated;
select pg_temp.as_user('1');
select is((select count(*)::int from jsonb_array_elements(public.admin_operations_summary()->'queues') q where
  q->>'state' = 'ready' and (q->>'count')::int <> jsonb_array_length(coalesce(case q->>'queue'
    when 'quote' then public.admin_quote_queue()->'items' when 'recurring_payment' then public.admin_recurring_payment_queue()->'items'
    when 'fulfillment' then public.admin_fulfillment_queue()->'items' when 'cancellation' then public.admin_cancellation_queue()->'items'
    when 'support' then public.admin_support_queue(false)->'items' when 'compliance_renewal' then public.vendor_evidence_renewal_queue()->'entries'
    when 'renewal_documents' then public.vendor_renewal_document_queue()->'entries' end, '[]'::jsonb))), 0, 'every summarized count equals its queue');
select is((select count(*)::int from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'state' = 'error'), 0, 'no summarized queue errors');
-- Status change: version-bound, keyed replay, changed payload refused, one history row.
select lives_ok($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000001',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000001'),'c6136000-0000-4000-8000-0000000000b1','matched','Synthetic: provider confirmed by phone')$q$, 'status change on the version read');
select is(public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000001','2000-01-01','c6136000-0000-4000-8000-0000000000b1','matched','Synthetic: provider confirmed by phone')->>'replayed', 'true', 'same key and payload replays');
select throws_ok($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000001','2000-01-01','c6136000-0000-4000-8000-0000000000b1','scheduled','other')$q$, '22023', null, 'same key, different payload refused');
reset role;
select is((select count(*)::int from private.admin_request_actions where request_key='c6136000-0000-4000-8000-0000000000b1'), 1, 'one recorded status action');
select is((select status::text from public.service_requests where id='c6132000-0000-4000-8000-000000000001'), 'matched', 'the change applied once');

select * from finish();
rollback;
