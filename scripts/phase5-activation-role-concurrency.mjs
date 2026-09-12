// Synthetic-only concurrency proof for TRACE-068; reset the isolated database afterward.
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
const actor = "ca000000-0000-4000-8000-000000000001";
const identityA = "ca000000-0000-4000-8000-000000000002";
const identityB = "ca000000-0000-4000-8000-000000000003";
const identityC = "ca000000-0000-4000-8000-000000000004";
const providerA = "ca000000-0000-4000-8000-000000000011";
const providerB = "ca000000-0000-4000-8000-000000000012";
const providerC = "ca000000-0000-4000-8000-000000000013";
const applicationA = "ca000000-0000-4000-8000-000000000021";
const applicationB = "ca000000-0000-4000-8000-000000000022";
const applicationC = "ca000000-0000-4000-8000-000000000023";
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
const asOperator = (body) =>
  sql(`begin; ${claims} set local role authenticated; ${body} commit;`);
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${actor}','role-race-operator@example.invalid',now()),
 ('${identityA}','role-race-a@example.invalid',now()),
 ('${identityB}','role-race-b@example.invalid',now()),
 ('${identityC}','role-race-c@example.invalid',now());
insert into public.user_roles(user_id,role) values('${actor}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('${providerA}','Synthetic role race A',false,false,null),
 ('${providerB}','Synthetic role race B',false,false,null),
 ('${providerC}','Synthetic role race C',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('${applicationA}','Synthetic role race A','Test','Race','role-race-a@example.invalid','synthetic','${providerA}'),
 ('${applicationB}','Synthetic role race B','Test','Race','role-race-b@example.invalid','synthetic','${providerB}'),
 ('${applicationC}','Synthetic role race C','Test','Race','role-race-c@example.invalid','synthetic','${providerC}');
commit;`);
for (const [contractor, application, identity] of [
  [providerA, applicationA, identityA],
  [providerB, applicationB, identityB],
  [providerC, applicationC, identityC],
]) {
  const version = await sql(
    `select id from public.vendor_application_versions where application_id='${application}' order by revision desc limit 1`,
  );
  await asOperator(`select public.vendor_begin_review('${contractor}','${version}');
select public.vendor_link_existing_account('${contractor}',1,'${identity}','Synthetic race link','role-race-link-${contractor}');
select public.vendor_record_evidence('${contractor}',kind,'synthetic-rule','private-synthetic-'||kind,now()-interval '1 hour',now()+interval '1 year')
 from unnest(array['identity','agreement','coverage','license','insurance','bank_authorization','profile_pricing','availability','test_notification']) kind;`);
}
const decide = (contractor, revision, action, key) =>
  asOperator(
    `select public.vendor_decide_onboarding('${contractor}',${revision},'${action}','Synthetic concurrent ${action}','${key}');`,
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const release = (contractor, revision, key) =>
  asOperator(
    `select public.vendor_release_linked_account('${contractor}',${revision},'Synthetic concurrent release','${key}');`,
  ).then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const revision = (contractor) =>
  sql(`select revision from public.vendor_onboarding where contractor_id='${contractor}'`);
const vendorRoles = (identity) =>
  sql(`select count(*) from public.user_roles where user_id='${identity}' and role='vendor'`);
const grants = (contractor) =>
  sql(`select coalesce(string_agg(outcome,',' order by id),'-') from public.vendor_role_decisions where contractor_id='${contractor}'`);

// One provider, eight distinct activation keys: one grant, losers see a stale revision.
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => decide(providerA, 2, "activate", `role-race-activate-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one different-key activation records");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Stale onboarding revision")),
  "Every losing activation is refused for a stale onboarding revision",
);
assert.equal(await grants(providerA), "granted", "One activation records one grant decision");
assert.equal(await vendorRoles(identityA), "1", "The reviewed account holds exactly one vendor role");

// One provider, one key: every caller receives the same revision and one grant is recorded.
const same = await Promise.all(
  Array.from({ length: 8 }, () => decide(providerB, 2, "activate", "role-race-activate-shared")),
);
assert.ok(same.every((result) => result.ok), "Same-key activations all succeed");
assert.equal(new Set(same.map((result) => result.value)).size, 1, "Same-key callers agree on the revision");
assert.equal(await grants(providerB), "granted", "A same-key race records one grant decision");
assert.equal(await vendorRoles(identityB), "1", "A same-key race grants one vendor role");

// Reactivation racing a release of the same suspended provider. Both lock the
// onboarding row, so exactly one order happens, and the role must match it: either
// the release lands first and activation finds no account, or activation lands
// first and the release is refused because the provider is live.
await decide(providerC, 2, "activate", "role-race-c-activate");
await decide(providerC, 3, "suspend", "role-race-c-suspend");
const suspended = await revision(providerC);
const [reactivated, released] = await Promise.all([
  decide(providerC, suspended, "activate", "role-race-c-reactivate"),
  release(providerC, suspended, "role-race-c-release"),
]);
assert.equal(
  [reactivated, released].filter((result) => result.ok).length,
  1,
  "Exactly one of reactivation and release applies: " +
    [reactivated, released].map((result) => (result.ok ? "ok" : result.message)).join(" | "),
);
assert.ok(
  [reactivated, released].every((result) => result.ok || result.message.includes("Stale onboarding revision")),
  "The loser is refused for a stale revision, not left half-written",
);
if (released.ok) {
  assert.equal(await grants(providerC), "granted,revoked", "Release withdrew the activation grant");
  assert.equal(await vendorRoles(identityC), "0", "A released provider's account holds no vendor role");
} else {
  assert.equal(await grants(providerC), "granted,already_held", "Reactivation kept the activation grant");
  assert.equal(await vendorRoles(identityC), "1", "A reactivated provider's account keeps one vendor role");
}
assert.equal(
  await sql(`select count(*) from public.contractors
 where name like 'Synthetic role race%' and (is_active is not false or marketing_enabled)`),
  "0",
  "Raced providers' contractor records remain inactive and unlisted",
);
console.log(
  `PASS: eight different-key and eight same-key concurrent activations each grant one vendor role once, and a reactivation racing a release resolves to one consistent role state (${released.ok ? "release" : "reactivation"} won). Reset synthetic fixtures afterward.`,
);
