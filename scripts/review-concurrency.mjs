// TRACE-130: concurrent review commands on separate connections. Two different reviews of the same
// service at once record exactly one; the same review sent repeatedly (a double click or a retried
// lost response) records once and every retry returns it; two corrections or two operators'
// decisions from the same read apply once, the other refused as stale; a repeated appeal opens one
// ticket. Run only against a disposable local or isolated database with 20261031001000 applied.
// Synthetic fixtures only; they are removed at the end (history is append-only, so cleanup
// bypasses triggers as postgres).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = process.env.REVIEW_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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

const homeowner = 'c9910000-0000-4000-8000-000000000001';
const vendorUser = 'c9910000-0000-4000-8000-000000000002';
const operators = [3, 4, 5].map((n) => `c9910000-0000-4000-8000-00000000000${n}`);
const contractor = 'c9920000-0000-4000-8000-000000000001';
const job = (n) => `c9930000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const reviewOf = (n) => sql(`select id from public.reviews where service_request_id='${job(n)}'`);
const submit = (n, rating, comment) => as(homeowner, `select public.submit_job_review('${job(n)}', ${rating}, '${comment}')`);
const count = (from) => sql(`select count(*) from ${from}`);

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from public.review_history where review_id in (select id from public.reviews where service_request_id::text like 'c9930000-%');
    delete from public.reviews where service_request_id::text like 'c9930000-%';
    delete from public.support_tickets where job_id like 'c9930000-%';
    delete from public.notifications where related_request_id::text like 'c9930000-%';
    delete from public.loyalty_transactions where user_id::text like 'c9910000-%';
    delete from public.loyalty_accounts where user_id::text like 'c9910000-%';
    delete from public.job_events where job_id::text like 'c9930000-%';
    delete from public.job_status_rejections where job_id::text like 'c9930000-%';
    delete from public.service_requests where id::text like 'c9930000-%';
    delete from public.contractors where id = '${contractor}';
    delete from public.user_roles where user_id::text like 'c9910000-%';
    delete from public.profiles where user_id::text like 'c9910000-%';
    delete from auth.users where id::text like 'c9910000-%';
    set session_replication_role = origin;`);
}

// Jobs 1–10: completed services the homeowner has confirmed.
await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9910000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic review"}' from generate_series(1, 5) n;
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9910000-0000-4000-8000-00000000000' || n)::uuid, 'admin' from generate_series(3, 5) n;
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic review provider', true, true);
  insert into public.service_requests(id, customer_id, service_type, address, frequency, zip_code, contractor_id)
    select ('c9930000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${homeowner}', 'Synthetic service', 'Synthetic address', 'one-time', '00000',
      '${contractor}' from generate_series(1, 10) n;
  update public.service_requests set status = 'vendor_completed', vendor_completed_at = now() where id::text like 'c9930000-%';
  update public.service_requests set status = 'completed', homeowner_confirmed_at = now() where id::text like 'c9930000-%';`);

try {
  // 1. Two different reviews of the same service at once: exactly one is recorded.
  for (let n = 1; n <= 4; n += 1) {
    const results = await Promise.allSettled([sql(submit(n, 2, 'Synthetic first')), sql(submit(n, 5, 'Synthetic second'))]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, `job ${n}: exactly one review`);
    assert.match(results.find((result) => result.status === 'rejected').reason.message, /already has a review/, `job ${n}: the other is a duplicate`);
    assert.equal(await count(`public.reviews where service_request_id='${job(n)}'`), '1');
    assert.equal(await sql(`select status from public.service_requests where id='${job(n)}'`), 'reviewed');
  }

  // 2. The same review sent six times at once records one and every retry returns it.
  const repeated = await Promise.allSettled(Array.from({ length: 6 }, () => sql(submit(5, 4, 'Synthetic retried'))));
  assert.equal(repeated.filter((result) => result.status === 'fulfilled').length, 6, 'every retry returns the recorded review');
  assert.equal(new Set(repeated.map((result) => result.value)).size, 1, 'one review id');
  assert.equal(await count(`public.reviews where service_request_id='${job(5)}'`), '1');
  assert.equal(await count(`public.job_events where job_id='${job(5)}' and metadata->>'to'='reviewed'`), '1');

  // 3. Two corrections from the same read: one applies, the other is stale.
  const corrected = await reviewOf(5);
  const edits = await Promise.allSettled([3, 2].map((rating) => sql(as(homeowner,
    `select public.revise_job_review('${corrected}', ${rating}, 'Synthetic edit ${rating}', 'Synthetic tab ${rating}', 0)`))));
  assert.equal(edits.filter((result) => result.status === 'fulfilled').length, 1, 'one correction');
  assert.match(edits.find((result) => result.status === 'rejected').reason.message, /changed since you opened it/);
  assert.equal(await sql(`select revision from public.reviews where id='${corrected}'`), '1');
  assert.equal(await count(`public.review_history where review_id='${corrected}' and action='corrected'`), '1');

  // 4. Three operators decide the same review from the same read: one decision.
  const moderated = await reviewOf(1);
  const decisions = await Promise.allSettled(operators.map((operator, i) => sql(as(operator,
    `select public.moderate_job_review('${moderated}', '${i === 0 ? 'held_for_moderation' : 'rejected'}', 'Synthetic operator ${i}', 'spam', 0)`))));
  assert.equal(decisions.filter((result) => result.status === 'fulfilled').length, 1, 'one decision');
  for (const lost of decisions.filter((result) => result.status === 'rejected')) {
    assert.match(lost.reason.message, /Another moderation decision was recorded/, 'the others are refused as stale');
  }
  assert.equal(await sql(`select moderation_version from public.reviews where id='${moderated}'`), '1');
  assert.equal(await count(`public.review_history where review_id='${moderated}'`), '1');

  // 5. The same appeal sent five times at once opens one ticket and every retry returns it.
  const appeals = await Promise.allSettled(Array.from({ length: 5 }, () => sql(as(homeowner,
    `select public.appeal_job_review('${moderated}', 'Synthetic appeal')`))));
  assert.equal(appeals.filter((result) => result.status === 'fulfilled').length, 5, 'every retry returns the appeal');
  assert.equal(new Set(appeals.map((result) => result.value)).size, 1, 'one ticket id');
  assert.equal(await count(`public.support_tickets where job_id='${job(1)}' and issue_type='review_appeal'`), '1');
  assert.equal(await sql(`select moderation_state from public.reviews where id='${moderated}'`), 'appealed');

  // 6. An author's correction racing an operator's decision: both apply in some order, and the
  // history keeps both steps with the original content.
  const raced = await reviewOf(2);
  const both = await Promise.allSettled([
    sql(as(homeowner, `select public.revise_job_review('${raced}', 3, 'Synthetic corrected', 'Synthetic fix', 0)`)),
    sql(as(operators[0], `select public.moderate_job_review('${raced}', 'held_for_moderation', 'Synthetic hold', 'unrelated_to_service', 0)`)),
  ]);
  assert.equal(both.filter((result) => result.status === 'fulfilled').length, 2, 'both commands apply');
  assert.equal(await sql(`select rating || '/' || moderation_state || '/' || revision || '/' || moderation_version from public.reviews where id='${raced}'`),
    '3/held_for_moderation/1/1');
  assert.equal(await count(`public.review_history where review_id='${raced}'`), '2');
  assert.equal(await sql(`select count(*) from public.public_review_summaries(array['${contractor}'::uuid]) where review_count = 3`), '1',
    'held, rejected and appealed reviews stay out of the aggregate');

  console.log('review concurrency: 6 scenarios passed');
} finally {
  await cleanup();
}
