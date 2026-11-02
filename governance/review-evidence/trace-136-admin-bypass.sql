-- TRACE-136 (Phase 6.13) bypass probes. Synthetic users, single transaction, ROLLBACK.
-- Run: psql -h 127.0.0.1 -p 55422 -U postgres -d postgres -X -A -t -f governance/review-evidence/trace-136-admin-bypass.sql
-- Each line prints the probe, the result and the expectation after migration 20261108001000, and
-- MATCH or DIFF. Before that migration (characterization, 2026-11-02) the same probes showed the
-- bypasses recorded in the brief §6.1 (the "before" column there).
begin;
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
create temp table out(n serial, label text, got text, expect text); grant all on out to authenticated, anon; grant all on sequence out_n_seq to authenticated, anon;
create function pg_temp.p(label text, got text, expect text) returns void language sql as $$ insert into out(label,got,expect) values(label,got,expect) $$;
grant execute on function pg_temp.p(text,text,text) to authenticated, anon;

set local role authenticated;
-- Admin without finance authority: direct API writes.
select pg_temp.as_user('1');
select pg_temp.p('A1 invoices insert paid', pg_temp.try($q$insert into public.invoices(invoice_number,customer_id,amount,status) values('P613-1','c6130000-0000-4000-8000-000000000002',400,'paid')$q$), 'REFUSED 42501');
select pg_temp.p('A2 invoices update payout/released', pg_temp.try($q$update public.invoices set vendor_payout=9999, status='released' where id='c6134000-0000-4000-8000-000000000009'$q$), 'REFUSED 42501');
select pg_temp.p('A16 invoices delete', pg_temp.try($q$delete from public.invoices where id='c6134000-0000-4000-8000-000000000009'$q$), 'REFUSED 42501');
select pg_temp.p('A3 contractors payouts_paused', pg_temp.try($q$update public.contractors set payouts_paused=true, payouts_paused_reason='probe' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('A4 contractors rating', pg_temp.try($q$update public.contractors set rating=4.9 where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('A4b contractors jobs_completed', pg_temp.try($q$update public.contractors set jobs_completed=99 where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('A4c contractors badges direct', pg_temp.try($q$update public.contractors set badges=array['Top Rated'] where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('A5 contractors user_id reassigned', pg_temp.try($q$update public.contractors set user_id='c6130000-0000-4000-8000-000000000004' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('A5b contractors insert with user_id', pg_temp.try($q$insert into public.contractors(name,user_id) values('Probe linked','c6130000-0000-4000-8000-000000000004')$q$), 'REFUSED 42501');
select pg_temp.p('A5c contractors insert unlinked (legacy create)', pg_temp.try($q$insert into public.contractors(name,is_active) values('Probe new',true)$q$), 'ALLOWED rows=1');
select pg_temp.p('A20 is_active on onboarded provider', pg_temp.try($q$update public.contractors set is_active=false where id='c6131000-0000-4000-8000-00000000000b'$q$), 'REFUSED 42501');
select pg_temp.p('A20b is_active on legacy provider (gap kept)', pg_temp.try($q$update public.contractors set is_active=false where id='c6131000-0000-4000-8000-00000000000c'$q$), 'ALLOWED rows=1');
select pg_temp.p('A20c profile text edit still saves', pg_temp.try($q$update public.contractors set tagline='Probe tagline' where id='c6131000-0000-4000-8000-00000000000a'$q$), 'ALLOWED rows=1');
select pg_temp.p('A6 coverage insert', pg_temp.try($q$insert into public.coverage_areas(zip_code,city,state,is_active) values('99999','Nowhere','ZZ',true)$q$), 'REFUSED 42501');
select pg_temp.p('A7 coverage deactivate', pg_temp.try($q$update public.coverage_areas set is_active=false where zip_code='33901'$q$), 'REFUSED 42501');
select pg_temp.p('A8 coverage delete', pg_temp.try($q$delete from public.coverage_areas where zip_code='33901'$q$), 'REFUSED 42501');
select pg_temp.p('A9 catalog pricing_mode', pg_temp.try($q$update public.services_catalog set pricing_mode=case when pricing_mode='quote' then 'fixed' else 'quote' end where id='house-cleaning'$q$), 'REFUSED 23514');
select pg_temp.p('A18 catalog is_active direct', pg_temp.try($q$update public.services_catalog set is_active=false where id='house-cleaning'$q$), 'REFUSED 42501');
select pg_temp.p('A18b catalog is_popular direct (unchanged)', pg_temp.try($q$update public.services_catalog set is_popular = not is_popular where id='house-cleaning'$q$), 'ALLOWED rows=1');
select pg_temp.p('A10 smart_picks insert', pg_temp.try($q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-rated','c6131000-0000-4000-8000-00000000000a')$q$), 'REFUSED 42501');
select pg_temp.p('A10b smart_picks read', pg_temp.try($q$select 1 from public.smart_picks$q$), 'REFUSED 42501');
select pg_temp.p('A11 disputes direct status', pg_temp.try($q$update public.disputes set status='resolved' where id='c6133000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A17 legacy admin_resolve_dispute', pg_temp.try($q$select public.admin_resolve_dispute('c6133000-0000-4000-8000-000000000001','resolved','probe')$q$), 'REFUSED 42501');
select pg_temp.p('A12 service_requests notes write', pg_temp.try($q$update public.service_requests set notes='INTERNAL probe' where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A13 address write', pg_temp.try($q$update public.service_requests set address='2 Changed St' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501');
select pg_temp.p('A13b description write', pg_temp.try($q$update public.service_requests set description='changed' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501');
select pg_temp.p('A13c zip write', pg_temp.try($q$update public.service_requests set zip_code='33902' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501');
select pg_temp.p('A14 lifecycle status direct', pg_temp.try($q$update public.service_requests set status='completed' where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A15 request delete', pg_temp.try($q$delete from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A19 package needs_review direct', pg_temp.try($q$update public.vendor_packages set needs_review=false where id='c6135000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A21 admin message as homeowner sender_id', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','homeowner','spoof')$q$), 'REFUSED 42501');
select pg_temp.p('A22 admin message as admin', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000001','admin','Support reply')$q$), 'ALLOWED rows=1');
select pg_temp.p('A23 admin reads notes column directly', pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('A24 admin legacy note readback', pg_temp.val($q$select public.admin_request_notes('c6132000-0000-4000-8000-000000000001')->>'legacy_note'$q$), 'LEGACY shared note');
select pg_temp.p('N1 add operator note', pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Operator-only probe')->>'replayed'$q$), 'false');
select pg_temp.p('N2 replay same key', pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Operator-only probe')->>'replayed'$q$), 'true');
select pg_temp.p('N3 same key, different text', pg_temp.val($q$select public.admin_add_request_note('c6132000-0000-4000-8000-000000000001','c6136000-0000-4000-8000-000000000001','Changed')::text$q$), 'REFUSED 22023');
select pg_temp.p('S1 status change, stale version', pg_temp.val($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000002','cancelled','probe')::text$q$), 'REFUSED 40001');
select pg_temp.p('C1 correction before offer', pg_temp.val($q$select (public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000002'),'c6136000-0000-4000-8000-000000000003','4 Probe St','Fort Myers','FL','33901','Corrected scope','Homeowner called with the right address')->'after'->>'address')$q$), '4 Probe St');
select pg_temp.p('C2 correction replay', pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000003','4 Probe St','Fort Myers','FL','33901','Corrected scope','Homeowner called with the right address')->>'replayed'$q$), 'true');
select pg_temp.p('C3 correction, stale version (new key)', pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002','2000-01-01','c6136000-0000-4000-8000-000000000004','6 Probe St','Fort Myers','FL','33901','x','x')::text$q$), 'REFUSED 40001');
select pg_temp.p('C4 correction after match', pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000001',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000001'),'c6136000-0000-4000-8000-000000000005','7 Probe St','Fort Myers','FL','33901','x','x')::text$q$), 'REFUSED 55000');
select pg_temp.p('C5 correction to an uncovered ZIP', pg_temp.val($q$select public.admin_correct_request_details('c6132000-0000-4000-8000-000000000002',(select updated_at from public.service_requests where id='c6132000-0000-4000-8000-000000000002'),'c6136000-0000-4000-8000-000000000006','4 Probe St','Miami','FL','33101','x','x')::text$q$), 'REFUSED 22023');
select pg_temp.p('G1 badges, stale expectation', pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a',array['Insured'],array['Licensed'],'probe','c6136000-0000-4000-8000-000000000007')::text$q$), 'REFUSED 40001');
select pg_temp.p('G2 badges with reason', pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a','{}',array['Licensed'],'License verified','c6136000-0000-4000-8000-000000000008')->>'replayed'$q$), 'false');
select pg_temp.p('G3 badges replay', pg_temp.val($q$select public.admin_set_provider_badges('c6131000-0000-4000-8000-00000000000a','{}',array['Licensed'],'License verified','c6136000-0000-4000-8000-000000000008')->>'replayed'$q$), 'true');
select pg_temp.p('K1 hide service without owner approval', pg_temp.val($q$select public.admin_set_catalog_service_visibility('house-cleaning',true,false,'probe',null,'c6136000-0000-4000-8000-000000000009')::text$q$), 'REFUSED 22023');
select pg_temp.p('P1 clear package review without reason', pg_temp.val($q$select public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001',(select updated_at from public.vendor_packages where id='c6135000-0000-4000-8000-000000000001'),' ')::text$q$), 'REFUSED 22023');
select pg_temp.p('P2 clear package review, stale', pg_temp.val($q$select public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001','2000-01-01','Reviewed')::text$q$), 'REFUSED 40001');
select pg_temp.p('P3 clear package review with reason', pg_temp.val($q$select (public.admin_clear_package_review('c6135000-0000-4000-8000-000000000001',(select updated_at from public.vendor_packages where id='c6135000-0000-4000-8000-000000000001'),'Quote-only package reviewed')->>'package_id')$q$), 'c6135000-0000-4000-8000-000000000001');
select pg_temp.p('Q1 summary finance row (no authority)', pg_temp.val($q$select q->>'state' from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'queue'='finance_exceptions'$q$), 'restricted');
select pg_temp.p('Q2 summary quote count = queue count', pg_temp.val($q$select ((select (q->>'count')::int from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'queue'='quote') = jsonb_array_length(public.admin_quote_queue()->'items'))::text$q$), 'true');

-- Homeowner A.
select pg_temp.as_user('2');
select pg_temp.p('H1 homeowner reads notes', pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('H1b homeowner broad select *', pg_temp.val($q$select count(*)::text from (select * from public.service_requests) s$q$), 'REFUSED 42501');
select pg_temp.p('H1c homeowner reads own request (listed columns)', pg_temp.val($q$select count(*)::text from public.service_requests where customer_id='c6130000-0000-4000-8000-000000000002'$q$), '2');
select pg_temp.p('H1d homeowner operator-note readback', pg_temp.val($q$select public.admin_request_notes('c6132000-0000-4000-8000-000000000001')::text$q$), 'REFUSED 42501');
select pg_temp.p('H1e homeowner reads operator-note table', pg_temp.val($q$select count(*)::text from private.request_operator_notes$q$), 'REFUSED 42501');
select pg_temp.p('H2 homeowner still sees own invoice', pg_temp.val($q$select count(*)::text from public.invoices where customer_id='c6130000-0000-4000-8000-000000000002'$q$), '1');
select pg_temp.p('H5 homeowner posts as admin', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','admin','spoof')$q$), 'REFUSED 42501');
select pg_temp.p('H6 homeowner posts as vendor', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','vendor','spoof')$q$), 'REFUSED 42501');
select pg_temp.p('H7 homeowner posts as homeowner', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','homeowner','Hello')$q$), 'ALLOWED rows=1');
select pg_temp.p('H8 homeowner edits description directly (pending)', pg_temp.try($q$update public.service_requests set description='mine' where id='c6132000-0000-4000-8000-000000000002'$q$), 'REFUSED 42501');
select pg_temp.p('H9 homeowner status-change command', pg_temp.val($q$select public.admin_transition_job_status_expected('c6132000-0000-4000-8000-000000000002',now(),gen_random_uuid(),'cancelled','x')::text$q$), 'REFUSED 42501');
select pg_temp.p('H10 homeowner operations summary', pg_temp.val($q$select public.admin_operations_summary()::text$q$), 'REFUSED 42501');
select pg_temp.p('H3 homeowner smart_picks insert', pg_temp.try($q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-value','c6131000-0000-4000-8000-00000000000a')$q$), 'REFUSED 42501');
select pg_temp.p('H4 homeowner coverage insert', pg_temp.try($q$insert into public.coverage_areas(zip_code,city,state) values('99998','X','ZZ')$q$), 'REFUSED 42501');

-- Vendor A (assigned to request 1).
select pg_temp.as_user('3');
select pg_temp.p('V1 vendor reads notes', pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), 'REFUSED 42501');
select pg_temp.p('V1b vendor reads assigned request (listed columns)', pg_temp.val($q$select address from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), '1 Probe St');
select pg_temp.p('V2 vendor payouts_paused=true', pg_temp.try($q$update public.contractors set payouts_paused=true where id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('V3 vendor invoices update', pg_temp.try($q$update public.invoices set vendor_payout=1 where contractor_id='c6131000-0000-4000-8000-00000000000a'$q$), 'REFUSED 42501');
select pg_temp.p('V4 vendor posts as vendor', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000003','vendor','On my way')$q$), 'ALLOWED rows=1');
select pg_temp.p('V5 vendor posts as homeowner', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000003','homeowner','spoof')$q$), 'REFUSED 42501');
select pg_temp.p('V6 vendor posts on unassigned request', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000002','c6130000-0000-4000-8000-000000000003','vendor','x')$q$), 'REFUSED 42501');

-- Dual-role account (admin + homeowner).
select pg_temp.as_user('5');
select pg_temp.p('D1 dual posts as homeowner on own request', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000003','c6130000-0000-4000-8000-000000000005','homeowner','Mine')$q$), 'ALLOWED rows=1');
select pg_temp.p('D2 dual posts as admin on another request', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','admin','Support')$q$), 'ALLOWED rows=1');
select pg_temp.p('D3 dual posts as homeowner on another''s request', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','homeowner','x')$q$), 'REFUSED 42501');
select pg_temp.p('D4 dual posts as vendor', pg_temp.try($q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000005','vendor','x')$q$), 'REFUSED 42501');
select pg_temp.p('D5 dual reads notes on own request', pg_temp.val($q$select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000003'$q$), 'REFUSED 42501');

-- Homeowner B.
select pg_temp.as_user('4');
select pg_temp.p('B1 homeowner B reads A''s request', pg_temp.val($q$select count(*)::text from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$), '0');

-- Anonymous.
reset role; set local role anon; select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.p('Z1 anon reads smart_picks', pg_temp.try($q$select 1 from public.smart_picks$q$), 'REFUSED 42501');
select pg_temp.p('Z2 anon reads notes', pg_temp.val($q$select notes from public.service_requests limit 1$q$), 'REFUSED 42501');

reset role;
select pg_temp.p('X1 seeded invoice unchanged', (select status||' payout='||vendor_payout from public.invoices where id='c6134000-0000-4000-8000-000000000009'), 'pending payout=85.00');
select pg_temp.p('X2 legacy note kept in place', (select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'), 'LEGACY shared note');
select pg_temp.p('X3 vendor-visible review history', (select changes->0->>'kind'||' / '||reason from private.vendor_package_price_corrections where package_id='c6135000-0000-4000-8000-000000000001'), 'review_cleared / Quote-only package reviewed');
select pg_temp.p('X4 correction history row', (select count(*)::text from private.admin_request_actions where request_id='c6132000-0000-4000-8000-000000000002'), '1');
select pg_temp.p('X5 badge history row', (select before_badges::text||'->'||after_badges::text from private.provider_badge_events where contractor_id='c6131000-0000-4000-8000-00000000000a'), '{}->{Licensed}');
select pg_temp.p('X6 provider owner unchanged', (select user_id::text from public.contractors where id='c6131000-0000-4000-8000-00000000000a'), 'c6130000-0000-4000-8000-000000000003');
select label||': '||got||'  [expect '||expect||'] '||case when got=expect then 'MATCH' else 'DIFF' end from out order by n;
rollback;
