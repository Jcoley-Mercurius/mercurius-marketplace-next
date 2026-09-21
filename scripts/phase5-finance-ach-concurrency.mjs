// Synthetic-only concurrency proof for TRACE-078; reset the isolated database afterward.
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
const operatorA = "a7810000-0000-4000-8000-000000000002";
const operatorB = "a7810000-0000-4000-8000-000000000003";
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
const batch = (days, obligations, key) =>
  `public.money_operator_request_ach(current_date+${days},array[${obligations.map((id) => `'${id}'::uuid`).join(",")}],'BANK-${key}','Synthetic weekly ACH','${key}')`;
const attemptOf = (obligation) =>
  sql(`select a.id from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id where i.obligation_id='${obligation}' order by a.attempt_number desc limit 1`);

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/045_phase5_finance_ach.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_ach_${label}'`);
const raceBatch = await obligation("race_batch");
const overlap = await obligation("race_overlap");
const refundRace = await obligation("race_refund");
const holdRace = await obligation("race_hold");
assert.match(raceBatch, /^[0-9a-f-]{36}$/);

// 1. Three concurrent runs of one approved batch prepare one batch with one execution.
const single = await approved(batch(70, [raceBatch], "race-batch"));
const runs = await Promise.all(Array.from({ length: 3 }, () => settle(as(operatorA, `select public.money_operator_execute_review('${single}');`))));
assert(runs.every((result) => result.ok), JSON.stringify(runs));
assert.equal(await sql("select count(*) from public.money_ach_batches where period_start=current_date+70"), "1");
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${raceBatch}'`), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id='${single}'`), "1");

// 2. Two approved batches for different weeks that share a payout, run while one holds the lock:
// exactly one statement is prepared and the other batch is refused with its reason.
const first = await approved(batch(77, [overlap], "race-overlap-1"));
const second = await approved(batch(84, [overlap], "race-overlap-2"));
const holder = settle(as(operatorA, `select public.money_operator_execute_review('${first}'); select pg_sleep(2);`, "finance-ach-overlap"));
await waitForSleep("finance-ach-overlap");
const overlapRuns = await Promise.all([settle(as(operatorA, `select public.money_operator_execute_review('${second}');`)), holder]);
assert(overlapRuns[1].ok, "The lock holder's batch is prepared");
assert(!overlapRuns[0].ok && /not actionable: on_ach_statement/.test(overlapRuns[0].message), JSON.stringify(overlapRuns));
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${overlap}'`), "1");
assert.equal(await sql("select count(*) from public.money_ach_batches where period_start=current_date+84"), "0");

// 3. A refund authorized while a batch waits holds the payout: the batch is refused, never both.
const refund = await approved(`public.money_operator_request_refund('${refundRace}','pi_ach_race_refund',1000,0,0,'Synthetic ticket','Synthetic rework','race-ach-refund')`);
const refundBatch = await approved(batch(91, [refundRace], "race-refund-batch"));
const refundHolder = settle(as(operatorA, `select public.money_operator_execute_review('${refund}'); select pg_sleep(2);`, "finance-ach-refund"));
await waitForSleep("finance-ach-refund");
const refundRuns = await Promise.all([settle(as(operatorA, `select public.money_operator_execute_review('${refundBatch}');`)), refundHolder]);
assert(refundRuns[1].ok, "The refund is authorized");
assert(!refundRuns[0].ok && /not actionable: refund_hold/.test(refundRuns[0].message), JSON.stringify(refundRuns));
assert.equal(await sql(`select count(*) from public.money_ach_items where obligation_id='${refundRace}'`), "0");

// 4. A hold placed while a batch holds the lock is refused: the payout is already on a statement.
const holdBatch = await approved(batch(98, [holdRace], "race-hold-batch"));
const batchHolder = settle(as(operatorA, `select public.money_operator_execute_review('${holdBatch}'); select pg_sleep(2);`, "finance-ach-hold"));
await waitForSleep("finance-ach-hold");
const holdRuns = await Promise.all([settle(as(operatorB, `select public.money_operator_place_hold('${holdRace}','Synthetic complaint','Synthetic ticket','race-ach-hold');`)), batchHolder]);
assert(holdRuns[1].ok, "The batch is prepared");
assert(!holdRuns[0].ok && /already on an ACH statement/.test(holdRuns[0].message), JSON.stringify(holdRuns));
assert.equal(await sql(`select count(*) from public.money_holds where obligation_id='${holdRace}'`), "0");

// 5. Two operators recording the submission of one transfer at once: one submission is recorded.
const attempt = await attemptOf(raceBatch);
const submissions = await Promise.all([
  settle(as(operatorA, `select public.money_operator_record_ach('${attempt}','submitted','RACE-REF-A','Synthetic send A','race-sub-a');`)),
  settle(as(operatorB, `select public.money_operator_record_ach('${attempt}','submitted','RACE-REF-B','Synthetic send B','race-sub-b');`)),
]);
assert.equal(submissions.filter((result) => result.ok).length, 1, JSON.stringify(submissions));
assert(submissions.every((result) => result.ok || /not recordable: transition_invalid/.test(result.message)), JSON.stringify(submissions));
assert.equal(await sql(`select count(*) from public.money_ach_events where attempt_id='${attempt}'`), "1");

// 6. After a failure, three runs of one approved retry and a competing approved retry make one
// new attempt; the competitor is refused because the attempt was already retried.
await as(operatorA, `select public.money_operator_record_ach('${attempt}','failed',null,'Synthetic rejection','race-failed');`);
const retry = await approved(`public.money_operator_request_ach_retry('${attempt}','Synthetic corrected account','race-retry-1')`);
const competitor = await approved(`public.money_operator_request_ach_retry('${attempt}','Synthetic corrected account again','race-retry-2')`);
const retries = await Promise.all([
  ...Array.from({ length: 3 }, () => settle(as(operatorA, `select public.money_operator_execute_review('${retry}');`))),
  settle(as(operatorA, `select public.money_operator_execute_review('${competitor}');`)),
]);
assert.equal(await sql(`select count(*) from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id where i.obligation_id='${raceBatch}'`), "2");
assert(retries.every((result) => result.ok || /not actionable: completed/.test(result.message)), JSON.stringify(retries));
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id in ('${retry}','${competitor}')`), "1");

// No race posted a bank journal: nothing settled or returned.
assert.equal(await sql("select count(*) from public.money_journals where kind in ('ach_settled','ach_returned')"), "0");
console.log("PASS: one batch from three runs; a shared payout landed on one statement; a refund racing a batch held it; a hold racing a batch was refused; one submission from two operators; one retry attempt from four runs of two approved retries. Reset isolated synthetic fixtures afterward.");
