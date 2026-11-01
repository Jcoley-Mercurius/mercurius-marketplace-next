// TRACE-113/114: concurrent promotion redemptions, platform budget, idempotent retries,
// approval racing an edit, and parallel publication; DEC-2026-041: one first-booking
// redemption per homeowner and one active package per name, under races; TRACE-116
// (DEC-2026-042): submissions racing for the last redemption, overlapping cleanup runs, and
// cleanup racing a homeowner's replacement. Run only against a disposable local or isolated
// database with migrations 20261018001000-20261018006000 applied. Synthetic
// fixtures only; they are removed at the end so the script can be rerun.
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

const operator = 'b8910000-0000-4000-8000-000000000001';
const vendorUser = 'b8910000-0000-4000-8000-000000000002';
const contractor = 'b8920000-0000-4000-8000-000000000001';
const pkg = 'b8940000-0000-4000-8000-000000000001';
const request = (n) => `b8950000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const startedAt = new Date().toISOString();
const gateWasOpen = await sql(`select coalesce((select enabled from private.money_feature_gates where name='promotions_checkout'), false)`);

async function cleanup() {
  await sql(`
    delete from private.promotion_selection_events where service_request_id in (select id from public.service_requests where customer_id::text like 'b893%');
    delete from private.promotion_selections where customer_id::text like 'b893%';
    delete from private.promotion_sweep_runs where started_at >= '${startedAt}';
    delete from private.promotion_redemptions where customer_id::text like 'b893%' or service_request_id::text like 'b8950000-%';
    delete from public.service_request_submission_items where submission_id in (select id from public.service_request_submissions where customer_id::text like 'b893%');
    delete from public.service_request_submissions where customer_id::text like 'b893%';
    delete from public.service_requests where customer_id::text like 'b893%';
    delete from private.r0_trial_admissions where homeowner_id::text like 'b893%';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    update private.money_feature_gates set enabled = ${gateWasOpen === 't'} where name = 'promotions_checkout';
    delete from private.promotion_offer_events where offer_id in (select id from private.promotion_offers where label like 'Concurrency %');
    delete from private.promotion_offers where label like 'Concurrency %';
    delete from public.service_requests where id::text like 'b8950000-%';
    delete from private.package_draft_events where draft_id in (select id from private.operator_package_drafts where contractor_id = '${contractor}');
    delete from private.vendor_package_price_corrections where contractor_id = '${contractor}';
    delete from private.operator_package_drafts where contractor_id = '${contractor}';
    delete from public.notifications where user_id = '${vendorUser}';
    delete from public.package_tiers where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    delete from public.package_addons where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    delete from public.package_qualifying_questions where package_id in (select id from public.vendor_packages where contractor_id = '${contractor}');
    update public.vendor_packages set is_active = false where contractor_id = '${contractor}';
    delete from public.vendor_packages where contractor_id = '${contractor}' and lineage_id <> id;
    delete from public.vendor_packages where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from public.services_catalog where id = 'synthetic-concurrency-svc';
    delete from public.service_categories where id = 'synthetic-concurrency-cat';
    delete from public.coverage_areas where zip_code = '00089';
    delete from private.r0_lee_zips where zip_code = '00089';
    delete from public.user_roles where user_id::text like 'b891%' or user_id::text like 'b893%';
    delete from auth.users where id::text like 'b891%' or id::text like 'b893%';`);
}

await cleanup();
await sql(`
  insert into auth.users(id,email,email_confirmed_at) values
    ('${operator}','concurrency-operator@example.invalid',now()),('${vendorUser}','concurrency-vendor@example.invalid',now());
  insert into auth.users(id,email,email_confirmed_at)
    select ('b8930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'concurrency-homeowner-'||n||'@example.invalid',now() from generate_series(1,20) n;
  delete from public.user_roles where user_id = '${vendorUser}';
  insert into public.user_roles(user_id,role) values ('${operator}','admin'),('${vendorUser}','vendor');
  insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values ('${contractor}','Synthetic concurrency vendor',true,true,'${vendorUser}');
  insert into public.service_categories(id,name) values ('synthetic-concurrency-cat','Synthetic concurrency');
  insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,default_frequency,available_frequencies,is_active)
    values ('synthetic-concurrency-svc','Synthetic concurrency service','synthetic-concurrency-cat',100,60,'one-time','{one-time}',true);
  insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00089','Synthetic',true,false);
  insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
    values ('${pkg}','${contractor}','synthetic-concurrency-svc','Synthetic concurrency package','fixed','one-time',true,false);
  -- TRACE-134: a version's levels are written before any request uses it.
  insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions)
    values ('b8960000-0000-4000-8000-000000000001','${pkg}','One-time',100,'one-time',0,'[]');
  insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,package_id,pricing_mode,total_amount,status)
    select ('b8950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b8930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      '${contractor}','Synthetic','synthetic-concurrency-svc','1 Synthetic Way','Synthetic','FL','00089','one-time','${pkg}','fixed',100,'scheduled'
    from generate_series(1,20) n;`);

const offer = async (terms) => {
  const json = await sql(as(operator, `select public.admin_save_promotion_offer(null,null,'${JSON.stringify({
    terms: 'Synthetic', timezone: 'America/New_York',
    starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(),
    ...terms, label: `Concurrency ${terms.label}`,
  })}'::jsonb)`));
  const { id, fingerprint } = JSON.parse(json);
  await sql(as(operator, `select public.admin_authorize_platform_promotion('${id}','${fingerprint}','Synthetic concurrency budget')`));
  return id;
};
const reserve = (offerId, n, key) => sql(`select private.promotion_reserve('${offerId}','${request(n)}',null,'${key}')->>'status'`);

// The last redemption: eight requests race for one remaining use.
const last = await offer({ label: 'last', funding: 'platform', kind: 'amount', amount_cents: 1000, budget_cents: 100000, max_redemptions: 1 });
const lastResults = await settle(Array.from({ length: 8 }, (_, i) => reserve(last, i + 1, `concurrency-last-${i + 1}`)));
assert.deepEqual(lastResults.map((r) => r.status), Array(8).fill('fulfilled'));
assert.equal(lastResults.filter((r) => r.value === 'reserved').length, 1, 'exactly one request takes the last redemption');
assert.equal(await sql(`select count(*) from private.promotion_redemptions where offer_id='${last}' and status in ('reserved','finalized')`), '1');

// The budget: $25 covers two $10 subsidies; eight race.
const budget = await offer({ label: 'budget', funding: 'platform', kind: 'amount', amount_cents: 1000, budget_cents: 2500 });
const budgetResults = await settle(Array.from({ length: 8 }, (_, i) => reserve(budget, i + 9, `concurrency-budget-${i + 9}`)));
assert.equal(budgetResults.filter((r) => r.value === 'reserved').length, 2, 'the budget admits two subsidies');
assert.equal(await sql(`select sum(platform_subsidy_cents) from private.promotion_redemptions where offer_id='${budget}' and status='reserved'`), '2000');

// Retries: one key retried in parallel creates one redemption.
const retry = await offer({ label: 'retry', funding: 'platform', kind: 'amount', amount_cents: 500, budget_cents: 100000 });
const retryResults = await settle(Array.from({ length: 6 }, () => reserve(retry, 17, 'concurrency-retry-key')));
assert.deepEqual([...new Set(retryResults.map((r) => r.value))], ['reserved']);
assert.equal(await sql(`select count(*) from private.promotion_redemptions where idempotency_key='concurrency-retry-key'`), '1');

// Approval racing an edit: the vendor never ends up approving a revision it did not see.
const content = (price) => JSON.stringify({ name: 'Synthetic concurrency draft', pricing_mode: 'fixed',
  tiers: [{ id: 'one', name: 'One-time', frequency: 'one-time', price_kind: 'exact', price }] });
const draft = JSON.parse(await sql(as(operator, `select public.admin_save_package_draft_content(null,null,'${contractor}','synthetic-concurrency-svc',null,'${content(80)}'::jsonb)`)));
const sent = JSON.parse(await sql(as(operator, `select public.admin_send_package_draft('${draft.id}','${draft.revision}')`)));
assert.equal(sent.status, 'sent');
const seen = sent.draft.revision;
const read = await sql(`select updated_at from private.operator_package_drafts where id='${draft.id}'`);
const race = await settle([
  ...Array.from({ length: 4 }, () => sql(as(vendorUser, `select public.vendor_approve_package_draft('${draft.id}','${seen}')`))),
  sql(as(operator, `select public.admin_save_package_draft_content('${draft.id}','${read}','${contractor}','synthetic-concurrency-svc',null,'${content(95)}'::jsonb)`)),
]);
assert.equal(race[4].status, 'fulfilled', `the operator's edit saves (${race[4].reason ?? ''})`);
// Whichever lands first, the edited revision ends unapproved: an earlier approval is reset
// by the edit, and a later one is refused as stale.
assert.equal(await sql(`select approval_state||':'||(content->'tiers'->0->>'price') from private.operator_package_drafts where id='${draft.id}'`), 'draft:95');
assert.equal(await sql(`select count(*) from private.operator_package_drafts where id='${draft.id}' and approval_state='approved' and approved_hash is distinct from content_hash`), '0');

// Parallel publication of one approved draft creates one package.
const current = await sql(`select content_hash from private.operator_package_drafts where id='${draft.id}'`);
await sql(as(operator, `select public.admin_send_package_draft('${draft.id}','${current}')`));
await sql(as(vendorUser, `select public.vendor_approve_package_draft('${draft.id}','${current}')`));
const stamp = await sql(`select updated_at from private.operator_package_drafts where id='${draft.id}'`);
const publishes = await settle(Array.from({ length: 6 }, () => sql(as(operator, `select public.admin_publish_package_draft('${draft.id}','${stamp}','Synthetic concurrency')`))));
assert.equal(publishes.filter((r) => r.status === 'fulfilled').length, 1, 'one publish succeeds');
assert.equal(await sql(`select count(*) from public.vendor_packages where contractor_id='${contractor}' and name='Synthetic concurrency draft'`), '1');

// Two approved drafts with the same name race: one active package carries the name.
const twin = async () => {
  const d = JSON.parse(await sql(as(operator, `select public.admin_save_package_draft_content(null,null,'${contractor}','synthetic-concurrency-svc',null,'${content(70).replace('Synthetic concurrency draft', 'Synthetic twin')}'::jsonb)`)));
  await sql(as(operator, `select public.admin_send_package_draft('${d.id}','${d.revision}')`));
  await sql(as(vendorUser, `select public.vendor_approve_package_draft('${d.id}','${d.revision}')`));
  return [d.id, await sql(`select updated_at from private.operator_package_drafts where id='${d.id}'`)];
};
const twins = [await twin(), await twin()];
await settle(twins.map(([id, at]) => sql(as(operator, `select public.admin_publish_package_draft('${id}','${at}','Synthetic twin')`))));
assert.equal(await sql(`select count(*) from public.vendor_packages where contractor_id='${contractor}' and is_active and lower(name)='synthetic twin'`), '1');

// DEC-2026-041 item 3: one homeowner races two first-booking offers on two requests.
await sql(`insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,package_id,pricing_mode,total_amount,status)
  select ('b8950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b8930000-0000-4000-8000-000000000019',
    '${contractor}','Synthetic','synthetic-concurrency-svc','1 Synthetic Way','Synthetic','FL','00089','one-time','${pkg}','fixed',100,'scheduled'
  from generate_series(21,28) n;`);
const firstA = await offer({ label: 'first A', funding: 'platform', kind: 'amount', amount_cents: 1000, budget_cents: 100000, first_booking_only: true });
const firstB = await offer({ label: 'first B', funding: 'platform', kind: 'amount', amount_cents: 1000, budget_cents: 100000, first_booking_only: true });
const firstResults = await settle(Array.from({ length: 8 }, (_, i) => reserve(i % 2 ? firstB : firstA, i + 21, `concurrency-first-${i + 21}`)));
assert.equal(firstResults.filter((r) => r.value === 'reserved').length, 1, 'one first-booking promotion per homeowner, whichever offer');
assert.equal(await sql(`select count(*) from private.promotion_redemptions where customer_id='b8930000-0000-4000-8000-000000000019' and first_booking and status in ('reserved','finalized')`), '1');

// Source item 2: the vendor editor races two active packages with one name.
const vendorInsert = () => sql(as(vendorUser, `insert into public.vendor_packages(contractor_id,service_id,name,pricing_mode,default_frequency,is_active)
  values ('${contractor}','synthetic-concurrency-svc','Synthetic vendor twin','fixed','one-time',true)`));
await settle(Array.from({ length: 6 }, vendorInsert));
assert.equal(await sql(`select count(*) from public.vendor_packages where contractor_id='${contractor}' and is_active and name='Synthetic vendor twin'`), '1');

// TRACE-116: eight homeowners submit the offer they chose; one use remains.
await sql(`
  update private.money_feature_gates set enabled = true where name = 'promotions_checkout';
  insert into private.r0_lee_zips values ('00089') on conflict do nothing;
  insert into public.contractor_service_zips(contractor_id,zip_code) values ('${contractor}','00089');
  insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
    select ('b8930000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00089','synthetic-concurrency-svc','${operator}' from generate_series(1,20) n;`);
const intake = await offer({ label: 'intake last', funding: 'platform', kind: 'amount', amount_cents: 1000, budget_cents: 100000, max_redemptions: 1 });
const intakeHash = await sql(`select content_hash from private.promotion_offers where id='${intake}'`);
const homeowner = (n) => `b8930000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const submitWithOffer = (n) => sql(as(homeowner(n), `select public.submit_service_requests('concurrency-intake-${String(n).padStart(4, '0')}', '${JSON.stringify({
  location: { address: '1 Synthetic Way', city: 'Synthetic', state: 'FL', zip_code: '00089' },
  selections: [{ service_id: 'synthetic-concurrency-svc', frequency: 'one-time', package_id: pkg, tier_id: 'b8960000-0000-4000-8000-000000000001',
    preferred_contractor_id: contractor, expected: { pricing_mode: 'fixed', total: 100 },
    promotion: { offer_id: intake, fingerprint: intakeHash, expected_discount_cents: 1000 } }],
})}'::jsonb)`));
const intakeResults = await settle(Array.from({ length: 8 }, (_, i) => submitWithOffer(i + 1)));
assert.deepEqual(intakeResults.map((r) => r.status), Array(8).fill('fulfilled'), `${intakeResults.find((r) => r.reason)?.reason ?? ''}`);
const intakeParsed = intakeResults.map((r) => JSON.parse(r.value));
assert.equal(intakeParsed.filter((r) => r.status === 'submitted').length, 1, 'one submission takes the last redemption');
assert.ok(intakeParsed.filter((r) => r.status === 'refused').every((r) => r.outcomes[0].reason === 'redemption_limit_reached'),
  'the others are refused with the reason, and nothing is created for them');
assert.equal(await sql(`select count(*) from public.service_requests r join public.service_request_submission_items i on i.service_request_id=r.id
  join public.service_request_submissions s on s.id=i.submission_id where s.submission_key like 'concurrency-intake-%'`), '1');
assert.equal(await sql(`select count(*) from private.promotion_selections s join private.promotion_redemptions x on x.id=s.redemption_id
  where x.offer_id='${intake}' and s.state='applied'`), '1');

// Six overlapping cleanup runs over six expired reservations release each exactly once.
const ended = await offer({ label: 'ended', funding: 'platform', kind: 'amount', amount_cents: 500, budget_cents: 100000 });
await sql(`insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,package_id,pricing_mode,total_amount,status)
  select ('b8950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b8930000-0000-4000-8000-'||lpad((n-30)::text,12,'0'))::uuid,
    '${contractor}','Synthetic','synthetic-concurrency-svc','1 Synthetic Way','Synthetic','FL','00089','one-time','${pkg}','fixed',100,'scheduled'
  from generate_series(31,36) n on conflict do nothing;`);
for (let n = 31; n <= 36; n += 1) assert.equal(await reserve(ended, n, `concurrency-ended-r${n}`), 'reserved');
await sql(`insert into private.promotion_selections(service_request_id,customer_id,state,redemption_id,confirmed_service_cents)
  select x.service_request_id,x.customer_id,'applied',x.id,x.homeowner_service_cents from private.promotion_redemptions x where x.offer_id='${ended}';
  update private.promotion_offers set ends_at = now() - interval '1 second' where id='${ended}';`);
const sweeps = await settle(Array.from({ length: 6 }, () => sql(`select private.run_promotion_release_sweep()::text`)));
assert.deepEqual(sweeps.map((r) => r.status), Array(6).fill('fulfilled'), `${sweeps.find((r) => r.reason)?.reason ?? ''}`);
const sweepTotal = sweeps.map((r) => JSON.parse(r.value)).reduce((sum, r) => sum + (r.released ?? 0), 0);
assert.equal(sweepTotal, 6, 'six releases across all runs');
assert.equal(await sql(`select count(*) from private.promotion_redemptions where offer_id='${ended}' and status='released' and release_reason='Offer ended before payment'`), '6');
assert.equal(await sql(`select count(*) from private.promotion_selection_events where offer_id='${ended}' and kind='released'`), '6', 'each release recorded once');
assert.equal(await sql(`select count(*) from private.promotion_selections s join public.service_requests r on r.id=s.service_request_id
  where r.id::text between 'b8950000-0000-4000-8000-000000000031' and 'b8950000-0000-4000-8000-000000000036' and s.state='needs_homeowner'`), '6');

// Cleanup races a homeowner replacing an offer that just ended: either order ends with the
// new offer applied once and the old one released once.
const old = await offer({ label: 'old', funding: 'platform', kind: 'amount', amount_cents: 500, budget_cents: 100000 });
const fresh = await offer({ label: 'fresh', funding: 'platform', kind: 'amount', amount_cents: 700, budget_cents: 100000 });
const freshHash = await sql(`select content_hash from private.promotion_offers where id='${fresh}'`);
await sql(`insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,package_id,pricing_mode,total_amount,status)
  select ('b8950000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('b8930000-0000-4000-8000-'||lpad((n-30)::text,12,'0'))::uuid,
    '${contractor}','Synthetic','synthetic-concurrency-svc','1 Synthetic Way','Synthetic','FL','00089','one-time','${pkg}','fixed',100,'scheduled'
  from generate_series(41,46) n;`);
for (let n = 41; n <= 46; n += 1) assert.equal(await reserve(old, n, `concurrency-old-r${n}`), 'reserved');
await sql(`insert into private.promotion_selections(service_request_id,customer_id,state,redemption_id,confirmed_service_cents)
  select x.service_request_id,x.customer_id,'applied',x.id,x.homeowner_service_cents from private.promotion_redemptions x where x.offer_id='${old}';
  update private.promotion_offers set ends_at = now() - interval '1 second' where id='${old}';`);
const choose = (n) => sql(as(homeowner(n - 30), `select public.homeowner_choose_request_promotion('${request(n)}','${fresh}','${freshHash}',null,9300,'concurrency-fresh-${n}')`));
const mixed = await settle([...Array.from({ length: 6 }, (_, i) => choose(i + 41)), sql(`select private.run_promotion_release_sweep()::text`)]);
assert.deepEqual(mixed.map((r) => r.status), Array(7).fill('fulfilled'), `${mixed.find((r) => r.reason)?.reason ?? ''}`);
assert.equal(await sql(`select count(*) from private.promotion_redemptions where offer_id='${fresh}' and status='reserved'`), '6', 'the new offer applied on each request');
assert.equal(await sql(`select count(*) from private.promotion_redemptions where offer_id='${old}' and status='released'`), '6', 'the old one released on each');
assert.equal(await sql(`select count(*) from private.promotion_selections s join private.promotion_redemptions x on x.id=s.redemption_id
  where x.offer_id='${fresh}' and s.state='applied' and s.confirmed_service_cents=9300`), '6', 'and the choice recorded');

await cleanup();
console.log('Pricing concurrency: last redemption, budget, retries, approval race, publication, first booking, package names, intake redemption race, overlapping cleanup and cleanup against replacement passed.');
