begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- DEC-2026-015 items 3 and 4 synthetic fixtures only. Pins the checkout boundaries the
-- private-beta configuration relies on: no promotion or discount reaches a charge without
-- approved terms, and no snapshot exists without tax evidence. No real provider, price,
-- promotion or tax rule is represented.
insert into auth.users(id,raw_user_meta_data) values('d5900000-0000-4000-8000-000000000001','{}');
insert into public.contractors(id,name,is_active,marketing_enabled) values('d5900000-0000-4000-8000-000000000011','Synthetic beta provider',true,true);
insert into public.coverage_areas(zip_code,city) values('00000','Synthetic') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id,zip_code) values('d5900000-0000-4000-8000-000000000011','00000');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('d5900000-0000-4000-8000-000000000021','d5900000-0000-4000-8000-000000000011',
   (select id from public.services_catalog where is_active order by id limit 1),'Synthetic beta offering','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name)
 values('d5900000-0000-4000-8000-000000000031','d5900000-0000-4000-8000-000000000021','one-time',100,'Synthetic tier');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id)
 values('d5900000-0000-4000-8000-000000000041','d5900000-0000-4000-8000-000000000001','d5900000-0000-4000-8000-000000000011',
   'Synthetic','Synthetic beta address','scheduled',(select service_id from public.vendor_packages where id='d5900000-0000-4000-8000-000000000021'),
   'one-time','00000','fixed','d5900000-0000-4000-8000-000000000021','d5900000-0000-4000-8000-000000000031');

create function pg_temp.promotion(p_enabled boolean,p_starts interval,p_ends interval) returns void language sql as $$
 delete from public.package_promotions where package_id='d5900000-0000-4000-8000-000000000021';
 insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
   values('d5900000-0000-4000-8000-000000000021','percent_off',10,'Synthetic offer',now()+p_starts,now()+p_ends,p_enabled) $$;
create function pg_temp.source() returns jsonb language sql as $$ select private.money_source('d5900000-0000-4000-8000-000000000041') $$;

-- Baseline: with no promotion the offering is a valid source at its full price.
select is((pg_temp.source()->>'service')::bigint,10000::bigint,'Without a promotion the offering prices at its full tier price');

-- Promotions (item 3): an enabled promotion in its window blocks the source.
select pg_temp.promotion(true,interval '-1 day',interval '1 day');
select throws_ok($$select pg_temp.source()$$,'P0001','Promotion allocation integration required',
 'An active enabled promotion blocks checkout instead of charging either price');
select pg_temp.promotion(false,interval '-1 day',interval '1 day');
select lives_ok($$select pg_temp.source()$$,'A disabled promotion does not apply');
select pg_temp.promotion(true,interval '-2 days',interval '-1 day');
select lives_ok($$select pg_temp.source()$$,'An ended promotion does not apply');
select pg_temp.promotion(true,interval '1 day',interval '2 days');
select lives_ok($$select pg_temp.source()$$,'A future promotion does not apply yet');
select pg_temp.promotion(true,interval '-2 days',interval '-1 day');
update public.service_requests set promotion_id=(select id from public.package_promotions where package_id='d5900000-0000-4000-8000-000000000021')
 where id='d5900000-0000-4000-8000-000000000041';
select throws_ok($$select pg_temp.source()$$,'P0001','Promotion allocation integration required',
 'A request that recorded a promotion stays blocked after the promotion ends');

-- Snapshots: a discount needs promotion terms and every snapshot needs tax evidence (item 4).
select ok(exists(select 1 from pg_constraint where conrelid='public.money_snapshots'::regclass and contype='c'
   and pg_get_constraintdef(oid) ~ 'discount = 0\) OR \(promotion_terms IS NOT NULL'),
 'A discounted snapshot requires promotion terms');
select ok(exists(select 1 from pg_constraint where conrelid='public.money_snapshots'::regclass and contype='c'
   and pg_get_constraintdef(oid) ~ 'length\(TRIM\(BOTH FROM tax_evidence\)\) > 0'),
 'Every snapshot requires non-empty tax evidence');
select is((select attnotnull from pg_attribute where attrelid='public.money_snapshots'::regclass and attname='tax_evidence'),true,
 'Tax evidence cannot be null');

-- No finance authority is seeded by migrations, so no snapshot can be reviewed until operators exist.
select is((select count(*) from public.money_authorities where user_id not in (select id from auth.users where id::text like 'd59%')),0::bigint,
 'No finance authority exists on a clean database');

select * from finish();
rollback;
