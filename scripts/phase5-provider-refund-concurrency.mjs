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
const actor = '81000000-0000-4000-8000-000000000002';
const owner = '81000000-0000-4000-8000-000000000001';
const request = '83000000-0000-4000-8000-000000000001';
const claims = `select set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true);`;
assert.equal(await sql(`select count(*) from auth.users where id='${owner}'`),'0','Reset isolated database before fixtures');
const suite = readFileSync('supabase/tests/026_phase5_provider_refund.sql','utf8');
await sql(suite.split('create temp table provider_fixture')[0].replace('select no_plan();','') + `
${claims}
select public.record_job_operation('${request}','87000000-0000-4000-8000-000000000011','provider_cancel','Synthetic concurrent cancellation');
commit;`);
const operation = await sql(`select id from public.job_operations where operation_key='87000000-0000-4000-8000-000000000011'`);
assert.match(operation,/^[0-9a-f-]{36}$/);
const command = `begin; ${claims} select (public.record_provider_replacement_decision('${operation}','88000000-0000-4000-8000-000000000001','Synthetic concurrent exhaustion')).id; commit;`;
const results = await Promise.all(Array.from({length:8},()=>sql(command)));
assert.equal(new Set(results).size,1,'Concurrent duplicate decisions return one receipt');
assert.equal(await sql('select count(*) from public.money_provider_replacement_decisions'), '1');
assert.equal(await sql(`select status from public.service_requests where id='${request}'`),'cancelled');
assert.equal(await sql(`select count(*) from public.job_events where job_id='${request}' and metadata->>'action'='replacement_decision'`),'1');
assert.equal(await sql("select count(*) from public.money_refund_authorizations where obligation_id in (select id from public.money_obligations where service_request_id='83000000-0000-4000-8000-000000000001')"),'0','Operations decision alone cannot authorize money');
assert.equal(await sql('select count(*) from cron.job where active'),'0');
console.log('PASS: eight concurrent replacement decisions return one immutable receipt and one lifecycle decision event, with no unreviewed refund and no active Cron. Reset isolated fixtures afterward.');