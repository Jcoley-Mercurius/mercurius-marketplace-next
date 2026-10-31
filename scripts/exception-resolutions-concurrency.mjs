// TRACE-132: concurrent 6.9B commands on separate connections. R1 one answer to a provider's proposed
// time, retried and duplicated; R2 that answer ∥ provider withdrawal ∥ homeowner cancellation; R3
// recording the accepted time ∥ homeowner cancellation ∥ work start; R4 replacement acceptance ∥
// replacement withdrawal ∥ homeowner cancellation; R5 acceptance retried ∥ a decline; R6 two
// proposals from one read; R7 later waiver repeated and duplicated ∥ refund authorization; R8 plan
// stop request ∥ Stop future visits ∥ visit cancellation.
// Run only against a disposable local or isolated database with 20261102001000 applied. Fixtures are
// synthetic, use fresh ids each run and are left in place; reset the database before delivery, as CI does.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.EXCEPTIONS_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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
const claims = (sub) => `perform set_config('request.jwt.claims', '${JSON.stringify({ role: 'authenticated', sub })}', true);`;
const json = async (promise) => JSON.parse(await promise);
const settled = (promises) => Promise.allSettled(promises);
const fulfilled = (results) => results.filter((result) => result.status === 'fulfilled');
const rejected = (results) => results.filter((result) => result.status === 'rejected');
const lit = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

for (let attempt = 0; ; attempt += 1) {
  try { assert.equal(await sql('select 1'), '1'); break; } catch (error) {
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Homeowner, operators with finance authority, and three providers eligible for quote work in one area.
const homeowner = randomUUID(), operator = randomUUID(), reviewer = randomUUID();
const providers = [0, 1, 2].map(() => ({ user: randomUUID(), contractor: randomUUID(), pkg: randomUUID() }));
const zip = String(10000 + Math.floor(Math.random() * 80000));
await sql(`begin;
insert into auth.users(id, raw_user_meta_data) values ('${homeowner}', '{}'), ('${operator}', '{}'), ('${reviewer}', '{}')
  ${providers.map((p) => `, ('${p.user}', '{}')`).join('')};
insert into public.user_roles(user_id, role) values ('${operator}', 'admin'), ('${reviewer}', 'admin')
  ${providers.map((p) => `, ('${p.user}', 'vendor')`).join('')};
insert into public.money_authorities(user_id, granted_by, reason) values ('${operator}', '${reviewer}', 'synthetic'), ('${reviewer}', '${operator}', 'synthetic');
insert into public.coverage_areas(zip_code, city) values ('${zip}', 'Synthetic resolutions') on conflict do nothing;
${providers.map((p, i) => `insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${p.contractor}', '${p.user}', 'Synthetic provider ${i}', true, true);
insert into public.contractor_service_zips(contractor_id, zip_code) values ('${p.contractor}', '${zip}');
insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active)
  select '${p.pkg}', '${p.contractor}', id, 'Synthetic quote', 'custom_quote', 'one-time', true from public.services_catalog order by id limit 1;`).join('\n')}
insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '33901', 'house-cleaning', '${reviewer}');
commit;`);
const userOf = (contractor) => providers.find((p) => p.contractor === contractor).user;

// A one-time request accepted by provider 0 through the ordinary offer, with an appointment.
async function accepted(hours = 100) {
  const id = randomUUID();
  await sql(`begin;
insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code)
  select '${id}', '${homeowner}', 'Synthetic resolution', 'Synthetic address', id, 'one-time', '${zip}' from public.services_catalog order by id limit 1;
select private.create_job_offer_internal('${id}', '${providers[0].contractor}', '${providers[0].pkg}', null, false);
commit;`);
  await sql(as(providers[0].user, `select public.vendor_accept_job('${id}')`));
  await sql(`update public.service_requests set scheduled_start_at = date_trunc('minute', now()) + interval '${hours} hours' where id = '${id}'`);
  return id;
}
const request = (id) => json(sql(`select row_to_json(r) from public.service_requests r where id = '${id}'`));
const schedule = (id, who = homeowner) => json(sql(as(who, `select public.job_schedule('${id}')`)));
const at = (hours) => sql(`select date_trunc('minute', now()) + interval '${hours} hours'`);
const local = (instant) => sql(`select ('${instant}'::timestamptz at time zone 'America/New_York')::text`);
const op = (who, id, kind, extra = {}) => sql(as(who, `select public.record_job_operation('${id}', '${extra.key ?? randomUUID()}', '${kind}', 'Synthetic', ${extra.at ? `'${extra.at}'` : 'null'}, false, ${extra.expected ? lit(extra.expected) : 'null'})`));
const preview = async (who, id, kind = 'customer_cancel') => (await json(sql(as(who, `select public.job_cancellation_preview('${id}', '${kind}')`)))).expected;
const answerTime = (id, requestId, key, accept, expected) =>
  sql(as(homeowner, `select public.respond_to_reschedule_request('${id}', '${requestId}', '${key}', ${accept}, ${lit(expected)})`));
const record = async (id, starts, expected) =>
  sql(as(operator, `select public.admin_record_appointment('${id}', '${randomUUID()}', '${starts}', '${await local(starts)}', '${expected}', 'Synthetic')`));
const propose = async (id, key, starts, expected) =>
  sql(as(operator, `select public.admin_propose_replacement('${id}', '${key}', '${starts}', '${await local(starts)}', ${lit(expected)}, 'Synthetic proposal')`));
const answerReplacement = (proposal, key, accept, expected) =>
  sql(as(homeowner, `select public.homeowner_respond_replacement('${proposal}', '${key}', ${accept}, ${lit(expected)})`));

// A provider's proposed time, ready for the homeowner's answer.
async function proposedTime() {
  const id = await accepted();
  const starts = await at(110);
  await op(providers[0].user, id, 'reschedule_request', { at: starts });
  const open = (await schedule(id)).open_request;
  return { id, starts, open };
}
// A one-time request whose provider withdrew and whose replacement accepted the offer.
async function awaitingHomeowner() {
  const id = await accepted();
  await op(providers[0].user, id, 'provider_cancel');
  const offered = await request(id);
  await sql(as(userOf(offered.contractor_id), `select public.vendor_accept_job('${id}')`));
  assert.equal((await request(id)).matching_status, 'awaiting_homeowner');
  return { id, replacement: offered.contractor_id };
}

// R1: one answer to a provider's proposed time, retried five times and raced by a second key.
for (let i = 0; i < 3; i += 1) {
  const { id, open } = await proposedTime();
  const key = randomUUID();
  const results = await settled([...Array.from({ length: 5 }, () => answerTime(id, open.id, key, true, open.expected)),
    answerTime(id, open.id, randomUUID(), false, open.expected)]);
  const keyed = results.slice(0, 5);
  assert.equal(await sql(`select count(*) from public.job_reschedule_responses where job_id = '${id}'`), '1', 'R1: one answer');
  const accepted = await sql(`select accepted from public.job_reschedule_responses where job_id = '${id}'`);
  if (accepted === 't') {
    assert.equal(fulfilled(keyed).length, 5, 'R1: every retry of the winning key returns it');
    assert.match(results[5].reason.message, /already answered/, 'R1: the other key is refused');
  } else {
    assert.ok(keyed.every((r) => r.status === 'rejected' && /already answered/.test(r.reason.message)), 'R1: the losing key is refused');
  }
  assert.equal((await request(id)).scheduled_start_at !== null, true);
}

// R2: the answer ∥ the provider's withdrawal ∥ the homeowner's cancellation (each from its own read).
for (let i = 0; i < 3; i += 1) {
  const { id, open } = await proposedTime();
  const before = (await request(id)).scheduled_start_at;
  const [providerRead, homeownerRead] = await Promise.all([preview(providers[0].user, id, 'provider_cancel'), preview(homeowner, id)]);
  const results = await settled([answerTime(id, open.id, randomUUID(), true, open.expected),
    op(providers[0].user, id, 'provider_cancel', { expected: providerRead }), op(homeowner, id, 'customer_cancel', { expected: homeownerRead })]);
  const [answer, withdrawal, cancellation] = results;
  assert.ok(withdrawal.status === 'rejected' || cancellation.status === 'rejected', 'R2: withdrawal and cancellation never both apply');
  for (const r of rejected(results)) assert.match(r.reason.message, /changed since you opened it|answered or replaced|no longer accepts/, 'R2: losers are stale');
  if (answer.status === 'fulfilled') assert.equal(await sql(`select count(*) from public.job_reschedule_responses where job_id = '${id}'`), '1');
  assert.equal((await request(id)).scheduled_start_at, before, 'R2: no answer alone moves the appointment');
  assert.equal((await schedule(id, operator)).open_request, null, 'R2: the withdrawal or cancellation closed the request');
}

// R3: recording the accepted time ∥ homeowner cancellation (from its read) ∥ the provider starting work.
for (let i = 0; i < 3; i += 1) {
  const { id, starts, open } = await proposedTime();
  await answerTime(id, open.id, randomUUID(), true, open.expected);
  const current = (await request(id)).scheduled_start_at;
  const homeownerRead = await preview(homeowner, id);
  const [recorded, cancelled, started] = await settled([record(id, starts, current), op(homeowner, id, 'customer_cancel', { expected: homeownerRead }),
    sql(as(providers[0].user, `select public.start_job('${id}', '${randomUUID()}')`))]);
  assert.ok(!(recorded.status === 'fulfilled' && cancelled.status === 'fulfilled'), 'R3: recording and cancellation never both apply');
  assert.ok(!(started.status === 'fulfilled' && cancelled.status === 'fulfilled'), 'R3: start and cancellation never both apply');
  if (cancelled.status === 'rejected') assert.match(cancelled.reason.message, /changed since you opened it/, 'R3: the cancellation read is stale');
  if (recorded.status === 'rejected') assert.match(recorded.reason.message, /only after a provider accepts/, 'R3: no appointment after cancellation or start');
  const final = await request(id);
  if (recorded.status === 'fulfilled') assert.equal(new Date(final.scheduled_start_at).getTime(), new Date(starts).getTime(), 'R3: the accepted time is recorded');
  else assert.equal(final.scheduled_start_at, current, 'R3: otherwise the appointment is unchanged');
  assert.equal(final.status, cancelled.status === 'fulfilled' ? 'cancelled' : started.status === 'fulfilled' ? 'in_progress' : 'scheduled');
}

// R4: replacement acceptance ∥ the replacement's withdrawal ∥ homeowner cancellation (fresh reads).
for (let i = 0; i < 3; i += 1) {
  const { id, replacement } = await awaitingHomeowner();
  const proposal = await json(propose(id, randomUUID(), await at(120), (await schedule(id, operator)).replacement.admin_expected));
  const expected = (await schedule(id)).replacement.expected;
  const [providerRead, homeownerRead] = await Promise.all([preview(userOf(replacement), id, 'provider_cancel'), preview(homeowner, id)]);
  const results = await settled([answerReplacement(proposal.id, randomUUID(), true, expected),
    op(userOf(replacement), id, 'provider_cancel', { expected: providerRead }), op(homeowner, id, 'customer_cancel', { expected: homeownerRead })]);
  assert.equal(fulfilled(results).length, 1, 'R4: exactly one of the three applies');
  const final = await request(id);
  if (results[0].status === 'fulfilled') {
    assert.equal(final.status, 'scheduled'); assert.equal(final.contractor_id, replacement, 'R4: scheduled with the accepted provider');
  } else if (results[2].status === 'fulfilled') {
    assert.equal(final.status, 'cancelled');
    assert.equal(JSON.parse(results[2].value).refund_percent, 100, 'R4: E12 full refund while the withdrawal is open');
  } else {
    assert.notEqual(final.contractor_id, replacement, 'R4: the withdrawn replacement is no longer assigned');
  }
}

// R5: acceptance retried four times ∥ a decline with another key.
for (let i = 0; i < 3; i += 1) {
  const { id } = await awaitingHomeowner();
  const proposal = await json(propose(id, randomUUID(), await at(120), (await schedule(id, operator)).replacement.admin_expected));
  const expected = (await schedule(id)).replacement.expected;
  const key = randomUUID();
  const results = await settled([...Array.from({ length: 4 }, () => answerReplacement(proposal.id, key, true, expected)),
    answerReplacement(proposal.id, randomUUID(), false, expected)]);
  assert.equal(await sql(`select count(*) from public.job_replacement_responses where proposal_id = '${proposal.id}'`), '1', 'R5: one answer');
  const final = await request(id);
  if (fulfilled(results.slice(0, 4)).length === 4) assert.equal(final.status, 'scheduled', 'R5: accepted once, every retry replays');
  else assert.ok(results.slice(0, 4).every((r) => r.status === 'rejected') && final.status !== 'scheduled', 'R5: the decline won');
}

// R6: two proposals from the same operator read: one applies, the other is stale.
{
  const { id } = await awaitingHomeowner();
  const expected = (await schedule(id, operator)).replacement.admin_expected;
  const results = await settled([propose(id, randomUUID(), await at(120), expected), propose(id, randomUUID(), await at(121), expected)]);
  assert.equal(fulfilled(results).length, 1, 'R6: one proposal');
  assert.match(rejected(results)[0].reason.message, /changed since you loaded it/, 'R6: the other is stale');
}

// R7: later waiver — duplicated, raced by a second operator and by the original refund's authorization.
const r7orders = new Set();
for (let i = 0; i < 3; i += 1) {
  // A scheduled request with an accepted quote and a published two-person snapshot, paid in full.
  const id = randomUUID(), quote = randomUUID();
  const snapshot = await sql(`begin;
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, zip_code, service_catalog_id, matching_status, scheduled_start_at)
  values ('${id}', '${homeowner}', '${providers[0].contractor}', 'house-cleaning', 'Synthetic waiver', '33901', 'house-cleaning', 'matched', now() + interval '50 hours');
insert into public.request_quotes(id, request_id, revision, amount, sender_id, reason, status, decision_actor, decided_at)
  values ('${quote}', '${id}', 1, 117, '${operator}', 'Synthetic quote', 'accepted', '${homeowner}', now());
update public.service_requests set status = 'scheduled', current_quote_id = '${quote}', quote_revision = 1, quote_status = 'accepted' where id = '${id}';
create temporary table terms on commit drop as select jsonb_build_object('service', 10000, 'addons', 0, 'discount', 0, 'adjustment', 0, 'subtotal', 10000,
  'tax', 700, 'tip', 1000, 'deposit', 0, 'total', 11700, 'currency', 'usd', 'source_version', private.money_source('${id}')->>'version',
  'policy_version', 'CFG-005', 'tax_evidence', 'synthetic', 'reason', 'synthetic', 'expires_at', now() + interval '1 day') as value;
do $$ begin ${claims(reviewer)}
  perform public.money_approve_review('${operator}', jsonb_build_object('operation', 'snapshot', 'request', '${id}', 'terms', (select value from terms)), 'Synthetic separate approval'); end $$;
select public.money_publish_snapshot('${id}', (select value from terms), '${operator}', '${reviewer}');
commit;`);
  const attempt = await sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}', 'full')).id`));
  const payment = `pi_${attempt.replaceAll('-', '')}`;
  const event = `evt_${randomUUID().replaceAll('-', '')}`;
  await sql(`select public.money_receive_event('${event}', 'capture', '${JSON.stringify({ attempt_id: attempt, payment_id: payment, amount: 11700, currency: 'usd' })}')`);
  await sql(`select public.money_process_event('${event}')`);
  const operation = (await json(op(homeowner, id, 'customer_cancel'))).operation_id;
  assert.equal(await sql(`select policy_assessment->>'refund_percent' from public.job_operations where id = '${operation}'`), '50');
  const plan = await json(sql(`select public.money_preview_cancellation_refund('${operation}', '${payment}', '${operator}')`));
  await sql(`begin; do $$ begin ${claims(reviewer)}
    perform public.money_approve_review('${operator}', jsonb_build_object('operation', 'refund', 'obligation', '${plan.obligation_id}', 'payment', '${payment}',
      'service', ${plan.service}, 'tax', ${plan.tax}, 'tip', ${plan.tip}, 'key', '${plan.business_key}', 'policy', '${plan.policy_evidence}',
      'reason', 'Synthetic cancellation refund'), 'Synthetic second approval'); end $$; commit;`);
  const expected = (await json(sql(as(operator, `select public.admin_waiver_preview('${operation}')`)))).expected;
  const waive = (who, key) => sql(as(who, `select public.admin_record_waiver_adjustment('${operation}', '${key}', 'Synthetic storm', ${lit(expected)})`));
  const key = randomUUID();
  const waivers = () => [waive(operator, key), waive(operator, key), waive(operator, key), waive(reviewer, randomUUID())];
  const authorize = () => sql(`select public.money_authorize_cancellation_refund('${operation}', '${payment}', '${operator}', '${reviewer}', 'Synthetic cancellation refund')`);
  // Iterations 0 and 1 force each order; the rest race.
  const results = i === 0 ? await (async () => { const a = await settled([authorize()]); return [...await settled(waivers()), a[0]]; })()
    : i === 1 ? await (async () => { const w = await settled(waivers()); return [...w, ...await settled([authorize()])]; })()
      : await settled([...waivers(), authorize()]);
  assert.equal(results[4].status, 'fulfilled', 'R7: the original refund authorization is unaffected by the waiver');
  const count = () => sql(`select count(*) from public.job_operation_adjustments where operation_id = '${operation}'`);
  const first = await count();
  assert.ok(first === '0' || first === '1', 'R7: at most one waiver from one read');
  for (const r of rejected(results.slice(0, 4))) assert.match(r.reason.message, /Refunds changed since you loaded this|already accepted/, 'R7: losers are stale or duplicates');
  if (first === '0') assert.equal(rejected(results.slice(0, 4)).length, 4, 'R7: the authorization came first, so every waiver read is stale');
  r7orders.add(first === '1' ? 'waiver-first' : 'authorization-first');
  const fresh = (await json(sql(as(operator, `select public.admin_waiver_preview('${operation}')`)))).expected;
  const retry = await settled([...Array.from({ length: 3 }, () => sql(as(operator, `select public.admin_record_waiver_adjustment('${operation}', '${key}', 'Synthetic storm', ${lit(fresh)})`))),
    sql(as(reviewer, `select public.admin_record_waiver_adjustment('${operation}', '${randomUUID()}', 'Synthetic storm', ${lit(fresh)})`))]);
  assert.equal(await count(), '1', 'R7: one waiver');
  assert.ok(rejected(retry).every((r) => /already accepted|reused with different intent/.test(r.reason.message)), 'R7: a second waiver is refused');
  const outcome = await json(sql(as(homeowner, `select public.job_cancellation_outcome('${id}')`)));
  assert.equal(outcome.entitlement.refund_percent, 100); assert.equal(outcome.adjustment.original_percent, 50);
  assert.equal(outcome.authorization.amount, 5850, 'R7: the original 50% authorization stands');
  assert.deepEqual(outcome.remaining, { state: 'supplemental_review', amount: 5850 }, 'R7: the rest awaits its own review');
  assert.equal(await sql(`select count(*) from public.money_refund_authorizations a join public.money_obligations o on o.id = a.obligation_id where o.service_request_id = '${id}'`), '1',
    'R7: the waiver authorizes no refund');
}

// R8: the homeowner's stop request ∥ Stop future visits ∥ visit cancellation ∥ a retried request.
for (let i = 0; i < 3; i += 1) {
  const plan = randomUUID(), visit = randomUUID(), key = randomUUID();
  await sql(`insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency, scheduled_start_at)
    values ('${plan}', '${homeowner}', '${providers[0].contractor}', 'Synthetic plan', 'Synthetic', 'scheduled', 'matched', 'weekly', now() + interval '100 hours');
  insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency, scheduled_start_at, recurrence_parent_id, occurrence_key)
    values ('${visit}', '${homeowner}', '${providers[0].contractor}', 'Synthetic visit', 'Synthetic', 'scheduled', 'matched', 'weekly', now() + interval '100 hours', '${plan}', '${randomUUID()}');`);
  const ask = () => sql(as(homeowner, `select public.homeowner_request_plan_stop('${plan}', '${key}', 'Synthetic move')`));
  const results = await settled([ask(), ask(), sql(as(operator, `select public.admin_set_recurring_plan_state('${plan}', '${randomUUID()}', 'stop', 'active', 'Synthetic stop')`)),
    op(homeowner, visit, 'customer_cancel')]);
  assert.equal(results[2].status, 'fulfilled', 'R8: Stop future visits applies');
  assert.equal(results[3].status, 'fulfilled', 'R8: the visit is cancelled on its own');
  const rows = await sql(`select count(*) from public.recurring_plan_stop_requests where series_id = '${plan}'`);
  assert.ok(rows === '0' || rows === '1', 'R8: at most one request');
  for (const r of results.slice(0, 2)) if (r.status === 'rejected') assert.match(r.reason.message, /already stopped/, 'R8: a request after stopping is refused');
  if (rows === '1') {
    const state = (await json(sql(as(homeowner, `select public.recurring_plan_stop_preview('${plan}')`)))).request.state;
    assert.equal(state, 'stopped', 'R8: a request before the stop reads as stopped');
  }
  assert.equal((await request(plan)).status, 'scheduled', 'R8: the plan row is never cancelled');
  assert.equal(await sql(`select private.recurring_plan_state('${plan}')`), 'ended');
}

assert.equal(r7orders.size, 2, 'R7: both orders exercised');
console.log(`exception resolutions concurrency: R1–R8 passed (R7 orders: ${[...r7orders].join(', ')})`);
