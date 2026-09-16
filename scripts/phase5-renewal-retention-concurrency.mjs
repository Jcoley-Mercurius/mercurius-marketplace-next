// Synthetic-only concurrency proof for TRACE-074; reset the isolated database afterward.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      "supabase_db_mercurius-phase5-isolated",
      "psql",
      "-X",
      "-q",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ]);
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(errors)),
    );
    child.stdin.end(source);
  });
}
const operator = "d7500000-0000-4000-8000-000000000001";
const operatorTwo = "d7500000-0000-4000-8000-000000000002";
const provider = "d7500000-0000-4000-8000-000000000011";
const application = "d7500000-0000-4000-8000-000000000021";
const as = (user, body) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const doc = (n) => `d7500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const path = (n) => `renewals/${provider}/license/d7600000-0000-4000-8000-${String(n).padStart(12, "0")}-retention-race.pdf`;
// The Storage API's move, done directly because the route is not under test here.
const quarantineFile = (n) =>
  sql(`update storage.objects set bucket_id='vendor-documents-quarantine' where bucket_id='vendor-documents' and name='${path(n)}';`);
const record = (user, n, key) =>
  settle(as(user, `select public.vendor_record_renewal_retention('${doc(n)}','quarantined','Synthetic retention race','${key}');`));

assert.equal(
  await sql(`select count(*) from auth.users where id in ('${operator}','${operatorTwo}')`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${operator}','retention-race-operator@example.invalid',now()),('${operatorTwo}','retention-race-operator-two@example.invalid',now());
insert into public.user_roles(user_id,role) values('${operator}','admin'),('${operatorTwo}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled) values('${provider}','Synthetic retention race provider',true,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('${application}','Synthetic retention race provider','Test','Race','retention-race@example.invalid','synthetic','${provider}',array['synthetic/retention-race/license.pdf']);
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select '${provider}',id,2,'active' from public.vendor_application_versions where application_id='${application}';
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents','renewals/${provider}/license/d7600000-0000-4000-8000-'||lpad(n::text,12,'0')||'-retention-race.pdf','{"size":2048,"mimetype":"application/pdf"}'
 from generate_series(1,4) n;
insert into public.vendor_renewal_documents(id,contractor_id,kind,storage_path,file_name,mime_type,size_bytes,submitted_by,submitted_as,created_at)
 select ('d7500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${provider}','license',
   'renewals/${provider}/license/d7600000-0000-4000-8000-'||lpad(n::text,12,'0')||'-retention-race.pdf',
   'retention-race.pdf','application/pdf',2048,'${operator}','operator',now()-interval '120 days'
 from generate_series(1,4) n;
insert into public.vendor_renewal_document_decisions(document_id,outcome,note,business_key,actor,created_at)
 select ('d7500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'declined','Synthetic decline','retention-race-decline-'||n,'${operator}',now()-interval '100 days'
 from generate_series(1,4) n;
commit;`);
const before = await sql(`select md5(concat_ws('|',(select string_agg(document_id::text||outcome,',' order by document_id) from public.vendor_renewal_document_decisions),
 (select status||revision from public.vendor_onboarding where contractor_id='${provider}')))`);

// 1. Eight concurrent records of one quarantine under the same key: one row, one recorder.
await quarantineFile(1);
const same = await Promise.all(Array.from({ length: 8 }, () => record(operator, 1, "retention-race-same")));
assert.ok(same.every((result) => result.ok), "Same-key records all succeed: " + same.map((r) => r.message ?? "ok").join(" | "));
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records");

// 2. Eight concurrent records with distinct keys across two operators: one wins.
await quarantineFile(2);
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => record(index % 2 ? operatorTwo : operator, 2, `retention-race-distinct-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one distinct-key record succeeds");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Renewal document already quarantined")),
  "Every loser is refused as already quarantined: " + distinct.map((r) => (r.ok ? "ok" : r.message)).join(" | "),
);

// 3. Holds racing a quarantine record: four hold placements and four records with distinct
// keys. One hold and one quarantine.
await quarantineFile(3);
const mixed = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? record(operator, 3, `retention-race-mixed-${index}`).then((result) => ({ ...result, action: "record" }))
      : settle(as(operatorTwo, `select public.vendor_place_retention_hold('${provider}','Synthetic race hold','retention-race-hold-${index}');`))
          .then((result) => ({ ...result, action: "hold" })),
  ),
);
assert.equal(mixed.filter((result) => result.ok && result.action === "hold").length, 1, "Exactly one hold is placed");
assert.equal(mixed.filter((result) => result.ok && result.action === "record").length, 1, "Exactly one quarantine is recorded");
assert.ok(
  mixed.every((result) => result.ok || result.message.includes("already on a retention hold") || result.message.includes("already quarantined")),
  "Every loser is refused as held or quarantined: " + mixed.map((r) => (r.ok ? `${r.action} ok` : r.message)).join(" | "),
);
// Both commands take the provider's onboarding lock and record reads the hold after it, so
// under_hold follows the serialised order; suite 041 asserts its value deterministically.
const underHold = await sql(`select under_hold::text from public.vendor_renewal_retention_actions where document_id='${doc(3)}'`);
assert.ok(["true", "false"].includes(underHold), "The recorded quarantine carries under_hold");

// 4. With the hold in force, eight concurrent quarantine prepares of a file still in document
// storage are all refused and write nothing.
const prepared = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    settle(as(operator, `select public.vendor_prepare_renewal_retention('${doc(4)}','quarantined','Synthetic retention race','retention-race-held-${index}');`)),
  ),
);
assert.ok(
  prepared.every((result) => !result.ok && result.message.includes("This provider is on a retention hold")),
  "Every prepare under hold is refused: " + prepared.map((r) => (r.ok ? "ok" : r.message)).join(" | "),
);

assert.equal(
  await sql(`select count(*) from public.vendor_renewal_retention_actions where document_id in ('${doc(1)}','${doc(2)}','${doc(3)}','${doc(4)}')`),
  "3",
  "Three quarantine rows in total",
);
assert.equal(
  await sql(`select md5(concat_ws('|',(select string_agg(document_id::text||outcome,',' order by document_id) from public.vendor_renewal_document_decisions),
 (select status||revision from public.vendor_onboarding where contractor_id='${provider}')))`),
  before,
  "No decision, status or revision changed",
);
console.log(
  `PASS: eight same-key records write once, eight distinct-key records across two operators write once, a four-hold/four-record race yields one hold and one quarantine (under_hold=${underHold}), and prepares under hold are all refused. Reset synthetic fixtures afterward.`,
);
