// TRACE-159 (Phase 7.5F-1): the SLA detector's run keys, scans and purges across real sessions and
// commits. Plan: governance/PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md §6 groups K (run-key
// serialization, F-1), U (unknown outcomes, F-4/F-7: held original, cancelled retry), F (commit
// boundary, F-2), L (the cap bounds writes, not reads), R (purge and scan share one lock) and the
// READ COMMITTED refusals. Single-session groups are SQL 131. Each psql process is one session; a
// session can hold a transaction open while others wait on it. Run only against a disposable
// isolated database after a clean reset (CI runs it on the Phase 5 synthetic stack). Synthetic data
// only; nothing is sent. Leaves fixtures (including a large synthetic queue); a clean reset follows.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// One psql session. run() sends one statement and resolves with its output and SQLSTATE
// ('00000' on success), read from psql's own :SQLSTATE variable after the statement.
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
      const marker = `__sla_done_${++count}__ `;
      return new Promise(resolve => {
        waiter = { marker, resolve };
        child.stdin.write(`${statement};\n\\echo ${marker}:SQLSTATE\n`);
      });
    },
    end() { child.stdin.end(); return new Promise(resolve => child.on('close', resolve)); },
  };
}
// Persistent sessions, so no statement pays for a new process: `owner` reads and writes fixtures
// (autocommit); A, B and C are three client sessions, each statement in its own transaction.
const owner = session();
async function value(statement) {
  const { out, sqlstate } = await owner.run(statement);
  assert.equal(sqlstate, '00000', `${statement.slice(0, 80)} failed with ${sqlstate}`);
  return out;
}
const claims = sub => `set local role authenticated; set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub })}'`;
// A version-7 key issued now (host clock = container clock).
function newKey() {
  const t = Date.now().toString(16).padStart(12, '0');
  const r = randomBytes(10).toString('hex');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-${(8 | (parseInt(r[3], 16) & 3)).toString(16)}${r.slice(4, 7)}-${r.slice(7, 19)}`;
}
const scanSql = (key, limit = 200) => `select public.admin_detect_sla_breaches('${key}', ${limit})`;
const lookupSql = key => `select public.admin_sla_detector_run('${key}')`;
const A = session(), B = session(), C = session();
// Opens a transaction on session s as `sub`; the caller ends it with s.run('commit' | 'rollback').
async function opened(s, sub, isolation = '') {
  assert.equal((await s.run(`begin${isolation}`)).sqlstate, '00000');
  assert.equal((await s.run(claims(sub))).sqlstate, '00000');
  return s;
}
// A complete call in its own transaction on session s: begin, claims, setup, statement, end.
async function call(s, sub, statement, setup = '') {
  await opened(s, sub);
  if (setup) assert.equal((await s.run(setup)).sqlstate, '00000');
  const result = await s.run(statement);
  await s.run(result.sqlstate === '00000' ? 'commit' : 'rollback');
  return result;
}
const json = result => { assert.equal(result.sqlstate, '00000', `expected success, got ${result.sqlstate}`); return JSON.parse(result.out); };
const counts = async key => (await value(`select (select count(*) from private.operations_sla_detector_runs where id = '${key}')||':'||
  (select count(*) from private.operations_sla_detector_run_results where run_id = '${key}')||':'||
  (select count(*) from private.operations_sla_observations where run_id = '${key}')`)).split(':').map(Number);
// Waits until n sessions wait on an advisory lock (the key lock).
async function waiting(n) {
  for (let tries = 0; ; tries++) {
    const found = Number(await value(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory'`));
    if (found >= n) return;
    assert.ok(tries < 400, 'a same-key call waits on the key lock');
    await sleep(25);
  }
}

const adminA = 'f75e0000-0000-4000-8000-000000000001';
const adminB = 'f75e0000-0000-4000-8000-000000000002';
const home = 'f75e0000-0000-4000-8000-000000000003';
const provider = 'f75e1000-0000-4000-8000-000000000001';

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await value('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await sleep(1000); }
}
assert.equal(await value(`select count(*) from auth.users where id = '${adminA}'`), '0', 'Reset the isolated database before rerunning the SLA detector fixtures.');
assert.equal(await value(`select retention from private.operations_sla_retention`), '90 days', 'retention is the approved 90 days');
await value(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${adminA}','sla-a@example.invalid',now(),'{}'),('${adminB}','sla-b@example.invalid',now(),'{}'),('${home}','sla-home@example.invalid',now(),'{}');
insert into public.user_roles(user_id,role) values ('${adminA}','admin'),('${adminB}','admin') on conflict do nothing;
insert into public.coverage_areas(zip_code,city) values ('00175','SLA area') on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled) values ('${provider}','SLA provider',true,true)`);
// Overdue T-5 work (completion notices past 72 h), n rows with a given prefix.
const overdue = (prefix, n) => value(`begin; set local session_replication_role = replica;
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,city,state,zip_code,description,status,matching_status,pricing_mode,
  vendor_completed_at,confirmation_sent_at)
 select ('${prefix}'||lpad(to_hex(g),12,'0'))::uuid, '${home}', '${provider}', 'SLA work', g||' Probe St', 'Fort Myers', 'FL', '00175', 'SLA synthetic',
   'vendor_completed', 'matched', 'fixed', now() - interval '9 days', now() - interval '80 hours' - g * interval '1 second'
 from generate_series(1, ${n}) g; commit`);
await overdue('f75e2000-0000-4000-8000-', 6);

// ------------------------------------------------------------------------------------------------
// READ COMMITTED is required (the post-lock recheck must see rows committed while waiting).
for (const level of [' isolation level repeatable read', ' isolation level serializable']) {
  await opened(A, adminA, level);
  assert.equal((await A.run(scanSql(newKey()))).sqlstate, '55000', `the detector refuses${level}`);
  await A.run('rollback');
  await opened(A, adminA, level);
  assert.equal((await A.run('select public.admin_purge_sla_records(1)')).sqlstate, '55000', `the purge refuses${level}`);
  await A.run('rollback');
}

// ------------------------------------------------------------------------------------------------
// K and U, repeated 20 times.
for (let round = 1; round <= 20; round++) {
  // K1 / U: same key, same actor, overlapping. The lookup sees nothing while the first is uncommitted;
  // the second waits on the key lock, then replays the committed result.
  {
    const key = newKey();
    const a = await opened(A, adminA);
    const first = json(await a.run(scanSql(key)));
    assert.equal(first.replayed, false);
    assert.equal(json(await call(C, adminA, lookupSql(key))).state, 'not_visible', 'U: no committed result is visible while the attempt is held');
    const second = call(B, adminA, scanSql(key));
    await waiting(1);
    await a.run('commit');
    const replay = json(await second);
    assert.equal(replay.replayed, true, 'K1: the waiting call replays');
    assert.deepEqual({ ...replay, replayed: false }, first, 'K1: with the first call\'s stored result');
    assert.deepEqual((await counts(key)).slice(0, 2), [1, 1], 'K1: exactly one start and one result');
    const visible = json(await call(C, adminA, lookupSql(key)));
    assert.equal(visible.state, 'visible');
    assert.deepEqual(visible.run, Object.fromEntries(Object.entries(first).filter(([name]) => name !== 'state' && name !== 'replayed')), 'U: after commit the lookup shows the run');
  }
  // K2: same key, another actor, overlapping: refused after the first commits; writes nothing.
  {
    const key = newKey();
    const a = await opened(A, adminA);
    json(await a.run(scanSql(key)));
    const other = call(B, adminB, scanSql(key));
    await waiting(1);
    await a.run('commit');
    assert.equal((await other).sqlstate, '22023', 'K2: another operator with the same key is refused');
    assert.deepEqual((await counts(key)).slice(0, 2), [1, 1], 'K2: the refused call wrote nothing');
  }
  // K3 / U: the first call rolls back while the second waits: the second runs and owns the key.
  {
    const key = newKey();
    const a = await opened(A, adminA);
    json(await a.run(scanSql(key)));
    const second = call(B, adminA, scanSql(key));
    await waiting(1);
    await a.run('rollback');
    const owned = json(await second);
    assert.equal(owned.replayed, false, 'K3: after a rollback the waiting call runs');
    assert.equal(owned.outcome, 'complete');
    assert.deepEqual((await counts(key)).slice(0, 2), [1, 1], 'K3: exactly one run');
  }
  // K4: different keys, overlapping: one complete, one skipped (no wait); no duplicate observation.
  {
    const k1 = newKey(), k2 = newKey();
    const a = await opened(A, adminA);
    const first = json(await a.run(scanSql(k1)));
    const skipped = json(await call(B, adminA, scanSql(k2)));
    assert.equal(skipped.outcome, 'skipped', 'K4: the concurrent scan with another key is skipped');
    assert.ok(skipped.rules.every(rule => rule.status === 'skipped'));
    await a.run('commit');
    assert.equal(first.outcome, 'complete');
    assert.deepEqual(await counts(k2), [1, 1, 0], 'F: a skipped call commits a start and a result and no observation');
    assert.equal(await value(`select count(*) - count(distinct (rule_id, item_kind, subject_id, due_at)) from private.operations_sla_observations`), '0',
      'K4: no duplicate observation');
  }
  // U (F-7): held original, cancelled retry. B's retry times out on the key lock (57014) while A holds
  // K; A commits: the lookup is visible with A's result and B's next retry replays. Variant: A rolls
  // back after B's cancellation: the lookup is not_visible and B's next retry runs and owns K.
  for (const ending of ['commit', 'rollback']) {
    const key = newKey();
    const a = await opened(A, adminA);
    const held = json(await a.run(scanSql(key)));
    const cancelled = await call(B, adminA, scanSql(key), `set local statement_timeout = '300ms'`);
    assert.equal(cancelled.sqlstate, '57014', 'U: the retry is cancelled while waiting on the key lock');
    await a.run(ending);
    const lookup = json(await call(C, adminA, lookupSql(key)));
    const retry = json(await call(B, adminA, scanSql(key)));
    if (ending === 'commit') {
      assert.equal(lookup.state, 'visible', 'U: a cancelled attempt did not settle the run; the lookup shows the committed original');
      assert.equal(lookup.run.started_at, held.started_at);
      assert.equal(retry.replayed, true, 'U: the cancelled caller\'s next retry replays');
    } else {
      assert.equal(lookup.state, 'not_visible', 'U: after the original rolled back nothing is visible (unknown, not failed)');
      assert.ok(new Date(lookup.retry_until) > new Date(), 'U: and the key can still be retried');
      assert.equal(retry.replayed, false, 'U: the next retry runs and owns the key');
    }
    assert.deepEqual((await counts(key)).slice(0, 2), [1, 1], `U (${ending}): exactly one start and one result`);
  }
}

// ------------------------------------------------------------------------------------------------
// F: the commit boundary. A call made inside an explicit transaction and rolled back leaves nothing
// visible to another session; after commits, every run has exactly one result and each run's
// inserted count equals its rows.
{
  await overdue('f75e3000-0000-4000-8000-', 2);
  const key = newKey();
  const a = await opened(A, adminA);
  const result = json(await a.run(scanSql(key)));
  assert.ok(result.totals.inserted >= 2, 'F setup: the held scan inserts the new episodes');
  assert.deepEqual(await counts(key), [0, 0, 0], 'F: nothing of an uncommitted scan is visible to another session');
  await a.run('rollback');
  assert.deepEqual(await counts(key), [0, 0, 0], 'F: a rolled-back scan leaves no start, result or observation');
  assert.equal(await value(`select count(*) from private.operations_sla_detector_runs r where (select count(*) from private.operations_sla_detector_run_results x where x.run_id = r.id) <> 1`),
    '0', 'F: every committed run has exactly one result');
  assert.equal(await value(`select count(*) from private.operations_sla_observations o where not exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = o.run_id)`),
    '0', 'F: every observation\'s run has a result');
  assert.equal(await value(`select count(*) from private.operations_sla_detector_run_results x
     where x.outcome <> 'skipped' and (select coalesce(sum((e->>'inserted')::int), 0) from jsonb_array_elements(x.rules) e where e->>'status' = 'ok')
       <> (select count(*) from private.operations_sla_observations o where o.run_id = x.run_id)`), '0', 'F: each run\'s inserted count equals its rows');
}

// ------------------------------------------------------------------------------------------------
// R: a purge and a scan never overlap; contention is logged as skipped; two purges never delete a
// row twice.
{
  const purgeSql = limit => `select public.admin_purge_sla_records(${limit})`;
  const a = await opened(A, adminA);
  json(await a.run(scanSql(newKey())));
  const duringScan = json(await call(B, adminB, purgeSql(10)));
  assert.equal(duringScan.outcome, 'skipped', 'R: a purge during a scan is skipped');
  await a.run('commit');
  assert.equal(await value(`select outcome||':'||deleted_observations from private.operations_sla_purges where id = ${duringScan.purge_id}`), 'skipped:0', 'R: and logged');

  const p = await opened(A, adminA);
  json(await p.run(purgeSql(10)));
  const key = newKey();
  const duringPurge = json(await call(B, adminB, scanSql(key)));
  assert.equal(duringPurge.outcome, 'skipped', 'R: a scan during a purge is skipped');
  await p.run('commit');
  assert.deepEqual(await counts(key), [1, 1, 0]);

  // Expire everything so far (as owner, triggers off), then two purges at once.
  await value(`begin; set local session_replication_role = replica;
    update private.operations_sla_observations set due_at = due_at - interval '100 days', evaluated_at = evaluated_at - interval '100 days', observed_at = observed_at - interval '100 days';
    update private.operations_sla_detector_runs set evaluated_at = evaluated_at - interval '100 days', started_at = started_at - interval '100 days';
    update private.operations_sla_detector_run_results set finished_at = finished_at - interval '100 days';
    update private.operations_sla_purges set ran_at = ran_at - interval '100 days'; commit`);
  const before = (await value(`select (select count(*) from private.operations_sla_observations)||':'||(select count(*) from private.operations_sla_detector_runs)||':'||
    (select count(*) from private.operations_sla_purges)`)).split(':').map(Number);
  const x = await opened(A, adminA), y = await opened(B, adminB);
  const [one, two] = await Promise.all([x.run(purgeSql(1000)), y.run(purgeSql(1000))]);
  await Promise.all([x.run('commit'), y.run('commit')]);
  const outcomes = [json(one), json(two)];
  assert.deepEqual(outcomes.map(o => o.outcome).sort(), ['complete', 'skipped'], 'R: of two concurrent purges one runs and one is skipped');
  const done = outcomes.find(o => o.outcome === 'complete');
  assert.deepEqual([done.deleted_logical.observations, done.deleted_logical.runs, done.deleted_logical.purge_logs], before,
    'R: the purge deleted every expired row once');
  assert.equal(await value(`select (select count(*) from private.operations_sla_observations)+(select count(*) from private.operations_sla_detector_runs)+
    (select count(*) from private.operations_sla_purges where ran_at < now() - interval '90 days')`), '0', 'R: nothing expired remains');
  assert.equal(await value('select count(*) from private.operations_sla_purges'), '2', 'R: the two new log rows remain');
}

// ------------------------------------------------------------------------------------------------
// L: the cap bounds writes, not reads. A large queue under a low statement timeout fails the whole
// call (57014) and leaves nothing; with the role's normal timeout the same queue scans and inserts at
// most the cap.
{
  await overdue('f75e4000-0000-4000-8000-', 5000);
  const key = newKey();
  const timed = await call(A, adminA, scanSql(key, 500), `set local statement_timeout = '50ms'`);
  assert.equal(timed.sqlstate, '57014', 'L: the slow read cancels the whole call');
  assert.deepEqual(await counts(key), [0, 0, 0], 'L: a cancelled call writes no start, result or observation');
  const started = Date.now();
  const full = json(await call(A, adminA, scanSql(key, 500)));
  const elapsed = Date.now() - started;
  const t5 = full.rules.find(rule => rule.rule === 'T-5');
  assert.equal(full.outcome, 'complete');
  assert.equal(t5.inserted, 500, 'L: at most the cap is inserted per rule');
  assert.ok(t5.listed >= 5000 && t5.over_limit === t5.listed - t5.already_recorded - t5.inserted - t5.conflicted, 'L: the rest is over_limit');
  assert.ok(full.rules.every(rule => rule.inserted <= 500));
  console.log(`L: the uncancelled scan of a ${t5.listed}-item T-5 queue took ${elapsed} ms (the cancelled one had 50 ms).`);
}

await Promise.all([owner, A, B, C].map(s => s.end()));
console.log('SLA detector run keys, scans and purges: K1–K4 and U (held original, cancelled retry) ×20, F, R, L and READ COMMITTED refusals passed.');
