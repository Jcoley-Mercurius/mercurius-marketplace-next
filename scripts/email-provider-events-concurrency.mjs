// TRACE-155 (Phase 7.3B): concurrent provider-event receipts against the real database. Each
// call is its own psql session, so receipts race on the svix-id primary key, the ledger row
// locks and the expired-row locks. Proves exactly one receipt per svix-id under identical and
// differing concurrent deliveries (S-21, S-22), receipt and source deletion in both lock orders
// and in free races (S-58), and that concurrent purges never wait on each other (S-61). Run
// only against a disposable isolated database after a clean reset (CI runs it on the Phase 5
// synthetic stack). Synthetic data only; nothing is sent. Leaves fixtures; a clean reset
// follows in CI.
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
const as = (role, sub, statement) => `begin; set local role ${role};
set local request.jwt.claims = '${JSON.stringify({ role, sub })}';
${statement}; commit;`;
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error.message) }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = value => value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`;

function receiveCall(p) {
  return `select public.email_receive_provider_event(p_svix_id=>${q(p.id)},p_secret_slot=>'current',p_processing=>'recorded',
    p_event_type=>${q(p.type ?? 'email.delivered')},p_provider_type=>${q(p.type ?? 'email.delivered')},
    p_provider_created_at=>'2026-11-16T10:00:00Z',p_provider_email_id=>${q(p.email ?? null)},
    p_bounce_type=>${q(p.bounce ?? null)},p_bounce_subtype=>null,p_tag_status=>${q(p.tags ?? 'absent')},
    p_tag_ledger=>${q(p.ledger ?? null)},p_tag_ref=>${q(p.ref ?? null)},p_tag_attempt=>${p.attempt ?? 'null'})->>'result'`;
}
const receive = p => sql(as('service_role', null, receiveCall(p)));
/** The receive inside a transaction that stays open for `holdMs` after the call. */
const receiveHeld = (p, holdMs) => sql(`begin; set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
${receiveCall(p)}; select pg_sleep(${holdMs / 1000}); commit;`);

const operator = '7e550000-0000-4000-8000-000000000001';
const prefix = '7e551000-0000-4000-8000-';
const contactId = n => `${prefix}${String(n).padStart(12, '0')}`;

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await sql('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await sleep(1000); }
}
assert.equal(await sql(`select count(*) from public.contact_submissions where id::text like '${prefix}%'`), '0',
  'Reset the isolated database before rerunning provider-event fixtures.');
assert.equal(await sql(`select count(*) from private.email_provider_events`), '0', 'Start from an empty receipt table.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${operator}','evidence-concurrency-operator@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${operator}','admin') on conflict do nothing;`);
/** A saved contact submission whose owner-email row is an unknown attempt 1 (no provider ID). */
async function ledgerRow(n) {
  await sql(as('service_role', null, `insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
    values ('${contactId(n)}','Synthetic','Racer','evidence-racer@example.test',null,'Synthetic','Synthetic body')`));
  return sql(`update private.owner_email_notifications set state='unknown', attempts=1 where contact_submission_id='${contactId(n)}' returning id`);
}
const row = id => sql(`select coalesce(identity_class,'none')||'|'||coalesce(owner_email_notification::text,'none')||'|'||content_conflict
  ||'|'||coalesce(bounce_type,'none') from private.email_provider_events where svix_id='${id}'`);

// S-21: eight concurrent identical deliveries.
const same = { id: 'msg-s21', email: 'em-s21' };
const identical = await Promise.all(Array.from({ length: 8 }, () => receive(same)));
assert.equal(identical.filter(r => r === 'recorded').length, 1, 'S-21 one delivery records');
assert.equal(identical.filter(r => r === 'duplicate').length, 7, 'S-21 seven are duplicates');
assert.equal(await sql(`select count(*) from private.email_provider_events where svix_id='msg-s21'`), '1', 'S-21 one row');
console.log('S-21 PASS: 8 identical concurrent deliveries → 1 recorded, 7 duplicate, 1 row');

// S-22: eight concurrent deliveries under one svix-id with two different normalized contents.
for (let round = 1; round <= 5; round++) {
  const id = `msg-s22-${round}`;
  const contents = Array.from({ length: 8 }, (_, i) => i % 2 === 0
    ? { id, email: 'em-s22' }
    : { id, email: 'em-s22', type: 'email.bounced', bounce: 'permanent' });
  const results = await Promise.all(contents.map(p => receive(p)));
  assert.equal(results.filter(r => r === 'recorded').length, 1, `S-22 round ${round}: one records`);
  const winner = contents[results.indexOf('recorded')];
  const winnerIsBounce = winner.type === 'email.bounced';
  results.forEach((result, i) => {
    if (i === results.indexOf('recorded')) return;
    const sameContent = (contents[i].type === 'email.bounced') === winnerIsBounce;
    assert.equal(result, sameContent ? 'duplicate' : 'conflict', `S-22 round ${round}: caller ${i}`);
  });
  assert.equal(await sql(`select count(*) from private.email_provider_events where svix_id='${id}'`), '1');
  assert.equal(await row(id), `unmatched|none|true|${winnerIsBounce ? 'permanent' : 'none'}`,
    `S-22 round ${round}: the first committed content is kept and flagged`);
}
console.log('S-22 PASS: 5 rounds × 8 concurrent deliveries, 2 contents → 1 row with the first committed content, flag set, others duplicate/conflict');

// S-58: receipt linking to a ledger row while that row's source is deleted.
const tagged = (n, ref) => ({ id: `msg-s58-${n}`, email: `em-s58-${n}`, tags: 'valid', ledger: 'owner_email', ref, attempt: 1 });
const deleteSource = n => sql(`delete from public.contact_submissions where id='${contactId(n)}'`);
const deleteSourceHeld = (n, holdMs) => sql(`begin; delete from public.contact_submissions where id='${contactId(n)}';
  select pg_sleep(${holdMs / 1000}); commit;`);
async function settledOutcome(n, ref, result) {
  const id = `msg-s58-${n}`;
  const stored = await sql(`select coalesce(identity_class,'') from private.email_provider_events where svix_id='${id}'`);
  const sourceGone = (await sql(`select count(*) from private.owner_email_notifications where id='${ref}'`)) === '0';
  assert.ok(sourceGone, 'the source was deleted');
  assert.equal(await sql(`select count(*) from private.email_provider_events e where e.owner_email_notification is not null
    and not exists (select 1 from private.owner_email_notifications n where n.id = e.owner_email_notification)`), '0',
  'never a linked receipt to a missing row');
  if (result.ok) {
    // Committed linked before the delete (then cascaded away), or saw the row gone.
    assert.ok(stored === '' || stored === 'conflict_tag_invalid', `S-58 ${n}: committed receipt is gone or unlinked (${stored})`);
    return stored === '' ? 'linked_then_cascaded' : 'unlinked_after_delete';
  }
  assert.match(result.error, /23503|violates foreign key constraint/, `S-58 ${n}: the only failure is the FK race`);
  assert.equal(stored, '', `S-58 ${n}: a failed receive stored nothing`);
  assert.equal(await receive(tagged(n, ref)), 'recorded', `S-58 ${n}: the provider's retry records`);
  assert.equal(await sql(`select identity_class from private.email_provider_events where svix_id='msg-s58-${n}'`),
    'conflict_tag_invalid', `S-58 ${n}: the retry is conflict_tag_invalid`);
  return 'fk_failure_then_retry_unlinked';
}
const outcomes = {};
const count = outcome => { outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; };
// Deterministic order 1: the delete holds its row lock; the receipt's FK check waits, then fails.
{
  const ref = await ledgerRow(1);
  const deletion = deleteSourceHeld(1, 600);
  await sleep(200);
  const result = await settle(receive(tagged(1, ref)));
  await deletion;
  const outcome = await settledOutcome(1, ref, result);
  assert.equal(outcome, 'fk_failure_then_retry_unlinked', 'S-58 delete first: the receive fails with 23503 (5xx) and the retry is unlinked');
  count(outcome);
}
// Deterministic order 2: the receipt holds its FK row lock; the delete waits, then cascades it.
{
  const ref = await ledgerRow(2);
  const receipt = settle(receiveHeld(tagged(2, ref), 600));
  await sleep(200);
  await deleteSource(2);
  const result = await receipt;
  assert.ok(result.ok);
  const outcome = await settledOutcome(2, ref, result);
  assert.equal(outcome, 'linked_then_cascaded', 'S-58 receipt first: it commits linked and is cascade-deleted');
  count(outcome);
}
// Free races.
for (let n = 3; n <= 22; n++) {
  const ref = await ledgerRow(n);
  const [result] = await Promise.all([settle(receive(tagged(n, ref))), deleteSource(n)]);
  count(await settledOutcome(n, ref, result));
}
console.log(`S-58 PASS: receive vs source deletion, 2 forced orders + 20 free races → ${JSON.stringify(outcomes)}; never linked to a missing row, no receipt on failure`);

// S-61: two receives and an operator purge over the same 600 expired rows, overlapping.
await sql(`delete from private.email_provider_events;
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,identity_class)
select 'msg-s61-'||lpad(i::text,4,'0'), '2026-01-01'::timestamptz + i*interval '1 second' - interval '1 day',
       '2026-01-01'::timestamptz + i*interval '1 second', 'current','invalid_payload','other','unmatched'
  from generate_series(1,600) i;`);
for (let round = 1; round <= 3; round++) {
  if (round > 1) {
    await sql(`insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,identity_class)
      select 'msg-s61-'||${round}||'-'||lpad(i::text,4,'0'), '2026-01-01'::timestamptz + i*interval '1 second' - interval '1 day',
       '2026-01-01'::timestamptz + i*interval '1 second', 'current','invalid_payload','other','unmatched'
       from generate_series(1,600) i;`);
  }
  const held = (statement, role, sub) => sql(`begin; set local lock_timeout = '1s'; set local role ${role};
    set local request.jwt.claims = '${JSON.stringify({ role, sub })}'; ${statement}; select pg_sleep(1.5); commit;`);
  const started = Date.now();
  const [a, b, purge] = await Promise.all([
    settle(held(receiveCall({ id: `msg-s61-r${round}a`, email: 'em-s61' }), 'service_role', null)),
    settle(held(receiveCall({ id: `msg-s61-r${round}b`, email: 'em-s61' }), 'service_role', null)),
    sleep(100).then(() => settle(held('select public.email_provider_events_purge(1000)', 'authenticated', operator))),
  ]);
  const elapsed = Date.now() - started;
  for (const result of [a, b, purge]) assert.ok(result.ok, `S-61 round ${round}: no lock wait, timeout or deadlock: ${result.error}`);
  const report = JSON.parse(purge.value.split('\n')[0]);
  const left = Number(await sql(`select count(*) from private.email_provider_events where expires_at <= now()`));
  assert.equal(left, 0, `S-61 round ${round}: every expired row deleted`);
  assert.ok(report.deleted >= 400 && report.deleted <= 600, `S-61 round ${round}: the operator purge skipped rows the receives held (${report.deleted})`);
  // Each session holds its locks for 1.5 s, longer than its 1 s lock timeout, so any wait fails.
  assert.ok(elapsed < 4000, `S-61 round ${round}: overlapping, not serialized (${elapsed} ms)`);
  console.log(`S-61 round ${round}: operator purge deleted ${report.deleted}, receives ${600 - report.deleted}, ${elapsed} ms`);
}
console.log('S-61 PASS: concurrent receive and operator purges never wait (lock_timeout 1 s), each expired row deleted once, counts add up');

// TRACE-155 (7.3C-1), review 5926513941: an expired receipt that another transaction holds is
// skipped by the receipt-time purge, so a replay waits for that lock and answers duplicate. The
// receipt and its expiry stay as stored; the 7.3C readback excludes it as expired.
await sql(`delete from private.email_provider_events;
insert into private.email_provider_events(svix_id,received_at,expires_at,secret_slot,processing,event_type,provider_type,provider_created_at,provider_email_id,identity_class)
values ('msg-lock-target','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','current','recorded','email.delivered','email.delivered','2026-11-16T10:00:00Z','em-lock','unmatched');`);
{
  const holder = sql(`begin; select svix_id from private.email_provider_events where svix_id='msg-lock-target' for update;
    select pg_sleep(0.8); commit;`);
  await sleep(200);
  const replay = await receive({ id: 'msg-lock-target', email: 'em-lock' }).then(r => r.split('\n').at(-1));
  await holder;
  assert.equal(replay, 'duplicate', 'a replay of a locked expired receipt is not purged first: it answers duplicate');
  assert.equal(await sql(`select expires_at = '2026-01-02T00:00:00Z' and expires_at <= now() from private.email_provider_events where svix_id='msg-lock-target'`),
    't', 'the stored receipt keeps its original (passed) expiry');
  const counts = JSON.parse(await sql(as('authenticated', operator, 'select public.owner_email_evidence_counts()')));
  assert.equal(counts.unmatched_reports.total, 0, 'the readback does not count the expired receipt');
  assert.equal(counts.retention_backlog.expired, 1, 'only the backlog sees it');
}
console.log('Locked expired replay PASS: the purge skips the held row; the replay waits and answers duplicate; the readback excludes it');

// S-37 race (7.3C-1): a tagged callback racing the outcome record of the same claimed attempt,
// with the record committing the same provider ID or a different one. Never a link to another
// row; the readback trusts the receipt only when the IDs agree.
const claimed = async n => {
  await sql(as('service_role', null, `insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message)
    values ('${contactId(n)}','Synthetic','Racer','evidence-racer@example.test',null,'Synthetic','Synthetic body')`));
  const claim = JSON.parse(await sql(as('service_role', null, `select public.owner_email_claim('contact_submission','${contactId(n)}','initial')`)));
  const ref = await sql(`select id from private.owner_email_notifications where contact_submission_id='${contactId(n)}'`);
  return { claim: claim.claim_id, ref };
};
const racing = { tag_only: 0, tag_and_id: 0 };
for (let round = 0; round < 24; round++) {
  const n = 200 + round;
  const agree = round % 2 === 0;
  const { claim, ref } = await claimed(n);
  const email = `em-s37-${round}`;
  const recordId = agree ? email : `${email}-other`;
  const [received, recorded] = await Promise.all([
    settle(receive({ id: `msg-s37-${round}`, email, tags: 'valid', ledger: 'owner_email', ref, attempt: 1 })),
    settle(sql(as('service_role', null, `select public.owner_email_record('contact_submission','${contactId(n)}','${claim}','sent','${recordId}',null)`))),
  ]);
  assert.ok(received.ok && recorded.ok, `S-37 round ${round}: both commit (${received.error ?? recorded.error ?? ''})`);
  const [cls, linked] = (await sql(`select identity_class||'|'||coalesce(owner_email_notification::text,'none')
    from private.email_provider_events where svix_id='msg-s37-${round}'`)).split('|');
  assert.ok(cls === 'tag_only' || cls === 'tag_and_id', `S-37 round ${round}: linked by its tag (${cls})`);
  assert.equal(linked, ref, `S-37 round ${round}: linked to its own row, never another`);
  if (agree) racing[cls] += 1; else assert.equal(cls, 'tag_only', `S-37 round ${round}: a different ID can only be recorded as tag_only`);
  const item = JSON.parse(await sql(as('authenticated', operator,
    `select public.owner_email_evidence('contact_submission', array['${contactId(n)}']::uuid[])`))).items[0];
  if (agree) {
    assert.equal(item.summary.rule, 4, `S-37 round ${round}: same ID → trusted, rule 4`);
    assert.equal(item.has_conflict, false);
  } else {
    assert.equal(item.summary.rule, 10, `S-37 round ${round}: different ID → excluded`);
    assert.deepEqual(item.conflict_reasons, ['current_conflict'], `S-37 round ${round}: as a current conflict`);
  }
}
console.log(`S-37 race PASS: 24 rounds (12 agreeing, 12 differing); agreeing receipts linked ${JSON.stringify(racing)}, all trusted; differing ones always current_conflict; never linked to another row`);
console.log('email provider events concurrency PASS');
