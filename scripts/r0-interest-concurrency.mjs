// TRACE-102: concurrent early-access joins, consent, account linkage and retention.
// Run only against a disposable isolated database after a clean reset (CI runs it on the
// Phase 5 synthetic stack). Leaves synthetic fixtures; a clean reset follows in CI.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const container = process.env.R0_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe','pipe','pipe'] });
    let output='', errors='';
    child.stdout.on('data', chunk=>{output+=chunk;}); child.stderr.on('data', chunk=>{errors+=chunk;});
    child.on('error',reject); child.on('close', code=>code===0?resolve(output.trim()):reject(new Error(errors)));
    child.stdin.end(source);
  });
}
const as = (role, sub, statement) => `begin; set local role ${role};
select set_config('request.jwt.claims','${JSON.stringify({ role, sub })}',true);
${statement}; commit;`;
const service = statement => sql(as('service_role', null, statement));
const hash = email => `encode(extensions.digest('${email}','sha256'),'hex')`;
const homeowner='69100000-0000-4000-8000-000000000001', operator='69100000-0000-4000-8000-000000000002';
const joinEmail='r0-concurrent-join@example.test', linkEmail='r0-concurrent-link@example.test';

for (let attempt=0; ; attempt++) {
  try { assert.equal(await sql('select 1'),'1'); break; }
  catch (error) { if(attempt===29) throw error; await new Promise(resolve=>setTimeout(resolve,1000)); }
}
assert.equal(await sql(`select count(*) from auth.users where id='${homeowner}'`),'0','Reset the isolated database before rerunning R0 interest fixtures.');
await sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('${homeowner}','${linkEmail}',now(),'{}'),('${operator}','r0-concurrent-operator@example.test',now(),'{}');
insert into public.user_roles(user_id,role) values ('${operator}','admin');
insert into private.r0_trial_operators(user_id,reason) values ('${operator}','Synthetic concurrency operator');`);

// Parallel joins for one email create one interest and one consent record.
const join = (email, zip, marketing) => service(`select public.r0_submit_interest('early_access','${email}',null,'${zip}','{}'::text[],true,${marketing})`);
const joins = await Promise.all(Array.from({length:8},(_,i)=>join(joinEmail, i%2 ? '33901' : '33908', true)));
assert.deepEqual([...new Set(joins)],['{"outcome": "saved"}']);
assert.equal(await sql(`select count(*) from private.r0_interests where email_hash=${hash(joinEmail)}`),'1');
assert.equal(await sql(`select count(*)||':'||bool_and(opted_in) from private.r0_marketing_preferences where email_hash=${hash(joinEmail)}`),'1:true');
assert.equal(await sql(`select count(*) from private.r0_interest_events e join private.r0_interests i on i.id=e.interest_id where i.email_hash=${hash(joinEmail)} and e.action='joined'`),'1');

// Parallel unsubscribe and opt-in from the form: unsubscribe wins and is not lifted.
const token = await service(`select public.r0_issue_link_token('unsubscribe','${joinEmail}')`);
assert.match(token,/^[0-9a-f]{64}$/);
await Promise.all([
  ...Array.from({length:4},()=>service(`select public.r0_unsubscribe_marketing('${token}')`)),
  ...Array.from({length:4},()=>join(joinEmail,'33901',true)),
]);
await join(joinEmail,'33901',true);
assert.equal(await sql(`select opted_in from private.r0_marketing_preferences where email_hash=${hash(joinEmail)}`),'f');

// Account linkage racing anonymous joins keeps one linked identity.
await Promise.all([
  ...Array.from({length:4},()=>sql(as('authenticated', homeowner, 'select public.r0_my_interest()'))),
  ...Array.from({length:4},()=>join(linkEmail,'33901',false)),
]);
await sql(as('authenticated', homeowner, 'select public.r0_my_interest()'));
assert.equal(await sql(`select count(*)||':'||count(user_id) from private.r0_interests where email_hash=${hash(linkEmail)} or user_id='${homeowner}'`),'1:1');

// Parallel withdrawal and retention passes de-identify once and record every pass.
const joinedId = await sql(`select id from private.r0_interests where email_hash=${hash(joinEmail)}`);
const manage = await service(`select public.r0_issue_link_token('manage','${joinEmail}','early_access')`);
await Promise.all([
  service(`select public.r0_manage_interest('${manage}','withdraw')`),
  ...Array.from({length:3},()=>sql(as('authenticated', operator, 'select public.r0_run_interest_retention(100)'))),
  ...Array.from({length:3},()=>service('select public.r0_run_interest_retention(100)')),
]);
assert.equal(await sql(`select count(*) from private.r0_interests where email_hash=${hash(joinEmail)}`),'0');
assert.equal(await sql(`select count(*) from private.r0_interest_events where interest_id='${joinedId}' and action='deidentified'`),'1');
assert.equal(await sql('select count(*) from private.r0_retention_runs'),'6');
assert.equal(await sql(`select count(*) from private.r0_interests where user_id='${homeowner}' and status='active'`),'1');
assert.equal(await sql('select count(*) from cron.job where active'),'0');
console.log('R0 interest concurrency: joins, consent, linkage and retention passed.');
