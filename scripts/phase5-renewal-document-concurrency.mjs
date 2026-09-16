// Synthetic-only concurrency proof for TRACE-073; reset the isolated database afterward.
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
const operator = "d7300000-0000-4000-8000-000000000001";
const vendor = "d7300000-0000-4000-8000-000000000002";
const provider = "d7300000-0000-4000-8000-000000000011";
const application = "d7300000-0000-4000-8000-000000000021";
const as = (user, body) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}"}',true); end $$;
 set local role authenticated; ${body} commit;`);
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const path = (kind, n) =>
  `renewals/${provider}/${kind}/d7400000-0000-4000-8000-${String(n).padStart(12, "0")}-renewed-${kind}.pdf`;
const objects = (paths) =>
  sql(`insert into storage.objects(bucket_id,name,metadata) values ${paths
    .map((name) => `('vendor-documents','${name}','{"size":2048,"mimetype":"application/pdf"}')`)
    .join(",")};`);

assert.equal(
  await sql(`select count(*) from auth.users where id in ('${operator}','${vendor}')`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${operator}','renewal-race-operator@example.invalid',now()),('${vendor}','renewal-race-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values('${operator}','admin'),('${vendor}','vendor');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('${provider}','Synthetic renewal race provider',true,false,'${vendor}');
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id,document_urls) values
 ('${application}','Synthetic renewal race provider','Test','Race','renewal-race@example.invalid','synthetic','${provider}',array['synthetic/renewal-race/license.pdf']);
insert into public.vendor_onboarding(contractor_id,application_version_id,revision,status)
 select '${provider}',id,2,'active' from public.vendor_application_versions where application_id='${application}';
insert into public.vendor_compliance_evidence(contractor_id,application_version_id,kind,requirement_version,evidence_ref,accepted_at,expires_at,reviewed_by)
 select o.contractor_id,o.application_version_id,k,k||'-v1',
   case when k in ('license','insurance') then 'synthetic/renewal-race/license.pdf' else 'Synthetic '||k end,
   now()-interval '300 days',case when k in ('license','insurance') then now()+interval '10 days' end,'${operator}'
 from public.vendor_onboarding o
 cross join unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) k
 where o.contractor_id='${provider}';
commit;`);

// One path, eight concurrent submissions by the same vendor: one row, one recorder.
await objects([path("license", 1)]);
const same = await Promise.all(
  Array.from({ length: 8 }, () =>
    settle(as(vendor, `select public.vendor_submit_renewal_document('${path("license", 1)}');`)),
  ),
);
assert.ok(same.every((result) => result.ok), "Same-path submissions all succeed: " + same.map((r) => r.message ?? "ok").join(" | "));
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-path caller records");
assert.equal(new Set(same.map((result) => result.value.document_id)).size, 1, "Same-path callers agree on the submission");

// Eight different insurance paths against the five-submission open limit.
const insurancePaths = Array.from({ length: 8 }, (_, index) => path("insurance", 10 + index));
await objects(insurancePaths);
const limited = await Promise.all(
  insurancePaths.map((name) => settle(as(vendor, `select public.vendor_submit_renewal_document('${name}');`))),
);
assert.equal(limited.filter((result) => result.ok).length, 5, "Exactly five different-path submissions succeed");
assert.ok(
  limited.every((result) => result.ok || result.message.includes("Too many renewal documents are awaiting review")),
  "Every loser is refused by the open limit: " + limited.map((r) => (r.ok ? "ok" : r.message)).join(" | "),
);
assert.equal(
  await sql(`select count(*) from public.vendor_renewal_documents where contractor_id='${provider}' and kind='insurance'`),
  "5",
  "Five insurance submissions are stored",
);

// Accept and decline race on the license submission: four acceptances with distinct keys
// and four declines with distinct keys. Exactly one decision wins.
const documentId = same[0].value.document_id;
const currentLicense = await sql(
  `select e.id from public.vendor_compliance_evidence e where e.contractor_id='${provider}' and e.kind='license'
   and not exists(select 1 from public.vendor_compliance_evidence n where n.supersedes=e.id)`,
);
const accepted = new Date(Date.now() - 60_000).toISOString();
const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
const decisions = await Promise.all(
  Array.from({ length: 8 }, (_, index) =>
    settle(
      as(
        operator,
        index % 2 === 0
          ? `select public.vendor_record_checklist_evidence('${provider}','license','license-v2','${path("license", 1)}','${accepted}','${expires}','${currentLicense}','renewal-race-accept-${index}');`
          : `select public.vendor_decline_renewal_document('${documentId}','Synthetic race decline ${index}','renewal-race-decline-${index}');`,
      ),
    ).then((result) => ({ ...result, action: index % 2 === 0 ? "accept" : "decline" })),
  ),
);
assert.equal(decisions.filter((result) => result.ok).length, 1, "Exactly one accept-or-decline succeeds");
assert.ok(
  decisions.every(
    (result) =>
      result.ok ||
      result.message.includes("Renewal document already decided") ||
      result.message.includes("Stale evidence version"),
  ),
  "Every loser is refused as decided or stale: " + decisions.map((r) => (r.ok ? `${r.action} ok` : r.message)).join(" | "),
);
const winner = decisions.find((result) => result.ok).action;
assert.equal(
  await sql(`select concat_ws(',',
 (select count(*) from public.vendor_renewal_document_decisions where document_id='${documentId}'),
 (select count(*) from public.vendor_compliance_evidence where contractor_id='${provider}' and kind='license'),
 (select count(*) from public.vendor_checklist_evidence_requests where contractor_id='${provider}'))`),
  winner === "accept" ? "1,2,1" : "1,1,0",
  `One decision and matching evidence rows after the ${winner} won`,
);
assert.equal(
  await sql(`select status||':'||revision from public.vendor_onboarding where contractor_id='${provider}'`),
  "active:2",
  "No submission or decision changed onboarding status or revision",
);
assert.equal(
  await sql(`select count(*) from public.vendor_application_versions where application_id='${application}'`),
  "1",
  "No application version was created",
);
console.log(
  `PASS: eight same-path submissions record once, eight different paths stop at the five-submission limit, and an eight-way accept/decline race records one ${winner} with no onboarding change. Reset synthetic fixtures afterward.`,
);
