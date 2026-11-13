// TRACE-154 (Phase 7.2C-1, extended in 7.2C-2): concurrent claims, outcome records and operator
// commands for contact-submission and provider renewal-document owner emails, against the real
// database. Each call is its own psql
// session, so claims race on the ledger row lock. Proves one claim (one send) per permitted
// attempt, operator resends as distinct attempts, no authority for anonymous or non-operator
// callers, and that a claim which commits while its client is lost is never re-claimed
// automatically and needs an attested operator resend. Run only against a disposable isolated
// database after a clean reset (CI runs it on the Phase 5 synthetic stack). Synthetic data
// only; nothing is sent. Leaves fixtures; a clean reset follows in CI.
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
const service = statement => sql(as('service_role', null, statement));
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error.message) }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const first = '7c510000-0000-4000-8000-000000000001';
const lost = '7c510000-0000-4000-8000-000000000002';
const operator = '7c500000-0000-4000-8000-000000000001';
const member = '7c500000-0000-4000-8000-000000000002';

for (let attempt = 0; ; attempt++) {
  try { assert.equal(await sql('select 1'), '1'); break; }
  catch (error) { if (attempt === 29) throw error; await sleep(1000); }
}
assert.equal(await sql(`select count(*) from public.contact_submissions where id in ('${first}','${lost}')`), '0',
  'Reset the isolated database before rerunning owner-email fixtures.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${operator}','owner-email-operator@example.test',now(),'{}'),('${member}','owner-email-member@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${operator}','admin') on conflict do nothing;`);
// The route's service-key insert; the trigger adds the pending ledger row in the same statement.
await service(`insert into public.contact_submissions(id,first_name,last_name,email,phone,subject,message) values
 ('${first}','Synthetic','Racer','owner-email-racer@example.test',null,'Synthetic concurrency','Synthetic body'),
 ('${lost}','Synthetic','Lost','owner-email-lost@example.test',null,'Synthetic lost response','Synthetic body')`);
const ledger = async id => sql(`select state||':'||attempts from private.owner_email_notifications where contact_submission_id='${id}'`);
const sendingEvents = async id => Number(await sql(`select count(*) from private.owner_email_notification_events e
 join private.owner_email_notifications n on n.id=e.notification_id where n.contact_submission_id='${id}' and e.state='sending'`));
assert.equal(await ledger(first), 'pending:0', 'the saved submission has its pending ledger row');

const claim = (id, mode) => service(`select public.owner_email_claim('contact_submission','${id}','${mode}')`).then(JSON.parse);
const record = (id, claimId, outcome, code) => service(`select public.owner_email_record('contact_submission','${id}','${claimId}','${outcome}',null,${code ? `'${code}'` : 'null'})`);
const resend = (role, sub, id, confirm) => settle(sql(as(role, sub, `select public.owner_email_request_resend('contact_submission','${id}',${confirm})`)));
const acknowledge = (role, sub, id) => settle(sql(as(role, sub, `select public.owner_email_acknowledge('contact_submission','${id}','Synthetic reason',true)`)));

// 9. Eight concurrent initial claims: exactly one holds attempt 1.
const initial = await Promise.all(Array.from({ length: 8 }, () => claim(first, 'initial')));
const winners = initial.filter(result => result.claimed);
assert.equal(winners.length, 1, 'one concurrent initial claim wins');
assert.equal(winners[0].attempt, 1);
assert.ok(initial.filter(result => !result.claimed).every(result => result.state === 'sending'));
assert.equal(await sendingEvents(first), 1);

// 9. Four concurrent records for that claim: one is recorded; the rest are not current.
const records = await Promise.all(Array.from({ length: 4 }, () => settle(record(first, winners[0].claim_id, 'failed', 'provider_refused'))));
assert.equal(records.filter(result => result.ok).length, 1, 'one outcome is recorded for a claim');
assert.ok(records.filter(result => !result.ok).every(result => /Owner email claim is not current/.test(result.error)));
assert.equal(await ledger(first), 'failed:1');
assert.ok((await Promise.all(Array.from({ length: 4 }, () => claim(first, 'initial')))).every(result => !result.claimed && result.state === 'failed'),
  'no automatic retry after a failure');

// Anonymous and non-operator callers gain no authority.
const anonymous = await resend('anon', null, first, true);
assert.ok(!anonymous.ok && /permission denied/.test(anonymous.error), 'anon cannot execute the resend request');
const nonOperator = await resend('authenticated', member, first, true);
assert.ok(!nonOperator.ok && /Onboarding operator required/.test(nonOperator.error), 'a non-operator is refused');
const memberClaim = await settle(sql(as('authenticated', member, `select public.owner_email_claim('contact_submission','${first}','resend')`)));
assert.ok(!memberClaim.ok && /permission denied/.test(memberClaim.error), 'a signed-in user cannot claim');
const anonOverview = await settle(sql(as('anon', null, 'select public.owner_email_overview()')));
assert.ok(!anonOverview.ok, 'anon cannot read the overview');
assert.equal(await ledger(first), 'failed:1');

// 10. Six concurrent operator resend requests permit one more attempt, idempotently.
const requests = await Promise.all(Array.from({ length: 6 }, () => resend('authenticated', operator, first, false)));
assert.ok(requests.every(result => result.ok && JSON.parse(result.value).state === 'resend_requested'));
assert.equal(await ledger(first), 'resend_requested:1');

// 10. Mixed resend claims and stale initial claims: one claim, attempt 2.
const mixed = await Promise.all([...Array.from({ length: 6 }, () => claim(first, 'resend')), ...Array.from({ length: 3 }, () => claim(first, 'initial'))]);
const resendWinners = mixed.filter(result => result.claimed);
assert.equal(resendWinners.length, 1, 'one resend claim wins');
assert.equal(resendWinners[0].attempt, 2, 'the authorized resend is a distinct attempt');
assert.notEqual(resendWinners[0].claim_id, winners[0].claim_id);
const duringSend = await resend('authenticated', operator, first, true);
assert.ok(!duringSend.ok && /cannot be resent from sending/.test(duringSend.error), 'no second resend while one is in flight');
const stale = await settle(record(first, winners[0].claim_id, 'sent'));
assert.ok(!stale.ok && /Owner email claim is not current/.test(stale.error), 'a stale worker cannot overwrite');
assert.ok((await settle(record(first, resendWinners[0].claim_id, 'sent'))).ok);
assert.equal(await ledger(first), 'sent:2');
assert.equal(await sendingEvents(first), 2, 'two sends in total: the initial attempt and the authorized resend');

// Clarification 1: a claim commits but its client is lost before reading the response.
const doomed = spawn('docker', psqlArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
doomed.stdin.end(`${as('service_role', null, `select public.owner_email_claim('contact_submission','${lost}','initial')`)}
select pg_sleep(60);`);
for (let tries = 0; (await ledger(lost)) !== 'sending:1'; tries++) {
  assert.ok(tries < 100, 'the claim committed');
  await sleep(100);
}
doomed.kill('SIGKILL');
await sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(60)%' and pid <> pg_backend_pid()`);
assert.equal(await ledger(lost), 'sending:1', 'the committed claim stays sending; nothing reset it');
const afterLoss = await Promise.all(Array.from({ length: 6 }, () => claim(lost, 'initial')));
assert.ok(afterLoss.every(result => !result.claimed && result.state === 'sending'), 'no automatic second claim');
const earlyResend = await resend('authenticated', operator, lost, true);
assert.ok(!earlyResend.ok && /cannot be resent from sending/.test(earlyResend.error), 'no resend inside the claim window');
await sql(`update private.owner_email_notifications set claimed_at=now()-interval '11 minutes' where contact_submission_id='${lost}'`);
assert.ok((await Promise.all(Array.from({ length: 4 }, () => claim(lost, 'initial')))).every(result => !result.claimed && result.state === 'unknown'),
  'past the window it reads unknown and is still never claimed automatically');
const blind = await resend('authenticated', operator, lost, false);
assert.ok(!blind.ok && /confirm no matching email/.test(blind.error), 'an unknown email needs the no-email attestation');
const blindAck = await settle(sql(as('authenticated', operator, `select public.owner_email_acknowledge('contact_submission','${lost}','Synthetic reason',false)`)));
assert.ok(!blindAck.ok && /before acknowledging an uncertain email/.test(blindAck.error), 'and acknowledgement needs the inbox-check attestation');
const attested = await Promise.all(Array.from({ length: 4 }, () => resend('authenticated', operator, lost, true)));
assert.ok(attested.every(result => result.ok), 'attested resend requests are idempotent');
const recovery = (await Promise.all(Array.from({ length: 5 }, () => claim(lost, 'resend')))).filter(result => result.claimed);
assert.equal(recovery.length, 1);
assert.equal(recovery[0].attempt, 2, 'the recovery is attempt 2 with a new claim');
assert.equal(await sql(`select attestation from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
 where n.contact_submission_id='${lost}' and e.state='resend_requested'`), 'no_matching_email_found');
assert.equal(await sendingEvents(lost), 2);

// Concurrent acknowledgements of one failed row: one transition.
await record(lost, recovery[0].claim_id, 'failed', 'provider_rate_limited');
const acks = await Promise.all(Array.from({ length: 5 }, () => acknowledge('authenticated', operator, lost)));
assert.ok(acks.every(result => result.ok));
assert.equal(await sql(`select count(*) from private.owner_email_notification_events e join private.owner_email_notifications n on n.id=e.notification_id
 where n.contact_submission_id='${lost}' and e.state='acknowledged'`), '1', 'one acknowledgement event');

// 7.2C-2: provider renewal documents --------------------------------------------------------
const vendor = '7c500000-0000-4000-8000-000000000003';
const provider = '7c520000-0000-4000-8000-000000000001';
const rpath = n => `renewals/${provider}/${n < 10 ? 'license' : 'insurance'}/7c530000-0000-4000-8000-${String(n).padStart(12, '0')}-synthetic.pdf`;
assert.equal(await sql(`select count(*) from public.contractors where id='${provider}'`), '0',
  'Reset the isolated database before rerunning renewal owner-email fixtures.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('${vendor}','owner-email-renewal-vendor@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${vendor}','vendor') on conflict do nothing;
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values ('${provider}','Synthetic Renewal Racer',true,false,'${vendor}');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls)
 values ('7c540000-0000-4000-8000-000000000001','Synthetic Renewal Racer','Test','Racer','owner-email-renewal-racer@example.test','synthetic','${provider}','{}');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 values ('${provider}',(select id from public.vendor_application_versions where application_id='7c540000-0000-4000-8000-000000000001'),1,'active');
insert into storage.objects(bucket_id,name,metadata) select 'vendor-documents',p,'{"size":2048,"mimetype":"application/pdf"}'::jsonb
 from unnest(array['${rpath(1)}','${rpath(2)}','${rpath(10)}']) p;`);
const submit = (sub, path, contractor) => settle(sql(as('authenticated', sub,
  `select public.vendor_submit_renewal_document('${path}'${contractor ? `,'${contractor}'` : ''})`)).then(JSON.parse));
const rledger = async id => sql(`select coalesce((select state||':'||attempts from private.owner_email_notifications where renewal_document_id='${id}'),'none')`);
const rcount = async (id, state) => Number(await sql(`select count(*) from private.owner_email_notification_events e
 join private.owner_email_notifications n on n.id=e.notification_id where n.renewal_document_id='${id}' and e.state='${state}'`));
const rclaim = (id, mode) => service(`select public.owner_email_claim('renewal_document','${id}','${mode}')`).then(JSON.parse);
const rrecord = (id, claimId, outcome, code) => service(`select public.owner_email_record('renewal_document','${id}','${claimId}','${outcome}',null,${code ? `'${code}'` : 'null'})`);
const rresend = (sub, id, confirm) => settle(sql(as('authenticated', sub, `select public.owner_email_request_resend('renewal_document','${id}',${confirm})`)));

// Eight concurrent provider submissions of one upload: one document, one ledger row, one creation event.
const submissions = await Promise.all(Array.from({ length: 8 }, () => submit(vendor, rpath(1))));
assert.ok(submissions.every(result => result.ok), 'every racing submission answers (one records, the rest replay)');
assert.equal(submissions.filter(result => result.value.recorded).length, 1, 'one submission is recorded');
const doc = submissions[0].value.document_id;
assert.ok(submissions.every(result => result.value.document_id === doc && result.value.submitted_as === 'provider'));
assert.equal(await rledger(doc), 'pending:0', 'the provider submission has exactly one pending row');
assert.equal(await rcount(doc, 'pending'), 1, 'one creation event despite the replays');

// An operator upload on the provider's behalf creates no ledger row.
const operatorUpload = await submit(operator, rpath(10), provider);
assert.ok(operatorUpload.ok && operatorUpload.value.recorded && operatorUpload.value.submitted_as === 'operator');
assert.equal(await rledger(operatorUpload.value.document_id), 'none', 'an operator upload notifies nobody');

// Eight concurrent initial claims: one; four concurrent records: one.
const rInitial = await Promise.all(Array.from({ length: 8 }, () => rclaim(doc, 'initial')));
const rWinners = rInitial.filter(result => result.claimed);
assert.equal(rWinners.length, 1, 'one concurrent renewal claim wins');
assert.equal(rWinners[0].kind, 'renewal_document');
assert.equal(rWinners[0].source.business_name, 'Synthetic Renewal Racer');
assert.deepEqual(Object.keys(rWinners[0].source).sort(), ['business_name', 'created_at', 'id', 'kind'], 'no file name or path in the payload');
const rRecords = await Promise.all(Array.from({ length: 4 }, () => settle(rrecord(doc, rWinners[0].claim_id, 'unknown', 'provider_server_error'))));
assert.equal(rRecords.filter(result => result.ok).length, 1, 'one outcome is recorded for the renewal claim');
assert.equal(await rledger(doc), 'unknown:1');

// Anonymous, the provider itself and non-operators gain no authority over the renewal row.
const anonRenewal = await settle(sql(as('anon', null, `select public.owner_email_request_resend('renewal_document','${doc}',true)`)));
assert.ok(!anonRenewal.ok && /permission denied/.test(anonRenewal.error), 'anon cannot request a renewal resend');
for (const sub of [vendor, member]) {
  const refused = await rresend(sub, doc, true);
  assert.ok(!refused.ok && /Onboarding operator required/.test(refused.error), 'the provider or a member cannot request a renewal resend');
}
const vendorClaim = await settle(sql(as('authenticated', vendor, `select public.owner_email_claim('renewal_document','${doc}','resend')`)));
assert.ok(!vendorClaim.ok && /permission denied/.test(vendorClaim.error), 'the provider cannot claim its own renewal email');
assert.equal(await rledger(doc), 'unknown:1');

// Unknown needs the attestation; six attested requests permit one attempt.
const rBlind = await rresend(operator, doc, false);
assert.ok(!rBlind.ok && /confirm no matching email/.test(rBlind.error), 'an unknown renewal email needs the no-email attestation');
const rRequests = await Promise.all(Array.from({ length: 6 }, () => rresend(operator, doc, true)));
assert.ok(rRequests.every(result => result.ok && JSON.parse(result.value).state === 'resend_requested'));
const rMixed = await Promise.all([...Array.from({ length: 6 }, () => rclaim(doc, 'resend')), ...Array.from({ length: 3 }, () => rclaim(doc, 'initial'))]);
const rResendWinners = rMixed.filter(result => result.claimed);
assert.equal(rResendWinners.length, 1, 'one renewal resend claim wins');
assert.equal(rResendWinners[0].attempt, 2);
const rStale = await settle(rrecord(doc, rWinners[0].claim_id, 'sent'));
assert.ok(!rStale.ok && /Owner email claim is not current/.test(rStale.error), 'a stale renewal worker cannot overwrite');
assert.ok((await settle(rrecord(doc, rResendWinners[0].claim_id, 'sent'))).ok);
assert.equal(await rledger(doc), 'sent:2');
assert.equal(await rcount(doc, 'sending'), 2, 'two renewal sends in total');

// A renewal claim commits but its client is lost before reading the response.
const lostSubmission = await submit(vendor, rpath(2));
const lostDoc = lostSubmission.value.document_id;
const rDoomed = spawn('docker', psqlArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
rDoomed.stdin.end(`${as('service_role', null, `select public.owner_email_claim('renewal_document','${lostDoc}','initial')`)}
select pg_sleep(60);`);
for (let tries = 0; (await rledger(lostDoc)) !== 'sending:1'; tries++) {
  assert.ok(tries < 100, 'the renewal claim committed');
  await sleep(100);
}
rDoomed.kill('SIGKILL');
await sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(60)%' and pid <> pg_backend_pid()`);
assert.ok((await Promise.all(Array.from({ length: 6 }, () => rclaim(lostDoc, 'initial')))).every(result => !result.claimed && result.state === 'sending'),
  'no automatic second renewal claim');
await sql(`update private.owner_email_notifications set claimed_at=now()-interval '11 minutes' where renewal_document_id='${lostDoc}'`);
assert.ok((await Promise.all(Array.from({ length: 4 }, () => rclaim(lostDoc, 'initial')))).every(result => !result.claimed && result.state === 'unknown'));
const rAttested = await Promise.all(Array.from({ length: 4 }, () => rresend(operator, lostDoc, true)));
assert.ok(rAttested.every(result => result.ok));
const rRecovery = (await Promise.all(Array.from({ length: 5 }, () => rclaim(lostDoc, 'resend')))).filter(result => result.claimed);
assert.equal(rRecovery.length, 1);
assert.equal(rRecovery[0].attempt, 2, 'the renewal recovery is attempt 2');
assert.equal(await rcount(lostDoc, 'sending'), 2);

console.log('Owner email concurrency: PASS (8 initial claims → 1; 4 records → 1; 6 resend requests → 1 attempt; 9 mixed claims → 1; lost committed claim → no automatic claim, attested recovery as attempt 2; 5 acknowledgements → 1; no anon/non-operator authority). Renewal: 8 racing submissions → 1 document/1 row; operator upload → no row; 8 claims → 1; 4 records → 1; 6 attested requests → 1 attempt; stale worker refused; lost committed claim → attested recovery as attempt 2; no anon/vendor/member authority).');
