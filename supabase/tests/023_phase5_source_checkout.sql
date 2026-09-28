begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','{}'),('71000000-0000-4000-8000-000000000002','{}'),
 ('71000000-0000-4000-8000-000000000003','{}'),('71000000-0000-4000-8000-000000000004','{}');
insert into public.user_roles(user_id,role) values('71000000-0000-4000-8000-000000000003','admin'),('71000000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','Synthetic'),
 ('71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000003','Synthetic');
insert into public.contractors(id,name,is_active,marketing_enabled) values('72000000-0000-4000-8000-000000000001','Synthetic source provider',true,true);
insert into public.coverage_areas(zip_code,city) values('00000','Synthetic');
insert into public.contractor_service_zips(contractor_id,zip_code) values('72000000-0000-4000-8000-000000000001','00000');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
 values('75000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',(select id from public.services_catalog where is_active order by id limit 1),'Synthetic offering','fixed','one-time',true,false);
insert into public.package_tiers(id,package_id,frequency,price,name) values('76000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','one-time',100,'Synthetic tier');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id,frequency,zip_code,pricing_mode,package_id,package_tier_id)
 select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
 'Synthetic','Synthetic source address','scheduled',(select service_id from public.vendor_packages where id='75000000-0000-4000-8000-000000000001'),'one-time','00000','fixed',
 '75000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001' from generate_series(1,4)n;
insert into private.r0_lee_zips values ('00000');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
select '71000000-0000-4000-8000-000000000001','00000',service_id,
 '71000000-0000-4000-8000-000000000001'
from public.vendor_packages where id='75000000-0000-4000-8000-000000000001';

create temp table source_fixture(key text primary key,id uuid,terms jsonb);
grant select on source_fixture to authenticated;
create function pg_temp.source_terms(request uuid) returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed source','expires_at',now()+interval '1 day') $$;
create function pg_temp.approve_source(request uuid,terms jsonb) returns void language plpgsql as $$
declare previous text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000004"}',true);
 perform public.money_approve_review('71000000-0000-4000-8000-000000000003',jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Synthetic second review');
 perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;
create function pg_temp.publish_source(request uuid,terms jsonb) returns uuid language plpgsql as $$ begin
 perform pg_temp.approve_source(request,terms);
 return public.money_publish_snapshot(request,terms,'71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004'); end $$;
select ok(not has_function_privilege('authenticated','private.money_prepare_checkout(uuid,text)','EXECUTE'),'Browser cannot bypass source validation');
select ok(not has_function_privilege('service_role','private.money_publish_snapshot(uuid,jsonb,uuid,uuid)','EXECUTE'),'Service cannot bypass authoritative source intake');
select ok(not has_table_privilege('authenticated','public.money_commercial_sources','SELECT'),'Internal source evidence is private');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.money_preview_commercial_source('73000000-0000-4000-8000-000000000001')$$,'Finance can review exact offering version');
select public.admin_send_quote('73000000-0000-4000-8000-000000000001',117,'Synthetic quote',0);
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000001')$$,'P0001','Current homeowner-accepted quote required','Submitted quote is not checkout authority');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',true,(select current_quote_id from public.service_requests where id='73000000-0000-4000-8000-000000000001'));
select throws_ok($$select public.money_preview_commercial_source('73000000-0000-4000-8000-000000000001')$$,'42501','Restricted finance authority required','Homeowner cannot read internal review evidence');
insert into source_fixture(key,terms) values('quote',pg_temp.source_terms('73000000-0000-4000-8000-000000000001'));
select throws_ok($$select pg_temp.publish_source('73000000-0000-4000-8000-000000000001',(select terms||'{"total":12400}' from source_fixture where key='quote'))$$,'P0001','Checkout total must equal accepted quote','Cannot add tax on top of already accepted total');
update source_fixture set id=pg_temp.publish_source('73000000-0000-4000-8000-000000000001',terms) where key='quote';
select is(pg_temp.publish_source('73000000-0000-4000-8000-000000000001',(select terms from source_fixture where key='quote')),(select id from source_fixture where key='quote'),'Repeated source publication returns one snapshot');
select is((select total from public.money_snapshots where id=(select id from source_fixture where key='quote')),11700::bigint,'Accepted quote total preserved in cents');
select is((select source_kind from public.money_commercial_sources where snapshot_id=(select id from source_fixture where key='quote')),'quote','Quote lineage attached to snapshot');
select throws_ok($$update public.money_commercial_sources set evidence='{}'$$,'55000','Immutable financial evidence; append a correction','Source evidence cannot be rewritten');
update public.service_requests set description='Changed synthetic scope' where id='73000000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000001')$$,'P0001','Quote scope unverified or changed; send a new revision','Accepted amount cannot authorize a changed service scope');
update public.service_requests set description=null where id='73000000-0000-4000-8000-000000000001';
select throws_ok($$update public.money_quote_contexts set context='{}'$$,'55000','Immutable financial evidence; append a correction','Original quoted scope cannot be rewritten');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000003"}',true);
select public.admin_send_quote('73000000-0000-4000-8000-000000000001',117,'Synthetic replacement',1);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.money_prepare_checkout((select id from source_fixture where key='quote'),'deposit')$$,'P0001','Current homeowner-accepted quote required','Replaced quote cannot reuse checkout URL');
select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',true,(select current_quote_id from public.service_requests where id='73000000-0000-4000-8000-000000000001'));
select throws_ok($$select public.money_prepare_checkout((select id from source_fixture where key='quote'),'deposit')$$,'P0001','Commercial source changed; review current terms','Even equal-priced replacement needs new source review');
update source_fixture set terms=pg_temp.source_terms('73000000-0000-4000-8000-000000000001') where key='quote';
update source_fixture set id=pg_temp.publish_source('73000000-0000-4000-8000-000000000001',terms) where key='quote';
set local role authenticated;
select lives_ok($$select public.money_prepare_checkout((select id from source_fixture where key='quote'),'deposit')$$,'Owner checkout consumes accepted quote');
select lives_ok($$select public.money_prepare_checkout((select id from source_fixture where key='quote'),'deposit')$$,'Duplicate checkout safely reuses the attempt');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.money_prepare_checkout((select id from source_fixture where key='quote'),'deposit')$$,'42501','Homeowner authorization required','Other homeowner cannot start source checkout');
reset role;
select is((select count(*) from public.money_checkout_attempts),1::bigint,'Exactly one checkout attempt');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.admin_send_quote('73000000-0000-4000-8000-000000000001',118,'Unsafe concurrent replacement',2)$$,'P0001','Commercial checkout must be reconciled before changing source','Quote replacement cannot race a reserved provider checkout');
select is((select quote_revision from public.service_requests where id='73000000-0000-4000-8000-000000000001'),2,'Rejected replacement rolls back lifecycle revision');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);


-- Fixed offering: preserve selected tier, qualifiers and source price, never a browser total.
insert into source_fixture(key,terms) values('fixed-old',pg_temp.source_terms('73000000-0000-4000-8000-000000000002'));
select throws_ok($$select pg_temp.publish_source('73000000-0000-4000-8000-000000000002',(select terms||'{"service":1}' from source_fixture where key='fixed-old'))$$,'P0001','Service amount must equal selected offering','Cannot underpay selected offering');
update source_fixture set id=pg_temp.publish_source('73000000-0000-4000-8000-000000000002',terms) where key='fixed-old';
update public.package_tiers set price=110 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select public.money_prepare_checkout((select id from source_fixture where key='fixed-old'),'full')$$,'P0001','Commercial source changed; review current terms','Changed offering price blocks stale checkout');
select throws_ok($$select pg_temp.publish_source('73000000-0000-4000-8000-000000000002',(select terms from source_fixture where key='fixed-old'))$$,'P0001','Commercial source changed; review current terms','Stale approved source cannot be published after price edit');
insert into source_fixture(key,terms) values('fixed-new',pg_temp.source_terms('73000000-0000-4000-8000-000000000002')||'{"service":11000,"subtotal":11000,"total":12700}');
update source_fixture set id=pg_temp.publish_source('73000000-0000-4000-8000-000000000002',terms) where key='fixed-new';
select is((select service from public.money_snapshots where id=(select id from source_fixture where key='fixed-old')),10000::bigint,'Old price snapshot remains immutable');
select is((select revision from public.money_snapshots where id=(select id from source_fixture where key='fixed-new')),2,'Price revision has separate lineage');
select is((public.money_prepare_checkout((select id from source_fixture where key='fixed-new'),'full')).amount,12700::bigint,'Fresh checkout uses reviewed current offering');
select is(pg_temp.publish_source('73000000-0000-4000-8000-000000000002',(select terms from source_fixture where key='fixed-new')),(select id from source_fixture where key='fixed-new'),'Publication retry after checkout does not create another invoice');
insert into source_fixture(key,terms) values('fixed-deposit',pg_temp.source_terms('73000000-0000-4000-8000-000000000004')||'{"service":11000,"subtotal":11000,"total":12700}');
update source_fixture set id=pg_temp.publish_source('73000000-0000-4000-8000-000000000004',terms) where key='fixed-deposit';
insert into source_fixture(key,id) select 'fixed-deposit-attempt',(public.money_prepare_checkout((select id from source_fixture where key='fixed-deposit'),'deposit')).id;
select public.money_receive_event('evt_source_deposit','capture',jsonb_build_object('attempt_id',(select id from source_fixture where key='fixed-deposit-attempt'),'payment_id','pi_source_deposit','amount',3000,'currency','usd'));
select is(public.money_process_event('evt_source_deposit'),'processed','Deposit captures against the immutable fixed agreement');
update public.service_requests set status='vendor_completed' where id='73000000-0000-4000-8000-000000000004';
update public.package_tiers set price=120 where id='76000000-0000-4000-8000-000000000001';
select is((public.money_prepare_checkout((select id from source_fixture where key='fixed-deposit'),'balance')).amount,9700::bigint,'Catalog price change cannot reprice or strand an agreed deposit balance');
update public.vendor_packages set is_active=false where id='75000000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Selected offering is not eligible','Withdrawn offering cannot authorize a new commercial agreement');
select is((public.money_prepare_checkout((select id from source_fixture where key='fixed-new'),'full')).amount,12700::bigint,'Existing agreement keeps its reserved amount despite later catalog withdrawal');
update public.vendor_packages set is_active=true where id='75000000-0000-4000-8000-000000000001';
update public.contractor_service_zips set zip_code='00001' where contractor_id='72000000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Selected offering is not eligible','Exact ZIP coverage enforced');
update public.contractor_service_zips set zip_code='00000' where contractor_id='72000000-0000-4000-8000-000000000001';
update public.package_tiers set rule_question_key='size',rule_min=10,rule_max=20 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Offering answers do not match selected tier','Missing tier qualifier cannot authorize price');
update public.service_requests set package_question_answers='{"size":{"answer":"15"}}' where id='73000000-0000-4000-8000-000000000003';
select lives_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'Matching tier qualifier accepted');
update public.package_tiers set price=100.001 where id='76000000-0000-4000-8000-000000000001';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Source price must be positive whole cents','Fractional cents never silently round');
insert into public.request_quotes(id,request_id,revision,amount,sender_id,reason,sent_at,expires_at,status)
 values('74000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000003',1,117,'71000000-0000-4000-8000-000000000003','Synthetic old quote',now()-interval '2 days',now()-interval '1 day','submitted');
update public.service_requests set current_quote_id='74000000-0000-4000-8000-000000000003',quote_revision=1,quote_status='submitted' where id='73000000-0000-4000-8000-000000000003';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Current homeowner-accepted quote required','Expired unaccepted quote cannot create a snapshot');
update public.request_quotes set status='accepted',decision_actor='71000000-0000-4000-8000-000000000001',decided_at=now()-interval '47 hours' where id='74000000-0000-4000-8000-000000000003';
update public.service_requests set quote_status='accepted' where id='73000000-0000-4000-8000-000000000003';
select lives_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'Timely acceptance stays valid after the approval window closes');
update public.request_quotes set decided_at=now() where id='74000000-0000-4000-8000-000000000003';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Current homeowner-accepted quote required','Forged late acceptance fails source validation');
update public.request_quotes set status='declined' where id='74000000-0000-4000-8000-000000000003';
select throws_ok($$select private.money_source('73000000-0000-4000-8000-000000000003')$$,'P0001','Current homeowner-accepted quote required','Declined quote is not payment authority');
select pg_temp.approve_source('73000000-0000-4000-8000-000000000003',(select terms from source_fixture where key='quote'));
insert into source_fixture(key,id) values('legacy',private.money_publish_snapshot('73000000-0000-4000-8000-000000000003',(select terms from source_fixture where key='quote'),'71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004'));
select throws_ok($$select public.money_prepare_checkout((select id from source_fixture where key='legacy'),'full')$$,'P0001','Legacy snapshot requires source reconciliation','Old manual source labels cannot bypass checkout binding');
select is((select count(*) from cron.job where active),0::bigint,'No Cron activation');
select * from finish();
rollback;
