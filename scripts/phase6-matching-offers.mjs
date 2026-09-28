// Synthetic-only proof for TRACE-099 through the real REST/RPC APIs with concurrent sessions:
// exclusive offers, the four-hour boundary, consent, sequencing and exhaustion, and the
// offer/assignment write boundary. Fixtures use the synthetic 00032 ZIP and are removed afterward.
// Set PHASE6_DB_CONTAINER and PHASE6_SUPABASE_WORKDIR to target a stack other than the
// isolated Phase 5 one.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";

const container = process.env.PHASE6_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
const workdir = process.env.PHASE6_SUPABASE_WORKDIR ?? ".phase5-local";
function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))));
    child.stdin.end(input);
  });
}
const sql = (source) => run("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], source);

// Local stack keys, read from the CLI and never printed.
const stack = Object.fromEntries(
  (await run("npx", ["supabase", "status", "--workdir", workdir, "-o", "env"]))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
for (const name of ["API_URL", "ANON_KEY", "JWT_SECRET"]) assert.ok(stack[name], `Local stack ${name} is available`);
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function sessionToken(sub) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 900 });
  return `${header}.${payload}.${createHmac("sha256", stack.JWT_SECRET).update(`${header}.${payload}`).digest("base64url")}`;
}
const headers = (user, extra = {}) => ({
  ...(user ? { Authorization: `Bearer ${sessionToken(user)}` } : {}),
  apikey: stack.ANON_KEY,
  "Content-Type": "application/json",
  ...extra,
});
async function rest(user, method, path, body, extra) {
  const response = await fetch(`${stack.API_URL}/rest/v1/${path}`, { method, headers: headers(user, extra), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const rpc = (user, name, args) => rest(user, "POST", `rpc/${name}`, args);
const accept = (user, request) => rpc(user, "vendor_accept_job", { _job_id: request });
const decline = (user, request) => rpc(user, "vendor_decline_job", { _job_id: request, _reason: "Synthetic decline" });
const consent = (user, request) => rpc(user, "consent_to_provider_fallback", { _request_id: request });
const expire = (user) => rpc(user, "expire_stale_matches", {});
const startMatching = (user, request) => rpc(user, "start_request_matching", { _request_id: request });
const ok = (response) => response.status >= 200 && response.status < 300;

const ids = {
  owner: "e1000000-0000-4000-8000-000000000001",
  other: "e1000000-0000-4000-8000-000000000002",
  vendorA: "e1000000-0000-4000-8000-000000000003",
  vendorB: "e1000000-0000-4000-8000-000000000004",
  vendorC: "e1000000-0000-4000-8000-000000000005",
  providerA: "e2000000-0000-4000-8000-000000000001",
  providerB: "e2000000-0000-4000-8000-000000000002",
  providerC: "e2000000-0000-4000-8000-000000000003",
};
const vendorFor = { [ids.providerA]: ids.vendorA, [ids.providerB]: ids.vendorB, [ids.providerC]: ids.vendorC };
const request = (n) => `e3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scalar = async (query) => sql(query);
const count = async (query) => Number(await sql(query));
const pendingProvider = (n) => scalar(`select coalesce(string_agg(contractor_id::text, ','), '') from public.job_match_attempts where service_request_id='${request(n)}' and outcome='pending'`);
// Balanced-v1 ranking depends on live provider data, so expectations come from the ranking itself.
const nextRanked = (n, excluded = []) => scalar(`select contractor_id from private.find_eligible_packages_core('${request(n)}')
  ${excluded.length ? `where contractor_id not in (${excluded.map((id) => `'${id}'`).join(",")})` : ""} order by preferred desc, rank_order limit 1`);
const requestState = (n) => scalar(`select status||'|'||coalesce(matching_status,'')||'|'||coalesce(contractor_id::text,'') from public.service_requests where id='${request(n)}'`);

async function cleanup() {
  await sql(`
    delete from public.notifications where related_request_id::text like 'e3000000-%';
    delete from public.matching_fallback_consents where request_id::text like 'e3000000-%';
    delete from public.job_match_attempts where service_request_id::text like 'e3000000-%';
    delete from public.job_events where job_id::text like 'e3000000-%';
    delete from public.service_requests where id::text like 'e3000000-%';
    delete from public.vendor_packages where contractor_id::text like 'e2000000-%';
    delete from public.contractor_service_zips where contractor_id::text like 'e2000000-%';
    delete from public.contractors where id::text like 'e2000000-%';
    delete from public.coverage_areas where zip_code='00032';
    delete from public.notifications where user_id::text like 'e1000000-%';
    delete from public.user_roles where user_id::text like 'e1000000-%';
    delete from auth.users where id::text like 'e1000000-%';`);
}

async function newRequest(n, preferred = null) {
  await sql(`insert into public.service_requests(id,customer_id,service_type,address,city,state,service_catalog_id,frequency,zip_code,preferred_contractor_id)
    values ('${request(n)}','${ids.owner}','Synthetic service','1 Synthetic Way','Synthetic','FL',
      (select id from public.services_catalog order by id limit 1),'one-time','00032',${preferred ? `'${preferred}'` : "null"});`);
  const started = await startMatching(ids.owner, request(n));
  assert.ok(ok(started), JSON.stringify(started.body));
}

await cleanup();
await sql(`
  insert into auth.users(id,raw_user_meta_data) values
   ('${ids.owner}','{"full_name":"Synthetic homeowner A"}'),('${ids.other}','{"full_name":"Synthetic homeowner B"}'),
   ('${ids.vendorA}','{"full_name":"Synthetic vendor A"}'),('${ids.vendorB}','{"full_name":"Synthetic vendor B"}'),
   ('${ids.vendorC}','{"full_name":"Synthetic vendor C"}');
  insert into public.user_roles(user_id,role) values ('${ids.vendorA}','vendor'),('${ids.vendorB}','vendor'),('${ids.vendorC}','vendor') on conflict do nothing;
  insert into public.coverage_areas(zip_code,city,is_active) values ('00032','Synthetic covered',true);
  insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
   ('${ids.providerA}','${ids.vendorA}','Synthetic provider A',true,true),
   ('${ids.providerB}','${ids.vendorB}','Synthetic provider B',true,true),
   ('${ids.providerC}','${ids.vendorC}','Synthetic provider C',true,true);
  insert into public.contractor_service_zips(contractor_id,zip_code)
   select id,'00032' from public.contractors where id::text like 'e2000000-%';
  insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
   select ('e4000000-0000-4000-8000-'||right(id::text,12))::uuid,id,(select id from public.services_catalog order by id limit 1),
    'Synthetic quote offering','custom_quote','one-time',true,false from public.contractors where id::text like 'e2000000-%';`);

const results = [];
const check = async (label, fn) => {
  await fn();
  results.push(label);
  console.log(`ok ${results.length} - ${label}`);
};

try {
  await check("an unselected request goes to the first ranked provider with one four-hour offer", async () => {
    await newRequest(1);
    assert.equal(await pendingProvider(1), await nextRanked(1));
    assert.equal(await pendingProvider(1), ids.providerA, "equal fresh scores break ties by stable provider ID");
    assert.equal(await scalar(`select extract(epoch from expires_at-offered_at)::int from public.job_match_attempts where service_request_id='${request(1)}' and outcome='pending'`), "14400");
  });

  await check("six concurrent acceptances by the offered vendor schedule the request once", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => accept(ids.vendorA, request(1))));
    assert.equal(responses.filter(ok).length, 1, JSON.stringify(responses.map((r) => r.status)));
    for (const failed of responses.filter((r) => !ok(r))) assert.equal(failed.body.message, "No open offer is available to accept");
    assert.equal(await requestState(1), `scheduled|matched|${ids.providerA}`);
    assert.equal(await count(`select count(*) from public.job_match_attempts where service_request_id='${request(1)}' and outcome='accepted'`), 1);
    assert.equal(await count(`select count(*) from public.job_events where job_id='${request(1)}' and metadata->>'reason'='vendor_accepted'`), 1);
    assert.equal(await count(`select count(*) from public.notifications where related_request_id='${request(1)}' and user_id='${ids.owner}'`), 1);
    assert.equal(await scalar(`select coalesce(scheduled_start_at::text,'none') from public.service_requests where id='${request(1)}'`), "none");
  });

  await check("a lost acceptance response is recovered by reading the request back", async () => {
    const retry = await accept(ids.vendorA, request(1));
    assert.equal(retry.status, 400);
    const read = await rest(ids.vendorA, "GET", `service_requests?id=eq.${request(1)}&select=status,matching_status,contractor_id`);
    assert.deepEqual(read.body, [{ status: "scheduled", matching_status: "matched", contractor_id: ids.providerA }]);
  });

  await check("a racing accept and decline by the same vendor resolve to exactly one outcome", async () => {
    await newRequest(2);
    assert.equal(await pendingProvider(2), ids.providerA);
    const fallback = await nextRanked(2, [ids.providerA]);
    const [accepted, declined] = await Promise.all([accept(ids.vendorA, request(2)), decline(ids.vendorA, request(2))]);
    assert.equal([accepted, declined].filter(ok).length, 1, `${accepted.status}/${declined.status}`);
    const state = await requestState(2);
    if (ok(accepted)) {
      assert.equal(state, `scheduled|matched|${ids.providerA}`);
      assert.equal(await pendingProvider(2), "");
    } else {
      assert.equal(state, `matched|offered|${fallback}`);
      assert.equal(await pendingProvider(2), fallback);
    }
    assert.equal(await count(`select count(*) from public.job_match_attempts where service_request_id='${request(2)}' and contractor_id='${ids.providerA}'`), 1);
  });

  await check("acceptance racing expiry and restarts after the deadline never schedules and advances once", async () => {
    await newRequest(3);
    const first = await pendingProvider(3);
    const fallback = await nextRanked(3, [first]);
    await sql(`update public.job_match_attempts set expires_at=now()-interval '1 second' where service_request_id='${request(3)}' and outcome='pending';`);
    const responses = await Promise.all([
      accept(vendorFor[first], request(3)), accept(vendorFor[first], request(3)), accept(vendorFor[first], request(3)),
      expire(ids.owner), expire(ids.owner), expire(vendorFor[first]),
      startMatching(ids.owner, request(3)), startMatching(ids.owner, request(3)),
    ]);
    for (const response of responses.slice(0, 3)) {
      assert.ok(!ok(response), "an expired offer is never accepted");
      assert.match(response.body.message, /Offer has expired|No open offer is available to accept/);
    }
    assert.equal(await requestState(3), `matched|offered|${fallback}`);
    assert.equal(await count(`select count(*) from public.job_match_attempts where service_request_id='${request(3)}' and outcome='pending'`), 1);
    assert.equal(await count(`select count(*) from public.job_match_attempts where service_request_id='${request(3)}' and contractor_id='${first}' and outcome='expired'`), 1);
    assert.equal(await count(`select count(*) from public.job_events where job_id='${request(3)}' and event_type='match_offered'`), 2);
  });

  await check("acceptance just before the deadline succeeds", async () => {
    const offered = await pendingProvider(3);
    const vendor = vendorFor[offered];
    await sql(`update public.job_match_attempts set expires_at=now()+interval '3 seconds' where service_request_id='${request(3)}' and outcome='pending';`);
    const response = await accept(vendor, request(3));
    assert.ok(ok(response), JSON.stringify(response.body));
    assert.equal(await requestState(3), `scheduled|matched|${offered}`);
  });

  await check("a selected provider's decline waits for consent; six concurrent consents make one offer", async () => {
    await newRequest(4, ids.providerC);
    assert.equal(await pendingProvider(4), ids.providerC);
    assert.ok(ok(await decline(ids.vendorC, request(4))));
    assert.equal(await requestState(4), "pending|awaiting_consent|");
    assert.equal(await pendingProvider(4), "");
    const fallback = await nextRanked(4, [ids.providerC]);
    const responses = await Promise.all(Array.from({ length: 6 }, () => consent(ids.owner, request(4))));
    assert.ok(responses.every(ok), JSON.stringify(responses.map((r) => r.body)));
    assert.equal(await pendingProvider(4), fallback);
    assert.equal(await count(`select count(*) from public.matching_fallback_consents where request_id='${request(4)}'`), 1);
    assert.equal(await count(`select count(*) from public.job_events where job_id='${request(4)}' and metadata->>'action'='provider_fallback_consented'`), 1);
    assert.equal(await count(`select count(*) from public.job_events where job_id='${request(4)}' and event_type='match_offered'`), 2);
  });

  await check("other roles cannot consent, accept or decline through the API", async () => {
    await newRequest(5, ids.providerA);
    const [anonAccept, otherConsent, vendorConsent, ownerAccept, vendorBAccept, vendorBDecline] = await Promise.all([
      accept(null, request(5)), consent(ids.other, request(5)), consent(ids.vendorB, request(5)),
      accept(ids.owner, request(5)), accept(ids.vendorB, request(5)), decline(ids.vendorB, request(5)),
    ]);
    assert.equal(anonAccept.status, 401);
    assert.equal(otherConsent.status, 403);
    assert.equal(vendorConsent.status, 403);
    for (const response of [ownerAccept, vendorBAccept]) assert.equal(response.body.message, "No open offer is available to accept");
    assert.equal(vendorBDecline.body.message, "No open offer is available to decline");
    assert.equal(await pendingProvider(5), ids.providerA);
    assert.equal(await count(`select count(*) from public.matching_fallback_consents where request_id='${request(5)}'`), 0);
  });

  await check("an offered vendor cannot rewrite the request; another vendor cannot see it", async () => {
    const patch = await rest(ids.vendorA, "PATCH", `service_requests?id=eq.${request(5)}`, { address: "Vendor rewrite", zip_code: "00033" }, { Prefer: "return=representation" });
    assert.equal(patch.status, 403, JSON.stringify(patch.body));
    assert.equal(patch.body.message, "Accept the offer before changing this request");
    const hidden = await rest(ids.vendorB, "PATCH", `service_requests?id=eq.${request(5)}`, { address: "Vendor rewrite" }, { Prefer: "return=representation" });
    assert.deepEqual(hidden.body, []);
    assert.deepEqual((await rest(ids.vendorB, "GET", `service_requests?id=eq.${request(5)}&select=id`)).body, []);
    assert.equal(await scalar(`select address||'|'||zip_code from public.service_requests where id='${request(5)}'`), "1 Synthetic Way|00032");
  });

  await check("a decline racing four restarts sequences exactly one next offer", async () => {
    await newRequest(6);
    const first = await pendingProvider(6);
    const fallback = await nextRanked(6, [first]);
    const responses = await Promise.all([decline(vendorFor[first], request(6)), ...Array.from({ length: 4 }, () => startMatching(ids.owner, request(6)))]);
    assert.ok(ok(responses[0]), JSON.stringify(responses[0].body));
    assert.equal(await pendingProvider(6), fallback);
    assert.equal(await count(`select count(*) from public.job_match_attempts where service_request_id='${request(6)}'`), 2);
  });

  await check("every provider declining exhausts the request; concurrent restarts create nothing", async () => {
    assert.ok(ok(await decline(vendorFor[await pendingProvider(6)], request(6))));
    assert.ok(ok(await decline(vendorFor[await pendingProvider(6)], request(6))));
    assert.equal(await requestState(6), "pending|exhausted|");
    const restarts = await Promise.all(Array.from({ length: 4 }, () => startMatching(ids.owner, request(6))));
    assert.ok(restarts.every((r) => ok(r) && r.body === null), JSON.stringify(restarts.map((r) => r.body)));
    assert.equal(await pendingProvider(6), "");
    assert.equal(await count(`select count(*) from public.job_events where job_id='${request(6)}' and event_type='match_offered'`), 3);
    assert.equal(await scalar(`select needs_admin_review from public.service_requests where id='${request(6)}'`), "t");
  });

  console.log(`\n${results.length}/${results.length} TRACE-099 matching checks passed`);
} finally {
  await cleanup();
  const left = await count(`select (select count(*) from public.service_requests where id::text like 'e3000000-%')
    + (select count(*) from public.contractors where id::text like 'e2000000-%') + (select count(*) from auth.users where id::text like 'e1000000-%')`);
  console.log(left === 0 ? "fixtures cleaned" : `fixture rows remain: ${left}`);
}
