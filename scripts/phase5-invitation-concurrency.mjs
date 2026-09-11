// Synthetic-only concurrency proof; reset the isolated database afterward.
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
const actor = "d8000000-0000-4000-8000-000000000001";
const contractor = "d8000000-0000-4000-8000-000000000002";
const application = "d8000000-0000-4000-8000-000000000003";
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
const attempt = await sql(`begin;
insert into auth.users(id,email) values('${actor}','race-operator@example.invalid');
insert into public.user_roles(user_id,role) values('${actor}','admin');
insert into public.contractors(id,name,is_active,marketing_enabled) values('${contractor}','Synthetic invitation race',false,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
values('${application}','Synthetic race','Test','Race','race-recipient@example.invalid','synthetic','${contractor}');
${claims}
do $$ begin perform public.vendor_begin_review('${contractor}',(select id from public.vendor_application_versions where application_id='${application}')); end $$;
select public.vendor_prepare_invitation('${contractor}','synthetic-dispatch-race',now()+interval '1 day');
commit;`);
assert.match(attempt, /^[0-9a-f-]{36}$/);
const results = await Promise.all(
  Array.from({ length: 8 }, () =>
    sql(
      `begin; ${claims} set local role authenticated; select public.vendor_claim_invitation('${attempt}'); commit;`,
    ),
  ),
);
assert.equal(
  results.map(JSON.parse).filter((result) => result.claimed).length,
  1,
  "Exactly one caller may invoke Auth",
);
assert.equal(
  await sql(
    `select count(*) from public.vendor_invitation_dispatches where attempt_id='${attempt}'`,
  ),
  "1",
);
assert.equal(
  await sql(
    `select count(*) from public.vendor_invitation_events where attempt_id='${attempt}' and status='submitted'`,
  ),
  "1",
);
console.log(
  "PASS: eight concurrent authenticated dispatch claims produce one winner, one reservation and one submitted event. Reset synthetic fixtures afterward.",
);
