// TRACE-155 (Phase 7.3B): the 20261124001000 migration under lock contention, on the isolated
// database only (Codex clearance #5920917095: short lock_timeout, index statement_timeout,
// isolated migration and lock-contention tests, clean abort, no retry loop).
//
// 1. Removes the 7.3B objects (committed), so the migration file can be applied again here.
// 2. For each existing ledger: one session holds ROW EXCLUSIVE on it (an open writer, as a
//    sender's claim would), and the exact migration file is applied as one transaction, as the
//    Supabase CLI does. Expected: it aborts within the 2-second lock timeout with 55P03, and
//    nothing is left behind (no table, function or ledger index).
// 3. Applies the file up to its final resets inside a rolled-back transaction, to show the 2 s
//    lock timeout and the 5 s statement timeout are in force at the ledger-index statements.
// 4. Applies it with no contention (committed), restoring the schema, and records the time.
// 5. TRACE-155 (7.3C-1): the later evidence-readback migration has functions that take the
//    receipt table's row type, so they are dropped before step 1 and that unchanged file is
//    re-applied after step 4, proving it still applies on top. Its function list is read from
//    the file's own revoke block.
// Run against a disposable isolated database only; CI runs a clean reset afterwards.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const migration = readFileSync('supabase/migrations/20261124001000_phase7_email_provider_events.sql', 'utf8');
const readback = readFileSync('supabase/migrations/20261125001000_phase7_email_evidence_readback.sql', 'utf8');
const readbackFunctions = readback.match(/revoke all on function\n([\s\S]*?)\nfrom public/)[1]
  .split(',\n').map(signature => signature.trim());
assert.equal(readbackFunctions.length, 10, 'the 7.3C-1 migration revokes its ten functions in one block');
function psql(source, { stopOnError = true } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`, '-U', 'postgres', '-d', 'postgres'];
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output: output.trim(), errors }));
    child.stdin.end(source);
  });
}
const sql = async source => {
  const result = await psql(source);
  if (result.code !== 0) throw new Error(result.errors);
  return result.output;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ledgers = ['private.r0_application_notifications', 'private.owner_email_notifications', 'private.package_draft_email_notices'];
const objects = `select num_nonnulls(
  to_regclass('private.email_provider_events'), to_regclass('private.email_provider_event_purges'),
  to_regclass('private.email_evidence_config'),
  to_regprocedure('public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer)'),
  to_regprocedure('public.email_provider_events_purge(integer)'),
  to_regclass('private.r0_application_notifications_provider_message_id'),
  to_regclass('private.owner_email_notifications_provider_message_id'),
  to_regclass('private.package_draft_email_notices_provider_message_id'))`;

assert.equal(await sql('select count(*) from private.email_provider_events'), '0', 'Run on an empty receipt table (before other fixtures).');
const readbackPresent = `select num_nonnulls(${readbackFunctions.map(signature => `to_regprocedure('${signature}')`).join(', ')})`;
assert.equal(await sql(readbackPresent), '10', 'the 7.3C-1 readback functions are present before the test');
await sql(`drop function ${readbackFunctions.join(', ')};`);
await sql(`begin;
drop table private.email_provider_events, private.email_provider_event_purges, private.email_evidence_config;
drop function private.email_provider_events_guard(), private.email_provider_event_retention(boolean),
  private.email_provider_id_candidate(text), private.email_provider_tag_exists(text,uuid,integer),
  public.email_receive_provider_event(text,text,text,text,text,timestamptz,text,text,text,text,text,uuid,integer),
  public.email_provider_events_purge(integer);
drop index private.r0_application_notifications_provider_message_id, private.owner_email_notifications_provider_message_id,
  private.package_draft_email_notices_provider_message_id;
commit;`);
assert.equal(await sql(objects), '0', 'the 7.3B objects are removed for the test');

for (const ledger of ledgers) {
  const holder = psql(`begin; lock table ${ledger} in row exclusive mode; select pg_sleep(5); commit;`);
  await sleep(500);
  const started = Date.now();
  const applied = await psql(`\\set ECHO errors\nbegin;\n${migration}\ncommit;`, { stopOnError: true });
  const elapsed = Date.now() - started;
  await holder;
  assert.notEqual(applied.code, 0, `${ledger}: the migration must not apply under contention`);
  assert.match(applied.errors, /canceling statement due to lock timeout/, `${ledger}: aborted by the lock timeout`);
  assert.ok(elapsed >= 1900 && elapsed < 4500, `${ledger}: aborted after about 2 s (${elapsed} ms)`);
  assert.equal(await sql(objects), '0', `${ledger}: a clean abort leaves nothing behind`);
  const failed = (applied.errors.split('\n').find(line => line.startsWith('STATEMENT:')) ?? 'STATEMENT: unknown').slice('STATEMENT:'.length);
  console.log(`contention on ${ledger}: aborted with 55P03 after ${elapsed} ms at "${failed.trim().slice(0, 60)}"; nothing applied`);
}

const beforeResets = migration.slice(0, migration.lastIndexOf('reset statement_timeout;'));
const settings = await sql(`begin;\n${beforeResets}\nshow lock_timeout; show statement_timeout;\nrollback;`);
assert.deepEqual(settings.split('\n').slice(-2), ['2s', '5s'], 'lock 2 s and statement 5 s are in force at the ledger indexes');
assert.equal(await sql(objects), '0', 'the settings probe rolled back');

const started = Date.now();
const timing = await sql(`begin;\n${migration}\nshow lock_timeout; show statement_timeout;\ncommit;`);
const elapsed = Date.now() - started;
assert.deepEqual(timing.split('\n').slice(-2), ['0', '0'], 'the migration resets both settings');
assert.equal(await sql(objects), '8', 'the uncontended migration applies every object');
assert.equal(await sql(`select count(*) from pg_indexes where schemaname='private' and indexname like '%\\_provider_message_id' and indexdef not like '%UNIQUE%'`), '3',
  'three non-unique ledger indexes');
console.log(`uncontended apply (whole file, one transaction, including psql transport): ${elapsed} ms`);
await sql(`begin;\n${readback}\ncommit;`);
assert.equal(await sql(readbackPresent), '10', 'the unchanged 7.3C-1 migration re-applies on top of the restored 7.3B objects');
assert.equal(await sql(`select has_function_privilege('authenticated','public.owner_email_evidence(text,uuid[])','EXECUTE')
  and has_function_privilege('service_role','public.owner_email_correlation_ref(text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.owner_email_evidence_counts()','EXECUTE')`), 't', 'with its grants');
console.log('email provider events migration lock PASS');
