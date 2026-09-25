// Synthetic-only concurrency proof for TRACE-088 and TRACE-089; reset the isolated database afterward.
// PHASE5_DB_CONTAINER may name another local database container for a manual run.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const container = process.env.PHASE5_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
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
// Keys are hashes of synthetic labels, never of a real email address.
const key = (label) => createHash("sha256").update(`intake-race-synthetic-${label}`).digest("hex");
const record = (form, label) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"service_role"}',true); end $$;
 set local role service_role; select public.intake_record_submission('${form}','${key(label)}',null) = 'accepted'; commit;`);
const accepted = (results) => results.filter((value) => value === "t").length;
const labels = ["last-slot", "fresh", "fresh-other", "per-form"];
const inList = labels.map((label) => `'${key(label)}'`).join(",");

assert.equal(
  await sql(`select count(*) from private.intake_submissions where email_hash in (${inList})`),
  "0",
  "Reset isolated fixtures before running",
);

// 1: two submissions already recorded; ten parallel attempts race for the last slot.
await sql(`insert into private.intake_submissions(form,email_hash)
 select 'contact','${key("last-slot")}' from generate_series(1,2);`);
const lastSlot = await Promise.all(Array.from({ length: 10 }, () => record("contact", "last-slot")));
assert.equal(accepted(lastSlot), 1, "Exactly one parallel attempt takes the last slot");

// 2: two fresh emails, twelve parallel attempts each, interleaved.
const fresh = await Promise.all(
  Array.from({ length: 24 }, (_, n) => record("contact", n % 2 ? "fresh" : "fresh-other")),
);
assert.equal(accepted(fresh.filter((_, n) => n % 2)), 3, "A fresh email accepts exactly three");
assert.equal(accepted(fresh.filter((_, n) => !(n % 2))), 3, "Another fresh email accepts exactly three");

// 3: one email racing on both forms keeps a separate allowance for each.
const perForm = await Promise.all(
  Array.from({ length: 12 }, (_, n) => record(n % 2 ? "contact" : "vendor_application", "per-form")),
);
assert.equal(accepted(perForm.filter((_, n) => n % 2)), 3, "The contact form accepts exactly three");
assert.equal(accepted(perForm.filter((_, n) => !(n % 2))), 3, "The application form accepts exactly three");

assert.equal(
  await sql(`select string_agg(n::text,',' order by k) from (select email_hash k,count(*) n
   from private.intake_submissions where email_hash in (${inList}) group by email_hash, form) x`),
  "3,3,3,3,3",
  "Exactly the accepted submissions are recorded",
);
// 4 (TRACE-089): four submissions already recorded from one network; ten parallel attempts
// with different emails race for its last hourly slot.
const network = key("network-last-slot");
const recordFrom = (label) =>
  sql(`begin; do $$ begin perform set_config('request.jwt.claims','{"role":"service_role"}',true); end $$;
 set local role service_role; select public.intake_record_submission('contact','${key(label)}','${network}'); commit;`);
await sql(`insert into private.intake_submissions(form,email_hash,ip_hash)
 select 'contact',md5(g::text)||md5(g::text),'${network}' from generate_series(1,4) g;`);
const networkSlot = await Promise.all(Array.from({ length: 10 }, (_, n) => recordFrom(`network-${n}`)));
assert.equal(networkSlot.filter((value) => value === "accepted").length, 1, "Exactly one takes the network's last slot");
assert.equal(networkSlot.filter((value) => value === "ip_limit").length, 9, "The rest are refused by the network limit");
assert.equal(
  await sql(`select count(*) from private.intake_submissions where ip_hash='${network}'`),
  "5",
  "The network holds exactly five recorded submissions",
);
console.log("Intake limit concurrency: last slot, fresh emails, per-form and per-network allowances hold.");
