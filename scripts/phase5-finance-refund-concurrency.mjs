// Synthetic-only concurrency proof for TRACE-077; reset the isolated database afterward.
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
const operatorA = "a7710000-0000-4000-8000-000000000002";
const operatorB = "a7710000-0000-4000-8000-000000000003";
const operatorC = "a7710000-0000-4000-8000-000000000005";
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

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/044_phase5_finance_refunds.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_ref_${label}'`);
const refund = await obligation("refund");
const stale = await obligation("stale");
const half = await obligation("cancel_half");
const halfOperation = await sql(`select j.id from public.job_operations j join public.money_obligations o on o.service_request_id=j.job_id where o.id='${half}'`);
assert.match(refund, /^[0-9a-f-]{36}$/);
const journals = await sql("select count(*) from public.money_journals");

// 1. Three concurrent runs of one approved refund make one authorization and one execution.
const single = await approved(`public.money_operator_request_refund('${refund}','pi_ref_refund',2000,140,0,'Synthetic ticket','Synthetic rework','race-refund')`);
const runs = await Promise.all(Array.from({ length: 3 }, () => settle(as(operatorA, `select public.money_operator_execute_review('${single}');`))));
assert(runs.every((result) => result.ok), JSON.stringify(runs));
assert.equal(await sql("select count(*) from public.money_refund_authorizations where business_key='finance-request:race-refund'"), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id='${single}'`), "1");

// 2. Two approved refunds that together exceed the service subtotal, run while one holds the
// lock: exactly one is authorized and the other is refused with its reason.
const first = await approved(`public.money_operator_request_refund('${stale}','pi_ref_stale',6000,0,0,'Synthetic ticket','Synthetic first','race-over-1')`);
const second = await approved(`public.money_operator_request_refund('${stale}','pi_ref_stale',6000,0,0,'Synthetic ticket','Synthetic second','race-over-2')`);
const holder = settle(as(operatorA, `select public.money_operator_execute_review('${first}'); select pg_sleep(2);`, "finance-refund-race"));
await waitForSleep("finance-refund-race");
const over = await Promise.all([settle(as(operatorA, `select public.money_operator_execute_review('${second}');`)), holder]);
assert(over[1].ok, "The lock holder's refund is authorized");
assert(!over[0].ok && /not actionable: refund_exceeds_components/.test(over[0].message), JSON.stringify(over));
assert.equal(await sql(`select sum(service) from public.money_refund_authorizations where obligation_id='${stale}'`), "6000");

// 3. A policy cancellation refund racing a manual refund on the same invoice never
// oversubscribes: the manual refund wins the lock and the policy request goes stale.
const policy = await approved(`public.money_operator_request_cancellation_refund('${halfOperation}','pi_ref_cancel_half','Synthetic policy refund','race-policy')`);
const manual = await approved(`public.money_operator_request_refund('${half}','pi_ref_cancel_half',1000,0,0,'Synthetic ticket','Synthetic adjustment','race-manual')`);
const manualHolder = settle(as(operatorA, `select public.money_operator_execute_review('${manual}'); select pg_sleep(2);`, "finance-policy-race"));
await waitForSleep("finance-policy-race");
const mixed = await Promise.all([settle(as(operatorA, `select public.money_operator_execute_review('${policy}');`)), manualHolder]);
assert(mixed[1].ok, "The manual refund is authorized");
assert(!mixed[0].ok && /not actionable: amount_changed/.test(mixed[0].message), JSON.stringify(mixed));
assert.equal(await sql(`select count(*) from public.money_operation_refund_sources where operation_id='${halfOperation}'`), "0");
assert(Number(await sql(`select sum(service) from public.money_refund_authorizations where obligation_id='${half}'`)) <= 10000);

// 4. Three concurrent runs of one approved chargeback allocation make one allocation.
await sql(`select public.money_receive_event('evt_ref_race_lost','dispute','{"dispute_id":"dp_ref_loss","payment_id":"pi_ref_dispute","amount":1000,"currency":"usd","state":"lost"}'); select public.money_process_event('evt_ref_race_lost');`);
const chargeback = await approved(`public.money_operator_request_chargeback('dp_ref_loss',1000,0,0,'Synthetic loss','race-chargeback')`);
const allocations = await Promise.all(Array.from({ length: 3 }, () => settle(as(operatorA, `select public.money_operator_execute_review('${chargeback}');`))));
assert(allocations.every((result) => result.ok), JSON.stringify(allocations));
assert.equal(await sql("select count(*) from public.money_chargeback_resolutions where dispute_id='dp_ref_loss'"), "1");
assert.equal(await sql("select count(*) from public.money_journals where business_key='chargeback-loss:dp_ref_loss'"), "1");

// 5. Author and approver reissuing one uncertain refund at once make exactly one reissue.
const authorization = await sql("select id from public.money_refund_authorizations where business_key='finance-request:race-refund'");
await sql(`select public.money_prepare_refund('${authorization}','${operatorA}');
 update public.money_refund_attempts set created_at=now()-interval '25 hours' where authorization_id='${authorization}';
 select public.money_prepare_refund('${authorization}','${operatorA}');
 select public.money_record_refund_readback('${authorization}','${operatorC}',null,null,null);`);
assert.equal(await sql(`select status from public.money_refund_attempts where authorization_id='${authorization}'`), "reconcile");
const reissues = await Promise.all([
  settle(as(operatorA, `select public.money_operator_reissue_refund('${authorization}','Synthetic no refund at Stripe');`)),
  settle(as(operatorB, `select public.money_operator_reissue_refund('${authorization}','Synthetic no refund at Stripe');`)),
  settle(as(operatorA, `select public.money_operator_reissue_refund('${authorization}','Synthetic no refund at Stripe');`)),
]);
assert.equal(await sql(`select count(*) from public.money_refund_reissues where authorization_id='${authorization}'`), "1");
assert.equal(await sql(`select idempotency_key from public.money_refund_attempts where authorization_id='${authorization}'`), `mercurius:refund-v1:${authorization}:g2`);
assert(reissues.filter((result) => result.ok).length >= 1, JSON.stringify(reissues));
assert(reissues.every((result) => result.ok || /idempotency conflict/.test(result.message)), JSON.stringify(reissues));

// No race settled a refund or posted a journal other than the one allocation.
assert.equal(await sql("select count(*) from public.money_refunds r join public.money_refund_authorizations a on a.id=r.authorization_id where a.business_key like 'finance-request:race-%'"), "0");
assert.equal(Number(await sql("select count(*) from public.money_journals")), Number(journals) + 1);
console.log("PASS: one authorization from three runs; competing refunds never exceeded components; a policy refund racing a manual refund went stale; one chargeback allocation from three runs; one reissue from concurrent author and approver. Reset isolated synthetic fixtures afterward.");
