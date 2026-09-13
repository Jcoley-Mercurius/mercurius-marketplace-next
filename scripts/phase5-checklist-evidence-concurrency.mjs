// Synthetic-only concurrency proof for TRACE-069; reset the isolated database afterward.
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
const actor = "cb000000-0000-4000-8000-000000000001";
const providerA = "cb000000-0000-4000-8000-000000000011";
const providerB = "cb000000-0000-4000-8000-000000000012";
const applicationA = "cb000000-0000-4000-8000-000000000021";
const applicationB = "cb000000-0000-4000-8000-000000000022";
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
const asOperator = (body) =>
  sql(`begin; ${claims} set local role authenticated; ${body} commit;`);
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values ('${actor}','checklist-race-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values('${actor}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('${providerA}','Synthetic checklist race A',false,false,null),
 ('${providerB}','Synthetic checklist race B',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('${applicationA}','Synthetic checklist race A','Test','Race','checklist-race-a@example.invalid','synthetic','${providerA}',array['synthetic/race-a/license.pdf']),
 ('${applicationB}','Synthetic checklist race B','Test','Race','checklist-race-b@example.invalid','synthetic','${providerB}',array[]::text[]);
commit;`);
for (const [contractor, application] of [
  [providerA, applicationA],
  [providerB, applicationB],
]) {
  const version = await sql(
    `select id from public.vendor_application_versions where application_id='${application}' order by revision desc limit 1`,
  );
  await asOperator(`select public.vendor_begin_review('${contractor}','${version}');`);
}
const accepted = new Date(Date.now() - 60_000).toISOString();
const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
const record = (contractor, kind, reference, key, expiry = null) =>
  asOperator(
    `select public.vendor_record_checklist_evidence('${contractor}','${kind}','synthetic-rule-v1','${reference}','${accepted}',${expiry ? `'${expiry}'` : "null"},null,'${key}');`,
  ).then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const rows = (contractor, kind) =>
  sql(`select concat_ws(',',
 (select count(*) from public.vendor_compliance_evidence where contractor_id='${contractor}' and kind='${kind}'),
 (select count(*) from public.vendor_checklist_evidence_requests where contractor_id='${contractor}' and kind='${kind}'))`);

// One item, eight distinct keys, all naming no prior evidence: the kernel's
// stale-version guard lets exactly one record and refuses the rest.
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    record(providerA, "license", "synthetic/race-a/license.pdf", `checklist-race-${index}`, expires),
  ),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one different-key record succeeds");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Stale evidence version")),
  "Every loser is refused for a stale evidence version: " +
    distinct.map((result) => (result.ok ? "ok" : result.message)).join(" | "),
);
assert.equal(await rows(providerA, "license"), "1,1", "One evidence row and one request");

// One item, one key: every caller receives the same evidence and one row is written.
const same = await Promise.all(
  Array.from({ length: 8 }, () => record(providerB, "agreement", "Synthetic agreement reference", "checklist-race-shared")),
);
assert.ok(same.every((result) => result.ok), "Same-key callers all succeed");
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records");
assert.equal(
  new Set(same.map((result) => result.value.evidence_id)).size,
  1,
  "Same-key callers agree on the recorded evidence",
);
assert.equal(await rows(providerB, "agreement"), "1,1", "A same-key race leaves one set of rows");
assert.equal(
  await sql(`select count(*) from public.vendor_onboarding
 where contractor_id in ('${providerA}','${providerB}') and (status<>'review' or revision<>1)`),
  "0",
  "Recording evidence changed no onboarding status or revision",
);
console.log(
  "PASS: eight different-key and eight same-key concurrent checklist records each write one evidence row once, with no onboarding decision. Reset synthetic fixtures afterward.",
);
