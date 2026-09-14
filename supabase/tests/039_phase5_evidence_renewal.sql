begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-072 synthetic fixtures only. Covers the compliance expiry queue, the checklist
-- renewal notice and the vendor's own renewal readback. Document paths are synthetic
-- strings; no real provider, account or document is represented here. now() is fixed
-- for the transaction, so the notice boundary is exact.
insert into auth.users(id,email,email_confirmed_at) values
 ('a7100000-0000-4000-8000-000000000001','renewal-operator@example.invalid',now()),
 ('a7100000-0000-4000-8000-000000000002','renewal-vendor@example.invalid',now()),
 ('a7100000-0000-4000-8000-000000000003','renewal-unlinked-vendor@example.invalid',now()),
 ('a7100000-0000-4000-8000-000000000004','renewal-plain@example.invalid',now()),
 ('a7100000-0000-4000-8000-000000000005','renewal-other-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('a7100000-0000-4000-8000-000000000001','admin'),
 ('a7100000-0000-4000-8000-000000000002','vendor'),
 ('a7100000-0000-4000-8000-000000000003','vendor'),
 ('a7100000-0000-4000-8000-000000000005','vendor');
-- 1 expiring license, 2 lapsed license, 3 suspended with insurance at the boundary,
-- 4 just outside the window, 5 under review, 6 rejected.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('a7200000-0000-4000-8000-000000000001','Synthetic expiring provider',true,false,'a7100000-0000-4000-8000-000000000002'),
 ('a7200000-0000-4000-8000-000000000002','Synthetic lapsed provider',true,false,'a7100000-0000-4000-8000-000000000005'),
 ('a7200000-0000-4000-8000-000000000003','Synthetic suspended provider',false,false,null),
 ('a7200000-0000-4000-8000-000000000004','Synthetic outside-window provider',true,false,null),
 ('a7200000-0000-4000-8000-000000000005','Synthetic review provider',false,false,null),
 ('a7200000-0000-4000-8000-000000000006','Synthetic rejected provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('a7300000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic renewal provider '||n,'Test','Renewal',
   'renewal-'||n||'@example.invalid','synthetic',('a7200000-0000-4000-8000-00000000000'||n)::uuid,
   array['synthetic/a7'||n||'/license.pdf','synthetic/a7'||n||'/insurance.pdf']
 from generate_series(1,6) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('a7200000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('a7300000-0000-4000-8000-00000000000'||n)::uuid),
   3,case n when 3 then 'suspended' when 5 then 'review' when 6 then 'rejected' else 'active' end
 from generate_series(1,6) n;

-- Nine current items per provider; license and insurance expire in a year unless set below.
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1',
   case when k in ('license','insurance') then 'synthetic/a7'||right(o.contractor_id::text,1)||'/'||k||'.pdf' else 'Synthetic '||k end,
   now()-interval '400 days',case when k in ('license','insurance') then now()+interval '1 year' end,
   'a7100000-0000-4000-8000-000000000001'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id::text like 'a7200000-%';

create function pg_temp.replace_evidence(p_contractor uuid,p_kind text,p_expires timestamptz) returns uuid language sql as $$
 insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by,supersedes)
 select e.contractor_id,e.application_version_id,e.kind,e.requirement_version,e.evidence_ref,now()-interval '1 day'-interval '400 days',p_expires,e.reviewed_by,e.id
 from public.vendor_compliance_evidence e where e.contractor_id=p_contractor and e.kind=p_kind
  and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id)
 returning id $$;
-- Provider 1 once had a lapsed license that was already replaced; only the replacement counts.
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000001','license',now()-interval '2 days');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000001','license',now()+interval '10 days');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000002','license',now()-interval '1 day');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000003','insurance',now()+interval '30 days');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000004','license',now()+interval '30 days'+interval '1 second');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000005','license',now()+interval '5 days');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000006','license',now()-interval '1 day');

create function pg_temp.entries() returns jsonb language sql as $$
 select coalesce(jsonb_agg(e) filter (where e->>'contractor_id' like 'a7200000-%'),'[]'::jsonb)
 from jsonb_array_elements(public.vendor_evidence_renewal_queue()->'entries') e $$;
create function pg_temp.item(p_contractor uuid,p_kind text) returns jsonb language sql as $$
 select i from jsonb_array_elements(public.vendor_onboarding_checklist(p_contractor)->'items') i where i->>'kind'=p_kind $$;
create function pg_temp.state() returns text language sql as $$ select md5(concat_ws('|',
 (select count(*) from public.vendor_compliance_evidence),
 (select count(*) from public.vendor_checklist_evidence_requests),
 (select string_agg(contractor_id||':'||status||':'||revision,',' order by contractor_id) from public.vendor_onboarding),
 (select count(*) from public.vendor_onboarding_events),
 (select count(*) from public.vendor_role_decisions),
 (select count(*) from public.user_roles),
 (select string_agg(id||':'||coalesce(is_active::text,'null'),',' order by id) from public.contractors))) $$;
create temp table snap(k text primary key,v text);
insert into snap values('before',pg_temp.state());

-- Access.
set local role anon;
select throws_ok($$select public.vendor_evidence_renewal_queue()$$,
 '42501','permission denied for function vendor_evidence_renewal_queue','Anonymous caller cannot read the renewal queue');
select throws_ok($$select public.vendor_own_evidence_renewal()$$,
 '42501','permission denied for function vendor_own_evidence_renewal','Anonymous caller cannot read vendor renewal notices');
reset role;
set local role service_role;
select throws_ok($$select public.vendor_evidence_renewal_queue()$$,
 '42501','permission denied for function vendor_evidence_renewal_queue','Service role cannot read the renewal queue');
reset role;
set local role authenticated;
select throws_ok($$select private.vendor_renewal_items(null,now())$$,
 '42501','permission denied for schema private','The renewal selection is not a client function');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_evidence_renewal_queue()$$,
 '42501','Onboarding operator required','A vendor cannot read the operator queue');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000004"}',true);
set local role authenticated;
select throws_ok($$select public.vendor_own_evidence_renewal()$$,
 '42501','Vendor account required','An account without the vendor role gets no renewal notices');
reset role;

-- Operator queue.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((public.vendor_evidence_renewal_queue()->>'notice_days')::integer,30,'The notice window is 30 days');
select is((select string_agg((e->>'contractor_id')||':'||(e->>'kind')||':'||(e->>'state'),',') from jsonb_array_elements(pg_temp.entries()) e),
 'a7200000-0000-4000-8000-000000000002:license:lapsed,'||
 'a7200000-0000-4000-8000-000000000001:license:expiring,'||
 'a7200000-0000-4000-8000-000000000003:insurance:expiring',
 'The queue lists lapsed and expiring evidence for live providers, soonest expiry first');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000004'),
 'Evidence expiring one second after the window is not listed');
select ok(exists(select 1 from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000003'
 and (e->>'expires_at')::timestamptz=now()+interval '30 days'),'Evidence expiring exactly at the window edge is listed');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id' in
 ('a7200000-0000-4000-8000-000000000005','a7200000-0000-4000-8000-000000000006')),
 'Providers under review or rejected are not in the renewal queue');
select is((select count(*) from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000001'),1::bigint,
 'A replaced lapsed license is not listed beside its replacement');
select is((select e->>'onboarding_status' from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000003'),
 'suspended','A suspended provider is listed with its status');
select is((select (e->>'eligible')::boolean from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000002'),
 false,'Lapsed evidence is reported as ineligible for matching');
select is((select (e->>'eligible')::boolean from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000001'),
 true,'Expiring evidence leaves the provider eligible');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.entries()) e where e ? 'evidence_ref'),'The queue omits evidence references');

-- Flag only: nothing is suspended or revised.
reset role;
select is((select status||':'||revision from public.vendor_onboarding where contractor_id='a7200000-0000-4000-8000-000000000002'),
 'active:3','A lapsed provider stays active at the same revision');
set local role authenticated;

-- Checklist renewal notice.
select is((public.vendor_onboarding_checklist('a7200000-0000-4000-8000-000000000001')->>'renewal_notice_days')::integer,30,'The checklist reports the notice window');
select is((pg_temp.item('a7200000-0000-4000-8000-000000000001','license')->>'renewal_due')::boolean,true,'An expiring item is due for renewal');
select is(pg_temp.item('a7200000-0000-4000-8000-000000000001','license')->>'state','current','An expiring item is still current');
select is((pg_temp.item('a7200000-0000-4000-8000-000000000001','insurance')->>'renewal_due')::boolean,false,'An item outside the window is not due');
select is((pg_temp.item('a7200000-0000-4000-8000-000000000001','identity')->>'renewal_due')::boolean,false,'An item without an expiry is never due');
select is((pg_temp.item('a7200000-0000-4000-8000-000000000002','license')->>'renewal_due')::boolean,false,'A lapsed item is reported expired, not due');
select is((pg_temp.item('a7200000-0000-4000-8000-000000000005','license')->>'renewal_due')::boolean,true,'The checklist notice also applies under review');
reset role;

-- Vendor's own notices.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select is(jsonb_array_length(public.vendor_own_evidence_renewal()->'items'),1,'A vendor sees only its own renewal notices');
select is((public.vendor_own_evidence_renewal()->'items'->0)-'expires_at',
 '{"kind":"license","state":"expiring"}'::jsonb,'A vendor notice carries only the item, expiry and state');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000005"}',true);
set local role authenticated;
select is(public.vendor_own_evidence_renewal()->'items'->0->>'state','lapsed','A vendor is told its own evidence lapsed');
reset role;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is(public.vendor_own_evidence_renewal()->'items','[]'::jsonb,'A vendor account without a provider has no notices');
reset role;
select is(pg_temp.state(),(select v from snap where k='before'),'Every readback wrote nothing');

-- Payout eligibility (owner decision 2026-09-13): a qualification lapse does not hold
-- payouts; lapsed payout onboarding, suspension and review still do.
reset role;
select is(public.vendor_is_eligible('a7200000-0000-4000-8000-000000000002'),false,'A lapsed license removes matching eligibility');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000002'),true,'A lapsed license does not hold payouts');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000001'),true,'An active provider with current evidence is payout eligible');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000003'),false,'Suspension still holds payouts');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000005'),false,'A provider under review is not payout eligible');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000006'),false,'A rejected provider is not payout eligible');
select pg_temp.replace_evidence('a7200000-0000-4000-8000-000000000004','bank_authorization',now()-interval '1 day');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000004'),false,'Lapsed payout onboarding still holds payouts');
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000004',now()-interval '2 days'),true,'Payout onboarding holds only once it has lapsed');
update public.vendor_applications set business_name='Synthetic renewal provider 1 revised' where id='a7300000-0000-4000-8000-000000000001';
select is(private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000001'),false,'A superseded application version still holds payouts');
set local role authenticated;
select throws_ok($$select private.vendor_payout_eligible('a7200000-0000-4000-8000-000000000002')$$,
 '42501','permission denied for schema private','Payout eligibility is not a client function');
reset role;

-- Renewal clears the entry through the existing checklist command and decision.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"a7100000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(public.vendor_record_checklist_evidence('a7200000-0000-4000-8000-000000000002','license','license-v1',
 'synthetic/a72/license.pdf',now()-interval '1 minute',now()+interval '1 year',
 (pg_temp.item('a7200000-0000-4000-8000-000000000002','license')->>'evidence_id')::uuid,'renewal-license-2')->>'recorded',
 'true','Renewed license evidence is recorded against the application document');
select ok(not exists(select 1 from jsonb_array_elements(pg_temp.entries()) e where e->>'contractor_id'='a7200000-0000-4000-8000-000000000002'),
 'Renewed evidence leaves the queue');
select is((public.vendor_onboarding_checklist('a7200000-0000-4000-8000-000000000002')->>'eligible')::boolean,true,'Renewed evidence restores eligibility');
select is(public.vendor_decide_onboarding('a7200000-0000-4000-8000-000000000002',3,'renew','Synthetic license renewal','renewal-decision-2'),
 4,'The renewal decision is recorded at the next revision');
select is((public.vendor_onboarding_checklist('a7200000-0000-4000-8000-000000000002')->>'onboarding_status'),'active','Renewal keeps the provider active');
reset role;

select * from finish();
rollback;
