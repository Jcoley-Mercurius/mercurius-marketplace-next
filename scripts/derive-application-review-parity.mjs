// Phase 7.5G-1 (TRACE-159): derives the applications-queue parity fixture from the database.
// Replays the fixture block of supabase/tests/133_applications_review_queue.sql (between its
// BEGIN/END 7.5G-1 FIXTURES markers) in one transaction that is rolled back, reads pg_temp.parity()
// as the fixture admin (each application's status, the vendor_onboarding_intake_status fields the
// page uses, and admin_application_review_queue()), and writes
// tests/fixtures/application-review-queue-parity.json. With --check it writes nothing and exits 1
// if the committed fixture differs. The fixture times are absolute, so nothing is normalized.
// Run only against a disposable local database after a clean replay:
//   sh scripts/phase5-db.sh reset && node scripts/derive-application-review-parity.mjs --check
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const container = process.env.ADMIN_OPS_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const testFile = 'supabase/tests/133_applications_review_queue.sql';
const fixtureFile = 'tests/fixtures/application-review-queue-parity.json';
const admin = 'c75a0000-0000-4000-8000-000000000001';

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
const block = source.match(/^-- BEGIN 7\.5G-1 FIXTURES.*\n([\s\S]*?)^-- END 7\.5G-1 FIXTURES$/m);
if (!block) throw new Error(`No fixture block in ${testFile}`);
const lines = (await sql(`begin;\n${block[1]}\nset local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"${admin}"}';
select 'PARITY ' || pg_temp.parity()::text;
reset role;
rollback;`)).split('\n').filter((line) => line.startsWith('PARITY '));
if (lines.length !== 1) throw new Error(`Expected one parity readback, read ${lines.length}`);
const { applications, items } = JSON.parse(lines[0].slice('PARITY '.length));
const fixture = {
  source: `${testFile} (fixture block), read through pg_temp.parity() as the fixture admin`,
  applications,
  items,
};

if (process.argv.includes('--check')) {
  const committed = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  if (!isDeepStrictEqual(committed, fixture)) {
    console.error(`${fixtureFile} differs from the database:\n${JSON.stringify(fixture, null, 2)}`);
    process.exit(1);
  }
  console.log(`${fixtureFile} equals the database output.`);
} else {
  // One row per line, so a review diff shows each changed row.
  const list = (rows) => `[\n${rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`;
  writeFileSync(fixtureFile, `{\n  "source": ${JSON.stringify(fixture.source)},\n  "applications": ${list(applications)},\n  "items": ${list(items)}\n}\n`);
  console.log(`Wrote ${fixtureFile} from the database.`);
}
