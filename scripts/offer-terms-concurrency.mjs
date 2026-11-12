// TRACE-150 (O-10, DEC-2026-063): offers at other terms on separate connections, with the real
// commands. Terms bound at offer creation are exactly the revision read, whatever a racing provider save
// does; acceptance after a save stays at the bound price; the homeowner's answers give exactly one
// recorded answer (replays aside); an answer racing a decline, a suspension or a force offer has only
// the two orderly outcomes; switching the offer_terms gate off serializes with offer creation and with
// the entry into awaiting_terms. No race may deadlock. C22 (review of #154, finding 1): a homeowner's
// decline whose re-match fails because a provider save lands between matching's selection and offer
// creation keeps the decline; ordered deterministically by a test-only pause trigger, removed at the end. Run only against a disposable local or isolated
// database with 20261117001000 applied. Synthetic fixtures only; removed at the end (history rows are
// append-only, so cleanup bypasses triggers as postgres) and the gate is left off.
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

const user = (n) => `c9c81000-0000-4000-8000-00000000000${n}`;
const homeowner = user(1);
const [p1User, p2User, operator] = [2, 3, 4].map(user);
const p1 = 'c9c82000-0000-4000-8000-000000000001';
const p2 = 'c9c82000-0000-4000-8000-000000000002';
const p1Pkg = 'c9c84000-0000-4000-8000-000000000001';
const p2Pkg = 'c9c84000-0000-4000-8000-000000000002';
const p1Tier = 'c9c85000-0000-4000-8000-000000000001';
const p2Tier = 'c9c85000-0000-4000-8000-000000000002';
const service = 'synthetic-ot-concurrency';
const zip = '00973';
const ours = `(select id from public.service_requests where customer_id = '${homeowner}')`;
const deadlock = /deadlock detected/;
const gate = (on, reason) => sql(`update private.money_feature_gates set enabled = ${on}, reason = '${reason}' where name = 'offer_terms'`);

async function cleanup() {
  await sql(`drop trigger if exists c22_pause_offer_creation on public.job_match_attempts;
    drop function if exists public.c22_pause_offer_creation();`);
  await sql(`set session_replication_role = replica;
    delete from public.job_offer_terms_responses where request_id in ${ours};
    delete from public.job_offer_terms where request_id in ${ours};
    delete from private.offer_terms_retries where request_id in ${ours};
    delete from private.offer_terms_blocks where request_id in ${ours};
    delete from public.job_operations where job_id in ${ours};
    delete from public.support_tickets where user_id = '${homeowner}';
    delete from public.job_events where job_id in ${ours};
    delete from public.notifications where related_request_id in ${ours} or related_contractor_id in ('${p1}', '${p2}');
    delete from public.job_match_attempts where service_request_id in ${ours};
    delete from public.service_requests where customer_id = '${homeowner}';
    delete from private.vendor_package_saves where actor in ('${p1User}', '${p2User}');
    delete from public.package_addons where package_id in (select id from public.vendor_packages where contractor_id in ('${p1}', '${p2}'));
    delete from public.package_tiers where package_id in (select id from public.vendor_packages where contractor_id in ('${p1}', '${p2}'));
    delete from public.vendor_packages where contractor_id in ('${p1}', '${p2}');
    delete from public.contractor_service_zips where contractor_id in ('${p1}', '${p2}');
    delete from public.contractors where id in ('${p1}', '${p2}');
    delete from private.r0_trial_admissions where homeowner_id = '${homeowner}';
    delete from private.r0_lee_zips where zip_code = '${zip}';
    delete from public.coverage_areas where zip_code = '${zip}';
    delete from public.services_catalog where id = '${service}';
    delete from public.user_roles where user_id::text like 'c9c81000-%';
    delete from public.profiles where user_id::text like 'c9c81000-%';
    delete from auth.users where id::text like 'c9c81000-%';
    update private.money_feature_gates set enabled = false, reason = 'DEC-2026-063: off until the owner activates offers at other terms after release' where name = 'offer_terms';
    delete from private.money_feature_gate_events where name = 'offer_terms' and reason like 'Synthetic concurrency%';
    delete from private.money_feature_gate_events where name = 'offer_terms' and id > (select min(id) from private.money_feature_gate_events where name = 'offer_terms')
      and reason = 'DEC-2026-063: off until the owner activates offers at other terms after release';
    set session_replication_role = origin;`);
}

async function setup() {
  await cleanup();
  await sql(`
    insert into auth.users(id, raw_user_meta_data) select ('c9c81000-0000-4000-8000-00000000000' || n)::uuid, '{"full_name":"Synthetic offer terms"}' from generate_series(1, 4) n;
    delete from public.user_roles where user_id::text like 'c9c81000-%' and user_id <> '${homeowner}';
    insert into public.user_roles(user_id, role) values ('${p1User}', 'vendor'), ('${p2User}', 'vendor'), ('${operator}', 'admin');
    insert into public.services_catalog(id, name, category_id, one_time_price, weekly_price, monthly_price, default_frequency, available_frequencies, is_active)
      select '${service}', 'Synthetic terms lawn', id, 60, 40, 120, 'weekly', '{one-time,weekly}', true from public.service_categories order by id limit 1;
    insert into public.coverage_areas(zip_code, city, is_active, has_waitlist) values ('${zip}', 'Synthetic', true, false);
    insert into private.r0_lee_zips values ('${zip}');
    insert into private.r0_trial_admissions(homeowner_id, zip_code, service_id, granted_by) values ('${homeowner}', '${zip}', '${service}', '${operator}');
    insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values
      ('${p1}', '${p1User}', 'Synthetic submitted provider', true, true), ('${p2}', '${p2User}', 'Synthetic other provider', true, true);
    insert into public.contractor_service_zips(contractor_id, zip_code) values ('${p1}', '${zip}'), ('${p2}', '${zip}');
    -- Both offerings include Mowing, so P2 meets the request's required work (20261118001000, finding 3).
    insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active, needs_review, included_scope) values
      ('${p1Pkg}', '${p1}', '${service}', 'Synthetic submitted lawn', 'fixed', 'one-time', false, false, '{Mowing}'),
      ('${p2Pkg}', '${p2}', '${service}', 'Synthetic other lawn', 'fixed', 'one-time', false, false, '{Mowing}');
    insert into public.package_tiers(id, package_id, name, price, frequency, sort_order, rule_conditions) values
      ('${p1Tier}', '${p1Pkg}', 'One time', 60, 'one-time', 0, '[]'), ('${p2Tier}', '${p2Pkg}', 'Standard', 70, 'one-time', 0, '[]');
    update public.vendor_packages set is_active = true where id in ('${p1Pkg}', '${p2Pkg}');`);
}
async function submit() {
  const payload = JSON.stringify({ location: { address: '1 Synthetic Way', city: 'Synthetic', state: 'FL', zip_code: zip },
    preferred_time: 'Synthetic window', selections: [{ service_id: service, frequency: 'one-time', package_id: p1Pkg, tier_id: p1Tier,
      expected: { pricing_mode: 'fixed', total: 60 } }] });
  const out = JSON.parse(await sql(as(homeowner, `select public.submit_service_requests('${randomUUID()}', '${payload}'::jsonb)::text`)));
  const request = out.requests?.[0]?.request_id;
  assert.ok(request, `request submitted (${JSON.stringify(out.requests?.[0] ?? out)})`);
  return request;
}
const p2Head = () => sql(`select id from public.vendor_packages where coalesce(lineage_id, id) = '${p2Pkg}' order by revision_number desc limit 1`);
async function prepareP2Save(price) {
  const head = await p2Head();
  const hash = await sql(`select private.package_revision_hash('${head}')`);
  const content = JSON.stringify({ service_id: service, package: { name: 'Synthetic other lawn', description: null, pricing_mode: 'fixed', default_frequency: 'one-time', included_scope: ['Mowing'] },
    questions: [], tiers: [{ name: 'Standard', price, frequency: 'one-time' }], addons: [] });
  return () => sql(as(p2User, `select public.vendor_save_package('${head}', '${hash}', '${content}'::jsonb, true, '${randomUUID()}')::text`));
}
const offer = (request) => sql(`select coalesce(private.offer_next_for_request_internal('${request}')::text, '')`);
const accept = (u, request) => sql(as(u, `select public.vendor_accept_job('${request}')`));
const termsOf = (request) => sql(`select t.id || '|' || t.consent_hash from public.job_offer_terms t join public.job_match_attempts a on a.id = t.offer_id
  where t.request_id = '${request}' order by a.attempt_number desc limit 1`);
async function respond(request, accepted, key = randomUUID()) {
  const [id, consent] = (await termsOf(request)).split('|');
  return sql(as(homeowner, `select public.homeowner_respond_offer_terms('${id}', '${key}', ${accepted}, '${JSON.stringify({ terms_id: id, consent_hash: consent })}'::jsonb)::text`));
}
const state = (request) => sql(`select concat_ws('/', status, matching_status, coalesce(contractor_id::text, '-'), round(total_amount, 2)) from public.service_requests where id = '${request}'`);
// Offer and accept a request unless it already waits for the homeowner.
async function pendingTerms(request) {
  if ((await state(request)).startsWith('matched/awaiting_terms/')) return request;
  await offer(request);
  await accept(p2User, request);
  assert.match(await state(request), /^matched\/awaiting_terms\//, 'the request waits for the homeowner');
  return request;
}
// TRACE-153 (7.2B, contract G2-01): DEC-2026-063 notices per request, by title and recipient.
const notices = (request, title, recipient = null) => sql(`select count(*) from public.notifications
  where related_request_id = '${request}' and title = '${title.replace(/'/g, "''")}'${recipient ? ` and user_id = '${recipient}'` : ''}`);
function noDeadlock(results, label) {
  for (const r of results) if (r.status === 'rejected') assert.doesNotMatch(r.reason.message, deadlock, `${label}: no deadlock`);
}
// The terms bound to the request's latest offer name a revision whose hash and price are the bound ones.
async function termsConsistent(request) {
  return sql(`select (t.terms#>>'{offering,revision}' = private.package_revision_hash(t.package_id)
      and a.effective_price * 100 = t.total_cents and r.total_amount * 100 = t.total_cents
      and (select price * 100 from public.package_tiers where id = t.package_tier_id) = t.level_cents)::text
    from public.job_offer_terms t join public.job_match_attempts a on a.id = t.offer_id join public.service_requests r on r.id = t.request_id
    where t.request_id = '${request}' order by a.attempt_number desc limit 1`);
}

try {
  await setup();
  const requests = [];
  for (let n = 0; n < 18; n += 1) requests.push(await submit());
  // P1 pauses its offering, so matching looks at P2's offering at other terms.
  await sql(as(p1User, `select public.vendor_set_package_active('${p1Pkg}', false, (select updated_at from public.vendor_packages where id = '${p1Pkg}'))::text`));
  await gate(true, 'Synthetic concurrency activation');
  const next = () => requests.shift();

  // C14. Offer creation racing P2's price save, three rounds: the bound terms are the revision read.
  for (let round = 1; round <= 3; round += 1) {
    const request = next();
    const save = await prepareP2Save(70 + round);
    const results = await Promise.allSettled([offer(request), save()]);
    noDeadlock(results, `C14 round ${round}`);
    assert.equal(results[1].status, 'fulfilled', `C14 round ${round}: the save succeeds (${results[1].reason?.message ?? ''})`);
    if (results[0].status === 'rejected') {
      // Pre-existing (finding F-O10-1): the save replaced the revision matching had selected, so offer
      // creation refuses it and nothing is written; matching again binds the new revision.
      assert.match(results[0].reason.message, /Selected contractor\/package is no longer eligible/, `C14 round ${round}: refused only as no longer eligible`);
      assert.equal(await sql(`select count(*) from public.job_offer_terms where request_id = '${request}'`), '0', `C14 round ${round}: nothing bound`);
      await offer(request);
    }
    assert.equal(await termsConsistent(request), 'true', `C14 round ${round}: the terms are exactly the revision read`);
    requests.push(request);
  }

  // C15. P2's acceptance racing its own price save: accepted at the bound total, awaiting the homeowner.
  for (let round = 1; round <= 3; round += 1) {
    const request = requests.pop();
    const before = await sql(`select round(total_amount, 2) from public.service_requests where id = '${request}'`);
    const save = await prepareP2Save(80 + round);
    const results = await Promise.allSettled([accept(p2User, request), save()]);
    noDeadlock(results, `C15 round ${round}`);
    assert.equal(results[0].status, 'fulfilled', `C15 round ${round}: acceptance succeeds (${results[0].reason?.message ?? ''})`);
    assert.equal(results[1].status, 'fulfilled', `C15 round ${round}: the save succeeds (${results[1].reason?.message ?? ''})`);
    assert.equal(await state(request), `matched/awaiting_terms/${p2}/${before}`, `C15 round ${round}: at the bound total, waiting for the homeowner`);
    assert.equal(await notices(request, "Review this provider's terms", homeowner), '1', `C15 round ${round}: one terms notice, to the homeowner`);
    assert.equal(await notices(request, "Review this provider's terms"), '1', `C15 round ${round}: and to no one else`);
    requests.unshift(request);
  }

  // C16. Six parallel homeowner acceptances with one key: one answer, the rest replays.
  {
    const request = await pendingTerms(next());
    const key = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => respond(request, true, key)));
    noDeadlock(results, 'C16');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 6, 'C16: every call returns the one answer');
    assert.equal(results.filter((r) => r.status === 'fulfilled' && JSON.parse(r.value).replayed === false).length, 1, 'C16: exactly one is not a replay');
    assert.equal(await sql(`select count(*) from public.job_offer_terms_responses where request_id = '${request}'`), '1', 'C16: one recorded answer');
    assert.match(await state(request), /^scheduled\/matched\//, 'C16: scheduled');
    assert.equal(await notices(request, 'Homeowner accepted your terms', p2User), '1', 'C16: one provider notice for six same-key calls');
    assert.equal(await notices(request, 'Homeowner accepted your terms'), '1', 'C16: and to no one else');
  }

  // C17. Accept racing decline with different keys, three rounds: exactly one wins; the state matches it.
  for (let round = 1; round <= 3; round += 1) {
    const request = await pendingTerms(next());
    const results = await Promise.allSettled([respond(request, true), respond(request, false)]);
    noDeadlock(results, `C17 round ${round}`);
    const ok = results.filter((r) => r.status === 'fulfilled');
    assert.equal(ok.length, 1, `C17 round ${round}: one answer wins (${results.map((r) => r.reason?.message ?? 'ok').join(' | ')})`);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.match(r.reason.message, /You already answered these terms|These terms changed since you opened them/, `C17 round ${round}: the other is refused`);
    const won = JSON.parse(ok[0].value).accepted;
    assert.match(await state(request), won ? /^scheduled\/matched\// : /^pending\/(exhausted|awaiting_match|offered)\//, `C17 round ${round}: the state follows the winning answer`);
    const [winner, loser] = won ? ['Homeowner accepted your terms', 'Homeowner declined your terms'] : ['Homeowner declined your terms', 'Homeowner accepted your terms'];
    assert.equal(await notices(request, winner, p2User), '1', `C17 round ${round}: one provider notice for the winning answer`);
    assert.equal(await notices(request, winner), '1', `C17 round ${round}: to the provider only`);
    assert.equal(await notices(request, loser), '0', `C17 round ${round}: none for the refused answer`);
  }

  // Make two more requests wait for the homeowner.
  const pending = [];
  for (let n = 0; n < 2; n += 1) pending.push(await pendingTerms(next()));

  // C18. Homeowner acceptance racing P2's suspension: accepted first, or refused by name with nothing written.
  {
    const request = pending.shift();
    const results = await Promise.allSettled([respond(request, true), sql(`update public.contractors set is_active = false where id = '${p2}'`)]);
    noDeadlock(results, 'C18');
    assert.equal(results[1].status, 'fulfilled', 'C18: the suspension is written');
    if (results[0].status === 'fulfilled') assert.match(await state(request), /^scheduled\/matched\//, 'C18: accepted first');
    else {
      assert.match(results[0].reason.message, /offer_terms:provider_inactive/, 'C18: or refused by name');
      assert.equal(await sql(`select count(*) from public.job_offer_terms_responses where request_id = '${request}'`), '0', 'C18: nothing written');
    }
    await sql(`update public.contractors set is_active = true where id = '${p2}'`);
  }

  // C19. Homeowner acceptance racing an operator force offer to P1: one ordering only.
  {
    await sql(as(p1User, `select public.vendor_set_package_active('${p1Pkg}', true, (select updated_at from public.vendor_packages where id = '${p1Pkg}'))::text`));
    const request = pending.shift();
    const results = await Promise.allSettled([respond(request, true),
      sql(as(operator, `select public.create_job_offer('${request}', '${p1}', null, null, true, 'Synthetic force offer')::text`))]);
    noDeadlock(results, 'C19');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, `C19: one wins (${results.map((r) => r.reason?.message ?? 'ok').join(' | ')})`);
    if (results[0].status === 'fulfilled') assert.match(await state(request), /^scheduled\/matched\//, 'C19: accepted first; the force offer finds it closed');
    else assert.match(results[0].reason.message, /These terms changed since you opened them/, 'C19: or the force offer first; the answer is stale');
    await sql(as(p1User, `select public.vendor_set_package_active('${p1Pkg}', false, (select updated_at from public.vendor_packages where id = '${p1Pkg}'))::text`));
  }

  // C20. P2's acceptance racing the gate switch-off, two rounds: accepted (awaiting the homeowner) before
  // the switch-off, or refused as paused after it; never an entry into awaiting_terms with the gate off.
  for (let round = 1; round <= 2; round += 1) {
    const request = next();
    await offer(request);
    const results = await Promise.allSettled([accept(p2User, request), gate(false, `Synthetic concurrency switch-off ${round}`)]);
    noDeadlock(results, `C20 round ${round}`);
    assert.equal(results[1].status, 'fulfilled', `C20 round ${round}: the switch-off is written`);
    if (results[0].status === 'fulfilled') assert.match(await state(request), /^matched\/awaiting_terms\//, `C20 round ${round}: accepted first`);
    else assert.match(results[0].reason.message, /offer_terms:inactive/, `C20 round ${round}: or refused as paused`);
    await gate(true, `Synthetic concurrency reactivation ${round}`);
  }

  // C21. Offer creation racing the switch-off: an offer with bound terms first, or no offer and the
  // request recorded for recovery.
  {
    const request = next();
    const results = await Promise.allSettled([offer(request), gate(false, 'Synthetic concurrency switch-off offer')]);
    noDeadlock(results, 'C21');
    assert.equal(results[0].status, 'fulfilled', `C21: matching completes (${results[0].reason?.message ?? ''})`);
    const terms = await sql(`select count(*) from public.job_offer_terms where request_id = '${request}'`);
    const blocks = await sql(`select count(*) from private.offer_terms_blocks where request_id = '${request}'`);
    assert.ok((terms === '1' && blocks === '0') || (terms === '0' && blocks === '1'), `C21: offered with terms, or recorded for recovery (terms ${terms}, blocks ${blocks})`);
  }
  // C22. Review of #154, finding 1: the homeowner declines P2's terms while P1 saves its offering. P1's
  // offering is live again, so matching after the decline selects it; the pause trigger holds the decline
  // inside offer creation (after matching's selection, before offer creation's own read) until the save has
  // committed, so offer creation then refuses the replaced revision (finding F-O10-1). The decline must
  // stand: P2 unassigned, its offer withdrawn and not actionable, the failure recorded for operations;
  // an operator retry then offers P1's live revision at the submitted terms (P-2).
  {
    await gate(true, 'Synthetic concurrency C22');
    const request = next();
    await pendingTerms(request);
    await sql(as(p1User, `select public.vendor_set_package_active('${p1Pkg}', true, (select updated_at from public.vendor_packages where id = '${p1Pkg}'))::text`));
    await sql(`create function public.c22_pause_offer_creation() returns trigger language plpgsql as $$
      declare stack text;
      begin
        if coalesce(current_setting('c22.armed', true), '') = 'on' then
          get diagnostics stack = pg_context;
          if stack like '%create_job_offer_internal%' then
            perform set_config('c22.armed', 'off', true);
            perform pg_advisory_xact_lock(922022);
          end if;
        end if;
        return null;
      end $$;
      create trigger c22_pause_offer_creation after update on public.job_match_attempts
        for each statement execute function public.c22_pause_offer_creation();`);
    const holder = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const holderDone = new Promise((resolve) => holder.on('close', resolve));
    holder.stdin.write('select pg_advisory_lock(922022);\n');
    const until = async (query, label) => {
      for (let i = 0; i < 200; i += 1) {
        if ((await sql(query)) === '1') return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`C22: timed out waiting for ${label}`);
    };
    await until(`select count(*) from pg_locks where locktype = 'advisory' and objid = 922022 and granted`, 'the holder');
    const [id, consent] = (await termsOf(request)).split('|');
    const decline = sql(`begin; set local c22.armed = 'on'; set local role authenticated;
      set local request.jwt.claims = '${JSON.stringify({ role: 'authenticated', sub: homeowner })}';
      select public.homeowner_respond_offer_terms('${id}', '${randomUUID()}', false, '${JSON.stringify({ terms_id: id, consent_hash: consent })}'::jsonb)::text; commit;`);
    const declined = decline.then(() => ({ ok: true }), (error) => ({ ok: false, error }));
    await until(`select count(*) from pg_locks where locktype = 'advisory' and objid = 922022 and not granted`, 'the decline to reach offer creation');
    const p1Head = await sql(`select id from public.vendor_packages where coalesce(lineage_id, id) = '${p1Pkg}' order by revision_number desc limit 1`);
    const p1Hash = await sql(`select private.package_revision_hash('${p1Head}')`);
    const p1Content = JSON.stringify({ service_id: service, package: { name: 'Synthetic submitted lawn', description: null, pricing_mode: 'fixed', default_frequency: 'one-time', included_scope: ['Mowing'] },
      questions: [], tiers: [{ name: 'One time', price: 61, frequency: 'one-time' }], addons: [] });
    await sql(as(p1User, `select public.vendor_save_package('${p1Head}', '${p1Hash}', '${p1Content}'::jsonb, true, '${randomUUID()}')::text`));
    holder.stdin.end('select pg_advisory_unlock(922022);\n');
    await holderDone;
    const outcome = await declined;
    await sql(`drop trigger c22_pause_offer_creation on public.job_match_attempts; drop function public.c22_pause_offer_creation();`);
    assert.ok(outcome.ok, `C22: the decline succeeds although matching after it fails (${outcome.error?.message ?? ''})`);
    assert.equal(await sql(`select message from private.offer_terms_rematch_failures where request_id = '${request}'`),
      'Selected contractor/package is no longer eligible for this request', 'C22: the save landed between selection and offer creation; the failure is recorded');
    assert.equal(await sql(`select accepted::text from public.job_offer_terms_responses where request_id = '${request}'`), 'false', 'C22: the decline is recorded');
    assert.equal(await notices(request, 'Homeowner declined your terms', p2User), '1', 'C22: one decline notice to the provider');
    const admins = await sql(`select count(*) from public.user_roles where role = 'admin'`);
    assert.equal(await notices(request, 'Matching after a decline needs attention'), admins, 'C22: one N-QTE-11 notice per admin');
    assert.equal(await sql(`select count(*) from public.notifications n where related_request_id = '${request}' and title = 'Matching after a decline needs attention'
      and not exists (select 1 from public.user_roles r where r.user_id = n.user_id and r.role = 'admin')`), '0', 'C22: none to a non-admin');
    assert.match(await state(request), /^pending\/awaiting_match\/-\//, 'C22: P2 stays unassigned; the request waits for operations');
    assert.equal(await sql(`select outcome from public.job_match_attempts where service_request_id = '${request}' and contractor_id = '${p2}'`), 'withdrawn', 'C22: the declined offer stays withdrawn');
    await assert.rejects(accept(p2User, request), /No open offer is available to accept/, 'C22: the declined offer is not actionable');
    await assert.rejects(respond(request, true), /You already answered these terms/, 'C22: the declined terms cannot be accepted afterwards');
    assert.match(await sql(as(operator, `select public.admin_offer_terms_queue()::text`)), new RegExp(`"rematch_failed"[^}]*"${request}"|"${request}"[^}]*"rematch_failed"`), 'C22: operations sees it');
    await sql(as(operator, `select public.admin_retry_offer_terms_matching('${request}', '${randomUUID()}', 'Synthetic C22 retry')::text`));
    assert.match(await state(request), new RegExp(`^matched/offered/${p1}/60\\.00$`), 'C22: the retry offers P1\'s live revision at the submitted $60, never P2');
  }
  console.log('PASS: terms bound at offer creation are the revision read; acceptance after a racing save stays at the bound price; one key gives one answer; accept and decline, suspension and force offer each resolve to one orderly outcome; switching the gate off serializes with offer creation and with entering awaiting_terms; a decline survives a re-match that a racing save makes fail; no race deadlocks; each answer writes exactly one provider notice and each provider acceptance one homeowner notice (TRACE-153).');
} finally {
  await cleanup();
}
