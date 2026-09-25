// Synthetic-only concurrency proof for TRACE-091; reset the isolated database afterward.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const container = process.env.PHASE5_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))));
    child.stdin.end(source);
  });
}
const operator = "d9100000-0000-4000-8000-000000000001";
const operatorTwo = "d9100000-0000-4000-8000-000000000002";
const vendor = "d9100000-0000-4000-8000-000000000003";
const provider = "d9100000-0000-4000-8000-000000000011";
const application = "d9100000-0000-4000-8000-000000000021";
const as = (user, body) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const path = (n) => `renewals/${provider}/insurance/d9200000-0000-4000-8000-${String(n).padStart(12, "0")}-upload-race.pdf`;
// The Storage API's move, done directly because the route is not under test here.
const quarantineFile = (n) =>
  sql(`update storage.objects set bucket_id='vendor-documents-quarantine' where bucket_id='vendor-documents' and name='${path(n)}';`);
const record = (user, n, key) =>
  settle(as(user, `select public.vendor_renewal_upload_retention_record('${path(n)}','quarantined','Synthetic upload race','${key}');`));
const prepare = (user, n, key) =>
  settle(as(user, `select public.vendor_renewal_upload_retention_prepare('${path(n)}','quarantined','Synthetic upload race','${key}');`));
const submit = (n) => settle(as(vendor, `select public.vendor_submit_renewal_document('${path(n)}');`));

assert.equal(
  await sql(`select count(*) from auth.users where id in ('${operator}','${operatorTwo}','${vendor}')`),
  "0",
  "Reset isolated fixtures before running",
);
// Uploads 1-4 are 8 days old (due, no longer submittable); 5 is 6 days old (submittable, not due).
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${operator}','upload-race-operator@example.invalid',now()),('${operatorTwo}','upload-race-operator-two@example.invalid',now()),
 ('${vendor}','upload-race-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values('${operator}','admin'),('${operatorTwo}','admin'),('${vendor}','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values('${provider}','Synthetic upload race provider',true,false,'${vendor}');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('${application}','Synthetic upload race provider','Test','Race','upload-race@example.invalid','synthetic','${provider}','{}');
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select '${provider}',id,3,'active' from public.vendor_application_versions where application_id='${application}';
insert into storage.objects(bucket_id,name,metadata,created_at)
 select 'vendor-documents','renewals/${provider}/insurance/d9200000-0000-4000-8000-'||lpad(n::text,12,'0')||'-upload-race.pdf',
   '{"size":2048,"mimetype":"application/pdf"}',now()-case when n=5 then interval '6 days' else interval '8 days' end
 from generate_series(1,5) n;
commit;`);
const before = await sql(`select md5(concat_ws('|',(select status||revision from public.vendor_onboarding where contractor_id='${provider}'),
 (select count(*) from public.vendor_compliance_evidence where contractor_id='${provider}')))`);

// 1. Eight concurrent records of one quarantine under the same key: one row, one recorder.
await quarantineFile(1);
const same = await Promise.all(Array.from({ length: 8 }, () => record(operator, 1, "upload-race-same")));
assert.ok(same.every((result) => result.ok), "Same-key records all succeed: " + same.map((r) => r.message ?? "ok").join(" | "));
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records");

// 2. Eight concurrent records with distinct keys across two operators: one wins.
await quarantineFile(2);
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => record(index % 2 ? operatorTwo : operator, 2, `upload-race-distinct-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one distinct-key record succeeds");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Renewal upload already quarantined")),
  "Every loser is refused as already quarantined: " + distinct.map((r) => (r.ok ? "ok" : r.message)).join(" | "),
);

// 3. A due upload still in document storage: four provider submissions racing four quarantine
// prepares. Every submission is refused as expired and every prepare may proceed, so no
// submitted document can ever point at a file the operator then moves.
const dueRace = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? prepare(index % 4 === 1 ? operator : operatorTwo, 3, `upload-race-due-${index}`).then((result) => ({ ...result, action: "prepare" }))
      : submit(3).then((result) => ({ ...result, action: "submit" })),
  ),
);
assert.ok(
  dueRace.filter((result) => result.action === "submit").every((result) => !result.ok && result.message.includes("This upload has expired")),
  "Every submission of a due upload is refused as expired: " + dueRace.map((r) => (r.ok ? `${r.action} ok` : r.message)).join(" | "),
);
assert.ok(dueRace.filter((result) => result.action === "prepare").every((result) => result.ok), "Every prepare of the due upload proceeds");
await quarantineFile(3);
assert.equal((await record(operator, 3, "upload-race-due-record")).value?.recorded, true, "The due upload is then quarantined");

// 4. An upload inside its window: four submissions racing four quarantine prepares. One
// submission is recorded, the same submitter replays, and every prepare is refused.
const windowRace = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? prepare(operator, 5, `upload-race-window-${index}`).then((result) => ({ ...result, action: "prepare" }))
      : submit(5).then((result) => ({ ...result, action: "submit" })),
  ),
);
assert.equal(windowRace.filter((result) => result.ok && result.action === "submit" && result.value.recorded).length, 1, "Exactly one submission is recorded");
assert.ok(
  windowRace.filter((result) => result.action === "prepare").every((result) =>
    !result.ok && (result.message.includes("kept for 7 days") || result.message.includes("This upload was submitted"))),
  "Every prepare is refused: " + windowRace.map((r) => (r.ok ? `${r.action} ok` : r.message)).join(" | "),
);

// 5. Holds racing a quarantine record: one hold and one quarantine.
await quarantineFile(4);
const mixed = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? record(operator, 4, `upload-race-mixed-${index}`).then((result) => ({ ...result, action: "record" }))
      : settle(as(operatorTwo, `select public.vendor_place_retention_hold('${provider}','Synthetic race hold','upload-race-hold-${index}');`))
          .then((result) => ({ ...result, action: "hold" })),
  ),
);
assert.equal(mixed.filter((result) => result.ok && result.action === "hold").length, 1, "Exactly one hold is placed");
assert.equal(mixed.filter((result) => result.ok && result.action === "record").length, 1, "Exactly one quarantine is recorded");
// Both commands take the provider's onboarding lock, so under_hold follows the serialised
// order; suite 058 asserts a late hold's value deterministically.
const underHold = await sql(`select under_hold::text from public.vendor_renewal_upload_retention_actions where storage_path='${path(4)}'`);
assert.ok(["true", "false"].includes(underHold), "The recorded quarantine carries under_hold");

assert.equal(
  await sql(`select count(*) from public.vendor_renewal_upload_retention_actions where contractor_id='${provider}'`),
  "4",
  "Four quarantine rows in total",
);
assert.equal(
  await sql(`select string_agg(storage_path,',') from public.vendor_renewal_documents where contractor_id='${provider}'`),
  path(5),
  "Only the in-window upload was submitted",
);
assert.equal(
  await sql(`select md5(concat_ws('|',(select status||revision from public.vendor_onboarding where contractor_id='${provider}'),
 (select count(*) from public.vendor_compliance_evidence where contractor_id='${provider}')))`),
  before,
  "No status, revision or evidence changed",
);
console.log(
  `PASS: same-key and distinct-key records write once, submissions of a due upload are all refused as expired while it is quarantined once, an in-window upload is submitted once and never prepared, and a hold/record race yields one of each (under_hold=${underHold}). Reset synthetic fixtures afterward.`,
);
