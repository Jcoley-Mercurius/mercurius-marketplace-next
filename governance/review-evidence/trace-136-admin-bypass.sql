-- TRACE-136 (Phase 6.13) characterization probes, 2026-11-02. Synthetic users, single transaction, ROLLBACK.
-- Run: psql -h 127.0.0.1 -p 55422 -U postgres -d postgres -X -A -t -f governance/review-evidence/trace-136-admin-bypass.sql
-- A5 (contractor user_id reassignment) also causes B1=1; rerun without the A5 line to see B1=0.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('c6130000-0000-4000-8000-000000000001','p613-admin@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000002','p613-home@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000003','p613-vendor@example.invalid',now()),
 ('c6130000-0000-4000-8000-000000000004','p613-home-b@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('c6130000-0000-4000-8000-000000000001','admin'),('c6130000-0000-4000-8000-000000000002','homeowner'),
 ('c6130000-0000-4000-8000-000000000003','vendor'),('c6130000-0000-4000-8000-000000000004','homeowner')
 on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('c6131000-0000-4000-8000-00000000000a','Probe vendor',true,false,'c6130000-0000-4000-8000-000000000003');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,matching_status,description)
 values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','house-cleaning','1 Probe St','Fort Myers','FL','33901','matched','Customer scope');
insert into public.disputes(id,job_id,homeowner_id,vendor_id,reason,status)
 values('c6133000-0000-4000-8000-000000000001','c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','probe','open');
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c6130000-0000-4000-8000-00000000000'||n||'"}',true) $$;
create function pg_temp.try(label text, stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  return label||': ALLOWED rows='||n;
exception when others then return label||': REFUSED '||sqlstate||' '||left(sqlerrm,90);
end $$;
grant execute on function pg_temp.try(text,text) to authenticated;
create temp table out(line text); grant all on out to authenticated;

set local role authenticated;
select pg_temp.as_user('1');
insert into out select pg_temp.try('A1 admin invoices insert status=paid amount=400', $q$insert into public.invoices(id,invoice_number,customer_id,contractor_id,service_request_id,amount,platform_fee,vendor_payout,status) values('c6134000-0000-4000-8000-000000000001','P613-1','c6130000-0000-4000-8000-000000000002','c6131000-0000-4000-8000-00000000000a','c6132000-0000-4000-8000-000000000001',400,60,340,'paid')$q$);
insert into out select pg_temp.try('A2 admin invoices update vendor_payout=9999 status=released', $q$update public.invoices set vendor_payout=9999, status='released' where id='c6134000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A3 admin contractors payouts_paused=true', $q$update public.contractors set payouts_paused=true, payouts_paused_reason='probe' where id='c6131000-0000-4000-8000-00000000000a'$q$);
insert into out select pg_temp.try('A4 admin contractors rating=5 badges', $q$update public.contractors set rating=5, badges=array['Top Rated'] where id='c6131000-0000-4000-8000-00000000000a'$q$);
insert into out select pg_temp.try('A5 admin contractors user_id reassigned', $q$update public.contractors set user_id='c6130000-0000-4000-8000-000000000004' where id='c6131000-0000-4000-8000-00000000000a'$q$);
insert into out select pg_temp.try('A6 admin coverage_areas insert 99999', $q$insert into public.coverage_areas(zip_code,city,state,is_active) values('99999','Nowhere','ZZ',true)$q$);
insert into out select pg_temp.try('A7 admin coverage_areas deactivate 33901', $q$update public.coverage_areas set is_active=false where zip_code='33901'$q$);
insert into out select pg_temp.try('A8 admin coverage_areas delete 33901', $q$delete from public.coverage_areas where zip_code='33901'$q$);
insert into out select pg_temp.try('A9 admin services_catalog pricing_mode change', $q$update public.services_catalog set pricing_mode=case when pricing_mode='quote' then 'fixed' else 'quote' end where id=(select id from public.services_catalog limit 1)$q$);
insert into out select pg_temp.try('A10 admin smart_picks insert', $q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-rated','c6131000-0000-4000-8000-00000000000a')$q$);
insert into out select pg_temp.try('A11 admin disputes direct status=resolved', $q$update public.disputes set status='resolved', resolution_notes='probe' where id='c6133000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A12 admin service_requests notes', $q$update public.service_requests set notes='INTERNAL probe note' where id='c6132000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A13 admin service_requests address', $q$update public.service_requests set address='2 Changed St' where id='c6132000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A14 admin service_requests status direct', $q$update public.service_requests set status='completed' where id='c6132000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A15 admin service_requests delete', $q$delete from public.service_requests where id='c6132000-0000-4000-8000-000000000001'$q$);
insert into out select pg_temp.try('A16 admin invoices delete', $q$delete from public.invoices where id='c6134000-0000-4000-8000-000000000001'$q$);

select pg_temp.as_user('2');
insert into out select 'H1 homeowner reads own request notes: '||coalesce((select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'),'<none>');
insert into out select 'H2 homeowner sees forged invoice: '||(select count(*) from public.invoices where customer_id='c6130000-0000-4000-8000-000000000002');
insert into out select pg_temp.try('H3 homeowner smart_picks insert', $q$insert into public.smart_picks(service_id,pick_type,contractor_id) values('house-cleaning','best-value','c6131000-0000-4000-8000-00000000000a')$q$);
insert into out select pg_temp.try('H4 homeowner coverage insert', $q$insert into public.coverage_areas(zip_code,city,state) values('99998','X','ZZ')$q$);
insert into out select pg_temp.try('H5 homeowner messages as admin role', $q$insert into public.messages(service_request_id,sender_id,sender_role,content) values('c6132000-0000-4000-8000-000000000001','c6130000-0000-4000-8000-000000000002','admin','spoof')$q$);
select pg_temp.as_user('3');
insert into out select 'V1 vendor reads assigned request notes: '||coalesce((select notes from public.service_requests where id='c6132000-0000-4000-8000-000000000001'),'<none>');
insert into out select pg_temp.try('V2 vendor contractors payouts_paused=false', $q$update public.contractors set payouts_paused=false where id='c6131000-0000-4000-8000-00000000000a'$q$);
insert into out select pg_temp.try('V3 vendor invoices update', $q$update public.invoices set vendor_payout=1 where contractor_id='c6131000-0000-4000-8000-00000000000a'$q$);
select pg_temp.as_user('4');
insert into out select 'B1 homeowner B reads A notes rows: '||(select count(*) from public.service_requests where id='c6132000-0000-4000-8000-000000000001');
reset role;
insert into out select 'X1 loyalty transactions for homeowner after forged paid invoice: '||(select count(*)||' / points '||coalesce(sum(delta),0) from public.loyalty_transactions where user_id='c6130000-0000-4000-8000-000000000002');
insert into out select 'X2 invoice state: '||(select status||' payout='||vendor_payout||' released_at '||(released_at is not null) from public.invoices where id='c6134000-0000-4000-8000-000000000001');
insert into out select 'X3 dispute decisions recorded: '||(select count(*) from public.dispute_decisions where dispute_id='c6133000-0000-4000-8000-000000000001');
select line from out;
rollback;
