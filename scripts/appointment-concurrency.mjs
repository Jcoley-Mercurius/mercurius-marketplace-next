// TRACE-121: concurrent appointment saves on separate connections. Operators racing from the
// same read get exactly one save and stale refusals for the rest; the same key sent in parallel
// (a double click or a retried lost response) records once. Run only against a disposable
// local or isolated database with 20261024002000 applied. Synthetic fixtures only; they are
// removed at the end (history rows are immutable, so cleanup bypasses triggers as postgres).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.APPOINTMENT_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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

const homeowner = 'c9210000-0000-4000-8000-000000000001';
const vendorUser = 'c9210000-0000-4000-8000-000000000002';
const operators = [3, 4, 5, 6, 7].map((n) => `c9210000-0000-4000-8000-00000000000${n}`);
const contractor = 'c9220000-0000-4000-8000-000000000001';
const job = (n) => `c9230000-0000-4000-8000-00000000000${n}`;
// Eastern wall times on future days; the server checks the instant against them.
const local = (days, time) => `((now() at time zone 'America/New_York')::date + ${days} + time '${time}')`;
const call = (jobId, key, days, time, expected, reason) => `select public.admin_record_appointment('${jobId}','${key}',
  ${local(days, time)} at time zone 'America/New_York', ${local(days, time)}, ${expected}, '${reason}')`;

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from public.job_events where job_id::text like 'c9230000-%';
    delete from public.notifications where related_request_id::text like 'c9230000-%';
    delete from public.job_operations where job_id::text like 'c9230000-%';
    delete from public.job_visits where service_request_id::text like 'c9230000-%';
    delete from public.service_requests where id::text like 'c9230000-%';
    delete from public.contractors where id = '${contractor}';
    delete from public.user_roles where user_id::text like 'c9210000-%';
    -- replica mode skips cascades, so rows that would follow the users are removed explicitly.
    delete from public.profiles where user_id::text like 'c9210000-%';
    delete from auth.users where id::text like 'c9210000-%';
    set session_replication_role = origin;`);
}

await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9210000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic concurrency"}' from generate_series(1, 7) n;
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9210000-0000-4000-8000-00000000000' || n)::uuid, 'admin' from generate_series(3, 7) n;
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic concurrency provider', true, true);
  insert into public.service_requests(id, customer_id, service_type, address, frequency, zip_code, status, matching_status, contractor_id)
    select ('c9230000-0000-4000-8000-00000000000' || n)::uuid, '${homeowner}', 'Synthetic service', 'Synthetic address', 'one-time', '00000',
      'scheduled', 'matched', '${contractor}' from generate_series(1, 3) n;`);

try {
  // 1. Five operators record different first appointments from the same (empty) read.
  const race = await Promise.allSettled(operators.map((operator, i) => sql(as(operator, call(job(1), randomUUID(), 10 + i, '09:00', 'null', `Operator ${i}`)))));
  const won = race.filter((result) => result.status === 'fulfilled');
  assert.equal(won.length, 1, 'exactly one first appointment');
  for (const lost of race.filter((result) => result.status === 'rejected')) {
    assert.match(lost.reason.message, /The appointment changed since you loaded it/, 'losers are refused as stale');
  }
  assert.equal(await sql(`select count(*) from public.job_operations where job_id='${job(1)}'`), '1');
  assert.equal(await sql(`select count(*) from public.notifications where related_request_id='${job(1)}'`), '2');

  // 2. The same key and intent sent eight times at once records once.
  const key = randomUUID();
  const repeated = await Promise.allSettled(Array.from({ length: 8 }, () => sql(as(operators[0], call(job(2), key, 12, '14:30', 'null', 'Double click')))));
  assert.equal(repeated.filter((result) => result.status === 'fulfilled').length, 8, 'every retry returns the recorded result');
  assert.equal(await sql(`select count(*) from public.job_operations where job_id='${job(2)}'`), '1');
  assert.equal(await sql(`select count(*) from public.notifications where related_request_id='${job(2)}'`), '2');

  // 3. Changes racing from the same current appointment: one wins; history keeps both values.
  await sql(as(operators[0], call(job(3), randomUUID(), 10, '09:00', 'null', 'First')));
  const current = `(select scheduled_start_at from public.service_requests where id='${job(3)}')`;
  const expected = await sql(`select ${current}`);
  const changes = await Promise.allSettled(operators.map((operator, i) => sql(as(operator, call(job(3), randomUUID(), 20 + i, '11:00', `'${expected}'::timestamptz`, `Change ${i}`)))));
  assert.equal(changes.filter((result) => result.status === 'fulfilled').length, 1, 'exactly one change from the same read');
  assert.equal(await sql(`select count(*) from public.job_operations where job_id='${job(3)}'`), '2');
  assert.equal(await sql(`select (policy_assessment->>'previous_start')::timestamptz = '${expected}'::timestamptz and (policy_assessment->>'new_start')::timestamptz = ${current}
    from public.job_operations where job_id='${job(3)}' order by seq desc limit 1`), 't', 'the change records old and new values');
  console.log('PASS: racing operators record one appointment and refuse the rest as stale; parallel retries record once; history keeps old and new values.');
} finally {
  await cleanup();
}
