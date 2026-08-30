import { describe, expect, it } from "vitest";
import { findPotentialSecrets } from "./scan-secrets.mjs";

describe("secret scanner", () => {
  it("reports a credential without returning its value", () => {
    const credential = ["s", "k_live_", "abcdefghijklmnopqrstuvwxyz"].join("");
    const findings = findPotentialSecrets(
      "fixture.ts",
      `const credential = "${credential}";`,
    );

    expect(findings).toEqual([
      {
        path: "fixture.ts",
        type: "Stripe secret",
        line: 1,
        column: 21,
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(credential);
  });

  it("does not flag documented placeholders", () => {
    expect(
      findPotentialSecrets(
        ".env.example",
        "STRIPE_SECRET_KEY=YOUR_STRIPE_TEST_SECRET_KEY",
      ),
    ).toEqual([]);
  });
});
