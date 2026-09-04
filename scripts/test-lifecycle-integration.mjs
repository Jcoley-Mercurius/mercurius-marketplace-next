import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Local-only allowlist. Never accept a URL/project/container from caller input.
const container = "supabase_db_vugqqyemuptlvcieihww";
const cli = process.env.SUPABASE_CLI || "node_modules/.bin/supabase";
const local = JSON.parse(execFileSync(cli, ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
assert.equal(local.API_URL, "http://127.0.0.1:55421", "requires isolated local Mercurius API");
const secret = "synthetic-phase4-worker-only";
function sql(text) {
  try {
    return execFileSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-Atq", "-v", "ON_ERROR_STOP=1"],
      { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch { throw new Error("Isolated database test command failed (details suppressed to protect local credentials)"); }
}
const job = "63000000-0000-4000-8000-000000000001";
const owner = "61000000-0000-4000-8000-000000000001";
const admin = "61000000-0000-4000-8000-000000000002";
assert.equal(sql(`select count(*) from auth.users where id in ('${owner}','${admin}');`), "0", "fixture IDs must be unused");
const runIds = [];
async function call(headers) {
  const response = await fetch(`${local.API_URL}/functions/v1/job-lifecycle-worker`, {
    method: "POST", headers, body: "{}", redirect: "error", signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  if (body.run_id) runIds.push(body.run_id);
  return { status: response.status, body };
}
try {
  let ready = false;
  for (let attempt=0; attempt<30; attempt++) {
    try {
      const response = await fetch(`${local.API_URL}/functions/v1/job-lifecycle-worker`, {
        method: "OPTIONS", signal: AbortSignal.timeout(2000), redirect: "error",
      });
      await response.body?.cancel();
      if (response.ok) { ready=true; break; }
    } catch { /* Local runtime still starting; no lifecycle command was sent. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(ready,true,"local Edge runtime must be ready");
  sql(`insert into auth.users(id,raw_user_meta_data) values ('${owner}','{"full_name":"Synthetic integration owner"}'),('${admin}','{"full_name":"Synthetic integration admin"}');
    insert into public.user_roles(user_id,role) values ('${admin}','admin');
    insert into public.service_requests(id,customer_id,service_type,address,status,confirmation_sent_at,vendor_completed_at)
    values ('${job}','${owner}','Synthetic integration service','Synthetic fixture','vendor_completed',now()-interval '73 hours',now()-interval '4 days');`);
  assert.equal((await call({ "x-worker-secret": secret })).status, 401, "worker secret cannot bypass gateway JWT");
  assert.equal((await call({ Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, "x-worker-secret": "incorrect" })).status, 401, "valid gateway JWT cannot bypass worker secret");
  const headers = { Authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, "x-worker-secret": secret };
  const results = await Promise.all([call(headers), call(headers)]);
  for (const result of results) assert.equal(result.status, 200, "authenticated gateway-to-worker-to-database path");
  assert.equal(results.reduce((sum, result) => sum + result.body.admin_flagged, 0), 1, "simultaneous worker runs apply exactly one escalation");
  assert.equal(sql(`select count(*) from public.job_events where job_id='${job}' and metadata->>'reason'='homeowner_confirmation_unanswered';`), "1");
  assert.equal(sql(`select count(*) from public.notifications where related_request_id='${job}';`), "2");
  assert.equal(sql(`select status::text || ':' || (homeowner_confirmed_at is null)::text || ':' || payment_status::text from public.service_requests where id='${job}';`), "vendor_completed:true:pending");
  assert.equal((await call(headers)).body.admin_flagged, 0, "HTTP retry does not duplicate escalation");

  // Exercise the selected scheduler's HTTP transport manually, with zero Cron jobs.
  sql("create extension if not exists pg_net with schema extensions; create extension if not exists pg_cron; select count(*) from cron.job;");
  assert.equal(sql("select count(*) from cron.job;"), "0", "no Cron jobs may be active or installed in this test");
  const quote = text => "'" + text.replaceAll("'", "''") + "'";
  const requestId = sql(`select net.http_post(url:='http://supabase_kong_vugqqyemuptlvcieihww:8000/functions/v1/job-lifecycle-worker',
    headers:=jsonb_build_object('Authorization',${quote(`Bearer ${local.SERVICE_ROLE_KEY}`)},'x-worker-secret',${quote(secret)},'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=10000);`);
  assert.match(requestId, /^\d+$/);
  let transport;
  for (let attempt=0; attempt<30; attempt++) {
    const row = sql(`select jsonb_build_object('status',status_code,'body',content,'timed_out',timed_out) from net._http_response where id=${requestId};`);
    if (row) { transport=JSON.parse(row); break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(transport?.status, 200, "pg_net reaches JWT gateway and authenticated worker");
  const body = JSON.parse(transport.body);
  if (body.run_id) runIds.push(body.run_id);
  assert.equal(body.ok, true);
  assert.equal(body.admin_flagged, 0);
  assert.equal(sql("select count(*) from cron.job;"), "0", "manual transport test never schedules Cron");
  console.log("PASS: gateway JWT + worker secret, concurrent runs, retry, audit/notification uniqueness, no confirmation/money changes, and one-off pg_net transport; zero Cron jobs.");
} finally {
  // Fixed fixture IDs only, never broad cleanup of unrelated state.
  sql(`delete from public.notifications where related_request_id='${job}';
    delete from public.job_events where job_id='${job}';
    delete from public.service_requests where id='${job}';
    delete from auth.users where id in ('${owner}','${admin}');`);
  for (const id of runIds) {
    if (/^[0-9a-f-]{36}$/.test(id)) sql(`delete from public.lifecycle_worker_runs where id='${id}';`);
  }
}
