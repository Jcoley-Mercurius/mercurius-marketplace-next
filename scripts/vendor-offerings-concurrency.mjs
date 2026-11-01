// TRACE-134 (6.11A): vendor offering versions under concurrency. Parallel saves from one read
// create one replacement; a retried key creates one; homeowner submissions racing a vendor save
// bind to an intact version (its stored revision, level and total) or are refused as changed,
// never left without a binding; an operator publication racing a vendor save leaves one live
// revision. Run only against a disposable local or isolated database with 20261104001000 applied.
// Synthetic fixtures only; they are removed at the end so the script can be rerun.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const container = process.env.PRICING_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors.trim()))));
    child.stdin.end(source);
  });
}
const settle = (promises) => Promise.allSettled(promises);
const as = (sub, statement) => `begin; set local role authenticated;
set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub })}';
${statement}; commit;`;

const operator = 'c1110000-0000-4000-8000-000000000001';
const vendorUser = 'c1110000-0000-4000-8000-000000000002';
const contractor = 'c1120000-0000-4000-8000-000000000001';
const homeowner = (n) => `c1130000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const service = 'synthetic-vo-conc-svc';
const zip = '00111';

async function cleanup() {
  await sql(`
    delete from public.job_match_attempts where contractor_id = '${contractor}';
    delete from public.service_request_submission_items where submission_id in (select id from public.service_request_submissions where customer_id::text like 'c113%');
    delete from public.service_request_submissions where customer_id::text like 'c113%';
    delete from public.service_requests where customer_id::text like 'c113%';
    delete from private.r0_trial_admissions where homeowner_id::text like 'c113%';
    delete from private.vendor_package_saves where actor = '${vendorUser}';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    delete from private.package_draft_events where draft_id in (select id from private.operator_package_drafts where contractor_id = '${contractor}');
    delete from private.vendor_package_price_corrections where contractor_id = '${contractor}';
    delete from private.operator_package_drafts where contractor_id = '${contractor}';
    delete from private.package_internal_notes where contractor_id = '${contractor}';
    delete from public.notifications where user_id = '${vendorUser}';
    update public.vendor_packages set is_active = false where contractor_id = '${contractor}' and is_active;
    delete from public.vendor_packages where contractor_id = '${contractor}' and lineage_id <> id;
    delete from public.vendor_packages where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from public.services_catalog where id = '${service}';
    delete from public.service_categories where id = 'synthetic-vo-conc-cat';
    delete from public.coverage_areas where zip_code = '${zip}';
    delete from private.r0_lee_zips where zip_code = '${zip}';
    delete from public.user_roles where user_id::text like 'c111%' or user_id::text like 'c113%';
    delete from auth.users where id::text like 'c111%' or id::text like 'c113%';`);
}

await cleanup();
await sql(`
  insert into auth.users(id,email,email_confirmed_at) values
    ('${operator}','vo-conc-operator@example.invalid',now()),('${vendorUser}','vo-conc-vendor@example.invalid',now());
  insert into auth.users(id,email,email_confirmed_at)
    select ('c1130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'vo-conc-homeowner-'||n||'@example.invalid',now() from generate_series(1,9) n;
  delete from public.user_roles where user_id = '${vendorUser}';
  insert into public.user_roles(user_id,role) values ('${operator}','admin'),('${vendorUser}','vendor');
  insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services) values ('${contractor}','Synthetic offerings concurrency vendor',true,true,'${vendorUser}','{${service}}');
  insert into public.service_categories(id,name) values ('synthetic-vo-conc-cat','Synthetic offerings concurrency');
  insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,pricing_mode,default_frequency,available_frequencies,is_active)
    values ('${service}','Synthetic offerings concurrency service','synthetic-vo-conc-cat',100,100,'fixed','one-time','{one-time}',true);
  insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('${zip}','Synthetic',true,false);
  insert into private.r0_lee_zips values ('${zip}') on conflict do nothing;
  insert into public.contractor_service_zips(contractor_id,zip_code) values ('${contractor}','${zip}');
  insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
    select ('c1130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${zip}','${service}','${operator}' from generate_series(1,9) n;`);

const content = (price, name = 'Synthetic concurrency plan') => JSON.stringify({ service_id: service,
  package: { name, pricing_mode: 'fixed', default_frequency: 'one-time' },
  tiers: [{ name: 'One-time', price, frequency: 'one-time' }] });
const save = (pkg, hash, price, key, publish = true) => sql(as(vendorUser,
  `select public.vendor_save_package(${pkg ? `'${pkg}'` : 'null'}, ${hash ? `'${hash}'` : 'null'}, '${content(price)}'::jsonb, ${publish}, '${key}')`));
const head = async () => JSON.parse(await sql(`select row_to_json(x) from (select p.id, private.package_revision_hash(p.id) as hash,
  (select t.id from public.package_tiers t where t.package_id = p.id) as tier, (select t.price from public.package_tiers t where t.package_id = p.id) as price
  from public.vendor_packages p where p.contractor_id = '${contractor}' order by p.revision_number desc limit 1) x`));
const lineageCount = () => sql(`select count(*) from public.vendor_packages where contractor_id = '${contractor}'`);
const liveCount = () => sql(`select count(*) from public.vendor_packages where contractor_id = '${contractor}' and is_active`);

const first = JSON.parse(await save(null, null, 100, 'vo-conc-key-first-0001'));
assert.equal(first.is_active, true);
await sql(`update public.vendor_packages set created_at = now() - interval '1 day' where contractor_id = '${contractor}'`);

// C1: six saves from the same read race; one replacement is created, the rest are stale.
let current = await head();
const c1 = await settle(Array.from({ length: 6 }, (_, i) => save(current.id, current.hash, 101 + i, `vo-conc-key-c1-${String(i).padStart(4, '0')}`)));
assert.equal(c1.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one save from the same read succeeds');
assert.ok(c1.filter((r) => r.status === 'rejected').every((r) => /newer version|changed since it was read/.test(r.reason.message)),
  `the others are refused as stale (${c1.find((r) => r.status === 'rejected')?.reason.message ?? ''})`);
assert.equal(await lineageCount(), '2', 'one replacement revision');
assert.equal(await liveCount(), '1', 'one live revision');

// C2: one key retried six times in parallel creates one revision and returns it to every caller.
current = await head();
const c2 = await settle(Array.from({ length: 6 }, () => save(current.id, current.hash, 120, 'vo-conc-key-c2-retry0001')));
assert.deepEqual(c2.map((r) => r.status), Array(6).fill('fulfilled'), `${c2.find((r) => r.reason)?.reason ?? ''}`);
assert.equal(new Set(c2.map((r) => JSON.parse(r.value).package_id)).size, 1, 'every retry returns the same revision');
assert.equal(await lineageCount(), '3', 'and only one was created');

// C3: eight homeowner submissions race a vendor save of the version they were shown.
await sql(`update public.vendor_packages set created_at = now() - interval '1 day' where contractor_id = '${contractor}'`);
current = await head();
const submit = (n) => sql(as(homeowner(n), `select public.submit_service_requests('vo-conc-intake-${String(n).padStart(4, '0')}', '${JSON.stringify({
  location: { address: '1 Synthetic Way', city: 'Synthetic', state: 'FL', zip_code: zip },
  selections: [{ service_id: service, frequency: 'one-time', package_id: current.id, tier_id: current.tier, package_revision: current.hash,
    preferred_contractor_id: contractor, expected: { pricing_mode: 'fixed', total: Number(current.price) } }],
})}'::jsonb)`));
const c3 = await settle([...Array.from({ length: 8 }, (_, i) => submit(i + 1)), save(current.id, current.hash, 130, 'vo-conc-key-c3-save0001')]);
assert.deepEqual(c3.map((r) => r.status), Array(9).fill('fulfilled'), `${c3.find((r) => r.reason)?.reason ?? ''}`);
const outcomes = c3.slice(0, 8).map((r) => JSON.parse(r.value));
assert.ok(outcomes.every((r) => r.status === 'submitted' || (r.status === 'refused' && ['price_changed', 'package_unavailable'].includes(r.outcomes[0].outcome))),
  `each submission is bound or refused as changed or no longer offered (${JSON.stringify(outcomes.map((r) => r.outcomes?.[0]?.outcome ?? r.status))})`);
const submitted = outcomes.filter((r) => r.status === 'submitted').length;
assert.equal(await sql(`select count(*) from public.service_requests where customer_id::text like 'c113%'`), String(submitted), 'refused submissions create nothing');
assert.equal(await sql(`select count(*) from public.service_requests r where r.customer_id::text like 'c113%' and not (
    r.package_id is not null and r.package_tier_id is not null
    and exists (select 1 from public.package_tiers t where t.id = r.package_tier_id and t.package_id = r.package_id and t.price = r.total_amount)
    and r.pricing_inputs->>'package_revision' = private.package_revision_hash(r.package_id))`), '0',
  'every bound request names an intact version, its level, its price and its stored revision');
assert.equal(await lineageCount(), '4', 'the racing save created one replacement');
assert.equal(await liveCount(), '1', 'one live revision');
// The bound versions are still protected, live or paused.
if (submitted > 0) await assert.rejects(sql(`delete from public.package_tiers where package_id in (select package_id from public.service_requests where customer_id::text like 'c113%')`),
  /Requests use this price version|This price is live/);
console.log(`C3: ${submitted} of 8 submissions bound to an intact version; ${8 - submitted} refused as changed or no longer offered.`);

// C3b (forced order): a submission commits, then the vendor saves; the bound version stays intact.
current = await head();
const bound = JSON.parse(await submit(9));
assert.equal(bound.status, 'submitted', JSON.stringify(bound));
const c3bSave = JSON.parse(await save(current.id, current.hash, 135, 'vo-conc-key-c3b-save001'));
assert.equal(c3bSave.new_version, true, 'a bound version is replaced, not rewritten');
assert.equal(await sql(`select (r.package_id = '${current.id}' and r.package_tier_id = '${current.tier}' and r.total_amount = ${Number(current.price)}
  and r.pricing_inputs->>'package_revision' = private.package_revision_hash(r.package_id))::text
  from public.service_requests r where r.customer_id = '${homeowner(9)}'`), 'true', 'the request keeps its version, level, price and revision');
await assert.rejects(sql(`delete from public.package_tiers where id = '${current.tier}'`), /Requests use this price version/, 'its level cannot be deleted');
await assert.rejects(sql(`delete from public.vendor_packages where id = '${current.id}'`), /kept as history/, 'nor its package');

// C4: an operator publication of a replacement races a vendor save of the same version.
current = await head();
const draft = JSON.parse(await sql(as(operator, `select public.admin_save_package_draft_content(null, null, '${contractor}', '${service}', '${current.id}'::uuid, '${JSON.stringify({
  name: 'Synthetic concurrency plan', pricing_mode: 'fixed', tiers: [{ id: 'one', name: 'One-time', frequency: 'one-time', price_kind: 'exact', price: 140 }] })}'::jsonb)`)));
const stamp = await sql(`select updated_at from private.operator_package_drafts where id = '${draft.id}'`);
const c4 = await settle([
  sql(as(operator, `select public.admin_publish_package_draft('${draft.id}', '${stamp}', 'Synthetic concurrency correction')`)),
  save(current.id, current.hash, 150, 'vo-conc-key-c4-save0001'),
]);
assert.equal(c4[0].status, 'fulfilled', `the operator publication succeeds (${c4[0].reason ?? ''})`);
assert.equal(await liveCount(), '1', 'one live revision after the race');
assert.equal(await sql(`select count(*) = count(distinct revision_number) from public.vendor_packages where contractor_id = '${contractor}'`), 't', 'revision numbers stay unique');
assert.equal(await sql(`select count(*) from public.service_requests r where r.customer_id::text like 'c113%' and (r.package_id is null or r.package_tier_id is null)`), '0',
  'no request lost its binding');

await cleanup();
console.log('Vendor offering concurrency: parallel saves, retried key, submissions racing a save, and operator publication racing a save passed.');
