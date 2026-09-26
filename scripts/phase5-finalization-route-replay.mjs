// Local-only replay for TRACE-094 (needs `npm ci` and the isolated stack; reset afterward).
// Runs the actual document finalization route, transpiled, against the isolated database
// and Storage with a real service client. Only the signed grant, the environment and
// NextResponse are stubbed. A barrier holds every request until all have verified their
// files, then releases them together into the write, the interleaving of the Codex closure
// review reproduction. Pass a git revision to replay that revision's route instead.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { createClient } = require("@supabase/supabase-js");
const revision = process.argv[2];
const routePath = "src/app/api/vendor-applications/documents/route.ts";
const source = revision ? execFileSync("git", ["show", `${revision}:${routePath}`], { encoding: "utf8" }) : readFileSync(routePath, "utf8");

const container = process.env.PHASE5_DB_CONTAINER ?? "supabase_db_mercurius-phase5-isolated";
function run(command, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output.trim()) : reject(new Error(errors))));
    child.stdin.end(input);
  });
}
const sql = (text) => run("docker", ["exec", "-i", container, "psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], text);
const cli = existsSync(".phase5-local/tools-linux/node_modules/.bin/supabase") ? ".phase5-local/tools-linux/node_modules/.bin/supabase" : "supabase";
const stack = Object.fromEntries(
  (await run(cli, ["status", "--workdir", ".phase5-local", "-o", "env"]))
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);

const count = 6;
const application = revision ? "eb100000-0000-4000-8000-000000000002" : "eb100000-0000-4000-8000-000000000001";
const paths = Array.from({ length: count }, (_, index) => `${application}/license/eb200000-0000-4000-8000-${String(index + 1).padStart(12, "0")}-route-replay.pdf`);
assert.equal(await sql(`select count(*) from public.vendor_applications where id='${application}'`), "0", "Reset isolated fixtures before running");
await sql(`insert into public.vendor_applications(id,business_name,first_name,last_name,email,phone,status,document_urls)
 values('${application}','Synthetic route replay applicant','Test','Replay','route-replay@example.invalid','synthetic','pending','{}');`);
const service = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
for (const path of paths) {
  const { error } = await service.storage.from("vendor-documents").upload(path, new Blob(["%PDF synthetic route replay"], { type: "application/pdf" }), { contentType: "application/pdf" });
  assert.equal(error, null, "Synthetic upload succeeds");
}

// Every request waits here after its storage checks, before it reads or writes the row.
let arrived = 0;
let release;
const barrier = new Promise((resolve) => (release = resolve));
const atBarrier = async () => {
  if (++arrived === count) release();
  await barrier;
};
const real = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const client = new Proxy(real, {
  get(target, property) {
    if (property === "rpc") return async (...args) => (await atBarrier(), target.rpc(...args));
    if (property === "from") {
      return (table) => {
        const builder = target.from(table);
        if (table !== "vendor_applications") return builder;
        return new Proxy(builder, {
          get(inner, name) {
            if (name !== "select") return typeof inner[name] === "function" ? inner[name].bind(inner) : inner[name];
            return (...args) => {
              const query = inner.select(...args);
              return { eq: (...eqArgs) => ({ maybeSingle: async () => (await atBarrier(), query.eq(...eqArgs).maybeSingle()) }) };
            };
          },
        });
      };
    }
    const value = target[property];
    return typeof value === "function" ? value.bind(target) : value;
  },
});

const stubs = {
  "@supabase/supabase-js": { createClient: () => client },
  "next/server": { NextResponse: { json: (body, options = {}) => ({ status: options.status ?? 200, body }) } },
  "@/lib/vendorApplicationDocuments": {
    MAX_VENDOR_DOCUMENT_COUNT: 12,
    MAX_VENDOR_DOCUMENT_SIZE: 10485760,
    VENDOR_DOCUMENT_BUCKET: "vendor-documents",
    isAllowedVendorDocumentMimeType: (value) => value === "application/pdf",
  },
  "@/lib/vendorApplicationUploadToken": { verifyVendorDocumentUploadGrant: () => ({ applicationId: application, paths, expiresAt: Date.now() + 60_000 }) },
  "@/lib/env/server": { getServiceSupabaseEnvironment: () => ({ supabaseUrl: stack.API_URL, serviceRoleKey: stack.SERVICE_ROLE_KEY }) },
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
vm.runInNewContext(compiled, {
  exports: exported,
  require: (name) => {
    if (!(name in stubs)) throw new Error(`Unexpected import: ${name}`);
    return stubs[name];
  },
  console,
});

const responses = await Promise.all(
  paths.map((path) => exported.POST({ json: async () => ({ applicationId: application, finalizeToken: "synthetic-grant", paths: [path] }) })),
);
const stored = (await sql(`select coalesce(array_to_string(document_urls,','),'') from public.vendor_applications where id='${application}'`)).split(",").filter(Boolean);
const result = {
  route: revision ?? "working tree",
  statuses: responses.map((response) => response.status),
  attachedCounts: responses.map((response) => response.body.attachedCount),
  requested: count,
  stored: stored.length,
  lostUpdate: stored.length !== count,
};
console.log(JSON.stringify(result));
if (!revision) {
  assert.ok(responses.every((response) => response.status === 200), "Every request succeeds");
  assert.equal(stored.length, count, "The current row keeps every finalized path");
  assert.deepEqual([...stored].sort(), [...paths].sort(), "Each path appears exactly once");
  console.log("PASS: the actual route, released into its write together, kept every concurrently finalized path. Reset synthetic fixtures afterward.");
}
