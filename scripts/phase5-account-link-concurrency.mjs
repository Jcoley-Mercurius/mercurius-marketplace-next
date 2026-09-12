// Synthetic-only concurrency proof for TRACE-067; reset the isolated database afterward.
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
const actor = "c9000000-0000-4000-8000-000000000001";
const identity = "c9000000-0000-4000-8000-000000000002";
const shared = "c9000000-0000-4000-8000-000000000003";
const providerA = "c9000000-0000-4000-8000-000000000011";
const providerB = "c9000000-0000-4000-8000-000000000012";
const providerC = "c9000000-0000-4000-8000-000000000013";
const applicationA = "c9000000-0000-4000-8000-000000000021";
const applicationB = "c9000000-0000-4000-8000-000000000022";
const applicationC = "c9000000-0000-4000-8000-000000000023";
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
// providerA and providerB share one reviewed recipient address, so the only thing
// separating them under a race is the database's own invariant.
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('${actor}','link-race-operator@example.invalid',now()),
 ('${identity}','link-race-identity@example.invalid',now()),
 ('${shared}','link-race-shared@example.invalid',now());
insert into public.user_roles(user_id,role) values('${actor}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('${providerA}','Synthetic link race A',false,false,null),
 ('${providerB}','Synthetic link race B',false,false,null),
 ('${providerC}','Synthetic link race C',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id) values
 ('${applicationA}','Synthetic link race A','Test','Race','link-race-identity@example.invalid','synthetic','${providerA}'),
 ('${applicationB}','Synthetic link race B','Test','Race','link-race-shared@example.invalid','synthetic','${providerB}'),
 ('${applicationC}','Synthetic link race C','Test','Race','link-race-shared@example.invalid','synthetic','${providerC}');
commit;`);
for (const [contractor, application] of [
  [providerA, applicationA],
  [providerB, applicationB],
  [providerC, applicationC],
]) {
  const version = await sql(
    `select id from public.vendor_application_versions where application_id='${application}' order by revision desc limit 1`,
  );
  await sql(
    `begin; ${claims} set local role authenticated; select public.vendor_begin_review('${contractor}','${version}'); commit;`,
  );
}
const link = (contractor, user, key, revision = 1) =>
  sql(
    `begin; ${claims} set local role authenticated; select public.vendor_link_existing_account('${contractor}',${revision},'${user}','Synthetic concurrent link','${key}'); commit;`,
  ).then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const rows = (contractor) =>
  sql(`select concat_ws(',',
 (select count(*) from public.vendor_account_link_decisions where contractor_id='${contractor}'),
 (select count(*) from public.vendor_onboarding_events where contractor_id='${contractor}' and action='account_linked'),
 (select coalesce(max(revision)::text,'-') from public.vendor_onboarding where contractor_id='${contractor}'),
 (select coalesce(user_id::text,'-') from public.contractors where id='${contractor}'))`);

// One provider, eight distinct keys: the losers see a stale revision, not a partial write.
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => link(providerA, identity, `link-race-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one different-key link records");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Stale onboarding revision")),
  "Every loser is refused for a stale onboarding revision",
);
assert.equal(await rows(providerA), `1,1,2,${identity}`, "One decision, one event, one revision step, one binding");

// One provider, one key: every caller receives the identical recorded decision.
const same = await Promise.all(
  Array.from({ length: 8 }, () => link(providerC, shared, "link-race-shared-key")),
);
assert.ok(same.every((result) => result.ok), "Same-key callers all succeed");
assert.equal(
  same.filter((result) => result.value.recorded).length,
  1,
  "Exactly one same-key caller records; the rest replay",
);
assert.equal(
  new Set(same.map((result) => JSON.stringify({ ...result.value, recorded: null }))).size,
  1,
  "Same-key callers agree on the recorded decision",
);
assert.equal(await rows(providerC), `1,1,2,${shared}`, "A same-key race leaves one set of rows");

// Two providers, one identity: they lock different rows, so only the database's
// partial unique index can decide. The loser must be refused, not left half-written.
await sql(`begin;
${claims}
set local role authenticated;
select public.vendor_release_linked_account('${providerC}',2,'Synthetic release for the cross-provider race','link-race-release');
commit;`);
// Each caller starts from the revision the operator would have just read back.
const revisions = Object.fromEntries(
  await Promise.all(
    [providerB, providerC].map(async (contractor) => [
      contractor,
      await sql(`select revision from public.vendor_onboarding where contractor_id='${contractor}'`),
    ]),
  ),
);
const crossed = await Promise.all([
  link(providerB, shared, "link-race-cross-b", revisions[providerB]),
  link(providerC, shared, "link-race-cross-c", revisions[providerC]),
]);
assert.equal(crossed.filter((result) => result.ok).length, 1, "Exactly one provider binds the shared identity");
assert.ok(
  crossed.every(
    (result) => result.ok || result.message.includes("Account already linked to another provider"),
  ),
  "The losing provider is told the account is already linked, not a raw constraint name: " +
    crossed.map((result) => (result.ok ? "ok" : result.message)).join(" | "),
);
assert.equal(
  await sql(`select count(*) from public.contractors where user_id='${shared}'`),
  "1",
  "The shared identity is bound to exactly one provider",
);
assert.equal(
  await sql(`select count(*) from public.vendor_account_link_decisions
 where auth_user_id='${shared}' and action='link'`),
  "2",
  "Only the successful links are recorded, and the released one is retained",
);
assert.equal(
  await sql(`select count(*) from public.user_roles u join public.contractors c on c.user_id=u.user_id
 where c.name like 'Synthetic link race%' and u.role='vendor'`),
  "0",
  "No race outcome granted a vendor role",
);
assert.equal(
  await sql(`select count(*) from public.contractors
 where name like 'Synthetic link race%' and (is_active is not false or marketing_enabled)`),
  "0",
  "Raced providers remain inactive and unlisted",
);
console.log(
  "PASS: eight different-key and eight same-key concurrent links each bind one identity once, and two providers racing one identity produce exactly one binding. Reset synthetic fixtures afterward.",
);
