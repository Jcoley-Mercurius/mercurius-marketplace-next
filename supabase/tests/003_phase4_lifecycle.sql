begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id, raw_user_meta_data) values
 ('41000000-0000-4000-8000-000000000001', '{"full_name":"Synthetic homeowner"}'),
 ('41000000-0000-4000-8000-000000000002', '{"full_name":"Synthetic other owner"}'),
 ('41000000-0000-4000-8000-000000000003', '{"full_name":"Synthetic vendor"}'),
 ('41000000-0000-4000-8000-000000000004', '{"full_name":"Synthetic admin"}');
insert into public.user_roles(user_id, role) values
 ('41000000-0000-4000-8000-000000000003','vendor'),
 ('41000000-0000-4000-8000-000000000004','admin');
insert into public.contractors(id,user_id,name,is_active) values
 ('42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000003','Synthetic provider',false);
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,
 vendor_completed_at,confirmation_sent_at,confirmation_deadline_at,confirmation_due_at,photo_proof_urls)
select ('43000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 '41000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001',
 'house-cleaning','Synthetic fixture', 'vendor_completed', now()-interval '4 days',
 case n when 1 then now()-interval '72 hours'+interval '1 microsecond'
        when 2 then now()-interval '72 hours'
        when 3 then now()-interval '72 hours'-interval '1 microsecond'
        else null end,
 -- Deliberately misleading legacy deadline: the approved notice clock wins.
 now()-interval '10 days',
 case n when 4 then now()+interval '1 hour' when 6 then now() else null end,
 array['synthetic-proof']
from generate_series(1,7) n;
update public.service_requests set status='cancelled' where id='43000000-0000-4000-8000-000000000005';

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.run_lifecycle_batch('44000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous cannot run worker RPC');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.run_lifecycle_batch('44000000-0000-4000-8000-000000000001')$$,'42501',null,'browser cannot run worker RPC');
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000002','homeowner_confirmed')$$,'P0001','Not authorized to change this job','cross-account confirmation denied');
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000002','homeowner_confirmed')$$,'42501','Only the homeowner can confirm completion','service role cannot manufacture homeowner confirmation');
select is((public.run_lifecycle_batch('44000000-0000-4000-8000-000000000001')->>'admin_flagged')::int,2,'exactly at and after 72 hours escalates');
select is((select count(*) from public.service_requests where id::text like '43000000-%' and needs_admin_review),2::bigint,'before boundary is not escalated');
select is((select count(*) from public.service_requests where id::text like '43000000-%' and homeowner_confirmed_at is not null),0::bigint,'escalation never confirms completion');
select is((select count(*) from public.service_requests where id::text like '43000000-%' and payment_status <> 'pending'),0::bigint,'escalation does not change money state');
select is((select status::text from public.service_requests where id='43000000-0000-4000-8000-000000000005'),'cancelled','cancelled request remains cancelled');
select ok((select confirmation_sent_at is null and confirmation_due_at>now() from public.service_requests where id='43000000-0000-4000-8000-000000000004'),'future-scheduled confirmation remains pending with its due time intact');
select is((select confirmation_deadline_at-confirmation_sent_at from public.service_requests where id='43000000-0000-4000-8000-000000000006'),interval '72 hours','due confirmation receives a fresh notice and full response window');
select is((select confirmation_deadline_at-confirmation_sent_at from public.service_requests where id='43000000-0000-4000-8000-000000000007'),interval '72 hours','unscheduled legacy completion receives a fresh notice and full response window');
select is(public.run_lifecycle_batch('44000000-0000-4000-8000-000000000001')->>'replayed','true','same run ID replays committed result');
select is((public.run_lifecycle_batch('44000000-0000-4000-8000-000000000002')->>'admin_flagged')::int,0,'new retry ID does not repeat effects');
select is((select count(*) from public.job_events where job_id::text like '43000000-%' and metadata->>'reason'='homeowner_confirmation_unanswered'),2::bigint,'one escalation audit per job');
select is((select count(*) from public.notifications where related_request_id='43000000-0000-4000-8000-000000000002'),2::bigint,'one homeowner and one admin escalation notification');
reset role;

-- Force a notification write failure: flags, audit and run record must all roll back.
update public.service_requests set confirmation_sent_at=now()-interval '73 hours'
 where id='43000000-0000-4000-8000-000000000001';
create function public.phase4_test_notification_failure() returns trigger language plpgsql as $$
begin raise exception 'Synthetic notification failure'; end $$;
create trigger phase4_test_notification_failure before insert on public.notifications
 for each row execute function public.phase4_test_notification_failure();
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.run_lifecycle_batch('44000000-0000-4000-8000-000000000003')$$,'P0001','Synthetic notification failure','failed notification aborts batch');
select is((select needs_admin_review from public.service_requests where id='43000000-0000-4000-8000-000000000001'),false,'failed batch rolls back flag');
select is((select count(*) from public.lifecycle_worker_runs where id='44000000-0000-4000-8000-000000000003'),0::bigint,'failed run is not recorded as complete');
select is((select count(*) from public.job_events where metadata->>'run_id'='44000000-0000-4000-8000-000000000003'),0::bigint,'failed batch rolls back event');
reset role;
drop trigger phase4_test_notification_failure on public.notifications;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((public.run_lifecycle_batch('44000000-0000-4000-8000-000000000003')->>'admin_flagged')::int,1,'failed run retries successfully with same ID');
reset role;

-- Role boundaries and truthful completion; transition metadata cannot forge audit.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000004"}',true);
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000002','homeowner_confirmed','Admin correction')$$,'42501','Only the homeowner can confirm completion','admin cannot impersonate homeowner');
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000002','in_progress')$$,'22023','Admin transition requires a reason','admin correction requires reason');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.homeowner_confirm_job('43000000-0000-4000-8000-000000000002')$$,'own homeowner confirmation and nested completion succeed');
select is((select status::text from public.service_requests where id='43000000-0000-4000-8000-000000000002'),'completed','confirmation completes service');
select throws_ok($$select public.homeowner_confirm_job('43000000-0000-4000-8000-000000000002')$$,'22023',null,'duplicate confirmation rejected');
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000003','in_progress')$$,'42501',null,'homeowner cannot claim to start vendor work');
select throws_ok($$insert into public.job_events(job_id,event_type) values ('43000000-0000-4000-8000-000000000003','confirmation_received')$$,'42501',null,'browser cannot forge job audit');
reset role;
update public.service_requests set status='in_progress',photo_proof_urls='{}'
 where id='43000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000004','vendor_completed',null,'{"photo_count":99}')$$,'P0001',null,'caller photo_count cannot substitute for stored evidence');
select throws_ok($$update public.service_requests set homeowner_confirmed_at=now() where id='43000000-0000-4000-8000-000000000004'$$,'42501',null,'vendor cannot forge confirmation timestamp directly');
select lives_ok($$select public.vendor_complete_job('43000000-0000-4000-8000-000000000004',array['synthetic-proof'])$$,'assigned vendor can submit stored completion evidence');
select is((select confirmation_deadline_at-confirmation_sent_at from public.service_requests where id='43000000-0000-4000-8000-000000000004'),interval '72 hours','completion notice and approved deadline stored atomically');
select throws_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000004','vendor_completed')$$,'22023','Duplicate job transition','duplicate vendor completion rejected');
reset role;

insert into public.service_requests(id,customer_id,service_type,address) values
 ('43000000-0000-4000-8000-000000000008','41000000-0000-4000-8000-000000000001','Synthetic cancellation','Synthetic fixture');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"41000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$delete from public.service_requests where id='43000000-0000-4000-8000-000000000008'$$,'42501',null,'cancellation cannot delete request history');
select lives_ok($$select public.transition_job_status('43000000-0000-4000-8000-000000000008','cancelled','Homeowner cancelled pending request')$$,'homeowner can cancel through audited transition');
select is((select status::text from public.service_requests where id='43000000-0000-4000-8000-000000000008'),'cancelled','cancelled row is retained');
reset role;

select * from finish();
rollback;
