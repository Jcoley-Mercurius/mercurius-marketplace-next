import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// No credentials, no request body, and a fixed loopback destination. These
// requests must be rejected by the local gateway before any handler executes.
const inventory = JSON.parse(readFileSync("governance/EDGE-FUNCTION-INVENTORY.json", "utf8"));
let count = 0;
for (const entry of inventory.functions.filter((entry) => entry.verify_jwt)) {
  const response = await fetch(`http://127.0.0.1:55421/functions/v1/${entry.slug}`, {
    method: "POST", signal: AbortSignal.timeout(10000), redirect: "error",
  });
  const body = await response.json();
  assert.equal(response.status, 401, `${entry.slug}: missing JWT must be rejected`);
  assert.match(JSON.stringify(body), /authorization|jwt/i, `${entry.slug}: expected gateway auth error`);
  console.log(`PASS ${entry.slug}: missing JWT rejected by local gateway`);
  count++;
}
console.log(`${count} gateway rejection checks passed. No authenticated operations invoked.`);
