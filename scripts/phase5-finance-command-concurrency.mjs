// Synthetic-only concurrency proof for TRACE-076; reset the isolated database afterward.
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
const operatorA = "a7610000-0000-4000-8000-000000000002";
const operatorB = "a7610000-0000-4000-8000-000000000003";
const operatorC = "a7610000-0000-4000-8000-000000000005";
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

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/043_phase5_finance_commands.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_cmd_${label}'`);
const hold = await obligation("hold");
const readback = await obligation("readback");
assert.match(hold, /^[0-9a-f-]{36}$/);
const before = await sql("select md5(string_agg(event_id||status,',' order by event_id)) from public.money_webhook_events");

// 1. Five concurrent placements with one key make one hold.
const placements = await Promise.all(Array.from({ length: 5 }, () =>
  settle(as(operatorA, `select public.money_operator_place_hold('${hold}','Synthetic race hold','Synthetic ticket','race-hold');`))));
assert(placements.every((result) => result.ok), JSON.stringify(placements));
assert.equal(await sql("select count(*) from public.money_holds where business_key='race-hold'"), "1");
const holdId = await sql("select id from public.money_holds where business_key='race-hold'");

// 2. Two approved requests for the same hold, one executed twice while another execution holds
// the lock: exactly one release and one execution record.
for (const [key, reason] of [["race-release-1", "Synthetic cleared"], ["race-release-2", "Synthetic cleared again"]]) {
  const request = await as(operatorA, `select public.money_operator_request_review('hold_resolution','${holdId}','${reason}','${key}','Synthetic closure')->>'request_id';`);
  await as(operatorB, `select public.money_operator_approve_review('${request}','Synthetic approval');`);
}
const [release1, release2] = (await sql("select string_agg(id::text,',' order by business_key) from public.money_review_requests where business_key like 'race-release-%'")).split(",");
const holder = settle(as(operatorA, `select public.money_operator_execute_review('${release2}'); select pg_sleep(2);`, "finance-release-race"));
await waitForSleep("finance-release-race");
const releases = await Promise.all([
  settle(as(operatorA, `select public.money_operator_execute_review('${release1}');`)),
  settle(as(operatorA, `select public.money_operator_execute_review('${release1}');`)),
  settle(as(operatorA, `select public.money_operator_execute_review('${release2}');`)),
  holder,
]);
assert.equal(await sql(`select count(*) from public.money_hold_resolutions where hold_id='${holdId}'`), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id in ('${release1}','${release2}')`), "1");
assert.equal(await sql(`select request_id from public.money_review_executions where request_id in ('${release1}','${release2}')`), release2, "The lock holder's release won");
assert(releases[3].ok && releases[2].ok, "The winner and its replay succeed");
assert(releases.slice(0, 2).every((result) => !result.ok && /not actionable: completed/.test(result.message)), JSON.stringify(releases));

// 3. Four concurrent readbacks with one key make one attributed observation.
const readbacks = await Promise.all(Array.from({ length: 4 }, () =>
  settle(as(operatorA, `select public.money_operator_record_readback('${readback}',11600,'usd','Synthetic Stripe 116.00','race-readback');`))));
assert(readbacks.every((result) => result.ok), JSON.stringify(readbacks));
assert.equal(await sql("select count(*) from public.money_reconciliation where observation_key='race-readback'"), "1");
assert.equal(await sql("select count(*) from public.money_readback_entries e join public.money_reconciliation r on r.id=e.observation_id where r.observation_key='race-readback'"), "1");

// 4. A resolution racing a new mismatching readback never leaves the hold closed.
await as(operatorA, `select public.money_operator_record_readback('${readback}',11700,'usd','Synthetic Stripe 117.00','race-readback-match');`);
const observation = await sql("select id from public.money_reconciliation where observation_key='race-readback-match'");
const resolution = await as(operatorA, `select public.money_operator_request_review('reconciliation_resolution','${observation}','Synthetic match','race-resolution')->>'request_id';`);
await as(operatorB, `select public.money_operator_approve_review('${resolution}','Synthetic approval');`);
const raced = await Promise.all([
  settle(as(operatorA, `select public.money_operator_execute_review('${resolution}');`)),
  settle(as(operatorC, `select public.money_operator_record_readback('${readback}',11500,'usd','Synthetic Stripe 115.00','race-readback-late');`)),
]);
assert(raced[1].ok, "The later readback always records");
assert.equal(await sql(`select reconciliation_open from public.money_obligations where id='${readback}'`), "t", "A mismatch recorded in the race keeps the hold open");
assert(await sql(`select count(*) from public.money_reconciliation_resolutions where observation_id='${observation}'`) <= "1");
if (!raced[0].ok) assert.match(raced[0].message, /readback_superseded/);

// 5. Three concurrent executions of one approved exclusion make one exclusion.
await sql(`select public.money_receive_event('evt_cmd_race_unsupported','reconciliation_required','{"source_type":"charge.updated"}'); select public.money_process_event('evt_cmd_race_unsupported');`);
const exclusion = await as(operatorA, `select public.money_operator_request_review('event_exclusion','evt_cmd_race_unsupported','Synthetic informational event','race-exclusion','Synthetic Stripe readback')->>'request_id';`);
await as(operatorB, `select public.money_operator_approve_review('${exclusion}','Synthetic approval');`);
const exclusions = await Promise.all(Array.from({ length: 3 }, () => settle(as(operatorA, `select public.money_operator_execute_review('${exclusion}');`))));
assert(exclusions.every((result) => result.ok), JSON.stringify(exclusions));
assert.equal(await sql("select count(*) from public.money_event_exclusions where event_id='evt_cmd_race_unsupported'"), "1");
assert.equal(await sql(`select count(*) from public.money_review_executions where request_id='${exclusion}'`), "1");

// No command touched other events, and none of these races posted a journal.
assert.equal(await sql("select md5(string_agg(event_id||status,',' order by event_id)) from public.money_webhook_events where event_id<>'evt_cmd_race_unsupported'"), before);
assert.equal(await sql("select count(*) from public.money_journals where evidence like 'race-%' or business_key like 'race-%'"), "0");
console.log("PASS: same-key holds and readbacks made one row each; competing hold releases made one release; a racing mismatch kept the readback hold open; one exclusion from three executions. Reset isolated synthetic fixtures afterward.");
