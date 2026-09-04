begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','{}'),
 ('81000000-0000-4000-8000-000000000002','{}'),
 ('81000000-0000-4000-8000-000000000003','{}');
insert into public.user_roles(user_id,role) values
 ('81000000-0000-4000-8000-000000000002','admin'),
 ('81000000-0000-4000-8000-000000000003','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic finance actor'),
 ('81000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000002','Synthetic finance reviewer');
insert into public.contractors(id,name,is_active) values
 ('82000000-0000-4000-8000-000000000001','Synthetic cancellation provider',true);
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,scheduled_start_at) values
 ('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic full cancellation','scheduled',now()+interval '73 hours'),
 ('83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic half cancellation','scheduled',now()+interval '25 hours'),
 ('83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic','Synthetic no-refund cancellation','scheduled',now()+interval '23 hours');
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id,captured) values
 ('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700),
 ('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700),
 ('84000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',11700);
insert into public.money_snapshots(id,obligation_id,revision,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at) values
 ('85000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day'),
 ('85000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day'),
 ('85000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003',1,10000,0,0,0,10000,700,1000,3000,11700,'usd','synthetic-v1','CFG-005','synthetic','81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic',now()+interval '1 day');
update public.money_obligations o set current_snapshot_id=s.id from public.money_snapshots s where s.obligation_id=o.id;
insert into public.money_checkout_attempts(id,obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,stripe_payment_id,status,expires_at,completed_at) values
 ('86000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-full','synthetic-full','pi_cancel_full','captured',now()+interval '1 day',now()),
 ('86000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-half','synthetic-half','pi_cancel_half','captured',now()+interval '1 day',now()),
 ('86000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000001','full',11700,'usd','synthetic-none','synthetic-none','pi_cancel_none','captured',now()+interval '1 day',now());

create temp table cancellation_fixture(key text primary key,id uuid,payment text);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000001"}',true);
select public.record_job_operation('83000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000001','customer_cancel','Synthetic full cancellation');
select public.record_job_operation('83000000-0000-4000-8000-000000000002','87000000-0000-4000-8000-000000000002','customer_cancel','Synthetic half cancellation');
select public.record_job_operation('83000000-0000-4000-8000-000000000003','87000000-0000-4000-8000-000000000003','customer_cancel','Synthetic no-refund cancellation');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002"}',true);
insert into cancellation_fixture
 select 'full',id,'pi_cancel_full' from public.job_operations where operation_key='87000000-0000-4000-8000-000000000001'
 union all select 'half',id,'pi_cancel_half' from public.job_operations where operation_key='87000000-0000-4000-8000-000000000002'
 union all select 'none',id,'pi_cancel_none' from public.job_operations where operation_key='87000000-0000-4000-8000-000000000003';

create function pg_temp.plan(label text) returns jsonb language sql as $$
 select public.money_preview_cancellation_refund(id,payment,'81000000-0000-4000-8000-000000000002') from cancellation_fixture where key=label $$;
create function pg_temp.command(label text,why text) returns jsonb language sql as $$
 select jsonb_build_object('operation','refund','obligation',p->>'obligation_id','payment',f.payment,
  'service',(p->>'service')::bigint,'tax',(p->>'tax')::bigint,'tip',(p->>'tip')::bigint,
  'key',p->>'business_key','policy',p->>'policy_evidence','reason',why)
 from cancellation_fixture f cross join lateral pg_temp.plan(label) p where f.key=label $$;
create function pg_temp.approve(label text,why text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000003"}',true);
  perform public.money_approve_review('81000000-0000-4000-8000-000000000002',pg_temp.command(label,why),'Synthetic cancellation review');
end $$;

select is(pg_temp.plan('full')->>'refund_percent','100','73-hour cancellation preserves approved full-refund policy');
select ok(not has_function_privilege('authenticated','public.money_preview_cancellation_refund(uuid,text,uuid)','EXECUTE'),'Browser roles cannot preview finance allocations');
select ok(not has_function_privilege('authenticated','public.money_authorize_cancellation_refund(uuid,text,uuid,uuid,text)','EXECUTE'),'Browser roles cannot authorize refunds');
select is(pg_temp.plan('full')->>'service','10000','Full cancellation allocates retained service');
select is(pg_temp.plan('full')->>'tax','700','Full cancellation allocates tax separately');
select is(pg_temp.plan('full')->>'tip','1000','Full cancellation allocates tip separately');
select is(pg_temp.plan('half')->>'refund_percent','50','25-hour cancellation preserves approved half-refund policy');
select is(pg_temp.plan('half')->>'service','5000','Half cancellation allocates half of service');
select is(pg_temp.plan('half')->>'tax','350','Half cancellation allocates half of tax');
select is(pg_temp.plan('half')->>'tip','500','Half cancellation allocates half of tip');
select is(pg_temp.plan('none')->>'service','0','Under-24-hour policy produces no provider refund work');
select pg_temp.approve('full','Synthetic approved full cancellation');
insert into cancellation_fixture values('full-authorization',
  public.money_authorize_cancellation_refund((select id from cancellation_fixture where key='full'),'pi_cancel_full',
   '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic approved full cancellation'),null);
select is(public.money_authorize_cancellation_refund((select id from cancellation_fixture where key='full'),'pi_cancel_full',
 '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Synthetic approved full cancellation'),
 (select id from cancellation_fixture where key='full-authorization'),'Cancellation refund retry is stable');
select throws_ok($$select public.money_authorize_cancellation_refund((select id from cancellation_fixture where key='full'),'pi_cancel_full',
 '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','Changed reason')$$,
 'P0001','Cancellation refund idempotency conflict','Changed retry intent is rejected');
select is((select count(*) from public.money_operation_refund_sources),1::bigint,'One immutable operation-to-refund source recorded');
select throws_ok($$update public.money_operation_refund_sources set service=1$$,'55000','Immutable financial evidence; append a correction','Source evidence cannot be rewritten');
select throws_ok($$update public.job_operations set policy_assessment='{}' where operation_key='87000000-0000-4000-8000-000000000001'$$,
 '55000','Immutable financial evidence; append a correction','Cancellation assessment cannot be rewritten after becoming money evidence');
select throws_ok($$select public.money_authorize_cancellation_refund((select id from cancellation_fixture where key='none'),'pi_cancel_none',
 '81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','No refund')$$,
 'P0001','Cancellation policy produces no refund for this payment','Zero-refund outcome cannot create provider work');
insert into public.job_operations(job_id,operation_key,actor_id,kind,reason,before_value,policy_assessment)
 values('83000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000004',
 '81000000-0000-4000-8000-000000000002','provider_cancel','Synthetic provider cancellation','{}',
 '{"policy":"CFG-006/007","refund_if_no_acceptable_replacement":100,"requires_operations":true}');
select throws_ok($$select public.money_preview_cancellation_refund(
 (select id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000004'),'pi_cancel_full','81000000-0000-4000-8000-000000000002')$$,
 'P0001','Recorded no-replacement decision required for provider cancellation','Provider cancellation cannot skip replacement evidence');
select * from finish();
rollback;
