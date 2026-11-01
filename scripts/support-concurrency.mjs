// TRACE-133: concurrent support and dispute commands on separate connections. The same support
// request, reply or evidence sent repeatedly opens or records it once and every retry returns it;
// two operators triaging or deciding from the same read apply once, the other refused as stale; an
// appeal raced against a decision lands on exactly one version; a repeated appeal opens one ticket.
// Run only against a disposable local or isolated database with 20261103001000 applied. Synthetic
// fixtures only; they are removed at the end (history is append-only, so cleanup bypasses triggers
// as postgres).
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = process.env.SUPPORT_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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

const user = (n) => `c9a10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const homeowner = user(1);
const providerUser = user(2);
const operators = [3, 4, 5].map(user);
const contractor = 'c9a20000-0000-4000-8000-000000000001';
const job = (n) => `c9a30000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n) => `c9a70000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const count = (from) => sql(`select count(*) from ${from}`);
const stale = (results) => results.filter((r) => r.status === 'rejected' && /changed since/.test(r.reason.message)).length;

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from public.dispute_submissions where dispute_id in (select id from public.disputes where job_id::text like 'c9a30000-%');
    delete from public.dispute_decisions where dispute_id in (select id from public.disputes where job_id::text like 'c9a30000-%');
    delete from public.dispute_appeals where dispute_id in (select id from public.disputes where job_id::text like 'c9a30000-%');
    delete from public.disputes where job_id::text like 'c9a30000-%';
    delete from public.support_ticket_messages where author_id::text like 'c9a10000-%';
    delete from public.support_ticket_events where ticket_id in (select id from public.support_tickets where user_id::text like 'c9a10000-%');
    delete from public.support_tickets where user_id::text like 'c9a10000-%';
    delete from public.notifications where user_id::text like 'c9a10000-%';
    delete from public.job_events where job_id::text like 'c9a30000-%';
    delete from public.job_status_rejections where job_id::text like 'c9a30000-%';
    delete from public.service_requests where id::text like 'c9a30000-%';
    delete from public.contractors where id = '${contractor}';
    delete from public.user_roles where user_id::text like 'c9a10000-%';
    delete from public.profiles where user_id::text like 'c9a10000-%';
    delete from auth.users where id::text like 'c9a10000-%';
    set session_replication_role = origin;`);
}

// Jobs 1–6: services the provider completed an hour ago.
await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9a10000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '{"full_name":"Synthetic support"}' from generate_series(1, 5) n;
  insert into public.user_roles(user_id, role) values ('${providerUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9a10000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'admin' from generate_series(3, 5) n;
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${providerUser}', 'Synthetic support provider', true, true);
  insert into public.service_requests(id, customer_id, service_type, address, frequency, zip_code, contractor_id, status, vendor_completed_at)
    select ('c9a30000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${homeowner}', 'Synthetic service', 'Synthetic address', 'one-time', '00000',
      '${contractor}', 'vendor_completed', now() - interval '1 hour' from generate_series(1, 6) n;`);

try {
  // S1. The same support request sent eight times at once opens one ticket; every retry returns it.
  const open = await Promise.allSettled(Array.from({ length: 8 }, () =>
    sql(as(homeowner, `select public.open_support_ticket('${key(1)}', 'Synthetic question', 'Synthetic detail', '${job(1)}')->>'ticket_id'`))));
  assert.equal(open.filter((r) => r.status === 'fulfilled').length, 8, 'S1: every retry returns');
  assert.equal(new Set(open.map((r) => r.value)).size, 1, 'S1: one ticket id');
  assert.equal(await count(`public.support_tickets where opened_by='${homeowner}' and request_key='${key(1)}'`), '1');
  const ticket = open[0].value;

  // S2. The same reply sent six times records one message.
  const reply = await Promise.allSettled(Array.from({ length: 6 }, () =>
    sql(as(homeowner, `select public.post_support_message('${ticket}', '${key(2)}', 'Synthetic reply')->>'message_id'`))));
  assert.equal(reply.filter((r) => r.status === 'fulfilled').length, 6, 'S2: every retry returns');
  assert.equal(await count(`public.support_ticket_messages where ticket_id='${ticket}'`), '1', 'S2: one message');

  // S3. Three operators triage from the same read (version 0): one applies, two are stale.
  for (let round = 0; round < 4; round += 1) {
    const version = await sql(`select version from public.support_tickets where id='${ticket}'`);
    const status = round % 2 === 0 ? 'in-progress' : 'open';
    const results = await Promise.allSettled(operators.map((op, i) =>
      sql(as(op, `select public.admin_update_support_ticket('${ticket}', '${key(100 + round * 10 + i)}', ${version}, '${status}', null, 'Synthetic step ${round}-${i}', 'Synthetic triage')`))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `S3 round ${round}: exactly one triage`);
    assert.equal(stale(results), 2, `S3 round ${round}: two stale refusals`);
    assert.equal(await sql(`select version from public.support_tickets where id='${ticket}'`), String(Number(version) + 1));
  }

  // S4. Disputes on jobs 2–5; three operators decide the same open dispute: one decision, two stale.
  for (let n = 2; n <= 5; n += 1) {
    await sql(as(homeowner, `select public.homeowner_raise_dispute('${job(n)}', 'Synthetic issue ${n}')`));
    const dispute = await sql(`select id from public.disputes where job_id='${job(n)}'`);
    const results = await Promise.allSettled(operators.map((op, i) =>
      sql(as(op, `select public.admin_decide_dispute('${dispute}', '${key(200 + n * 10 + i)}', 'open', 0, 'resolved', 'Synthetic decision ${i}')`))));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `S4 job ${n}: exactly one decision`);
    assert.equal(stale(results), 2, `S4 job ${n}: two stale refusals`);
    assert.equal(await count(`public.dispute_decisions where dispute_id='${dispute}'`), '1');
    assert.equal(await sql(`select resolution_version from public.disputes where id='${dispute}'`), '1');
  }

  // S5. Six identical appeals at once open one appeal ticket.
  const d2 = await sql(`select id from public.disputes where job_id='${job(2)}'`);
  const appeals = await Promise.allSettled(Array.from({ length: 6 }, () =>
    sql(as(homeowner, `select public.appeal_dispute_resolution('${d2}', 'Synthetic appeal', 1)`))));
  assert.equal(appeals.filter((r) => r.status === 'fulfilled').length, 6, 'S5: every retry returns');
  assert.equal(new Set(appeals.map((r) => r.value)).size, 1, 'S5: one appeal ticket');
  assert.equal(await count(`public.dispute_appeals where dispute_id='${d2}'`), '1');

  // S6. An appeal raced against a further decision on the same version: the decision lands and the
  // appeal answers it, or the appeal lands and the decision is stale. Never both on one version.
  for (let n = 3; n <= 5; n += 1) {
    const dispute = await sql(`select id from public.disputes where job_id='${job(n)}'`);
    const [appeal, decision] = await Promise.allSettled([
      sql(as(homeowner, `select public.appeal_dispute_resolution('${dispute}', 'Synthetic racing appeal', 1)`)),
      sql(as(operators[0], `select public.admin_decide_dispute('${dispute}', '${key(300 + n)}', 'resolved', 1, 'vendor_contacted', 'Synthetic reopen')`)),
    ]);
    const state = await sql(`select status || ':' || resolution_version from public.disputes where id='${dispute}'`);
    if (appeal.status === 'fulfilled') {
      assert.equal(decision.status, 'rejected', `S6 job ${n}: decision after appeal is refused`);
      assert.equal(state, 'escalated:1', `S6 job ${n}: escalated on version 1`);
      assert.equal(await count(`public.dispute_appeals where dispute_id='${dispute}'`), '1');
    } else {
      assert.equal(decision.status, 'fulfilled', `S6 job ${n}: one of the two applies`);
      assert.match(appeal.reason.message, /No resolved decision to appeal/, `S6 job ${n}: appeal sees the reopened dispute`);
      assert.equal(state, 'vendor_contacted:1');
      assert.equal(await count(`public.dispute_appeals where dispute_id='${dispute}'`), '0');
    }
  }

  // S7. The same evidence statement six times on an open dispute records one submission.
  await sql(as(homeowner, `select public.homeowner_raise_dispute('${job(6)}', 'Synthetic issue 6')`));
  const d6 = await sql(`select id from public.disputes where job_id='${job(6)}'`);
  const evidence = await Promise.allSettled(Array.from({ length: 6 }, () =>
    sql(as(providerUser, `select public.add_dispute_submission('${d6}', '${key(400)}', 'Synthetic statement', null)->>'submission_id'`))));
  assert.equal(evidence.filter((r) => r.status === 'fulfilled').length, 6, 'S7: every retry returns');
  assert.equal(await count(`public.dispute_submissions where dispute_id='${d6}'`), '1', 'S7: one submission');

  console.log('Support concurrency passed: S1 open x8, S2 reply x6, S3 triage x3 (4 rounds), S4 decide x3 (4 disputes), S5 appeal x6, S6 appeal vs decision x3, S7 evidence x6.');
} finally {
  await cleanup();
}
