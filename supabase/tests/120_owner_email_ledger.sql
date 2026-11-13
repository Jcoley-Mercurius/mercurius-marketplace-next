-- TRACE-154 (Phase 7.2C-1 and 7.2C-2): owner-email ledger for contact submissions and provider
-- renewal-document submissions.
-- Atomic creation and rollback, shape checks, claim rules, a committed claim whose response
-- is lost, confirmed claim rollback, derived states, resend and acknowledgement attestations,
-- bounded keyset pages with exact counts, queue privacy, authorization, on-demand detail
-- (DEC-2026-066), cascade, the old-application compatibility case and unchanged surfaces.
-- 7.2C-2 (section 9): provider-only atomic creation and rollback through the real
-- vendor_submit_renewal_document RPC, replay and operator suppression, the renewal claim
-- payload, missing name versus claim failure, expiry and attested recovery, source privacy,
-- operator/service-only/cross-account boundaries and the old renewal route on the new schema.
-- Synthetic identities and content only. Every change rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1 admin operator, 2 homeowner, 3 vendor.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1200000-0000-4000-8000-000000000001','owner-email-operator@example.test',now(),'{}'),
 ('e1200000-0000-4000-8000-000000000002','owner-email-homeowner@example.test',now(),'{}'),
 ('e1200000-0000-4000-8000-000000000003','owner-email-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values
 ('e1200000-0000-4000-8000-000000000001','admin'),
 ('e1200000-0000-4000-8000-000000000002','homeowner'),
 ('e1200000-0000-4000-8000-000000000003','vendor')
on conflict do nothing;

create function pg_temp.run(p_sub uuid, p_role text, p_sql text)
returns jsonb language plpgsql as $$
declare result jsonb;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('role',p_role,'sub',p_sub)::text,true);
 execute format('set local role %I', p_role);
 execute p_sql into result;
 reset role;
 return result;
end $$;
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$ select pg_temp.run(null,'service_role',p_sql) $$;
create function pg_temp.op(p_sql text) returns jsonb language sql as $$
 select pg_temp.run('e1200000-0000-4000-8000-000000000001','authenticated',p_sql) $$;
create function pg_temp.user(p_n int, p_sql text) returns jsonb language sql as $$
 select pg_temp.run(('e1200000-0000-4000-8000-00000000000'||p_n)::uuid,'authenticated',p_sql) $$;
-- The service-role contact insert the route makes (bare, as the old release does).
create function pg_temp.contact(p_id uuid, p_subject text default 'Synthetic subject') returns void language sql as $$
 select pg_temp.run(null,'service_role',format(
  'with i as (insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message) values (%L,%L,%L,%L,null,%L,%L) returning 1) select to_jsonb(count(*)) from i',
  p_id,'Synthetic','Sender','sender@example.test',p_subject,'Synthetic message body')) $$;
create function pg_temp.claim(p_id uuid, p_mode text default 'initial') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.owner_email_claim(''contact_submission'',%L,%L)',p_id,p_mode)) $$;
create function pg_temp.record(p_id uuid, p_claim text, p_outcome text, p_code text default null) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.owner_email_record(''contact_submission'',%L,%L,%L,%L,%L)',
  p_id,p_claim,p_outcome,case when p_outcome='sent' then 'msg_synthetic' end,p_code)) $$;
create function pg_temp.resend(p_id uuid, p_confirm boolean default false) returns jsonb language sql as $$
 select pg_temp.op(format('select public.owner_email_request_resend(''contact_submission'',%L,%L)',p_id,p_confirm)) $$;
create function pg_temp.ack(p_id uuid, p_reason text, p_checked boolean default false) returns jsonb language sql as $$
 select pg_temp.op(format('select public.owner_email_acknowledge(''contact_submission'',%L,%L,%L)',p_id,p_reason,p_checked)) $$;
create function pg_temp.ledger(p_id uuid) returns private.owner_email_notifications language sql as $$
 select * from private.owner_email_notifications where contact_submission_id=p_id $$;
create function pg_temp.page(p_settled boolean default false, p_created text default null, p_id text default null, p_limit int default null)
returns jsonb language sql as $$
 select pg_temp.op(format('select public.owner_email_overview(null,%L,%L,%L,%s)',p_settled,p_created,p_id,coalesce(p_limit::text,'50'))) $$;
create function pg_temp.view(p_id uuid) returns text language sql as $$
 select n->>'state' from jsonb_array_elements(pg_temp.page(true,null,null,100)->'items') n where (n->>'source_id')::uuid=p_id $$;

-- Least privilege -------------------------------------------------------------------
select ok(not has_table_privilege(r,t,'SELECT') and not has_table_privilege(r,t,'INSERT')
      and not has_table_privilege(r,t,'UPDATE') and not has_table_privilege(r,t,'DELETE'),
 'no client or service role touches '||t||' directly: '||r)
 from unnest(array['anon','authenticated','service_role']) r,
      unnest(array['private.owner_email_notifications','private.owner_email_notification_events']) t;
select ok((select relrowsecurity from pg_class where oid=t::regclass),'RLS is enabled on '||t)
 from unnest(array['private.owner_email_notifications','private.owner_email_notification_events']) t;
select ok(has_function_privilege('service_role',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE')
      and not has_function_privilege('anon',f,'EXECUTE'),'only the service key may '||f)
 from unnest(array['public.owner_email_claim(text,uuid,text)','public.owner_email_record(text,uuid,uuid,text,text,text)']) f;
select ok(has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('anon',f,'EXECUTE')
      and not has_function_privilege('service_role',f,'EXECUTE'),'operator command is signed-in only (guarded inside): '||f)
 from unnest(array['public.owner_email_request_resend(text,uuid,boolean)','public.owner_email_acknowledge(text,uuid,text,boolean)',
  'public.owner_email_overview(text,boolean,timestamp with time zone,uuid,integer)','public.owner_email_contact_submission(uuid)']) f;
select ok(not has_function_privilege(r,p.oid,'EXECUTE'),'private helper is not executable: '||p.proname||' by '||r)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace, unnest(array['anon','authenticated','service_role']) r
 where n.nspname='private' and p.proname like 'owner\_email\_%';
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'owner\_email\_%' and not p.prosecdef
    and p.proname not in ('owner_email_require_kind','owner_email_state')),0,
 'every owner-email function that touches data is security definer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'owner\_email\_%'
    and not coalesce(p.proconfig @> array['search_path=""'],false)),0,'every owner-email function pins an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'owner\_email\_%'
    and exists (select 1 from unnest(p.proargtypes::oid[]) t where t in (select oid from pg_type where typcategory='A'))),0,
 'no owner-email command takes a list: one row per call, no bulk acknowledgement');
select is((select string_agg(tgname,',') from pg_trigger where tgrelid='public.contact_submissions'::regclass and not tgisinternal),
 'owner_email_contact_create','the contact table has exactly the new AFTER INSERT trigger');
-- 7.2C-2: exactly one renewal trigger, AFTER INSERT, provider submissions only, enabled.
select is((select string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid), ',' order by tgname) from pg_trigger
  where tgrelid='public.vendor_renewal_documents'::regclass and not tgisinternal and tgname like 'owner\_email\_%'),
 'owner_email_renewal_create:O:CREATE TRIGGER owner_email_renewal_create AFTER INSERT ON public.vendor_renewal_documents FOR EACH ROW WHEN ((new.submitted_as = ''provider''::text)) EXECUTE FUNCTION private.owner_email_renewal_create()',
 'the renewal table has exactly the provider-only AFTER INSERT trigger, enabled');
select is((select string_agg(tgname,',' order by tgname) from pg_trigger where tgrelid='public.vendor_renewal_documents'::regclass and not tgisinternal),
 'immutable_evidence,owner_email_renewal_create','the immutability trigger is kept beside it');

-- 1. Atomic creation ------------------------------------------------------------------
select pg_temp.contact('e1300000-0000-4000-8000-000000000001');
select is((select count(*)::int from private.owner_email_notifications where contact_submission_id='e1300000-0000-4000-8000-000000000001' and state='pending' and attempts=0),
 1,'a saved contact submission gets exactly one pending ledger row');
select is((select count(*)::int from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1300000-0000-4000-8000-000000000001' and e.state='pending' and e.previous_state is null and e.attempt=0),
 1,'and one creation event');
select is((select created_at from private.owner_email_notifications where contact_submission_id='e1300000-0000-4000-8000-000000000001'),
 (select created_at from public.contact_submissions where id='e1300000-0000-4000-8000-000000000001'),'the ledger row is created in the submission transaction');
-- A forced ledger failure fails the whole insert statement: neither row is saved.
alter table private.owner_email_notifications add constraint test_force_failure check (false) not valid;
select throws_ok($$select pg_temp.contact('e1300000-0000-4000-8000-0000000000ff')$$,'23514',null,'a ledger failure fails the contact insert');
alter table private.owner_email_notifications drop constraint test_force_failure;
select is((select count(*)::int from public.contact_submissions where id='e1300000-0000-4000-8000-0000000000ff'),0,
 'the contact row is rolled back with its ledger row');
-- The route reads the saved ID back with RETURNING.
select is(pg_temp.svc($$with i as (insert into public.contact_submissions(first_name,last_name,email,subject,message)
  values ('Synthetic','Returning','returning@example.test','Returning subject','Body') returning id) select to_jsonb(id) from i$$) is not null,
 true,'the service key can read the new ID with RETURNING');

-- 2. Shape and enumeration checks -------------------------------------------------------
select throws_ok($$insert into private.owner_email_notifications(source_kind) values ('contact_submission')$$,'23514',null,'a contact row needs its contact FK');
select throws_ok($$insert into private.owner_email_notifications(source_kind,contact_submission_id,renewal_document_id)
  values ('renewal_document','e1300000-0000-4000-8000-000000000001',null)$$,'23514',null,'kind and FK must agree');
select throws_ok($$insert into private.owner_email_notifications(source_kind,contact_submission_id) values ('newsletter','e1300000-0000-4000-8000-000000000001')$$,
 '23514',null,'an unknown source kind is refused');
select throws_ok($$update private.owner_email_notifications set state='sending' where contact_submission_id='e1300000-0000-4000-8000-000000000001'$$,
 '23514',null,'sending needs a claim');
select throws_ok($$update private.owner_email_notifications set state='sent' where contact_submission_id='e1300000-0000-4000-8000-000000000001'$$,
 '23514',null,'sent needs sent_at');
select throws_ok($$update private.owner_email_notifications set state='acknowledged' where contact_submission_id='e1300000-0000-4000-8000-000000000001'$$,
 '23514',null,'acknowledged needs acknowledged_at');
select throws_ok($$update private.owner_email_notifications set last_error_code='Resend says hi' where contact_submission_id='e1300000-0000-4000-8000-000000000001'$$,
 '23514',null,'only an enumerated error category is stored');
select throws_ok($$insert into private.owner_email_notifications(source_kind,contact_submission_id) values ('contact_submission','e1300000-0000-4000-8000-000000000001')$$,
 '23505',null,'one ledger row per contact submission');
select throws_ok($$insert into private.owner_email_notification_events(notification_id,source_kind,source_id,state,attempt,attestation)
  select id,'contact_submission',contact_submission_id,'pending',0,'trust me' from private.owner_email_notifications limit 1$$,
 '23514',null,'only an enumerated attestation is stored');

-- 3. Claim rules ------------------------------------------------------------------------
create temp table claims(n int primary key, body jsonb);
grant all on claims to service_role, authenticated;
insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-000000000001'));
insert into claims values (2, pg_temp.claim('e1300000-0000-4000-8000-000000000001'));
select ok((select (body->>'claimed')::boolean from claims where n=1),'the first initial claim wins');
select is((select body from claims where n=2),jsonb_build_object('claimed',false,'state','sending'),'a second initial claim sends nothing');
select is((select (body->>'attempt')::int from claims where n=1),1,'the first claim is attempt 1');
select is((select body->'source' from claims where n=1),
 (select jsonb_build_object('id',id,'created_at',created_at,'first_name',first_name,'last_name',last_name,'email',email,
   'phone',phone,'subject',subject,'message',message) from public.contact_submissions where id='e1300000-0000-4000-8000-000000000001'),
 'the claim returns the saved record, not caller content');
select is(((pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).claim_id)::text,(select body->>'claim_id' from claims where n=1),
 'the claim UUID is stored as the capability to record');
select throws_ok($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',gen_random_uuid()::text,'sent')$$,
 '40001','Owner email claim is not current','a forged claim cannot record');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',%L,'sent','provider_refused')$$,(select body->>'claim_id' from claims where n=1)),
 '22023',null,'a sent outcome carries no error code');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',%L,'failed',null)$$,(select body->>'claim_id' from claims where n=1)),
 '22023',null,'a failed outcome needs an enumerated code');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',%L,'failed','Resend returned 422: sender@example.test')$$,(select body->>'claim_id' from claims where n=1)),
 '22023',null,'provider text is never accepted as a code');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',%L,'delivered',null)$$,(select body->>'claim_id' from claims where n=1)),
 '22023',null,'an unknown outcome is refused');
select throws_ok($$select pg_temp.svc('select public.owner_email_claim(''contact_submission'',''e1300000-0000-4000-8000-000000000001'',''bulk'')')$$,
 '22023',null,'an unknown claim mode is refused');
select throws_ok($$select pg_temp.svc('select public.owner_email_claim(''newsletter'',''e1300000-0000-4000-8000-000000000001'',''initial'')')$$,
 '22023',null,'an unknown kind is refused');
select throws_ok($$select pg_temp.claim('e13fffff-0000-4000-8000-000000000001')$$,'P0002',null,'a claim for an unknown record is refused');
select is(pg_temp.record('e1300000-0000-4000-8000-000000000001',(select body->>'claim_id' from claims where n=1),'failed','provider_refused')->>'state',
 'failed','a definite provider refusal is recorded');
select is(row((pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).state,(pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).last_error_code,
  (pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).claim_id is null)::text,'(failed,provider_refused,t)','the outcome clears the claim');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000001',%L,'sent')$$,(select body->>'claim_id' from claims where n=1)),
 '40001',null,'one outcome per claim');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000001'),jsonb_build_object('claimed',false,'state','failed'),'no automatic retry after a failure');

-- Resend from failed: one more attempt with a fresh claim.
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000001','resend'),jsonb_build_object('claimed',false,'state','failed'),
 'resend mode claims nothing without an operator request');
select is(pg_temp.resend('e1300000-0000-4000-8000-000000000001')->>'state','resend_requested','an operator resends a failed email directly');
select is(pg_temp.resend('e1300000-0000-4000-8000-000000000001')->>'state','resend_requested','a repeated request is idempotent');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000001','initial')->>'claimed','false','a late initial sender cannot take a resend');
delete from claims; insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-000000000001','resend'));
select is((select (body->>'attempt')::int from claims where n=1),2,'the resend is attempt 2');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000001','resend')->>'claimed','false','a concurrent resend claim sends nothing');
select is(pg_temp.record('e1300000-0000-4000-8000-000000000001',(select body->>'claim_id' from claims where n=1),'sent')->>'state','sent','the resend is recorded');
select ok((pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).sent_at is not null
  and (pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).provider_message_id='msg_synthetic'
  and (pg_temp.ledger('e1300000-0000-4000-8000-000000000001')).last_error_code is null,'sent keeps the provider message ID and clears the error');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000001',true)$$,'55000',null,'a sent email cannot be resent');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-000000000001','reason',true)$$,'55000',null,'a sent email cannot be acknowledged');
select is((select count(*)::int from public.contact_submissions where id='e1300000-0000-4000-8000-000000000001'),1,'recovery created no second submission');
select is((select string_agg(coalesce(e.previous_state,'∅')||'>'||e.state||'@'||e.attempt, ' ' order by e.id) from private.owner_email_notification_events e
  join private.owner_email_notifications n on n.id=e.notification_id where n.contact_submission_id='e1300000-0000-4000-8000-000000000001'),
 '∅>pending@0 pending>sending@1 sending>failed@1 failed>resend_requested@1 resend_requested>sending@2 sending>sent@2',
 'every transition is audited once; an idempotent repeat adds none');

-- A stale worker cannot overwrite after an operator request clears its claim.
select pg_temp.contact('e1300000-0000-4000-8000-000000000002');
delete from claims; insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-000000000002'));
select is(pg_temp.record('e1300000-0000-4000-8000-000000000002',(select body->>'claim_id' from claims where n=1),'unknown','provider_server_error')->>'state',
 'unknown','a server error is recorded as unknown');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000002')$$,'55000',
 'Check the owner inbox and the Resend log, and confirm no matching email arrived, before resending','unknown needs the no-email attestation');
select is(pg_temp.resend('e1300000-0000-4000-8000-000000000002',true)->>'state','resend_requested','with the attestation, the resend is allowed');
select is((select attestation from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1300000-0000-4000-8000-000000000002' and e.state='resend_requested'),'no_matching_email_found',
 'the resend event records the no-email attestation');
select throws_ok(format($$select pg_temp.record('e1300000-0000-4000-8000-000000000002',%L,'sent')$$,(select body->>'claim_id' from claims where n=1)),
 '40001',null,'the earlier claim cannot record after the resend request');

-- 3a. A committed claim whose response is lost (clarification 1) -------------------------
-- The sender's claim commits, but its result never reaches the route. Nothing resets the
-- row; it stays sending, no automatic second claim is possible, and after the window it
-- reads unknown and needs the attestation.
select pg_temp.contact('e1300000-0000-4000-8000-000000000003');
select pg_temp.claim('e1300000-0000-4000-8000-000000000003');  -- result discarded: the response was lost
select is(row((pg_temp.ledger('e1300000-0000-4000-8000-000000000003')).state,(pg_temp.ledger('e1300000-0000-4000-8000-000000000003')).attempts)::text,
 '(sending,1)','a committed claim with a lost response stays sending at attempt 1');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000003'),jsonb_build_object('claimed',false,'state','sending'),'no second initial claim is possible');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000003','resend'),jsonb_build_object('claimed',false,'state','sending'),'and no resend claim');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000003',true)$$,'55000','This owner email cannot be resent from sending',
 'an operator cannot resend inside the claim window');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-000000000003','reason',true)$$,'55000',null,'nor acknowledge it');
update private.owner_email_notifications set claimed_at=now()-interval '11 minutes' where contact_submission_id='e1300000-0000-4000-8000-000000000003';
select is(pg_temp.view('e1300000-0000-4000-8000-000000000003'),'unknown','past the window the uncertain claim reads unknown');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000003'),jsonb_build_object('claimed',false,'state','unknown'),'unknown is never claimed automatically');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000003')$$,'55000',null,'resend from unknown needs the attestation');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-000000000003','Checked')$$,'55000',
 'Check the owner inbox and the Resend log before acknowledging an uncertain email','acknowledge from unknown needs the inbox-check attestation');
select is(pg_temp.resend('e1300000-0000-4000-8000-000000000003',true)->>'state','resend_requested','with the attestation the operator allows attempt 2');
select is((pg_temp.claim('e1300000-0000-4000-8000-000000000003','resend')->>'attempt')::int,2,'the recovery is a distinct attempt');

-- 3b. A confirmed SQL exception rolls the claim back --------------------------------------
create function pg_temp.fault() returns trigger language plpgsql as $$ begin raise exception 'synthetic claim fault' using errcode='55P03'; end $$;
select pg_temp.contact('e1300000-0000-4000-8000-000000000004');
create trigger test_claim_fault before update on private.owner_email_notifications for each row execute function pg_temp.fault();
select throws_ok($$select pg_temp.claim('e1300000-0000-4000-8000-000000000004')$$,'55P03',null,'a fault inside the claim raises (lock not available)');
drop trigger test_claim_fault on private.owner_email_notifications;
select is(row((pg_temp.ledger('e1300000-0000-4000-8000-000000000004')).state,(pg_temp.ledger('e1300000-0000-4000-8000-000000000004')).attempts,
  (pg_temp.ledger('e1300000-0000-4000-8000-000000000004')).claim_id is null)::text,'(pending,0,t)','the raised claim left no partial claim');
select is((select count(*)::int from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1300000-0000-4000-8000-000000000004' and e.state='sending'),0,'and no claim event');
select is((select count(*)::int from public.contact_submissions where id='e1300000-0000-4000-8000-000000000004'),1,'the submission stays saved');
update private.owner_email_notifications set created_at=now()-interval '11 minutes' where contact_submission_id='e1300000-0000-4000-8000-000000000004';
select is(pg_temp.view('e1300000-0000-4000-8000-000000000004'),'missed','after the window it reads missed');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000004'),jsonb_build_object('claimed',false,'state','missed'),'missed is never claimed automatically');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000004')$$,'55000',null,'resend from missed needs the attestation');
select is(pg_temp.resend('e1300000-0000-4000-8000-000000000004',true)->>'state','resend_requested','with it, resend is allowed');
select is((pg_temp.claim('e1300000-0000-4000-8000-000000000004','resend')->>'attempt')::int,1,'the recovered email is attempt 1');

-- 4. Derived and stored states --------------------------------------------------------
select pg_temp.contact('e1300000-0000-4000-8000-000000000005');
select is(pg_temp.view('e1300000-0000-4000-8000-000000000005'),'pending','a fresh row reads pending');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000005',true)$$,'55000',null,'pending inside the window cannot be resent');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-000000000005','reason',true)$$,'55000',null,'nor acknowledged');
update private.owner_email_notifications set created_at=now()-interval '9 minutes' where contact_submission_id='e1300000-0000-4000-8000-000000000005';
select is(pg_temp.view('e1300000-0000-4000-8000-000000000005'),'pending','still pending inside 10 minutes');
select ok((pg_temp.claim('e1300000-0000-4000-8000-000000000005')->>'claimed')::boolean,'an initial claim inside the window succeeds');

-- 5. Acknowledgement --------------------------------------------------------------------
select pg_temp.contact('e1300000-0000-4000-8000-000000000006');
delete from claims; insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-000000000006'));
select pg_temp.record('e1300000-0000-4000-8000-000000000006',(select body->>'claim_id' from claims where n=1),'failed','provider_not_configured');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-000000000006','   ')$$,'22023','Acknowledgement reason required','a reason is required');
select throws_ok(format($$select pg_temp.ack('e1300000-0000-4000-8000-000000000006',%L)$$,repeat('x',501)),'22023',null,'a reason is bounded');
select is(pg_temp.ack('e1300000-0000-4000-8000-000000000006','Read it in the admin and replied by phone')->>'state','acknowledged',
 'a failed email is acknowledged with a reason and no attestation');
select is(pg_temp.ack('e1300000-0000-4000-8000-000000000006','again')->>'state','acknowledged','acknowledgement is idempotent');
select is(row((pg_temp.ledger('e1300000-0000-4000-8000-000000000006')).acknowledged_reason,
  (pg_temp.ledger('e1300000-0000-4000-8000-000000000006')).acknowledged_by)::text,
 '("Read it in the admin and replied by phone",e1200000-0000-4000-8000-000000000001)','the first reason and actor are kept');
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-000000000006',true)$$,'55000',null,'an acknowledged email cannot be resent');
select is((select count(*)::int from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1300000-0000-4000-8000-000000000006' and e.state='acknowledged' and e.attestation is null),1,
 'one acknowledgement event, without an attestation for a definite failure');
-- Acknowledge from resend_requested.
select pg_temp.contact('e1300000-0000-4000-8000-000000000007');
delete from claims; insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-000000000007'));
select pg_temp.record('e1300000-0000-4000-8000-000000000007',(select body->>'claim_id' from claims where n=1),'failed','provider_rate_limited');
select pg_temp.resend('e1300000-0000-4000-8000-000000000007');
select is(pg_temp.ack('e1300000-0000-4000-8000-000000000007','The resend never proceeded; handled in the admin')->>'state','acknowledged',
 'a resend request that never proceeds can be acknowledged');
select is(pg_temp.claim('e1300000-0000-4000-8000-000000000007','resend')->>'claimed','false','and then nothing can claim it');

-- Untracked and unknown records ----------------------------------------------------------
alter table public.contact_submissions disable trigger owner_email_contact_create;
select pg_temp.contact('e1300000-0000-4000-8000-0000000000aa');
alter table public.contact_submissions enable trigger owner_email_contact_create;
select throws_ok($$select pg_temp.resend('e1300000-0000-4000-8000-0000000000aa',true)$$,'55000',
 'Not tracked; recovery for records saved before tracking is a separate proposal.','an untracked historical submission cannot be resent');
select throws_ok($$select pg_temp.ack('e1300000-0000-4000-8000-0000000000aa','reason',true)$$,'55000',null,'nor acknowledged');
select throws_ok($$select pg_temp.claim('e1300000-0000-4000-8000-0000000000aa')$$,'P0002',null,'nor claimed');
select throws_ok($$select pg_temp.op('select public.owner_email_contact_submission(''e1300000-0000-4000-8000-0000000000aa'')')$$,'P0002',null,'nor opened');
select is(pg_temp.view('e1300000-0000-4000-8000-0000000000aa'),null,'and it is not listed');
select is((select count(*)::int from private.owner_email_notifications where contact_submission_id='e1300000-0000-4000-8000-0000000000aa'),0,
 'refusals create no ledger row for history');
select throws_ok($$select pg_temp.resend('e13fffff-0000-4000-8000-0000000000aa',true)$$,'P0002',null,'an unknown ID is not found');

-- 6. Authorization -----------------------------------------------------------------------
select throws_ok(format($$select pg_temp.run(null,'anon',%L)$$,s),'42501',null,'anon cannot execute: '||s)
 from unnest(array['select public.owner_email_overview()',
  'select public.owner_email_request_resend(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',true)',
  'select public.owner_email_acknowledge(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',''x'',true)',
  'select public.owner_email_contact_submission(''e1300000-0000-4000-8000-000000000002'')',
  'select public.owner_email_claim(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',''initial'')',
  'select public.owner_email_record(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',gen_random_uuid(),''sent'',null,null)']) s;
select throws_ok(format($$select pg_temp.user(%s,%L)$$,u,s),'42501','Onboarding operator required','non-admin '||u||' is refused: '||s)
 from unnest(array[2,3]) u, unnest(array['select public.owner_email_overview()',
  'select public.owner_email_request_resend(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',true)',
  'select public.owner_email_acknowledge(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',''x'',true)',
  'select public.owner_email_contact_submission(''e1300000-0000-4000-8000-000000000002'')']) s;
select throws_ok(format($$select pg_temp.user(2,%L)$$,s),'42501',null,'a signed-in user cannot claim or record: '||s)
 from unnest(array['select public.owner_email_claim(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',''initial'')',
  'select public.owner_email_record(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',gen_random_uuid(),''sent'',null,null)']) s;
select throws_ok($$select pg_temp.op('select public.owner_email_claim(''contact_submission'',''e1300000-0000-4000-8000-000000000002'',''resend'')')$$,
 '42501',null,'an operator session cannot claim directly either');
select throws_ok(format($$select pg_temp.run(null,%L,'select to_jsonb(count(*)) from private.owner_email_notifications')$$,r),'42501',null,
 r||' cannot select the ledger') from unnest(array['authenticated','service_role']) r;
select throws_ok(format($$select pg_temp.run(null,%L,'select to_jsonb(count(*)) from private.owner_email_notification_events')$$,r),'42501',null,
 r||' cannot select the events') from unnest(array['authenticated','service_role']) r;
select is(pg_temp.user(2,'select to_jsonb(count(*)) from public.contact_submissions'),'0'::jsonb,'a homeowner still reads no contact submission (SQL 054 policy)');

-- DEC-2026-066: on-demand detail for an operator only.
select pg_temp.contact('e1300000-0000-4000-8000-0000000000d1','Detail subject');
select is(pg_temp.op($$select public.owner_email_contact_submission('e1300000-0000-4000-8000-0000000000d1')$$),
 (select jsonb_build_object('id',id,'submitted_at',created_at,'first_name',first_name,'last_name',last_name,'email',email,
   'phone',phone,'subject',subject,'message',message) from public.contact_submissions where id='e1300000-0000-4000-8000-0000000000d1'),
 'an operator gets exactly the stored contact fields of a tracked submission');
select throws_ok($$select pg_temp.op('select public.owner_email_contact_submission(''e13fffff-0000-4000-8000-0000000000d1'')')$$,'P0002',null,
 'an unknown ID gives no detail');

-- 7. No submitter content in the ledger or events --------------------------------------
select pg_temp.run(null,'service_role',$$with i as (insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
 values ('e1300000-0000-4000-8000-0000000000ee','SentinelFirst','SentinelLast','sentinel.sender@example.test','239-555-0177',
  'SentinelSubject','SentinelMessage body') returning 1) select to_jsonb(count(*)) from i$$);
delete from claims; insert into claims values (1, pg_temp.claim('e1300000-0000-4000-8000-0000000000ee'));
select pg_temp.record('e1300000-0000-4000-8000-0000000000ee',(select body->>'claim_id' from claims where n=1),'failed','provider_refused');
select ok(not exists (select 1 from private.owner_email_notifications n where row_to_json(n)::text ~ s)
      and not exists (select 1 from private.owner_email_notification_events e where row_to_json(e)::text ~ s),
 'no ledger or event column holds submitted content: '||s)
 from unnest(array['SentinelFirst','SentinelLast','sentinel\.sender','239-555-0177','SentinelSubject','SentinelMessage']) s;

-- 5b. Queue privacy and 5a. bounded pages with exact counts -----------------------------
select ok(pg_temp.page(true,null,null,100)::text !~ s,'no overview item carries submitted content: '||s)
 from unnest(array['SentinelFirst','SentinelLast','sentinel\.sender','239-555-0177','SentinelSubject','SentinelMessage','Detail subject','Synthetic message body']) s;
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.page(true,null,null,100)->'items') i, jsonb_object_keys(i) k
  where k in ('actor','requested_by','acknowledged_by','subject','first_name','last_name','email','phone','message','claim_id','provider_message_id')),
 'no overview item carries an actor ID, claim or contact field');
select is((select i->>'label' from jsonb_array_elements(pg_temp.page(true,null,null,100)->'items') i where i->>'source_id'='e1300000-0000-4000-8000-0000000000ee'),
 'Contact submission','a contact row shows the fixed label');
select is((select i->>'reference' from jsonb_array_elements(pg_temp.page(true,null,null,100)->'items') i where i->>'source_id'='e1300000-0000-4000-8000-0000000000ee'),
 'e1300000','and the first eight characters of the submission ID as its reference');

-- Isolate the paging fixtures: remove everything above (cascading to the ledger and events).
delete from public.contact_submissions where id::text like 'e13%' or email='returning@example.test';
select is((select count(*)::int from private.owner_email_notifications),
 (select count(*)::int from private.owner_email_notifications n join public.contact_submissions c on c.id=n.contact_submission_id),
 '7a. deleting submissions removed their ledger rows');
select is((select count(*)::int from private.owner_email_notification_events e
  where e.source_id::text like 'e13%'),0,'7a. and every event for them');
-- 130 attention rows (100 failed, 15 missed, 15 unknown) and 20 settled (10 sent, 10 acknowledged).
-- 40 attention rows share one timestamp (newest-first positions 31-70), so the 50-row page
-- boundary falls inside the tie and must be broken by id.
select pg_temp.contact(('e1400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) from generate_series(1,150) n;
update private.owner_email_notifications n set
  created_at = case when g.n between 41 and 80 then timestamptz '2026-11-01 00:00:00+00' + interval '100 minutes 30 seconds'
                    else timestamptz '2026-11-01 00:00:00+00' + g.n * interval '1 minute' end,
  state = case when g.n <= 100 then 'failed' when g.n <= 115 then 'pending' when g.n <= 130 then 'sending'
               when g.n <= 140 then 'sent' else 'acknowledged' end,
  last_error_code = case when g.n <= 100 then 'provider_refused' end,
  claim_id = case when g.n between 116 and 130 then gen_random_uuid() end,
  claimed_at = case when g.n between 116 and 130 then timestamptz '2026-11-01 00:00:00+00' end,
  sent_at = case when g.n between 131 and 140 then now() end,
  acknowledged_at = case when g.n > 140 then now() end,
  attempts = case when g.n <= 100 or g.n > 115 then 1 else 0 end
 from (select n, ('e1400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id from generate_series(1,150) n) g
 where n.contact_submission_id = g.id;
-- One in-window pending and one in-window sending row: neither needs attention.
select pg_temp.contact('e1400000-0000-4000-8000-000000000998');
select pg_temp.contact('e1400000-0000-4000-8000-000000000999');
select pg_temp.claim('e1400000-0000-4000-8000-000000000999');

create function pg_temp.walk(p_settled boolean, p_limit int) returns table(pages int, ids uuid[], counts jsonb[], sizes int[])
language plpgsql as $$
declare body jsonb; c_at text; c_id text;
begin
  pages := 0; ids := '{}'; counts := '{}'; sizes := '{}';
  loop
    body := pg_temp.page(p_settled, c_at, c_id, p_limit);
    pages := pages + 1;
    ids := ids || array(select (i->>'source_id')::uuid from jsonb_array_elements(body->'items') i);
    counts := counts || (body->'attention_count');
    sizes := sizes || jsonb_array_length(body->'items');
    exit when body->'next_cursor' = 'null'::jsonb or body->'next_cursor' is null or pages > 20;
    c_at := body->'next_cursor'->>'created_at'; c_id := body->'next_cursor'->>'id';
  end loop;
  return next;
end $$;

select is((select sizes from pg_temp.walk(false,null)),array[50,50,30],'attention pages are 50, 50 then 30');
select is((select pages from pg_temp.walk(false,null)),3,'the last attention page has no cursor');
select is((select count(distinct x)::int from pg_temp.walk(false,null), unnest(ids) x),130,'no attention row is repeated or skipped across pages');
select ok((select bool_and(c = jsonb_build_object('total',130,'contact_submission',130,'renewal_document',0)) from pg_temp.walk(false,null), unnest(counts) c),
 'the exact attention count is 130 on every page');
select is((select array(select x from pg_temp.walk(false,null), unnest(ids) with ordinality u(x,o) order by o)),
 (select array_agg(n.contact_submission_id order by n.created_at desc, n.id desc) from private.owner_email_notifications n
   where n.contact_submission_id::text like 'e1400000-%' and private.owner_email_state(n.state,n.created_at,n.claimed_at) in ('failed','missed','unknown')),
 'pages follow created_at desc, id desc, including 40 equal timestamps');
select ok(not ((select ids from pg_temp.walk(false,null))
  && array['e1400000-0000-4000-8000-000000000998','e1400000-0000-4000-8000-000000000999']::uuid[]),
 'in-window pending and sending rows are not attention');
select is((select count(distinct x)::int from pg_temp.walk(true,null), unnest(ids) x),152,'with settled rows included, paging covers all 152');
select is((select sizes from pg_temp.walk(true,100)),array[100,52],'a 100-row page is allowed');
select is(jsonb_array_length(pg_temp.page(true,null,null,1000)->'items'),100,'a page above 100 is clamped to 100');
select is((pg_temp.page(true,null,null,1000)->>'limit')::int,100,'and reports its limit');
select is(jsonb_array_length(pg_temp.page(true,null,null,0)->'items'),1,'a page below 1 is clamped to 1');
select is(jsonb_array_length(pg_temp.page(true,null,null,-5)->'items'),1,'a negative page size is clamped to 1');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page(false,null,null,100)->'items') i where i->>'state'='missed'),
 15,'derived missed rows are listed as attention');
select is((select count(*)::int from pg_temp.walk(false,null), unnest(ids) x
  where x in (select contact_submission_id from private.owner_email_notifications where state='sending' and claimed_at < now()-interval '10 minutes')),
 15,'derived unknown rows are listed as attention');
select ok((select bool_and((i->>'needs_attention')::boolean) from jsonb_array_elements(pg_temp.page(false,null,null,100)->'items') i),
 'every attention-only item needs attention');
select throws_ok($$select pg_temp.op('select public.owner_email_overview(null,false,now(),null,50)')$$,'22023',null,'a half cursor is refused');
select throws_ok($$select pg_temp.op('select public.owner_email_overview(''newsletter'')')$$,'22023',null,'an unknown kind filter is refused');
select is(jsonb_array_length(pg_temp.op($$select public.owner_email_overview('renewal_document',true)$$)->'items'),0,
 'the renewal filter lists no contact row (no renewal row exists yet)');
select is(pg_temp.page()->>'stale_after_minutes','10','the overview reports the 10-minute window');
-- The partial index serves the attention scan.
select ok(exists (select 1 from pg_indexes where schemaname='private' and indexname='owner_email_notifications_open'),'the open-row index exists');

-- 26. Old application on the new schema (R-4) -----------------------------------------
-- The old route inserts without RETURNING, never claims, and may email outside the ledger.
select pg_temp.contact('e1500000-0000-4000-8000-000000000001');
select is(row((pg_temp.ledger('e1500000-0000-4000-8000-000000000001')).state,(pg_temp.ledger('e1500000-0000-4000-8000-000000000001')).attempts)::text,
 '(pending,0)','26.1 the old insert succeeds and creates one pending row');
update private.owner_email_notifications set created_at=now()-interval '30 minutes' where contact_submission_id='e1500000-0000-4000-8000-000000000001';
select is(pg_temp.claim('e1500000-0000-4000-8000-000000000001'),jsonb_build_object('claimed',false,'state','missed'),
 '26.2 a forced initial claim after the window does not claim it');
select throws_ok($$select pg_temp.resend('e1500000-0000-4000-8000-000000000001')$$,'55000',null,'26.3 resend refuses without the attestation');
select throws_ok($$select pg_temp.ack('e1500000-0000-4000-8000-000000000001','Sent by the previous release during rollout; found in the inbox')$$,
 '55000',null,'26.3 acknowledge refuses without the attestation');
select is(pg_temp.ack('e1500000-0000-4000-8000-000000000001','Sent by the previous release during rollout; found in the inbox',true)->>'state',
 'acknowledged','26.5 with the inbox-check attestation and a reason (email found), it is acknowledged');
select is((select row(e.previous_state,e.attestation,e.reason)::text from private.owner_email_notification_events e
  join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1500000-0000-4000-8000-000000000001' and e.state='acknowledged'),
 '(missed,inbox_evidence_reviewed,"Sent by the previous release during rollout; found in the inbox")',
 '26.5 the event records the inbox-evidence attestation and what was found');
select is((select count(*)::int from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.contact_submission_id='e1500000-0000-4000-8000-000000000001' and e.state='sending'),0,'26 the old-release row was never claimed or sent');

-- 9. Renewal documents (7.2C-2) -------------------------------------------------------------
-- Provider A (vendor 3) and provider B (vendor 4), both active. Synthetic storage objects carry
-- metadata only. The file name is a sentinel: it must never reach the ledger, events or overview.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('e1200000-0000-4000-8000-000000000004','owner-email-vendor-b@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('e1200000-0000-4000-8000-000000000004','vendor') on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('e1700000-0000-4000-8000-000000000001','Synthetic Renewal Provider A',true,false,'e1200000-0000-4000-8000-000000000003'),
 ('e1700000-0000-4000-8000-000000000002','Synthetic Renewal Provider B',true,false,'e1200000-0000-4000-8000-000000000004');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('e1710000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic renewal provider '||n,'Test','Renewal',
   'renewal-provider-'||n||'@example.test','synthetic',('e1700000-0000-4000-8000-00000000000'||n)::uuid,'{}' from generate_series(1,2) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('e1700000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('e1710000-0000-4000-8000-00000000000'||n)::uuid),1,'active'
 from generate_series(1,2) n;

create function pg_temp.rpath(p_c int, p_kind text, p_n int) returns text language sql as $$
 select 'renewals/e1700000-0000-4000-8000-00000000000'||p_c||'/'||p_kind||'/e1730000-0000-4000-8000-'||lpad(p_n::text,12,'0')||'-SentinelRenewalFile.pdf' $$;
create function pg_temp.robject(p_path text) returns void language sql as $$
 insert into storage.objects(bucket_id,name,metadata) values('vendor-documents',p_path,jsonb_build_object('size',2048,'mimetype','application/pdf')) $$;
create function pg_temp.submit(p_user int, p_path text) returns jsonb language sql as $$
 select pg_temp.user(p_user, format('select public.vendor_submit_renewal_document(%L)',p_path)) $$;
create function pg_temp.rledger(p_doc uuid) returns private.owner_email_notifications language sql as $$
 select * from private.owner_email_notifications where renewal_document_id=p_doc $$;
create function pg_temp.revents(p_doc uuid) returns text language sql as $$
 select string_agg(coalesce(e.previous_state,'∅')||'>'||e.state||'@'||e.attempt, ' ' order by e.id) from private.owner_email_notification_events e
  join private.owner_email_notifications n on n.id=e.notification_id where n.renewal_document_id=p_doc $$;
create function pg_temp.rclaim(p_doc uuid, p_mode text default 'initial') returns jsonb language sql as $$
 select pg_temp.svc(format('select public.owner_email_claim(''renewal_document'',%L,%L)',p_doc,p_mode)) $$;
create function pg_temp.rrecord(p_doc uuid, p_claim text, p_outcome text, p_code text default null) returns jsonb language sql as $$
 select pg_temp.svc(format('select public.owner_email_record(''renewal_document'',%L,%L,%L,%L,%L)',
  p_doc,p_claim,p_outcome,case when p_outcome='sent' then 'msg_synthetic' end,p_code)) $$;
create function pg_temp.rresend(p_doc uuid, p_confirm boolean default false) returns jsonb language sql as $$
 select pg_temp.op(format('select public.owner_email_request_resend(''renewal_document'',%L,%L)',p_doc,p_confirm)) $$;
create function pg_temp.rack(p_doc uuid, p_reason text, p_checked boolean default false) returns jsonb language sql as $$
 select pg_temp.op(format('select public.owner_email_acknowledge(''renewal_document'',%L,%L,%L)',p_doc,p_reason,p_checked)) $$;
create function pg_temp.rview(p_doc uuid) returns text language sql as $$
 select n->>'state' from jsonb_array_elements(pg_temp.op($q$select public.owner_email_overview('renewal_document',true,null,null,100)$q$)->'items') n
  where (n->>'source_id')::uuid=p_doc $$;
create temp table docs(n int primary key, body jsonb);
grant all on docs to service_role, authenticated;
create function pg_temp.doc(p_n int) returns uuid language sql as $$ select (body->>'document_id')::uuid from docs where n=p_n $$;

select pg_temp.robject(pg_temp.rpath(1,'license',n)) from generate_series(1,5) n;
select pg_temp.robject(pg_temp.rpath(1,'insurance',n)) from generate_series(10,14) n;
select pg_temp.robject(pg_temp.rpath(2,'license',20));

-- 9.1 Provider submission through the real RPC: one pending row and one event, atomically.
insert into docs values (1, pg_temp.submit(3, pg_temp.rpath(1,'license',1)));
select is((select body->>'submitted_as'||':'||(body->>'recorded') from docs where n=1),'provider:true','9.1 the provider submission is recorded');
select is(row((pg_temp.rledger(pg_temp.doc(1))).state,(pg_temp.rledger(pg_temp.doc(1))).attempts,(pg_temp.rledger(pg_temp.doc(1))).source_kind)::text,
 '(pending,0,renewal_document)','9.1 a provider renewal submission gets exactly one pending ledger row');
select is(pg_temp.revents(pg_temp.doc(1)),'∅>pending@0','9.1 and one creation event');
select is((pg_temp.rledger(pg_temp.doc(1))).created_at,(select created_at from public.vendor_renewal_documents where id=pg_temp.doc(1)),
 '9.1 the ledger row is created in the submission transaction');

-- 9.2 A replay of the same path inserts nothing, so it creates nothing.
insert into docs values (2, pg_temp.submit(3, pg_temp.rpath(1,'license',1)));
select is((select body->>'recorded' from docs where n=2),'false','9.2 the replay is not recorded again');
select is(pg_temp.doc(2),pg_temp.doc(1),'9.2 and returns the same document');
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id=pg_temp.doc(1)),1,'9.2 no duplicate ledger row on replay');
select is(pg_temp.revents(pg_temp.doc(1)),'∅>pending@0','9.2 and no second creation event');

-- 9.3 An operator upload on the provider's behalf notifies nobody (owner decision 2026-09-15).
insert into docs values (3, pg_temp.op(format('select public.vendor_submit_renewal_document(%L,%L)',pg_temp.rpath(1,'insurance',10),'e1700000-0000-4000-8000-000000000001')));
select is((select body->>'submitted_as'||':'||(body->>'recorded') from docs where n=3),'operator:true','9.3 the operator upload is recorded');
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id=pg_temp.doc(3)),0,'9.3 an operator upload creates no ledger row');
select throws_ok(format($$select pg_temp.rclaim(%L)$$,pg_temp.doc(3)),'P0002',null,'9.3 so it can never be claimed');
select throws_ok(format($$select pg_temp.rresend(%L,true)$$,pg_temp.doc(3)),'55000',
 'Not tracked; recovery for records saved before tracking is a separate proposal.','9.3 nor resent');

-- 9.4 A forced ledger failure fails the whole RPC: the document is rolled back with it.
alter table private.owner_email_notifications add constraint test_force_failure check (false) not valid;
select throws_ok(format($$select pg_temp.submit(3,%L)$$,pg_temp.rpath(1,'license',2)),'23514',null,'9.4 a ledger failure fails the submission RPC');
alter table private.owner_email_notifications drop constraint test_force_failure;
select is((select count(*)::int from public.vendor_renewal_documents where storage_path=pg_temp.rpath(1,'license',2)),0,
 '9.4 the document is rolled back with its ledger row');

-- 9.5 The claim returns the saved document and the current business name; nothing else.
delete from claims; insert into claims values (1, pg_temp.rclaim(pg_temp.doc(1)));
select is((select body->'source' from claims where n=1),
 (select jsonb_build_object('id',d.id,'created_at',d.created_at,'kind',d.kind,'business_name','Synthetic Renewal Provider A')
   from public.vendor_renewal_documents d where d.id=pg_temp.doc(1)),'9.5 the claim returns the saved document and the current business name');
select is((select array_agg(k order by k) from claims, jsonb_object_keys(body->'source') k where n=1),array['business_name','created_at','id','kind'],
 '9.5 the payload carries no file name, path, size or submitter');
select is((select body->>'kind' from claims where n=1),'renewal_document','9.5 the claim names its kind');
select is((select (body->>'attempt')::int from claims where n=1),1,'9.5 attempt 1');
select is(pg_temp.rclaim(pg_temp.doc(1)),jsonb_build_object('claimed',false,'state','sending'),'9.5 a second initial claim sends nothing');
select is(pg_temp.rrecord(pg_temp.doc(1),(select body->>'claim_id' from claims where n=1),'sent')->>'state','sent','9.5 the outcome is recorded');
-- A rename after the first email shows on a later resend (C-6): the name is read at claim time.
update public.contractors set name='Synthetic Renewal Provider A Renamed' where id='e1700000-0000-4000-8000-000000000001';
select is((select i->>'label' from jsonb_array_elements(pg_temp.op($$select public.owner_email_overview('renewal_document',true,null,null,100)$$)->'items') i
  where (i->>'source_id')::uuid=pg_temp.doc(1)),'Synthetic Renewal Provider A Renamed — License','9.5 the queue label is the current business name and item');
update public.contractors set name='Synthetic Renewal Provider A' where id='e1700000-0000-4000-8000-000000000001';
select is(pg_temp.revents(pg_temp.doc(1)),'∅>pending@0 pending>sending@1 sending>sent@1','9.5 every transition is audited once');

-- 9.6 A confirmed claim exception (not a missing name) sends nothing and leaves pending.
insert into docs values (4, pg_temp.submit(3, pg_temp.rpath(1,'license',3)));
create trigger test_claim_fault before update on private.owner_email_notifications for each row execute function pg_temp.fault();
select throws_ok(format($$select pg_temp.rclaim(%L)$$,pg_temp.doc(4)),'55P03',null,'9.6 a fault inside the renewal claim raises');
drop trigger test_claim_fault on private.owner_email_notifications;
select is(row((pg_temp.rledger(pg_temp.doc(4))).state,(pg_temp.rledger(pg_temp.doc(4))).attempts,(pg_temp.rledger(pg_temp.doc(4))).claim_id is null)::text,
 '(pending,0,t)','9.6 the raised claim left no partial claim');
select is(pg_temp.revents(pg_temp.doc(4)),'∅>pending@0','9.6 and no claim event');
select is((select count(*)::int from public.vendor_renewal_documents where id=pg_temp.doc(4)),1,'9.6 the document stays saved');
update private.owner_email_notifications set created_at=now()-interval '11 minutes' where renewal_document_id=pg_temp.doc(4);
select is(pg_temp.rview(pg_temp.doc(4)),'missed','9.6 after the window it reads missed');
select is(pg_temp.rclaim(pg_temp.doc(4)),jsonb_build_object('claimed',false,'state','missed'),'9.6 missed is never claimed automatically');
select throws_ok(format($$select pg_temp.rresend(%L)$$,pg_temp.doc(4)),'55000',null,'9.6 resend from missed needs the no-email attestation');
select is(pg_temp.rresend(pg_temp.doc(4),true)->>'state','resend_requested','9.6 with it, resend is allowed');
select is((pg_temp.rclaim(pg_temp.doc(4),'resend')->>'attempt')::int,1,'9.6 the recovered email is attempt 1');
select is((select attestation from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.renewal_document_id=pg_temp.doc(4) and e.state='resend_requested'),'no_matching_email_found','9.6 the resend records its attestation');

-- 9.7 A committed claim whose response is lost: stays sending, then unknown; attested acknowledgement.
insert into docs values (5, pg_temp.submit(3, pg_temp.rpath(1,'license',4)));
select pg_temp.rclaim(pg_temp.doc(5));  -- result discarded: the response was lost
select is(row((pg_temp.rledger(pg_temp.doc(5))).state,(pg_temp.rledger(pg_temp.doc(5))).attempts)::text,'(sending,1)','9.7 the lost claim stays sending');
select is(pg_temp.rclaim(pg_temp.doc(5)),jsonb_build_object('claimed',false,'state','sending'),'9.7 no automatic second claim');
select throws_ok(format($$select pg_temp.rresend(%L,true)$$,pg_temp.doc(5)),'55000','This owner email cannot be resent from sending','9.7 no resend inside the window');
update private.owner_email_notifications set claimed_at=now()-interval '11 minutes' where renewal_document_id=pg_temp.doc(5);
select is(pg_temp.rview(pg_temp.doc(5)),'unknown','9.7 past the window it reads unknown');
select is(pg_temp.rclaim(pg_temp.doc(5)),jsonb_build_object('claimed',false,'state','unknown'),'9.7 unknown is never claimed automatically');
select throws_ok(format($$select pg_temp.rack(%L,'Checked')$$,pg_temp.doc(5)),'55000',
 'Check the owner inbox and the Resend log before acknowledging an uncertain email','9.7 acknowledge from unknown needs the inbox-check attestation');
select is(pg_temp.rack(pg_temp.doc(5),'Found the renewal email in the owner inbox',true)->>'state','acknowledged','9.7 with it, acknowledged (email found)');
select is((select row(e.previous_state,e.attestation)::text from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
  where n.renewal_document_id=pg_temp.doc(5) and e.state='acknowledged'),'(unknown,inbox_evidence_reviewed)','9.7 the event records the inbox-evidence attestation');

-- 9.8 A stale worker cannot overwrite after an operator request clears its claim.
insert into docs values (6, pg_temp.submit(3, pg_temp.rpath(1,'insurance',11)));
delete from claims; insert into claims values (1, pg_temp.rclaim(pg_temp.doc(6)));
select is(pg_temp.rrecord(pg_temp.doc(6),(select body->>'claim_id' from claims where n=1),'unknown','provider_timeout_or_network')->>'state','unknown',
 '9.8 a timeout is recorded as unknown');
select is(pg_temp.rresend(pg_temp.doc(6),true)->>'state','resend_requested','9.8 an attested resend is allowed');
select throws_ok(format($$select pg_temp.rrecord(%L,%L,'sent')$$,pg_temp.doc(6),(select body->>'claim_id' from claims where n=1)),
 '40001',null,'9.8 the earlier claim cannot record after the resend request');
insert into claims values (2, pg_temp.rclaim(pg_temp.doc(6),'resend'));
select is((select (body->>'attempt')::int from claims where n=2),2,'9.8 the resend is attempt 2 with a new claim');
select isnt((select body->>'claim_id' from claims where n=2),(select body->>'claim_id' from claims where n=1),'9.8 and a fresh claim UUID');
select is(pg_temp.rrecord(pg_temp.doc(6),(select body->>'claim_id' from claims where n=2),'failed','provider_refused')->>'state','failed','9.8 its outcome is recorded');
select is(pg_temp.rack(pg_temp.doc(6),'Reviewed in Compliance Expiry')->>'state','acknowledged','9.8 a failed renewal email is acknowledged with a reason only');

-- 9.9 Old renewal route on the new schema (R-4, test 26 repeated for renewal): the old release
-- calls the same RPC and emails outside the ledger without claiming.
insert into docs values (7, pg_temp.submit(3, pg_temp.rpath(1,'insurance',12)));
select is(row((pg_temp.rledger(pg_temp.doc(7))).state,(pg_temp.rledger(pg_temp.doc(7))).attempts)::text,'(pending,0)','9.9.1 the old route creates one pending row');
update private.owner_email_notifications set created_at=now()-interval '30 minutes' where renewal_document_id=pg_temp.doc(7);
select is(pg_temp.rclaim(pg_temp.doc(7)),jsonb_build_object('claimed',false,'state','missed'),'9.9.2 a forced initial claim after the window does not claim it');
select throws_ok(format($$select pg_temp.rresend(%L)$$,pg_temp.doc(7)),'55000',null,'9.9.3 resend refuses without the attestation');
select throws_ok(format($$select pg_temp.rack(%L,'Sent by the previous release; found in the inbox')$$,pg_temp.doc(7)),'55000',null,
 '9.9.3 acknowledge refuses without the attestation');
select is(pg_temp.rack(pg_temp.doc(7),'Sent by the previous release; found in the inbox',true)->>'state','acknowledged','9.9.5 attested acknowledgement');
select is(pg_temp.revents(pg_temp.doc(7)),'∅>pending@0 missed>acknowledged@0','9.9 never claimed or sent by the new release');

-- 9.10 Untracked: a provider document saved without the trigger (history) is not sendable.
alter table public.vendor_renewal_documents disable trigger owner_email_renewal_create;
insert into docs values (8, pg_temp.submit(3, pg_temp.rpath(1,'insurance',13)));
alter table public.vendor_renewal_documents enable trigger owner_email_renewal_create;
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id=pg_temp.doc(8)),0,'9.10 an untracked document has no row');
select throws_ok(format($$select pg_temp.rresend(%L,true)$$,pg_temp.doc(8)),'55000',
 'Not tracked; recovery for records saved before tracking is a separate proposal.','9.10 an untracked document cannot be resent');
select throws_ok(format($$select pg_temp.rack(%L,'reason',true)$$,pg_temp.doc(8)),'55000',null,'9.10 nor acknowledged');
select throws_ok(format($$select pg_temp.rclaim(%L)$$,pg_temp.doc(8)),'P0002',null,'9.10 nor claimed');
select is(pg_temp.rview(pg_temp.doc(8)),null,'9.10 nor listed');

-- 9.11 Cross-account, service-only and operator boundaries.
select throws_ok(format($$select pg_temp.submit(4,%L)$$,pg_temp.rpath(1,'license',5)),'P0001','Document path does not belong to this provider',
 '9.11 provider B cannot submit provider A''s path');
select is((select count(*)::int from public.vendor_renewal_documents where storage_path=pg_temp.rpath(1,'license',5)),0,'9.11 and nothing was saved');
insert into docs values (9, pg_temp.submit(4, pg_temp.rpath(2,'license',20)));
select is((pg_temp.rledger(pg_temp.doc(9))).state,'pending','9.11 provider B''s own submission is tracked');
select throws_ok(format($$select pg_temp.user(%s,%L)$$,u,format(s,pg_temp.doc(1))),'42501','Onboarding operator required',
  '9.11 vendor '||u||' cannot use operator commands on renewal rows: '||left(s,48))
 from unnest(array[3,4]) u, unnest(array['select public.owner_email_overview(''renewal_document'')',
  'select public.owner_email_request_resend(''renewal_document'',%L,true)',
  'select public.owner_email_acknowledge(''renewal_document'',%L,''x'',true)']) s;
select throws_ok(format($$select pg_temp.user(%s,%L)$$,u,format(s,pg_temp.doc(9))),'42501',null,
  '9.11 vendor '||u||' cannot claim or record a renewal row: '||left(s,40))
 from unnest(array[3,4]) u, unnest(array['select public.owner_email_claim(''renewal_document'',%L,''initial'')',
  'select public.owner_email_record(''renewal_document'',%L,gen_random_uuid(),''sent'',null,null)']) s;
select throws_ok(format($$select pg_temp.run(null,'anon',%L)$$,format('select public.owner_email_claim(''renewal_document'',%L,''initial'')',pg_temp.doc(9))),
 '42501',null,'9.11 anon cannot claim a renewal row');
select throws_ok(format($$select pg_temp.op(%L)$$,format('select public.owner_email_claim(''renewal_document'',%L,''initial'')',pg_temp.doc(9))),
 '42501',null,'9.11 an operator session cannot claim directly');
select is((pg_temp.rledger(pg_temp.doc(9))).state,'pending','9.11 refused callers changed nothing');
select throws_ok(format($$select pg_temp.op(%L)$$,format('select public.owner_email_contact_submission(%L)',pg_temp.doc(9))),'P0002',null,
 '9.11 contact detail never opens a renewal record');
select throws_ok(format($$select pg_temp.svc(%L)$$,format('select public.owner_email_claim(''contact_submission'',%L,''initial'')',pg_temp.doc(9))),'P0002',null,
 '9.11 a renewal ID is never claimed as a contact submission');

-- 9.12 Source privacy: no file name, path, MIME type or submitter in the ledger, events or overview.
select ok(not exists (select 1 from private.owner_email_notifications n where n.renewal_document_id is not null and row_to_json(n)::text ~ s)
      and not exists (select 1 from private.owner_email_notification_events e where e.source_kind='renewal_document' and row_to_json(e)::text ~ s)
      and pg_temp.op($$select public.owner_email_overview('renewal_document',true,null,null,100)$$)::text !~ s,
 '9.12 no renewal ledger row, event or overview item holds document detail: '||s)
 from unnest(array['SentinelRenewalFile','renewals/','application/pdf','e1200000-0000-4000-8000-000000000003']) s;
select ok(not exists (select 1 from jsonb_array_elements(pg_temp.op($$select public.owner_email_overview('renewal_document',true,null,null,100)$$)->'items') i,
  jsonb_object_keys(i) k where k in ('actor','requested_by','acknowledged_by','submitted_by','storage_path','file_name','claim_id','provider_message_id')),
 '9.12 no renewal overview item carries an actor, path, claim or provider ID');
select is((select count(*)::int from jsonb_array_elements(pg_temp.op($$select public.owner_email_overview('renewal_document',true,null,null,100)$$)->'items') i
  where i->>'kind'<>'renewal_document'),0,'9.12 the renewal filter lists renewal rows only');

-- 9.13 Exact attention counts per kind include renewal rows.
-- Provider B's untouched pending row passes the window and needs attention as missed.
update private.owner_email_notifications set created_at=now()-interval '11 minutes' where renewal_document_id=pg_temp.doc(9);
select is(pg_temp.rview(pg_temp.doc(9)),'missed','9.13 an unclaimed renewal row reads missed after the window');
select is(pg_temp.op($$select public.owner_email_overview('renewal_document')$$)->'attention_count'->'renewal_document',
 to_jsonb((select count(*)::int from private.owner_email_notifications n where n.source_kind='renewal_document'
   and private.owner_email_state(n.state,n.created_at,n.claimed_at) in ('failed','missed','unknown','resend_requested'))),
 '9.13 the renewal attention count is exact');
select ok((pg_temp.op($$select public.owner_email_overview()$$)->'attention_count'->>'renewal_document')::int > 0,'9.13 and non-zero here');
select is((select (c->>'total')::int - (c->>'contact_submission')::int - (c->>'renewal_document')::int
  from (select pg_temp.op($$select public.owner_email_overview()$$)->'attention_count' c) x),0,'9.13 the total is the sum of both kinds');

-- 9.14 The renewal ledger row stays with its immutable document.
select throws_ok(format($$delete from public.vendor_renewal_documents where id=%L$$,pg_temp.doc(1)),null,null,'9.14 a renewal document cannot be deleted');
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id=pg_temp.doc(1)),1,'9.14 so its ledger row is kept');

-- Missing (blank) business name. contractors.name is NOT NULL, so a "missing" name in the
-- database is a blank one; the claim returns it as stored and the email builder (unit tests)
-- and the queue label fall back to "A provider". A null name is covered in the unit tests.
select ok((select attnotnull from pg_attribute where attrelid='public.contractors'::regclass and attname='name'),'contractors.name is NOT NULL');
insert into public.contractors(id,name,is_active,marketing_enabled) values
 ('e1600000-0000-4000-8000-000000000001','   ',true,false),('e1600000-0000-4000-8000-000000000002','Synthetic Renewal Co',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 select ('e1610000-0000-4000-8000-00000000000'||n)::uuid,'Synthetic renewal '||n,'Test','Renewal','renewal-'||n||'@example.test','synthetic',
   ('e1600000-0000-4000-8000-00000000000'||n)::uuid,'{}' from generate_series(1,2) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select ('e1600000-0000-4000-8000-00000000000'||n)::uuid,
   (select id from public.vendor_application_versions where application_id=('e1610000-0000-4000-8000-00000000000'||n)::uuid),1,'active'
 from generate_series(1,2) n;
-- Direct inserts (no RPC): the trigger is on the table, so a provider row is still tracked and an operator row is not.
insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as)
 select ('e1620000-0000-4000-8000-00000000000'||n)::uuid,('e1600000-0000-4000-8000-00000000000'||least(n,2))::uuid,'license',
   'renewals/e1600000-0000-4000-8000-00000000000'||least(n,2)||'/license/e1630000-0000-4000-8000-00000000000'||n||'-synthetic.pdf',
   'synthetic.pdf','application/pdf',100,
   case when n=3 then 'e1200000-0000-4000-8000-000000000001' else 'e1200000-0000-4000-8000-000000000003' end::uuid,
   case when n=3 then 'operator' else 'provider' end from generate_series(1,3) n;
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id in
  ('e1620000-0000-4000-8000-000000000001','e1620000-0000-4000-8000-000000000002') and state='pending' and attempts=0),2,
 'the trigger tracks every provider insert, however it is made');
select is((select count(*)::int from private.owner_email_notifications where renewal_document_id='e1620000-0000-4000-8000-000000000003'),0,
 'and no operator insert');
select is(pg_temp.svc($$select public.owner_email_claim('renewal_document','e1620000-0000-4000-8000-000000000001','initial')$$)->'source'->>'business_name',
 '   ','a blank business name is returned as stored: a missing name, not a failure');
select is(pg_temp.svc($$select public.owner_email_claim('renewal_document','e1620000-0000-4000-8000-000000000002','initial')$$)->'source'->>'business_name',
 'Synthetic Renewal Co','the claim reads the current business name');
select is((select array_agg(i->>'label' order by i->>'label') from jsonb_array_elements(pg_temp.op($$select public.owner_email_overview('renewal_document',true,null,null,100)$$)->'items') i
  where i->>'source_id' like 'e1620000-%'),
 array['A provider — License','Synthetic Renewal Co — License'],'renewal label: business name and item, "A provider" for a blank name');

-- 8. Unchanged surfaces -------------------------------------------------------------------
-- The fingerprint list is maintained in scripts/promotion-money-fingerprint.sql; it is run
-- against this database before and after the migration (implementation record §5).
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'r0\_%notification%'),
 '10|5f14532aa26ed5400e73e210379aa4f8','the vendor-application ledger functions are byte-identical');
select is(md5(pg_get_functiondef('public.vendor_submit_renewal_document(text,uuid)'::regprocedure)),'8c8942365d8f9d34bdcd1d839f86c472',
 'vendor_submit_renewal_document is unchanged');
-- 7.2C-2 adds only its trigger function; the twelve 7.2C-1 ledger functions are not restated.
select is((select count(*)::text||'|'||md5(string_agg(pg_get_functiondef(p.oid), E'\n' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'owner\_email\_%' and p.proname <> 'owner_email_renewal_create'),
 '12|016c0e683cb19c4c68769d87f5215ff1','the 7.2C-1 owner-email ledger functions are byte-identical');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'owner\_email\_%'),13,'7.2C-2 adds exactly one owner-email function');
select is((select md5(string_agg(format('%s %s %s', c.relname, a.attname, format_type(a.atttypid,a.atttypmod)), ',' order by c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('r0_application_notifications','r0_application_notification_events') and a.attnum>0 and not a.attisdropped),
 '241b6ca8277ab6f737b6011dd148edf6','the vendor-application ledger tables are unchanged');
select is((select md5(string_agg(tgname||':'||pg_get_triggerdef(t.oid), ',' order by tgname)) from pg_trigger t
  where tgrelid='public.vendor_applications'::regclass and not tgisinternal),'f8eb0f6047112b3e68bd794997d4447f',
 'the vendor-application triggers are unchanged');
select is((select relacl::text from pg_class where oid='public.contact_submissions'::regclass),
 '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=rwd/postgres}','contact_submissions grants are unchanged');

select * from finish();
rollback;
