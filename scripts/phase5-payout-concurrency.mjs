// Synthetic fixtures only. Run in WSL after an isolated reset; reset again afterward.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const container = 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']);
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    child.stdin.end(source);
  });
}
const request = '54000000-0000-4000-8000-000000000002';
const actor = '51000000-0000-4000-8000-000000000003';
const reviewer = '51000000-0000-4000-8000-000000000004';
const owner = '51000000-0000-4000-8000-000000000001';
const dispute = '56000000-0000-4000-8000-000000000001';
assert.equal(await sql(`select count(*) from auth.users where id='${owner}'`), '0', 'Reset isolated database before running fixtures');
// Reuse the explicit synthetic setup from the SQL boundary suite, never production rows.
const suite = readFileSync('supabase/tests/024_phase5_completion_payout.sql', 'utf8');
assert(suite.includes('-- END CONCURRENCY SETUP'));
await sql(suite.split('-- END CONCURRENCY SETUP')[0].replace('select no_plan();', '') + `
update public.service_requests set status='completed',homeowner_confirmed_at=now()-interval '49 hours' where id='${request}';
insert into public.money_lifecycle_confirmations(request_id,homeowner_id,contractor_id,confirmed_at)
 select id,customer_id,contractor_id,homeowner_confirmed_at from public.service_requests where id='${request}';
insert into public.disputes(id,job_id,homeowner_id,vendor_id,reason,status,resolution_version,resolution_notes)
 select '${dispute}',id,customer_id,contractor_id,'Synthetic dispute','resolved',1,'Synthetic resolution' from public.service_requests where id='${request}';
select pg_temp.approve(jsonb_build_object('operation','ach','period',current_date,'obligations',array[pg_temp.ob(2)],'bank_ref','private-form','reason','Synthetic race'));
commit;`);
const obligation = await sql(`select id from public.money_obligations where service_request_id='${request}'`);
assert.match(obligation, /^[0-9a-f-]{36}$/);
const claims = user => `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;`;
const prepare = `select public.money_prepare_ach(current_date,array['${obligation}'::uuid],'${actor}','${reviewer}','private-form','Synthetic race');`;
async function waitForSleep(name) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`) === '1') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out establishing concurrent lock holder');
}
// Hold the canonical appeal transaction open so batch preparation must wait.
const appeal = sql(`begin; set application_name='phase5-appeal-race'; ${claims(owner)}
select public.appeal_dispute_resolution('${dispute}','Synthetic concurrent appeal'); select pg_sleep(3); commit;`);
await waitForSleep('phase5-appeal-race');
const blockedBatch = await Promise.allSettled([sql(`begin; ${prepare} commit;`), appeal]);
assert.equal(blockedBatch[0].status, 'rejected');
assert.match(blockedBatch[0].reason.message, /Lifecycle dispute or completion hold/);
assert.equal(blockedBatch[1].status, 'fulfilled');
assert.equal(await sql('select count(*) from public.money_ach_batches'), '0');
await sql(`begin; ${claims(actor)} select public.admin_resolve_dispute('${dispute}','resolved','Synthetic reviewed resolution'); commit;`);
// Reverse the winner: a valid prepared statement survives, but cannot be submitted after the appeal.
const batch = sql(`begin; set application_name='phase5-batch-race'; ${prepare} select pg_sleep(3); commit;`);
await waitForSleep('phase5-batch-race');
const secondAppeal = sql(`begin; ${claims(owner)} select public.appeal_dispute_resolution('${dispute}','Synthetic second appeal'); commit;`);
const completed = await Promise.allSettled([batch, secondAppeal]);
assert(completed.every(result => result.status === 'fulfilled'));
assert.equal(await sql('select count(*) from public.money_ach_batches'), '1');
const attempt = await sql(`select a.id from public.money_ach_attempts a join public.money_ach_items i on i.id=a.item_id where i.obligation_id='${obligation}'`);
await assert.rejects(sql(`select public.money_record_ach('${attempt}','submitted','synthetic-bank','${actor}','Synthetic submission','submit-race')`), /Lifecycle dispute or completion hold/);
assert.equal(await sql(`select status from public.money_ach_attempts where id='${attempt}'`), 'prepared');
assert.equal(await sql("select count(*) from public.money_journals where kind like 'ach_%'"), '0');
assert.equal(await sql('select count(*) from cron.job where active'), '0');
console.log('PASS: appeal-first blocks batch; batch-first preserves statement but appeal blocks submission; no bank journal and zero active Cron. Reset isolated synthetic fixtures afterward.');
