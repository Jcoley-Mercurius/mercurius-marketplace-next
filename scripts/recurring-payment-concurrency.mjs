// TRACE-125: recurring visit payment on separate connections. Identical approved publications sent
// in parallel give one snapshot; tier, add-on and package edits racing publication never change the
// visit's amount; parallel homeowner checkouts give one attempt; a duplicated capture event captures
// once; queue and readback reads during capture never fail or write; pausing the plan while the
// homeowner checks out leaves the payment untouched. Run only against a disposable local or isolated
// database with 20261027001000 applied. Synthetic fixtures only; they are removed at the end
// (history and money rows are append-only, so cleanup bypasses triggers as postgres).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const container = process.env.RECURRING_DB_CONTAINER ?? 'supabase_db_mercurius-phase5-isolated';
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
const as = (sub, statement) => `begin; set local role authenticated;
set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub })}';
${statement}; commit;`;

const user = (n) => `c9710000-0000-4000-8000-00000000000${n}`;
const homeowner = user(1);
const vendorUser = user(2);
const [operator, finance, approver] = [3, 4, 5].map(user);
const contractor = 'c9720000-0000-4000-8000-000000000001';
const pkg = 'c9740000-0000-4000-8000-000000000001';
const tier = 'c9750000-0000-4000-8000-000000000001';
const plan = 'c9730000-0000-4000-8000-000000000001';
const service = 'synthetic-rp-concurrency';
const zip = '00971';
const local = (days) => `((now() at time zone 'America/New_York')::date + ${days} + time '09:00')`;
const ours = `(select id from public.service_requests where id = '${plan}' or recurrence_parent_id = '${plan}')`;
const obligations = `(select id from public.money_obligations where service_request_id in ${ours})`;

async function cleanup() {
  await sql(`set session_replication_role = replica;
    delete from public.money_webhook_events where payload->>'attempt_id' in (select id::text from public.money_checkout_attempts where obligation_id in ${obligations});
    delete from public.money_commercial_sources where snapshot_id in (select id from public.money_snapshots where obligation_id in ${obligations});
    do $$ declare t text; begin
      for t in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'obligation_id'
          and table_name <> 'money_snapshots' loop
        execute format('delete from public.%I where obligation_id in (select id from public.money_obligations where service_request_id in
          (select id from public.service_requests where id = %L or recurrence_parent_id = %L))', t, '${plan}', '${plan}');
      end loop; end $$;
    delete from public.money_snapshots where obligation_id in ${obligations};
    delete from public.money_obligations where service_request_id in ${ours};
    delete from public.money_review_approvals where requested_by::text like 'c9710000-%';
    delete from public.money_authorities where user_id::text like 'c9710000-%';
    delete from private.recurring_series_lifecycle where series_id = '${plan}';
    delete from private.recurring_visit_generations where series_id = '${plan}';
    delete from private.recurring_series_terms where series_id = '${plan}';
    delete from public.job_events where job_id in ${ours};
    delete from public.notifications where related_request_id in ${ours};
    delete from public.job_match_attempts where service_request_id in ${ours};
    delete from public.service_requests where recurrence_parent_id = '${plan}';
    delete from public.service_requests where id = '${plan}';
    delete from public.package_addons where package_id = '${pkg}';
    delete from public.package_tiers where id = '${tier}';
    delete from public.vendor_packages where id = '${pkg}';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from private.r0_trial_admissions where homeowner_id = '${homeowner}';
    delete from private.r0_lee_zips where zip_code = '${zip}';
    delete from public.coverage_areas where zip_code = '${zip}';
    delete from public.services_catalog where id = '${service}';
    delete from public.user_roles where user_id::text like 'c9710000-%';
    delete from public.profiles where user_id::text like 'c9710000-%';
    delete from auth.users where id::text like 'c9710000-%';
    set session_replication_role = origin;`);
}

// A visit on day n, accepted by the plan provider; returns its id.
async function acceptedVisit(days) {
  const created = JSON.parse(await sql(as(operator, `select public.admin_create_recurring_visit('${plan}','${randomUUID()}',
    ${local(days)} at time zone 'America/New_York', ${local(days)}, 'Synthetic concurrency visit')::text`)));
  assert.equal(created.outcome, 'created');
  await sql(as(vendorUser, `select public.vendor_accept_job('${created.occurrence_id}')`));
  return created.occurrence_id;
}
// The reviewed terms and the second finance operator's approval of that exact command.
async function approvedTerms(visit) {
  const terms = await sql(`select jsonb_build_object('service',4000,'addons',0,'discount',0,'adjustment',0,'subtotal',4000,'tax',0,'tip',0,
    'deposit',0,'total',4000,'currency','usd','source_version',private.money_source('${visit}')->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic concurrency review','expires_at',date_trunc('second', now()+interval '2 days'))::text`);
  await sql(as(approver, `select public.money_approve_review('${finance}', jsonb_build_object('operation','snapshot','request','${visit}'::uuid,'terms','${terms}'::jsonb), 'Second review')`));
  return terms;
}
const publish = (visit, terms) => sql(`select public.money_publish_snapshot('${visit}','${terms}'::jsonb,'${finance}','${approver}')`);

await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9710000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic payments"}' from generate_series(1, 5) n;
  delete from public.user_roles where user_id::text like 'c9710000-%' and user_id <> '${homeowner}';
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor'), ('${operator}', 'admin'), ('${finance}', 'admin'), ('${approver}', 'admin');
  insert into public.money_authorities(user_id, granted_by, reason) values ('${finance}', '${approver}', 'Synthetic'), ('${approver}', '${finance}', 'Synthetic');
  insert into public.services_catalog(id, name, category_id, one_time_price, weekly_price, monthly_price, default_frequency, available_frequencies, is_active)
    select '${service}', 'Synthetic payment lawn', id, 60, 40, 120, 'weekly', '{one-time,weekly}', true from public.service_categories order by id limit 1;
  insert into public.coverage_areas(zip_code, city, is_active, has_waitlist) values ('${zip}', 'Synthetic', true, false);
  insert into private.r0_lee_zips values ('${zip}');
  insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '${zip}', '${service}', '${operator}');
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic payment provider', true, true);
  insert into public.contractor_service_zips(contractor_id, zip_code) values ('${contractor}', '${zip}');
  insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active, needs_review)
    values ('${pkg}', '${contractor}', '${service}', 'Synthetic payment package', 'fixed', 'weekly', false, false);
  insert into public.package_tiers(id, package_id, name, price, frequency, sort_order, rule_conditions) values ('${tier}', '${pkg}', 'Weekly', 40, 'weekly', 0, '[]');
  -- TRACE-134: a version's levels are written while it is paused, then it is published.
  update public.vendor_packages set is_active = true where id = '${pkg}';
  insert into public.service_requests(id, customer_id, service_type, service_catalog_id, address, city, state, zip_code, frequency, status, matching_status, preferred_contractor_id)
    values ('${plan}', '${homeowner}', 'Synthetic payment lawn', '${service}', '1 Synthetic Way', 'Synthetic', 'FL', '${zip}', 'weekly', 'pending', 'awaiting_match', '${contractor}');
  select private.offer_next_for_request_internal('${plan}');`);
await sql(as(vendorUser, `select public.vendor_accept_job('${plan}')`));

try {
  const [a, b, c] = [await acceptedVisit(10), await acceptedVisit(17), await acceptedVisit(24)];

  // 1. The same approved publication sent eight times at once, racing tier, add-on and package edits:
  // one snapshot at the agreed $40, whatever the catalog says.
  const termsA = await approvedTerms(a);
  // TRACE-134 (6.11A): the plan's version is in use, so an in-place edit is refused on every application
  // path. The race below keeps characterizing what such an edit would do, as owner maintenance from a
  // direct session (row locks and every other trigger still apply); TRACE-126/127 stay open.
  await assert.rejects(sql(`update public.package_tiers set price = 47 where id = '${tier}'`), /Requests use this price version/);
  const maintenance = "set mercurius.package_maintenance = 'on'; ";
  const edits = [`update public.package_tiers set price = 47 where id = '${tier}'`, `update public.vendor_packages set description = 'Edited' where id = '${pkg}'`,
    `update public.package_tiers set name = 'Weekly edited' where id = '${tier}'`, `update public.package_tiers set price = 52 where id = '${tier}'`];
  const raced = await Promise.allSettled([...Array.from({ length: 8 }, () => publish(a, termsA)), ...edits.map((edit) => sql(maintenance + edit))]);
  for (const r of raced) if (r.status === 'rejected') console.error('RACER', r.reason.message.slice(0, 300));
  assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 12, 'every publication and every edit succeeds');
  assert.equal(new Set(raced.slice(0, 8).map((result) => result.value)).size, 1, 'all publications return one snapshot');
  assert.equal(await sql(`select count(*)||':'||max(service)||':'||max(total) from public.money_snapshots s join public.money_obligations o on o.id = s.obligation_id
    where o.service_request_id = '${a}'`), '1:4000:4000', 'one snapshot at the agreed amount');
  assert.equal(await sql(`select (private.money_source('${b}')->>'service')`), '4000', 'the next visit is still sourced at $40 after the edits');

  // 2. Eight parallel checkouts by the homeowner: one attempt, the same one each time.
  const snapshotA = raced[0].value;
  const checkouts = await Promise.allSettled(Array.from({ length: 8 }, () => sql(as(homeowner, `select (public.money_prepare_checkout('${snapshotA}','full')).id`))));
  const attempts = new Set(checkouts.filter((result) => result.status === 'fulfilled').map((result) => result.value));
  assert.equal(attempts.size, 1, 'every successful checkout names the same attempt');
  assert.equal(await sql(`select count(*)||':'||max(amount) from public.money_checkout_attempts where snapshot_id = '${snapshotA}'`), '1:4000', 'one attempt at $40');
  for (const result of checkouts.filter((item) => item.status === 'rejected')) {
    assert.match(result.reason.message, /could not serialize|deadlock|Checkout already in progress/, 'a rejected racer is a retryable conflict, not a second attempt');
  }

  // 3. A duplicated capture event, processed four times at once while operations and the homeowner read.
  const attempt = [...attempts][0];
  await sql(`select public.money_receive_event('evt_rp_conc_cap','capture',jsonb_build_object('attempt_id','${attempt}'::uuid,'payment_id','pi_rp_conc','amount',4000,'currency','usd'))`);
  const reads = [
    ...Array.from({ length: 4 }, () => sql(`select public.money_process_event('evt_rp_conc_cap')`)),
    ...Array.from({ length: 3 }, () => sql(as(operator, `select jsonb_array_length(public.admin_recurring_payment_queue()->'items')`))),
    ...Array.from({ length: 3 }, () => sql(as(homeowner, `select public.recurring_series('${plan}')->'visits'->0->'payment_state'->>'state'`))),
  ];
  const settled = await Promise.allSettled(reads);
  assert.equal(settled.slice(4).filter((result) => result.status === 'rejected').length, 0, 'queue and readback reads never fail during capture');
  await sql(`select public.money_process_event('evt_rp_conc_cap')`);
  assert.equal(await sql(`select captured from public.money_obligations where service_request_id = '${a}'`), '4000', 'captured exactly once');
  assert.equal(await sql(`select count(*) from public.money_journals j join public.money_obligations o on o.id = j.obligation_id
    where o.service_request_id = '${a}' and j.kind = 'capture'`), '1', 'one capture journal');
  assert.equal(await sql(`select private.recurring_visit_payment(v, now())->>'state' from public.service_requests v where id = '${a}'`), 'paid');

  // 4. Pausing the plan while the homeowner checks out visit B: both succeed; the payment is untouched.
  const termsB = await approvedTerms(b);
  const snapshotB = await publish(b, termsB);
  const [pause, checkoutB] = await Promise.allSettled([
    sql(as(operator, `select public.admin_set_recurring_plan_state('${plan}','${randomUUID()}','pause','active','Synthetic pause')::text`)),
    sql(as(homeowner, `select (public.money_prepare_checkout('${snapshotB}','full')).amount`)),
  ]);
  assert.equal(pause.status, 'fulfilled', 'the pause is recorded');
  assert.equal(checkoutB.status, 'fulfilled', 'the checkout proceeds');
  assert.equal(checkoutB.value, '4000');
  assert.equal(await sql(`select private.recurring_visit_payment(v, now())->>'state' from public.service_requests v where id = '${b}'`), 'processing');

  // 5. Reads wrote nothing: visit C has no obligation; there is one snapshot per published visit.
  assert.equal(await sql(`select count(*) from public.money_obligations where service_request_id = '${c}'`), '0', 'an unpublished visit has no obligation');
  assert.equal(await sql(`select count(*) from public.money_snapshots s join public.money_obligations o on o.id = s.obligation_id
    where o.service_request_id in ${ours}`), '2', 'one snapshot per published visit');
  console.log('PASS: parallel publications give one snapshot at the agreed amount despite racing catalog edits; parallel checkouts give one attempt; a duplicated capture captures once; reads never fail or write; pausing does not disturb a checkout.');
} finally {
  await cleanup();
}
