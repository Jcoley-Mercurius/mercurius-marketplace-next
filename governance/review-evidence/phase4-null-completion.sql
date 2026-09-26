-- Review reproduction, not an acceptance suite. Expected current behavior demonstrates P4-R1.
-- Run only on the fixed isolated synthetic stack; all SQL changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select is(private.support_response_deadline('2026-09-04 20:00:00Z'), '2026-09-07 20:00:00Z'::timestamptz,'Friday afternoon response due Monday afternoon');
select is(private.support_response_deadline('2026-03-06 21:00:00Z'), '2026-03-09 20:00:00Z'::timestamptz,'support business hours preserve Eastern time across DST');
select is(private.support_response_deadline('2026-09-05 12:00:00Z'), '2026-09-07 21:00:00Z'::timestamptz,'weekend receipt begins next business day');
insert into auth.users(id,raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001','{"full_name":"Synthetic owner"}'),
 ('81000000-0000-4000-8000-000000000002','{"full_name":"Synthetic vendor"}'),
 ('81000000-0000-4000-8000-000000000003','{"full_name":"Synthetic admin"}');
insert into public.user_roles(user_id,role) values ('81000000-0000-4000-8000-000000000003','admin');
insert into public.contractors(id,user_id,name) values ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','Synthetic proof provider');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id)
 values('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','Synthetic proof','Synthetic','in_progress',(select id from public.services_catalog order by id limit 1));
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.set_completion_evidence_rule((select id from public.services_catalog order by id limit 1),2,'Approved category needs before and after')$$,'admin versions category proof requirement');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.transition_job_status('83000000-0000-4000-8000-000000000001','pending_review')$$,'42501','Use the canonical quote or completion workflow','new completion cannot enter legacy holding state');
select throws_ok($$select public.vendor_complete_job('83000000-0000-4000-8000-000000000001',array['synthetic-one'])$$,'P0001',null,'category minimum cannot be bypassed by vendor');
select lives_ok($$select public.vendor_complete_job('83000000-0000-4000-8000-000000000001',array[null,null]::text[])$$,'REVIEW PROBE: two NULL slots satisfy required two photos');
reset role;
select is((select metadata->>'completion_rule_version' from public.job_events where job_id='83000000-0000-4000-8000-000000000001' and event_type='job_completed_by_vendor'),'1','completion audit records evidence-rule version');
select * from finish();
rollback;
