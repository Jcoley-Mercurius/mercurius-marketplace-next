// Synthetic-only concurrency proof for recorded Auth refusals (TRACE-063 forward
// fix); reset the isolated database afterward.
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
const settle = (promise) =>
  promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: String(error.message) }),
  );
const id = (n) => `ce000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1);
const claims = `do $$ begin perform set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); end $$;`;
const service = (statement) =>
  `begin; set local role service_role; ${statement}; commit;`;
assert.equal(
  await sql(`select count(*) from auth.users where id='${actor}'`),
  "0",
  "Reset isolated fixtures before running",
);
await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values('${actor}','refusal-race-operator@example.invalid',now());
insert into public.user_roles(user_id,role) values('${actor}','admin');
commit;`);

// One provider with a reserved dispatch (and optionally an unknown outcome) per scenario.
// Each recipient already holds a confirmed account created before the dispatch.
async function reserved(n, { unknown = false } = {}) {
  const contractor = id(100 + n);
  const application = id(200 + n);
  const account = id(300 + n);
  const attempt = await sql(`begin;
insert into auth.users(id,email,email_confirmed_at) values('${account}','refusal-race-${n}@example.invalid',now()-interval '1 day');
insert into public.contractors(id,name,is_active,marketing_enabled) values('${contractor}','Synthetic refusal race ${n}',false,false);
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,contractor_id)
values('${application}','Synthetic refusal race ${n}','Test','Race','refusal-race-${n}@example.invalid','synthetic','${contractor}');
${claims}
do $$ begin perform public.vendor_begin_review('${contractor}',(select id from public.vendor_application_versions where application_id='${application}')); end $$;
select public.vendor_prepare_invitation('${contractor}','synthetic-refusal-race-${n}',now()+interval '1 day');
commit;`);
  await sql(
    `begin; ${claims} set local role authenticated; select public.vendor_claim_invitation('${attempt}'); commit;`,
  );
  if (unknown)
    await sql(
      service(
        `select public.vendor_finish_invitation('${attempt}',null,'${actor}')`,
      ),
    );
  return { attempt, account };
}
const outcome = (attempt) =>
  sql(`select d.state||'|'||a.status||'|'||
  (select count(*) from public.vendor_invitation_events e where e.attempt_id=a.id and e.status='failed')||'|'||
  (select count(*) from public.vendor_invitation_events e where e.attempt_id=a.id and e.status='unknown')
  from public.vendor_invitation_dispatches d join public.vendor_invitation_attempts a on a.id=d.attempt_id
  where d.attempt_id='${attempt}'`);

// 1. Eight duplicate handler reports of one refusal record it once.
{
  const { attempt } = await reserved(1);
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      settle(
        sql(
          service(
            `select public.vendor_refuse_invitation('${attempt}','email_exists','${actor}')`,
          ),
        ),
      ),
    ),
  );
  assert.equal(results.filter((r) => r.ok).length, 8, "Duplicate reports replay");
  assert.equal(await outcome(attempt), "failed|failed|1|0");
}

// 2. A refusal report races unknown reports for the same reservation: exactly one
// outcome is recorded, and a refusal never lands on top of an unknown outcome.
{
  const { attempt } = await reserved(2);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      settle(
        sql(
          service(
            i % 2
              ? `select public.vendor_finish_invitation('${attempt}',null,'${actor}')`
              : `select public.vendor_refuse_invitation('${attempt}','email_exists','${actor}')`,
          ),
        ),
      ),
    ),
  );
  const final = await outcome(attempt);
  assert.ok(
    ["failed|failed|1|0", "unknown|unknown|0|1"].includes(final),
    `One consistent outcome, got ${final}`,
  );
  const refusals = results.filter((_, i) => i % 2 === 0);
  if (final.startsWith("unknown"))
    assert.ok(
      refusals.every(
        (r) =>
          !r.ok && r.error.includes("Unknown invitation requires account evidence"),
      ),
      "Refusals after an unknown outcome require evidence",
    );
  else assert.ok(refusals.every((r) => r.ok), "Refusal reports replay");
  assert.ok(
    results.filter((_, i) => i % 2).every((r) => r.ok),
    "Unknown reports never fail",
  );
}

// 3. On an unknown reservation, corroborated refusals race reconciliation with the
// same account: the predicates are complementary, so only the refusal can win.
{
  const { attempt, account } = await reserved(3, { unknown: true });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      settle(
        sql(
          service(
            i % 2
              ? `select public.vendor_finish_invitation('${attempt}','${account}','${actor}')`
              : `select public.vendor_refuse_invitation('${attempt}','email_exists','${actor}','${account}')`,
          ),
        ),
      ),
    ),
  );
  assert.equal(await outcome(attempt), "failed|failed|1|1");
  assert.ok(results.filter((_, i) => i % 2 === 0).every((r) => r.ok), "Refusals replay");
  assert.ok(
    results.filter((_, i) => i % 2).every((r) => !r.ok),
    "Reconciliation never wins against a pre-existing account",
  );
  assert.equal(
    await sql(
      `select count(*) from public.vendor_invitation_dispatches where attempt_id='${attempt}' and auth_user_id is not null`,
    ),
    "0",
  );
}

assert.equal(
  await sql(
    `select count(*) from public.user_roles where role='vendor' and user_id::text like 'ce000000-%'`,
  ),
  "0",
  "No race grants a vendor role",
);
assert.equal(
  await sql(
    `select count(*) from public.contractors where id::text like 'ce000000-%' and (user_id is not null or is_active)`,
  ),
  "0",
  "No race links or activates a provider",
);
console.log(
  "PASS: duplicate refusal reports record once; a refusal racing unknown reports yields one consistent outcome; corroborated refusals racing reconciliation record one failure and no identity. Reset synthetic fixtures afterward.",
);
