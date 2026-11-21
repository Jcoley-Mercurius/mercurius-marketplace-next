// TRACE-155 (Phase 7.3D-1): concurrent arm/disarm commands against the real database. Each call
// is its own psql session in an operator's authenticated role, so commands race on the
// arming-record row lock and the history's primary key. Proves: first-use racing arms (no record
// row yet) give exactly one event; racing duplicate arms and disarms give one success each and
// refusals for the rest; a mixed storm keeps the history alternating and the record equal to its
// last event; a command that waits behind a held lock takes its time after the lock is released
// (clock time after serialization), so history times follow seq. Run only against a disposable
// isolated database after a clean reset (CI runs it on the Phase 5 synthetic stack). Synthetic
// data only; nothing is sent. Leaves fixtures; a clean reset follows in CI.
// P-1 (7.3D-1 review fixes, D-11): operator probe readbacks racing a content conflict on the same
// provider ID. Every read sees one consistent snapshot: either the whole ID eligible with every
// valid receipt, or the whole ID excluded with nothing returned. Never a partial or mixed answer.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
const psqlArgs = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    child.stdin.end(source);
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const operator = '7e5d1000-0000-4000-8000-000000000001';
const asOperator = statement => `begin; set local role authenticated;
set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: operator })}';
${statement}; commit;`;
const command = (action, reason) =>
  sql(asOperator(`select public.email_evidence_${action}('${reason}')->>'seq'`))
    .then(seq => ({ ok: true, seq: Number(seq) }), error => ({ ok: false, error: String(error.message) }));
/** The command inside a transaction that stays open for `holdMs` after the call. */
const commandHeld = (action, reason, holdMs) => sql(`begin; set local role authenticated;
set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: operator })}';
select public.email_evidence_${action}('${reason}')->>'seq'; select pg_sleep(${holdMs / 1000}); commit;`);
const history = () => sql(`select coalesce(string_agg(seq||':'||action, ',' order by seq), '') from private.email_evidence_arming_events`);
const consistent = () => sql(`select (select armed_at from private.email_evidence_config where singleton) is not distinct from
  (select case when action = 'arm' then occurred_at end from private.email_evidence_arming_events order by seq desc limit 1)`);
const orderedTimes = () => sql(`select coalesce(bool_and(occurred_at > prev), true) from (select occurred_at,
  lag(occurred_at) over (order by seq) as prev from private.email_evidence_arming_events) x where prev is not null`);

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await sql('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await sleep(1000); }
}
assert.equal(await sql('select count(*) from private.email_evidence_arming_events'), '0', 'Reset the isolated database before rerunning arming fixtures.');
assert.equal(await sql('select count(*) from private.email_evidence_config'), '0', 'Start from an empty arming record.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${operator}','arming-concurrency-operator@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${operator}','admin') on conflict do nothing;`);

// A-1: eight concurrent first arms, with no arming-record row yet.
const firstArms = await Promise.all(Array.from({ length: 8 }, (_, i) => command('arm', `Synthetic first arm ${i}`)));
assert.equal(firstArms.filter(r => r.ok).length, 1, 'A-1 exactly one first arm succeeds');
assert.ok(firstArms.filter(r => !r.ok).every(r => r.error.includes('already armed')), 'A-1 the others are refused as duplicates');
assert.equal(await history(), '1:arm', 'A-1 one event');
assert.equal(await sql('select count(*) from private.email_evidence_config'), '1', 'A-1 one arming-record row');
assert.equal(await consistent(), 't', 'A-1 the record equals its last event');
console.log('A-1 PASS: 8 concurrent first arms (no record row) → 1 event, 7 refused, record consistent');

// A-2: eight concurrent disarms.
const disarms = await Promise.all(Array.from({ length: 8 }, (_, i) => command('disarm', `Synthetic disarm ${i}`)));
assert.equal(disarms.filter(r => r.ok).length, 1, 'A-2 exactly one disarm succeeds');
assert.ok(disarms.filter(r => !r.ok).every(r => r.error.includes('not armed')), 'A-2 the others are refused');
assert.equal(await history(), '1:arm,2:disarm', 'A-2 one disarm event');
assert.equal(await consistent(), 't', 'A-2 consistent');
console.log('A-2 PASS: 8 concurrent disarms → 1 event, 7 refused');

// A-3: five rounds of sixteen mixed commands (eight arms, eight disarms) at once.
for (let round = 1; round <= 5; round++) {
  const before = (await history()).split(',').length;
  const calls = Array.from({ length: 16 }, (_, i) => command(i % 2 ? 'disarm' : 'arm', `Synthetic storm ${round}.${i}`));
  const results = await Promise.all(calls);
  const succeeded = results.filter(r => r.ok);
  assert.ok(results.filter(r => !r.ok).every(r => /already armed|not armed/.test(r.error)), `A-3.${round} refusals are duplicate transitions only`);
  const seqs = succeeded.map(r => r.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => before + 1 + i), `A-3.${round} successes have contiguous seqs`);
  const rows = (await history()).split(',');
  assert.ok(rows.every((row, i) => row === `${i + 1}:${i % 2 === 0 ? 'arm' : 'disarm'}`), `A-3.${round} the history alternates from arm`);
  assert.equal(await consistent(), 't', `A-3.${round} the record equals its last event`);
  assert.equal(await orderedTimes(), 't', `A-3.${round} times strictly follow seq`);
}
console.log(`A-3 PASS: 5 rounds × 16 mixed commands → alternating, contiguous history (${(await history()).split(',').length} events), record consistent, times ordered`);

// A-4: a command waiting behind a held lock takes its time after the lock is released.
const state = await sql(`select action from private.email_evidence_arming_events order by seq desc limit 1`);
const [first, second] = state === 'arm' ? ['disarm', 'arm'] : ['arm', 'disarm'];
const held = commandHeld(first, 'Synthetic held transition', 1500);
await sleep(300);
const waiting = command(second, 'Synthetic waiting transition');
await held;
const waited = await waiting;
assert.ok(waited.ok, 'A-4 the waiting opposite transition succeeds after the lock is released');
const gap = Number(await sql(`select extract(epoch from (select occurred_at from private.email_evidence_arming_events where seq = ${waited.seq})
  - (select occurred_at from private.email_evidence_arming_events where seq = ${waited.seq - 1}))`));
assert.ok(gap >= 1.1, `A-4 the waiting command's time (${gap.toFixed(3)} s after the held one) was taken after it acquired the lock`);
assert.equal(await consistent(), 't', 'A-4 consistent');
console.log(`A-4 PASS: a transition queued behind a 1.5 s held lock is stamped ${gap.toFixed(3)} s later (clock time after serialization)`);

// A-5: a held arm makes a concurrent duplicate arm wait and then refuse; nothing is appended for it.
const now = await sql(`select action from private.email_evidence_arming_events order by seq desc limit 1`);
if (now === 'arm') assert.ok((await command('disarm', 'Synthetic reset to disarmed')).ok);
const count = Number(await sql('select count(*) from private.email_evidence_arming_events'));
const heldArm = commandHeld('arm', 'Synthetic held arm', 1000);
await sleep(200);
const duplicate = command('arm', 'Synthetic duplicate arm');
await heldArm;
const refused = await duplicate;
assert.ok(!refused.ok && refused.error.includes('already armed'), 'A-5 the duplicate arm waited, then was refused');
assert.equal(await sql('select count(*) from private.email_evidence_arming_events'), String(count + 1), 'A-5 one event appended');
console.log('A-5 PASS: a duplicate arm behind a held arm waits and is refused; one event appended');

// P-1: probe readbacks racing a content conflict on the same provider ID (D-11).
const receive = (svix, type, email, bounce = null) => sql(`select public.email_receive_provider_event(p_svix_id=>'${svix}',
  p_secret_slot=>'current',p_processing=>'recorded',p_event_type=>'${type}',p_provider_type=>'${type}',
  p_provider_created_at=>'2026-11-20T10:00:00Z',p_provider_email_id=>'${email}',p_bounce_type=>${bounce ? `'${bounce}'` : 'null'},
  p_bounce_subtype=>${bounce ? "'general'" : 'null'},p_tag_status=>'absent',p_tag_ledger=>null,p_tag_ref=>null,p_tag_attempt=>null)->>'result'`);
const probeRead = email => sql(asOperator(`select public.email_evidence_probe_readback('${email}')::text`)).then(JSON.parse);
const shapes = { eligible: 0, excluded: 0 };
for (let round = 1; round <= 8; round++) {
  const email = `em-race-${round}`;
  assert.equal(await receive(`msg-race-${round}-sent`, 'email.sent', email), 'recorded');
  assert.equal(await receive(`msg-race-${round}-bounce`, 'email.bounced', email, 'permanent'), 'recorded');
  assert.equal(await receive(`msg-race-${round}-x`, 'email.delivered', email), 'recorded');
  const readers = Array.from({ length: 12 }, (_, i) => sleep(i * 15).then(() => probeRead(email)));
  const writer = sleep(60).then(() => receive(`msg-race-${round}-x`, 'email.complained', email));
  const [conflict, ...reads] = await Promise.all([writer, ...readers]);
  assert.equal(conflict, 'conflict', `P-1.${round} the changed payload flags a content conflict`);
  for (const read of reads) {
    const states = read.receipts.map(receipt => receipt.state);
    if (read.not_probe) {
      assert.deepEqual(read.receipts, [], `P-1.${round} an excluded read returns nothing`);
      shapes.excluded += 1;
    } else {
      assert.deepEqual(states, ['unlinked', 'unlinked', 'unlinked'], `P-1.${round} an eligible read returns every receipt, all unlinked`);
      shapes.eligible += 1;
    }
  }
  const after = await probeRead(email);
  assert.equal(after.not_probe, true, `P-1.${round} after the conflict commits the whole ID is excluded`);
  assert.deepEqual(after.receipts, [], `P-1.${round} and nothing is returned`);
}
console.log(`P-1 PASS: 8 rounds × 12 probe readbacks racing a content conflict → ${shapes.eligible} whole-eligible, ${shapes.excluded} whole-excluded, none mixed; excluded after commit`);
