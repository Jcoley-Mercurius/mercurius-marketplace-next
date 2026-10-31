// TRACE-131: concurrent exception commands on separate connections, against the real checkout,
// capture, refund and plan paths. C1 cancellation ∥ checkout preparation; C2 cancellation ∥ capture;
// C3 one key repeated; C4 two keys from one read; C5 homeowner cancellation ∥ provider withdrawal;
// C6 homeowner cancellation ∥ no-replacement decision; C7 cancellation refund authorization and
// settlement ∥ outcome readbacks; C8 visit cancellation ∥ Stop future visits ∥ plan-row cancellation.
// Run only against a disposable local or isolated database with 20261101001000 applied. Fixtures are
// synthetic, use fresh ids each run and are left in place (money evidence is append-only); reset the
// database before delivery, as CI does.
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
const settled = (promises) => Promise.allSettled(promises);
const fulfilled = (results) => results.filter((result) => result.status === 'fulfilled');
const rejected = (results) => results.filter((result) => result.status === 'rejected');

for (let attempt = 0; ; attempt += 1) {
  try { assert.equal(await sql('select 1'), '1'); break; } catch (error) {
    if (attempt === 29) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const homeowner = randomUUID(), vendorUser = randomUUID(), operator = randomUUID(), reviewer = randomUUID();
const contractor = randomUUID();
await sql(`begin;
insert into auth.users(id, raw_user_meta_data) values ('${homeowner}', '{}'), ('${vendorUser}', '{}'), ('${operator}', '{}'), ('${reviewer}', '{}');
insert into public.user_roles(user_id, role) values ('${operator}', 'admin'), ('${reviewer}', 'admin'), ('${vendorUser}', 'vendor');
insert into public.money_authorities(user_id, granted_by, reason) values ('${operator}', '${reviewer}', 'synthetic'), ('${reviewer}', '${operator}', 'synthetic');
insert into public.contractors(id, user_id, name, is_active) values ('${contractor}', '${vendorUser}', 'Synthetic exceptions provider', true);
insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '33901', 'house-cleaning', '${reviewer}');
commit;`);

// A scheduled request with an accepted quote and a published two-person snapshot, ready for checkout.
async function payable() {
  const request = randomUUID(), quote = randomUUID();
  return sql(`begin;
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, zip_code, service_catalog_id, matching_status, scheduled_start_at)
  values ('${request}', '${homeowner}', '${contractor}', 'house-cleaning', 'Synthetic exceptions', '33901', 'house-cleaning', 'matched', now() + interval '100 hours');
insert into public.request_quotes(id, request_id, revision, amount, sender_id, reason, status, decision_actor, decided_at)
  values ('${quote}', '${request}', 1, 117, '${operator}', 'Synthetic quote', 'accepted', '${homeowner}', now());
update public.service_requests set status = 'scheduled', current_quote_id = '${quote}', quote_revision = 1, quote_status = 'accepted' where id = '${request}';
create temporary table terms on commit drop as select jsonb_build_object('service', 10000, 'addons', 0, 'discount', 0, 'adjustment', 0, 'subtotal', 10000,
  'tax', 700, 'tip', 1000, 'deposit', 0, 'total', 11700, 'currency', 'usd', 'source_version', private.money_source('${request}')->>'version',
  'policy_version', 'CFG-005', 'tax_evidence', 'synthetic', 'reason', 'synthetic', 'expires_at', now() + interval '1 day') as value;
do $$ begin ${claims(reviewer)}
  perform public.money_approve_review('${operator}', jsonb_build_object('operation', 'snapshot', 'request', '${request}', 'terms', (select value from terms)), 'Synthetic separate approval'); end $$;
select '${request}' || ':' || public.money_publish_snapshot('${request}', (select value from terms), '${operator}', '${reviewer}');
commit;`).then((line) => { const [id, snapshot] = line.split(':'); return { id, snapshot }; });
}
const prepare = (snapshot) => sql(as(homeowner, `select (public.money_prepare_checkout('${snapshot}', 'full')).id`));
const cancel = (request, key = randomUUID(), expected = null) => sql(as(homeowner,
  `select public.record_job_operation('${request}', '${key}', 'customer_cancel', 'Synthetic cancellation', null, false, ${expected ? `'${expected}'::jsonb` : 'null'})`));
const outcome = async (request, who = homeowner) => JSON.parse(await sql(as(who, `select public.job_cancellation_outcome('${request}')`)));
const preview = (request, who = homeowner, kind = 'customer_cancel') => sql(as(who, `select (public.job_cancellation_preview('${request}', '${kind}'))->'expected'`));
const capture = async (attempt, payment) => {
  const event = `evt_${randomUUID().replaceAll('-', '')}`;
  await sql(`select public.money_receive_event('${event}', 'capture', '${JSON.stringify({ attempt_id: attempt, payment_id: payment, amount: 11700, currency: 'usd' })}')`);
  return sql(`select public.money_process_event('${event}')`);
};
const status = (request) => sql(`select status from public.service_requests where id = '${request}'`);
const cancelRecord = (request) => sql(`select before_value->'commercial' from public.job_operations where job_id = '${request}' and kind = 'customer_cancel'`);

// C1: cancellation ∥ checkout preparation. The request lock orders them; the cancellation is always
// kept, and the record shows any attempt prepared first. No new collection starts afterwards.
const c1orders = new Set();
for (let i = 0; i < 4; i += 1) {
  const { id, snapshot } = await payable();
  // Iterations 0 and 1 force each order; the rest race.
  const [cancelled, prepared] = i === 0 ? [await settled([prepare(snapshot)]), await settled([cancel(id)])].map((r) => r[0]).reverse()
    : i === 1 ? [await settled([cancel(id)]), await settled([prepare(snapshot)])].map((r) => r[0])
      : await settled([cancel(id), prepare(snapshot)]);
  assert.equal(cancelled.status, 'fulfilled', 'C1: the cancellation is always kept');
  const record = JSON.parse(await cancelRecord(id));
  if (prepared.status === 'fulfilled') {
    c1orders.add('checkout-first');
    assert.ok(record.open_attempts.some((a) => a.id === prepared.value), 'C1: the open attempt is in the cancellation record');
    assert.ok((await outcome(id, operator)).follow_up.some((item) => item.code === 'checkout_open_after_cancellation'));
  } else {
    c1orders.add('cancel-first');
    assert.match(prepared.reason.message, /Commercial source changed/, 'C1: checkout after cancellation is refused');
    assert.equal(record.open_attempts.length, 0);
  }
  await assert.rejects(prepare(snapshot), /Commercial source changed/, 'C1: no new collection after cancellation');
}

// C2: cancellation ∥ capture of an open session. Both always apply; the funds are never lost and the
// readback says whether they arrived after the cancellation.
const c2orders = new Set();
for (let i = 0; i < 4; i += 1) {
  const { id, snapshot } = await payable();
  const attempt = await prepare(snapshot);
  await sql(`select public.money_attach_checkout('${attempt}', 'cs_${i}${attempt.slice(0, 8)}', 'https://checkout.stripe.com/c/pay/cs_${i}')`);
  const pay = () => capture(attempt, `pi_${attempt.replaceAll('-', '')}`);
  // Iterations 0 and 1 force each order; the rest race.
  const [cancelled, captured] = i === 0 ? [await settled([pay()]), await settled([cancel(id)])].map((r) => r[0]).reverse()
    : i === 1 ? [await settled([cancel(id)]), await settled([pay()])].map((r) => r[0])
      : await settled([cancel(id), pay()]);
  assert.equal(cancelled.status, 'fulfilled', 'C2: the cancellation is kept');
  assert.equal(captured.status, 'fulfilled'); assert.equal(captured.value, 'processed', 'C2: the capture is recorded');
  assert.equal(await status(id), 'cancelled');
  assert.equal(await sql(`select captured from public.money_obligations where service_request_id = '${id}'`), '11700');
  const record = JSON.parse(await cancelRecord(id));
  const result = await outcome(id, operator);
  assert.equal(result.entitlement.state, 'refund_due'); assert.equal(result.entitlement.amount, 11700, 'C2: the full payment is owed back');
  assert.notEqual(result.movement.state, 'settled', 'C2: nothing is reported as refunded');
  const late = result.follow_up.some((item) => item.code === 'payment_after_cancellation');
  assert.equal(late, record.captured === 0, 'C2: a payment after the cancellation is flagged exactly when it came after');
  c2orders.add(late ? 'cancel-first' : 'capture-first');
}

// C3: the same cancellation sent five times records once and every retry returns it.
{
  const { id } = await payable();
  const key = randomUUID();
  const results = await settled(Array.from({ length: 5 }, () => cancel(id, key)));
  assert.equal(fulfilled(results).length, 5, 'C3: every retry succeeds');
  assert.equal(new Set(results.map((r) => JSON.parse(r.value).operation_id)).size, 1, 'C3: one operation');
  assert.equal(await sql(`select count(*) from public.job_operations where job_id = '${id}'`), '1');
}

// C4: two cancellations from the same read: one applies, the other is stale.
{
  const { id } = await payable();
  const expected = await preview(id);
  const results = await settled([cancel(id, randomUUID(), expected), cancel(id, randomUUID(), expected)]);
  assert.equal(fulfilled(results).length, 1, 'C4: one cancellation');
  assert.match(rejected(results)[0].reason.message, /changed since you opened it/, 'C4: the other is stale');
}

// C5: homeowner cancellation ∥ provider withdrawal, both from their own fresh reads.
for (let i = 0; i < 3; i += 1) {
  const { id } = await payable();
  const [homeownerRead, providerRead] = await Promise.all([preview(id), preview(id, vendorUser, 'provider_cancel')]);
  const results = await settled([cancel(id, randomUUID(), homeownerRead),
    sql(as(vendorUser, `select public.record_job_operation('${id}', '${randomUUID()}', 'provider_cancel', 'Synthetic withdrawal', null, false, '${providerRead}'::jsonb)`))]);
  assert.equal(fulfilled(results).length, 1, 'C5: exactly one of the two applies');
  assert.match(rejected(results)[0].reason.message, /changed since you opened it|no longer accepts/, 'C5: the other is refused');
}

// C6: homeowner cancellation ∥ a repeated no-replacement decision after a provider withdrawal.
for (let i = 0; i < 3; i += 1) {
  const { id } = await payable();
  const operation = JSON.parse(await sql(as(vendorUser, `select public.record_job_operation('${id}', '${randomUUID()}', 'provider_cancel', 'Synthetic withdrawal')`))).operation_id;
  const key = randomUUID();
  const decide = () => sql(as(operator, `select (public.record_provider_replacement_decision('${operation}', '${key}', 'Synthetic no replacement')).outcome`));
  const results = await settled([cancel(id), decide(), decide()]);
  assert.equal(await status(id), 'cancelled', 'C6: the request ends cancelled once');
  const decisions = await sql(`select count(*) from public.money_provider_replacement_decisions where operation_id = '${operation}'`);
  const cancellations = await sql(`select count(*) from public.job_operations where job_id = '${id}' and kind = 'customer_cancel'`);
  assert.ok((decisions === '1' && cancellations === '0') || (decisions === '0' && cancellations === '1'), 'C6: one cancellation path wins');
  assert.equal((await outcome(id)).entitlement.refund_percent, 100, 'C6: either way the homeowner is owed 100%');
  assert.ok(rejected(results).every((r) => /no longer accepts|replacement decisions/.test(r.reason.message)), 'C6: losers are refused by state');
}

// C7: cancellation refund authorization (retried) and settlement ∥ outcome readbacks.
{
  const { id, snapshot } = await payable();
  const attempt = await prepare(snapshot);
  const payment = `pi_${attempt.replaceAll('-', '')}`;
  await capture(attempt, payment);
  const operation = JSON.parse(await cancel(id)).operation_id;
  const plan = JSON.parse(await sql(`select public.money_preview_cancellation_refund('${operation}', '${payment}', '${operator}')`));
  await sql(`begin; do $$ begin ${claims(reviewer)}
    perform public.money_approve_review('${operator}', jsonb_build_object('operation', 'refund', 'obligation', '${plan.obligation_id}', 'payment', '${payment}',
      'service', ${plan.service}, 'tax', ${plan.tax}, 'tip', ${plan.tip}, 'key', '${plan.business_key}', 'policy', '${plan.policy_evidence}',
      'reason', 'Synthetic cancellation refund'), 'Synthetic second approval'); end $$; commit;`);
  const authorize = () => sql(`select public.money_authorize_cancellation_refund('${operation}', '${payment}', '${operator}', '${reviewer}', 'Synthetic cancellation refund')`);
  const reads = () => Array.from({ length: 4 }, () => outcome(id));
  const first = await settled([authorize(), authorize(), authorize(), ...reads()]);
  const authorizations = new Set(first.slice(0, 3).filter((r) => r.status === 'fulfilled').map((r) => r.value));
  assert.equal(authorizations.size, 1, 'C7: one authorization for retried requests');
  for (const read of first.slice(3)) {
    assert.equal(read.status, 'fulfilled');
    assert.ok(['none', 'not_sent'].includes(read.value.movement.state), 'C7: before sending, nothing has moved');
  }
  const authorization = [...authorizations][0];
  await sql(`select public.money_prepare_refund('${authorization}', '${operator}')`);
  const refund = `re_${randomUUID().replaceAll('-', '')}`;
  await sql(`select public.money_record_refund_result('${authorization}', '${refund}', 'pending', 11700)`);
  const event = `evt_${randomUUID().replaceAll('-', '')}`;
  await sql(`select public.money_receive_event('${event}', 'refund', '${JSON.stringify({ authorization_id: authorization, amount: 11700, currency: 'usd', payment_id: payment, refund_id: refund })}')`);
  const second = await settled([sql(`select public.money_process_event('${event}')`), ...reads()]);
  assert.equal(second[0].value, 'processed');
  for (const read of second.slice(1)) assert.ok(['in_flight', 'settled'].includes(read.value.movement.state), 'C7: in flight or settled, nothing else');
  const final = await outcome(id);
  assert.equal(final.movement.state, 'settled'); assert.equal(final.movement.settled, 11700, 'C7: settled only with the provider refund recorded');
  assert.equal(await sql(`select count(*) from public.money_refunds where authorization_id = '${authorization}'`), '1');
}

// C8: visit cancellation ∥ Stop future visits ∥ plan-row cancellation.
{
  const plan = randomUUID(), visit = randomUUID();
  await sql(`insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency, scheduled_start_at)
    values ('${plan}', '${homeowner}', '${contractor}', 'Synthetic plan', 'Synthetic', 'scheduled', 'matched', 'weekly', now() + interval '100 hours');
  insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency, scheduled_start_at, recurrence_parent_id, occurrence_key)
    values ('${visit}', '${homeowner}', '${contractor}', 'Synthetic visit', 'Synthetic', 'scheduled', 'matched', 'weekly', now() + interval '100 hours', '${plan}', '${randomUUID()}');`);
  const results = await settled([cancel(visit),
    sql(as(operator, `select public.admin_set_recurring_plan_state('${plan}', '${randomUUID()}', 'stop', 'active', 'Synthetic stop')`)),
    cancel(plan)]);
  assert.equal(results[0].status, 'fulfilled', 'C8: the visit is cancelled on its own');
  assert.equal(results[1].status, 'fulfilled', 'C8: Stop future visits applies');
  assert.equal(results[2].status, 'rejected'); assert.match(results[2].reason.message, /Changes are made on each visit/, 'C8: the plan row refuses cancellation');
  assert.equal(await status(plan), 'scheduled', 'C8: the plan status is unchanged');
  assert.equal(await status(visit), 'cancelled');
  assert.equal(await sql(`select private.recurring_plan_state('${plan}')`), 'ended');
}

assert.equal(c1orders.size, 2, 'C1: both orders exercised'); assert.equal(c2orders.size, 2, 'C2: both orders exercised');
console.log(`exceptions concurrency: C1–C8 passed (C1 orders: ${[...c1orders].join(', ')}; C2 orders: ${[...c2orders].join(', ')})`);
