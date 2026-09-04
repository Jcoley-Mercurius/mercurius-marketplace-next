begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('51000000-0000-4000-8000-000000000002','{"full_name":"Synthetic other homeowner"}'),
 ('51000000-0000-4000-8000-000000000003','{"full_name":"Synthetic finance operator"}'),
 ('51000000-0000-4000-8000-000000000004','{"full_name":"Synthetic finance reviewer"}');
insert into public.user_roles(user_id,role) values
 ('51000000-0000-4000-8000-000000000003','admin'),('51000000-0000-4000-8000-000000000004','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','Synthetic test'),
 ('51000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000003','Synthetic test');
insert into public.contractors(id,name,is_active) values('52000000-0000-4000-8000-000000000001','Synthetic provider',false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('53000000-0000-4000-8000-000000000001','Synthetic provider','Test','Fixture','vendor@example.invalid','synthetic','52000000-0000-4000-8000-000000000001');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
 values('54000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','house-cleaning','Synthetic address');
create temp table f(key text primary key,id uuid);
grant select on f to authenticated;
create function pg_temp.terms() returns jsonb language sql as $$ select jsonb_build_object(
 'service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',0,'total',11700,'currency','usd',
 'source_version','synthetic-offering-v1','policy_version','CFG-005','tax_evidence','synthetic-tax-decision','reason','Synthetic reviewed quote','expires_at',now()+interval '1 day') $$;
create function pg_temp.approve(command jsonb) returns void language plpgsql as $$
declare previous text;
begin
  previous:=current_setting('request.jwt.claims',true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000004"}',true);
  perform public.money_approve_review('51000000-0000-4000-8000-000000000003',command,'Synthetic second-person review');
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
end $$;

-- Synthetic funding/onboarding setup isolates this adapter; 020 exercises provider capture and journals.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select public.vendor_begin_review('52000000-0000-4000-8000-000000000001',(select id from public.vendor_application_versions limit 1));
do $$ declare kind text; begin
  foreach kind in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
    perform public.vendor_record_evidence('52000000-0000-4000-8000-000000000001',kind,'synthetic-rule','private-synthetic-'||kind,now()-interval '1 hour',now()+interval '1 year');
  end loop;
end $$;
select public.vendor_decide_onboarding('52000000-0000-4000-8000-000000000001',1,'activate','Synthetic review','activate');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address)
select ('54000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','house-cleaning','Synthetic address' from generate_series(2,5) n;
create function pg_temp.ob(n integer) returns uuid language sql as $$ select id from public.money_obligations where service_request_id=('54000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- Ledger setup supports the independently reviewed PR #7 private intake kernel.
create function pg_temp.publish(request uuid) returns void language plpgsql as $$ begin
  if to_regprocedure('private.money_publish_snapshot(uuid,jsonb,uuid,uuid)') is not null then
    perform private.money_publish_snapshot(request,pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004');
  else
    perform public.money_publish_snapshot(request,pg_temp.terms(),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004');
  end if;
end $$;
do $$ declare request uuid; begin
  for request in select id from public.service_requests where id::text like '54000000-%' loop
    perform pg_temp.approve(jsonb_build_object('operation','snapshot','request',request,'terms',pg_temp.terms()));
    perform pg_temp.publish(request);
  end loop;
end $$;
update public.money_obligations set captured=11700 where service_request_id::text like '54000000-%';
update public.service_requests set status='vendor_completed',vendor_completed_at=now()-interval '4 days',photo_proof_urls=array['synthetic-proof'] where id::text like '54000000-%';
-- END CONCURRENCY SETUP
select throws_ok($$select public.money_record_completion(pg_temp.ob(1),'51000000-0000-4000-8000-000000000001',now()-interval '1 year','manual-label')$$,'P0001','Verified lifecycle confirmation required','Service input cannot manufacture homeowner confirmation');
select ok(not has_function_privilege('authenticated','private.transition_job_status(uuid,public.request_status,text,jsonb)','EXECUTE'),'No browser bypass of confirmation capture');
select ok(not has_function_privilege('service_role','private.money_prepare_ach(date,uuid[],uuid,uuid,text,text)','EXECUTE'),'No service bypass of payout bridge');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.homeowner_confirm_job('54000000-0000-4000-8000-000000000001')$$,'P0001',null,'Other homeowner cannot create confirmation receipt');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.homeowner_confirm_job('54000000-0000-4000-8000-000000000001')$$,'Canonical homeowner action captures confirmation');
select throws_ok($$insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at) values(null,null,null,now())$$,'42501',null,'Browser cannot insert receipt directly');
reset role;
select is((select count(*) from public.money_lifecycle_confirmations),1::bigint,'Exactly one captured receipt');
select is((select confirmed_at from public.money_lifecycle_confirmations),now(),'Receipt uses server transition time');
select throws_ok($$select public.money_payable(pg_temp.ob(1))$$,'P0001','48 hours after homeowner confirmation required','Old vendor completion does not shorten homeowner clock');
select throws_ok($$update public.money_lifecycle_confirmations set confirmed_at=now()-interval '48 hours'$$,'55000','Immutable financial evidence; append a correction','Receipt cannot be backdated');
-- Historical boundary fixtures are inserted only as the isolated database owner.
update public.service_requests set status='completed',homeowner_confirmed_at=now()-interval '48 hours'+case right(id::text,1) when '3' then interval '1 microsecond' when '4' then -interval '1 microsecond' else interval '0' end
 where right(id::text,1) in ('2','3','4','5') and id::text like '54000000-%';
insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
 select id,customer_id,contractor_id,homeowner_confirmed_at from public.service_requests where right(id::text,1) in ('2','3','4') and id::text like '54000000-%';
select throws_ok($$select public.money_payable(pg_temp.ob(5))$$,'P0001','Verified lifecycle confirmation required','Legacy completed timestamp is not verified evidence');
select throws_ok($$select public.money_payable(pg_temp.ob(3))$$,'P0001','48 hours after homeowner confirmation required','One microsecond before eligibility is held');
select is(public.money_payable(pg_temp.ob(2)),9500::bigint,'Exactly 48h: 85 percent subtotal plus all tips');
select is(public.money_payable(pg_temp.ob(4)),9500::bigint,'After 48h remains eligible');
select is(public.money_payable(pg_temp.ob(2)),9500::bigint,'Replay preserves confirmation evidence');
select is((select count(*) from public.money_completion_evidence where obligation_id=pg_temp.ob(2)),1::bigint,'One obligation confirmation binding');
select throws_ok($$select public.money_record_completion(pg_temp.ob(2),'51000000-0000-4000-8000-000000000001',now()-interval '48 hours','invented')$$,'P0001','Confirmation source mismatch','Correct timestamp with invented reference is rejected');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select pg_temp.approve(jsonb_build_object('operation','ach','period',current_date,'obligations',array[pg_temp.ob(2)],'bank_ref','private-form','reason','Synthetic weekly ACH'));
insert into f values('batch',public.money_prepare_ach(current_date,array[pg_temp.ob(2)],'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004','private-form','Synthetic weekly ACH'));
insert into f select 'attempt',a.id from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id where i.batch_id=(select id from f where key='batch');
insert into f select 'item',item_id from public.money_ach_attempts where id=(select id from f where key='attempt');
select is((select confirmation_ref from public.money_ach_items where id=(select id from f where key='item')),(select 'phase4-confirmation:'||id from public.money_lifecycle_confirmations where request_id='54000000-0000-4000-8000-000000000002'),'Statement binds immutable lifecycle receipt');
-- Seed a resolved dispute; the real appeal and resolution RPCs drive all subsequent holds.
insert into public.disputes(id,job_id,homeowner_id,vendor_id,reason,status,resolution_version,resolution_notes)
 values('56000000-0000-4000-8000-000000000001','54000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','Synthetic dispute','resolved',1,'Synthetic original resolution');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.appeal_dispute_resolution('56000000-0000-4000-8000-000000000001','Synthetic appeal')$$,'Appeal after preparation is accepted');
select throws_ok($$select public.money_payable(pg_temp.ob(2))$$,'P0001','Lifecycle dispute or completion hold','Appeal holds aged confirmed funds');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"51000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.money_record_ach((select id from f where key='attempt'),'submitted','synthetic-bank','51000000-0000-4000-8000-000000000003','Synthetic submission','submit')$$,'P0001','Lifecycle dispute or completion hold','New appeal blocks submission of a prepared statement');
select is((select status from public.money_ach_attempts where id=(select id from f where key='attempt')),'prepared','Rejected submission has no bank state effect');
select public.admin_resolve_dispute('56000000-0000-4000-8000-000000000001','resolved','Synthetic appeal resolution');
select is(public.money_payable(pg_temp.ob(2)),9500::bigint,'Resolution preserves original clock, no new timer');
update public.support_tickets set status='open' where id in(select ticket_id from public.dispute_appeals);
select throws_ok($$select public.money_payable(pg_temp.ob(2))$$,'P0001','Lifecycle dispute or completion hold','Open appeal ticket cannot be hidden by resolved dispute');
update public.support_tickets set status='resolved' where id in(select ticket_id from public.dispute_appeals);
select public.money_record_ach((select id from f where key='attempt'),'submitted','synthetic-bank','51000000-0000-4000-8000-000000000003','Synthetic submission','submit');
update public.service_requests set disputed=true where id='54000000-0000-4000-8000-000000000002';
select lives_ok($$select public.money_record_ach((select id from f where key='attempt'),'settled','synthetic-bank','51000000-0000-4000-8000-000000000003','Synthetic settlement readback','settled')$$,'Already submitted bank settlement is recorded despite later hold');
select is((select count(*) from public.money_journals where kind='ach_settled'),1::bigint,'Settlement posts once, no silent bank outcome loss');
select public.money_record_ach((select id from f where key='attempt'),'returned','synthetic-bank','51000000-0000-4000-8000-000000000003','Synthetic bank return','returned');
select pg_temp.approve(jsonb_build_object('operation','ach_retry','item',(select id from f where key='item')));
select throws_ok($$select public.money_retry_ach((select id from f where key='item'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004')$$,'P0001','Lifecycle dispute or completion hold','Returned transfer cannot retry under live lifecycle hold');
update public.service_requests set disputed=false where id='54000000-0000-4000-8000-000000000002';
select lives_ok($$select public.money_retry_ach((select id from f where key='item'),'51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000004')$$,'Resolved hold permits evidenced return retry');
update public.service_requests set status='in_progress' where id='54000000-0000-4000-8000-000000000002';
select throws_ok($$select public.money_payable(pg_temp.ob(2))$$,'P0001','Lifecycle dispute or completion hold','Rework cannot reuse old confirmation for payout');
update public.service_requests set status='completed',homeowner_confirmed_at=now() where id='54000000-0000-4000-8000-000000000002';
select throws_ok($$select public.money_payable(pg_temp.ob(2))$$,'P0001','Verified lifecycle confirmation required','Changed timestamp cannot reuse old receipt');
select is((select count(*) from cron.job where active),0::bigint,'No scheduler activated');
select * from finish();
rollback;
