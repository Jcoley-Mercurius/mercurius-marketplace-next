// Synthetic-only concurrency proof for TRACE-081; reset the isolated database afterward.
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
const operatorA = "a8110000-0000-4000-8000-000000000002";
const operatorB = "a8110000-0000-4000-8000-000000000003";
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
  sql(`select a.id from public.money_ach_items i join public.money_ach_attempts a on a.item_id=i.id where i.obligation_id='${obligation}' order by a.attempt_number desc limit 1`);
const record = (attempt, status, reference, key) =>
  `select public.money_operator_record_ach('${attempt}','${status}',${reference ? `'${reference}'` : "null"},'Synthetic bank evidence','${key}');`;
// Statement periods in the past, days before Mercurius's business day, so they can be closed. The
// business day is read once as the owner; signed-in sessions cannot call the private helper.
const today = await sql("select private.money_bank_day(now())");
const day = (offset) => `('${today}'::date-${offset})`;
const line = (offset, direction, amount, reference) =>
  `jsonb_build_object('posted_on',to_char(${day(offset)},'YYYY-MM-DD'),'direction','${direction}','amount',${amount},'reference','${reference}')`;
const importSql = (start, end, lines, key) =>
  `select public.money_operator_import_bank_statement(${day(start)},${day(end)},jsonb_build_array(${lines.join(",")}),null,'${key}');`;
const statementOf = (start) => sql(`select id from public.money_bank_statements where period_start=${day(start)}`);
const lineOf = (statement, number) => sql(`select id from public.money_bank_statement_lines where statement_id='${statement}' and line_number=${number}`);
const stateOf = (lineId) => sql(`select state||':'||coalesce(movement,'') from private.money_bank_line_states() where line_id='${lineId}'`);
const close = (statement, key) => `public.money_operator_request_bank_statement_close('${statement}','Synthetic month end','${key}')`;

assert.equal(await sql(`select count(*) from auth.users where id='${operatorA}'`), "0", "Reset isolated fixtures before running");
// Reuse the explicit synthetic setup from the SQL suite, never production rows.
const suite = readFileSync("supabase/tests/048_phase5_bank_statements.sql", "utf8");
assert(suite.includes("-- END CONCURRENCY SETUP"));
await sql(suite.split("-- END CONCURRENCY SETUP")[0].replace("select no_plan();", "") + "\ncommit;");
const obligation = (label) => sql(`select obligation_id from public.money_checkout_attempts where stripe_payment_id='pi_stm_${label}'`);
const raceA = await obligation("race_a");
const raceB = await obligation("race_b");
const raceOpen = await obligation("race_open");
assert.match(raceA, /^[0-9a-f-]{36}$/);

// Weeks start at +245 days, after the TRACE-078 (+70 to +98), TRACE-079 (+140 to +154) and
// TRACE-080 (+210 to +224) scripts: CI runs all of them on one database.
await run(await approved(batch(245, [raceA, raceB, raceOpen], "stm-race-batch")));
const attemptA = await attemptOf(raceA);
const attemptB = await attemptOf(raceB);
const attemptOpen = await attemptOf(raceOpen);
await as(operatorA, record(attemptA, "submitted", "STM-RACE-A", "stm-race-a-sub") + record(attemptA, "settled", null, "stm-race-a-set"));
await as(operatorA, record(attemptB, "submitted", "STM-RACE-B", "stm-race-b-sub") + record(attemptB, "settled", null, "stm-race-b-set"));
await as(operatorA, record(attemptOpen, "submitted", "STM-RACE-OPEN", "stm-race-open-sub"));

// 1. Two operators import the same line under different keys: one is imported, the other refused.
const firstImport = settle(as(operatorA, `${importSql(90, 81, [line(85, "credit", 4100, "STM-RACE-DUP")], "stm-race-dup-a")} select pg_sleep(1);`, "bank-statement-dup"));
await waitForSleep("bank-statement-dup");
const importRuns = await Promise.all([firstImport, settle(as(operatorB, importSql(90, 81, [line(85, "credit", 4100, "STM-RACE-DUP")], "stm-race-dup-b")))]);
assert(importRuns[0].ok, JSON.stringify(importRuns));
assert(!importRuns[1].ok && /Statement line 1 is already imported/.test(importRuns[1].message), JSON.stringify(importRuns));
assert.equal(await sql(`select count(*) from public.money_bank_statement_lines where bank_reference='STM-RACE-DUP'`), "1");
assert.equal(await sql(`select count(*) from public.money_bank_statements where period_start=${day(90)}`), "1");

// 2. An import holding the lock while an approved close of the same statement runs: the close is
// refused because the statement changed, and nothing is closed.
await as(operatorA, importSql(100, 91, [], "stm-race-empty"));
const empty = await statementOf(100);
const emptyClose = await approved(close(empty, "stm-race-close-empty"));
const changing = settle(as(operatorA, `${importSql(100, 91, [line(95, "credit", 4200, "STM-RACE-LATE-LINE")], "stm-race-changing")} select pg_sleep(1);`, "bank-statement-change"));
await waitForSleep("bank-statement-change");
const changeRuns = await Promise.all([settle(run(emptyClose)), changing]);
assert(changeRuns[1].ok, JSON.stringify(changeRuns));
assert(!changeRuns[0].ok && /not actionable: statement_changed/.test(changeRuns[0].message), JSON.stringify(changeRuns));
assert.equal(await sql(`select count(*) from public.money_bank_statement_closes where statement_id='${empty}'`), "0");
assert.equal(await sql(`select count(*) from public.money_bank_statement_lines where statement_id='${empty}'`), "1");

// 3a. An import into an earlier statement of a line that pairs first holds the lock while an
// approved close of the later statement runs: the later line loses its pairing, so the close is
// refused with open exceptions.
await as(operatorA, importSql(70, 61, [line(65, "debit", 9500, "STM-RACE-A")], "stm-race-a-later"));
const laterA = await statementOf(70);
const laterALine = await lineOf(laterA, 1);
assert.equal(await stateOf(laterALine), `matched:settled:${await sql(`select id from public.money_ach_events where attempt_id='${attemptA}' and status='settled'`)}`);
const laterClose = await approved(close(laterA, "stm-race-close-a"));
const stealing = settle(as(operatorB, `${importSql(80, 71, [line(75, "debit", 9500, "STM-RACE-A")], "stm-race-a-earlier")} select pg_sleep(1);`, "bank-statement-steal"));
await waitForSleep("bank-statement-steal");
const stealRuns = await Promise.all([settle(run(laterClose)), stealing]);
assert(stealRuns[1].ok, JSON.stringify(stealRuns));
assert(!stealRuns[0].ok && /not actionable: statement_exceptions/.test(stealRuns[0].message), JSON.stringify(stealRuns));
assert.equal(await sql(`select count(*) from public.money_bank_statement_closes where statement_id='${laterA}'`), "0");
assert.match(await stateOf(laterALine), /^unmatched:$/);

// 3b. The same race the other way: an approved close holds the lock, then an earlier line with the
// same reference is imported. The close stores its pairing, so the new line stays unmatched.
await as(operatorA, importSql(50, 41, [line(45, "debit", 9500, "STM-RACE-B")], "stm-race-b-later"));
const laterB = await statementOf(50);
const laterBLine = await lineOf(laterB, 1);
const closeB = await approved(close(laterB, "stm-race-close-b"));
const closing = settle(as(operatorA, `select public.money_operator_execute_review('${closeB}'); select pg_sleep(1);`, "bank-statement-close"));
await waitForSleep("bank-statement-close");
const closeRuns = await Promise.all([closing, settle(as(operatorB, importSql(60, 51, [line(55, "debit", 9500, "STM-RACE-B")], "stm-race-b-earlier")))]);
assert(closeRuns.every((result) => result.ok), JSON.stringify(closeRuns));
const settledB = await sql(`select 'settled:'||id from public.money_ach_events where attempt_id='${attemptB}' and status='settled'`);
assert.equal(await sql(`select movement||':'||how from public.money_bank_line_matches where line_id='${laterBLine}'`), `${settledB}:reference`);
const earlierBLine = await lineOf(await statementOf(60), 1);
assert.equal(await stateOf(earlierBLine), "unmatched:");
assert.equal(await sql(`select private.money_bank_line_suggestion('${earlierBLine}')->>'action'`), "already_evidenced");

// 4. Two operators resolve the same line into a settlement under different keys: one outcome is
// recorded; the other is refused because the line is already matched.
await as(operatorA, importSql(40, 31, [line(35, "debit", 9500, "STM-RACE-OPEN")], "stm-race-open-line"));
const openLine = await lineOf(await statementOf(40), 1);
const resolve = (user, key) => `select public.money_operator_resolve_bank_line('${openLine}','record_settled','Synthetic statement check','${key}');`;
const resolving = settle(as(operatorA, `${resolve(operatorA, "stm-race-resolve-a")} select pg_sleep(1);`, "bank-statement-resolve"));
await waitForSleep("bank-statement-resolve");
const resolveRuns = await Promise.all([resolving, settle(as(operatorB, resolve(operatorB, "stm-race-resolve-b")))]);
assert(resolveRuns[0].ok, JSON.stringify(resolveRuns));
assert(!resolveRuns[1].ok && /not resolvable: line_matched/.test(resolveRuns[1].message), JSON.stringify(resolveRuns));
assert.equal(await sql(`select count(*) from public.money_ach_events where attempt_id='${attemptOpen}' and status='settled'`), "1");
assert.match(await stateOf(openLine), /^matched:settled:/);

// No line or movement is paired twice, closed statements keep every pairing, and the race payouts
// reconcile in the ledger.
assert.equal(await sql("select count(*)=count(distinct line_id) and count(*)=count(distinct movement) from private.money_bank_pairs()"), "t");
assert.equal(await sql(`select count(*) from public.money_bank_statement_closes c where exists(select 1 from public.money_bank_statement_lines l
  where l.statement_id=c.statement_id and not exists(select 1 from public.money_bank_line_matches m where m.line_id=l.id)
  and not exists(select 1 from public.money_bank_line_dismissals d where d.line_id=l.id))`), "0");
for (const id of [raceA, raceB, raceOpen]) {
  assert.equal(await sql(`select private.money_obligation_reconciliation('${id}',now())->>'issues'`), "[]", id);
}
console.log("PASS: one of two concurrent imports of the same line; an import holding the lock made an approved close stale; an earlier line that pairs first made a later close refuse, and a close holding the lock kept its pairing from a later import; one of two concurrent resolutions of a line. Reset isolated synthetic fixtures afterward.");
