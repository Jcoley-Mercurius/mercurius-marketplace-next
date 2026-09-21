// Synthetic-only concurrency proof for TRACE-079; reset the isolated database afterward.
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
const operatorA = "a7910000-0000-4000-8000-000000000002";
const operatorB = "a7910000-0000-4000-8000-000000000003";
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
const withdrawal = (attempt, key) =>
  `public.money_operator_request_ach_withdrawal('${attempt}','Synthetic withdrawal','Synthetic bank portal shows nothing sent','${key}')`;
// The newest statement item's latest attempt.
const attemptOf = (obligation) =>
  sql(`select a.id from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id where i.obligation_id='${obligation}'
    and not exists(select 1 from public.money_ach_items n where n.replaces_item_id=i.id) order by a.attempt_number desc limit 1`);
const record = (attempt, status, reference, key) =>
  `select public.money_operator_record_ach('${attempt}','${status}',${reference ? `'${reference}'` : "null"},'Synthetic bank evidence','${key}');`;

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/046_phase5_ach_replacement.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_rep_${label}'`);
const submitRace = await obligation("race_submit");
const submitFirst = await obligation("race_submit_first");
const twice = await obligation("race_twice");
const retryRace = await obligation("race_retry");
const replaceRace = await obligation("race_replace");
assert.match(submitRace, /^[0-9a-f-]{36}$/);

// Weeks start at +140 days, after the TRACE-078 script's (+70 to +98): CI runs both on one database.
// Put every race payout on one statement, and fail the one the retry race needs.
await run(await approved(batch(140, [submitRace, submitFirst, twice, retryRace, replaceRace], "rep-race-batch")));
const retryAttempt = await attemptOf(retryRace);
await as(operatorA, record(retryAttempt, "submitted", "REP-RACE-RETRY", "rep-race-retry-sub") + record(retryAttempt, "failed", null, "rep-race-retry-failed"));

// 1. A withdrawal holding the lock while an operator records the submission: the transfer is
// withdrawn and the submission is refused, so nothing is recorded as sent.
const submitAttempt = await attemptOf(submitRace);
const holdWithdrawal = await approved(withdrawal(submitAttempt, "rep-race-submit"));
const withdrawHolder = settle(as(operatorA, `select public.money_operator_execute_review('${holdWithdrawal}'); select pg_sleep(2);`, "ach-replace-withdraw"));
await waitForSleep("ach-replace-withdraw");
const submitRuns = await Promise.all([settle(as(operatorB, record(submitAttempt, "submitted", "REP-RACE-SUB", "rep-race-sub"))), withdrawHolder]);
assert(submitRuns[1].ok, "The withdrawal runs");
assert(!submitRuns[0].ok && /not recordable: withdrawn/.test(submitRuns[0].message), JSON.stringify(submitRuns));
assert.equal(await sql(`select status from public.money_ach_attempts where id='${submitAttempt}'`), "withdrawn");
assert.equal(await sql(`select count(*) from public.money_ach_events where attempt_id='${submitAttempt}' and status='submitted'`), "0");

// 2. The reverse: a submission holding the lock while an approved withdrawal runs. The transfer is
// submitted and the withdrawal is refused because its status changed.
const firstAttempt = await attemptOf(submitFirst);
const lateWithdrawal = await approved(withdrawal(firstAttempt, "rep-race-late"));
const submitHolder = settle(as(operatorB, record(firstAttempt, "submitted", "REP-RACE-FIRST", "rep-race-first") + " select pg_sleep(2);", "ach-replace-submit"));
await waitForSleep("ach-replace-submit");
const lateRuns = await Promise.all([settle(run(lateWithdrawal)), submitHolder]);
assert(lateRuns[1].ok, "The submission is recorded");
assert(!lateRuns[0].ok && /not actionable: status_changed/.test(lateRuns[0].message), JSON.stringify(lateRuns));
assert.equal(await sql(`select count(*) from public.money_ach_withdrawals where attempt_id='${firstAttempt}'`), "0");

// 3. Three runs each of two approved withdrawals of one transfer: one withdrawal is recorded; the
// other request is refused because the transfer was already withdrawn.
const twiceAttempt = await attemptOf(twice);
const one = await approved(withdrawal(twiceAttempt, "rep-race-twice-1"));
const two = await approved(withdrawal(twiceAttempt, "rep-race-twice-2"));
const twiceRuns = await Promise.all([one, one, one, two, two, two].map((request) => settle(run(request))));
assert(twiceRuns.every((result) => result.ok || /not actionable: completed/.test(result.message)), JSON.stringify(twiceRuns));
assert.equal(await sql(`select count(*) from public.money_ach_withdrawals where attempt_id='${twiceAttempt}'`), "1");
assert.equal(await sql(`select count(*) from public.money_ach_events where attempt_id='${twiceAttempt}' and status='withdrawn'`), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id in ('${one}','${two}')`), "1");

// 4. An approved withdrawal holding the lock while an approved retry of the same failed transfer
// runs: the retry is refused because the transfer was withdrawn, and no new attempt exists. (The
// retry-first order is suite 046's stale-withdrawal case.)
const raceWithdrawal = await approved(withdrawal(retryAttempt, "rep-race-retry-w"));
const raceRetry = await approved(`public.money_operator_request_ach_retry('${retryAttempt}','Synthetic resend','rep-race-retry-r')`);
const retryHolder = settle(as(operatorA, `select public.money_operator_execute_review('${raceWithdrawal}'); select pg_sleep(2);`, "ach-replace-retry"));
await waitForSleep("ach-replace-retry");
const retryRuns = await Promise.all([settle(run(raceRetry)), retryHolder]);
assert(retryRuns[1].ok, "The withdrawal runs");
assert(!retryRuns[0].ok && /not actionable: withdrawn/.test(retryRuns[0].message), JSON.stringify(retryRuns));
assert.equal(await sql(`select count(*) from public.money_ach_withdrawals where attempt_id='${retryAttempt}'`), "1");
assert.equal(await sql(`select count(*) from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id where i.obligation_id='${retryRace}'`), "1");

// 5. After a withdrawal, two approved batches for different weeks both include the payout and run
// while one holds the lock: exactly one replacement statement is prepared.
await run(await approved(withdrawal(await attemptOf(replaceRace), "rep-race-replace-w")));
const firstBatch = await approved(batch(147, [replaceRace], "rep-race-replace-1"));
const secondBatch = await approved(batch(154, [replaceRace], "rep-race-replace-2"));
const batchHolder = settle(as(operatorA, `select public.money_operator_execute_review('${firstBatch}'); select pg_sleep(2);`, "ach-replace-batch"));
await waitForSleep("ach-replace-batch");
const batchRuns = await Promise.all([settle(run(secondBatch)), batchHolder]);
assert(batchRuns[1].ok, "The lock holder's replacement is prepared");
assert(!batchRuns[0].ok && /not actionable: on_ach_statement/.test(batchRuns[0].message), JSON.stringify(batchRuns));
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${replaceRace}'`), "2");
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${replaceRace}' and replaces_item_id is not null`), "1");
assert.equal(await sql("select count(*) from public.money_ach_batches where period_start=current_date+154"), "0");

// Every payout is on at most one live statement, and no race posted a bank journal.
assert.equal(await sql(`select count(*) from (select i.obligation_id from public.money_ach_items i
  where not exists(select 1 from public.money_ach_withdrawals w where w.item_id=i.id) group by 1 having count(*)>1) x`), "0");
assert.equal(await sql("select count(*) from public.money_journals where kind in ('ach_settled','ach_returned')"), "0");
console.log("PASS: a withdrawal holding the lock refused the submission; a submission holding the lock made the withdrawal stale; one withdrawal from six runs of two approved requests; a withdrawal holding the lock refused a retry; one replacement from two approved batches. Reset isolated synthetic fixtures afterward.");
