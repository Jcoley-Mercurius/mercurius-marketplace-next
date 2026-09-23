// Synthetic-only concurrency proof for TRACE-083; reset the isolated database afterward.
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
const operatorA = "a8310000-0000-4000-8000-000000000002";
const operatorB = "a8310000-0000-4000-8000-000000000003";
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
// Operator A requests, operator B approves; A runs it.
const approved = async (request) => {
  const id = await as(operatorA, `${request}`);
  await as(operatorB, `select public.money_operator_approve_review('${id}','Synthetic approval');`);
  return id;
};
const lateRequest = (action, authorization, key) =>
  `select public.money_operator_request_late_refund('${action}','${authorization}','Synthetic ${action}',${action === "resend" ? "null" : "'Stripe shows the settled refund failed'"},'${key}')->>'request_id';`;
const reversalRequest = (obligation, amount, key) =>
  `select public.money_operator_request_repayment_reversal('${obligation}',${amount},'Transfer returned after repayment','Bank debit to the provider','${key}')->>'request_id';`;
const run = (request) => `select public.money_operator_execute_review('${request}');`;
const facts = (authorization) =>
  sql(`select concat_ws('|',(select status from public.money_refund_attempts where authorization_id='${authorization}'),
    (select count(*) from public.money_refund_reissues where authorization_id='${authorization}' and approved_by is not null),
    (select count(*) from public.money_refund_releases where authorization_id='${authorization}'),
    (select count(*) from public.money_journals where business_key='refund-reversal:${authorization}'))`);

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/050_phase5_late_reversals.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const authorizationOf = (label) => sql(`select id from public.money_refund_authorizations where payment_id='pi_lr_${label}'`);
const obligationOf = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_lr_${label}'`);
const releaseFirst = await authorizationOf("race_late");
const resendFirst = await authorizationOf("race_late2");
const settling = await authorizationOf("race_settle");
const reversing = await obligationOf("race_rev");
assert.match(releaseFirst, /^[0-9a-f-]{36}$/);

// 1. An approved release holding the lock while an approved resend of the same late failure runs:
// the release reverses the refund and the resend is refused, so a released refund is never sent.
const release = await approved(lateRequest("release", releaseFirst, "lr-race-release"));
const resendLate = await approved(lateRequest("resend", releaseFirst, "lr-race-resend-late"));
const releaseHolder = settle(as(operatorA, `${run(release)} select pg_sleep(2);`, "late-release"));
await waitForSleep("late-release");
const releaseRuns = await Promise.all([settle(as(operatorA, run(resendLate))), releaseHolder]);
assert(releaseRuns[1].ok, "The release is recorded");
assert(!releaseRuns[0].ok && /not actionable: completed|not actionable: refund_released/.test(releaseRuns[0].message), JSON.stringify(releaseRuns));
assert.equal(await facts(releaseFirst), "failed|0|1|1");

// 2. The reverse order: the resend holds the lock, and the approved release is refused because the
// send it was approved against changed. A refund in flight is never reversed.
const resend = await approved(lateRequest("resend", resendFirst, "lr-race-resend"));
const staleRelease = await approved(lateRequest("release", resendFirst, "lr-race-release-late"));
const resendHolder = settle(as(operatorA, `${run(resend)} select pg_sleep(2);`, "late-resend"));
await waitForSleep("late-resend");
const resendRuns = await Promise.all([settle(as(operatorA, run(staleRelease))), resendHolder]);
assert(resendRuns[1].ok, "The resend is prepared");
assert(!resendRuns[0].ok && /not actionable: refund_changed/.test(resendRuns[0].message), JSON.stringify(resendRuns));
assert.equal(await facts(resendFirst), "prepared|1|0|0");

// 3. Stripe delivers the resend's refund event twice at once: one resettlement and one journal.
const event = (id) => `select public.money_receive_event('${id}','refund',jsonb_build_object('authorization_id','${settling}','refund_id','re_lr_race_settle_2',
  'payment_id','pi_lr_race_settle','amount',2000,'currency','usd')); select public.money_process_event('${id}');`;
const eventRuns = await Promise.all([1, 2, 3, 4].map((n) => settle(sql(event(`evt_lr_race_settle_${n}`)))));
assert(eventRuns.every((result) => result.ok && result.value.endsWith("processed")), JSON.stringify(eventRuns));
assert.equal(await sql(`select count(*) from public.money_refund_resettlements where authorization_id='${settling}'`), "1");
assert.equal(await sql(`select count(*) from public.money_journals where kind='refund_resettlement' and business_key='refund-resettlement:re_lr_race_settle_2'`), "1");

// 4. Two approved reversals of the whole repayment run at once: one is recorded, the other is stale.
const reversals = await Promise.all(["lr-race-rev-1", "lr-race-rev-2"].map((key) => approved(reversalRequest(reversing, 1700, key))));
const reversalRuns = await Promise.all(reversals.map((request) => settle(as(operatorA, run(request)))));
assert.equal(reversalRuns.filter((result) => result.ok).length, 1, JSON.stringify(reversalRuns));
assert(reversalRuns.every((result) => result.ok || /not actionable: (returnable_changed|nothing_returnable)/.test(result.message)), JSON.stringify(reversalRuns));
assert.equal(await sql(`select coalesce(sum(amount),0) from public.money_repayment_reversals where obligation_id='${reversing}'`), "1700");

// Each race payout reconciles, apart from the returned statement TRACE-080 reads stale until replaced.
for (const label of ["race_late", "race_late2", "race_settle"]) {
  assert.equal(await sql(`select private.money_obligation_reconciliation(obligation_id,now())->>'issues' from public.money_checkout_attempts where stripe_payment_id='pi_lr_${label}'`), "[]", label);
}
assert.equal(await sql(`select private.money_obligation_reconciliation('${reversing}',now())->>'issues'`), `["statement_stale"]`);
console.log(`PASS: a release holding the lock refused a resend and a resend refused a release; four deliveries of one refund event resettled once; two reversals of one repayment recorded one. Reset isolated synthetic fixtures afterward.`);
