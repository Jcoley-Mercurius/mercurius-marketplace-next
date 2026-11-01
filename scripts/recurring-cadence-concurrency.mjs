// TRACE-124: recurring cadence commands racing on separate connections. Visit creation (manual and
// from a proposal) racing a pause or a stop: every visit created before the pause/stop holds the
// plan lock, every later attempt is recorded as series_paused / series_ended, nothing is created
// after. Operators racing the same pause or re-anchor from one read: one wins, the rest are stale.
// Proposals racing a re-anchor: created before it or refused as stale. Replacement links racing for
// the same visits and dates: one decision per visit and per date. A retried key records once.
// Commands take the plan's advisory lock and then lock the plan row, which assigns the transaction
// id, so xmin order is the order the lock was held. Run only against a disposable local or
// isolated database with 20261026002000 applied. Synthetic fixtures only; removed at the end
// (history rows are append-only, so cleanup bypasses triggers as postgres).
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
const operators = [3, 4, 5, 6, 7].map(user);
const contractor = 'c9720000-0000-4000-8000-000000000001';
const pkg = 'c9740000-0000-4000-8000-000000000001';
const tier = 'c9750000-0000-4000-8000-000000000001';
const plans = ['c9730000-0000-4000-8000-000000000001', 'c9730000-0000-4000-8000-000000000002'];
const service = 'synthetic-rc-concurrency';
const local = (days, time) => `((now() at time zone 'America/New_York')::date + ${days} + time '${time}')`;
const manual = (plan, key, days, time, reason) => `select public.admin_create_recurring_visit('${plan}','${key}',
  ${local(days, time)} at time zone 'America/New_York', ${local(days, time)}, '${reason}')::text`;
// A proposal as the preview returns it: its date, Eastern wall time and resolved instant.
const cadence = (plan, key, anchor, proposal, reason) => `select public.admin_create_cadence_visit('${plan}','${key}','${anchor}',
  '${proposal.cadence_date}','${proposal.starts_at}','${proposal.local_start}','${reason}')::text`;
const lifecycle = (plan, key, action, expected, reason) =>
  `select public.admin_set_recurring_plan_state('${plan}','${key}','${action}','${expected}','${reason}')::text`;
const anchor = (plan, key, expected, days, time) => `select public.admin_record_recurring_anchor('${plan}','${key}',${expected ? `'${expected}'` : 'null'},
  ${local(days, time)} at time zone 'America/New_York', ${local(days, time)}, 'Synthetic agreement', 'Synthetic anchor')::text`;
const resolve = (plan, key, anchorId, date, kind, visit) => `select public.admin_resolve_cadence_date('${plan}','${key}','${anchorId}','${date}','${kind}',
  ${visit ? `'${visit}'` : 'null'},'Synthetic decision')::text`;
const proposals = async (plan) => JSON.parse(await sql(`select (private.recurring_cadence_preview('${plan}', now())->'proposals')::text`));
const currentAnchor = (plan) => sql(`select id from private.recurring_series_anchors where series_id='${plan}' order by seq desc limit 1`);
const settled = (results) => results.map((r) => (r.status === 'fulfilled' ? JSON.parse(r.value) : { error: r.reason.message }));
const xid = (column) => `${column}::text::bigint`;

async function cleanup() {
  const ids = plans.map((p) => `'${p}'`).join(',');
  await sql(`set session_replication_role = replica;
    delete from private.recurring_cadence_resolutions where series_id in (${ids});
    delete from private.recurring_visit_generations where series_id in (${ids});
    delete from private.recurring_series_lifecycle where series_id in (${ids});
    delete from private.recurring_series_anchors where series_id in (${ids});
    delete from private.recurring_series_terms where series_id in (${ids});
    delete from public.job_events where job_id in (select id from public.service_requests where id in (${ids}) or recurrence_parent_id in (${ids}));
    delete from public.notifications where related_request_id in (select id from public.service_requests where id in (${ids}) or recurrence_parent_id in (${ids}));
    delete from public.job_match_attempts where service_request_id in (select id from public.service_requests where id in (${ids}) or recurrence_parent_id in (${ids}));
    delete from public.service_requests where recurrence_parent_id in (${ids});
    delete from public.service_requests where id in (${ids});
    delete from public.package_tiers where id = '${tier}';
    delete from public.vendor_packages where id = '${pkg}';
    delete from public.contractor_service_zips where contractor_id = '${contractor}';
    delete from public.contractors where id = '${contractor}';
    delete from private.r0_trial_admissions where homeowner_id = '${homeowner}';
    delete from private.r0_lee_zips where zip_code = '00971';
    delete from public.coverage_areas where zip_code = '00971';
    delete from public.services_catalog where id = '${service}';
    delete from public.user_roles where user_id::text like 'c9710000-%';
    -- replica mode skips cascades, so rows that would follow the users are removed explicitly.
    delete from public.profiles where user_id::text like 'c9710000-%';
    delete from auth.users where id::text like 'c9710000-%';
    set session_replication_role = origin;`);
}

await cleanup();
await sql(`
  insert into auth.users(id, raw_user_meta_data) select ('c9710000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic concurrency"}' from generate_series(1, 7) n;
  delete from public.user_roles where user_id::text like 'c9710000-%' and user_id <> '${homeowner}';
  insert into public.user_roles(user_id, role) values ('${vendorUser}', 'vendor');
  insert into public.user_roles(user_id, role) select ('c9710000-0000-4000-8000-00000000000' || n)::uuid, 'admin' from generate_series(3, 7) n;
  insert into public.services_catalog(id, name, category_id, one_time_price, weekly_price, monthly_price, default_frequency, available_frequencies, is_active)
    select '${service}', 'Synthetic cadence concurrency lawn', id, 60, 40, 120, 'weekly', '{one-time,weekly}', true from public.service_categories order by id limit 1;
  insert into public.coverage_areas(zip_code, city, is_active, has_waitlist) values ('00971', 'Synthetic', true, false);
  insert into private.r0_lee_zips values ('00971');
  insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '00971', '${service}', '${operators[0]}');
  insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values ('${contractor}', '${vendorUser}', 'Synthetic cadence concurrency provider', true, true);
  insert into public.contractor_service_zips(contractor_id, zip_code) values ('${contractor}', '00971');
  insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active, needs_review)
    values ('${pkg}', '${contractor}', '${service}', 'Synthetic cadence concurrency package', 'fixed', 'weekly', false, false);
  insert into public.package_tiers(id, package_id, name, price, frequency, sort_order, rule_conditions) values ('${tier}', '${pkg}', 'Weekly', 40, 'weekly', 0, '[]');
  -- TRACE-134: a version's levels are written while it is paused, then it is published.
  update public.vendor_packages set is_active = true where id = '${pkg}';
  insert into public.service_requests(id, customer_id, service_type, service_catalog_id, address, city, state, zip_code, frequency, status, matching_status, preferred_contractor_id)
    select p, '${homeowner}', 'Synthetic cadence concurrency lawn', '${service}', '1 Synthetic Way', 'Synthetic', 'FL', '00971', 'weekly', 'pending', 'awaiting_match', '${contractor}'
    from unnest(array['${plans[0]}', '${plans[1]}']::uuid[]) p;
  select private.offer_next_for_request_internal('${plans[0]}');
  select private.offer_next_for_request_internal('${plans[1]}');`);
for (const plan of plans) await sql(as(vendorUser, `select public.vendor_accept_job('${plan}')`));
assert.equal(await sql(`select count(*) from private.recurring_series_terms where series_id in ('${plans[0]}','${plans[1]}')`), '2', 'both plans are accepted');
const moneyBefore = await sql(`select count(*) from public.money_obligations`);

try {
  const [plan, plan2] = plans;
  await sql(as(operators[0], anchor(plan, randomUUID(), null, 3, '09:00')));
  const anchorId = await currentAnchor(plan);

  // 1. Two proposals and six manual visits race a pause.
  const open = await proposals(plan);
  assert.equal(open.length, 2, 'two proposals to race');
  const pauseKey = randomUUID();
  const race = await Promise.allSettled([
    ...open.map((p, i) => sql(as(operators[i], cadence(plan, randomUUID(), anchorId, p, `Proposal ${i}`)))),
    ...[20, 21, 22, 23, 25, 26].map((days, i) => sql(as(operators[i % 5], manual(plan, randomUUID(), days, '11:00', `Manual ${i}`)))),
    sql(as(operators[4], lifecycle(plan, pauseKey, 'pause', 'active', 'Racing pause'))),
  ]);
  const raced = settled(race);
  // Manual visits that take the lock first fill the two-visit capacity, so a proposal behind them
  // is correctly refused as no longer current (nothing recorded); nothing else may fail.
  assert.ok(raced.slice(0, 2).every((r) => !r.error || r.error.includes('This proposed visit is no longer current')), 'proposals: created, paused or no longer current');
  assert.ok(raced.slice(2).every((r) => !r.error), `no other command failed: ${JSON.stringify(raced.slice(2).filter((r) => r.error))}`);
  const creations = raced.slice(0, 8).filter((r) => !r.error);
  assert.ok(creations.every((r) => r.outcome === 'created' || r.code === 'series_paused'), 'each recorded creation is created or refused as paused');
  const created = creations.filter((r) => r.outcome === 'created').length;
  assert.equal(await sql(`select count(*) from public.service_requests where recurrence_parent_id='${plan}'`), String(created), 'one visit per created outcome');
  assert.equal(await sql(`select count(*) from private.recurring_visit_generations g, private.recurring_series_lifecycle l
    where g.series_id='${plan}' and l.series_id='${plan}' and l.action='pause'
      and ((g.outcome='created' and ${xid('g.xmin')} > ${xid('l.xmin')}) or (g.block_code='series_paused' and ${xid('g.xmin')} < ${xid('l.xmin')}))`),
    '0', 'every visit was created before the pause held the lock, every refusal after');
  assert.equal(JSON.parse(await sql(as(operators[1], manual(plan, randomUUID(), 27, '11:00', 'After pause')))).code, 'series_paused', 'paused afterwards');

  // 2. Resume, then six manual visits race "stop future visits".
  await sql(as(operators[0], lifecycle(plan, randomUUID(), 'resume', 'paused', 'Resume')));
  const before = Number(await sql(`select count(*) from public.service_requests where recurrence_parent_id='${plan}'`));
  const stopRace = settled(await Promise.allSettled([
    ...[40, 41, 43, 44, 46, 47].map((days, i) => sql(as(operators[i % 5], manual(plan, randomUUID(), days, '11:00', `Manual stop ${i}`)))),
    sql(as(operators[2], lifecycle(plan, randomUUID(), 'stop', 'active', 'Racing stop'))),
  ]));
  assert.ok(stopRace.every((r) => !r.error), 'no command failed');
  assert.ok(stopRace.slice(0, 6).every((r) => r.outcome === 'created' || r.code === 'series_ended'), 'each creation is created or refused as ended');
  const stopCreated = stopRace.slice(0, 6).filter((r) => r.outcome === 'created').length;
  assert.equal(Number(await sql(`select count(*) from public.service_requests where recurrence_parent_id='${plan}'`)), before + stopCreated);
  assert.equal(await sql(`select count(*) from private.recurring_visit_generations g, private.recurring_series_lifecycle l
    where g.series_id='${plan}' and l.series_id='${plan}' and l.action='stop'
      and ((g.outcome='created' and ${xid('g.xmin')} > ${xid('l.xmin')}) or (g.block_code='series_ended' and ${xid('g.xmin')} < ${xid('l.xmin')}))`),
    '0', 'every visit was created before the stop, every refusal after');
  assert.equal(await sql(`select status from public.service_requests where id='${plan}'`), 'scheduled', 'the plan request status is unchanged');

  // 3. Proposals on plan 2 race five re-anchors from the same read.
  await sql(as(operators[0], anchor(plan2, randomUUID(), null, 3, '09:00')));
  const a1 = await currentAnchor(plan2);
  const open2 = await proposals(plan2);
  assert.equal(open2.length, 2);
  const reanchor = settled(await Promise.allSettled([
    ...open2.map((p, i) => sql(as(operators[i], cadence(plan2, randomUUID(), a1, p, `Proposal ${i}`)))),
    ...[4, 5, 6, 8, 9].map((days, i) => sql(as(operators[i], anchor(plan2, randomUUID(), a1, days, '10:00')))),
  ]));
  const anchors = reanchor.slice(2);
  assert.equal(anchors.filter((r) => !r.error).length, 1, 'one re-anchor wins');
  assert.ok(anchors.filter((r) => r.error).every((r) => r.error.includes('The cadence changed since you loaded it')), 'the rest are stale');
  assert.ok(reanchor.slice(0, 2).every((r) => r.outcome === 'created' || r.error?.includes('The cadence changed since you loaded it')),
    'proposals are created or refused as stale');
  assert.equal(await sql(`select count(*) from private.recurring_visit_generations g, private.recurring_series_anchors a
    where g.series_id='${plan2}' and a.series_id='${plan2}' and a.replaces_anchor_id is not null and g.outcome='created' and ${xid('g.xmin')} > ${xid('a.xmin')}`),
    '0', 'no proposal from the earlier anchor was created after the re-anchor');
  assert.equal(await sql(`select count(*) from private.recurring_series_anchors where series_id='${plan2}'`), '2', 'a linear chain of two anchors');

  // 4. Replacement links and a skip racing for two visits and two dates.
  const a2 = await currentAnchor(plan2);
  const v1 = JSON.parse(await sql(as(operators[0], manual(plan2, randomUUID(), 14, '15:00', 'Off cadence 1')))).occurrence_id;
  const v2 = JSON.parse(await sql(as(operators[0], manual(plan2, randomUUID(), 17, '15:00', 'Off cadence 2')))).occurrence_id;
  // Days 14 and 17 are off-cadence for any winning anchor (days 4, 5, 6, 8 or 9); the dates follow the winner.
  const dates = (await sql(`select string_agg((a.local_start::date + 7 * n)::text, ',' order by n) from private.recurring_series_anchors a, generate_series(3, 4) n
    where a.id = '${a2}'`)).split(',');
  const links = settled(await Promise.allSettled([
    sql(as(operators[0], resolve(plan2, randomUUID(), a2, dates[0], 'replaced', v1))),
    sql(as(operators[1], resolve(plan2, randomUUID(), a2, dates[1], 'replaced', v1))),
    sql(as(operators[2], resolve(plan2, randomUUID(), a2, dates[0], 'replaced', v2))),
    sql(as(operators[3], resolve(plan2, randomUUID(), a2, dates[1], 'replaced', v2))),
    sql(as(operators[4], resolve(plan2, randomUUID(), a2, dates[0], 'skipped', null))),
  ]));
  const won = links.filter((r) => !r.error).length;
  assert.ok(won >= 1 && won <= 2, 'at most one decision per date');
  assert.equal(await sql(`select count(*) from private.recurring_cadence_resolutions where series_id='${plan2}'`), String(won));
  assert.equal(await sql(`select count(*) from (select occurrence_id from private.recurring_cadence_resolutions where series_id='${plan2}' and occurrence_id is not null
    group by occurrence_id having count(*) > 1) x`), '0', 'no visit satisfies two dates');
  assert.equal(await sql(`select count(*) from (select cadence_date from private.recurring_cadence_resolutions where series_id='${plan2}' group by cadence_date having count(*) > 1) x`),
    '0', 'no date is decided twice');

  // 5. Five operators pause from the same read; one key retried eight times records once.
  const pauses = settled(await Promise.allSettled(operators.map((operator, i) => sql(as(operator, lifecycle(plan2, randomUUID(), 'pause', 'active', `Pause ${i}`))))));
  assert.equal(pauses.filter((r) => !r.error).length, 1, 'one pause wins');
  assert.ok(pauses.filter((r) => r.error).every((r) => r.error.includes('The plan changed since you loaded it')), 'the rest are stale');
  const resumeKey = randomUUID();
  const resumes = settled(await Promise.allSettled(Array.from({ length: 8 }, () => sql(as(operators[0], lifecycle(plan2, resumeKey, 'resume', 'paused', 'Retried resume'))))));
  assert.ok(resumes.every((r) => !r.error && r.to_state === 'active'), 'every retry returns the recorded resume');
  assert.equal(await sql(`select count(*) from private.recurring_series_lifecycle where series_id='${plan2}'`), '2', 'one pause and one resume');

  assert.equal(await sql(`select count(*) from public.job_match_attempts a join public.service_requests r on r.id=a.service_request_id
    where r.recurrence_parent_id in ('${plan}','${plan2}') group by a.service_request_id having count(*) > 1`), '', 'no visit has two offers');
  assert.equal(await sql(`select count(*) from public.money_obligations`), moneyBefore, 'no payment obligation');
  console.log(`PASS: creations racing pause (${created}/8 before, ${8 - creations.length} proposals past capacity) and stop (${stopCreated}/6 before) are created before or refused after, never in between; one of five pauses and re-anchors wins; proposals from a replaced anchor are refused; links race to one decision per visit and date; a retried resume records once; no obligation.`);
} finally {
  await cleanup();
}
