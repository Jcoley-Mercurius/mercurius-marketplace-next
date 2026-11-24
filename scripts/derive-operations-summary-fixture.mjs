// Phase 7.5B (TRACE-159): derives the operations-summary browser fixture from the database.
// Replays the fixture block of supabase/tests/127_operations_summary_truth.sql (between its
// BEGIN/END 7.5B FIXTURES markers) in one transaction that is rolled back, reads
// public.admin_operations_summary() as the admin without finance authority and as the finance
// holder, normalizes checked_at to one fixed instant, and writes
// tests/fixtures/admin-operations-summary.json. With --check it writes nothing and exits 1 if the
// committed fixture differs. Run only against a disposable local database after a clean replay:
//   sh scripts/phase5-db.sh reset && node scripts/derive-operations-summary-fixture.mjs --check
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const container = process.env.ADMIN_OPS_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const testFile = 'supabase/tests/127_operations_summary_truth.sql';
const fixtureFile = 'tests/fixtures/admin-operations-summary.json';
export const NORMALIZED_CHECKED_AT = '2026-11-23T14:00:00+00:00';

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

const source = readFileSync(testFile, 'utf8');
const block = source.match(/^-- BEGIN 7\.5B FIXTURES.*\n([\s\S]*?)^-- END 7\.5B FIXTURES$/m);
if (!block) throw new Error(`No fixture block in ${testFile}`);
const read = (sub) => `set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"${sub}"}';
select public.admin_operations_summary();
reset role;`;
const lines = (await sql(`begin;\n${block[1]}\n${read('c75b0000-0000-4000-8000-000000000001')}\n${read('c75b0000-0000-4000-8000-000000000004')}\nrollback;`))
  .split('\n').filter((line) => line.startsWith('{'));
if (lines.length !== 2) throw new Error(`Expected two summaries, read ${lines.length}`);

// One fixed instant replaces the transaction time; every other value is the database's own.
const normalize = (text) => {
  const { checked_at: checkedAt, queues } = JSON.parse(text);
  if (Number.isNaN(Date.parse(checkedAt))) throw new Error('checked_at is not a timestamp');
  return { checked_at: NORMALIZED_CHECKED_AT, queues: queues.map(({ queue, state, count, aged }) => ({ queue, state, count, aged })) };
};
const fixture = {
  source: `${testFile} (fixture block), read through public.admin_operations_summary(); checked_at normalized`,
  admin: normalize(lines[0]),
  finance: normalize(lines[1]),
};

if (process.argv.includes('--check')) {
  const committed = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  if (!isDeepStrictEqual(committed, fixture)) {
    console.error(`${fixtureFile} differs from the database:\n${JSON.stringify(fixture, null, 2)}`);
    process.exit(1);
  }
  console.log(`${fixtureFile} equals the database output (checked_at normalized).`);
} else {
  // One queue row per line, so a review diff shows each changed row.
  const summary = (value) => `{\n    "checked_at": ${JSON.stringify(value.checked_at)},\n    "queues": [\n${value.queues
    .map((row) => `      ${JSON.stringify(row)}`).join(',\n')}\n    ]\n  }`;
  writeFileSync(fixtureFile, `{\n  "source": ${JSON.stringify(fixture.source)},\n  "admin": ${summary(fixture.admin)},\n  "finance": ${summary(fixture.finance)}\n}\n`);
  console.log(`Wrote ${fixtureFile} from the database.`);
}
