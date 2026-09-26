// Synthetic-only concurrency proof for TRACE-094; reset the isolated database afterward.
// Concurrent partial finalizations of one application's grant must each keep their paths:
// the current row ends with every attached path exactly once.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const container = process.env.PHASE5_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))));
    child.stdin.end(source);
  });
}
const application = "ea100000-0000-4000-8000-000000000001";
const kinds = ["license", "insurance", "other"];
const path = (n) => `${application}/${kinds[n % 3]}/ea200000-0000-4000-8000-${String(n).padStart(12, "0")}-attach-race.pdf`;
// The finalize route's call, made with the service key it uses.
const attach = (paths) =>
  sql(`begin; set local role service_role;
 select public.vendor_application_attach_documents('${application}',array[${paths.map((p) => `'${p}'`).join(",")}]); commit;`).then(JSON.parse);

assert.equal(await sql(`select count(*) from public.vendor_applications where id='${application}'`), "0", "Reset isolated fixtures before running");
await sql(`begin;
insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
 values('${application}','Synthetic attach race applicant','Test','Race','attach-race@example.invalid','synthetic','pending','{}');
insert into storage.objects(bucket_id,name,metadata)
 select 'vendor-documents','${application}/'||(array['license','insurance','other'])[n%3+1]||'/ea200000-0000-4000-8000-'||lpad(n::text,12,'0')||'-attach-race.pdf',
   '{"size":2048,"mimetype":"application/pdf"}' from generate_series(1,12) n;
commit;`);

// 1. Twelve concurrent requests, each finalizing one different path of the grant.
const single = await Promise.all(Array.from({ length: 12 }, (_, index) => attach([path(index + 1)])));
assert.ok(single.every((result) => result.added === 1), "Every single-path request adds its path");
const listed = (await sql(`select array_to_string(document_urls,',') from public.vendor_applications where id='${application}'`)).split(",");
assert.equal(listed.length, 12, `The current row lists all twelve paths (${listed.length})`);
assert.deepEqual([...listed].sort(), Array.from({ length: 12 }, (_, index) => path(index + 1)).sort(), "Each path appears exactly once");
assert.equal(
  await sql(`select count(*) from public.vendor_application_versions where application_id='${application}'`),
  "13",
  "One version for the application and one per attachment",
);
// The last writer returns the whole list, so no response claimed a list missing another's path.
assert.ok(single.some((result) => result.document_paths.length === 12), "The last request to commit saw every path");

// 2. Eight concurrent retries of overlapping subsets: nothing is added or reordered.
const retries = await Promise.all(
  Array.from({ length: 8 }, (_, index) => attach([path((index % 12) + 1), path(((index + 5) % 12) + 1)])),
);
assert.ok(retries.every((result) => result.added === 0 && result.document_paths.length === 12), "Retries add nothing");
assert.equal(
  await sql(`select array_to_string(document_urls,',') from public.vendor_applications where id='${application}'`),
  listed.join(","),
  "The list and its order are unchanged by retries",
);
assert.equal(
  await sql(`select count(*) from public.vendor_application_versions where application_id='${application}'`),
  "13",
  "Retries make no version",
);
console.log("PASS: twelve concurrent single-path finalizations kept all twelve paths exactly once with one version each; eight overlapping retries changed nothing. Reset synthetic fixtures afterward.");
