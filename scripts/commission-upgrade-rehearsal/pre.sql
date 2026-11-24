-- DEC-2026-067 / TRACE-160 upgrade rehearsal, step 1 of 3. LOCAL ISOLATED STACK ONLY.
-- Runs on a database at `main` *before* 20261201001000 and commits synthetic bookings made under the
-- 15% policy, so step 3 can show the migration leaves them exactly as they were.
-- Driver: scripts/commission-upgrade-rehearsal/run.sh. Never run against a hosted project.
\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from pg_class where relname = 'money_commission_policies') then
    raise exception 'Rehearsal step 1 must run before 20261201001000';
  end if;
end $$;
create schema rehearsal;
create table rehearsal.fx(key text primary key, id uuid);
create table rehearsal.ledger_before(obligation_id uuid primary key, journals text);

insert into auth.users(id,raw_user_meta_data) values
 ('d1270000-0000-4000-8000-000000000001','{}'),('d1270000-0000-4000-8000-000000000003','{}'),('d1270000-0000-4000-8000-000000000004','{}');
insert into public.user_roles(user_id,role) values('d1270000-0000-4000-8000-000000000003','admin'),('d1270000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('d1270000-0000-4000-8000-000000000003','d1270000-0000-4000-8000-000000000004','Synthetic rehearsal'),
 ('d1270000-0000-4000-8000-000000000004','d1270000-0000-4000-8000-000000000003','Synthetic rehearsal');
insert into public.contractors(id,name,is_active,marketing_enabled) values('d1271000-0000-4000-8000-000000000001','Synthetic rehearsal provider',true,true);
insert into public.coverage_areas(zip_code,city) values('00128','Synthetic') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id,zip_code) values('d1271000-0000-4000-8000-000000000001','00128');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('d1272000-0000-4000-8000-000000000001','d1271000-0000-4000-8000-000000000001',(select id from public.services_catalog where is_active order by id limit 1),
   'Synthetic rehearsal offering','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name) values('d1273000-0000-4000-8000-000000000001','d1272000-0000-4000-8000-000000000001','one-time',100,'Synthetic tier');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id,total_amount)
 select ('d1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d1270000-0000-4000-8000-000000000001','d1271000-0000-4000-8000-000000000001',
 'Synthetic','Synthetic rehearsal address','scheduled',(select service_id from public.vendor_packages where id='d1272000-0000-4000-8000-000000000001'),'one-time','00128','fixed',
 'd1272000-0000-4000-8000-000000000001','d1273000-0000-4000-8000-000000000001',100 from generate_series(1,6) n;
update public.service_requests r set pricing_inputs = jsonb_build_object('version','pricing-v2','package_id',p.id,'lineage_id',p.lineage_id,
    'revision_number',p.revision_number,'package_revision',private.package_revision_hash(p.id),'frequency',r.frequency,
    'answers',coalesce(r.package_question_answers,'{}'::jsonb),'priced_at',now())
  || private.price_selection(private.package_content(p.id),r.frequency,r.package_tier_id::text,r.package_question_answers,'[]'::jsonb),
  total_amount=coalesce(r.total_amount,t.price)
 from public.vendor_packages p, public.package_tiers t where p.id=r.package_id and t.id=r.package_tier_id
  and r.id in (select ('d1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n);
insert into private.r0_lee_zips values ('00128') on conflict do nothing;
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
 select 'd1270000-0000-4000-8000-000000000001','00128',service_id,'d1270000-0000-4000-8000-000000000001'
 from public.vendor_packages where id='d1272000-0000-4000-8000-000000000001';
insert into private.promotion_offers(id,status,funding,contractor_id,kind,amount_cents,label,terms,starts_at,ends_at,budget_cents,first_booking_only,
   content_hash,vendor_approved_hash,authorized_hash,created_by,updated_by)
 values ('d1275000-0000-4000-8000-000000000001','approved','vendor','d1271000-0000-4000-8000-000000000001','amount',1000,'Synthetic $10 off','Synthetic vendor terms',
   now()-interval '1 day',now()+interval '30 days',null,false,'hash-r','hash-r',null,'d1270000-0000-4000-8000-000000000003','d1270000-0000-4000-8000-000000000003');

create function rehearsal.req(n integer) returns uuid language sql as $$ select ('d1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function rehearsal.o(k text) returns uuid language sql as $$ select id from rehearsal.fx where key=k $$;
create function rehearsal.terms(request uuid,discount bigint,promo text) returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',discount,'adjustment',0,'subtotal',10000-discount,'tax',0,'tip',0,'deposit',0,'total',10000-discount,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005','tax_evidence','synthetic-tax-decision',
 'promotion_terms',promo,'reason','Synthetic rehearsal','expires_at',now()+interval '7 days') $$;
create function rehearsal.publish(request uuid,terms jsonb) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"d1270000-0000-4000-8000-000000000004"}',true);
 perform public.money_approve_review('d1270000-0000-4000-8000-000000000003',jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Synthetic second review');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 return public.money_publish_snapshot(request,terms,'d1270000-0000-4000-8000-000000000003','d1270000-0000-4000-8000-000000000004');
end $$;
create function rehearsal.pay(label text,snapshot uuid) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true); attempt public.money_checkout_attempts;
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"d1270000-0000-4000-8000-000000000001"}',true);
 attempt:=public.money_prepare_checkout(snapshot,'full');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 perform public.money_receive_event('evt_r127_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_r127_'||label,'amount',attempt.amount,'currency','usd'));
 if public.money_process_event('evt_r127_'||label)<>'processed' then raise exception 'Rehearsal capture failed'; end if;
 return attempt.obligation_id;
end $$;
create function rehearsal.refund(label text,obligation uuid,service bigint) returns void language plpgsql as $$
declare auth uuid;
begin
 insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
  values(obligation,(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),
   service,0,0,'refund-r127-'||label,'d1270000-0000-4000-8000-000000000003','d1270000-0000-4000-8000-000000000004','CFG-006','Synthetic refund')
  returning id into auth;
 perform public.money_receive_event('evt_r127_refund_'||label,'refund',jsonb_build_object('authorization_id',auth,'amount',service,'currency','usd',
   'payment_id',(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),'refund_id','re_r127_'||label));
 if public.money_process_event('evt_r127_refund_'||label)<>'processed' then raise exception 'Rehearsal refund failed'; end if;
end $$;
create function rehearsal.journals(obligation uuid) returns text language sql as $$
 select md5(string_agg(j.id::text||j.lines::text, ',' order by j.created_at, j.id)) from public.money_journals j where j.obligation_id=obligation $$;

-- A: paid $100 ordinary booking at 15%, then a $20 partial refund, all before the migration.
insert into rehearsal.fx values ('sA', rehearsal.publish(rehearsal.req(1), rehearsal.terms(rehearsal.req(1),0,null)));
insert into rehearsal.fx values ('A', rehearsal.pay('A', rehearsal.o('sA')));
select rehearsal.refund('A1', rehearsal.o('A'), 2000);
-- B: invoice published at 15%, not paid.
insert into rehearsal.fx values ('sB', rehearsal.publish(rehearsal.req(2), rehearsal.terms(rehearsal.req(2),0,null)));
-- C: paid vendor-funded promotion at 7.5% (gate opened for the rehearsal only).
update private.money_feature_gates set enabled=true, reason='Synthetic rehearsal' where name='promotions_checkout';
select private.promotion_reserve('d1275000-0000-4000-8000-000000000001',rehearsal.req(3),null,'rehearsal-r127-0003');
insert into rehearsal.fx values ('sC', rehearsal.publish(rehearsal.req(3), rehearsal.terms(rehearsal.req(3),1000,'Synthetic $10 off: Synthetic vendor terms')));
insert into rehearsal.fx values ('C', rehearsal.pay('C', rehearsal.o('sC')));
-- D: a 7.5% reservation, unpaid and unpublished.
select private.promotion_reserve('d1275000-0000-4000-8000-000000000001',rehearsal.req(4),null,'rehearsal-r127-0004');

insert into rehearsal.ledger_before select o, rehearsal.journals(o) from (values (rehearsal.o('A')),(rehearsal.o('C'))) v(o);
do $$ begin
  if -private.money_account_net(rehearsal.o('A'),'platform_revenue') <> 1200 then raise exception 'A: expected 15%% of the retained $80'; end if;
  if -private.money_account_net(rehearsal.o('C'),'platform_revenue') <> 675 then raise exception 'C: expected 7.5%% of $90'; end if;
  raise notice 'PRE  A fee 1200 on retained 8000 (15%%); B published unpaid; C fee 675 (7.5%%); D reserved at 750';
end $$;
commit;
