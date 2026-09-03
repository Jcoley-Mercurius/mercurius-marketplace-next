begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','{"full_name":"Synthetic quote owner"}'),
 ('71000000-0000-4000-8000-000000000002','{"full_name":"Synthetic quote admin"}');
insert into public.user_roles(user_id,role) values ('71000000-0000-4000-8000-000000000002','admin');
insert into public.service_requests(id,customer_id,service_type,address,status,matching_status,quote_amount)
 select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '71000000-0000-4000-8000-000000000001','Synthetic quote','Synthetic fixture','quoted','offered',100
 from generate_series(1,2)n;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',false)$$,'42501','Only the homeowner can respond to this quote','admin cannot impersonate quote decision');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',false)$$,'own quote can be declined');
select is((select status::text from public.service_requests where id='73000000-0000-4000-8000-000000000001'),'quoted','quote decline is not cancellation');
select ok((select quote_declined_at is not null and needs_admin_review from public.service_requests where id='73000000-0000-4000-8000-000000000001'),'decline records decision and operator follow-up');
select throws_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',true)$$,'22023','There is no open quote on this job','declined quote cannot be silently approved on retry');
select lives_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000002',true)$$,'homeowner can approve quote');
select is((select status::text from public.service_requests where id='73000000-0000-4000-8000-000000000002'),'quoted','quote approval does not substitute for vendor acceptance');
select ok((select quote_approved_at is not null from public.service_requests where id='73000000-0000-4000-8000-000000000002'),'approval records actor time');
select throws_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000002',true)$$,'22023','There is no open quote on this job','duplicate quote approval rejected');
select is((select count(*) from public.job_events where job_id::text like '73000000-%'),2::bigint,'one audit event per quote decision');
reset role;
select * from finish();
rollback;
