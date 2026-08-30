import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const patterns = [
  {
    name: "private key",
    expression: new RegExp(
      ["-----", "BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY", "-----"].join(""),
      "g",
    ),
  },
  {
    name: "Stripe secret",
    expression: new RegExp(["s", "k_(?:live|test)_[A-Za-z0-9]{16,}"].join(""), "g"),
  },
  {
    name: "Stripe webhook secret",
    expression: new RegExp(["wh", "sec_[A-Za-z0-9]{16,}"].join(""), "g"),
  },
  {
    name: "GitHub token",
    expression: new RegExp(["gh", "[pousr]_[A-Za-z0-9]{30,}"].join(""), "g"),
  },
  {
    name: "Resend API key",
    expression: new RegExp(["r", "e_[A-Za-z0-9_]{20,}"].join(""), "g"),
  },
  {
    name: "JWT-like credential",
    expression: new RegExp(
      ["eyJ", "[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}"].join(""),
      "g",
    ),
  },
];

function locationFor(content, index) {
  const preceding = content.slice(0, index);
  const line = preceding.split(/\r?\n/).length;
  const lastBreak = Math.max(preceding.lastIndexOf("\n"), preceding.lastIndexOf("\r"));
  return { line, column: index - lastBreak };
}

export function findPotentialSecrets(path, content) {
  if (content.includes("\0")) return [];

  const findings = [];
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    for (const match of content.matchAll(pattern.expression)) {
      const location = locationFor(content, match.index ?? 0);
      findings.push({ path, type: pattern.name, ...location });
    }
  }
  return findings;
}

export function scanTrackedFiles(root = process.cwd()) {
  const tracked = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);

  return tracked.flatMap((path) => {
    const content = readFileSync(resolve(root, path), "utf8");
    return findPotentialSecrets(path, content);
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const findings = scanTrackedFiles();
  if (findings.length > 0) {
    console.error("Potential committed credentials detected:");
    for (const finding of findings) {
      console.error(
        `${finding.path}:${finding.line}:${finding.column} — ${finding.type}`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log("Secret scan passed: no known credential patterns detected.");
  }
}
