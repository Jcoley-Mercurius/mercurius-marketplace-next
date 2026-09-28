-- TRACE-099: exclusive offers, selected-provider consent, exhaustion and the offer/assignment
-- boundary through the real commands (MPS §4/§5.2/§6.2; CFG-003/009; DEC-2026-007).
-- Synthetic identities and the synthetic 00000 ZIP only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Homeowners H1/H2, vendors A/B/C, admin. Providers A (preferred), B, C are eligible quote
-- providers with equal scores; D is inactive and E does not cover the ZIP.
insert into auth.users(id,raw_user_meta_data) values
 ('e9900000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner one"}'),
 ('e9900000-0000-4000-8000-000000000002','{"full_name":"Synthetic homeowner two"}'),
 ('e9900000-0000-4000-8000-000000000003','{"full_name":"Synthetic vendor A"}'),
 ('e9900000-0000-4000-8000-000000000004','{"full_name":"Synthetic vendor B"}'),
 ('e9900000-0000-4000-8000-000000000005','{"full_name":"Synthetic vendor C"}'),
 ('e9900000-0000-4000-8000-000000000006','{"full_name":"Synthetic admin"}');
insert into public.user_roles(user_id,role) values
 ('e9900000-0000-4000-8000-000000000003','vendor'),('e9900000-0000-4000-8000-000000000004','vendor'),
 ('e9900000-0000-4000-8000-000000000005','vendor'),('e9900000-0000-4000-8000-000000000006','admin')
 on conflict do nothing;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('e9910000-0000-4000-8000-000000000001','e9900000-0000-4000-8000-000000000003','Synthetic provider A',true,true),
 ('e9910000-0000-4000-8000-000000000002','e9900000-0000-4000-8000-000000000004','Synthetic provider B',true,true),
 ('e9910000-0000-4000-8000-000000000003','e9900000-0000-4000-8000-000000000005','Synthetic provider C',true,true),
 ('e9910000-0000-4000-8000-000000000004',null,'Synthetic inactive provider',false,true),
 ('e9910000-0000-4000-8000-000000000005',null,'Synthetic uncovered provider',true,true);
insert into public.coverage_areas(zip_code,city) values ('00000','Synthetic test area') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id,zip_code)
 select id,'00000' from public.contractors where id::text like 'e9910000-%' and id<>'e9910000-0000-4000-8000-000000000005';
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
 select ('e9920000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('e9910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (select id from public.services_catalog order by id limit 1),'Synthetic quote offering','custom_quote','one-time',true
 from generate_series(1,5)n;
insert into public.service_requests(id,customer_id,service_type,address,city,state,service_catalog_id,frequency,zip_code,preferred_contractor_id)
 select ('e9930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e9900000-0000-4000-8000-000000000001',
 'Synthetic service','1 Synthetic Way','Synthetic','FL',(select id from public.services_catalog order by id limit 1),'one-time','00000',
 case when n in (1,5) then 'e9910000-0000-4000-8000-000000000001'::uuid end
 from generate_series(1,5)n;

-- M1: eligibility precedes ranking; equal scores break ties by stable provider ID.
select is((select count(*) from private.find_eligible_packages_core('e9930000-0000-4000-8000-000000000002')),3::bigint,
 'inactive and uncovered providers are excluded from the pool');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000001"}',true);
select isnt(public.start_request_matching('e9930000-0000-4000-8000-000000000002'),null::uuid,'homeowner starts matching for an unselected quote request');
select isnt(public.start_request_matching('e9930000-0000-4000-8000-000000000001'),null::uuid,'homeowner starts matching for a selected-provider request');
reset role;
select is((select contractor_id from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000002' and outcome='pending'),
 'e9910000-0000-4000-8000-000000000001'::uuid,'unselected request goes to the first provider in the deterministic ranking');
select is((select contractor_id from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),
 'e9910000-0000-4000-8000-000000000001'::uuid,'eligible selected provider receives the first offer');
select is((select expires_at-offered_at from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),
 interval '4 hours','the offer window is four hours from the offer timestamp');

-- M4: read and write boundary while the offer is only pending.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000003"}',true);
select is((select count(*) from public.service_requests where id='e9930000-0000-4000-8000-000000000001'),1::bigint,
 'characterization: the offered vendor can read the request (service address and notes) before accepting');
select is((select count(*) from public.profiles where user_id='e9900000-0000-4000-8000-000000000001'),0::bigint,
 'the offered vendor cannot read the homeowner profile');
select throws_ok($$update public.service_requests set address='Vendor rewrite' where id='e9930000-0000-4000-8000-000000000001'$$,
 '42501','Accept the offer before changing this request','an offered vendor cannot rewrite the homeowner address');
select throws_ok($$update public.service_requests set notes='Vendor note' where id='e9930000-0000-4000-8000-000000000001'$$,
 '42501','Accept the offer before changing this request','an offered vendor cannot write request notes before accepting');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000004"}',true);
select is((select count(*) from public.service_requests where id='e9930000-0000-4000-8000-000000000001'),0::bigint,
 'another vendor cannot read the request');
select throws_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000001')$$,'P0001','No open offer is available to accept',
 'another vendor cannot accept the offer');
select throws_ok($$select public.vendor_decline_job('e9930000-0000-4000-8000-000000000001')$$,'P0001','No open offer is available to decline',
 'another vendor cannot decline the offer');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000001')$$,'P0001','No open offer is available to accept',
 'the homeowner cannot accept for the vendor');
reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous callers cannot accept');
select throws_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous callers cannot consent');
reset role;
select is((select address from public.service_requests where id='e9930000-0000-4000-8000-000000000001'),'1 Synthetic Way','the request is unchanged by refused writes');

-- M3: the selected provider declines; nothing moves without the owner's consent.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.vendor_decline_job('e9930000-0000-4000-8000-000000000001','Synthetic decline')$$,'the selected provider declines');
select is((select count(*) from public.service_requests where id='e9930000-0000-4000-8000-000000000001'),0::bigint,
 'the declining vendor loses access to the request');
reset role;
select results_eq($$select status::text, matching_status, contractor_id from public.service_requests where id='e9930000-0000-4000-8000-000000000001'$$,
 $$values ('pending'::text,'awaiting_consent'::text,null::uuid)$$,'decline by the selected provider waits for homeowner consent');
select is((select count(*) from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),0::bigint,
 'no fallback offer exists before consent');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000002"}',true);
select throws_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'42501',null,'another homeowner cannot consent');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000004"}',true);
select throws_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'42501',null,'a vendor cannot consent');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000006"}',true);
select throws_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'42501',null,'an admin cannot consent for the homeowner');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'the homeowner consents');
select lives_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000001')$$,'a repeated consent recovers without error');
reset role;
select is((select contractor_id from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),
 'e9910000-0000-4000-8000-000000000002'::uuid,'consent offers the next ranked provider, never the one who declined');
select is((select count(*) from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),1::bigint,
 'repeated consent creates one exclusive offer');
select is((select count(*) from public.matching_fallback_consents where request_id='e9930000-0000-4000-8000-000000000001'),1::bigint,'one consent record');
select is((select count(*) from public.job_events where job_id='e9930000-0000-4000-8000-000000000001' and metadata->>'action'='provider_fallback_consented'),1::bigint,
 'one consent audit event');
select is((select preferred_contractor_id from public.service_requests where id='e9930000-0000-4000-8000-000000000001'),
 'e9910000-0000-4000-8000-000000000001'::uuid,'consent preserves the recorded preference');

-- Decline and expiry advance one provider at a time, then exhaust honestly.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000004"}',true);
select lives_ok($$select public.vendor_decline_job('e9930000-0000-4000-8000-000000000001')$$,'the fallback provider declines');
reset role;
select is((select contractor_id from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),
 'e9910000-0000-4000-8000-000000000003'::uuid,'decline advances to the next ranked provider under the recorded consent');
update public.job_match_attempts set expires_at=now()-interval '1 second'
 where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000002"}',true);
select is(public.expire_stale_matches(),0,'another homeowner cannot expire this homeowner''s offer');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000001"}',true);
select is(public.expire_stale_matches(),1,'the homeowner''s own read advances the lapsed offer');
select is(public.start_request_matching('e9930000-0000-4000-8000-000000000001'),null::uuid,'restarting an exhausted request creates no offer');
reset role;
select results_eq($$select status::text, matching_status, contractor_id, needs_admin_review from public.service_requests where id='e9930000-0000-4000-8000-000000000001'$$,
 $$values ('pending'::text,'exhausted'::text,null::uuid,true)$$,'no remaining eligible provider exhausts the request for operations review');
select is((select count(*) from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000001' and outcome='pending'),0::bigint,
 'an exhausted request has no pending offer');
select results_eq($$select event_type::text, count(*) from public.job_events where job_id='e9930000-0000-4000-8000-000000000001'
   and event_type in ('match_offered','match_declined','match_expired') group by 1 order by 1$$,
 $$values ('match_declined'::text,2::bigint),('match_expired'::text,1::bigint),('match_offered'::text,3::bigint)$$,
 'each offer, decline and expiry is audited exactly once');

-- M2/M5: the four-hour boundary and accepted quote work.
update public.job_match_attempts set expires_at=now()
 where service_request_id='e9930000-0000-4000-8000-000000000002' and outcome='pending';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000003"}',true);
select throws_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000002')$$,'22023','Offer has expired','acceptance at the deadline is refused');
reset role;
select is((select status::text from public.service_requests where id='e9930000-0000-4000-8000-000000000002'),'matched','a refused acceptance schedules nothing');
update public.job_match_attempts set expires_at=now()+interval '1 millisecond'
 where service_request_id='e9930000-0000-4000-8000-000000000002' and outcome='pending';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000003"}',true);
select lives_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000002')$$,'acceptance immediately before the deadline succeeds');
select throws_ok($$select public.vendor_accept_job('e9930000-0000-4000-8000-000000000002')$$,'P0001','No open offer is available to accept','a repeated acceptance is refused');
select throws_ok($$select public.vendor_decline_job('e9930000-0000-4000-8000-000000000002')$$,'P0001','No open offer is available to decline','an accepted offer cannot be declined');
select lives_ok($$update public.service_requests set notes='Synthetic assigned note' where id='e9930000-0000-4000-8000-000000000002'$$,
 'the accepted vendor keeps the existing note allowlist');
select throws_ok($$update public.service_requests set address='Vendor rewrite' where id='e9930000-0000-4000-8000-000000000002'$$,
 '42501','Vendors are not allowed to modify "address" on a service request','the accepted vendor still cannot rewrite the address');
select throws_ok($$update public.service_requests set zip_code='00001' where id='e9930000-0000-4000-8000-000000000002'$$,
 '42501','Vendors are not allowed to modify "zip_code" on a service request','the accepted vendor cannot move the request''s ZIP');
select is((select count(*) from public.profiles where user_id='e9900000-0000-4000-8000-000000000001'),0::bigint,
 'characterization: the assigned vendor still cannot read the homeowner profile');
reset role;
select results_eq($$select status::text, matching_status, quote_only, scheduled_start_at from public.service_requests where id='e9930000-0000-4000-8000-000000000002'$$,
 $$values ('scheduled'::text,'matched'::text,true,null::timestamptz)$$,'accepted quote work is scheduled with no invented appointment time (DEC-2026-007)');
select is((select count(*) from public.job_events where job_id='e9930000-0000-4000-8000-000000000002' and metadata->>'reason'='vendor_accepted'),1::bigint,
 'acceptance is audited once');

-- Characterization: the stored command accepts consent while the selected provider still
-- holds the offer. The offer is unchanged; the UI offers consent only after it is needed.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000001"}',true);
select isnt(public.start_request_matching('e9930000-0000-4000-8000-000000000005'),null::uuid,'the selected provider is offered another request');
select lives_ok($$select public.consent_to_provider_fallback('e9930000-0000-4000-8000-000000000005')$$,
 'characterization: early consent is accepted while the selected provider holds the offer');
reset role;
select is((select contractor_id from public.job_match_attempts where service_request_id='e9930000-0000-4000-8000-000000000005' and outcome='pending'),
 'e9910000-0000-4000-8000-000000000001'::uuid,'early consent leaves the selected provider''s offer in place');

-- Admin notes still use the direct update path.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9900000-0000-4000-8000-000000000006"}',true);
select lives_ok($$update public.service_requests set notes='Synthetic admin note' where id='e9930000-0000-4000-8000-000000000003'$$,'admin notes are unaffected');
reset role;

select * from finish();
rollback;
