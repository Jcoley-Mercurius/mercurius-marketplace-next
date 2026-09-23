// Synthetic-only concurrency proof for TRACE-082; reset the isolated database afterward.
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
const operatorA = "a8210000-0000-4000-8000-000000000002";
const operatorB = "a8210000-0000-4000-8000-000000000003";
const operatorC = "a8210000-0000-4000-8000-000000000005";
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
const resend = (authorization, reason) => `select public.money_operator_resend_refund('${authorization}','${reason}');`;
// Operator C requests the release, operator A approves it; C runs it.
const approvedRelease = async (authorization, key) => {
  const request = await as(operatorC, `select public.money_operator_request_refund_release('${authorization}','Card closed','Stripe shows the refund canceled','${key}')->>'request_id';`);
  await as(operatorA, `select public.money_operator_approve_review('${request}','Synthetic approval');`);
  return request;
};
const run = (request) => `select public.money_operator_execute_review('${request}');`;
const facts = (authorization) =>
  sql(`select concat_ws('|',(select status from public.money_refund_attempts where authorization_id='${authorization}'),
    (select count(*) from public.money_refund_reissues where authorization_id='${authorization}'),
    (select count(*) from public.money_refund_releases where authorization_id='${authorization}'))`);

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/049_phase5_failed_refund_recovery.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const authorizationOf = (label) => sql(`select id from public.money_refund_authorizations where payment_id='pi_frr_${label}'`);
const resendRace = await authorizationOf("race_resend");
const releaseRace = await authorizationOf("race_release");
const resendFirst = await authorizationOf("race_resend_first");
assert.match(resendRace, /^[0-9a-f-]{36}$/);

// 1. Three resends each from the refund's author and approver, with different reasons: one new
// generation is prepared; every other call replays it or is refused.
const resendRuns = await Promise.all([operatorA, operatorA, operatorA, operatorB, operatorB, operatorB]
  .map((user) => settle(as(user, resend(resendRace, `Synthetic resend ${user === operatorA ? "A" : "B"}`)))));
assert(resendRuns.some((result) => result.ok), JSON.stringify(resendRuns));
assert(resendRuns.every((result) => result.ok || /Refund resend idempotency conflict|Refund resend not allowed: refund_not_failed/.test(result.message)), JSON.stringify(resendRuns));
assert.equal(await facts(resendRace), "prepared|1|0");
assert.equal(await sql(`select idempotency_key from public.money_refund_attempts where authorization_id='${resendRace}'`), `mercurius:refund-v1:${resendRace}:g2`);

// 2. The release holding the lock while the refund's approver resends it: the release is recorded
// and the resend is refused, so a released refund is never prepared again.
const release = await approvedRelease(releaseRace, "frr-race-release");
const releaseHolder = settle(as(operatorC, `${run(release)} select pg_sleep(2);`, "failed-refund-release"));
await waitForSleep("failed-refund-release");
const releaseRuns = await Promise.all([settle(as(operatorB, resend(releaseRace, "Synthetic resend"))), releaseHolder]);
assert(releaseRuns[1].ok, "The release is recorded");
assert(!releaseRuns[0].ok && /Refund resend not allowed: refund_released/.test(releaseRuns[0].message), JSON.stringify(releaseRuns));
assert.equal(await facts(releaseRace), "failed|0|1");

// 3. A resend holding the lock while an approved release runs: the resend prepares a new send and
// the release is refused, so a refund in flight is never taken off the books.
const staleRelease = await approvedRelease(resendFirst, "frr-race-resend-first");
const resendHolder = settle(as(operatorB, `${resend(resendFirst, "Synthetic resend")} select pg_sleep(2);`, "failed-refund-resend"));
await waitForSleep("failed-refund-resend");
const resendFirstRuns = await Promise.all([settle(as(operatorC, run(staleRelease))), resendHolder]);
assert(resendFirstRuns[1].ok, "The resend is prepared");
assert(!resendFirstRuns[0].ok && /not actionable: refund_not_failed/.test(resendFirstRuns[0].message), JSON.stringify(resendFirstRuns));
assert.equal(await facts(resendFirst), "prepared|1|0");

// Nothing posted, and each race payout reconciles.
assert.equal(await sql(`select count(*) from public.money_refunds where authorization_id in ('${resendRace}','${releaseRace}','${resendFirst}')`), "0");
for (const label of ["race_resend", "race_release", "race_resend_first"]) {
  assert.equal(await sql(`select private.money_obligation_reconciliation(obligation_id,now())->>'issues' from public.money_checkout_attempts where stripe_payment_id='pi_frr_${label}'`), "[]", label);
}
console.log("PASS: one generation from six resends by the refund's author and approver; a release holding the lock refused a resend; a resend holding the lock refused an approved release. Reset isolated synthetic fixtures afterward.");
