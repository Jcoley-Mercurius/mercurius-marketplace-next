-- TRACE-119 / DEC-2026-045 (Phase 6.4): itemized provider proposals and quotes, tax pending,
-- $0 deposit and deposit review, accepted quotes final on every path, provider eligibility,
-- aging and payment-exception queue. Synthetic fixtures; rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('91900000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner"}'),
 ('91900000-0000-4000-8000-000000000002','{"full_name":"Synthetic operator"}'),
 ('91900000-0000-4000-8000-000000000003','{"full_name":"Synthetic provider A"}'),
 ('91900000-0000-4000-8000-000000000004','{"full_name":"Synthetic provider B"}'),
 ('91900000-0000-4000-8000-000000000005','{"full_name":"Synthetic provider C"}'),
 ('91900000-0000-4000-8000-000000000006','{"full_name":"Synthetic second operator"}');
insert into public.user_roles(user_id,role) values
 ('91900000-0000-4000-8000-000000000002','admin'),('91900000-0000-4000-8000-000000000006','admin');
insert into public.contractors(id,user_id,name,is_active) values
 ('91910000-0000-4000-8000-000000000001','91900000-0000-4000-8000-000000000003','Synthetic provider A',true),
 ('91910000-0000-4000-8000-000000000002','91900000-0000-4000-8000-000000000004','Synthetic provider B',true),
 ('91910000-0000-4000-8000-000000000003','91900000-0000-4000-8000-000000000005','Synthetic provider C',true);
-- Requests: 1 main flow (A), 2 fixed price, 3 offer not accepted, 4 return and provider
-- replacement, 5 expiry and aging, 6 deposit quote, 7 final quote and accepted immutability,
-- 8 suspended provider (C), 9 payment outcomes, 10 aging boundaries.
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,matching_status,pricing_mode,quote_only,description)
 select ('91930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'91900000-0000-4000-8000-000000000001',
 case when n=8 then '91910000-0000-4000-8000-000000000003'::uuid else '91910000-0000-4000-8000-000000000001'::uuid end,
 'Synthetic quote work '||n,'1 Synthetic Way',
 (case when n=3 then 'matched' else 'scheduled' end)::public.request_status,case when n=3 then 'offered' else 'matched' end,
 case when n=2 then 'fixed' when n=6 then 'deposit_quote' else 'custom_quote' end,n<>2,'Synthetic scope'
 from generate_series(1,10)n;

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',uid)::text,true)
$$;
create function pg_temp.req(n int) returns uuid language sql immutable as $$ select ('91930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.items() returns jsonb language sql immutable as $$ select
 '[{"kind":"labor","description":"Stump removal","quantity":2,"unit_cents":10000},
   {"kind":"materials","description":"Fill soil","quantity":1.5,"unit_cents":2000},
   {"kind":"addon","description":"Haul-away","quantity":1,"unit_cents":5000},
   {"kind":"discount","description":"Second stump","quantity":1,"unit_cents":2500}]'::jsonb $$;
create function pg_temp.queue() returns jsonb language sql as $$ select public.admin_quote_queue()->'items' $$;
create function pg_temp.queued(kind text,request uuid) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.queue()) i where i->>'kind'=kind and (i->>'request_id')::uuid=request $$;

select ok(private.vendor_matching_eligible('91910000-0000-4000-8000-000000000001'),'fixture provider A is eligible');

-- ------------------------------------------------------------------ G1 itemization rules
select is(private.quote_items(pg_temp.items())->>'subtotal_cents','25500','subtotal = 20000 labor + 3000 materials + 5000 add-on - 2500 discount');
select is(private.quote_items(pg_temp.items())->'items'->1->>'amount_cents','3000','quantity 1.5 × $20.00 = $30.00');
select throws_ok($$select private.quote_items('[]')$$,'22023','List between 1 and 50 quote items','empty list refused');
select throws_ok($$select private.quote_items('[{"kind":"tip","description":"x","quantity":1,"unit_cents":1}]')$$,'22023',null,'unknown item type refused');
select throws_ok($$select private.quote_items('[{"kind":"labor","description":" ","quantity":1,"unit_cents":100}]')$$,'22023',null,'description required');
select throws_ok($$select private.quote_items('[{"kind":"labor","description":"x","quantity":0,"unit_cents":100}]')$$,'22023',null,'zero quantity refused');
select throws_ok($$select private.quote_items('[{"kind":"labor","description":"x","quantity":1,"unit_cents":10.5}]')$$,'22023',null,'fractional-cent unit price refused');
select throws_ok($$select private.quote_items('[{"kind":"labor","description":"x","quantity":0.33,"unit_cents":101}]')$$,'22023','Quantity times unit price must come to whole cents','no rounding is invented');
select throws_ok($$select private.quote_items('[{"kind":"discount","description":"x","quantity":1,"unit_cents":100}]')$$,'22023',null,'discount alone refused');
select throws_ok($$select private.quote_items('[{"kind":"labor","description":"x","quantity":1,"unit_cents":100},{"kind":"discount","description":"y","quantity":1,"unit_cents":100}]')$$,
  '22023','Discounts must leave a subtotal greater than $0','discount cannot zero the subtotal');

-- ------------------------------------------------------------------ proposals: actors and state
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000004');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0)$$,
  '42501','Only the provider assigned to this request can propose a quote','unassigned provider cannot propose');
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0)$$,'42501',null,'homeowner cannot propose');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0)$$,'42501',null,'operator without a provider record cannot propose');
reset role;
set local role anon;
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0)$$,'42501',null,'anonymous has no execute grant');
reset role;
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(2),pg_temp.items(),'Full scope',0)$$,'22023','This request has a fixed price, so no quote is needed','fixed price refused');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(3),pg_temp.items(),'Full scope',0)$$,'22023','This request is not open for a quote','unaccepted offer refused');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'   ',0)$$,'22023',null,'scope required');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',3)$$,'22023','Quote changed; refresh before proposing','stale revision refused');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0)$$,'assigned provider proposes an itemized estimate');
select is(public.vendor_propose_quote(pg_temp.req(1),pg_temp.items(),'Full scope',0),
  (select id from public.request_quote_proposals where request_id=pg_temp.req(1) and status='pending'),'identical retry returns the pending proposal');
select is((select count(*) from public.request_quote_proposals where request_id=pg_temp.req(1)),1::bigint,'retry adds no row');
select is((select subtotal_cents from public.request_quote_proposals where request_id=pg_temp.req(1)),25500::bigint,'server computes the proposal subtotal');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(1),'[{"kind":"labor","description":"Stump removal","quantity":3,"unit_cents":10000}]','Three stumps',0)$$,'provider revises');
select is((select count(*) from public.request_quote_proposals where request_id=pg_temp.req(1) and status='superseded'),1::bigint,'earlier proposal kept as superseded');
select is((select count(*) from public.request_quote_proposals),2::bigint,'provider reads its own proposals');
select pg_temp.as_user('91900000-0000-4000-8000-000000000004');
select is((select count(*) from public.request_quote_proposals),0::bigint,'another provider reads none');
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select is((select count(*) from public.request_quote_proposals),0::bigint,'homeowner reads no proposals');
select throws_ok($$insert into public.request_quote_terms(quote_id,request_id,items,scope,service_cents,addons_cents,discount_cents,subtotal_cents,tax_status,payment_terms,policy_version)
  values(gen_random_uuid(),pg_temp.req(1),'[]','x',1,0,0,1,'confirmed','x','x')$$,'42501',null,'no direct terms insert');
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select throws_ok($$update public.request_quote_proposals set subtotal_cents=1$$,'42501',null,'no direct proposal update');
reset role;

-- ------------------------------------------------------------------ operator send (G1, G3)
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_quote(pg_temp.req(1),300,'Single amount',0)$$,'22023','Quotes are itemized (DEC-2026-045); send an itemized quote','single-amount send retired');
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Scope','Send',0)$$,'42501',null,'provider cannot send');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Scope','  ',0)$$,'22023','Quote reason required','reason required');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Scope','Send',1)$$,'22023','Quote changed; refresh before sending','stale revision refused');
reset role;
update public.service_requests set description='Changed scope' where id=pg_temp.req(1);
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Scope','Send',0,(select id from public.request_quote_proposals where request_id=pg_temp.req(1) and status='pending'))$$,
  '22023','Request details changed since this proposal; ask the provider to propose again','changed scope refuses the proposal');
reset role;
update public.service_requests set description='Synthetic scope' where id=pg_temp.req(1);
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select lives_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Stumps, fill and haul-away','Second stump discounted',0,
  (select id from public.request_quote_proposals where request_id=pg_temp.req(1) and status='pending'))$$,'operator sends corrected items with a reason');
select is(public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Stumps, fill and haul-away','Second stump discounted',0,
  (select id from public.request_quote_proposals where request_id=pg_temp.req(1) and status='sent')),
  (select current_quote_id from public.service_requests where id=pg_temp.req(1)),'identical send retry returns the same quote');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(1),pg_temp.items(),'Other','Different',1,
  (select id from public.request_quote_proposals where request_id=pg_temp.req(1) and status='sent'))$$,'22023','This quote proposal was already sent; refresh','a different second send refused');
reset role;
select is((select (tax_status,tax_cents,total_cents,deposit_cents,subtotal_cents,service_cents,addons_cents,discount_cents,policy_version)
  from public.request_quote_terms t join public.service_requests r on r.current_quote_id=t.quote_id where r.id=pg_temp.req(1)),
  ('pending'::text,null::bigint,null::bigint,0::bigint,25500::bigint,23000::bigint,5000::bigint,2500::bigint,'DEC-2026-045'::text),
  'terms: itemized, tax pending (no total), deposit $0, policy version');
select ok((select payment_terms like 'No deposit.%' from public.request_quote_terms t join public.service_requests r on r.current_quote_id=t.quote_id where r.id=pg_temp.req(1)),'payment terms recorded');
select is((select (quote_status,quote_revision,quote_amount) from public.service_requests where id=pg_temp.req(1)),('submitted'::text,1,255.00::numeric),'request shows the submitted subtotal');
select is((select corrected from public.request_quote_proposals where request_id=pg_temp.req(1) and status='sent'),true,'correction recorded on the proposal');
select ok(exists(select 1 from public.notifications where user_id='91900000-0000-4000-8000-000000000003' and title='Your quote was corrected and sent'),'provider told of the correction');
select ok(exists(select 1 from public.notifications where user_id='91900000-0000-4000-8000-000000000001' and title='Itemized quote ready to review'),'homeowner told; notice says tax is pending');
select ok(exists(select 1 from public.money_quote_contexts c join public.service_requests r on r.current_quote_id=c.quote_id where r.id=pg_temp.req(1)),'scope captured for checkout');
select throws_ok($$update public.request_quote_terms set tax_status='confirmed'$$,'42501',null,'terms immutable even to the table owner');
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select is((select count(*) from public.request_quote_terms),1::bigint,'homeowner reads the itemized terms of their quote');
select throws_ok($$select public.homeowner_respond_to_quote(pg_temp.req(1),true,(select current_quote_id from public.service_requests where id=pg_temp.req(1)))$$,
  '22023','Tax pending confirmation; this quote can''t be approved until Mercurius confirms tax','tax-pending quote cannot be approved');
select lives_ok($$select public.homeowner_respond_to_quote(pg_temp.req(1),false,(select current_quote_id from public.service_requests where id=pg_temp.req(1)))$$,
  'homeowner can still decline');
reset role;
select is((select status::text from public.service_requests where id=pg_temp.req(1)),'scheduled','decline does not cancel');

-- ------------------------------------------------------------------ G1/G3/G5: final quote acceptance
-- No command confirms tax (no approved tax rule exists). A confirmed final revision is a fixture.
insert into public.request_quotes(id,request_id,revision,amount,sender_id,reason)
 values('91940000-0000-4000-8000-000000000007',pg_temp.req(7),1,272.50,'91900000-0000-4000-8000-000000000002','Final quote');
insert into public.request_quote_terms(quote_id,request_id,items,scope,service_cents,addons_cents,discount_cents,subtotal_cents,tax_status,tax_cents,tax_basis,total_cents,payment_terms,policy_version)
 values('91940000-0000-4000-8000-000000000007',pg_temp.req(7),(private.quote_items(pg_temp.items())->'items'),'Scope',23000,5000,2500,25500,'confirmed',1750,'Synthetic confirmed treatment',27250,private.quote_payment_terms(),'DEC-2026-045');
update public.service_requests r set current_quote_id=q.id,quote_revision=1,quote_status='submitted',quote_expires_at=q.expires_at,quote_amount=q.amount
 from public.request_quotes q where q.id='91940000-0000-4000-8000-000000000007' and r.id=q.request_id;
-- Legacy single-amount submitted quote (no terms) on request 10.
insert into public.request_quotes(id,request_id,revision,amount,sender_id,reason)
 values('91940000-0000-4000-8000-000000000010',pg_temp.req(10),1,100,'91900000-0000-4000-8000-000000000002','Legacy quote');
update public.service_requests r set current_quote_id=q.id,quote_revision=1,quote_status='submitted',quote_expires_at=q.expires_at
 from public.request_quotes q where q.id='91940000-0000-4000-8000-000000000010' and r.id=q.request_id;
update public.contractors set is_active=false where id='91910000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select throws_ok($$select public.homeowner_respond_to_quote(pg_temp.req(10),true,'91940000-0000-4000-8000-000000000010')$$,
  '22023','This quote has no itemized breakdown; Mercurius must send an itemized quote before it can be approved','legacy single-amount quote cannot be approved');
select throws_ok($$select public.homeowner_respond_to_quote(pg_temp.req(7),true,'91940000-0000-4000-8000-000000000007')$$,
  '22023',null,'suspended provider blocks homeowner approval');
reset role;
update public.contractors set is_active=true where id='91910000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select lives_ok($$select public.homeowner_respond_to_quote(pg_temp.req(7),true,'91940000-0000-4000-8000-000000000007')$$,'complete final quote is approved');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(7),pg_temp.items(),'Scope','Raise price',1)$$,
  '22023','The homeowner accepted the current quote; its terms cannot be replaced. Open an operator exception instead','itemized send cannot replace accepted terms');
select throws_ok($$update public.service_requests set quote_amount=999 where id=pg_temp.req(7)$$,'42501',null,'operator direct write to the accepted amount refused');
select throws_ok($$update public.service_requests set current_quote_id=null,quote_status='submitted' where id=pg_temp.req(7)$$,'42501',null,'operator direct repoint refused');
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(7),pg_temp.items(),'More',1)$$,'22023',
  'The homeowner already accepted a quote; contact Mercurius to change agreed terms','no proposals after acceptance');
reset role;
select throws_ok($$update public.request_quotes set status='superseded' where id='91940000-0000-4000-8000-000000000007'$$,'42501','A decided quote cannot be changed','decided quote immutable to the table owner');
select throws_ok($$update public.service_requests set quote_revision=2 where id=pg_temp.req(7)$$,'42501',null,'accepted pointer immutable to the table owner');
select is((select (status,amount) from public.request_quotes where id='91940000-0000-4000-8000-000000000007'),('accepted'::text,272.50::numeric),'accepted revision preserved');
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_open_quote_exception(pg_temp.req(1),'Change')$$,'22023',null,'exception only for an accepted quote');
select lives_ok($$select public.admin_open_quote_exception(pg_temp.req(7),'Homeowner asked to add a third stump')$$,'operator opens a change exception');
select is(public.admin_open_quote_exception(pg_temp.req(7),'Again'),(select id from public.request_quote_exceptions where request_id=pg_temp.req(7)),'one open exception per accepted quote');
select ok(pg_temp.queued('accepted_change',pg_temp.req(7)) is not null,'change exception is queued');
select lives_ok($$select public.admin_close_quote_exception((select id from public.request_quote_exceptions where request_id=pg_temp.req(7)),'Resolved with the homeowner; terms unchanged')$$,'operator closes it');
select ok(pg_temp.queued('accepted_change',pg_temp.req(7)) is null,'closed exception leaves the queue');
reset role;
select throws_ok($$update public.request_quote_exceptions set reason='x'$$,'42501',null,'exceptions immutable');
select is((select (quote_status,quote_amount) from public.service_requests where id=pg_temp.req(7)),('accepted'::text,272.50::numeric),'exception changed no terms');

-- ------------------------------------------------------------------ G2 deposit review
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('deposit_review',pg_temp.req(6)) is not null,'deposit job queued for review immediately');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(6),pg_temp.items(),'Scope','Send',0)$$,'22023',
  'This job asks for a deposit; record the deposit review before sending a quote','no send before deposit review');
select throws_ok($$select public.admin_record_quote_review(pg_temp.req(1),'deposit_review','Reviewed')$$,'22023','This job does not ask for a deposit','no deposit review where none is asked');
select lives_ok($$select public.admin_record_quote_review(pg_temp.req(6),'deposit_review','Beta default: no deposit; provider informed')$$,'operator records the deposit review');
select ok(pg_temp.queued('deposit_review',pg_temp.req(6)) is null,'reviewed deposit job leaves the queue');
select lives_ok($$select public.admin_send_itemized_quote(pg_temp.req(6),pg_temp.items(),'Scope','Send',0)$$,'quote sent after review');
reset role;
select is((select deposit_cents from public.request_quote_terms t join public.service_requests r on r.current_quote_id=t.quote_id where r.id=pg_temp.req(6)),0::bigint,'deposit is $0');

-- ------------------------------------------------------------------ G5 suspended provider
update public.contractors set is_active=false where id='91910000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000005');
select throws_ok($$select public.vendor_propose_quote(pg_temp.req(8),pg_temp.items(),'Scope',0)$$,'42501',
  'Your provider account is not currently eligible to propose quotes','suspended provider cannot propose');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(8),pg_temp.items(),'Scope','Send',0)$$,'22023',
  'The assigned provider is not currently eligible; review the assignment before sending a quote','no send for a suspended provider');
select ok(pg_temp.queued('provider_review',pg_temp.req(8)) is not null,'assigned job of a suspended provider is flagged');
select lives_ok($$select public.admin_record_quote_review(pg_temp.req(8),'provider_review','Contacted provider; keeping the assignment for now')$$,'operator records the review');
select ok(pg_temp.queued('provider_review',pg_temp.req(8)) is null,'reviewed flag leaves the queue');
reset role;
select is((select (contractor_id,status::text) from public.service_requests where id=pg_temp.req(8)),
  ('91910000-0000-4000-8000-000000000003'::uuid,'scheduled'::text),'suspension never unassigns or cancels');
-- A pending proposal from a provider who is later suspended cannot be sent.
update public.contractors set is_active=true where id='91910000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000005');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(8),pg_temp.items(),'Scope',0)$$,'eligible provider proposes');
reset role;
update public.contractors set is_active=false where id='91910000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(8),pg_temp.items(),'Scope','Send',0,(select id from public.request_quote_proposals where request_id=pg_temp.req(8)))$$,
  '22023','The assigned provider is not currently eligible; review the assignment before sending a quote','pending proposal of a suspended provider cannot be sent');
reset role;
select is((select status from public.request_quote_proposals where request_id=pg_temp.req(8)),'pending','proposal kept as history');

-- ------------------------------------------------------------------ return and provider replacement
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(4),pg_temp.items(),'Walkthrough',0)$$,'proposal on request 4');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_return_quote_proposal((select id from public.request_quote_proposals where request_id=pg_temp.req(4)),'')$$,'22023',null,'return needs a reason');
select lives_ok($$select public.admin_return_quote_proposal((select id from public.request_quote_proposals where request_id=pg_temp.req(4)),'Include the permit fee')$$,'operator returns it');
select lives_ok($$select public.admin_return_quote_proposal((select id from public.request_quote_proposals where request_id=pg_temp.req(4)),'Include the permit fee')$$,'identical return retry is a no-op');
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(4),pg_temp.items()||'[{"kind":"materials","description":"Permit","quantity":1,"unit_cents":7500}]','With permit',0)$$,'provider proposes again');
reset role;
update public.service_requests set contractor_id='91910000-0000-4000-8000-000000000002' where id=pg_temp.req(4);
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select throws_ok($$select public.admin_send_itemized_quote(pg_temp.req(4),pg_temp.items(),'Scope','Send',0,(select id from public.request_quote_proposals where request_id=pg_temp.req(4) and status='pending'))$$,
  '22023','The provider changed since this proposal; ask the assigned provider to propose again','replaced provider refuses the send');
reset role;

-- ------------------------------------------------------------------ G4 aging and distinct clocks
-- Request 10: quote required since provider acceptance. Request 1 is declined (decided now).
insert into public.job_match_attempts(service_request_id,contractor_id,attempt_number,offered_at,expires_at,responded_at,outcome,accepted_at)
 values (pg_temp.req(5),'91910000-0000-4000-8000-000000000001',1,now()-interval '30 hours',now()-interval '26 hours',now()-interval '24 hours','accepted',now()-interval '24 hours'),
        (pg_temp.req(4),'91910000-0000-4000-8000-000000000002',1,now()-interval '30 hours',now()-interval '26 hours',now()-interval '23 hours 59 minutes','accepted',now()-interval '23 hours 59 minutes');
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select is(pg_temp.queued('proposal_missing',pg_temp.req(5))->>'aged','true','proposal missing exactly 24 hours after acceptance is queued and aged');
select ok(pg_temp.queued('proposal_missing',pg_temp.req(1)) is null,'a quote declined just now restarts nothing early: not queued');
select ok(pg_temp.queued('proposal_missing',pg_temp.req(4)) is null,'a pending proposal is not "missing"');
reset role;
update public.service_requests set description='Ordinary edit', updated_at=now() where id=pg_temp.req(5);
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('proposal_missing',pg_temp.req(5)) is not null,'an ordinary edit does not reset aging');
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(5),pg_temp.items(),'Gutters',0)$$,'proposal on request 5');
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('proposal_review',pg_temp.req(5)) is null,'fresh proposal not yet aged');
reset role;
alter table public.request_quote_proposals disable trigger preserve_quote_proposal;
update public.request_quote_proposals set created_at=now()-interval '4 hours' where request_id=pg_temp.req(5) and status='pending';
update public.request_quote_proposals set created_at=now()-interval '3 hours 59 minutes' where request_id=pg_temp.req(8) and status='pending';
alter table public.request_quote_proposals enable trigger preserve_quote_proposal;
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('proposal_review',pg_temp.req(5)) is not null,'proposal awaiting send is queued at 4 hours');
select ok(pg_temp.queued('proposal_review',pg_temp.req(8)) is null,'and not at 3 h 59 m');
select lives_ok($$select public.admin_send_itemized_quote(pg_temp.req(5),pg_temp.items(),'Gutters','As proposed',0,(select id from public.request_quote_proposals where request_id=pg_temp.req(5) and status='pending'))$$,'sent as proposed');
reset role;
select is((select corrected from public.request_quote_proposals where request_id=pg_temp.req(5) and status='sent'),false,'unchanged send is not a correction');
select is((select expires_at-sent_at from public.request_quotes q join public.service_requests r on r.current_quote_id=q.id where r.id=pg_temp.req(5)),interval '24 hours','24-hour expiry unchanged');
alter table public.request_quotes disable trigger preserve_quote_terms;
update public.request_quotes q set sent_at=now()-interval '12 hours',expires_at=now()+interval '12 hours' from public.service_requests r where r.current_quote_id=q.id and r.id=pg_temp.req(5);
update public.request_quotes q set sent_at=now()-interval '11 hours 59 minutes',expires_at=now()+interval '12 hours 1 minute' from public.service_requests r where r.current_quote_id=q.id and r.id=pg_temp.req(6);
alter table public.request_quotes enable trigger preserve_quote_terms;
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select is(pg_temp.queued('quote_decision',pg_temp.req(5))->'detail'->>'deadline_passed','false','sent quote queued at 12 hours, before its 24-hour deadline');
select ok(pg_temp.queued('quote_decision',pg_temp.req(6)) is null,'and not at 11 h 59 m');
reset role;
select is((select quote_status from public.service_requests where id=pg_temp.req(5)),'submitted','aging does not expire, accept or extend the quote');
select is(private.expire_request_quotes(),0,'expiry worker leaves a 12-hour-old quote alone');
alter table public.request_quotes disable trigger preserve_quote_terms;
update public.request_quotes q set sent_at=now()-interval '24 hours',expires_at=now() from public.service_requests r where r.current_quote_id=q.id and r.id=pg_temp.req(5);
alter table public.request_quotes enable trigger preserve_quote_terms;
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select is(pg_temp.queued('quote_decision',pg_temp.req(5))->'detail'->>'deadline_passed','true','queue shows a passed deadline before the worker runs');
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select throws_ok($$select public.homeowner_respond_to_quote(pg_temp.req(5),false,(select current_quote_id from public.service_requests where id=pg_temp.req(5)))$$,'22023','Quote has expired','late answer refused');
reset role;
select is(private.expire_request_quotes(),1,'worker expires it once');
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000003');
select lives_ok($$select public.vendor_propose_quote(pg_temp.req(5),pg_temp.items(),'Gutters again',1)$$,'new proposal after expiry');
select pg_temp.as_user('91900000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_quote_queue()$$,'42501',null,'homeowner cannot read the queue');
reset role;

-- ------------------------------------------------------------------ G6 payment outcomes
-- Request 9: obligation with a published snapshot; attempts written as the money kernel records them.
insert into public.money_obligations(id,service_request_id,customer_id,contractor_id) values
 ('91950000-0000-4000-8000-000000000001',pg_temp.req(9),'91900000-0000-4000-8000-000000000001','91910000-0000-4000-8000-000000000001'),
 ('91950000-0000-4000-8000-000000000002',pg_temp.req(10),'91900000-0000-4000-8000-000000000001','91910000-0000-4000-8000-000000000001');
insert into public.money_snapshots(id,obligation_id,revision,invoice_number,service,addons,discount,adjustment,subtotal,tax,tip,deposit,total,currency,
  source_version,policy_version,tax_evidence,created_by,approved_by,reason,expires_at)
 select ('91960000-0000-4000-8000-00000000000'||n)::uuid,('91950000-0000-4000-8000-00000000000'||n)::uuid,1,'Q-SYN-'||n,20000,0,0,0,20000,0,0,0,20000,'usd',
  'synthetic','CFG-005','synthetic','91900000-0000-4000-8000-000000000002','91900000-0000-4000-8000-000000000006','Synthetic',now()+interval '1 day'
 from generate_series(1,2)n;
update public.money_obligations set current_snapshot_id=('91960000-0000-4000-8000-00000000000'||right(id::text,1))::uuid where id::text like '91950000-%';
insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at,created_at)
 values ('91950000-0000-4000-8000-000000000001','91960000-0000-4000-8000-000000000001','91900000-0000-4000-8000-000000000001','full',20000,'usd','syn-1','syn-k1','session_created',now()+interval '30 minutes',now());
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('payment_failed',pg_temp.req(9)) is null and pg_temp.queued('payment_unresolved',pg_temp.req(9)) is null,'checkout in progress is not an exception');
reset role;
select throws_ok($$insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at)
 values ('91950000-0000-4000-8000-000000000001','91960000-0000-4000-8000-000000000001','91900000-0000-4000-8000-000000000001','full',20000,'usd','syn-2','syn-k2','prepared',now()+interval '30 minutes')$$,
 '23505',null,'a second active checkout attempt is refused (no duplicate charge)');
-- Confirmed unpaid outcome: the session expired by webhook 24 hours ago.
update public.money_checkout_attempts set status='expired',stripe_session_id='cs_syn_1' where business_key='syn-1';
insert into public.money_webhook_events(event_id,event_type,payload,status,received_at)
 values ('evt_syn_1','checkout_expired',jsonb_build_object('attempt_id',(select id from public.money_checkout_attempts where business_key='syn-1'),'session_id','cs_syn_1'),'processed',now()-interval '24 hours');
-- Unknown outcome: session past its expiry with no result recorded.
insert into public.money_checkout_attempts(obligation_id,snapshot_id,customer_id,mode,amount,currency,business_key,stripe_idempotency_key,status,expires_at,created_at)
 values ('91950000-0000-4000-8000-000000000002','91960000-0000-4000-8000-000000000002','91900000-0000-4000-8000-000000000001','full',20000,'usd','syn-3','syn-k3','session_created',now()-interval '1 minute',now()-interval '1 hour');
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select is(pg_temp.queued('payment_failed',pg_temp.req(9))->>'aged','true','confirmed failure queued and aged at 24 hours');
select is(pg_temp.queued('payment_unresolved',pg_temp.req(10))->>'aged','false','unknown outcome queued immediately for investigation');
select ok(pg_temp.queued('payment_failed',pg_temp.req(10)) is null,'unknown is not reported as failure');
reset role;
select is((select (status::text,quote_status) from public.service_requests where id=pg_temp.req(7)),('scheduled'::text,'accepted'::text),'payment exceptions change no request or quote');
-- Success clears the item; failure never started service or released funds.
update public.money_checkout_attempts set status='captured',stripe_payment_id='pi_syn_3',completed_at=now() where business_key='syn-3';
update public.money_obligations set captured=20000 where id='91950000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.as_user('91900000-0000-4000-8000-000000000002');
select ok(pg_temp.queued('payment_unresolved',pg_temp.req(10)) is null,'captured payment leaves the queue');
reset role;
select is((select status::text from public.service_requests where id=pg_temp.req(9)),'scheduled','failure does not cancel or start service');

select * from finish();
rollback;
