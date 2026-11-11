// TRACE-151 (with TRACE-104's ledger): concurrent claims, outcome records and operator
// resend requests for one vendor-application owner notification. Each call is its own
// psql session, so claims race on the ledger row lock. Proves one claim (one send) per
// permitted attempt, an operator resend as a distinct attempt, and no resend authority for
// anonymous or non-operator callers. Run only against a disposable isolated database
// after a clean reset (CI runs it on the Phase 5 synthetic stack). Synthetic data only;
// nothing is sent. Leaves fixtures; a clean reset follows in CI.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
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
const service = statement => sql(as('service_role', null, statement));
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error.message) }));

const app = '7a510000-0000-4000-8000-000000000001';
const operator = '7a500000-0000-4000-8000-000000000001';
const member = '7a500000-0000-4000-8000-000000000002';

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await sql('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
}
assert.equal(await sql(`select count(*) from public.vendor_applications where id='${app}'`), '0', 'Reset the isolated database before rerunning notification fixtures.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${operator}','notification-operator@example.test',now(),'{}'),('${member}','notification-member@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${operator}','admin');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,years_experience,services,status,document_urls)
 values ('${app}','Synthetic Concurrency Co','Syn','Thetic','notification-applicant@example.test','synthetic',2,'{lawn-mowing}','pending','{}');`);
const ledger = async () => (await sql(`select state||':'||attempts from private.r0_application_notifications where application_id='${app}'`));
const sendingEvents = async () => Number(await sql(`select count(*) from private.r0_application_notification_events where application_id='${app}' and state='sending'`));
assert.equal(await ledger(), 'pending:0', 'the saved application has its pending notification record');

// 1. Eight concurrent initial claims: exactly one holds attempt 1.
const claim = mode => service(`select public.r0_claim_application_notification('${app}','${mode}')`).then(JSON.parse);
const initial = await Promise.all(Array.from({ length: 8 }, () => claim('initial')));
const winners = initial.filter(result => result.claimed);
assert.equal(winners.length, 1, 'one concurrent initial claim wins');
assert.equal(winners[0].attempt, 1);
assert.ok(initial.filter(result => !result.claimed).every(result => result.state === 'sending'));
assert.equal(await ledger(), 'sending:1');
assert.equal(await sendingEvents(), 1);

// 2. Concurrent outcome records for that claim: one is recorded; the rest are not current.
const record = (claimId, outcome) => service(`select public.r0_record_application_notification('${app}','${claimId}','${outcome}',null,'Resend returned 422: synthetic')`);
const records = await Promise.all(Array.from({ length: 4 }, () => settle(record(winners[0].claim_id, 'failed'))));
assert.equal(records.filter(result => result.ok).length, 1, 'one outcome is recorded for a claim');
assert.ok(records.filter(result => !result.ok).every(result => /Notification claim is not current/.test(result.error)));
assert.equal(await ledger(), 'failed:1');

// 3. Repeated initial claims after the outcome add no attempt.
const repeated = await Promise.all(Array.from({ length: 4 }, () => claim('initial')));
assert.ok(repeated.every(result => !result.claimed && result.state === 'failed'));
assert.equal(await ledger(), 'failed:1');

// 4. Anonymous and non-operator callers gain no resend authority.
const request = (role, sub) => settle(sql(as(role, sub, `select public.r0_request_application_notification_resend('${app}')`)));
const anonymous = await request('anon', null);
assert.ok(!anonymous.ok && /permission denied/.test(anonymous.error), 'anon cannot execute the resend request');
const nonOperator = await request('authenticated', member);
assert.ok(!nonOperator.ok && /Onboarding operator required/.test(nonOperator.error), 'a non-operator is refused');
const serviceOverview = await settle(sql(as('anon', null, 'select public.r0_application_notification_overview()')));
assert.ok(!serviceOverview.ok, 'anon cannot read the notification overview');
assert.equal(await ledger(), 'failed:1');

// 5. Concurrent operator resend requests permit one more attempt, idempotently.
const requests = await Promise.all(Array.from({ length: 6 }, () => request('authenticated', operator)));
assert.ok(requests.every(result => result.ok && JSON.parse(result.value).state === 'resend_requested'));
assert.equal(await ledger(), 'resend_requested:1');

// 6. Concurrent claims for that resend (mixed with stale initial claims): one claim, attempt 2.
const mixed = await Promise.all([...Array.from({ length: 6 }, () => claim('resend')), ...Array.from({ length: 3 }, () => claim('initial'))]);
const resendWinners = mixed.filter(result => result.claimed);
assert.equal(resendWinners.length, 1, 'one resend claim wins');
assert.equal(resendWinners[0].attempt, 2, 'the authorized resend is a distinct attempt');
assert.notEqual(resendWinners[0].claim_id, winners[0].claim_id);
assert.equal(await sendingEvents(), 2);

// 7. While that attempt is in flight, an operator cannot open another.
const duringSend = await request('authenticated', operator);
assert.ok(!duringSend.ok && /cannot be resent from sending/.test(duringSend.error));

// 8. The stale first claim cannot overwrite the current attempt's outcome.
const stale = await settle(record(winners[0].claim_id, 'sent'));
assert.ok(!stale.ok && /Notification claim is not current/.test(stale.error));
assert.ok((await settle(record(resendWinners[0].claim_id, 'sent'))).ok);
assert.equal(await ledger(), 'sent:2');
const afterSent = await request('authenticated', operator);
assert.ok(!afterSent.ok && /cannot be resent from sent/.test(afterSent.error), 'a sent notification cannot be resent');
assert.equal(await sendingEvents(), 2, 'two attempts in total: the initial one and the authorized resend');

console.log('Application notification concurrency: PASS (8 initial claims → 1; 4 records → 1; 6 resend requests → 1 attempt; 9 mixed claims → 1; no anon/non-operator authority).');
