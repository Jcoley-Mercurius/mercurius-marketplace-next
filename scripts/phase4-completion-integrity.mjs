// Synthetic-only proof for TRACE-097 through the real Storage and REST APIs and concurrent
// database sessions; reset the isolated database afterward (evidence rows are immutable).
// P4-R1: completion counts only stored job-photos objects for the job, uploaded by its
// provider or an admin; the homeowner can open recorded proof; nobody can delete it.
// P4-R2: completion and an admin correction serialize on the per-request lock in both
// orders without a deadlock; concurrent duplicate completions record one attempt; a Storage
// deletion and a completion serialize in both orders.
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const container = process.env.PHASE5_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
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
const psqlArgs = ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
const sql = (source) => run("docker", psqlArgs, source);

// Local stack keys, read from the CLI and never printed.
const cli = existsSync(".phase5-local/tools-linux/node_modules/.bin/supabase") ? ".phase5-local/tools-linux/node_modules/.bin/supabase" : "supabase";
const stack = Object.fromEntries(
  (await run(cli, ["status", "--workdir", ".phase5-local", "-o", "env"]))
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
const headers = (user, extra = {}) => ({ Authorization: `Bearer ${sessionToken(user)}`, apikey: stack.ANON_KEY, ...extra });

const bucket = "job-photos";
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b50000000049454e44ae426082", "hex");
async function upload(user, path, upsert = false) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: headers(user, { "Content-Type": "image/png", "x-upsert": String(upsert) }),
    body: png,
  });
  return { status: response.status, body: await response.text() };
}
async function removeObject(user, path) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: headers(user, { "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: [path] }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Storage answers the delete: ${JSON.stringify(body)}`);
  return body.length;
}
async function signedDownload(user, path) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: headers(user, { "Content-Type": "application/json" }),
    body: JSON.stringify({ expiresIn: 60 }),
  });
  const body = await response.json();
  if (response.status !== 200 || !body.signedURL) return false;
  const file = await fetch(`${stack.API_URL}/storage/v1${body.signedURL}`);
  return file.status === 200 && Buffer.from(await file.arrayBuffer()).equals(png);
}
async function complete(user, job, paths) {
  const response = await fetch(`${stack.API_URL}/rest/v1/rpc/vendor_complete_job`, {
    method: "POST",
    headers: headers(user, { "Content-Type": "application/json" }),
    body: JSON.stringify({ _job_id: job, _photo_urls: paths }),
  });
  const text = await response.text();
  return { ok: response.ok, message: text ? (JSON.parse(text).message ?? "") : "" };
}

const id = (group, n) => `e9${group}00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const homeowner = id(7, 1),
  provider = id(7, 2),
  otherProvider = id(7, 3),
  admin = id(7, 4);
const contractor = id(8, 1),
  otherContractor = id(8, 2);
const job = (n) => id(9, n);
const path = (user, j, name) => `${user}/${job(j)}/${name}`;
const state = (j) =>
  sql(`select concat_ws('|', status, photo_proof_urls::text, (select count(*) from public.job_events where job_id=sr.id),
   (select count(*) from public.notifications where related_request_id=sr.id), (select count(*) from public.job_completion_evidence where job_id=sr.id))
   from public.service_requests sr where id='${job(j)}';`);
const status = (j) => sql(`select status from public.service_requests where id='${job(j)}';`);

// Fixed synthetic IDs must be unused; inserts error rather than reuse any data.
await sql(`begin;
insert into auth.users(id,raw_user_meta_data) values ('${homeowner}','{"full_name":"Synthetic completion owner"}'),
 ('${provider}','{"full_name":"Synthetic completion provider"}'),('${otherProvider}','{"full_name":"Synthetic other provider"}'),
 ('${admin}','{"full_name":"Synthetic completion admin"}');
insert into public.user_roles(user_id,role) values ('${provider}','vendor'),('${otherProvider}','vendor'),('${admin}','admin');
insert into public.contractors(id,user_id,name) values ('${contractor}','${provider}','Synthetic completion provider'),
 ('${otherContractor}','${otherProvider}','Synthetic other provider');
insert into public.service_requests(id,customer_id,contractor_id,service_type,address,status,service_catalog_id)
 select ('${job(0).slice(0, -12)}' || lpad(n::text,12,'0'))::uuid,'${homeowner}','${contractor}','Synthetic completion '||n,'Synthetic fixture','in_progress',
 (select id from public.services_catalog order by id limit 1) from generate_series(1,8) n;
insert into public.completion_evidence_rules(service_id,version,minimum_photos,actor_id,reason)
 select (select id from public.services_catalog order by id limit 1),coalesce(max(version),0)+1,2,'${admin}','Synthetic two-photo rule'
 from public.completion_evidence_rules where service_id=(select id from public.services_catalog order by id limit 1);
commit;`);

let checks = 0;
const check = (value, expected, label) => {
  assert.deepEqual(value, expected, label);
  checks++;
  console.log(`ok ${checks} - ${label}`);
};

// --- P4-R1 through the real APIs --------------------------------------------------------
for (const name of ["a.png", "b.png", "c.png", "spare.png"]) check((await upload(provider, path(provider, 1, name))).status, 200, `provider uploads ${name} through Storage`);
check((await upload(otherProvider, path(otherProvider, 1, "y.png"))).status, 200, "an unassigned provider can upload to their own folder");
check((await upload(provider, path(provider, 2, "x.png"))).status, 200, "provider uploads a photo for another job");
check((await upload(homeowner, path(homeowner, 1, "home.png"))).status, 200, "homeowner uploads to their own folder");
check((await upload(provider, path(otherProvider, 1, "planted.png"))).status >= 400, true, "Storage refuses an upload into someone else's folder");
const owners = await sql(`select coalesce(owner_id, owner::text) from storage.objects where bucket_id='${bucket}' and name='${path(provider, 1, "a.png")}';`);
check(owners, provider, "Storage records the uploader as the object owner");

const before = await state(1);
const refusals = [
  [[null, null], "Each completion photo must be an uploaded file", "two NULL slots"],
  [[path(provider, 1, "a.png"), path(provider, 1, "a.png")], "The same completion photo cannot be counted twice", "a duplicate reference"],
  [[path(provider, 1, "a.png"), path(provider, 1, "never-uploaded.png")], "A completion photo was not found in storage. Upload it again", "a reference with no upload"],
  [[path(provider, 1, "a.png"), path(provider, 2, "x.png")], "A completion photo was uploaded for a different job", "another job's photo"],
  [[path(provider, 1, "a.png"), path(otherProvider, 1, "y.png")], "A completion photo was not uploaded by this job's provider", "an unassigned provider's photo"],
  [[path(provider, 1, "a.png"), path(homeowner, 1, "home.png")], "A completion photo was not uploaded by this job's provider", "the homeowner's photo"],
  [[path(provider, 1, "a.png")], "This service requires at least 2 completion photos", "one photo under a two-photo rule"],
];
for (const [paths, message, label] of refusals) check(await complete(provider, job(1), paths), { ok: false, message }, `REST completion refuses ${label}`);
check(await state(1), before, "refused REST completions change nothing");
check(await signedDownload(homeowner, path(provider, 1, "a.png")), false, "homeowner cannot open an unsubmitted upload");

check((await complete(provider, job(1), [path(provider, 1, "a.png"), path(provider, 1, "b.png")])).ok, true, "retry with two verified uploads completes");
check(await status(1), "vendor_completed", "job awaits homeowner confirmation");
check(await signedDownload(homeowner, path(provider, 1, "a.png")), true, "homeowner opens the recorded proof");
check(await signedDownload(homeowner, path(provider, 1, "c.png")), false, "homeowner still cannot open an unsubmitted upload");
check(await removeObject(provider, path(provider, 1, "a.png")), 0, "provider's Storage delete of recorded proof removes nothing");
check(await removeObject(admin, path(provider, 1, "b.png")), 0, "admin's Storage delete of recorded proof removes nothing");
check((await upload(provider, path(provider, 1, "a.png"), true)).status >= 400, true, "Storage refuses overwriting recorded proof");
check(await signedDownload(homeowner, path(provider, 1, "a.png")), true, "recorded proof is unchanged after refused delete and overwrite");
check(await removeObject(provider, path(provider, 1, "spare.png")), 1, "provider can still delete an unsubmitted upload");
check((await fetch(`${stack.API_URL}/rest/v1/rpc/homeowner_confirm_job`, { method: "POST", headers: headers(homeowner, { "Content-Type": "application/json" }), body: JSON.stringify({ _job_id: job(1) }) })).ok, true, "homeowner confirms");
check(await signedDownload(homeowner, path(provider, 1, "b.png")), true, "proof is retained after confirmation");

// --- Concurrent sessions ----------------------------------------------------------------
// One psql session with its stdin held open, so a transaction can wait between statements.
function session(name) {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", "postgres"]);
  let output = "",
    errors = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (errors += chunk));
  const closed = new Promise((resolve) => child.on("close", resolve));
  return {
    send: (text) => child.stdin.write(`${text}\n`),
    async mark(label) {
      child.stdin.write(`\\echo ${label}\n`);
      const deadline = Date.now() + 10000;
      while (!output.includes(label)) {
        if (Date.now() > deadline) throw new Error(`${name} did not reach ${label}: ${errors}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async end() {
      child.stdin.end();
      await closed;
      return { output, errors };
    },
    as: (user) => `begin; set local application_name='${name}'; set local role authenticated; select set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true);`,
  };
}
async function waitsOnLock(name) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if ((await sql(`select wait_event_type from pg_stat_activity where application_name='${name}';`)) === "Lock") return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}
const noDeadlock = (...results) => results.every((result) => !result.errors.includes("deadlock detected"));

async function uploadPair(j) {
  for (const name of ["one.png", "two.png"]) assert.equal((await upload(provider, path(provider, j, name))).status, 200);
  return `array['${path(provider, j, "one.png")}','${path(provider, j, "two.png")}']`;
}

// The review's interleaving: the admin transition has taken the per-request advisory lock but
// not yet the row lock. Old completion took the row, then waited on the advisory lock, and
// the admin's row lock request closed the cycle (deadlock). Completion now waits first.
{
  const photos = await uploadPair(8);
  const a = session("trace097_admin_window"),
    b = session("trace097_completion_window");
  a.send(`${a.as(admin)} select pg_advisory_xact_lock(hashtextextended('${job(8)}',0));`);
  await a.mark("A_HELD");
  b.send(`${b.as(provider)} select public.vendor_complete_job('${job(8)}',${photos}); commit;`);
  check(await waitsOnLock("trace097_completion_window"), true, "lock window: completion waits");
  check(await sql(`select count(*) from pg_locks l join pg_stat_activity s using (pid) where s.application_name='trace097_completion_window' and l.granted and l.relation='public.service_requests'::regclass and l.mode in ('RowShareLock','RowExclusiveLock');`), "0", "lock window: the waiting completion holds no row lock on requests");
  a.send(`select public.transition_job_status('${job(8)}','pending','Synthetic concurrent correction'); commit;`);
  const [ra, rb] = [await a.end(), await b.end()];
  check(noDeadlock(ra, rb), true, "lock window: no deadlock");
  check(ra.errors, "", "lock window: the correction commits");
  check(/Invalid job transition: pending -> vendor_completed/.test(rb.errors), true, "lock window: completion is then refused on the corrected state");
}
// Order 1: the admin correction holds both locks; completion waits.
{
  const photos = await uploadPair(2);
  const a = session("trace097_admin_first"),
    b = session("trace097_completion_second");
  a.send(`${a.as(admin)} select public.transition_job_status('${job(2)}','pending','Synthetic concurrent correction');`);
  await a.mark("A_HELD");
  b.send(`${b.as(provider)} select public.vendor_complete_job('${job(2)}',${photos}); commit;`);
  check(await waitsOnLock("trace097_completion_second"), true, "admin first: completion waits on the lifecycle lock");
  a.send("commit;");
  const [ra, rb] = [await a.end(), await b.end()];
  check(noDeadlock(ra, rb), true, "admin first: no deadlock");
  check(ra.errors, "", "admin first: the correction commits");
  check(/Invalid job transition: pending -> vendor_completed/.test(rb.errors), true, "admin first: completion then sees the corrected state and is refused");
  check(await status(2), "pending", "admin first: the correction stands");
  check(await sql(`select count(*) from public.job_completion_evidence where job_id='${job(2)}';`), "0", "admin first: no evidence recorded");
}
// Order 2: completion holds the lock; the admin correction waits and applies after it.
{
  const photos = await uploadPair(3);
  const a = session("trace097_completion_first"),
    b = session("trace097_admin_second");
  a.send(`${a.as(provider)} select public.vendor_complete_job('${job(3)}',${photos});`);
  await a.mark("A_HELD");
  b.send(`${b.as(admin)} select public.transition_job_status('${job(3)}','in_progress','Synthetic concurrent rework'); commit;`);
  check(await waitsOnLock("trace097_admin_second"), true, "completion first: correction waits on the lifecycle lock");
  a.send("commit;");
  const [ra, rb] = [await a.end(), await b.end()];
  check(noDeadlock(ra, rb), true, "completion first: no deadlock");
  check([ra.errors, rb.errors], ["", ""], "completion first: both commit");
  check(await status(3), "in_progress", "completion first: the rework applies after completion");
  check(await sql(`select count(*) from public.job_completion_evidence where job_id='${job(3)}';`), "2", "completion first: the completion's evidence is kept");
}
// Duplicate completions at once: one succeeds, one is refused, one attempt is recorded.
{
  const photos = await uploadPair(4);
  const a = session("trace097_duplicate_a"),
    b = session("trace097_duplicate_b");
  a.send(`${a.as(provider)} select public.vendor_complete_job('${job(4)}',${photos});`);
  await a.mark("A_HELD");
  b.send(`${b.as(provider)} select public.vendor_complete_job('${job(4)}',${photos}); commit;`);
  check(await waitsOnLock("trace097_duplicate_b"), true, "duplicate: second completion waits");
  a.send("commit;");
  const [ra, rb] = [await a.end(), await b.end()];
  check(noDeadlock(ra, rb), true, "duplicate: no deadlock");
  check([ra.errors === "", rb.errors.includes("Duplicate job transition")], [true, true], "duplicate: first commits, second is refused");
  check(await sql(`select count(distinct attempt)||'/'||count(*) from public.job_completion_evidence where job_id='${job(4)}';`), "1/2", "duplicate: one attempt with two photos");
  check(await sql(`select count(*) from public.job_events where job_id='${job(4)}' and event_type='job_completed_by_vendor';`), "1", "duplicate: one completion event");
}
// Storage deletion first: the delete (under Storage's policy) holds the lock; completion then
// finds the object gone and is refused.
{
  const photos = await uploadPair(5);
  const a = session("trace097_delete_first"),
    b = session("trace097_completion_after_delete");
  a.send(`${a.as(provider)} select set_config('storage.allow_delete_query','true',true); delete from storage.objects where bucket_id='${bucket}' and name='${path(provider, 5, "one.png")}' returning 'deleted';`);
  await a.mark("A_HELD");
  b.send(`${b.as(provider)} select public.vendor_complete_job('${job(5)}',${photos}); commit;`);
  check(await waitsOnLock("trace097_completion_after_delete"), true, "delete first: completion waits for the deletion");
  a.send("commit;");
  const [ra, rb] = [await a.end(), await b.end()];
  check(noDeadlock(ra, rb), true, "delete first: no deadlock");
  check(ra.output.includes("deleted"), true, "delete first: the unsubmitted photo is deleted");
  check(rb.errors.includes("A completion photo was not found in storage"), true, "delete first: completion is refused");
  check(await status(5), "in_progress", "delete first: the job is unchanged");
}
// Completion first: the completion holds the lock; the Storage delete waits, then is refused.
{
  const photos = await uploadPair(6);
  const a = session("trace097_completion_before_delete");
  a.send(`${a.as(provider)} select public.vendor_complete_job('${job(6)}',${photos});`);
  await a.mark("A_HELD");
  const deletion = removeObject(provider, path(provider, 6, "one.png"));
  const waited = await new Promise((resolve) => {
    const deadline = Date.now() + 10000;
    const poll = async () => {
      const waiting = await sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and wait_event='advisory' and coalesce(application_name,'') not like 'trace097%';`);
      if (waiting !== "0") return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(poll, 20);
    };
    poll();
  });
  check(waited, true, "completion first: the Storage API delete waits on the lifecycle lock");
  a.send("commit;");
  const ra = await a.end();
  check(ra.errors, "", "completion first: completion commits");
  check(await deletion, 0, "completion first: the Storage API delete then removes nothing");
  check(await signedDownload(homeowner, path(provider, 6, "one.png")), true, "completion first: the proof is intact");
}
// Failure then retry in one atomic step: a refused completion keeps the job editable.
{
  const photos = await uploadPair(7);
  const before7 = await state(7);
  check((await complete(provider, job(7), [path(provider, 7, "one.png")])).ok, false, "retry: an under-minimum completion is refused");
  check(await state(7), before7, "retry: the refusal changes nothing");
  check((await complete(provider, job(7), JSON.parse(photos.replace("array", "").replaceAll("'", '"')))).ok, true, "retry: the corrected completion succeeds");
}
console.log(`1..${checks}`);
console.log("TRACE-097 completion integrity: all checks passed. Reset the isolated database to remove the synthetic fixtures.");
