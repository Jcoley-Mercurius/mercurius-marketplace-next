import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { findPotentialSecrets } from "./scan-secrets.mjs";

const root = path.resolve("supabase/functions");
const inventory = JSON.parse(readFileSync("governance/EDGE-FUNCTION-INVENTORY.json", "utf8"));
const config = readFileSync("supabase/config.toml", "utf8");
const retainedLocal = new Set(["checkout-request", "refund-invoice", "stripe-webhook"]);
const source = (file) => readFileSync(path.join(root, file), "utf8");
const digest = (text) => createHash("sha256").update(text.replaceAll("\r\n", "\n").trimEnd() + "\n").digest("hex");

describe("recovered Edge Function contract", () => {
  it("contains every deployed function and no undocumented function directory", () => {
    const names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name).sort();
    expect(names).toEqual(inventory.functions.map((entry) => entry.slug).sort());
  });

  for (const deployed of inventory.functions) {
    it(`${deployed.slug}: preserves the observed gateway JWT setting`, () => {
      const section = config.split(`[functions.${deployed.slug}]`)[1]?.split("\n[")[0];
      expect(section).toBeDefined();
      expect(section).toMatch(new RegExp(`verify_jwt\\s*=\\s*${deployed.verify_jwt}\\b`));
    });
  }

  for (const file of inventory.files) {
    it(`${file.file}: parses and resolves its local imports without execution`, () => {
      const text = source(file.file);
      const parsed = ts.createSourceFile(file.file, text, ts.ScriptTarget.Latest, true);
      expect(parsed.parseDiagnostics).toEqual([]);
      expect(findPotentialSecrets(file.file, text)).toEqual([]);
      for (const imported of ts.preProcessFile(text).importedFiles) {
        if (!imported.fileName.startsWith(".")) continue;
        const resolved = path.resolve(root, path.dirname(file.file), imported.fileName);
        expect(resolved.startsWith(root + path.sep)).toBe(true);
        expect(existsSync(resolved)).toBe(true);
      }
    });
    if (!retainedLocal.has(file.file.split("/")[0])) {
      it(`${file.file}: matches the reviewed export apart from line endings`, () => {
        const recovered = ['create-checkout/index.ts', 'vendor-invite/index.ts'].includes(file.file)
          ? readFileSync(`governance/recovered-edge/${file.file.split('/')[0]}.ts.txt`, 'utf8')
          : source(file.file);
        expect(digest(recovered)).toBe(file.normalizedSha256);
      });
    }
  }
});
