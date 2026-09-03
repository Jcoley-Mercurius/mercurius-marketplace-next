import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { findPotentialSecrets } from "./scan-secrets.mjs";

const root = path.resolve("supabase/.audit/deployed/supabase/functions");
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }))).flat();
}

const files = [];
for (const file of await walk(root)) {
  const source = await readFile(file, "utf8");
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const candidates = [...source.matchAll(/\b[\w]*(?:password|secret|token|api_key|apikey)[\w]*\s*[:=]\s*["'`]([^"'`\r\n]+)["'`]/gi)]
    .map((match) => ({ line: source.slice(0, match.index).split(/\r?\n/).length }));
  files.push({
    file: relative,
    bytes: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"),
    normalizedSha256: createHash("sha256").update(source.replaceAll("\r\n", "\n").trimEnd() + "\n").digest("hex"),
    credentialFindings: findPotentialSecrets(relative, source),
    literalCredentialCandidates: candidates,
    environmentNames: [...new Set([...source.matchAll(/Deno\.env\.get\(["']([^"']+)["']\)/g)].map((match) => match[1]))].sort(),
  });
}

const metadata = JSON.parse(await readFile("supabase/.audit/deployed-functions.json", "utf8"));
const functions = metadata.map(({ slug, name, version, status, verify_jwt }) => ({ slug, name, version, status, verify_jwt }));
console.log(JSON.stringify({ functions, files }, null, 2));
