-- DEC-2026-041 items 1-3 (20261018005000). Synthetic fixtures only: funded promotions through
-- the commercial source, the two-person snapshot, capture, refunds, restoration and
-- reconciliation, with the DEC-2026-038 worked examples ($100 eligible, $10 discount).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 homeowner, 2 other homeowner, 3 and 4 finance (two-person review).
insert into auth.users(id,raw_user_meta_data) values
 ('b8610000-0000-4000-8000-000000000001','{}'),('b8610000-0000-4000-8000-000000000002','{}'),
 ('b8610000-0000-4000-8000-000000000003','{}'),('b8610000-0000-4000-8000-000000000004','{}');
insert into public.user_roles(user_id,role) values('b8610000-0000-4000-8000-000000000003','admin'),('b8610000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('b8610000-0000-4000-8000-000000000003','b8610000-0000-4000-8000-000000000004','Synthetic'),
 ('b8610000-0000-4000-8000-000000000004','b8610000-0000-4000-8000-000000000003','Synthetic');
insert into public.contractors(id,name,is_active,marketing_enabled) values('b8620000-0000-4000-8000-000000000001','Synthetic promo provider',true,true);
insert into public.coverage_areas(zip_code,city) values('00086','Synthetic') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id,zip_code) values('b8620000-0000-4000-8000-000000000001','00086');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('b8640000-0000-4000-8000-000000000001','b8620000-0000-4000-8000-000000000001',(select id from public.services_catalog where is_active order by id limit 1),
   'Synthetic promo offering','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name) values('b8650000-0000-4000-8000-000000000001','b8640000-0000-4000-8000-000000000001','one-time',100,'Synthetic tier');
-- Requests 1-4 for homeowner 1, each $100 at the offering's level.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id,total_amount)
 select ('b8630000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b8610000-0000-4000-8000-000000000001','b8620000-0000-4000-8000-000000000001',
 'Synthetic','Synthetic promo address','scheduled',(select service_id from public.vendor_packages where id='b8640000-0000-4000-8000-000000000001'),'one-time','00086','fixed',
 'b8640000-0000-4000-8000-000000000001','b8650000-0000-4000-8000-000000000001',100 from generate_series(1,4) n;
insert into private.r0_lee_zips values ('00086') on conflict do nothing;
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
 select 'b8610000-0000-4000-8000-000000000001','00086',service_id,'b8610000-0000-4000-8000-000000000001'
 from public.vendor_packages where id='b8640000-0000-4000-8000-000000000001';

-- Two approved $10 offers: vendor-funded, and Mercurius-funded (first booking only).
insert into private.promotion_offers(id,status,funding,contractor_id,kind,amount_cents,label,terms,starts_at,ends_at,budget_cents,first_booking_only,
   content_hash,vendor_approved_hash,authorized_hash,created_by,updated_by)
 values
 ('b8660000-0000-4000-8000-000000000001','approved','vendor','b8620000-0000-4000-8000-000000000001','amount',1000,'Synthetic $10 off','Synthetic vendor terms',
   now()-interval '1 day',now()+interval '30 days',null,false,'hash-v','hash-v',null,'b8610000-0000-4000-8000-000000000003','b8610000-0000-4000-8000-000000000003'),
 ('b8660000-0000-4000-8000-000000000002','approved','platform',null,'amount',1000,'Synthetic welcome','Synthetic platform terms',
   now()-interval '1 day',now()+interval '30 days',100000,true,'hash-p',null,'hash-p','b8610000-0000-4000-8000-000000000003','b8610000-0000-4000-8000-000000000003');

create temp table fx(key text primary key,id uuid,terms jsonb);
grant select on fx to authenticated;
create function pg_temp.req(n integer) returns uuid language sql as $$ select ('b8630000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.terms(request uuid,discount bigint,promo text) returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',discount,'adjustment',0,'subtotal',10000-discount,'tax',0,'tip',0,'deposit',0,'total',10000-discount,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005/DEC-2026-038','tax_evidence','synthetic-tax-decision',
 'promotion_terms',promo,'reason','Synthetic reviewed source','expires_at',now()+interval '1 day') $$;
create function pg_temp.publish(request uuid,terms jsonb) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000004"}',true);
 perform public.money_approve_review('b8610000-0000-4000-8000-000000000003',jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Synthetic second review');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 return public.money_publish_snapshot(request,terms,'b8610000-0000-4000-8000-000000000003','b8610000-0000-4000-8000-000000000004');
end $$;
-- The homeowner pays in full; the capture event is processed.
create function pg_temp.pay(label text,snapshot uuid) returns uuid language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true); attempt public.money_checkout_attempts;
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000001"}',true);
 attempt:=public.money_prepare_checkout(snapshot,'full');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
 perform public.money_receive_event('evt_'||label,'capture',jsonb_build_object('attempt_id',attempt.id,'payment_id','pi_'||label,'amount',attempt.amount,'currency','usd'));
 if public.money_process_event('evt_'||label)<>'processed' then raise exception 'Fixture capture failed'; end if;
 return attempt.obligation_id;
end $$;
-- A refund of service cents, authorized by two people and settled by the processor.
create function pg_temp.refund(label text,obligation uuid,service bigint) returns void language plpgsql as $$
declare auth uuid;
begin
 insert into public.money_refund_authorizations(obligation_id,payment_id,service,tax,tip,business_key,created_by,approved_by,policy_evidence,reason)
  values(obligation,(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),
   service,0,0,'refund-'||label,'b8610000-0000-4000-8000-000000000003','b8610000-0000-4000-8000-000000000004','CFG-006','Synthetic refund')
  returning id into auth;
 perform public.money_receive_event('evt_refund_'||label,'refund',jsonb_build_object('authorization_id',auth,'amount',service,'currency','usd',
   'payment_id',(select stripe_payment_id from public.money_checkout_attempts where obligation_id=obligation and status='captured' limit 1),'refund_id','re_'||label));
 if public.money_process_event('evt_refund_'||label)<>'processed' then raise exception 'Fixture refund failed'; end if;
end $$;
create function pg_temp.net(obligation uuid,account text) returns bigint language sql as $$ select private.money_account_net(obligation,account)::bigint $$;
create function pg_temp.issues(obligation uuid) returns jsonb language sql as $$ select private.money_obligation_reconciliation(obligation,now())->'issues' $$;
create function pg_temp.redemption(request uuid) returns text language sql as $$
 select status from private.promotion_redemptions where service_request_id=request order by created_at desc limit 1 $$;

-- Grants and the gate --------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated','public.money_snapshot_promotions','select'), 'snapshot promotion evidence is private');
select ok(has_function_privilege('authenticated','public.admin_restore_promotion(uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_restore_promotion(uuid,text)','execute'), 'signed-in operators (checked inside) may request a restoration exception; anonymous callers may not');
select is(private.money_gate('promotions_checkout'), false, 'promotions stay closed at checkout until the finance review opens them');

select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000001',pg_temp.req(1),null,'synthetic-promo-0001')->>'status', 'reserved',
 'a vendor-funded offer is reserved for request 1');
select throws_ok($$select private.money_source(pg_temp.req(1))$$, 'P0001', 'Promotion allocation integration required',
 'with the gate closed, checkout refuses a promoted request (DEC-2026-015 §3)');
update private.money_feature_gates set enabled=true, reason='Synthetic test' where name='promotions_checkout';

-- Vendor-funded: $100 - $10 = $90 paid, 7.5% of $90 = $6.75 commission, $83.25 to the vendor.
select is((select (s->>'discount')::bigint from (select private.money_source(pg_temp.req(1)) s) x), 1000::bigint, 'the source carries the discount');
select throws_ok($$select pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),0,null))$$, 'P0001', 'Discount must equal the applied promotion',
 'reviewers cannot drop the discount');
select throws_ok($$select pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),1000,'Something else'))$$, 'P0001',
 'A promotional snapshot carries the promotion''s terms and no adjustment', 'the snapshot carries the offer''s own terms');
insert into fx(key,id) values ('v-snapshot', pg_temp.publish(pg_temp.req(1), pg_temp.terms(pg_temp.req(1),1000,'Synthetic $10 off: Synthetic vendor terms')));
select is((select row(funding,discount,commission,platform_subsidy)::text from public.money_snapshot_promotions where snapshot_id=(select id from fx where key='v-snapshot')),
 '(vendor,1000,675,0)', 'the snapshot records the vendor-funded split');
select is(pg_temp.redemption(pg_temp.req(1)), 'reserved', 'not committed before payment');
insert into fx(key,id) values ('v', pg_temp.pay('v', (select id from fx where key='v-snapshot')));
select is(pg_temp.redemption(pg_temp.req(1)), 'finalized', 'payment commits the promotion');
select is(-pg_temp.net((select id from fx where key='v'),'platform_revenue'), 675::bigint, 'commission revenue $6.75');
select is(-pg_temp.net((select id from fx where key='v'),'provider_payable'), 8325::bigint, 'vendor proceeds $83.25');
select is(pg_temp.net((select id from fx where key='v'),'promotion_subsidy'), 0::bigint, 'no platform subsidy for a vendor-funded discount');
select is(private.money_payout_proceeds((select id from fx where key='v')), 8325::bigint, 'payout proceeds use the promotional commission');
select is(pg_temp.issues((select id from fx where key='v')), '[]'::jsonb, 'reconciliation agrees');

-- Full refund before service: the vendor-funded discount was not cash, so the homeowner gets
-- the $90 they paid; commission and proceeds reverse; the promotion is restored.
select pg_temp.refund('v-full',(select id from fx where key='v'),9000);
select is(-pg_temp.net((select id from fx where key='v'),'platform_revenue'), 0::bigint, 'the commission reverses in full');
select is(-pg_temp.net((select id from fx where key='v'),'provider_payable'), 0::bigint, 'the vendor proceeds reverse in full');
select is(pg_temp.redemption(pg_temp.req(1)), 'restored', 'a full refund before service restores the promotion');
select is(pg_temp.issues((select id from fx where key='v')), '[]'::jsonb, 'reconciliation agrees after the refund');

-- Mercurius-funded (first booking): $90 paid, 7.5% of $100 = $7.50, $92.50 to the vendor, $10 subsidy.
select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000002',pg_temp.req(2),null,'synthetic-promo-0002')->>'status', 'reserved',
 'the first-booking offer is reserved for request 2');
select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000002',pg_temp.req(3),null,'synthetic-promo-0003')->>'reason', 'first_booking_already_reserved',
 'a second first-booking promotion for the same homeowner is refused');
insert into fx(key,id) values ('p-snapshot', pg_temp.publish(pg_temp.req(2), pg_temp.terms(pg_temp.req(2),1000,'Synthetic welcome: Synthetic platform terms')));
insert into fx(key,id) values ('p', pg_temp.pay('p', (select id from fx where key='p-snapshot')));
select is(-pg_temp.net((select id from fx where key='p'),'platform_revenue'), 750::bigint, 'commission revenue $7.50 on the amount before the discount');
select is(-pg_temp.net((select id from fx where key='p'),'provider_payable'), 9250::bigint, 'vendor proceeds $92.50');
select is(pg_temp.net((select id from fx where key='p'),'promotion_subsidy'), 1000::bigint, 'the $10 subsidy is its own expense, apart from commission');
select is(pg_temp.issues((select id from fx where key='p')), '[]'::jsonb, 'reconciliation agrees with the subsidy');

-- Partial refund (half): proceeds, commission and subsidy reverse proportionally; no restoration.
select pg_temp.refund('p-half',(select id from fx where key='p'),4500);
select is(-pg_temp.net((select id from fx where key='p'),'platform_revenue'), 375::bigint, 'half the commission remains');
select is(pg_temp.net((select id from fx where key='p'),'promotion_subsidy'), 500::bigint, 'half the subsidy remains');
select is(-pg_temp.net((select id from fx where key='p'),'provider_payable'), 4625::bigint, 'half the vendor proceeds remain');
select is(private.money_payout_proceeds((select id from fx where key='p')), 4625::bigint, 'payout proceeds follow the retained share');
select is(pg_temp.issues((select id from fx where key='p')), '[]'::jsonb, 'reconciliation agrees after a partial refund');
select is(pg_temp.redemption(pg_temp.req(2)), 'finalized', 'a partial refund does not restore the promotion');
select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000002',pg_temp.req(3),null,'synthetic-promo-0004')->>'reason', 'first_booking_already_reserved',
 'the committed first-booking promotion still counts');

-- A documented operator exception restores it; it never reopens the offer by itself.
insert into fx(key,id) select 'p-redemption', id from private.promotion_redemptions where service_request_id=pg_temp.req(2);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select throws_ok($$select public.admin_restore_promotion((select id from fx where key='p-redemption'), ' ')$$,
 '22023', null, 'an exception needs a reason');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$select public.admin_restore_promotion(gen_random_uuid(), 'x')$$, '42501', null, 'a homeowner cannot restore a promotion');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is(public.admin_restore_promotion((select id from fx where key='p-redemption'), 'Synthetic service failure')->>'status',
 'restored', 'an operator restores it with a documented reason');
reset role;
select is((select restore_reason from private.promotion_redemptions where service_request_id=pg_temp.req(2)), 'Operator exception: Synthetic service failure',
 'the reason is recorded');
select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000002',pg_temp.req(3),null,'synthetic-promo-0005')->>'status', 'reserved',
 'after restoration the homeowner may use the offer again, within its dates and eligibility');

-- Revalidation until the homeowner commits: a completed service ends first-booking eligibility.
update public.service_requests set status='completed' where id=pg_temp.req(4);
select throws_ok($$select private.money_source(pg_temp.req(3))$$, '40001', 'Promotion no longer applies; it must be applied again',
 'a reserved first-booking promotion is checked again before checkout');
update public.service_requests set status='scheduled' where id=pg_temp.req(4);

-- Cancellation of an unpaid request releases its reservation.
-- TRACE-131: fixture state written as owner maintenance (no cancellation command exists for it).
set local mercurius.owner_maintenance = 'on';
update public.service_requests set status='cancelled' where id=pg_temp.req(3);
set local mercurius.owner_maintenance = 'off';
select is(pg_temp.redemption(pg_temp.req(3)), 'released', 'a cancelled unpaid request releases the reservation');

-- A checkout in progress keeps the reservation even if the request is cancelled meanwhile.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id,total_amount)
 select pg_temp.req(5),'b8610000-0000-4000-8000-000000000001','b8620000-0000-4000-8000-000000000001','Synthetic','Synthetic promo address','scheduled',
  service_id,'one-time','00086','fixed','b8640000-0000-4000-8000-000000000001','b8650000-0000-4000-8000-000000000001',100
 from public.vendor_packages where id='b8640000-0000-4000-8000-000000000001';
select is(private.promotion_reserve('b8660000-0000-4000-8000-000000000001',pg_temp.req(5),null,'synthetic-promo-0006')->>'status', 'reserved', 'reserved for request 5');
insert into fx(key,id) values ('c-snapshot', pg_temp.publish(pg_temp.req(5), pg_temp.terms(pg_temp.req(5),1000,'Synthetic $10 off: Synthetic vendor terms')));
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8610000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.money_prepare_checkout((select id from fx where key='c-snapshot'),'full')$$, 'the homeowner starts paying');
select set_config('request.jwt.claims','',true);
-- TRACE-131: fixture state written as owner maintenance (no cancellation command exists for it).
set local mercurius.owner_maintenance = 'on';
update public.service_requests set status='cancelled' where id=pg_temp.req(5);
set local mercurius.owner_maintenance = 'off';
select is(pg_temp.redemption(pg_temp.req(5)), 'reserved', 'a cancellation during checkout does not release the promotion the payment carries');
select is(private.promotion_release_unpaid(), 0, 'the unpaid sweep releases nothing while terms are current');

-- Add-ons come from the source too: reviewers cannot add or drop add-on cents.
select throws_ok($$select pg_temp.publish(pg_temp.req(4), pg_temp.terms(pg_temp.req(4),0,null)||'{"addons":500,"subtotal":10500,"total":10500}')$$,
 'P0001', 'Add-on amount must equal the selected add-ons', 'an offering without add-ons cannot be invoiced with add-ons');

-- Statement items carry the subsidy.
select is((select pg_get_constraintdef(oid) from pg_constraint where conname='money_ach_items_check' and conrelid='public.money_ach_items'::regclass),
 'CHECK ((amount = (((service_retained + platform_subsidy) - platform_fee) + tip_retained)))', 'a statement item balances with its subsidy');

select * from finish();
rollback;
