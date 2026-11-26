// TRACE-159 (Phase 7.5F-1 forward repair F208-1): a same-key detector replay racing the retention
// purge, across real sessions and commits. Migration 20261204001000; record
// governance/PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md §8. Single-session cases are SQL 132.
//
// The window. The merged detector read a replayed run's start and its result in two statements;
// under READ COMMITTED each takes its own snapshot. The purge deletes an expired result and start in
// one transaction and takes no key lock. To land its commit between the replay's reads every time,
// the purge's transaction first takes ACCESS EXCLUSIVE on the run-results table (a test device; the
// purge itself is the real function). The replay then reads the start and waits to read the result.
// The script checks that the replay holds its key lock and waits on that table before the purge
// runs and commits; the replay's next snapshot is taken after the wait. With the merged function the
// first round fails (an incomplete 'visible' result); with the repair the pair is read in one
// statement and a purged key is refused as too old.
//
// Also: the purge held uncommitted while the replay reads (expired, content withheld) and the purge
// rolled back inside the window (the pair stays, expired). Rerunnable: every round purges its own
// fixtures. Refuses to start if the database holds other expired SLA rows. Synthetic data only;
// nothing is sent. CI runs it on the Phase 5 synthetic stack after sla-detector-concurrency.mjs.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROUNDS = 10;

// One psql session; run() sends one statement and resolves with its output and SQLSTATE.
function session() {
  const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', count = 0, waiter = null;
  const check = () => {
    if (!waiter) return;
    const at = out.indexOf(waiter.marker);
    if (at < 0) return;
    const end = out.indexOf('\n', at);
    if (end < 0) return;
    const body = out.slice(0, at).trim();
    const sqlstate = out.slice(at + waiter.marker.length, end).trim();
    out = out.slice(end + 1);
    const { resolve } = waiter;
    waiter = null;
    resolve({ out: body, sqlstate });
  };
  child.stdout.on('data', chunk => { out += chunk; check(); });
  child.stderr.on('data', () => {});
  return {
    run(statement) {
      assert.equal(waiter, null, 'one statement at a time per session');
      const marker = `__sla_rp_done_${++count}__ `;
      return new Promise(resolve => {
        waiter = { marker, resolve };
        child.stdin.write(`${statement};\n\\echo ${marker}:SQLSTATE\n`);
      });
    },
    end() { child.stdin.end(); return new Promise(resolve => child.on('close', resolve)); },
  };
}
// `owner` reads and writes fixtures (autocommit); R replays, P purges.
const owner = session(), R = session(), P = session();
async function value(statement) {
  const { out, sqlstate } = await owner.run(statement);
  assert.equal(sqlstate, '00000', `${statement.slice(0, 80)} failed with ${sqlstate}`);
  return out;
}
async function ok(s, statement) {
  const { sqlstate } = await s.run(statement);
  assert.equal(sqlstate, '00000', `${statement.slice(0, 80)} failed with ${sqlstate}`);
}
const claims = sub => `set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub })}'`;
// A version-7 key issued at `ms` (Unix milliseconds).
function keyAt(ms) {
  const t = Math.floor(ms).toString(16).padStart(12, '0');
  const r = randomBytes(10).toString('hex');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-${(8 | (parseInt(r[3], 16) & 3)).toString(16)}${r.slice(4, 7)}-${r.slice(7, 19)}`;
}
const scanSql = key => `select public.admin_detect_sla_breaches('${key}', 200)`;
const lookupSql = key => `select public.admin_sla_detector_run('${key}')`;
const purgeSql = 'select public.admin_purge_sla_records(1000)';
// A complete call in its own transaction: begin, claims, statement, commit (or rollback on error).
async function call(s, sub, statement) {
  await ok(s, 'begin');
  await ok(s, claims(sub));
  const result = await s.run(statement);
  await s.run(result.sqlstate === '00000' ? 'commit' : 'rollback');
  return result;
}
const json = result => { assert.equal(result.sqlstate, '00000', `expected success, got ${result.sqlstate}`); return JSON.parse(result.out); };
const counts = async key => (await value(`select (select count(*) from private.operations_sla_detector_runs where id = '${key}')||':'||
  (select count(*) from private.operations_sla_detector_run_results where run_id = '${key}')||':'||
  (select count(*) from private.operations_sla_observations where run_id = '${key}')`)).split(':').map(Number);
// Ledger-wide: a result without its start, a start without its result, an observation without its result.
const orphans = async () => (await value(`select
  (select count(*) from private.operations_sla_detector_run_results x where not exists(select 1 from private.operations_sla_detector_runs r where r.id = x.run_id))||':'||
  (select count(*) from private.operations_sla_detector_runs r where not exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = r.id))||':'||
  (select count(*) from private.operations_sla_observations o where not exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = o.run_id))`)).split(':').map(Number);
const expiredRows = async () => Number(await value(`select (select count(*) from private.operations_sla_observations where observed_at < private.operations_sla_cutoff())
  + (select count(*) from private.operations_sla_detector_run_results where finished_at < private.operations_sla_cutoff())
  + (select count(*) from private.operations_sla_detector_runs where started_at < private.operations_sla_cutoff())
  + (select count(*) from private.operations_sla_purges where ran_at < private.operations_sla_cutoff())`));

const adminA = 'f7530000-0000-4000-8000-000000000001';
const adminB = 'f7530000-0000-4000-8000-000000000002';
const DAY = 86_400_000;

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await value('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await sleep(1000); }
}
assert.equal(await value('select retention from private.operations_sla_retention'), '90 days', 'retention is the approved 90 days');
assert.equal(await expiredRows(), 0, 'This script purges every expired SLA row; run it only on a disposable database holding none.');
assert.deepEqual(await orphans(), [0, 0, 0], 'precondition: no orphaned SLA rows');
await value(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${adminA}','sla-rp-a@example.invalid',now(),'{}'),('${adminB}','sla-rp-b@example.invalid',now(),'{}') on conflict do nothing;
insert into public.user_roles(user_id,role) values ('${adminA}','admin'),('${adminB}','admin') on conflict do nothing`);
const rPid = Number((await R.run('select pg_backend_pid()')).out);

// An expired run of adminA (limit 200) with one observation, all 100 days old, its key issued then.
async function expiredRun() {
  const at = Date.now() - 100 * DAY;
  const key = keyAt(at);
  const ts = `to_timestamp(${at / 1000})`;
  await value(`insert into private.operations_sla_detector_runs(id,actor,applied_limit,rule_set,evaluated_at,started_at)
      values ('${key}','${adminA}',200,'synthetic',${ts},${ts});
    insert into private.operations_sla_observations(run_id,rule_id,queue,item_kind,subject_id,request_id,due_at,evaluated_at,observed_at)
      values ('${key}','T-5','fulfillment','confirmation_overdue','${randomUUID()}',null,${ts} - interval '1 hour',${ts},${ts});
    insert into private.operations_sla_detector_run_results(run_id,outcome,rules,finished_at) values ('${key}','complete','[]',${ts})`);
  assert.deepEqual(await counts(key), [1, 1, 1]);
  return key;
}
const expiredReply = key => ({ run_key: key, state: 'expired', replayed: true });
// The replay's outcome must never be a 'visible' result for an expired or purged run, nor carry any of
// its content. Returns the outcome for the caller's exact expectation.
function noDisclosure(result, label) {
  if (result.sqlstate !== '00000') return result;
  const reply = JSON.parse(result.out);
  assert.notEqual(reply.state, 'visible', `${label}: no 'visible' result for an expired or purged run (F208-1; got outcome ${reply.outcome})`);
  assert.deepEqual(Object.keys(reply).sort(), ['replayed', 'run_key', 'state'], `${label}: no content of an expired run`);
  return result;
}
// The purge removed exactly the round's run and observation; nothing remains or is orphaned under the key.
async function purgedOnly(reply, key, label) {
  assert.equal(reply.outcome, 'complete', `${label}: the purge ran`);
  assert.deepEqual(reply.deleted_logical, { observations: 1, runs: 1, purge_logs: 0 }, `${label}: the purge deleted the round's run and observation`);
  assert.deepEqual(await counts(key), [0, 0, 0], `${label}: nothing remains under the key (no duplicate scan)`);
  assert.deepEqual(await orphans(), [0, 0, 0], `${label}: no orphaned start, result or observation`);
}

// Warm-up and baseline: an expired run replays as expired, content withheld.
{
  const key = await expiredRun();
  assert.deepEqual(json(noDisclosure(await call(R, adminA, scanSql(key)), 'baseline')), expiredReply(key), 'baseline: an expired run replays as expired');
  await purgedOnly(json(await call(P, adminB, purgeSql)), key, 'baseline');
}

for (let round = 1; round <= ROUNDS; round++) {
  // W (F208-1): the purge commits while the replay is between its start and result reads.
  {
    const label = `W${round}`;
    const key = await expiredRun();
    await ok(P, 'begin');
    await ok(P, 'lock table private.operations_sla_detector_run_results in access exclusive mode');
    await ok(P, claims(adminB));
    const replay = call(R, adminA, scanSql(key));
    for (let tries = 0; ; tries++) {
      const state = await value(`select (select count(*) from pg_locks where pid = ${rPid} and locktype = 'advisory' and granted)||':'||
        (select count(*) from pg_locks where pid = ${rPid} and locktype = 'relation' and not granted and relation = 'private.operations_sla_detector_run_results'::regclass)`);
      if (state === '1:1') break;
      assert.ok(tries < 400, `${label}: the replay holds its key lock and waits to read the run's result (state ${state})`);
      await sleep(25);
    }
    const purge = json(await P.run(purgeSql));
    await ok(P, 'commit');
    const result = noDisclosure(await replay, label);
    assert.equal(`${result.sqlstate}: ${result.out}`.startsWith('22023'), true,
      `${label}: with the pair gone, the replay is refused as too old (got ${result.sqlstate} ${result.out})`);
    await purgedOnly(purge, key, label);
    assert.equal((await call(R, adminA, scanSql(key))).sqlstate, '22023', `${label}: a later retry is refused as too old`);
    assert.deepEqual(await counts(key), [0, 0, 0], `${label}: and starts no scan`);
    assert.equal(json(await call(R, adminA, lookupSql(key))).state, 'not_visible', `${label}: the lookup is not_visible`);
  }
  // H: the purge has deleted but not committed; the replay reads the committed pair (no wait).
  {
    const label = `H${round}`;
    const key = await expiredRun();
    await ok(P, 'begin');
    await ok(P, claims(adminB));
    const purge = json(await P.run(purgeSql));
    assert.deepEqual(json(noDisclosure(await call(R, adminA, scanSql(key)), label)), expiredReply(key), `${label}: before the purge commits, the replay is expired, content withheld`);
    await ok(P, 'commit');
    await purgedOnly(purge, key, label);
    assert.equal((await call(R, adminA, scanSql(key))).sqlstate, '22023', `${label}: after it commits, the retry is too old`);
    assert.deepEqual(await counts(key), [0, 0, 0], `${label}: and starts no scan`);
  }
}

// B: the purge rolls back inside the window: the pair is still there, so the replay is expired.
for (let round = 1; round <= 3; round++) {
  const label = `B${round}`;
  const key = await expiredRun();
  await ok(P, 'begin');
  await ok(P, 'lock table private.operations_sla_detector_run_results in access exclusive mode');
  await ok(P, claims(adminB));
  const replay = call(R, adminA, scanSql(key));
  for (let tries = 0; ; tries++) {
    if (await value(`select count(*) from pg_locks where pid = ${rPid} and locktype = 'relation' and not granted and relation = 'private.operations_sla_detector_run_results'::regclass`) === '1') break;
    assert.ok(tries < 400, `${label}: the replay waits to read the run's result`);
    await sleep(25);
  }
  json(await P.run(purgeSql));
  await ok(P, 'rollback');
  assert.deepEqual(json(noDisclosure(await replay, label)), expiredReply(key), `${label}: after a rolled-back purge, the replay is expired, content withheld`);
  assert.deepEqual(await counts(key), [1, 1, 1], `${label}: the pair and its observation remain`);
  await purgedOnly(json(await call(P, adminB, purgeSql)), key, label);
}

assert.equal(await expiredRows(), 0, 'every fixture was purged');
await Promise.all([owner, R, P].map(s => s.end()));
console.log(`SLA replay versus purge: baseline, W (purge commits between the replay's reads) ×${ROUNDS}, H (purge uncommitted) ×${ROUNDS} and B (purge rolled back) ×3 passed.`);
