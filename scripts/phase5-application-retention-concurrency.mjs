// Synthetic-only concurrency proof for TRACE-084; reset the isolated database afterward.
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
const operator = "d8400000-0000-4000-8000-000000000001";
const operatorTwo = "d8400000-0000-4000-8000-000000000002";
const rejectedProvider = "d8500000-0000-4000-8000-000000000005";
const as = (user, body) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const app = (n) => `d8600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const path = (n) => `${app(n)}/license/d8700000-0000-4000-8000-${String(n).padStart(12, "0")}-retention-race.pdf`;
// The Storage API's move, done directly because the route is not under test here.
const quarantineFile = (n) =>
  sql(`update storage.objects set bucket_id='vendor-documents-quarantine' where bucket_id='vendor-documents' and name='${path(n)}';`);
const close = (user, n, key) =>
  settle(as(user, `select public.vendor_close_application('${app(n)}','rejected','Synthetic closure race','${key}');`));
const record = (user, n, key) =>
  settle(as(user, `select public.vendor_application_retention_record('${app(n)}','${path(n)}','quarantined','Synthetic retention race','${key}');`));
const messages = (results) => results.map((r) => (r.ok ? `${r.action ?? ""} ok` : r.message)).join(" | ");

assert.equal(
  await sql(`select count(*) from auth.users where id in ('${operator}','${operatorTwo}')`),
  "0",
  "Reset isolated fixtures before running",
);
// 1–2: pending applications to close. 3: pending application racing onboarding start.
// 4–6: rejected 100 days ago with a file due. 5 belongs to a provider rejected through
// onboarding 100 days ago.
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${operator}','app-retention-race-operator@example.invalid',now()),('${operatorTwo}','app-retention-race-operator-two@example.invalid',now());
insert into public.user_roles(user_id,role) values('${operator}','admin'),('${operatorTwo}','admin');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
 select ('d8600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic retention race '||n,'Test','Race','app-retention-race-'||n||'@example.invalid','synthetic','pending',
   array[('d8600000-0000-4000-8000-'||lpad(n::text,12,'0'))||'/license/d8700000-0000-4000-8000-'||lpad(n::text,12,'0')||'-retention-race.pdf']
 from generate_series(1,6) n;
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents',('d8600000-0000-4000-8000-'||lpad(n::text,12,'0'))||'/license/d8700000-0000-4000-8000-'||lpad(n::text,12,'0')||'-retention-race.pdf',
   '{"size":2048,"mimetype":"application/pdf"}'
 from generate_series(1,6) n;
insert into public.vendor_application_closures(application_id,outcome,before_status,reason,business_key,actor,created_at)
 select ('d8600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'rejected','pending','Synthetic closure','app-retention-race-close-'||n,'${operator}',now()-interval '100 days'
 from unnest(array[4,6]) n;
update public.vendor_applications set status='rejected' where id in ('${app(4)}','${app(6)}');
insert into public.contractors(id,name,is_active,marketing_enabled) values('${rejectedProvider}','Synthetic retention race provider',false,false);
update public.vendor_applications set contractor_id='${rejectedProvider}' where id='${app(5)}';
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select '${rejectedProvider}',id,2,'rejected' from public.vendor_application_versions where application_id='${app(5)}';
insert into public.vendor_onboarding_events(contractor_id,revision,action,before_status,after_status,actor,reason,business_key,created_at)
 values('${rejectedProvider}',2,'reject','review','rejected','${operator}','Synthetic onboarding rejection','app-retention-race-reject',now()-interval '100 days');
commit;`);
const before = await sql(`select md5(concat_ws('|',(select count(*) from public.vendor_application_versions where application_id::text like 'd8600000-%'),
 (select count(*) from public.vendor_compliance_evidence),(select status||revision from public.vendor_onboarding where contractor_id='${rejectedProvider}')))`);

// 1. Eight concurrent closures of one application under the same key: one recorder.
const same = await Promise.all(Array.from({ length: 8 }, () => close(operator, 1, "app-retention-race-same")));
assert.ok(same.every((result) => result.ok), "Same-key closures all succeed: " + messages(same));
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records");

// 2. Eight concurrent closures with distinct keys across two operators: one wins.
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => close(index % 2 ? operatorTwo : operator, 2, `app-retention-race-distinct-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one distinct-key closure succeeds");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Application is already closed")),
  "Every loser is refused as already closed: " + messages(distinct),
);

// 3. Closures racing onboarding start on one application: either the closure wins and every
// start is refused, or a start wins and every closure is refused.
const version = await sql(`select id from public.vendor_application_versions where application_id='${app(3)}'`);
const race = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? close(operator, 3, `app-retention-race-start-close-${index}`).then((result) => ({ ...result, action: "close" }))
      : settle(as(operatorTwo, `select public.vendor_start_onboarding_review('${app(3)}','${version}','Synthetic start race','app-retention-race-start-${index}');`))
          .then((result) => ({ ...result, action: "start" })),
  ),
);
const closes = race.filter((result) => result.action === "close");
const starts = race.filter((result) => result.action === "start");
const closeWon = closes.some((result) => result.ok);
if (closeWon) {
  assert.equal(closes.filter((result) => result.ok).length, 1, "Exactly one closure succeeds");
  assert.ok(
    race.every((result) => result.ok || result.message.includes("Closed application cannot start onboarding") || result.message.includes("Application is already closed")),
    "With the closure first, every start is refused: " + messages(race),
  );
} else {
  assert.ok(starts.every((result) => result.ok), "Every start reports the one review: " + messages(starts));
  assert.equal(starts.filter((result) => result.value.created).length, 1, "Exactly one start creates it");
  assert.equal(await sql(`select count(*) from public.vendor_onboarding_review_starts where application_id='${app(3)}'`), "1", "Exactly one review starts");
  assert.ok(
    closes.every((result) => !result.ok && result.message.includes("has a provider record")),
    "With the start first, every closure is refused: " + messages(race),
  );
}
assert.equal(
  await sql(`select (select count(*) from public.vendor_application_closures where application_id='${app(3)}')+(select count(*) from public.vendor_onboarding_review_starts where application_id='${app(3)}')`),
  "1",
  "Either a closure or a review start, never both",
);

// 4. Eight concurrent records of one quarantine under the same key: one row.
await quarantineFile(4);
const sameRecord = await Promise.all(Array.from({ length: 8 }, () => record(operator, 4, "app-retention-race-record-same")));
assert.ok(sameRecord.every((result) => result.ok), "Same-key records all succeed: " + messages(sameRecord));
assert.equal(sameRecord.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records");

// 5. Application holds racing a quarantine record: one hold and one quarantine.
await quarantineFile(6);
const mixed = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? record(index % 4 === 1 ? operator : operatorTwo, 6, `app-retention-race-mixed-${index}`).then((result) => ({ ...result, action: "record" }))
      : settle(as(operatorTwo, `select public.vendor_place_application_retention_hold('${app(6)}','Synthetic race hold','app-retention-race-hold-${index}');`))
          .then((result) => ({ ...result, action: "hold" })),
  ),
);
assert.equal(mixed.filter((result) => result.ok && result.action === "hold").length, 1, "Exactly one application hold is placed");
assert.equal(mixed.filter((result) => result.ok && result.action === "record").length, 1, "Exactly one quarantine is recorded");
assert.ok(
  mixed.every((result) => result.ok || result.message.includes("already on a retention hold") || result.message.includes("already quarantined")),
  "Every loser is refused as held or quarantined: " + messages(mixed),
);
// Both take the application lock and record reads the hold after it, so under_hold follows
// the serialised order; suite 051 asserts its value deterministically.
const appUnderHold = await sql(`select under_hold::text from public.vendor_application_retention_actions where storage_path='${path(6)}'`);
assert.ok(["true", "false"].includes(appUnderHold), "The recorded quarantine carries under_hold");

// 6. Provider holds racing a record of the rejected provider's application file: the record
// takes the provider's onboarding lock, so one hold and one quarantine.
await quarantineFile(5);
const provider = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    index % 2
      ? record(operator, 5, `app-retention-race-provider-${index}`).then((result) => ({ ...result, action: "record" }))
      : settle(as(operatorTwo, `select public.vendor_place_retention_hold('${rejectedProvider}','Synthetic provider race hold','app-retention-race-provider-hold-${index}');`))
          .then((result) => ({ ...result, action: "hold" })),
  ),
);
assert.equal(provider.filter((result) => result.ok && result.action === "hold").length, 1, "Exactly one provider hold is placed");
assert.equal(provider.filter((result) => result.ok && result.action === "record").length, 1, "Exactly one quarantine is recorded");
assert.ok(
  provider.every((result) => result.ok || result.message.includes("already on a retention hold") || result.message.includes("already quarantined")),
  "Every loser is refused as held or quarantined: " + messages(provider),
);
const providerUnderHold = await sql(`select under_hold::text from public.vendor_application_retention_actions where storage_path='${path(5)}'`);

// 7. With the hold in force, eight concurrent deletion prepares of a quarantined file are
// all refused and write nothing.
await sql(`insert into public.vendor_application_retention_actions(application_id,storage_path,action,size_bytes,reason,under_hold,business_key,actor,created_at)
 values('${app(6)}','${path(6)}','restored',null,'Synthetic fixture',true,'app-retention-race-restore','${operator}',now()-interval '30 days'),
       ('${app(6)}','${path(6)}','quarantined',2048,'Synthetic fixture',true,'app-retention-race-requarantine','${operator}',now()-interval '20 days');`);
const prepared = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    settle(as(operator, `select public.vendor_application_retention_prepare('${app(6)}','${path(6)}','deleted','Synthetic retention race','app-retention-race-held-${index}');`)),
  ),
);
assert.ok(
  prepared.every((result) => !result.ok && result.message.includes("This application is on a retention hold")),
  "Every deletion prepare under hold is refused: " + messages(prepared),
);

assert.equal(
  await sql(`select count(*) from public.vendor_application_retention_actions where storage_path in ('${path(4)}','${path(5)}','${path(6)}')`),
  "5",
  "Three quarantines and the two synthetic fixture rows in total",
);
assert.equal(
  await sql(`select md5(concat_ws('|',(select count(*) from public.vendor_application_versions where application_id::text like 'd8600000-%'),
 (select count(*) from public.vendor_compliance_evidence),(select status||revision from public.vendor_onboarding where contractor_id='${rejectedProvider}')))`),
  before,
  "No application version, evidence, onboarding status or revision changed",
);
console.log(
  `PASS: same-key closures record once, distinct-key closures across two operators close once, closure versus onboarding start yields exactly one (${closeWon ? "closure" : "start"} won), same-key records write once, application-hold and provider-hold races each yield one hold and one quarantine (under_hold=${appUnderHold}/${providerUnderHold}), and deletion prepares under hold are all refused. Reset synthetic fixtures afterward.`,
);
