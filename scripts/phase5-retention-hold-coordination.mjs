// Synthetic-only concurrency proof for TRACE-093 through the real Storage API; reset the
// isolated database afterward. A retention hold and a permanent deletion must never both
// take effect: a hold that commits while a deletion waits wins and the file stays; a
// deletion already in Storage's transaction wins, the hold waits, and the deletion stays
// recordable after the hold.
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
const sql = (source) => run("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], source);

// Local stack keys, read from the CLI and never printed.
const cli = existsSync(".phase5-local/tools-linux/node_modules/.bin/supabase") ? ".phase5-local/tools-linux/node_modules/.bin/supabase" : "supabase";
const stack = Object.fromEntries(
  (await run(cli, ["status", "--workdir", ".phase5-local", "-o", "env"]))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
for (const name of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "JWT_SECRET"]) assert.ok(stack[name], `Local stack ${name} is available`);
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function sessionToken(sub) {
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 900 });
  return `${header}.${payload}.${createHmac("sha256", stack.JWT_SECRET).update(`${header}.${payload}`).digest("base64url")}`;
}

const quarantine = "vendor-documents-quarantine";
async function upload(path) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/${quarantine}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stack.SERVICE_ROLE_KEY}`, apikey: stack.SERVICE_ROLE_KEY, "Content-Type": "application/pdf" },
    body: "%PDF synthetic retention coordination",
  });
  assert.equal(response.status, 200, `Synthetic upload succeeds: ${await response.clone().text()}`);
}
// The route's storage call: the operator's own session removing one quarantined object.
async function storageDelete(user, path) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/${quarantine}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${sessionToken(user)}`, apikey: stack.ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Storage answers the delete: ${JSON.stringify(body)}`);
  return body.length;
}
async function storedBytes(path) {
  const response = await fetch(`${stack.API_URL}/storage/v1/object/${quarantine}/${path}`, {
    headers: { Authorization: `Bearer ${stack.SERVICE_ROLE_KEY}`, apikey: stack.SERVICE_ROLE_KEY },
  });
  await response.arrayBuffer();
  return response.status === 200;
}

const operator = "e9300000-0000-4000-8000-000000000001";
const operatorTwo = "e9300000-0000-4000-8000-000000000002";
const provider = (n) => `e9400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const application = (n) => `e9500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const doc = (n) => `e9600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const renewalPath = (p, n) => `renewals/${provider(p)}/license/e9700000-0000-4000-8000-${String(n).padStart(12, "0")}-coordination.pdf`;
const appPath = (a) => `${application(a)}/license/e9800000-0000-4000-8000-${String(a).padStart(12, "0")}-coordination.pdf`;
const as = (user, body) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );

assert.equal(await sql(`select count(*) from auth.users where id in ('${operator}','${operatorTwo}')`), "0", "Reset isolated fixtures before running");

// Providers 1-8 active on synthetic application versions. Provider 1 owns declined document 1;
// application 21 (no provider) and application 22 (provider 2) are rejected; providers 3-8
// each own one never-submitted upload. Every file is uploaded through Storage, then placed
// in quarantine for 20 days by ledger rows, as TRACE-074/084/091 would have left it.
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${operator}','coordination-operator@example.invalid',now()),('${operatorTwo}','coordination-operator-two@example.invalid',now());
insert into public.user_roles(user_id,role) values('${operator}','admin'),('${operatorTwo}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled)
 select ('e9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic coordination provider '||n,true,false from generate_series(1,8) n;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls,contractor_id)
 select ('e9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic coordination provider '||n,'Test','Provider',
   'coordination-provider-'||n||'@example.invalid','synthetic','approved','{}',('e9400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
 from generate_series(1,8) n;
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select a.contractor_id,v.id,2,'active' from public.vendor_applications a join public.vendor_application_versions v on v.application_id=a.id
 where a.id::text like 'e9500000-%';
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls,contractor_id) values
 ('${application(21)}','Synthetic coordination applicant 21','Test','Applicant','coordination-21@example.invalid','synthetic','pending',array['${appPath(21)}'],null),
 ('${application(22)}','Synthetic coordination applicant 22','Test','Applicant','coordination-22@example.invalid','synthetic','pending',array['${appPath(22)}'],'${provider(2)}');
insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor,created_at)
 select id,'rejected','pending','Synthetic closure','coordination-close-'||id,'${operator}',now()-interval '120 days'
 from public.vendor_applications where id in ('${application(21)}','${application(22)}');
update public.vendor_applications set status='rejected' where id in ('${application(21)}','${application(22)}');
commit;`);
const uploads = [3, 4, 5, 6, 7, 8].map((p) => renewalPath(p, p));
for (const path of [renewalPath(1, 1), appPath(21), appPath(22), ...uploads]) await upload(path);
await sql(`begin;
update storage.objects set created_at=now()-interval '40 days' where bucket_id='${quarantine}' and name like 'renewals/e9400000-%';
insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as,created_at)
 select '${doc(1)}','${provider(1)}','license','${renewalPath(1, 1)}','coordination.pdf','application/pdf',(metadata->>'size')::bigint,'${operator}','operator',now()-interval '131 days'
 from storage.objects where bucket_id='${quarantine}' and name='${renewalPath(1, 1)}';
insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor,created_at)
 values('${doc(1)}','declined','Synthetic decline','coordination-decline-1','${operator}',now()-interval '130 days');
insert into public.vendor_renewal_retention_actions(document_id,action,reason,under_hold,business_key,actor,created_at)
 values('${doc(1)}','quarantined','Synthetic fixture',false,'coordination-q-doc-1','${operator}',now()-interval '20 days');
insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at)
 select substr(name,1,36)::uuid,name,'quarantined',(metadata->>'size')::bigint,'Synthetic fixture',false,'coordination-q-'||name,'${operator}',now()-interval '20 days'
 from storage.objects where bucket_id='${quarantine}' and name like 'e9500000-%';
insert into public.vendor_renewal_upload_retention_actions(contractor_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at)
 select split_part(name,'/',2)::uuid,name,'quarantined',(metadata->>'size')::bigint,'Synthetic fixture',false,'coordination-q-'||name,'${operator}',now()-interval '20 days'
 from storage.objects where bucket_id='${quarantine}' and name like 'renewals/e9400000-%' and name<>'${renewalPath(1, 1)}';
commit;`);
const before = await sql(`select md5(concat_ws('|',(select string_agg(contractor_id||status||revision,',' order by contractor_id) from public.vendor_onboarding where contractor_id::text like 'e9400000-%'),
 (select count(*) from public.vendor_compliance_evidence where contractor_id::text like 'e9400000-%')))`);

// Waits until a synthetic hold transaction is holding its lock and sleeping.
async function whenSleeping(tag) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await sql(`select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%${tag}%'`)) === "1") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Hold transaction ${tag} never reached its sleep`);
}
// Places a hold inside a transaction that keeps the lock for 1.5 s before committing.
const slowHold = (tag, call) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${operatorTwo}"}',true); end $$;
 set local role authenticated; select ${call}; select pg_sleep(1.5) /* ${tag} */; commit;`);

// 1. Hold wins. For each scope: prepare, then a hold transaction takes the lock; the Storage
// delete starts, waits on that lock, sees the committed hold and removes nothing.
const holdFirst = [
  {
    name: "declined renewal document",
    path: renewalPath(1, 1),
    prepare: `public.vendor_prepare_renewal_retention('${doc(1)}','deleted','Synthetic coordination','coord-doc-1')`,
    hold: `public.vendor_place_retention_hold('${provider(1)}','Synthetic coordination hold','coord-hold-p1')`,
    record: `public.vendor_record_renewal_retention('${doc(1)}','deleted','Synthetic coordination','coord-doc-1')`,
    refusal: "This provider is on a retention hold",
  },
  {
    name: "application file (application hold)",
    path: appPath(21),
    prepare: `public.vendor_application_retention_prepare('${application(21)}','${appPath(21)}','deleted','Synthetic coordination','coord-app-21')`,
    hold: `public.vendor_place_application_retention_hold('${application(21)}','Synthetic coordination hold','coord-hold-a21')`,
    record: `public.vendor_application_retention_record('${application(21)}','${appPath(21)}','deleted','Synthetic coordination','coord-app-21')`,
    refusal: "This application is on a retention hold",
  },
  {
    name: "application file (provider hold)",
    path: appPath(22),
    prepare: `public.vendor_application_retention_prepare('${application(22)}','${appPath(22)}','deleted','Synthetic coordination','coord-app-22')`,
    hold: `public.vendor_place_retention_hold('${provider(2)}','Synthetic coordination hold','coord-hold-p2')`,
    record: `public.vendor_application_retention_record('${application(22)}','${appPath(22)}','deleted','Synthetic coordination','coord-app-22')`,
    refusal: "This application is on a retention hold",
  },
  {
    name: "never-submitted renewal upload",
    path: renewalPath(3, 3),
    prepare: `public.vendor_renewal_upload_retention_prepare('${renewalPath(3, 3)}','deleted','Synthetic coordination','coord-up-3')`,
    hold: `public.vendor_place_retention_hold('${provider(3)}','Synthetic coordination hold','coord-hold-p3')`,
    record: `public.vendor_renewal_upload_retention_record('${renewalPath(3, 3)}','deleted','Synthetic coordination','coord-up-3')`,
    refusal: "This provider is on a retention hold",
  },
];
for (const [index, scope] of holdFirst.entries()) {
  await as(operator, `select ${scope.prepare};`);
  const tag = `coord-hold-first-${index}`;
  const hold = slowHold(tag, scope.hold);
  await whenSleeping(tag);
  const started = Date.now();
  const removed = await storageDelete(operator, scope.path);
  const waited = Date.now() - started;
  await hold;
  assert.equal(removed, 0, `${scope.name}: the delay-blocked Storage delete removes nothing once the hold commits`);
  assert.ok(waited >= 500, `${scope.name}: the Storage delete waited for the hold's lock (${waited} ms)`);
  assert.equal(await storedBytes(scope.path), true, `${scope.name}: the held file's bytes are still stored`);
  const recorded = await settle(as(operator, `select ${scope.record};`));
  assert.ok(!recorded.ok && recorded.message.includes(scope.refusal), `${scope.name}: record refuses as held: ${recorded.message}`);
}
assert.equal(await sql(`select count(*) from public.vendor_retention_storage_deletions where storage_path like any(array['renewals/e9400000-%','e9500000-%'])`), "0",
  "No storage deletion is recorded while a hold won");

// 2. Deletion wins. A synthetic lock on the object's row holds Storage's delete inside its
// transaction after the policy has passed (the delayed Storage call); a hold requested then
// waits for Storage to commit. The deletion is then recorded, not under hold.
{
  const path = renewalPath(4, 4);
  await as(operator, `select public.vendor_renewal_upload_retention_prepare('${path}','deleted','Synthetic coordination','coord-up-4');`);
  const blocker = sql(`begin; select 1 from storage.objects where bucket_id='${quarantine}' and name='${path}' for update; select pg_sleep(1.5) /* coord-row-blocker */; commit;`);
  await whenSleeping("coord-row-blocker");
  const deletion = storageDelete(operator, path);
  const waiting = async (pattern) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await sql(`select count(*) from pg_stat_activity where wait_event_type='Lock' and query ilike '${pattern}'`)) === "1") return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };
  assert.ok(await waiting("%delete from storage.objects%"), "Storage's delete is held inside its transaction after the policy passed");
  const hold = as(operatorTwo, `select public.vendor_place_retention_hold('${provider(4)}','Synthetic later hold','coord-hold-p4');`);
  assert.ok(await waiting("%vendor_place_retention_hold%coord-hold-p4%"), "The hold waits on the lock Storage's transaction holds");
  const [removed] = await Promise.all([deletion, hold, blocker]);
  assert.equal(removed, 1, "The Storage delete already past the policy completes");
  assert.equal(await storedBytes(path), false, "The file is gone");
  const recorded = JSON.parse(await as(operator, `select public.vendor_renewal_upload_retention_record('${path}','deleted','Synthetic coordination','coord-up-4');`));
  assert.equal(recorded.under_hold, false, "The deletion that took effect before the hold is recorded, not under hold");
}

// 3. Crash between Storage and record, then a hold, then the retry with the same key.
{
  const path = renewalPath(5, 5);
  await as(operator, `select public.vendor_renewal_upload_retention_prepare('${path}','deleted','Synthetic coordination','coord-up-5');`);
  assert.equal(await storageDelete(operator, path), 1, "Storage deletes; the request then stops before record");
  await as(operatorTwo, `select public.vendor_place_retention_hold('${provider(5)}','Synthetic later hold','coord-hold-p5');`);
  await as(operator, `select public.vendor_renewal_upload_retention_prepare('${path}','deleted','Synthetic coordination','coord-up-5');`);
  assert.equal(await storageDelete(operator, path), 0, "The retried Storage call removes nothing");
  const recorded = JSON.parse(await as(operator, `select public.vendor_renewal_upload_retention_record('${path}','deleted','Synthetic coordination','coord-up-5');`));
  assert.equal(recorded.under_hold, false, "The retry records the completed deletion, not under hold");
}

// 4. Simultaneous Storage deletes and holds on three providers, four of each per file. Either
// outcome is valid; a file gone without a policy-recorded deletion is not.
const races = [6, 7, 8];
for (const p of races) {
  await as(operator, `select public.vendor_renewal_upload_retention_prepare('${renewalPath(p, p)}','deleted','Synthetic coordination','coord-up-${p}');`);
}
const outcomes = await Promise.all(
  races.map(async (p) => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        index % 2
          ? settle(storageDelete(operator, renewalPath(p, p)))
          : settle(as(operatorTwo, `select public.vendor_place_retention_hold('${provider(p)}','Synthetic race hold','coord-race-${p}-${index}');`)),
      ),
    );
    return { p, results };
  }),
);
const summary = [];
for (const { p, results } of outcomes) {
  const path = renewalPath(p, p);
  const deleted = results.filter((result, index) => index % 2 && result.ok).reduce((sum, result) => sum + result.value, 0);
  const holds = results.filter((result, index) => !(index % 2) && result.ok).length;
  assert.equal(holds, 1, `Provider ${p}: exactly one hold is placed`);
  assert.ok(deleted <= 1, `Provider ${p}: the object is removed at most once`);
  const gone = !(await storedBytes(path));
  const recordedDeletion = (await sql(`select count(*) from public.vendor_retention_storage_deletions where storage_path='${path}'`)) === "1";
  assert.equal(gone, deleted === 1, `Provider ${p}: storage agrees with the Storage responses`);
  assert.equal(gone, recordedDeletion, `Provider ${p}: a file is gone only with a policy-recorded deletion`);
  const recorded = await settle(as(operator, `select public.vendor_renewal_upload_retention_record('${path}','deleted','Synthetic coordination','coord-up-${p}');`));
  if (gone) {
    assert.ok(recorded.ok && JSON.parse(recorded.value).under_hold === false, `Provider ${p}: the deletion is recorded, not under hold`);
  } else {
    assert.ok(!recorded.ok && recorded.message.includes("This provider is on a retention hold"), `Provider ${p}: record refuses as held`);
  }
  summary.push(gone ? "deletion first" : "hold first");
}

assert.equal(
  await sql(`select count(*) from public.vendor_renewal_upload_retention_actions a where a.action='deleted' and a.under_hold and a.storage_path like 'renewals/e9400000-%'`),
  "0",
  "No policy-coordinated deletion is recorded under hold",
);
assert.equal(
  await sql(`select md5(concat_ws('|',(select string_agg(contractor_id||status||revision,',' order by contractor_id) from public.vendor_onboarding where contractor_id::text like 'e9400000-%'),
 (select count(*) from public.vendor_compliance_evidence where contractor_id::text like 'e9400000-%')))`),
  before,
  "No status, revision or evidence changed",
);
console.log(
  `PASS: a hold committed while Storage's delete waited kept the file in all four scopes; a Storage delete already past the policy completed before a waiting hold and was recorded not under hold; a crash retry after a later hold recorded the deletion; simultaneous deletes and holds (${summary.join(", ")}) never left a file gone without a policy-recorded deletion. Reset synthetic fixtures afterward.`,
);
