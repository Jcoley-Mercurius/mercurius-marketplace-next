// TRACE-127 (CS-4) and TRACE-126 (CS-3): recurring visits and one-time requests at their bound terms
// on separate connections, with the real commands. An ordinary vendor revision racing acceptance, publication or checkout must leave each of
// them SUCCEEDING at the bound amount (never a generic refusal). Parallel acceptances of one offer give
// one acceptance. Pausing, suspending or archiving the offering and suspending the provider race
// acceptance with only two outcomes: accepted at the bound terms first, or refused with the named
// exception. No race may deadlock. One-time requests are submitted through the real submission command,
// so their bound record is the one a homeowner's submission writes. Run only against a disposable local
// or isolated database with 20261115001000 and 20261116001000 applied. Phase 4 (CS5-F01, 20261121001000): an
// operator's unpaid-start exception on a job or visit whose checkout is open races the provider pausing the
// package or being suspended: the exception and its start apply first, or both are refused with nothing
// recorded; then an unpaid-exception start is not reusable for a rework restart, while paid rework restarts. Synthetic fixtures only; they are removed at the end (history and money rows
// are append-only, so cleanup bypasses triggers as postgres).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.RECURRING_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim()))));
    child.stdin.end(source);
  });
}
const as = (sub, statement) => `begin; set local role authenticated;
set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub })}';
${statement}; commit;`;

const user = (n) => `c9b71000-0000-4000-8000-00000000000${n}`;
const homeowner = user(1);
const vendorUser = user(2);
const [operator, finance, approver] = [3, 4, 5].map(user);
const contractor = 'c9b72000-0000-4000-8000-000000000001';
const pkg = 'c9b74000-0000-4000-8000-000000000001';
const tier = 'c9b75000-0000-4000-8000-000000000001';
const oneTimeTier = 'c9b75000-0000-4000-8000-000000000002';
const plan = 'c9b73000-0000-4000-8000-000000000001';
const application = 'c9b76000-0000-4000-8000-000000000001';
const service = 'synthetic-bt-concurrency';
const zip = '00972';
const local = (days) => `((now() at time zone 'America/New_York')::date + ${days} + time '09:00')`;
const ours = `(select id from public.service_requests where id = '${plan}' or recurrence_parent_id = '${plan}' or customer_id = '${homeowner}')`;
const obligations = `(select id from public.money_obligations where service_request_id in ${ours})`;
const deadlock = /deadlock detected/;

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from private.visit_start_payment_exceptions where job_id in ${ours};
    delete from public.job_completion_evidence where job_id in ${ours};
    delete from public.job_operations where job_id in ${ours};
    delete from public.job_status_rejections where job_id in ${ours};
    delete from storage.objects where bucket_id = 'job-photos' and name like '${vendorUser}/%';
    delete from public.money_webhook_events where payload->>'attempt_id' in (select id::text from public.money_checkout_attempts where obligation_id in ${obligations});
    delete from public.money_commercial_sources where snapshot_id in (select id from public.money_snapshots where obligation_id in ${obligations});
    do $$ declare t text; begin
      for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'obligation_id'
          and table_name <> 'money_snapshots' loop
        execute format('delete from public.%I where obligation_id in (select id from public.money_obligations where service_request_id in
          (select id from public.service_requests where id = %L or recurrence_parent_id = %L or customer_id = %L))', t, '${plan}', '${plan}', '${homeowner}');
      end loop; end $$;
    delete from public.money_snapshots where obligation_id in ${obligations};
    delete from public.money_obligations where service_request_id in ${ours};
    delete from public.money_review_approvals where requested_by::text like 'c9b71000-%';
    delete from public.money_authorities where user_id::text like 'c9b71000-%';
    delete from private.recurring_series_lifecycle where series_id = '${plan}';
    delete from private.recurring_visit_generations where series_id = '${plan}';
    delete from private.recurring_series_terms where series_id = '${plan}';
    delete from public.job_events where job_id in ${ours};
    delete from public.notifications where related_request_id in ${ours} or related_contractor_id = '${contractor}';
    delete from public.job_match_attempts where service_request_id in ${ours};
    delete from public.service_requests where recurrence_parent_id = '${plan}';
    delete from public.service_requests where customer_id = '${homeowner}' and id <> '${plan}';
    delete from public.service_requests where id = '${plan}';
    delete from private.package_archives where contractor_id = '${contractor}';
    delete from private.vendor_package_saves where actor = '${vendorUser}';
    delete from public.package_addons where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    delete from public.package_qualifying_questions where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    delete from public.package_tiers where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    delete from public.vendor_packages where contractor_id = '${contractor}';
    delete from public.vendor_onboarding_events where contractor_id = '${contractor}';
    delete from public.vendor_compliance_evidence where contractor_id = '${contractor}';
    delete from public.vendor_onboarding where contractor_id = '${contractor}';
    delete from public.vendor_application_versions where application_id = '${application}';
    delete from public.vendor_applications where id = '${application}';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from private.r0_trial_admissions where homeowner_id = '${homeowner}';
    delete from private.r0_lee_zips where zip_code = '${zip}';
    delete from public.coverage_areas where zip_code = '${zip}';
    delete from public.services_catalog where id = '${service}';
    delete from public.user_roles where user_id::text like 'c9b71000-%';
    delete from public.profiles where user_id::text like 'c9b71000-%';
    delete from auth.users where id::text like 'c9b71000-%';
    set session_replication_role = origin;`);
}

const visits = [];
async function createVisit(days) {
  const created = JSON.parse(await sql(as(operator, `select public.admin_create_recurring_visit('${plan}','${randomUUID()}',
    ${local(days)} at time zone 'America/New_York', ${local(days)}, 'Synthetic bound-terms visit')::text`)));
  assert.equal(created.outcome, 'created', `visit on day ${days} is created`);
  return created.occurrence_id;
}
const accept = (visit) => sql(as(vendorUser, `select public.vendor_accept_job('${visit}')`));
const head = () => sql(`select id from public.vendor_packages where contractor_id = '${contractor}' and lineage_id = '${pkg}' order by revision_number desc limit 1`);
// oneTime: the one-time level's price, kept on the new revision (CS-3 races); omitted, the revision
// offers only the weekly cadence.
const content = (price, name = 'Synthetic bound package', oneTime = null) => JSON.stringify({ service_id: service,
  package: { name, description: null, pricing_mode: 'fixed', default_frequency: 'weekly' }, questions: [],
  tiers: [{ name: 'Weekly', price, frequency: 'weekly' }, ...(oneTime ? [{ name: 'One time', price: oneTime, frequency: 'one-time' }] : [])], addons: [] });
// Reads the head and its revision hash first, so the save itself is the only statement in the race.
async function prepareSave(price, name, oneTime = null) {
  const id = await head();
  const hash = await sql(`select private.package_revision_hash('${id}')`);
  return () => sql(as(vendorUser, `select public.vendor_save_package('${id}','${hash}','${content(price, name, oneTime)}'::jsonb,true,'${randomUUID()}')::text`));
}
const amounts = (visit) => sql(`select concat_ws('/', r.status, round(r.total_amount, 2), round(a.base_price, 2), round(a.effective_price, 2), a.package_id = '${pkg}')
  from public.service_requests r left join public.job_match_attempts a on a.service_request_id = r.id and a.outcome = 'accepted' where r.id = '${visit}'`);
const BOUND = 'scheduled/40.00/40.00/40.00/t';
const BOUND_ONE_TIME = 'scheduled/60.00/60.00/60.00/t';
async function approvedTerms(visit, cents = 4000) {
  const terms = await sql(`select jsonb_build_object('service',${cents},'addons',0,'discount',0,'adjustment',0,'subtotal',${cents},'tax',0,'tip',0,
    'deposit',0,'total',${cents},'currency','usd','source_version',private.money_source('${visit}')->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic concurrency review','expires_at',date_trunc('second', now()+interval '2 days'))::text`);
  await sql(as(approver, `select public.money_approve_review('${finance}', jsonb_build_object('operation','snapshot','request','${visit}'::uuid,'terms','${terms}'::jsonb), 'Second review')`));
  return terms;
}
const publish = (visit, terms) => sql(`select public.money_publish_snapshot('${visit}','${terms}'::jsonb,'${finance}','${approver}')`);
const sourceHash = (visit) => sql(`select private.money_source('${visit}')->>'version'`);
function noDeadlock(results, label) {
  for (const r of results) if (r.status === 'rejected') assert.doesNotMatch(r.reason.message, deadlock, `${label}: no deadlock`);
}
// A race against genuine unavailability: accepted at the bound terms, or refused with the named code.
async function unavailableRace(label, visit, other, bound = BOUND) {
  const results = await Promise.allSettled([accept(visit), other()]);
  noDeadlock(results, label);
  assert.equal(results[1].status, 'fulfilled', `${label}: the catalog or provider command succeeds (${results[1].reason?.message ?? ''})`);
  if (results[0].status === 'fulfilled') assert.equal(await amounts(visit), bound, `${label}: accepted first, at the bound terms`);
  else assert.match(results[0].reason.message, /Provider is no longer eligible/, `${label}: refused only as no longer eligible (${results[0].reason.message})`);
  return results[0].status;
}

const revision = () => sql(`select revision from public.vendor_onboarding where contractor_id = '${contractor}'`);
async function setup() {
  visits.length = 0;
  await cleanup();
  await sql(`
    insert into auth.users(id, raw_user_meta_data) select ('c9b71000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic bound terms"}' from generate_series(1, 5) n;
    delete from public.user_roles where user_id::text like 'c9b71000-%' and user_id <> '${homeowner}';
    insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor'), ('${operator}', 'admin'), ('${finance}', 'admin'), ('${approver}', 'admin');
    insert into public.money_authorities(user_id, granted_by, reason) values ('${finance}', '${approver}', 'Synthetic'), ('${approver}', '${finance}', 'Synthetic');
    insert into public.services_catalog(id, name, category_id, one_time_price, weekly_price, monthly_price, default_frequency, available_frequencies, is_active)
      select '${service}', 'Synthetic bound lawn', id, 60, 40, 120, 'weekly', '{one-time,weekly}', true from public.service_categories order by id limit 1;
    insert into public.coverage_areas(zip_code, city, is_active, has_waitlist) values ('${zip}', 'Synthetic', true, false);
    insert into private.r0_lee_zips values ('${zip}');
    insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '${zip}', '${service}', '${operator}');
    insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic bound provider', false, true);
    insert into public.contractor_service_zips(contractor_id, zip_code) values ('${contractor}', '${zip}');
    insert into public.vendor_applications(id, business_name, first_name, last_name, email, phone, contractor_id)
      values ('${application}', 'Synthetic bound provider', 'Test', 'Bound', 'bound-terms@example.invalid', 'synthetic', '${contractor}');
    insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active, needs_review)
      values ('${pkg}', '${contractor}', '${service}', 'Synthetic bound package', 'fixed', 'weekly', false, false);
    insert into public.package_tiers(id, package_id, name, price, frequency, sort_order, rule_conditions) values ('${tier}', '${pkg}', 'Weekly', 40, 'weekly', 0, '[]'),
      ('${oneTimeTier}', '${pkg}', 'One time', 60, 'one-time', 1, '[]');
    update public.vendor_packages set is_active = true where id = '${pkg}';`);
  // The provider is activated through the real onboarding decision (DEC-2026-061), so the suspension race
  // below uses the real command too.
  const version = await sql(`select id from public.vendor_application_versions where application_id = '${application}' order by revision desc limit 1`);
  await sql(as(operator, `select public.vendor_begin_review('${contractor}', '${version}')`));
  // As SQL 113: evidence is recorded by the service path (postgres), with the operator as the actor.
  await sql(`set request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: operator })}'; select public.vendor_record_evidence('${contractor}', k, 'synthetic-rule', 'private-synthetic-' || k || '-' || gen_random_uuid(),
    now() - interval '1 hour', now() + interval '1 year', null) from unnest(array['identity','agreement','coverage','license','insurance',
    'bank_authorization','profile_pricing','availability','test_notification']) k`);
  await sql(as(operator, `select public.vendor_decide_onboarding('${contractor}', ${await revision()}, 'activate', 'Synthetic activate', '${randomUUID()}')`));
  assert.equal(await sql(`select is_active::text || private.vendor_matching_eligible('${contractor}')::text from public.contractors where id = '${contractor}'`), 'truetrue');
  await sql(`insert into public.service_requests(id, customer_id, service_type, service_catalog_id, address, city, state, zip_code, frequency, status, matching_status, preferred_contractor_id)
      values ('${plan}', '${homeowner}', 'Synthetic bound lawn', '${service}', '1 Synthetic Way', 'Synthetic', 'FL', '${zip}', 'weekly', 'pending', 'awaiting_match', '${contractor}');
    select private.offer_next_for_request_internal('${plan}');`);
  await sql(as(vendorUser, `select public.vendor_accept_job('${plan}')`));
}
// A one-time request at the bound $60, submitted by the homeowner through the real command and offered.
async function submitOneTime() {
  const payload = JSON.stringify({ location: { address: '1 Synthetic Way', city: 'Synthetic', state: 'FL', zip_code: zip },
    preferred_time: 'Synthetic window', selections: [{ service_id: service, frequency: 'one-time', package_id: pkg, tier_id: oneTimeTier,
      preferred_contractor_id: contractor, expected: { pricing_mode: 'fixed', total: 60 } }] });
  const out = JSON.parse(await sql(as(homeowner, `select public.submit_service_requests('${randomUUID()}', '${payload}'::jsonb)::text`)));
  const request = out.requests?.[0]?.request_id;
  assert.ok(request, `one-time request submitted (${JSON.stringify(out.requests?.[0] ?? out)})`);
  await sql(`select private.offer_next_for_request_internal('${request}')`);
  return request;
}
const reactivate = async () => sql(as(operator, `select public.vendor_decide_onboarding('${contractor}', ${await revision()}, 'activate', 'Synthetic reactivate', '${randomUUID()}')`));
const liveHead = () => sql(`select id || '|' || updated_at from public.vendor_packages where lineage_id = '${pkg}' and is_active`);

try {
  // Phase 1. Every visit is created before any revision: a revision blocks new visits (changed-terms
  // safeguard), so the visits the races need exist first.
  await setup();
  for (let day = 2; day <= 15; day += 1) visits.push(await createVisit(day));
  const next = () => visits.shift();

  // C1. Acceptance racing an ordinary price revision, four rounds: both succeed, at the bound $40.
  for (let round = 1; round <= 4; round += 1) {
    const visit = next();
    const save = await prepareSave(40 + round);
    const results = await Promise.allSettled([accept(visit), save()]);
    noDeadlock(results, `C1 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C1 round ${round}: acceptance succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[1].status, 'fulfilled', `C1 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
    assert.equal(await amounts(visit), BOUND, `C1 round ${round}: accepted at the bound terms`);
  }
  assert.equal(await sql(`select count(*) from public.vendor_packages where lineage_id = '${pkg}'`), '5', 'C1: four revisions were saved');

  // C2. Six parallel acceptances of one offer after a rename: exactly one acceptance.
  {
    await (await prepareSave(44, 'Synthetic bound package renamed'))();
    const visit = next();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => accept(visit)));
    noDeadlock(results, 'C2');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'C2: one acceptance');
    for (const r of results.filter((x) => x.status === 'rejected')) assert.match(r.reason.message, /No open offer is available to accept/, 'C2: the rest find no open offer');
    assert.equal(await sql(`select count(*) from public.job_match_attempts where service_request_id = '${visit}' and outcome = 'accepted'`), '1');
    assert.equal(await amounts(visit), BOUND, 'C2: at the bound terms');
  }

  // C3. Homeowner checkout racing a price revision, three rounds: both succeed, at $40.
  for (let round = 1; round <= 3; round += 1) {
    const visit = next();
    await accept(visit);
    const snapshot = await publish(visit, await approvedTerms(visit));
    const save = await prepareSave(50 + round);
    const results = await Promise.allSettled([sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}','full')).amount`)), save()]);
    noDeadlock(results, `C3 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C3 round ${round}: checkout succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[0].value, '4000', `C3 round ${round}: at the bound $40`);
    assert.equal(results[1].status, 'fulfilled', `C3 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
  }

  // C4. Snapshot publication racing a revision: both succeed; the snapshot carries the source hash read
  // before the revision, and the hash is unchanged after it.
  for (let round = 1; round <= 2; round += 1) {
    const visit = next();
    await accept(visit);
    const terms = await approvedTerms(visit);
    const before = await sourceHash(visit);
    const save = await prepareSave(60 + round);
    const results = await Promise.allSettled([publish(visit, terms), save()]);
    noDeadlock(results, `C4 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C4 round ${round}: publication succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[1].status, 'fulfilled', `C4 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
    assert.equal(await sql(`select c.source_hash || '/' || s.service from public.money_commercial_sources c join public.money_snapshots s on s.id = c.snapshot_id
      where c.snapshot_id = '${results[0].value}'`), `${before}/4000`, `C4 round ${round}: same source hash and $40`);
    assert.equal(await sourceHash(visit), before, `C4 round ${round}: the hash is unchanged after the revision`);
  }

  // C5. Acceptance racing the vendor pausing the live revision: accepted first, or refused. Then the
  // vendor publishes it again and acceptance succeeds at the bound terms.
  {
    const [id, stamp] = (await liveHead()).split('|');
    await unavailableRace('C5 vendor pause', next(), () => sql(as(vendorUser, `select public.vendor_set_package_active('${id}', false, '${stamp}')::text`)));
    const [, paused] = (await sql(`select id || '|' || updated_at from public.vendor_packages where id = '${id}'`)).split('|');
    await sql(as(vendorUser, `select public.vendor_set_package_active('${id}', true, '${paused}')::text`));
    const visit = next();
    await accept(visit);
    assert.equal(await amounts(visit), BOUND, 'C5: after republishing, acceptance succeeds at the bound terms');
  }

  // C6. Acceptance racing the provider's suspension through the onboarding decision (DEC-2026-061):
  // accepted first, or refused. Reactivation restores acceptance at the bound terms.
  {
    await unavailableRace('C6 provider suspension', next(),
      async () => sql(as(operator, `select public.vendor_decide_onboarding('${contractor}', ${await revision()}, 'suspend', 'Synthetic suspend', '${randomUUID()}')`)));
    await reactivate();
    const visit = next();
    await accept(visit);
    assert.equal(await amounts(visit), BOUND, 'C6: after reactivation, acceptance succeeds at the bound terms');
  }

  // Phase 2. Operator suspension and archive end an offering, so they run on a fresh fixture.
  await setup();
  for (let day = 2; day <= 5; day += 1) visits.push(await createVisit(day));
  await (await prepareSave(45))();

  // C7. Acceptance racing an operator archive of the paused bound revision while its successor is live:
  // accepted first, or refused (an archived bound revision is treated as no longer offered).
  {
    const stamp = await sql(`select updated_at from public.vendor_packages where id = '${pkg}'`);
    await unavailableRace('C7 archive of the bound revision', next(),
      () => sql(as(operator, `select public.admin_archive_package('${pkg}','${stamp}','Synthetic archive')::text`)));
    await assert.rejects(accept(next()), /Provider is no longer eligible/, 'C7: after the archive, acceptance is refused');
  }
}
finally {
  await cleanup();
}

try {
  // C8. Acceptance racing an operator suspension of the live revision (fresh fixture).
  await setup();
  for (let day = 2; day <= 3; day += 1) visits.push(await createVisit(day));
  const [id, stamp] = (await liveHead()).split('|');
  await unavailableRace('C8 operator suspension', visits.shift(),
    () => sql(as(operator, `select public.admin_suspend_package('${id}','${stamp}','Synthetic suspension')::text`)));
  await assert.rejects(accept(visits.shift()), /Provider is no longer eligible/, 'C8: after the suspension, acceptance is refused');
} finally {
  await cleanup();
}

try {
  // Phase 3 (CS-3). One-time requests submitted at the bound $60 before any revision; every revision
  // keeps a one-time level, at a new price.
  await setup();
  const requests = [];
  for (let n = 0; n < 12; n += 1) requests.push(await submitOneTime());
  const next = () => requests.shift();

  // C9. One-time acceptance racing an ordinary price revision, three rounds: both succeed, at $60.
  for (let round = 1; round <= 3; round += 1) {
    const request = next();
    const save = await prepareSave(40, 'Synthetic bound package', 60 + round);
    const results = await Promise.allSettled([accept(request), save()]);
    noDeadlock(results, `C9 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C9 round ${round}: acceptance succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[1].status, 'fulfilled', `C9 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
    assert.equal(await amounts(request), BOUND_ONE_TIME, `C9 round ${round}: accepted at the bound terms`);
  }

  // C10. Six parallel acceptances of one offer after a rename: exactly one acceptance.
  {
    await (await prepareSave(40, 'Synthetic bound package renamed', 64))();
    const request = next();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => accept(request)));
    noDeadlock(results, 'C10');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'C10: one acceptance');
    for (const r of results.filter((x) => x.status === 'rejected')) assert.match(r.reason.message, /No open offer is available to accept/, 'C10: the rest find no open offer');
    assert.equal(await amounts(request), BOUND_ONE_TIME, 'C10: at the bound terms');
  }

  // C11. Homeowner checkout racing a price revision, three rounds: both succeed, at $60.
  for (let round = 1; round <= 3; round += 1) {
    const request = next();
    await accept(request);
    const snapshot = await publish(request, await approvedTerms(request, 6000));
    const save = await prepareSave(40, 'Synthetic bound package', 70 + round);
    const results = await Promise.allSettled([sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}','full')).amount`)), save()]);
    noDeadlock(results, `C11 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C11 round ${round}: checkout succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[0].value, '6000', `C11 round ${round}: at the bound $60`);
    assert.equal(results[1].status, 'fulfilled', `C11 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
  }

  // C12. Snapshot publication racing a revision: both succeed with the source hash read before it.
  for (let round = 1; round <= 2; round += 1) {
    const request = next();
    await accept(request);
    const terms = await approvedTerms(request, 6000);
    const before = await sourceHash(request);
    const save = await prepareSave(40, 'Synthetic bound package', 80 + round);
    const results = await Promise.allSettled([publish(request, terms), save()]);
    noDeadlock(results, `C12 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C12 round ${round}: publication succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[1].status, 'fulfilled', `C12 round ${round}: the revision is saved (${results[1].reason?.message ?? ''})`);
    assert.equal(await sql(`select c.source_hash || '/' || s.service from public.money_commercial_sources c join public.money_snapshots s on s.id = c.snapshot_id
      where c.snapshot_id = '${results[0].value}'`), `${before}/6000`, `C12 round ${round}: same source hash and $60`);
    assert.equal(await sourceHash(request), before, `C12 round ${round}: the hash is unchanged after the revision`);
  }

  // C13. One-time acceptance racing the vendor pausing the live revision: accepted first, or refused.
  // Republished, acceptance succeeds at the bound terms.
  {
    const [id, stamp] = (await liveHead()).split('|');
    await unavailableRace('C13 vendor pause', next(), () => sql(as(vendorUser, `select public.vendor_set_package_active('${id}', false, '${stamp}')::text`)), BOUND_ONE_TIME);
    const [, paused] = (await sql(`select id || '|' || updated_at from public.vendor_packages where id = '${id}'`)).split('|');
    await sql(as(vendorUser, `select public.vendor_set_package_active('${id}', true, '${paused}')::text`));
    const request = next();
    await accept(request);
    assert.equal(await amounts(request), BOUND_ONE_TIME, 'C13: after republishing, acceptance succeeds at the bound terms');
  }
} finally {
  await cleanup();
}

try {
  // Phase 4 (CS5-F01, 20261121001000). Open checkouts (processing) on accepted one-time jobs and visits.
  await setup();
  const visitsF = [];
  for (let day = 2; day <= 4; day += 1) visitsF.push(await createVisit(day));
  const requests = [];
  for (let n = 0; n < 10; n += 1) requests.push(await submitOneTime());
  for (const job of [...requests, ...visitsF]) await accept(job);
  const visitIds = new Set(visitsF);
  const isVisit = (job) => visitIds.has(job);
  const processing = async (job) => {
    const snapshot = await publish(job, await approvedTerms(job, isVisit(job) ? 4000 : 6000));
    await sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}','full')).id`));
    return job;
  };
  const except = (job) => sql(as(operator, `select public.admin_start_visit_payment_exception('${job}','${randomUUID()}','Synthetic: paying on site')->>'payment_exception'`));
  const startAs = (who, job, reason = null) => sql(as(who, `select public.start_job('${job}','${randomUUID()}',${reason ? `'${reason}'` : 'null'})->>'outcome'`));
  const trace = (job) => sql(`select concat_ws('/', status, (select count(*) from private.visit_start_payment_exceptions where job_id = r.id),
    (select count(*) from public.job_events where job_id = r.id and metadata->>'to' = 'in_progress')) from public.service_requests r where id = '${job}'`);
  const label = (job) => sql(`select (case when r.recurrence_parent_id is null then private.one_time_job_payment(r, now())
    else private.recurring_visit_payment(r, now()) end)->>'state' from public.service_requests r where id = '${job}'`);
  const refusal = /can't start before payment|agreed terms can't be confirmed|price hasn't been reviewed/;
  const pause = async () => {
    const [id, stamp] = (await liveHead()).split('|');
    return () => sql(as(vendorUser, `select public.vendor_set_package_active('${id}', false, '${stamp}')::text`));
  };
  const republish = async () => {
    const [id, stamp] = (await sql(`select id || '|' || updated_at from public.vendor_packages where lineage_id = '${pkg}' order by revision_number desc limit 1`)).split('|');
    await sql(as(vendorUser, `select public.vendor_set_package_active('${id}', true, '${stamp}')::text`));
  };
  const suspend = async () => {
    const rev = await revision();
    return () => sql(as(operator, `select public.vendor_decide_onboarding('${contractor}', ${rev}, 'suspend', 'Synthetic suspend', '${randomUUID()}')`));
  };
  // Rounds 0 and 1 force each order; the rest race.
  async function exceptionRace(name, jobs, prepare, restore) {
    const orders = new Set();
    for (let i = 0; i < jobs.length; i += 1) {
      const job = await processing(jobs[i]);
      const change = await prepare();
      const [excepted, changed] = i === 0 ? [await Promise.allSettled([change()]), await Promise.allSettled([except(job)])].map((r) => r[0]).reverse()
        : i === 1 ? [await Promise.allSettled([except(job)]), await Promise.allSettled([change()])].map((r) => r[0])
          : await Promise.allSettled([except(job), change()]);
      noDeadlock([excepted, changed], `${name} round ${i}`);
      assert.equal(changed.status, 'fulfilled', `${name} round ${i}: the provider command applies (${changed.reason?.message ?? ''})`);
      if (excepted.status === 'fulfilled') {
        assert.equal(excepted.value, 'true', `${name} round ${i}: the start records an exception`);
        assert.equal(await trace(job), 'in_progress/1/1', `${name} round ${i}: exception first; one exception row and one start`);
        orders.add('exception-first');
      } else {
        assert.match(excepted.reason.message, refusal, `${name} round ${i}: refused only for the hard stop (${excepted.reason.message})`);
        assert.equal(await trace(job), 'scheduled/0/0', `${name} round ${i}: nothing recorded`);
        assert.equal(await label(job), 'processing', `${name} round ${i}: the job still shows processing`);
        await assert.rejects(startAs(vendorUser, job), /still processing/, `${name} round ${i}: the provider cannot start it either`);
        assert.equal(await trace(job), 'scheduled/0/0', `${name} round ${i}: still nothing recorded`);
        orders.add('change-first');
      }
      await restore();
    }
    assert.equal(orders.size, 2, `${name}: both orders exercised`);
  }
  // C14. One-time exception ∥ the provider pausing the package.
  await exceptionRace('C14 exception vs package pause', requests.splice(0, 4), pause, republish);
  // C15. One-time exception ∥ the provider's suspension through the onboarding decision.
  await exceptionRace('C15 exception vs provider suspension', requests.splice(0, 4), suspend, reactivate);
  // C16. Recurring visit exception ∥ the provider pausing the package (the same rule for visits).
  await exceptionRace('C16 visit exception vs package pause', visitsF.splice(0, 3), pause, republish);

  // C17 (sequential, separate transactions). An unpaid job started under an exception, completed and returned
  // for rework can't restart: the earlier exception is not reusable, and the exception command is scheduled-only.
  const complete = async (job) => {
    await sql(`insert into storage.objects(bucket_id, name, owner) values ('job-photos', '${vendorUser}/${job}/proof.png', '${vendorUser}')`);
    await sql(as(vendorUser, `select public.vendor_complete_job('${job}', array['${vendorUser}/${job}/proof.png'])`));
    assert.equal(await sql(`select status from public.service_requests where id = '${job}'`), 'vendor_completed');
  };
  const rework = (job) => sql(as(operator, `select public.transition_job_status('${job}','in_progress','Synthetic rework')`));
  {
    const job = requests.shift();
    await publish(job, await approvedTerms(job, 6000));
    assert.equal(await label(job), 'ready');
    assert.equal(await except(job), 'true', 'C17: the unpaid job starts under an exception');
    await complete(job);
    await assert.rejects(rework(job), /isn't paid yet/, 'C17: the rework restart is refused while unpaid');
    await assert.rejects(sql(as(operator, `select public.admin_start_visit_payment_exception('${job}','${randomUUID()}','Synthetic: rework on site')`)),
      /no longer waiting to start/, 'C17: no exception for a rework restart');
    assert.equal(await trace(job), 'vendor_completed/1/1', 'C17: unchanged; one exception row and one start');
  }
  // C18. Paid rework control: a paid job restarts for rework.
  {
    const job = requests.shift();
    const snapshot = await publish(job, await approvedTerms(job, 6000));
    const attempt = await sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}','full')).id`));
    const event = `evt_${randomUUID().replaceAll('-', '')}`;
    await sql(`select public.money_receive_event('${event}', 'capture', '${JSON.stringify({ attempt_id: attempt, payment_id: `pi_${attempt.replaceAll('-', '')}`, amount: 6000, currency: 'usd' })}')`);
    assert.equal(await sql(`select public.money_process_event('${event}')`), 'processed');
    assert.equal(await label(job), 'paid');
    assert.equal(await startAs(vendorUser, job), 'started', 'C18: the paid job starts');
    await complete(job);
    await rework(job);
    assert.equal(await trace(job), 'in_progress/0/2', 'C18: paid rework restarts; no exception');
  }
  console.log('PASS: ordinary revisions racing acceptance, checkout and publication all succeed at the bound terms with unchanged source hashes, for recurring visits and one-time requests; six parallel acceptances give one; vendor pause, provider suspension, archive and operator suspension races accept first at the bound terms or refuse as no longer eligible; unpaid-start exceptions racing a pause or suspension apply first or are refused with nothing recorded (C14–C16); an exception start is not reusable for rework, paid rework restarts (C17–C18); no race deadlocks.');
} finally {
  await cleanup();
}
