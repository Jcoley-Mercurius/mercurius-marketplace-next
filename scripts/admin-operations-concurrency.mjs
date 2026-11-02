// TRACE-136: concurrent admin commands on separate connections (migration 20261108001000).
// A1 two admins change the same request status from the same observed version: one applies, one
// is refused 40001. A2 one key sent twice at once: one transition, both answers equal. A3 two
// admins correct the same unbound request from one read: one applies. A4 two badge changes from
// one read: one applies. A5 one operator note key sent twice at once: one row. A6 summary read ∥
// status change: the summary count still equals its queue. Run only against a disposable local
// database; fixtures are synthetic with fresh ids and are left in place (reset before delivery).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.ADMIN_OPS_DB_CONTAINER ?? 'supabase_db_mercurius-marketplace-next';
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
console.log('admin operations concurrency: 6/6 scenarios passed');
