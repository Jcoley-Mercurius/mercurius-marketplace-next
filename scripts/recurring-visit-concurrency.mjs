// TRACE-123: concurrent recurring visit creation on separate connections. The same key sent in
// parallel (a double click or a retried lost response) records once; operators racing for the
// same visit with different keys reach one visit; racing times on the same Eastern date give one
// visit and recorded refusals; different dates give one visit each. Every visit has exactly one
// offer and no payment obligation. Run only against a disposable local or isolated database with
// 20261026001000 applied. Synthetic fixtures only; they are removed at the end (history rows are
// append-only, so cleanup bypasses triggers as postgres).
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

const user = (n) => `c9610000-0000-4000-8000-00000000000${n}`;
const homeowner = user(1);
const vendorUser = user(2);
const operators = [3, 4, 5, 6, 7].map(user);
const contractor = 'c9620000-0000-4000-8000-000000000001';
const pkg = 'c9640000-0000-4000-8000-000000000001';
const tier = 'c9650000-0000-4000-8000-000000000001';
const plan = 'c9630000-0000-4000-8000-000000000001';
const service = 'synthetic-rv-concurrency';
// Eastern wall times on future days; the server checks the instant against them.
const local = (days, time) => `((now() at time zone 'America/New_York')::date + ${days} + time '${time}')`;
const create = (key, days, time, reason) => `select public.admin_create_recurring_visit('${plan}','${key}',
  ${local(days, time)} at time zone 'America/New_York', ${local(days, time)}, '${reason}')::text`;
const visits = () => sql(`select count(*) from public.service_requests where recurrence_parent_id='${plan}'`);
const offers = () => sql(`select count(*) from public.job_match_attempts a join public.service_requests r on r.id=a.service_request_id where r.recurrence_parent_id='${plan}'`);

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from private.recurring_visit_generations where series_id = '${plan}';
    delete from private.recurring_series_terms where series_id = '${plan}';
    delete from public.job_events where job_id in (select id from public.service_requests where id = '${plan}' or recurrence_parent_id = '${plan}');
    delete from public.notifications where related_request_id in (select id from public.service_requests where id = '${plan}' or recurrence_parent_id = '${plan}');
    delete from public.job_match_attempts where service_request_id in (select id from public.service_requests where id = '${plan}' or recurrence_parent_id = '${plan}');
    delete from public.service_requests where recurrence_parent_id = '${plan}';
    delete from public.service_requests where id = '${plan}';
    delete from public.package_tiers where id = '${tier}';
    delete from public.vendor_packages where id = '${pkg}';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from private.r0_trial_admissions where homeowner_id = '${homeowner}';
    delete from private.r0_lee_zips where zip_code = '00961';
    delete from public.coverage_areas where zip_code = '00961';
    delete from public.services_catalog where id = '${service}';
    delete from public.user_roles where user_id::text like 'c9610000-%';
    -- replica mode skips cascades, so rows that would follow the users are removed explicitly.
    delete from public.profiles where user_id::text like 'c9610000-%';
    delete from auth.users where id::text like 'c9610000-%';
    set session_replication_role = origin;`);
}

await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9610000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic concurrency"}' from generate_series(1, 7) n;
  delete from public.user_roles where user_id::text like 'c9610000-%' and user_id <> '${homeowner}';
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9610000-0000-4000-8000-00000000000' || n)::uuid, 'admin' from generate_series(3, 7) n;
  insert into public.services_catalog(id, name, category_id, one_time_price, weekly_price, monthly_price, default_frequency, available_frequencies, is_active)
    select '${service}', 'Synthetic concurrency lawn', id, 60, 40, 120, 'weekly', '{one-time,weekly}', true from public.service_categories order by id limit 1;
  insert into public.coverage_areas(zip_code, city, is_active, has_waitlist) values ('00961', 'Synthetic', true, false);
  insert into private.r0_lee_zips values ('00961');
  insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '00961', '${service}', '${operators[0]}');
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic concurrency provider', true, true);
  insert into public.contractor_service_zips(contractor_id, zip_code) values ('${contractor}', '00961');
  insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active, needs_review)
    values ('${pkg}', '${contractor}', '${service}', 'Synthetic concurrency package', 'fixed', 'weekly', false, false);
  insert into public.package_tiers(id, package_id, name, price, frequency, sort_order, rule_conditions) values ('${tier}', '${pkg}', 'Weekly', 40, 'weekly', 0, '[]');
  -- TRACE-134: a version's levels are written while it is paused, then it is published.
  update public.vendor_packages set is_active = true where id = '${pkg}';
  insert into public.service_requests(id, customer_id, service_type, service_catalog_id, address, city, state, zip_code, frequency, status, matching_status, preferred_contractor_id)
    values ('${plan}', '${homeowner}', 'Synthetic concurrency lawn', '${service}', '1 Synthetic Way', 'Synthetic', 'FL', '00961', 'weekly', 'pending', 'awaiting_match', '${contractor}');
  select private.offer_next_for_request_internal('${plan}');`);
await sql(as(vendorUser, `select public.vendor_accept_job('${plan}')`));
assert.equal(await sql(`select count(*) from private.recurring_series_terms where series_id='${plan}'`), '1', 'the accepted plan has terms');

try {
  // 1. The same key and intent sent eight times at once records once.
  const key = randomUUID();
  const repeated = await Promise.allSettled(Array.from({ length: 8 }, () => sql(as(operators[0], create(key, 10, '09:00', 'Double click')))));
  assert.equal(repeated.filter((result) => result.status === 'fulfilled').length, 8, 'every retry returns the recorded result');
  const first = new Set(repeated.map((result) => JSON.parse(result.value).occurrence_id));
  assert.equal(first.size, 1, 'every retry names the same visit');
  assert.equal(await visits(), '1');
  assert.equal(await offers(), '1');
  assert.equal(await sql(`select count(*) from private.recurring_visit_generations where series_id='${plan}'`), '1');

  // 2. Five operators, five keys, the same visit: one visit, the rest reach it.
  const same = await Promise.allSettled(operators.map((operator, i) => sql(as(operator, create(randomUUID(), 17, '09:00', `Operator ${i}`)))));
  assert.equal(same.filter((result) => result.status === 'fulfilled').length, 5);
  const outcomes = same.map((result) => JSON.parse(result.value));
  assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['created', 'existing', 'existing', 'existing', 'existing']);
  assert.equal(new Set(outcomes.map((o) => o.occurrence_id)).size, 1, 'all five name one visit');
  assert.equal(await visits(), '2');
  assert.equal(await offers(), '2');

  // 3. Five times on the same Eastern date: one visit, four recorded refusals.
  const times = ['08:00', '09:30', '11:00', '13:15', '16:45'];
  const day = await Promise.allSettled(operators.map((operator, i) => sql(as(operator, create(randomUUID(), 24, times[i], `Time ${i}`)))));
  const dayOutcomes = day.map((result) => JSON.parse(result.value));
  assert.equal(dayOutcomes.filter((o) => o.outcome === 'created').length, 1, 'one visit that day');
  assert.equal(dayOutcomes.filter((o) => o.code === 'visit_date_taken').length, 4, 'the others are refused and recorded');
  assert.equal(await visits(), '3');
  assert.equal(await offers(), '3');

  // 4. Five different dates at once: five visits, each with one offer and its own identity.
  const dates = await Promise.allSettled(operators.map((operator, i) => sql(as(operator, create(randomUUID(), 31 + 7 * i, '09:00', `Week ${i}`)))));
  assert.equal(dates.filter((result) => result.status === 'fulfilled' && JSON.parse(result.value).outcome === 'created').length, 5);
  assert.equal(await visits(), '8');
  assert.equal(await offers(), '8');
  assert.equal(await sql(`select count(distinct occurrence_key) from public.service_requests where recurrence_parent_id='${plan}'`), '8');
  assert.equal(await sql(`select count(*) from public.job_match_attempts a join public.service_requests r on r.id=a.service_request_id
    where r.recurrence_parent_id='${plan}' group by a.service_request_id having count(*) > 1`), '', 'no visit has two offers');
  assert.equal(await sql(`select count(*) from public.money_obligations o join public.service_requests r on r.id=o.service_request_id where r.recurrence_parent_id='${plan}'`), '0', 'no payment obligation');
  assert.equal(await sql(`select count(*) from private.recurring_visit_generations where series_id='${plan}'`), '16', 'every attempt is recorded once');
  console.log('PASS: parallel retries record once; racing operators reach one visit per date; same-date times are refused and recorded; each visit has one offer and no payment obligation.');
} finally {
  await cleanup();
}
