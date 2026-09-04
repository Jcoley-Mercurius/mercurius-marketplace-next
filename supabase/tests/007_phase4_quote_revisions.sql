begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,raw_user_meta_data) values
 ('71000000-0000-4000-8000-000000000001','{"full_name":"Synthetic quote owner"}'),
 ('71000000-0000-4000-8000-000000000002','{"full_name":"Synthetic quote admin"}');
insert into public.user_roles(user_id,role) values ('71000000-0000-4000-8000-000000000002','admin');
insert into public.service_requests(id,customer_id,service_type,address,status,matching_status,quote_amount)
 select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '71000000-0000-4000-8000-000000000001','Synthetic quote','Synthetic fixture','scheduled','matched',100
 from generate_series(1,2)n;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000002"}',true);
select lives_ok($$select public.admin_send_quote('73000000-0000-4000-8000-000000000001',100,'Initial quote',0)$$,'scheduled service can receive independent price quote');
select throws_ok($$select public.admin_send_quote('73000000-0000-4000-8000-000000000001',100,'Initial quote',0)$$,'22023',null,'duplicate send with stale revision is rejected');
select lives_ok($$select public.admin_send_quote('73000000-0000-4000-8000-000000000001',125,'Corrected scope',1)$$,'replacement preserves revision lineage');
reset role;
select is((select count(*) from public.request_quotes where request_id='73000000-0000-4000-8000-000000000001'),2::bigint,'both revisions retained');
select is((select status from public.request_quotes where request_id='73000000-0000-4000-8000-000000000001' and revision=1),'superseded','unanswered prior quote superseded');
select ok((select expires_at=sent_at+interval '24 hours' from public.request_quotes where request_id='73000000-0000-4000-8000-000000000001' and revision=2),'approved 24-hour deadline');
select throws_ok($$update public.request_quotes set amount=1 where request_id='73000000-0000-4000-8000-000000000001'$$,'42501',null,'original quote terms immutable even to operator writes');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',true,(select id from public.request_quotes where request_id='73000000-0000-4000-8000-000000000001' and revision=1))$$,'22023',null,'stale displayed quote cannot accept replacement amount');
select lives_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000001',true,(select current_quote_id from public.service_requests where id='73000000-0000-4000-8000-000000000001'))$$,'homeowner approves current quote after vendor scheduling');
reset role;
select is((select status::text from public.service_requests where id='73000000-0000-4000-8000-000000000001'),'scheduled','quote decision preserves scheduled service');
insert into public.request_quotes(request_id,revision,amount,sender_id,reason,sent_at,expires_at)
 values('73000000-0000-4000-8000-000000000002',1,100,'71000000-0000-4000-8000-000000000002','Expiry boundary',now()-interval '24 hours',now());
update public.service_requests r set current_quote_id=q.id,quote_revision=1,quote_status='submitted',quote_expires_at=q.expires_at from public.request_quotes q where q.request_id=r.id and r.id='73000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"71000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.homeowner_respond_to_quote('73000000-0000-4000-8000-000000000002',true,(select current_quote_id from public.service_requests where id='73000000-0000-4000-8000-000000000002'))$$,'22023','Quote has expired','approval rejected exactly at deadline even with inactive worker');
reset role;
select is(private.expire_request_quotes(),1,'one quote expires');
select is(private.expire_request_quotes(),0,'duplicate expiry does not repeat events');
select is((select status::text from public.service_requests where id='73000000-0000-4000-8000-000000000002'),'scheduled','quote expiry does not cancel scheduled service');
select is((select quote_status from public.service_requests where id='73000000-0000-4000-8000-000000000002'),'expired','quote state independent of service state');
select * from finish();
rollback;
