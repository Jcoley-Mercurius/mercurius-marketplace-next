// Synthetic-only concurrency proof for TRACE-065; reset the isolated database afterward.
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
const actor = "d9000000-0000-4000-8000-000000000001";
const differentKeys = "d9000000-0000-4000-8000-000000000002";
const sameKey = "d9000000-0000-4000-8000-000000000003";
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email) values('${actor}','intake-race-operator@example.invalid');
insert into public.user_roles(user_id,role) values('${actor}','admin');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone) values
 ('${differentKeys}','Synthetic different-key race','Test','Race','intake-race-a@example.invalid','synthetic'),
 ('${sameKey}','Synthetic same-key race','Test','Race','intake-race-b@example.invalid','synthetic');
commit;`);
// Operators receive the expected version from readback; resolve it before switching role.
const versions = Object.fromEntries(
  await Promise.all(
    [differentKeys, sameKey].map(async (application) => [
      application,
      await sql(`select id from public.vendor_application_versions where application_id='${application}' order by revision desc limit 1`),
    ]),
  ),
);
const start = (application, key) =>
  sql(
    `begin; ${claims} set local role authenticated; select public.vendor_start_onboarding_review('${application}','${versions[application]}','Synthetic concurrent review','${key}'); commit;`,
  ).then(JSON.parse);
const rows = (application) =>
  sql(`select concat_ws(',',
 (select count(*) from public.contractors c join public.vendor_applications a on a.contractor_id=c.id where a.id='${application}'),
 (select count(*) from public.vendor_onboarding o join public.vendor_applications a on a.contractor_id=o.contractor_id where a.id='${application}'),
 (select count(*) from public.vendor_onboarding_events e join public.vendor_applications a on a.contractor_id=e.contractor_id
   where a.id='${application}' and e.revision=1 and e.action='review_started'),
 (select count(*) from public.vendor_onboarding_events e join public.vendor_applications a on a.contractor_id=e.contractor_id where a.id='${application}'),
 (select count(*) from public.vendor_onboarding_review_starts where application_id='${application}'),
 (select count(*) from public.contractors where name like 'Synthetic %-key race'))`);

const different = await Promise.all(
  Array.from({ length: 8 }, (_, index) => start(differentKeys, `intake-race-${index}`)),
);
assert.equal(different.filter((result) => result.created).length, 1, "Exactly one different-key start creates");
assert.equal(new Set(different.map((result) => result.contractor_id)).size, 1, "Every caller reports the same contractor");
assert.ok(different.every((result) => result.onboarding_status === "review" && result.onboarding_revision === 1));
assert.equal(await rows(differentKeys), "1,1,1,1,1,1", "One contractor, link, onboarding row, event and request");

const same = await Promise.all(
  Array.from({ length: 8 }, () => start(sameKey, "intake-race-shared")),
);
assert.ok(same.every((result) => JSON.stringify(result) === JSON.stringify(same[0])), "Same-key callers receive the identical result");
assert.equal(same[0].created, true, "Same-key result is the original creation");
assert.notEqual(same[0].contractor_id, different[0].contractor_id);
assert.equal(await rows(sameKey), "1,1,1,1,1,2", "Same-key race leaves one set of rows");
assert.equal(
  await sql(`select count(*) from public.contractors where name like 'Synthetic %-key race' and (is_active is not false or marketing_enabled or user_id is not null)`),
  "0",
  "Raced contractors remain hidden and account-less",
);
console.log(
  "PASS: eight different-key and eight same-key concurrent starts each produce one hidden contractor, link, onboarding row, revision-1 event and request. Reset synthetic fixtures afterward.",
);
