begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,invited_at) values
 ('d1000000-0000-4000-8000-000000000001','operator@example.invalid',now(),null),
 ('d1000000-0000-4000-8000-000000000002','recipient@example.invalid',null,now()),
 ('d1000000-0000-4000-8000-000000000003','other@example.invalid',now(),now());
insert into public.user_roles(user_id,role) values('d1000000-0000-4000-8000-000000000001','admin');
insert into public.contractors(id,name,is_active,marketing_enabled)
 values('d2000000-0000-4000-8000-000000000001','Synthetic invitation provider',false,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values('d3000000-0000-4000-8000-000000000001','Synthetic invitation provider','Test','Recipient',
 'recipient@example.invalid','synthetic','d2000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000001"}',true);
select public.vendor_begin_review('d2000000-0000-4000-8000-000000000001',
 (select id from public.vendor_application_versions where application_id='d3000000-0000-4000-8000-000000000001'));
create temp table invitation_fixture(key text primary key,id uuid);
grant select on invitation_fixture to authenticated,service_role;
insert into invitation_fixture values('first',public.vendor_prepare_invitation('d2000000-0000-4000-8000-000000000001','dispatch-1',now()+interval '1 day'));
select is((public.vendor_claim_invitation((select id from invitation_fixture where key='first'))->>'claimed')::boolean,true,'First claim reserves dispatch');
select is((public.vendor_claim_invitation((select id from invitation_fixture where key='first'))->>'claimed')::boolean,false,'Duplicate claim cannot send twice');
select is((select status from public.vendor_invitation_attempts where id=(select id from invitation_fixture where key='first')),'submitted','Reservation is durable before Auth call');
select throws_ok($$select public.vendor_record_invitation((select id from invitation_fixture where key='first'),'accepted','invented','Synthetic assertion')$$,
 'P0001','Dispatched invitations require verified receipts','Operator cannot manufacture an acceptance');
set local role authenticated;
select throws_ok($$select public.vendor_finish_invitation((select id from invitation_fixture where key='first'),null,null)$$,
 '42501',null,'Browser cannot write provider receipts');
reset role;
select public.vendor_finish_invitation((select id from invitation_fixture where key='first'));
select public.vendor_finish_invitation((select id from invitation_fixture where key='first'));
select is((select count(*) from public.vendor_invitation_events where status='unknown'),1::bigint,'Unknown receipt retry is idempotent');
select throws_ok($$select public.vendor_prepare_invitation('d2000000-0000-4000-8000-000000000001','dispatch-2',now()+interval '1 day')$$,
 '23505',null,'Unknown send cannot reserve a replacement');
select throws_ok($$select public.vendor_close_dispatched_invitation((select id from invitation_fixture where key='first'),'revoked','Synthetic stop')$$,
 'P0001','Reconcile invitation before closure','Unknown send cannot be closed to permit a resend');
select throws_ok($$select public.vendor_finish_invitation((select id from invitation_fixture where key='first'),'d1000000-0000-4000-8000-000000000003')$$,
 'P0001','Auth invitation identity evidence mismatch','Wrong recipient readback rejected');
select lives_ok($$select public.vendor_finish_invitation((select id from invitation_fixture where key='first'),'d1000000-0000-4000-8000-000000000002')$$,
 'Matching Auth readback resolves unknown delivery');
select public.vendor_finish_invitation((select id from invitation_fixture where key='first'),'d1000000-0000-4000-8000-000000000002');
select public.vendor_finish_invitation((select id from invitation_fixture where key='first'));
select is((select state from public.vendor_invitation_dispatches where attempt_id=(select id from invitation_fixture where key='first')),'provider_accepted','Late unknown result cannot regress accepted provider receipt');
select is((select status from public.vendor_invitation_attempts where id=(select id from invitation_fixture where key='first')),'submitted','Provider success does not claim mailbox delivery');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,
 '42501','Verified invitation recipient required','Another account cannot accept the invitation');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,
 '42501','Verified invitation recipient required','Unconfirmed email cannot accept');
update auth.users set email_confirmed_at=now() where id='d1000000-0000-4000-8000-000000000002';
update public.vendor_onboarding set status='suspended' where contractor_id='d2000000-0000-4000-8000-000000000001';
select throws_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,
 'P0001','Current invitation and application required','Suspension after dispatch blocks acceptance');
update public.vendor_onboarding set status='review' where contractor_id='d2000000-0000-4000-8000-000000000001';
update public.vendor_invitation_attempts set expires_at=now()-interval '1 second' where id=(select id from invitation_fixture where key='first');
select throws_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,
 'P0001','Current invitation and application required','Expired invitation cannot be accepted');
update public.vendor_invitation_attempts set expires_at=now()+interval '1 day' where id=(select id from invitation_fixture where key='first');

set local role authenticated;
select lives_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,'Verified recipient explicitly accepts');
select lives_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='first'))$$,'Acceptance retry is idempotent');
select throws_ok($$select public.vendor_invitation_status((select id from invitation_fixture where key='first'))$$,
 '42501','Onboarding operator required','Recipient cannot inspect private operations status');
reset role;
select is((select count(*) from public.vendor_invitation_acceptances),1::bigint,'One immutable acceptance receipt');
select is((select status from public.vendor_onboarding where contractor_id='d2000000-0000-4000-8000-000000000001'),'review','Acceptance leaves onboarding in review');
select is((select count(*) from public.user_roles where user_id='d1000000-0000-4000-8000-000000000002' and role='vendor'),0::bigint,'Acceptance grants no vendor role');
select ok((select user_id is null and not is_active from public.contractors where id='d2000000-0000-4000-8000-000000000001'),'Acceptance neither links nor activates provider');
select throws_ok($$delete from public.vendor_invitation_acceptances$$,'55000','Immutable financial evidence; append a correction','Acceptance history cannot be deleted');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000001"}',true);
insert into invitation_fixture values('revoked',public.vendor_prepare_invitation('d2000000-0000-4000-8000-000000000001','dispatch-revoked',now()+interval '1 day'));
select public.vendor_claim_invitation((select id from invitation_fixture where key='revoked'));
select public.vendor_finish_invitation((select id from invitation_fixture where key='revoked'),'d1000000-0000-4000-8000-000000000002');
select throws_ok($$select public.vendor_close_dispatched_invitation((select id from invitation_fixture where key='revoked'),'expired','Synthetic expiry')$$,
 'P0001','Invitation not expired','Cannot expire a current link');
select public.vendor_close_dispatched_invitation((select id from invitation_fixture where key='revoked'),'revoked','Synthetic operator revocation');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.vendor_accept_invitation((select id from invitation_fixture where key='revoked'))$$,
 'P0001','Current invitation and application required','Revoked invitation cannot be accepted');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"d1000000-0000-4000-8000-000000000001"}',true);
insert into invitation_fixture values('stale',public.vendor_prepare_invitation('d2000000-0000-4000-8000-000000000001','dispatch-stale',now()+interval '1 day'));
update public.vendor_applications set phone='changed' where id='d3000000-0000-4000-8000-000000000001';
select throws_ok($$select public.vendor_claim_invitation((select id from invitation_fixture where key='stale'))$$,
 'P0001','Current invitation and application required','New application revision invalidates pending dispatch');
select ok(not has_function_privilege('anon','public.vendor_accept_invitation(uuid)','EXECUTE'),'Anonymous users cannot accept');
select ok(not has_table_privilege('service_role','public.vendor_invitation_dispatches','UPDATE'),'Service role cannot bypass receipt RPC');
select * from finish();
rollback;
