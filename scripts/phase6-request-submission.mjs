// Synthetic-only proof for TRACE-095 through the real REST/RPC and Storage APIs with concurrent
// sessions. Fixtures use synthetic 000xx ZIPs and are removed afterward.
// Set PHASE6_DB_CONTAINER and PHASE6_SUPABASE_WORKDIR to target a stack other than the
// isolated Phase 5 one.
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
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
  return { status: response.status, body: text ? JSON.parse(text) : null, range: response.headers.get("content-range") };
}
const submit = (user, key, payload) => rest(user, "POST", "rpc/submit_service_requests", { p_submission_key: key, p_payload: payload });

const ids = {
  owner: "d1000000-0000-4000-8000-000000000001",
  other: "d1000000-0000-4000-8000-000000000002",
  vendorUser: "d1000000-0000-4000-8000-000000000003",
  admin: "d1000000-0000-4000-8000-000000000004",
  fixed: "d2000000-0000-4000-8000-000000000001",
  quote: "d2000000-0000-4000-8000-000000000002",
};
const plan = (zip, selections) => ({
  location: { address: "1 Synthetic Way", city: "Synthetic", state: "FL", zip_code: zip },
  preferred_time: "Preferred window: synthetic",
  selections,
});
const lawn = { service_id: "lawn-mowing", frequency: "one-time", expected: { pricing_mode: "fixed", total: 100 } };
const cleaning = { service_id: "house-cleaning", frequency: "monthly", expected: { pricing_mode: "quote" } };
const requestCount = async (user) => Number(await sql(`select count(*) from public.service_requests where customer_id='${user}'`));

async function cleanup() {
  await sql(`
    delete from public.job_photos where service_request_id in (select id from public.service_requests where customer_id::text like 'd1000000-%');
    delete from public.job_match_attempts where service_request_id in (select id from public.service_requests where customer_id::text like 'd1000000-%');
    delete from public.job_events where job_id in (select id from public.service_requests where customer_id::text like 'd1000000-%');
    delete from public.service_request_submissions where customer_id::text like 'd1000000-%';
    delete from public.service_requests where customer_id::text like 'd1000000-%';
    select set_config('storage.allow_delete_query','true',false);
    delete from storage.objects where bucket_id='job-photos' and name like 'd1000000-%';
    delete from public.vendor_packages where contractor_id::text like 'd2000000-%';
    delete from public.contractor_service_zips where contractor_id::text like 'd2000000-%';
    delete from public.contractors where id::text like 'd2000000-%';
    delete from public.coverage_areas where zip_code in ('00030','00031');
    delete from public.user_roles where user_id::text like 'd1000000-%';
    delete from auth.users where id::text like 'd1000000-%';`);
}

await cleanup();
await sql(`
  insert into auth.users(id,raw_user_meta_data) values
   ('${ids.owner}','{"full_name":"Synthetic homeowner A"}'),('${ids.other}','{"full_name":"Synthetic homeowner B"}'),
   ('${ids.vendorUser}','{"full_name":"Synthetic provider"}'),('${ids.admin}','{"full_name":"Synthetic operator"}');
  insert into public.user_roles(user_id,role) values ('${ids.vendorUser}','vendor'),('${ids.admin}','admin');
  insert into public.coverage_areas(zip_code,city,is_active) values ('00030','Synthetic covered',true);
  insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
   ('${ids.fixed}','${ids.vendorUser}','Synthetic fixed provider',true,true),('${ids.quote}',null,'Synthetic quote provider',true,true);
  insert into public.contractor_service_zips(contractor_id,zip_code) values ('${ids.fixed}','00030'),('${ids.quote}','00030');
  insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
   ('d4000000-0000-4000-8000-000000000001','${ids.fixed}','lawn-mowing','Synthetic fixed','fixed','one-time',true,false),
   ('d4000000-0000-4000-8000-000000000002','${ids.quote}','house-cleaning','Synthetic quote','custom_quote','monthly',true,false);
  insert into public.package_tiers(package_id,frequency,price,name) values ('d4000000-0000-4000-8000-000000000001','one-time',100,'Synthetic basic');`);

const results = [];
const check = async (label, fn) => {
  await fn();
  results.push(label);
  console.log(`ok ${results.length} - ${label}`);
};

try {
  await check("anonymous RPC is refused", async () => {
    const response = await submit(null, randomUUID(), plan("00030", [lawn]));
    assert.ok([401, 403].includes(response.status), `status ${response.status}`);
  });
  for (const [label, user] of [["homeowner", ids.owner], ["vendor", ids.vendorUser], ["admin", ids.admin]]) {
    await check(`${label} direct REST insert with forged fields is refused`, async () => {
      const response = await rest(user, "POST", "service_requests", { customer_id: user, service_type: "Forged", address: "x", status: "completed", total_amount: 1, zip_code: "00031" });
      assert.equal(response.status, 403, JSON.stringify(response.body));
      assert.equal(response.body.code, "42501");
    });
  }
  await check("uncovered ZIP creates nothing", async () => {
    const response = await submit(ids.owner, randomUUID(), plan("00031", [lawn]));
    assert.equal(response.status, 200);
    assert.deepEqual([response.body.status, response.body.coverage], ["refused", "uncovered"]);
    assert.equal(await requestCount(ids.owner), 0);
  });
  await check("tampered total is refused with the server price", async () => {
    const response = await submit(ids.owner, randomUUID(), plan("00030", [{ ...lawn, expected: { pricing_mode: "fixed", total: 1 } }]));
    assert.deepEqual([response.body.status, response.body.outcomes[0].outcome, response.body.outcomes[0].total], ["refused", "price_changed", 100]);
    assert.equal(await requestCount(ids.owner), 0);
  });

  const key = randomUUID();
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => submit(ids.owner, key, plan("00030", [lawn]))));
  await check("eight concurrent same-key submissions all succeed", async () => {
    assert.ok(concurrent.every((response) => response.status === 200 && response.body.status === "submitted"), JSON.stringify(concurrent.map((r) => r.body)));
  });
  const requestId = concurrent[0].body.requests[0].request_id;
  await check("they return one request and create exactly one row", async () => {
    assert.equal(new Set(concurrent.map((response) => response.body.requests[0].request_id)).size, 1);
    assert.equal(concurrent.filter((response) => response.body.reused === false).length, 1);
    assert.equal(await requestCount(ids.owner), 1);
  });
  await check("the stored request has server-derived owner, price and tier", async () => {
    const row = await sql(`select customer_id||'|'||pricing_mode||'|'||total_amount::text||'|'||quote_only||'|'||(package_tier_id is not null)||'|'||status from public.service_requests where id='${requestId}'`);
    assert.equal(row, `${ids.owner}|fixed|100.00|false|true|pending`);
  });
  await check("changed payload on the same key is refused", async () => {
    const response = await submit(ids.owner, key, plan("00030", [cleaning]));
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "22023");
    assert.match(response.body.message, /Submission key reused/);
    assert.equal(await requestCount(ids.owner), 1);
  });

  const raceKey = randomUUID();
  const race = await Promise.all(Array.from({ length: 8 }, (_, index) => submit(ids.other, raceKey, plan("00030", [index % 2 ? lawn : cleaning]))));
  await check("racing different payloads on one key create exactly one request", async () => {
    const accepted = race.filter((response) => response.status === 200);
    const refused = race.filter((response) => response.status === 400 && /Submission key reused/.test(response.body.message));
    assert.equal(accepted.length + refused.length, 8, JSON.stringify(race.map((r) => [r.status, r.body])));
    assert.equal(new Set(accepted.map((response) => response.body.requests[0].request_id)).size, 1);
    assert.equal(await requestCount(ids.other), 1);
  });

  await check("a multi-service plan creates one distinct request per selection", async () => {
    const response = await submit(ids.other, randomUUID(), plan("00030", [lawn, cleaning]));
    assert.equal(response.body.requests.length, 2);
    assert.notEqual(response.body.requests[0].request_id, response.body.requests[1].request_id);
    assert.equal(await requestCount(ids.other), 3);
  });
  await check("a mixed plan with an unavailable service creates nothing", async () => {
    const response = await submit(ids.other, randomUUID(), plan("00030", [lawn, { service_id: "tree-trimming", frequency: "one-time", expected: { pricing_mode: "quote" } }]));
    assert.deepEqual(response.body.outcomes.map((outcome) => outcome.outcome), ["eligible_fixed", "unavailable"]);
    assert.equal(await requestCount(ids.other), 3);
  });
  await check("homeowner B cannot read homeowner A's request", async () => {
    const response = await rest(ids.other, "GET", `service_requests?id=eq.${requestId}&select=id`);
    assert.deepEqual(response.body, []);
  });
  await check("homeowner cannot move a pending request to another ZIP", async () => {
    const response = await rest(ids.owner, "PATCH", `service_requests?id=eq.${requestId}`, { zip_code: "00031" });
    assert.equal(response.status, 403, JSON.stringify(response.body));
  });

  // Recovery after save: the photo step failed, so the browser submits the same key again.
  await check("replay after a failed photo step returns the saved request", async () => {
    const response = await submit(ids.owner, key, plan("00030", [lawn]));
    assert.deepEqual([response.body.reused, response.body.requests[0].request_id], [true, requestId]);
    assert.equal(await requestCount(ids.owner), 1);
  });
  const photoPath = `${ids.owner}/${requestId}/intake-${randomUUID()}.png`;
  await check("the homeowner can then attach intake photos to it", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082", "hex");
    const upload = await fetch(`${stack.API_URL}/storage/v1/object/job-photos/${photoPath}`, { method: "POST", headers: { ...headers(ids.owner), "Content-Type": "image/png", "x-upsert": "false" }, body: png });
    assert.equal(upload.status, 200, await upload.text());
    const row = await rest(ids.owner, "POST", "job_photos", { service_request_id: requestId, uploaded_by: ids.owner, uploader_role: "homeowner", photo_url: photoPath, photo_type: "evidence", caption: "Homeowner request intake photo" });
    assert.equal(row.status, 201, JSON.stringify(row.body));
  });
  await check("a later replay sees the attached photo and does not reattach", async () => {
    const response = await rest(ids.owner, "HEAD", `job_photos?service_request_id=eq.${requestId}&uploaded_by=eq.${ids.owner}&select=id`, undefined, { Prefer: "count=exact" });
    assert.equal(response.range?.split("/")[1], "1");
  });
  await check("the synthetic photo is removed through the Storage API", async () => {
    const removed = await fetch(`${stack.API_URL}/storage/v1/object/job-photos`, { method: "DELETE", headers: headers(ids.owner), body: JSON.stringify({ prefixes: [photoPath] }) });
    assert.equal(removed.status, 200, await removed.text());
  });
  await check("homeowner B cannot attach photos to homeowner A's request", async () => {
    const row = await rest(ids.other, "POST", "job_photos", { service_request_id: requestId, uploaded_by: ids.other, uploader_role: "homeowner", photo_url: "x", photo_type: "evidence" });
    assert.equal(row.status, 403);
  });
  await check("matching starts for a submitted quote request", async () => {
    const quote = await submit(ids.owner, randomUUID(), plan("00030", [cleaning]));
    const offer = await rest(ids.owner, "POST", "rpc/start_request_matching", { _request_id: quote.body.requests[0].request_id });
    assert.equal(offer.status, 200);
    assert.equal(await sql(`select contractor_id from public.job_match_attempts where id='${offer.body}'`), ids.quote);
  });
  console.log(`1..${results.length}`);
} finally {
  await cleanup();
}
