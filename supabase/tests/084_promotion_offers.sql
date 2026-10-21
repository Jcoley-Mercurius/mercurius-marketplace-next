-- TRACE-114 (20261018003000), DEC-2026-038. Synthetic fixtures only; offer amounts are test
-- examples, not campaigns. Promotional commission economics, offer authorization, trusted
-- eligibility, limits, budget, idempotency and the gated restoration.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 operator; 2 vendor bound to provider 1; 3 homeowner; 4 second homeowner; provider 2 unbound.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8410000-0000-4000-8000-000000000001','promo-operator@example.invalid',now()),
 ('b8410000-0000-4000-8000-000000000002','promo-vendor@example.invalid',now()),
 ('b8410000-0000-4000-8000-000000000003','promo-homeowner@example.invalid',now()),
 ('b8410000-0000-4000-8000-000000000004','promo-homeowner-two@example.invalid',now());
delete from public.user_roles where user_id='b8410000-0000-4000-8000-000000000002';
insert into public.user_roles(user_id,role) values
 ('b8410000-0000-4000-8000-000000000001','admin'),('b8410000-0000-4000-8000-000000000002','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b8420000-0000-4000-8000-000000000001','Synthetic promo vendor',true,true,'b8410000-0000-4000-8000-000000000002'),
 ('b8420000-0000-4000-8000-000000000002','Synthetic unbound promo vendor',true,true,null);
insert into public.service_categories(id,name) values ('synthetic-promo-cat','Synthetic promo category');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active) values
 ('synthetic-promo-svc','Synthetic promo service','synthetic-promo-cat',100,60,'one-time','{one-time}',true),
 ('synthetic-promo-other','Synthetic other service','synthetic-promo-cat',100,60,'one-time','{one-time}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00084','Synthetic covered',true,false),('00085','Synthetic covered two',true,false);
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('b8440000-0000-4000-8000-000000000001','b8420000-0000-4000-8000-000000000001','synthetic-promo-svc','Synthetic promo package','fixed','one-time',true,false),
 ('b8440000-0000-4000-8000-000000000002','b8420000-0000-4000-8000-000000000001','synthetic-promo-svc','Synthetic other package','fixed','one-time',true,false);
-- Requests with a confirmed provider and an exact $100 service amount.
create function pg_temp.request(p_n integer, p_customer integer default 3, p_package integer default 1, p_zip text default '00084',
  p_amount numeric default 100, p_service text default 'synthetic-promo-svc') returns uuid language sql as $$
 insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,
   package_id,pricing_mode,total_amount,status)
 values (('b8450000-0000-4000-8000-0000000000'||lpad(p_n::text,2,'0'))::uuid,
   ('b8410000-0000-4000-8000-00000000000'||p_customer)::uuid,'b8420000-0000-4000-8000-000000000001','Synthetic',p_service,
   '1 Synthetic Way','Synthetic','FL',p_zip,'one-time',('b8440000-0000-4000-8000-00000000000'||p_package)::uuid,'fixed',p_amount,'scheduled')
 returning id $$;

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8410000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.terms(p jsonb) returns jsonb language sql as $$
 select jsonb_build_object('label','Synthetic offer','terms','Synthetic terms; one per booking.',
   'starts_at',now() - interval '1 day','ends_at',now() + interval '30 days','timezone','America/New_York') || p $$;
create function pg_temp.fp(p_offer uuid) returns text language sql security definer as $$
 select content_hash from private.promotion_offers where id = p_offer $$;
create function pg_temp.stamp(p_offer uuid) returns timestamptz language sql security definer as $$
 select updated_at from private.promotion_offers where id = p_offer $$;
create temp table ids(name text primary key, id uuid);
grant all on ids to authenticated;

-- Economics: test fixture 11 and the ordinary rate --------------------------------------
select is(private.promotion_economics(10000, 1000, 'vendor') - 'funding',
 '{"eligible_cents":10000,"discount_cents":1000,"homeowner_service_cents":9000,"commission_rate_bps":750,"commission_base_cents":9000,"commission_cents":675,"vendor_proceeds_cents":8325,"platform_subsidy_cents":0}'::jsonb,
 'vendor-funded: $100 less $10 is $90 paid, $6.75 commission, $83.25 to the vendor');
select is(private.promotion_economics(10000, 1000, 'platform') - 'funding',
 '{"eligible_cents":10000,"discount_cents":1000,"homeowner_service_cents":9000,"commission_rate_bps":750,"commission_base_cents":10000,"commission_cents":750,"vendor_proceeds_cents":9250,"platform_subsidy_cents":1000}'::jsonb,
 'Mercurius-funded: $90 paid, $7.50 commission, $92.50 to the vendor, $10 subsidy kept apart');
select is(private.promotion_economics(10000, 0, null) - 'funding',
 '{"eligible_cents":10000,"discount_cents":0,"homeowner_service_cents":10000,"commission_rate_bps":1500,"commission_base_cents":10000,"commission_cents":1500,"vendor_proceeds_cents":8500,"platform_subsidy_cents":0}'::jsonb,
 'an ordinary booking keeps 15%');
select is((private.promotion_economics(4995, 0, 'vendor')->>'commission_cents')::bigint, 375::bigint,
 'a promotional package pays 7.5% of its actual price, rounded half away from zero');
select throws_ok($$select private.promotion_economics(10000, 500, null)$$, '22023', 'Invalid promotion amounts',
 'a discount without a funder is refused');
select throws_ok($$select private.promotion_economics(10000, 10000, 'vendor')$$, '22023', 'Invalid promotion amounts',
 'a discount cannot cover the whole service');

-- Grants ---------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated','private.promotion_reserve(uuid,uuid,text,text)','execute'),
 'no signed-in caller can reserve a promotion directly');
select ok(not has_table_privilege('authenticated','private.promotion_offers','select'), 'offers are not directly readable');
select ok(not has_function_privilege('anon','public.admin_save_promotion_offer(uuid,timestamptz,jsonb)','execute'), 'anonymous callers cannot save offers');

-- Authorization ----------------------------------------------------------------------------
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select public.admin_save_promotion_offer(null,null,pg_temp.terms('{"funding":"vendor","kind":"amount","amount_cents":1000}'))$$,
 '22023', 'A vendor-funded offer names its vendor', 'a vendor-funded offer names its vendor');
select throws_ok($$select public.admin_save_promotion_offer(null,null,pg_temp.terms('{"funding":"platform","kind":"amount","amount_cents":1000}'))$$,
 '22023', 'A Mercurius-funded offer needs a budget', 'a Mercurius-funded offer needs a budget');
select throws_ok($$select public.admin_save_promotion_offer(null,null,pg_temp.terms('{"funding":"platform","kind":"percent","percent_bps":9000,"budget_cents":100000}'))$$,
 '22023', 'A percentage is between 0.01% and 80%', 'a percentage is capped at 80%');
select throws_ok($$select public.admin_save_promotion_offer(null,null,pg_temp.terms('{"funding":"platform","kind":"package_price","budget_cents":100000,"package_lineage_ids":["b8440000-0000-4000-8000-000000000001"]}'))$$,
 '22023', 'A promotional package is one vendor-funded package', 'a promotional package is vendor-funded');
select throws_ok($$select public.admin_save_promotion_offer(null,null,pg_temp.terms('{"funding":"vendor","kind":"amount","amount_cents":1000,"contractor_id":"b8420000-0000-4000-8000-000000000002","package_lineage_ids":["b8440000-0000-4000-8000-000000000001"]}'))$$,
 '22023', 'Choose packages of this vendor', 'an offer cannot reach another vendor''s package');

insert into ids select 'vendor', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  '{"funding":"vendor","kind":"amount","amount_cents":1000,"contractor_id":"b8420000-0000-4000-8000-000000000001","package_lineage_ids":["b8440000-0000-4000-8000-000000000001"],"max_redemptions":2}'))->>'id')::uuid;
insert into ids select 'platform', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  '{"funding":"platform","kind":"amount","amount_cents":1000,"budget_cents":1500,"service_ids":["synthetic-promo-svc"]}'))->>'id')::uuid;
insert into ids select 'unbound', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  '{"funding":"vendor","kind":"percent","percent_bps":1000,"contractor_id":"b8420000-0000-4000-8000-000000000002"}'))->>'id')::uuid;

select is((public.admin_promotion_offers()->0->'example'->>'commission_rate_bps')::int, 750, 'operators see the 7.5% rate');
select is(public.admin_send_promotion_for_vendor_approval((select id from ids where name='unbound'), pg_temp.fp((select id from ids where name='unbound'))) - 'offer',
 '{"status":"blocked","reason":"No vendor account is bound to this provider"}'::jsonb, 'an unbound vendor cannot be asked to fund an offer');
select throws_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='vendor'), pg_temp.fp((select id from ids where name='vendor')), 'x')$$,
 'P0001', 'Only a Mercurius-funded offer is authorized by an operator', 'an operator cannot approve vendor funding');
select throws_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='platform'), pg_temp.fp((select id from ids where name='platform')), ' ')$$,
 'P0001', 'Authorization reason required', 'platform funding needs a reason');
select throws_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='platform'), 'stale', 'Synthetic welcome budget')$$,
 '40001', 'Offer changed since it was read; reload before authorizing', 'the operator authorizes the revision read');
select is(public.admin_authorize_platform_promotion((select id from ids where name='platform'), pg_temp.fp((select id from ids where name='platform')),
 'Synthetic welcome budget')->>'status', 'approved', 'an operator authorizes a Mercurius-funded offer');
select is(public.admin_send_promotion_for_vendor_approval((select id from ids where name='vendor'), pg_temp.fp((select id from ids where name='vendor')))->>'status',
 'sent', 'a vendor-funded offer is sent to the bound vendor');
reset role;

-- Reservations need approval of the current revision.
select pg_temp.request(1);
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000001',null,'synthetic-key-0001')->>'reason',
 'offer_not_approved', 'an offer awaiting the vendor cannot be applied');

select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select public.vendor_approve_promotion_offer((select id from ids where name='vendor'), repeat('0',64))$$,
 '40001', 'This offer changed since you opened it; reload to review the current version', 'a stale vendor approval is refused');
select is(public.vendor_approve_promotion_offer((select id from ids where name='vendor'), pg_temp.fp((select id from ids where name='vendor')))->>'status',
 'approved', 'the vendor approves the offer it funds');
select throws_ok($$select public.vendor_approve_promotion_offer((select id from ids where name='platform'), pg_temp.fp((select id from ids where name='platform')))$$,
 'P0002', 'Offer not found', 'a vendor cannot approve Mercurius funding');
select ok(not (public.vendor_promotion_offers()->0 ? 'authorization_reason'), 'the vendor view carries no internal notes');
select is((public.vendor_promotion_offers()->0->'example'->>'vendor_proceeds_cents')::int, 8325, 'the vendor sees its proceeds on the worked example');
reset role;

-- Trusted eligibility and the snapshot ------------------------------------------------------
create temp table res as select private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000001',null,'synthetic-key-0001') r;
select is((select r->>'status' from res), 'reserved', 'a qualifying request reserves the offer');
select is((select (r->'redemption'->>'commission_cents')::int from res), 675, 'the redemption snapshots 7.5% of the discounted amount');
select is((select r->>'reused' from res), 'false', 'first reservation');
select is((private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000001',null,'synthetic-key-0001')->>'reused'),
 'true', 'a retry with the same key returns the same reservation');
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000001',null,'synthetic-key-9999')->>'reason',
 'promotion_already_applied', 'a second redemption for the same request is not created');
select is(private.promotion_reserve((select id from ids where name='platform'),'b8450000-0000-4000-8000-000000000001',null,'synthetic-key-0002')->>'reason',
 'promotion_already_applied', 'one promotion per booking: relief is never applied twice');

select pg_temp.request(2, 3, 2);
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000002',null,'synthetic-key-0003')->>'reason',
 'package_not_included', 'a package outside the offer is not discounted');
select pg_temp.request(3, 3, 1, '00084', 100, 'synthetic-promo-other');
select is(private.promotion_reserve((select id from ids where name='platform'),'b8450000-0000-4000-8000-000000000003',null,'synthetic-key-0004')->>'reason',
 'service_not_included', 'a service outside the offer is not discounted');

-- A repeat booking with a valid promotion still gets 7.5%; without one it keeps 15%.
select pg_temp.request(4);
create temp table res2 as select private.promotion_reserve((select id from ids where name='platform'),'b8450000-0000-4000-8000-000000000004',null,'synthetic-key-0005') r;
select is((select (r->'redemption'->>'commission_rate_bps')::int from res2), 750, 'a repeat booking with a valid promotion pays 7.5%');
select is((select (r->'redemption'->>'commission_base_cents')::int from res2), 10000, 'Mercurius funding keeps the vendor''s full base');
select is((select (r->'redemption'->>'platform_subsidy_cents')::int from res2), 1000, 'and records the subsidy separately');

-- Budget: $15 platform budget covers one $10 subsidy, not two.
select pg_temp.request(5, 4);
select is(private.promotion_reserve((select id from ids where name='platform'),'b8450000-0000-4000-8000-000000000005',null,'synthetic-key-0006')->>'reason',
 'budget_exhausted', 'the platform budget cannot be overspent');
-- Limit: two redemptions of the vendor offer.
select pg_temp.request(6, 4);
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000006',null,'synthetic-key-0007')->>'status',
 'reserved', 'the second of two redemptions reserves');
select pg_temp.request(7, 4);
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000007',null,'synthetic-key-0008')->>'reason',
 'redemption_limit_reached', 'the limit cannot be exceeded');

-- Releasing a reservation frees it; restoring a finalized one is refused (no approved rule).
select is(private.promotion_release((select (r->'redemption'->>'id')::uuid from res2), 'Synthetic quote declined')->>'status',
 'released', 'a reservation that never committed is released');
select is(private.promotion_reserve((select id from ids where name='platform'),'b8450000-0000-4000-8000-000000000005',null,'synthetic-key-0009')->>'status',
 'reserved', 'released budget can be used again');
select is(private.promotion_finalize((select (r->'redemption'->>'id')::uuid from res))->>'status', 'finalized', 'the agreement commits the redemption');
select is(private.promotion_finalize((select (r->'redemption'->>'id')::uuid from res))->>'status', 'finalized', 'a retried finalization is harmless');
select throws_ok($$select private.promotion_release((select (r->'redemption'->>'id')::uuid from res), 'Synthetic cancellation')$$,
 '0A000', 'Restoring a promotion after a finalized booking has no approved rule', 'restoring after cancellation stays gated');

-- Editing an approved offer is a new revision: it stops applying until approved again, and
-- the finalized redemption keeps its terms.
select pg_temp.as_user('1');
set local role authenticated;
select is(public.admin_save_promotion_offer((select id from ids where name='vendor'), pg_temp.stamp((select id from ids where name='vendor')), pg_temp.terms(
  '{"funding":"vendor","kind":"amount","amount_cents":2000,"contractor_id":"b8420000-0000-4000-8000-000000000001","package_lineage_ids":["b8440000-0000-4000-8000-000000000001"],"max_redemptions":2}'))->>'status',
 'draft', 'a changed amount needs the vendor''s approval again');
reset role;
select pg_temp.request(8, 4);
select is(private.promotion_reserve((select id from ids where name='vendor'),'b8450000-0000-4000-8000-000000000008',null,'synthetic-key-0010')->>'reason',
 'offer_not_approved', 'an unapproved revision cannot be applied');
select is((select discount_cents from private.promotion_redemptions where id=(select (r->'redemption'->>'id')::uuid from res)), 1000::bigint,
 'the finalized redemption is not repriced');
select throws_ok($$select private.promotion_finalize((select id from private.promotion_redemptions where idempotency_key='synthetic-key-0007'))$$,
 '40001', 'The offer changed since it was reserved; reserve again', 'a reservation of an older revision cannot be finalized');

-- Dates, codes, first booking and minimum spend from trusted records.
select pg_temp.as_user('1');
set local role authenticated;
insert into ids select 'coded', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  '{"funding":"platform","kind":"percent","percent_bps":2000,"max_discount_cents":1500,"budget_cents":100000,"code":"Welcome-24","first_booking_only":true,"min_spend_cents":5000}'))->>'id')::uuid;
select lives_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='coded'), pg_temp.fp((select id from ids where name='coded')), 'Synthetic')$$, 'authorized');
insert into ids select 'expired', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  jsonb_build_object('funding','platform','kind','amount','amount_cents',500,'budget_cents',100000,'starts_at',now() - interval '2 days','ends_at',now())))->>'id')::uuid;
select lives_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='expired'), pg_temp.fp((select id from ids where name='expired')), 'Synthetic')$$, 'authorized');
insert into ids select 'starts', (public.admin_save_promotion_offer(null,null,pg_temp.terms(
  jsonb_build_object('funding','platform','kind','amount','amount_cents',500,'budget_cents',100000,'starts_at',now(),'ends_at',now() + interval '1 day')))->>'id')::uuid;
select lives_ok($$select public.admin_authorize_platform_promotion((select id from ids where name='starts'), pg_temp.fp((select id from ids where name='starts')), 'Synthetic')$$, 'authorized');
reset role;
insert into auth.users(id,email,email_confirmed_at) values ('b8410000-0000-4000-8000-000000000005','promo-new@example.invalid',now());
select pg_temp.request(9, 5, 1, '00085', 40);
select is(private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000009','WELCOME-24','synthetic-key-0011')->>'reason',
 'below_minimum_spend', 'the minimum eligible spend is enforced');
update public.service_requests set total_amount=200 where id='b8450000-0000-4000-8000-000000000009';
select is(private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000009','wrong','synthetic-key-0012')->>'reason',
 'code_required', 'a wrong code does not apply');
select is((private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000009',' welcome-24 ','synthetic-key-0013')->'redemption'->>'discount_cents')::int,
 1500, 'the code matches regardless of case and the percentage is capped');
-- DEC-2026-041 item 3: only a completed Marketplace service ends first-booking eligibility.
select is(private.promotion_has_completed_service('b8410000-0000-4000-8000-000000000004', null), false,
 'scheduled requests do not end first-booking eligibility');
update public.service_requests set status='completed' where id='b8450000-0000-4000-8000-000000000005';
select is(private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000008','WELCOME-24','synthetic-key-0014')->>'reason',
 'not_first_booking', 'a completed service ends first-booking eligibility');
select is(private.promotion_reserve((select id from ids where name='expired'),'b8450000-0000-4000-8000-000000000008',null,'synthetic-key-0015')->>'reason',
 'expired', 'an offer ending now no longer applies');
select is(private.promotion_reserve((select id from ids where name='starts'),'b8450000-0000-4000-8000-000000000008',null,'synthetic-key-0016')->>'status',
 'reserved', 'an offer starting now applies');
-- One active first-booking redemption per homeowner; a cancelled unpaid request frees it.
select pg_temp.request(10, 5, 1, '00085', 200);
select is(private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000010','WELCOME-24','synthetic-key-0017')->>'reason',
 'first_booking_already_reserved', 'a second first-booking promotion is refused while one is active');
select throws_ok($$insert into private.promotion_redemptions(offer_id, offer_revision, offer_hash, service_request_id, customer_id, contractor_id,
   idempotency_key, funding, eligible_cents, discount_cents, homeowner_service_cents, commission_rate_bps, commission_base_cents,
   commission_cents, vendor_proceeds_cents, platform_subsidy_cents, first_booking)
  select offer_id, offer_revision, offer_hash, 'b8450000-0000-4000-8000-000000000010', customer_id, contractor_id, 'synthetic-key-race',
   funding, eligible_cents, discount_cents, homeowner_service_cents, commission_rate_bps, commission_base_cents, commission_cents,
   vendor_proceeds_cents, platform_subsidy_cents, true from private.promotion_redemptions where idempotency_key='synthetic-key-0013'$$,
 '23505', null, 'the database refuses a concurrent second first-booking redemption');
update public.service_requests set status='cancelled' where id='b8450000-0000-4000-8000-000000000009';
select is((select status from private.promotion_redemptions where idempotency_key='synthetic-key-0013'), 'released',
 'cancelling the unpaid request releases its reservation');
select is(private.promotion_reserve((select id from ids where name='coded'),'b8450000-0000-4000-8000-000000000010','WELCOME-24','synthetic-key-0018')->>'status',
 'reserved', 'a cancelled request does not consume first-booking eligibility');

-- Usage reporting keeps vendor discount, subsidy and commission relief apart.
select pg_temp.as_user('1');
set local role authenticated;
select is((select o->'usage' from jsonb_array_elements(public.admin_promotion_offers()) o where (o->>'id')::uuid=(select id from ids where name='vendor')),
 '{"reserved":1,"finalized":1,"released":0,"subsidy_committed_cents":0,"vendor_discount_cents":2000,"commission_relief_cents":1350}'::jsonb,
 'vendor discount, subsidy and commission relief are reported separately');
select is((select array_agg(e->>'kind') from jsonb_array_elements(public.admin_promotion_offer_events((select id from ids where name='vendor'))) e),
 array['saved','sent','vendor_approved','saved'], 'the offer history records each step');
reset role;

select * from finish();
rollback;
