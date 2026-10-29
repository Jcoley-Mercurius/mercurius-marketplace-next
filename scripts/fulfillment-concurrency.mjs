// TRACE-128: concurrent fulfillment commands on separate connections. A homeowner's confirmation
// and dispute of the same completion, or a confirmation racing an operator's rework, produce
// exactly one effect; starts racing from the same read start the work once; the same key sent in
// parallel (a double click or a retried lost response) records once. Run only against a disposable
// local or isolated database with 20261029001000 applied. Synthetic fixtures only; they are removed
// at the end (receipts and history are immutable, so cleanup bypasses triggers as postgres).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.FULFILLMENT_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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

const homeowner = 'c9810000-0000-4000-8000-000000000001';
const vendorUser = 'c9810000-0000-4000-8000-000000000002';
const operators = [3, 4, 5].map((n) => `c9810000-0000-4000-8000-00000000000${n}`);
const contractor = 'c9820000-0000-4000-8000-000000000001';
const job = (n) => `c9830000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const completedAt = (id) => sql(`select vendor_completed_at from public.service_requests where id='${id}'`);
const confirm = (id, at) => as(homeowner, `select public.homeowner_confirm_completion('${id}','${at}')`);
const dispute = (id, at) => as(homeowner, `select public.homeowner_dispute_completion('${id}','${at}','Synthetic concurrent issue')`);
const start = (user, id, key, reason = null) => as(user, `select public.start_job('${id}','${key}',${reason ? `'${reason}'` : 'null'})`);
const count = (from) => sql(`select count(*) from ${from}`);

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from public.job_events where job_id::text like 'c9830000-%';
    delete from public.notifications where related_request_id::text like 'c9830000-%';
    delete from public.job_operations where job_id::text like 'c9830000-%';
    delete from public.job_completion_evidence where job_id::text like 'c9830000-%';
    delete from public.money_lifecycle_confirmations where request_id::text like 'c9830000-%';
    delete from public.disputes where job_id::text like 'c9830000-%';
    delete from public.support_tickets where job_id like 'c9830000-%';
    delete from public.job_status_rejections where job_id::text like 'c9830000-%';
    delete from storage.objects where bucket_id = 'job-photos' and name like 'c9810000-%';
    delete from public.service_requests where id::text like 'c9830000-%';
    delete from public.contractors where id = '${contractor}';
    delete from public.user_roles where user_id::text like 'c9810000-%';
    delete from public.profiles where user_id::text like 'c9810000-%';
    delete from auth.users where id::text like 'c9810000-%';
    set session_replication_role = origin;`);
}

// Jobs 1–20 are accepted one-time jobs. Jobs 1–14 are started and completed by the provider with
// one stored photo each (the baseline rule for a service without its own rule).
await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9810000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic fulfillment"}' from generate_series(1, 5) n;
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9810000-0000-4000-8000-00000000000' || n)::uuid, 'admin' from generate_series(3, 5) n;
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic fulfillment provider', true, true);
  insert into public.service_requests(id, customer_id, service_type, address, frequency, zip_code, status, matching_status, contractor_id)
    select ('c9830000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${homeowner}', 'Synthetic service', 'Synthetic address', 'one-time', '00000',
      'scheduled', 'matched', '${contractor}' from generate_series(1, 20) n;
  insert into storage.objects(bucket_id, name, owner)
    select 'job-photos', '${vendorUser}/c9830000-0000-4000-8000-' || lpad(n::text, 12, '0') || '/proof.png', '${vendorUser}' from generate_series(1, 14) n;`);
for (let n = 1; n <= 14; n += 1) {
  await sql(start(vendorUser, job(n), randomUUID()));
  await sql(as(vendorUser, `select public.vendor_complete_job('${job(n)}', array['${vendorUser}/${job(n)}/proof.png'])`));
}

try {
  // 1. Confirm and dispute of the same completion at once: exactly one decision, never both.
  for (let n = 1; n <= 8; n += 1) {
    const at = await completedAt(job(n));
    const [confirmed, disputed] = await Promise.allSettled([sql(confirm(job(n), at)), sql(dispute(job(n), at))]);
    assert.equal([confirmed, disputed].filter((result) => result.status === 'fulfilled').length, 1, `job ${n}: exactly one decision`);
    const loser = confirmed.status === 'rejected' ? confirmed : disputed;
    assert.match(loser.reason.message, /no longer waiting for your (confirmation|decision)/, `job ${n}: the other is refused as stale`);
    const receipts = await count(`public.money_lifecycle_confirmations where request_id='${job(n)}'`);
    const disputes = await count(`public.disputes where job_id='${job(n)}'`);
    assert.equal(receipts === '1' ? disputes : receipts, '0', `job ${n}: a receipt or a dispute, not both`);
    assert.equal(Number(receipts) + Number(disputes), 1, `job ${n}: one effect`);
    assert.equal(await sql(`select status from public.service_requests where id='${job(n)}'`), receipts === '1' ? 'completed' : 'disputed');
  }

  // 2. The same confirmation sent six times at once records one receipt.
  const at9 = await completedAt(job(9));
  const repeated = await Promise.allSettled(Array.from({ length: 6 }, () => sql(confirm(job(9), at9))));
  assert.equal(repeated.filter((result) => result.status === 'fulfilled').length, 6, 'every retry returns the recorded confirmation');
  assert.equal(await count(`public.money_lifecycle_confirmations where request_id='${job(9)}'`), '1');

  // 3. The homeowner confirms while an operator returns the job for rework: exactly one applies.
  for (let n = 10; n <= 13; n += 1) {
    const at = await completedAt(job(n));
    const [confirmed, rework] = await Promise.allSettled([sql(confirm(job(n), at)),
      sql(as(operators[0], `select public.transition_job_status('${job(n)}','in_progress','Synthetic rework')`))]);
    assert.equal([confirmed, rework].filter((result) => result.status === 'fulfilled').length, 1, `job ${n}: confirmation or rework, not both`);
    const status = await sql(`select status from public.service_requests where id='${job(n)}'`);
    assert.equal(status, confirmed.status === 'fulfilled' ? 'completed' : 'in_progress');
    assert.equal(await count(`public.money_lifecycle_confirmations where request_id='${job(n)}'`), confirmed.status === 'fulfilled' ? '1' : '0');
  }

  // 4. The provider and three operators start the same job from the same read: one start.
  const starts = await Promise.allSettled([sql(start(vendorUser, job(15), randomUUID())),
    ...operators.map((operator, i) => sql(start(operator, job(15), randomUUID(), `Synthetic operator ${i}`)))]);
  assert.equal(starts.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one start');
  for (const lost of starts.filter((result) => result.status === 'rejected')) {
    assert.match(lost.reason.message, /no longer waiting to start/, 'the others are refused as stale');
  }
  assert.equal(await count(`public.job_events where job_id='${job(15)}' and metadata->>'to'='in_progress'`), '1');

  // 5. The same start key sent eight times at once starts the work once.
  const key = randomUUID();
  const sameKey = await Promise.allSettled(Array.from({ length: 8 }, () => sql(start(vendorUser, job(16), key))));
  assert.equal(sameKey.filter((result) => result.status === 'fulfilled').length, 8, 'every retry returns the recorded start');
  assert.equal(await count(`public.job_events where job_id='${job(16)}' and metadata->>'to'='in_progress'`), '1');

  // 6. Operations record the same follow-up five times at once: one record.
  await sql(as(vendorUser, `select public.record_job_operation('${job(17)}','${randomUUID()}','unable_to_complete','Synthetic: gate locked')`));
  const followKey = randomUUID();
  const follow = await Promise.allSettled(Array.from({ length: 5 }, () => sql(as(operators[1],
    `select public.admin_record_fulfillment_follow_up('${job(17)}','${followKey}','fulfillment_exception','Synthetic: called both parties')`))));
  assert.equal(follow.filter((result) => result.status === 'fulfilled').length, 5, 'every retry returns the recorded follow-up');
  assert.equal(await count(`public.job_events where job_id='${job(17)}' and metadata->>'action'='fulfillment_follow_up'`), '1');

  console.log('fulfillment concurrency: 6 scenarios passed');
} finally {
  await cleanup();
}
