-- TRACE-146 (20261114001000), DEC-2026-061: the onboarding decision is the provider's platform
-- activation. Activate sets contractors.is_active, suspend clears it; reject, renew, refusals and
-- replays leave it alone; marketing_enabled is never touched; direct client writes stay refused.
-- Decisions run as the signed-in operator (the deployed client path). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('e1460000-0000-4000-8000-000000000001','active-sync-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values ('e1460000-0000-4000-8000-000000000001','admin');
-- 1: listed once active (marketing on). 2: incomplete checklist. 3: rejected. 4: marketing off.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('e1461000-0000-4000-8000-000000000001','Synthetic sync provider',false,true,null),
 ('e1461000-0000-4000-8000-000000000002','Synthetic incomplete sync provider',false,true,null),
 ('e1461000-0000-4000-8000-000000000003','Synthetic rejected sync provider',false,true,null),
 ('e1461000-0000-4000-8000-000000000004','Synthetic unmarketed sync provider',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 select ('e1462000-0000-4000-8000-00000000000'||n)::uuid, 'Synthetic sync provider '||n, 'Test', 'Sync'||n,
   'active-sync-'||n||'@example.invalid', 'synthetic', ('e1461000-0000-4000-8000-00000000000'||n)::uuid
 from generate_series(1,4) n;

create function pg_temp.c(n integer) returns uuid language sql as $$ select ('e1461000-0000-4000-8000-00000000000'||n)::uuid $$;
create function pg_temp.rev(n integer) returns integer language sql as $$
 select revision from public.vendor_onboarding where contractor_id=pg_temp.c(n) $$;
create function pg_temp.active(n integer) returns boolean language sql as $$
 select is_active from public.contractors where id=pg_temp.c(n) $$;
-- The provider-side half of r0_provider_listable; the other half (published content,
-- r0_provider_has_content) is covered by the listing tests and not created here.
create function pg_temp.listable(n integer) returns boolean language sql as $$
 select exists(select 1 from public.contractors c where c.id=pg_temp.c(n) and c.is_active is true and c.marketing_enabled is not false)
   and private.vendor_matching_eligible(pg_temp.c(n)) $$;
create function pg_temp.checklist(p_contractor uuid) returns void language plpgsql as $$
declare requirement text; previous uuid;
begin
 foreach requirement in array array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification'] loop
   select e.id into previous from public.vendor_compliance_evidence e where e.contractor_id=p_contractor and e.kind=requirement
     and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id);
   perform public.vendor_record_evidence(p_contractor,requirement,'synthetic-rule','private-synthetic-'||requirement||'-'||gen_random_uuid(),
     now()-interval '1 hour',now()+interval '1 year',previous);
 end loop;
end $$;
-- Runs one decision as the signed-in operator; returns the new revision or the SQLSTATE.
create function pg_temp.decide(n integer, p_action text, p_key text) returns text language plpgsql as $$
declare r integer; expected integer := pg_temp.rev(n); target uuid := pg_temp.c(n);
begin
  set local role authenticated;
  r := public.vendor_decide_onboarding(target, expected, p_action, 'Synthetic '||p_action, p_key);
  reset role;
  return r::text;
exception when others then
  reset role;
  return sqlstate;
end $$;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"e1460000-0000-4000-8000-000000000001"}',true);
do $$ declare n integer; begin
 for n in 1..4 loop
   perform public.vendor_begin_review(pg_temp.c(n),
     (select id from public.vendor_application_versions where application_id=('e1462000-0000-4000-8000-00000000000'||n)::uuid order by revision desc limit 1));
 end loop;
end $$;
select pg_temp.checklist(pg_temp.c(1));
select pg_temp.checklist(pg_temp.c(4));

-- ── Activate ────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.active(1), false, 'a provider in review is inactive');
select ok(not pg_temp.listable(1), 'and does not meet the listing''s provider rule');
select is(pg_temp.decide(1,'activate','sync-activate-1'), '2', 'the operator activates through the onboarding decision');
select is(pg_temp.active(1), true, 'activation sets is_active');
select ok(pg_temp.listable(1), 'an activated, marketing-enabled provider meets the listing''s provider rule');
select ok(private.vendor_matching_eligible(pg_temp.c(1)), 'and matching-eligible');
select is((select marketing_enabled from public.contractors where id=pg_temp.c(1)), true, 'activation leaves marketing_enabled as it was');

-- An exact replay returns the original revision and changes nothing.
set local role authenticated;
select is(public.vendor_decide_onboarding(pg_temp.c(1),1,'activate','Synthetic activate','sync-activate-1'), 2, 'a replay returns the original revision');
reset role;
select is(pg_temp.rev(1), 2, 'a replay adds no revision');

-- ── Suspend, renew while suspended, reactivate ──────────────────────────────────────────────
select is(pg_temp.decide(1,'suspend','sync-suspend-1'), '3', 'the operator suspends');
select is(pg_temp.active(1), false, 'suspension clears is_active');
select ok(not pg_temp.listable(1), 'a suspended provider no longer meets it');
select is(pg_temp.decide(1,'renew','sync-renew-1'), '4', 'renewal while suspended is recorded');
select is(pg_temp.active(1), false, 'renewal does not lift a suspension');
select is(pg_temp.decide(1,'activate','sync-activate-2'), '5', 'the operator reactivates');
select is(pg_temp.active(1), true, 'reactivation sets is_active again');
select is(pg_temp.decide(1,'renew','sync-renew-2'), '6', 'renewal while active is recorded');
select is(pg_temp.active(1), true, 'renewal leaves an active provider active');

-- ── Refusals and rejection ──────────────────────────────────────────────────────────────────
select is(pg_temp.decide(2,'activate','sync-activate-incomplete'), 'P0001', 'an incomplete checklist refuses activation');
select is(pg_temp.active(2), false, 'a refused activation leaves is_active false');
select is(pg_temp.decide(3,'reject','sync-reject-3'), '2', 'the operator rejects');
select is(pg_temp.active(3), false, 'rejection leaves is_active as it was');

-- ── Marketing stays a separate choice ───────────────────────────────────────────────────────
select is(pg_temp.decide(4,'activate','sync-activate-4'), '2', 'a provider with marketing off activates');
select is(pg_temp.active(4), true, 'its is_active is set');
select is((select marketing_enabled from public.contractors where id=pg_temp.c(4)), false, 'its marketing_enabled stays off');
select ok(not pg_temp.listable(4), 'so it does not meet the listing rule until marketing is enabled');

-- ── The direct switch stays closed ──────────────────────────────────────────────────────────
set local role authenticated;
select throws_ok(format('update public.contractors set is_active=false where id=%L', pg_temp.c(1)), '42501', null,
 'an admin still cannot change is_active directly');
reset role;
select is(pg_temp.active(1), true, 'the refused direct write changed nothing');

select * from finish();
rollback;
