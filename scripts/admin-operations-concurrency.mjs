// TRACE-136: concurrent admin commands on separate connections (migration 20261108001000).
// A1 two admins change the same request status from the same observed version: one applies, one
// is refused 40001. A2 one key sent twice at once: one transition, both answers equal. A3 two
// admins correct the same unbound request from one read: one applies. A4 two badge changes from
// one read: one applies. A5 one operator note key sent twice at once: one row. A6 summary read ∥
// status change: the summary count still equals its queue. A7 two admins send the same key at once:
// one applies, the other is refused as a different actor (22023), never replayed. A8 one Package
// Review clearance key sent twice at once: one clearance, one replay, one vendor-visible history
// row. A9 (A1-F01) a lifecycle command already holding the request's advisory lock (provider start)
// while an admin status change on the same request is in flight: the admin change must wait for the
// advisory lock before it locks the row. Before 20261119001000 the admin command held the row and then
// waited for the advisory lock, and one of the two was aborted with a deadlock (40P01). Now the start
// applies and the admin change is refused as stale (40001); never a deadlock. Run only against a disposable local
// database; fixtures are synthetic with fresh ids and are left in place (reset before delivery).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.ADMIN_OPS_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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
const settled = (promises) => Promise.allSettled(promises);
const fulfilled = (results) => results.filter((result) => result.status === 'fulfilled');
const rejected = (results) => results.filter((result) => result.status === 'rejected');
const sqlstate = (result) => /40001|changed since you opened/.test(String(result.reason?.message)) ? '40001' : String(result.reason?.message);

const adminA = randomUUID(), adminB = randomUUID(), homeowner = randomUUID(), contractor = randomUUID();
await sql(`begin;
insert into auth.users(id, raw_user_meta_data) values ('${adminA}', '{}'), ('${adminB}', '{}'), ('${homeowner}', '{}');
insert into public.user_roles(user_id, role) values ('${adminA}', 'admin'), ('${adminB}', 'admin'), ('${homeowner}', 'homeowner') on conflict do nothing;
insert into public.contractors(id, name, is_active) values ('${contractor}', 'Synthetic admin-ops provider', true);
commit;`);

async function request(withProvider) {
  const id = randomUUID();
  await sql(`insert into public.service_requests(id, customer_id, contractor_id, service_type, address, city, state, zip_code, matching_status)
    values ('${id}', '${homeowner}', ${withProvider ? `'${contractor}'` : 'null'}, 'house-cleaning', '1 Synthetic Way', 'Fort Myers', 'FL', '33901', ${withProvider ? "'matched'" : "'awaiting_match'"});`);
  const version = await sql(`select updated_at from public.service_requests where id = '${id}'`);
  return { id, version };
}
const transition = (who, req, key, to = 'matched') => sql(as(who,
  `select public.admin_transition_job_status_expected('${req.id}', '${req.version}', '${key}', '${to}', 'Synthetic concurrent change')`));

// A1
{
  const req = await request(true);
  const results = await settled([transition(adminA, req, randomUUID()), transition(adminB, req, randomUUID())]);
  assert.equal(fulfilled(results).length, 1, 'A1: exactly one status change applies');
  assert.equal(sqlstate(rejected(results)[0]), '40001', 'A1: the other is refused as stale');
  assert.equal(await sql(`select count(*) from private.admin_request_actions where request_id = '${req.id}'`), '1', 'A1: one history row');
  console.log('A1 ok: one applied, one 40001');
}
// A2
{
  const req = await request(true), key = randomUUID();
  const results = await settled([transition(adminA, req, key), transition(adminA, req, key)]);
  assert.equal(fulfilled(results).length, 2, 'A2: both answers succeed');
  const answers = fulfilled(results).map((result) => JSON.parse(result.value));
  assert.equal(answers.filter((answer) => answer.replayed).length, 1, 'A2: one answer is the replay');
  assert.equal(answers[0].status, answers[1].status, 'A2: same outcome');
  assert.equal(await sql(`select count(*) from private.admin_request_actions where request_key = '${key}'`), '1', 'A2: one action');
  console.log('A2 ok: one transition, one replay');
}
// A3
{
  const req = await request(false);
  const correct = (who, address) => sql(as(who, `select public.admin_correct_request_details('${req.id}', '${req.version}', '${randomUUID()}',
    '${address}', 'Fort Myers', 'FL', '33901', 'Synthetic scope', 'Synthetic correction')`));
  const results = await settled([correct(adminA, '2 Synthetic Way'), correct(adminB, '3 Synthetic Way')]);
  assert.equal(fulfilled(results).length, 1, 'A3: one correction applies');
  assert.equal(sqlstate(rejected(results)[0]), '40001', 'A3: the other is refused as stale');
  console.log('A3 ok: one correction, one 40001');
}
// A4
{
  const badge = (who, badges) => sql(as(who, `select public.admin_set_provider_badges('${contractor}', '{}', array[${badges.map((b) => `'${b}'`).join(',')}], 'Synthetic badge review', '${randomUUID()}')`));
  const results = await settled([badge(adminA, ['Licensed']), badge(adminB, ['Insured'])]);
  assert.equal(fulfilled(results).length, 1, 'A4: one badge change applies');
  assert.equal(sqlstate(rejected(results)[0]), '40001', 'A4: the other is refused as stale');
  assert.equal(await sql(`select count(*) from private.provider_badge_events where contractor_id = '${contractor}'`), '1', 'A4: one history row');
  console.log('A4 ok: one badge change, one 40001');
}
// A5
{
  const req = await request(true), key = randomUUID();
  const note = () => sql(as(adminA, `select public.admin_add_request_note('${req.id}', '${key}', 'Synthetic operator note')`));
  const results = await settled([note(), note()]);
  assert.equal(fulfilled(results).length, 2, 'A5: both answers succeed');
  assert.equal(await sql(`select count(*) from private.request_operator_notes where request_key = '${key}'`), '1', 'A5: one note');
  console.log('A5 ok: one note, one replay');
}
// A6
{
  const req = await request(true);
  const [summary] = await Promise.all([
    sql(as(adminB, `select json_build_object('summary', (select (q->>'count')::int from jsonb_array_elements(public.admin_operations_summary()->'queues') q where q->>'queue' = 'fulfillment'),
      'queue', jsonb_array_length(public.admin_fulfillment_queue()->'items'))`)),
    transition(adminA, req, randomUUID()),
  ]);
  const parsed = JSON.parse(summary);
  assert.equal(parsed.summary, parsed.queue, 'A6: summary equals its queue within one transaction');
  console.log('A6 ok: summary parity under a concurrent change');
}
// A7
{
  const req = await request(true), key = randomUUID();
  const results = await settled([transition(adminA, req, key), transition(adminB, req, key)]);
  assert.equal(fulfilled(results).length, 1, 'A7: one admin\'s change applies');
  assert.match(String(rejected(results)[0].reason?.message), /already used for a different action/, 'A7: the other actor is refused, not replayed');
  assert.equal(await sql(`select count(*) from private.admin_request_actions where request_key = '${key}'`), '1', 'A7: one action');
  console.log('A7 ok: same key, different actor refused');
}
// A8
{
  const pkg = randomUUID(), key = randomUUID();
  await sql(`insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, is_active, needs_review)
    values ('${pkg}', '${contractor}', 'house-cleaning', 'Synthetic review package', 'custom_quote', false, true);
    update public.vendor_packages set needs_review = true where id = '${pkg}';`);
  const version = await sql(`select updated_at from public.vendor_packages where id = '${pkg}'`);
  const clear = () => sql(as(adminA, `select public.admin_clear_package_review('${pkg}', '${version}', 'Synthetic review', '${key}')`));
  const results = await settled([clear(), clear()]);
  assert.equal(fulfilled(results).length, 2, 'A8: both answers succeed');
  assert.equal(fulfilled(results).map((result) => JSON.parse(result.value)).filter((answer) => answer.replayed).length, 1, 'A8: one answer is the replay');
  assert.equal(await sql(`select count(*) from private.vendor_package_price_corrections where package_id = '${pkg}'`), '1', 'A8: one vendor-visible history row');
  console.log('A8 ok: one clearance, one replay');
}
// A9 (A1-F01): deterministic. Session B, the assigned provider, takes the request's advisory lock first
// (as start_job's first statement does) and holds it. The admin change is sent and observed waiting on
// that advisory lock. B then calls the real start_job, which needs the row.
{
  const vendorUser = randomUUID(), vendorContractor = randomUUID(), job = randomUUID(), key = randomUUID();
  await sql(`begin;
    insert into auth.users(id, raw_user_meta_data) values ('${vendorUser}', '{}');
    insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor') on conflict do nothing;
    insert into public.contractors(id, user_id, name, is_active) values ('${vendorContractor}', '${vendorUser}', 'Synthetic A9 provider', true);
    insert into public.service_requests(id, customer_id, contractor_id, service_type, address, city, state, zip_code, frequency, status, matching_status)
      values ('${job}', '${homeowner}', '${vendorContractor}', 'house-cleaning', '1 Synthetic Way', 'Fort Myers', 'FL', '33901', 'one-time', 'scheduled', 'matched');
    commit;`);
  const version = await sql(`select updated_at from public.service_requests where id = '${job}'`);
  const lockKey = `hashtextextended('${job}', 0)`;
  const advisory = (granted) => `select count(*) from pg_locks where locktype = 'advisory' and ${granted ? '' : 'not '}granted
    and classid::bigint = ((${lockKey}) >> 32) & 4294967295 and objid::bigint = (${lockKey}) & 4294967295`;
  const until = async (query, label) => {
    for (let i = 0; i < 200; i += 1) {
      if ((await sql(query)) === '1') return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`A9: timed out waiting for ${label}`);
  };
  const lifecycle = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let lifecycleOut = '', lifecycleErr = '';
  lifecycle.stdout.on('data', (chunk) => { lifecycleOut += chunk; });
  lifecycle.stderr.on('data', (chunk) => { lifecycleErr += chunk; });
  const lifecycleDone = new Promise((resolve) => lifecycle.on('close', resolve));
  lifecycle.stdin.write(`begin; set local role authenticated;
    set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: vendorUser })}';
    select pg_advisory_xact_lock(${lockKey});\n`);
  await until(advisory(true), 'the provider to hold the advisory lock');
  const admin = sql(as(adminA, `select public.admin_transition_job_status_expected('${job}', '${version}', '${key}', 'cancelled', 'Synthetic A9 status change')`))
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: String(error.message) }));
  await until(advisory(false), 'the admin change to wait on the advisory lock');
  lifecycle.stdin.end(`select public.start_job('${job}', '${randomUUID()}', null)::text; commit;\n`);
  const lifecycleCode = await lifecycleDone;
  const adminResult = await admin;
  const deadlock = /deadlock detected|40P01/;
  assert.ok(!deadlock.test(lifecycleErr) && !deadlock.test(adminResult.message ?? ''),
    `A9: no deadlock (provider: ${lifecycleErr.trim() || 'ok'}; admin: ${adminResult.message ?? 'applied'})`);
  assert.equal(lifecycleCode, 0, `A9: the provider's start applies (${lifecycleErr.trim()})`);
  assert.match(lifecycleOut, /"outcome": ?"started"/, 'A9: the start is recorded');
  assert.equal(adminResult.ok, false, 'A9: the admin change, read before the start, is not applied');
  assert.equal(sqlstate(adminResult.message ? { reason: { message: adminResult.message } } : {}), '40001', 'A9: the admin change is refused as stale');
  assert.equal(await sql(`select status from public.service_requests where id = '${job}'`), 'in_progress', 'A9: the request is in progress');
  assert.equal(await sql(`select count(*) from private.admin_request_actions where request_key = '${key}'`), '0', 'A9: no admin history row for the refused change');
  console.log('A9 ok: start applied, admin change 40001, no deadlock');
}
console.log('admin operations concurrency: 9/9 scenarios passed');
