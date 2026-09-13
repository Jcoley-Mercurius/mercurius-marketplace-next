// Synthetic-only concurrency proof for TRACE-070; reset the isolated database afterward.
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
const actor = "cc000000-0000-4000-8000-000000000001";
const providers = {
  distinct: ["cc000000-0000-4000-8000-000000000011", "cc000000-0000-4000-8000-000000000021", "cc000000-0000-4000-8000-000000000002", "bind-race-distinct@example.invalid"],
  same: ["cc000000-0000-4000-8000-000000000012", "cc000000-0000-4000-8000-000000000022", "cc000000-0000-4000-8000-000000000003", "bind-race-same@example.invalid"],
  paths: ["cc000000-0000-4000-8000-000000000013", "cc000000-0000-4000-8000-000000000023", "cc000000-0000-4000-8000-000000000004", "bind-race-paths@example.invalid"],
};
const claims = (sub) =>
  `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${sub}"}',true); end $$;`;
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values ('${actor}','bind-race-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values('${actor}','admin');
${Object.values(providers)
  .map(
    ([contractor, application, recipient, email]) => `
insert into auth.users(id,email,email_confirmed_at,invited_at) values ('${recipient}','${email}',now(),now());
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values ('${contractor}','Synthetic bind race',false,false,null);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
 values ('${application}','Synthetic bind race','Test','Race','${email}','synthetic','${contractor}');`,
  )
  .join("\n")}
commit;`);
// Each provider gets a committed acceptance receipt written by the real TRACE-063
// commands, so the races below start from the state an operator would review.
const attempts = {};
for (const [name, [contractor, application, recipient]] of Object.entries(providers)) {
  const version = await sql(
    `select id from public.vendor_application_versions where application_id='${application}' order by revision desc limit 1`,
  );
  attempts[name] = await sql(`begin;
${claims(actor)}
set local role authenticated;
select public.vendor_begin_review('${contractor}','${version}');
reset role;
create temp table race_attempt on commit drop as
 select public.vendor_prepare_invitation('${contractor}','bind-race-invite-${name}',now()+interval '1 day') as id;
select public.vendor_claim_invitation(id) from race_attempt;
update auth.users set invited_at=clock_timestamp() where id='${recipient}';
select public.vendor_finish_invitation(id,'${recipient}') from race_attempt;
${claims(recipient)}
select public.vendor_accept_invitation(id) from race_attempt;
select id from race_attempt;
commit;`).then((output) => output.split("\n").at(-1));
}
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value: JSON.parse(value) }),
    (error) => ({ ok: false, message: String(error.message).trim() }),
  );
const bind = (name, key) =>
  settle(
    sql(
      `begin; ${claims(actor)} set local role authenticated; select public.vendor_bind_invited_account('${providers[name][0]}',1,'${attempts[name]}','Synthetic concurrent binding','${key}'); commit;`,
    ),
  );
const link = (name, key) =>
  settle(
    sql(
      `begin; ${claims(actor)} set local role authenticated; select public.vendor_link_existing_account('${providers[name][0]}',1,'${providers[name][2]}','Synthetic concurrent link','${key}'); commit;`,
    ),
  );
const rows = (name) =>
  sql(`select concat_ws(',',
 (select count(*) from public.vendor_account_link_decisions where contractor_id='${providers[name][0]}'),
 (select count(*) from public.vendor_onboarding_events where contractor_id='${providers[name][0]}' and action in ('account_linked','invited_account_bound')),
 (select revision from public.vendor_onboarding where contractor_id='${providers[name][0]}'),
 (select coalesce(user_id::text,'-') from public.contractors where id='${providers[name][0]}'))`);

// One provider, eight distinct keys: the losers see a stale revision, not a partial write.
const distinct = await Promise.all(
  Array.from({ length: 8 }, (_, index) => bind("distinct", `bind-race-${index}`)),
);
assert.equal(distinct.filter((result) => result.ok).length, 1, "Exactly one different-key binding records");
assert.ok(
  distinct.every((result) => result.ok || result.message.includes("Stale onboarding revision")),
  "Every loser is refused for a stale onboarding revision: " +
    distinct.map((result) => (result.ok ? "ok" : result.message)).join(" | "),
);
assert.equal(await rows("distinct"), `1,1,2,${providers.distinct[2]}`, "One decision, one event, one revision step, one binding");

// One provider, one key: every caller receives the identical recorded decision.
const same = await Promise.all(Array.from({ length: 8 }, () => bind("same", "bind-race-same-key")));
assert.ok(same.every((result) => result.ok), "Same-key callers all succeed");
assert.equal(same.filter((result) => result.value.recorded).length, 1, "Exactly one same-key caller records; the rest replay");
assert.equal(
  new Set(same.map((result) => JSON.stringify({ ...result.value, recorded: null }))).size,
  1,
  "Same-key callers agree on the recorded decision",
);
assert.equal(await rows("same"), `1,1,2,${providers.same[2]}`, "A same-key race leaves one set of rows");

// The two binding paths race for one provider and the same account. Both lock the
// onboarding row at the same revision, so exactly one decision may be recorded.
const paths = await Promise.all([
  ...Array.from({ length: 4 }, (_, index) => bind("paths", `bind-race-paths-bind-${index}`)),
  ...Array.from({ length: 4 }, (_, index) => link("paths", `bind-race-paths-link-${index}`)),
]);
assert.equal(paths.filter((result) => result.ok).length, 1, "Exactly one of the two binding paths records");
assert.ok(
  paths.every((result) => result.ok || result.message.includes("Stale onboarding revision")),
  "The losing path is refused for a stale revision: " +
    paths.map((result) => (result.ok ? "ok" : result.message)).join(" | "),
);
assert.equal(await rows("paths"), `1,1,2,${providers.paths[2]}`, "Racing paths leave one decision and one binding");
const winner = paths.findIndex((result) => result.ok) < 4 ? "accepted_invitation" : "stated_identity";
assert.equal(
  await sql(`select case when invitation_attempt_id is null then 'stated_identity' else 'accepted_invitation' end
 from public.vendor_account_link_decisions where contractor_id='${providers.paths[0]}'`),
  winner,
  "The recorded decision is the winning path's",
);

assert.equal(
  await sql(`select count(*) from public.user_roles u join public.contractors c on c.user_id=u.user_id
 where c.name='Synthetic bind race' and u.role='vendor'`),
  "0",
  "No race outcome granted a vendor role",
);
assert.equal(
  await sql(`select count(*) from public.contractors where name='Synthetic bind race' and (is_active is not false or marketing_enabled)`),
  "0",
  "Raced providers remain inactive and unlisted",
);
console.log(
  `PASS: eight different-key and eight same-key concurrent invitation bindings each bind the accepted account once, and the two binding paths racing one provider record one decision (winner: ${winner}). Reset synthetic fixtures afterward.`,
);
