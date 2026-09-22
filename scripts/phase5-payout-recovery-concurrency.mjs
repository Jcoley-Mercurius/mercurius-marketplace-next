// Synthetic-only concurrency proof for TRACE-080; reset the isolated database afterward.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", "supabase_db_mercurius-phase5-isolated", "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))));
    child.stdin.end(source);
  });
}
const operatorA = "a8010000-0000-4000-8000-000000000002";
const operatorB = "a8010000-0000-4000-8000-000000000003";
// Each call is its own signed-in session on the authenticated role, as a browser would be.
const as = (user, body, name = "") =>
  sql(`begin; ${name ? `set application_name='${name}';` : ""}
 do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, message: String(error.message).trim() }));
async function waitForSleep(name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`)) === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out establishing concurrent lock holder");
}
const approved = async (requestSql) => {
  const request = await as(operatorA, `select (${requestSql})->>'request_id';`);
  await as(operatorB, `select public.money_operator_approve_review('${request}','Synthetic approval');`);
  return request;
};
const run = (request, user = operatorA) => as(user, `select public.money_operator_execute_review('${request}');`);
const batch = (days, obligations, key) =>
  `public.money_operator_request_ach(current_date+${days},array[${obligations.map((id) => `'${id}'::uuid`).join(",")}],'BANK-${key}','Synthetic weekly ACH','${key}')`;
const attemptOf = (obligation) =>
  sql(`select a.id from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id where i.obligation_id='${obligation}'
    and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) order by a.attempt_number desc limit 1`);
const record = (attempt, status, reference, key) =>
  `select public.money_operator_record_ach('${attempt}','${status}',${reference ? `'${reference}'` : "null"},'Synthetic bank evidence','${key}');`;
const recovery = (obligation, kind, amount, key) =>
  `public.money_operator_request_payout_recovery('${obligation}','${kind}',${amount},'Synthetic recovery','Synthetic bank credit','${key}')`;
const owed = (obligation) => sql(`select private.money_payout_owed('${obligation}')`);

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/047_phase5_payout_recovery.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_rec_${label}'`);
const recoverRace = await obligation("race_recover");
const lateRace = await obligation("race_late");
const batchRace = await obligation("race_batch");
assert.match(recoverRace, /^[0-9a-f-]{36}$/);

// Weeks start at +210 days, after the TRACE-078 (+70 to +98) and TRACE-079 (+140 to +154)
// scripts: CI runs all three on one database.
await run(await approved(batch(210, [recoverRace, lateRace, batchRace], "rec-race-batch")));
const recoverAttempt = await attemptOf(recoverRace);
await as(operatorA, record(recoverAttempt, "submitted", "REC-RACE-RECOVER", "rec-race-recover-sub") + record(recoverAttempt, "settled", null, "rec-race-recover-set"));
// A settled payout refunded 2000 of service: the provider owes 1700.
await as(operatorA, `select public.money_operator_request_refund('${recoverRace}','pi_rec_race_recover',2000,0,0,'Ticket','Rework','rec-race-refund-req');`);
const refundRequest = await sql(`select id from public.money_review_requests where business_key='rec-race-refund-req'`);
await as(operatorB, `select public.money_operator_approve_review('${refundRequest}','Synthetic approval');`);
await run(refundRequest);
await sql(`do $$ declare a uuid; begin
  select id into strict a from public.money_refund_authorizations where obligation_id='${recoverRace}';
  perform public.money_prepare_refund(a,'${operatorA}');
  perform public.money_receive_event('evt_rec_race_refund','refund',jsonb_build_object('authorization_id',a,'refund_id','re_rec_race','payment_id','pi_rec_race_recover','amount',2000,'currency','usd'));
  if public.money_process_event('evt_rec_race_refund')<>'processed' then raise exception 'Fixture refund failed'; end if;
end $$;`);
assert.equal(await owed(recoverRace), "1700");

// 1. Three runs each of two approved recoveries of the whole amount owed, one a repayment and one
// a write-off: one is recorded; the other is refused because the amount owed changed.
const repay = await approved(recovery(recoverRace, "repayment", 1700, "rec-race-repay"));
const writeOff = await approved(recovery(recoverRace, "write_off", 1700, "rec-race-writeoff"));
const recoverRuns = await Promise.all([repay, repay, repay, writeOff, writeOff, writeOff].map((request) => settle(run(request))));
assert(recoverRuns.every((result) => result.ok || /not actionable: (owed_changed|nothing_owed)/.test(result.message)), JSON.stringify(recoverRuns));
assert.equal(await sql(`select count(*) from public.money_payout_recoveries where obligation_id='${recoverRace}'`), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id in ('${repay}','${writeOff}')`), "1");
assert.equal(await owed(recoverRace), "0");
assert.equal(await sql(`select count(*) from public.money_journals where obligation_id='${recoverRace}' and kind in ('payout_repayment','payout_write_off')`), "1");

// 2. A late payment of a withdrawn transfer holding the lock while an operator records its
// replacement's submission: the late payment is recorded and the submission is refused, so the
// replacement is never recorded as sent.
const withdrawnAttempt = await attemptOf(lateRace);
await run(await approved(`public.money_operator_request_ach_withdrawal('${withdrawnAttempt}','Synthetic withdrawal','Synthetic bank portal shows nothing sent','rec-race-late-w')`));
await run(await approved(batch(217, [lateRace], "rec-race-late-replace")));
const replacement = await attemptOf(lateRace);
assert.notEqual(replacement, withdrawnAttempt);
const late = await approved(`public.money_operator_request_ach_late_settlement('${withdrawnAttempt}','REC-RACE-LATE','Bank paid it','Synthetic statement line','rec-race-late')`);
const lateHolder = settle(as(operatorA, `select public.money_operator_execute_review('${late}'); select pg_sleep(2);`, "payout-recovery-late"));
await waitForSleep("payout-recovery-late");
const lateRuns = await Promise.all([settle(as(operatorB, record(replacement, "submitted", "REC-RACE-LATE-2", "rec-race-late-sub"))), lateHolder]);
assert(lateRuns[1].ok, "The late payment is recorded");
assert(!lateRuns[0].ok && /not recordable: already_paid/.test(lateRuns[0].message), JSON.stringify(lateRuns));
assert.equal(await sql(`select status from public.money_ach_attempts where id='${replacement}'`), "prepared");
assert.equal(await owed(lateRace), "0");

// 3. A late payment of a withdrawn transfer holding the lock while an approved batch prepares its
// replacement: the batch is refused because the payout is already paid, and no replacement exists.
const batchAttempt = await attemptOf(batchRace);
await run(await approved(`public.money_operator_request_ach_withdrawal('${batchAttempt}','Synthetic withdrawal','Synthetic bank portal shows nothing sent','rec-race-batch-w')`));
const replaceBatch = await approved(batch(224, [batchRace], "rec-race-batch-replace"));
const batchLate = await approved(`public.money_operator_request_ach_late_settlement('${batchAttempt}','REC-RACE-BATCH','Bank paid it','Synthetic statement line','rec-race-batch-late')`);
const batchHolder = settle(as(operatorA, `select public.money_operator_execute_review('${batchLate}'); select pg_sleep(2);`, "payout-recovery-batch"));
await waitForSleep("payout-recovery-batch");
const batchRuns = await Promise.all([settle(run(replaceBatch)), batchHolder]);
assert(batchRuns[1].ok, "The late payment is recorded");
assert(!batchRuns[0].ok && /not actionable: already_paid/.test(batchRuns[0].message), JSON.stringify(batchRuns));
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${batchRace}'`), "1");
assert.equal(await sql("select count(*) from public.money_ach_batches where period_start=current_date+224"), "0");

// No payout is on two live statements, and every race payout reconciles.
assert.equal(await sql(`select count(*) from (select i.obligation_id from public.money_ach_items i
  where not exists(select 1 from public.money_ach_withdrawals w where w.item_id=i.id) group by 1 having count(*)>1) x`), "0");
for (const id of [recoverRace, lateRace, batchRace]) {
  assert.equal(await sql(`select private.money_obligation_reconciliation('${id}',now())->>'issues'`), "[]", id);
}
console.log("PASS: one recovery from six runs of two approved recoveries of the whole amount owed; a late payment holding the lock refused its replacement's submission; a late payment holding the lock refused a replacement batch. Reset isolated synthetic fixtures afterward.");
