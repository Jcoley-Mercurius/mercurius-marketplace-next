// Run only in WSL/local Docker after a clean isolated reset. Leaves synthetic fixtures
// in this disposable database; a subsequent clean reset is required before delivery.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const container = 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe','pipe','pipe'] });
    let output='', errors='';
    child.stdout.on('data', chunk=>{output+=chunk;}); child.stderr.on('data', chunk=>{errors+=chunk;});
    child.on('error',reject); child.on('close', code=>code===0?resolve(output.trim()):reject(new Error(errors)));
    child.stdin.end(source);
  });
}
const owner='61000000-0000-4000-8000-000000000001', actor='61000000-0000-4000-8000-000000000003', reviewer='61000000-0000-4000-8000-000000000004';
const request='64000000-0000-4000-8000-000000000001';
assert.equal(await sql(`select count(*) from auth.users where id='${owner}'`),'0','Reset the isolated database before rerunning concurrency fixtures.');
const snapshot=await sql(`begin;
insert into auth.users(id,raw_user_meta_data) values('${owner}','{}'),('${actor}','{}'),('${reviewer}','{}');
insert into public.user_roles(user_id,role) values('${actor}','admin'),('${reviewer}','admin');
insert into public.money_authorities(user_id,granted_by,reason) values('${actor}','${reviewer}','synthetic'),('${reviewer}','${actor}','synthetic');
insert into public.contractors(id,name,is_active) values('62000000-0000-4000-8000-000000000001','Synthetic concurrent provider',false);
insert into public.service_requests(id,customer_id,contractor_id,service_type,address) values('${request}','${owner}','62000000-0000-4000-8000-000000000001','house-cleaning','Synthetic concurrency');
create temporary table terms as select jsonb_build_object('service',10000,'addons',0,'discount',0,'adjustment',0,'subtotal',10000,'tax',700,'tip',1000,'deposit',3000,'total',11700,'currency','usd','source_version','synthetic-concurrency-v1','policy_version','CFG-005','tax_evidence','synthetic','reason','synthetic','expires_at',now()+interval '1 day') value;
do $$ begin
perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${reviewer}"}',true);
perform public.money_approve_review('${actor}',jsonb_build_object('operation','snapshot','request','${request}','terms',(select value from terms)),'Synthetic separate approval'); end $$;
select public.money_publish_snapshot('${request}',(select value from terms),'${actor}','${reviewer}'); commit;`);
assert.match(snapshot,/^[0-9a-f-]{36}$/);
const prepare=()=>sql(`begin; set local role authenticated;
do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${owner}"}',true); end $$;
select (public.money_prepare_checkout('${snapshot}','full')).id; commit;`);
const attempts=await Promise.all(Array.from({length:8},prepare));
assert.equal(new Set(attempts).size,1); const attempt=attempts[0]; assert.match(attempt,/^[0-9a-f-]{36}$/);
const payload=JSON.stringify({attempt_id:attempt,payment_id:'pi_concurrent',amount:11700,currency:'usd'});
await sql(`select public.money_receive_event('evt_concurrent','capture','${payload}');`);
const processed=await Promise.all(Array.from({length:8},()=>sql("select public.money_process_event('evt_concurrent')")));
assert.deepEqual([...new Set(processed)],['processed']);
await Promise.all(Array.from({length:8},(_,i)=>sql(`select public.money_receive_event('evt_duplicate_${i}','capture','${payload}'); select public.money_process_event('evt_duplicate_${i}');`)));
assert.equal(await sql(`select count(*) from public.money_journals j join public.money_obligations o on o.id=j.obligation_id where o.service_request_id='${request}'`),'2');
assert.equal(await sql(`select captured from public.money_obligations where service_request_id='${request}'`),'11700');
const obligation=await sql(`select id from public.money_obligations where service_request_id='${request}'`);
for (const key of ['concurrent-refund-a','concurrent-refund-b']) await sql(`begin; do $$ begin
perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${reviewer}"}',true);
perform public.money_approve_review('${actor}',jsonb_build_object('operation','refund','obligation','${obligation}','payment','pi_concurrent','service',7000,'tax',0,'tip',0,'key','${key}','policy','synthetic-policy','reason','synthetic'),'Synthetic second approval'); end $$; commit;`);
const refunds=await Promise.allSettled(['concurrent-refund-a','concurrent-refund-b'].map(key=>sql(`select public.money_authorize_refund('${obligation}','pi_concurrent',7000,0,0,'${key}','${actor}','${reviewer}','synthetic-policy','synthetic')`)));
assert.equal(refunds.filter(x=>x.status==='fulfilled').length,1);
assert.equal(refunds.filter(x=>x.status==='rejected' && x.reason.message.includes('Refund exceeds remaining components')).length,1);
assert.equal(await sql(`select sum(service) from public.money_refund_authorizations where obligation_id='${obligation}'`),'7000');
assert.equal(await sql('select count(*) from cron.job where active'),'0');
console.log('PASS: 8 concurrent authenticated checkouts, 8 concurrent receipt processors, 8 distinct duplicate events, and competing refund reservations. One checkout, one capture/earnings journal pair, no over-refund and zero active Cron jobs. Synthetic fixtures remain only in the isolated database until reset.');
