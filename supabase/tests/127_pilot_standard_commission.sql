-- DEC-2026-067 / TRACE-160 (20261201001000): pilot standard commission 10%, promotional 5%,
-- prospective only. Synthetic fixtures only. Covers the policy record, the stamped snapshot rate,
-- the split, capture, webhook replay, partial and full refunds, a historical 15% booking kept at
-- 15% through later refunds, tampering, promotions at 5%, a reservation made at 7.5% going back to
-- the homeowner, rounding, and the finance and vendor views.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 homeowner, 3 and 4 finance (two-person review), 5 the provider's vendor account.
insert into auth.users(id,raw_user_meta_data) values
 ('c1270000-0000-4000-8000-000000000001','{}'),('c1270000-0000-4000-8000-000000000003','{}'),
 ('c1270000-0000-4000-8000-000000000004','{}'),('c1270000-0000-4000-8000-000000000005','{}');
insert into public.user_roles(user_id,role) values('c1270000-0000-4000-8000-000000000003','admin'),('c1270000-0000-4000-8000-000000000004','admin'),
 ('c1270000-0000-4000-8000-000000000005','vendor');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('c1270000-0000-4000-8000-000000000003','c1270000-0000-4000-8000-000000000004','Synthetic'),
 ('c1270000-0000-4000-8000-000000000004','c1270000-0000-4000-8000-000000000003','Synthetic');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id)
 values('c1271000-0000-4000-8000-000000000001','Synthetic pilot provider',true,true,'c1270000-0000-4000-8000-000000000005');
insert into public.coverage_areas(zip_code,city) values('00127','Synthetic') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id,zip_code) values('c1271000-0000-4000-8000-000000000001','00127');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('c1272000-0000-4000-8000-000000000001','c1271000-0000-4000-8000-000000000001',(select id from public.services_catalog where is_active order by id limit 1),
   'Synthetic pilot offering','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name) values('c1273000-0000-4000-8000-000000000001','c1272000-0000-4000-8000-000000000001','one-time',100,'Synthetic tier');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id,total_amount)
 select ('c1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'c1270000-0000-4000-8000-000000000001','c1271000-0000-4000-8000-000000000001',
 'Synthetic','Synthetic pilot address','scheduled',(select service_id from public.vendor_packages where id='c1272000-0000-4000-8000-000000000001'),'one-time','00127','fixed',
 'c1272000-0000-4000-8000-000000000001','c1273000-0000-4000-8000-000000000001',100 from generate_series(1,8) n;
update public.service_requests r set pricing_inputs = jsonb_build_object('version','pricing-v2','package_id',p.id,'lineage_id',p.lineage_id,
    'revision_number',p.revision_number,'package_revision',private.package_revision_hash(p.id),'frequency',r.frequency,
    'answers',coalesce(r.package_question_answers,'{}'::jsonb),'priced_at',now())
  || private.price_selection(private.package_content(p.id),r.frequency,r.package_tier_id::text,r.package_question_answers,'[]'::jsonb),
  total_amount=coalesce(r.total_amount,t.price)
 from public.vendor_packages p, public.package_tiers t where p.id=r.package_id and t.id=r.package_tier_id
  and r.id in (select ('c1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8) n);
insert into private.r0_lee_zips values ('00127') on conflict do nothing;
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
 select 'c1270000-0000-4000-8000-000000000001','00127',service_id,'c1270000-0000-4000-8000-000000000001'
 from public.vendor_packages where id='c1272000-0000-4000-8000-000000000001';
insert into private.promotion_offers(id,status,funding,contractor_id,kind,amount_cents,label,terms,starts_at,ends_at,budget_cents,first_booking_only,
   content_hash,vendor_approved_hash,authorized_hash,created_by,updated_by)
 values
 ('c1275000-0000-4000-8000-000000000001','approved','vendor','c1271000-0000-4000-8000-000000000001','amount',1000,'Synthetic $10 off','Synthetic vendor terms',
   now()-interval '1 day',now()+interval '30 days',null,false,'hash-v127','hash-v127',null,'c1270000-0000-4000-8000-000000000003','c1270000-0000-4000-8000-000000000003'),
 ('c1275000-0000-4000-8000-000000000002','approved','platform',null,'amount',1000,'Synthetic pilot welcome','Synthetic platform terms',
   now()-interval '1 day',now()+interval '30 days',100000,false,'hash-p127',null,'hash-p127','c1270000-0000-4000-8000-000000000003','c1270000-0000-4000-8000-000000000003');

create temp table fx(key text primary key,id uuid);
grant select on fx to authenticated;
create function pg_temp.req(n integer) returns uuid language sql as $$ select ('c1274000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.terms(request uuid,discount bigint,promo text,tax bigint default 0,tip bigint default 0) returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',discount,'adjustment',0,'subtotal',10000-discount,'tax',tax,'tip',tip,'deposit',0,'total',10000-discount+tax+tip,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005/DEC-2026-067','tax_evidence','synthetic-tax-decision',
 'promotion_terms',promo,'reason','Synthetic reviewed source','expires_at',now()+interval '1 day') $$;
create function pg_temp.publish(request uuid,terms jsonb) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"c1270000-0000-4000-8000-000000000004"}',true);
 perform public.money_approve_review('c1270000-0000-4000-8000-000000000003',jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Synthetic second review');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 return public.money_publish_snapshot(request,terms,'c1270000-0000-4000-8000-000000000003','c1270000-0000-4000-8000-000000000004');
end $$;
create function pg_temp.pay(label text,snapshot uuid) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true); attempt public.money_checkout_attempts;
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"c1270000-0000-4000-8000-000000000001"}',true);
 attempt:=public.money_prepare_checkout(snapshot,'full');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 perform public.money_receive_event('evt_c127_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_c127_'||label,'amount',attempt.amount,'currency','usd'));
 if public.money_process_event('evt_c127_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
 return attempt.obligation_id;
end $$;
create function pg_temp.refund(label text,obligation uuid,service bigint) returns void language plpgsql as $$
declare auth uuid;
begin
 insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
  values(obligation,(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),
   service,0,0,'refund-c127-'||label,'c1270000-0000-4000-8000-000000000003','c1270000-0000-4000-8000-000000000004','CFG-006','Synthetic refund')
  returning id into auth;
 perform public.money_receive_event('evt_c127_refund_'||label,'refund',jsonb_build_object('authorization_id',auth,'amount',service,'currency','usd',
   'payment_id',(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),'refund_id','re_c127_'||label));
 if public.money_process_event('evt_c127_refund_'||label)<>'processed' then raise exception 'Fixture refund failed'; end if;
end $$;
create function pg_temp.net(obligation uuid,account text) returns bigint language sql as $$ select private.money_account_net(obligation,account)::bigint $$;
create function pg_temp.issues(obligation uuid) returns jsonb language sql as $$ select private.money_obligation_reconciliation(obligation,now())->'issues' $$;
create function pg_temp.split(obligation uuid,service bigint) returns text language sql as $$ select row(s.fee,s.subsidy)::text from private.money_split(obligation,service) s $$;
create function pg_temp.econ(eligible bigint,discount bigint,funding text,key text) returns bigint language sql as $$ select (private.promotion_economics(eligible,discount,funding)->>key)::bigint $$;
create function pg_temp.o(key text) returns uuid language sql as $$ select id from fx where key=$1 $$;

-- 1. Policy ---------------------------------------------------------------------------------------
select is(private.money_standard_commission_bps(), 1000, 'the standard commission in force is 10%');
select is(private.money_promotional_commission_bps(), 500, 'the promotional commission in force is 5%, half the standard (DEC-2026-038)');
select results_eq($$select standard_bps,promotional_bps,effective_at='-infinity'::timestamptz from private.money_commission_policies order by id$$,
 $$values (1500,750,true),(1000,500,false)$$, 'the 15%/7.5% history is kept and the 10%/5% policy follows it');
select ok((select effective_at from private.money_commission_policies where standard_bps=1000) = private.money_commission_effective_at(),
 'the effective time of the 10% policy is recorded');
select throws_ok($$update private.money_commission_policies set standard_bps=700$$, '42501', null, 'policy history cannot be edited');
select throws_ok($$delete from private.money_commission_policies$$, '42501', null, 'policy history cannot be deleted');
select throws_ok($$insert into private.money_commission_policies(standard_bps,promotional_bps,decision) values (1000,700,'x')$$, '23514', null,
 'a promotional rate must be half the standard');
select ok(not has_table_privilege('authenticated','private.money_commission_policies','select')
  and not has_table_privilege('anon','private.money_commission_policies','select'), 'callers cannot read or change the policy table');
select ok(not has_function_privilege('authenticated','private.money_standard_commission_bps()','execute')
  and not has_function_privilege('authenticated','private.promotion_economics(bigint,bigint,text)','execute'), 'callers cannot reach the rate functions directly');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='money_snapshots' and column_name='commission_rate_bps'),
 null, 'snapshots have no default rate: only publication stamps one');
select ok(not has_column_privilege('authenticated','public.money_snapshots','commission_rate_bps','select'), 'homeowners are not given the commission column');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosrc ~* 'insert\s+into\s+public\.money_snapshots\M'), 1,
 'one function writes snapshots (private.money_publish_snapshot), so every booking path - one-time, quote, offer, recurring visit - is stamped there');

-- 2. Economics and rounding -----------------------------------------------------------------------
select is(pg_temp.econ(10000,0,null,'commission_cents'), 1000::bigint, '$100 ordinary: $10 commission');
select is(pg_temp.econ(10000,0,null,'vendor_proceeds_cents'), 9000::bigint, '$100 ordinary: $90 vendor share before separate deductions');
select is(pg_temp.econ(10000,0,'platform','commission_cents'), 500::bigint, '$100 with a Mercurius-funded promotion: $5 commission (5% of the amount before the discount)');
select is(pg_temp.econ(10000,1000,'vendor','commission_cents'), 450::bigint, 'vendor-funded $10: 5% of the $90 paid = $4.50');
select is(pg_temp.econ(10000,1000,'vendor','vendor_proceeds_cents'), 8550::bigint, 'vendor-funded $10: $85.50 to the vendor');
select is(pg_temp.econ(10000,1000,'platform','vendor_proceeds_cents'), 9500::bigint, 'Mercurius-funded $10: $95.00 to the vendor');
select is(pg_temp.econ(10000,1000,'platform','platform_subsidy_cents'), 1000::bigint, 'Mercurius-funded $10: $10 subsidy, kept apart from commission');
select is(pg_temp.econ(10000,0,'vendor','commission_cents'), 500::bigint, 'a promotional package price pays 5% of its approved price');
select is(pg_temp.econ(3333,0,null,'commission_cents'), 333::bigint, '10% of $33.33 = 333.3 cents, rounded to $3.33');
select is(pg_temp.econ(3335,0,null,'commission_cents'), 334::bigint, '10% of $33.35 = 333.5 cents, rounded half away from zero to $3.34');
select is(pg_temp.econ(3333,0,'platform','commission_cents'), 167::bigint, '5% of $33.33 = 166.65 cents, rounded to $1.67');
select is(pg_temp.econ(30,0,'platform','commission_cents'), 2::bigint, '5% of $0.30 = 1.5 cents, rounded to 2');
select is(pg_temp.econ(5,0,null,'commission_cents'), 1::bigint, '10% of $0.05 = 0.5 cents, rounded to 1');

-- 3. An ordinary booking at 10%: publication, capture, replay, refunds -----------------------------
select throws_ok($$select pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),0,null) || '{"commission_rate_bps":0}')$$, '22023',
 'The commission rate is set by Mercurius policy, not by the reviewed terms', 'reviewers (or a tampered client) cannot set the rate');
select throws_ok($$select pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),0,null) || '{"commission_rate_bps":1000}')$$, '22023',
 'The commission rate is set by Mercurius policy, not by the reviewed terms', 'not even the current rate: the field is refused outright');
insert into fx values ('s1', pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),0,null,700,1000)));
select is((select commission_rate_bps from public.money_snapshots where id=pg_temp.o('s1')), 1000, 'the snapshot is stamped 10% when it is published');
select is((select total from public.money_snapshots where id=pg_temp.o('s1')), 11700::bigint, 'the homeowner total ($100 + $7 tax + $10 tip) does not depend on the commission');
insert into fx values ('o1', pg_temp.pay('o1', pg_temp.o('s1')));
select is(-pg_temp.net(pg_temp.o('o1'),'platform_revenue'), 1000::bigint, 'commission revenue $10 (tax and tip excluded from the base)');
select is(-pg_temp.net(pg_temp.o('o1'),'provider_payable'), 10000::bigint, 'provider payable $90 service share + $10 tip');
select is(-pg_temp.net(pg_temp.o('o1'),'tax_liability'), 700::bigint, 'tax is tracked separately');
select is(private.money_payout_proceeds(pg_temp.o('o1')), 10000::bigint, 'payout proceeds use the stamped 10%');
select is(pg_temp.issues(pg_temp.o('o1')), '[]'::jsonb, 'reconciliation agrees');
-- Replay of the same processor event: no second capture, commission or payable.
select lives_ok($$select public.money_receive_event('evt_c127_o1','capture',(select payload from public.money_webhook_events where event_id='evt_c127_o1'))$$,
 'the identical capture event can be delivered again');
select is(public.money_process_event('evt_c127_o1'), 'processed', 'processing it again reports the earlier outcome');
select is((select count(*)::integer from public.money_journals where obligation_id=pg_temp.o('o1')), 2, 'still one capture and one earnings journal');
select is(-pg_temp.net(pg_temp.o('o1'),'platform_revenue'), 1000::bigint, 'replay does not duplicate commission');
select is((select captured from public.money_obligations where id=pg_temp.o('o1')), 11700::bigint, 'replay does not duplicate the charge');
-- Partial refund of $33.33 service: the fee is recomputed on the cumulative retained $66.67.
select pg_temp.refund('o1-part', pg_temp.o('o1'), 3333);
select is(-pg_temp.net(pg_temp.o('o1'),'platform_revenue'), 667::bigint, '10% of the retained $66.67 = 666.7 cents, rounded to $6.67');
select is(-pg_temp.net(pg_temp.o('o1'),'provider_payable'), 7000::bigint, 'provider keeps $66.67 - $6.67 + $10 tip');
select is(pg_temp.issues(pg_temp.o('o1')), '[]'::jsonb, 'reconciliation agrees after a partial refund');
select pg_temp.refund('o1-rest', pg_temp.o('o1'), 6667);
select is(-pg_temp.net(pg_temp.o('o1'),'platform_revenue'), 0::bigint, 'a full service refund reverses the whole commission');
select is(-pg_temp.net(pg_temp.o('o1'),'provider_payable'), 1000::bigint, 'only the tip remains payable to the provider');
select is(pg_temp.issues(pg_temp.o('o1')), '[]'::jsonb, 'reconciliation agrees after the full service refund');

-- 4. A historical 15% booking stays 15%, including refunds after the change -------------------------
-- A policy row effective now simulates publication before 20261201001000; the 10% row is then
-- re-recorded, as the hosted push does. (Within one transaction now() is constant, so the later
-- row wins by id.) 20261201001000 itself stamps rows that existed before it at 1500: see
-- governance/PILOT-COMMISSION-10.md §6 for the upgrade rehearsal across the real migration.
insert into private.money_commission_policies(standard_bps,promotional_bps,decision) values (1500,750,'Synthetic: before DEC-2026-067');
insert into fx values ('s2', pg_temp.publish(pg_temp.req(2), pg_temp.terms(pg_temp.req(2),0,null)));
insert into fx values ('o2', pg_temp.pay('o2', pg_temp.o('s2')));
insert into private.money_commission_policies(standard_bps,promotional_bps,decision) values (1000,500,'Synthetic: DEC-2026-067 pushed');
select is(private.money_standard_commission_bps(), 1000, 'the 10% policy is back in force');
select is((select commission_rate_bps from public.money_snapshots where id=pg_temp.o('s2')), 1500, 'the earlier booking keeps its 15% stamp');
select is(-pg_temp.net(pg_temp.o('o2'),'platform_revenue'), 1500::bigint, 'its commission stays $15');
select is(pg_temp.split(pg_temp.o('o2'),10000), '(1500,0)', 'the split still reads 15% for it');
select pg_temp.refund('o2-part', pg_temp.o('o2'), 4000);
select is(-pg_temp.net(pg_temp.o('o2'),'platform_revenue'), 900::bigint, 'a refund after the change uses the original 15%: 15% of the retained $60 = $9');
select is(-pg_temp.net(pg_temp.o('o2'),'provider_payable'), 5100::bigint, 'and the provider keeps 85% of $60');
select is(pg_temp.issues(pg_temp.o('o2')), '[]'::jsonb, 'reconciliation agrees on the historical booking');
-- New bookings published after the change, for the same (existing) provider, get 10%.
insert into fx values ('s3', pg_temp.publish(pg_temp.req(3), pg_temp.terms(pg_temp.req(3),0,null)));
select is((select commission_rate_bps from public.money_snapshots where id=pg_temp.o('s3')), 1000, 'the existing provider''s next booking is stamped 10%');

-- 5. Promotions at 5% -------------------------------------------------------------------------------
select is(private.promotion_reserve('c1275000-0000-4000-8000-000000000001',pg_temp.req(4),null,'synthetic-c127-0004')->>'status', 'reserved', 'vendor-funded offer reserved');
select is((select row(commission_rate_bps,commission_base_cents,commission_cents,vendor_proceeds_cents)::text from private.promotion_redemptions where service_request_id=pg_temp.req(4)),
 '(500,9000,450,8550)', 'the reservation records 5% of the $90 paid');
update private.money_feature_gates set enabled=true, reason='Synthetic test' where name='promotions_checkout';
insert into fx values ('s4', pg_temp.publish(pg_temp.req(4), pg_temp.terms(pg_temp.req(4),1000,'Synthetic $10 off: Synthetic vendor terms')));
select is((select row(s.commission_rate_bps,p.commission_rate_bps,p.commission)::text from public.money_snapshots s join public.money_snapshot_promotions p on p.snapshot_id=s.id
  where s.id=pg_temp.o('s4')), '(1000,500,450)', 'the snapshot records the 10% standard and the 5% promotional commission once, not halved again');
insert into fx values ('o4', pg_temp.pay('o4', pg_temp.o('s4')));
select is(-pg_temp.net(pg_temp.o('o4'),'platform_revenue'), 450::bigint, 'vendor-funded: commission $4.50');
select is(-pg_temp.net(pg_temp.o('o4'),'provider_payable'), 8550::bigint, 'vendor-funded: $85.50 to the vendor');
select is(pg_temp.issues(pg_temp.o('o4')), '[]'::jsonb, 'reconciliation agrees');
select pg_temp.refund('o4-half', pg_temp.o('o4'), 4500);
select is(-pg_temp.net(pg_temp.o('o4'),'platform_revenue'), 225::bigint, 'a half refund reverses half of the snapshot commission');
select is(pg_temp.issues(pg_temp.o('o4')), '[]'::jsonb, 'reconciliation agrees after the promotional refund');
select is(private.promotion_reserve('c1275000-0000-4000-8000-000000000002',pg_temp.req(5),null,'synthetic-c127-0005')->>'status', 'reserved', 'Mercurius-funded offer reserved');
insert into fx values ('s5', pg_temp.publish(pg_temp.req(5), pg_temp.terms(pg_temp.req(5),1000,'Synthetic pilot welcome: Synthetic platform terms')));
insert into fx values ('o5', pg_temp.pay('o5', pg_temp.o('s5')));
select is(-pg_temp.net(pg_temp.o('o5'),'platform_revenue'), 500::bigint, 'Mercurius-funded: commission $5 on the $100 before the discount');
select is(-pg_temp.net(pg_temp.o('o5'),'provider_payable'), 9500::bigint, 'Mercurius-funded: $95 to the vendor');
select is(pg_temp.net(pg_temp.o('o5'),'promotion_subsidy'), 1000::bigint, 'the $10 subsidy is its own account, not netted against commission');
select is(pg_temp.issues(pg_temp.o('o5')), '[]'::jsonb, 'reconciliation agrees');
select is((private.promotion_usage('c1275000-0000-4000-8000-000000000001')->>'commission_relief_cents')::bigint, 450::bigint,
 'relief is measured against the 10% standard: $9.00 - $4.50');

-- 6. A reservation made at 7.5% is not repriced: it goes back to the homeowner ----------------------
insert into private.money_commission_policies(standard_bps,promotional_bps,decision) values (1500,750,'Synthetic: before DEC-2026-067');
select is(private.promotion_reserve('c1275000-0000-4000-8000-000000000002',pg_temp.req(6),null,'synthetic-c127-0006')->>'status', 'reserved', 'reserved before the change');
insert into private.money_commission_policies(standard_bps,promotional_bps,decision) values (1000,500,'Synthetic: DEC-2026-067 pushed');
select is((select commission_rate_bps from private.promotion_redemptions where service_request_id=pg_temp.req(6) and status='reserved'), 750,
 'the reservation keeps the rate it recorded');
select is((select private.promotion_redemption_problem(x, r) from private.promotion_redemptions x, public.service_requests r
  where x.service_request_id=pg_temp.req(6) and x.status='reserved' and r.id=x.service_request_id), 'commission_changed', 'the homeowner sees it must be applied again');
select throws_ok($$select pg_temp.publish(pg_temp.req(6), pg_temp.terms(pg_temp.req(6),1000,'Synthetic pilot welcome: Synthetic platform terms'))$$, '40001',
 'This offer was reserved under a superseded commission rate; release it so the homeowner can apply it again', 'it is never published at 7.5%');
select ok(private.promotion_release_unpaid() >= 1, 'the existing unpaid-reservation sweep releases it');
select is((select row(status,release_reason)::text from private.promotion_redemptions where service_request_id=pg_temp.req(6)),
 '(released,"Commission rate changed before payment")', 'released with its reason');
select is(private.promotion_reserve('c1275000-0000-4000-8000-000000000002',pg_temp.req(6),null,'synthetic-c127-0007')->>'status', 'reserved', 'the offer can be applied again');
select is((select commission_rate_bps from private.promotion_redemptions where service_request_id=pg_temp.req(6) and status='reserved'), 500, 'now at 5%');

-- 7. Finance and vendor views agree with the ledger --------------------------------------------------
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1270000-0000-4000-8000-000000000003"}',true);
select results_eq($$select (x->>'fee_percent')::numeric,(x->>'standard_commission_bps')::integer,(x->>'promotional_commission_bps')::integer from (select public.money_finance_reconciliation() x) y$$,
 $$values (10::numeric,1000,500)$$, 'the finance page reports 10% and 5%');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1270000-0000-4000-8000-000000000005"}',true);
select results_eq($$select (j->'amounts'->>'platform_fee')::bigint,(j->'amounts'->>'payout')::bigint from jsonb_array_elements(public.vendor_own_earnings()->'jobs') j
  where (j->>'job_id')::uuid=pg_temp.req(2)$$, $$values (900::bigint,5100::bigint)$$, 'the vendor sees the historical booking at 15% of what was retained');
select results_eq($$select (j->'amounts'->>'platform_fee')::bigint,(j->'amounts'->>'payout')::bigint from jsonb_array_elements(public.vendor_own_earnings()->'jobs') j
  where (j->>'job_id')::uuid=pg_temp.req(5)$$, $$values (500::bigint,9500::bigint)$$, 'the vendor sees the promotional booking at 5%');
select set_config('request.jwt.claims','',true);

select * from finish();
rollback;
