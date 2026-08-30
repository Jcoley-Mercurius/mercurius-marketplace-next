import { describe, expect, it } from "vitest";
import {
  EnvironmentConfigurationError,
  optionalString,
  requiredString,
  requiredUrl,
} from "./validation";

describe("environment validation", () => {
  it("trims required and optional values", () => {
    const source = { REQUIRED: " value ", OPTIONAL: " optional " };
    expect(requiredString(source, "REQUIRED")).toBe("value");
    expect(optionalString(source, "OPTIONAL")).toBe("optional");
  });

  it("reports the missing variable without exposing other values", () => {
    expect(() => requiredString({}, "REQUIRED_KEY")).toThrowError(
      new EnvironmentConfigurationError("REQUIRED_KEY is required."),
    );
  });

  it("requires HTTPS except for localhost", () => {
    expect(requiredUrl({ URL: "http://localhost:3000/" }, "URL")).toBe(
      "http://localhost:3000",
    );
    expect(requiredUrl({ URL: "http://127.0.0.1:54321/" }, "URL")).toBe(
      "http://127.0.0.1:54321",
    );
    expect(() =>
      requiredUrl({ URL: "http://example.com" }, "URL"),
    ).toThrow("must use HTTPS");
    expect(() => requiredUrl({ URL: "ftp://localhost" }, "URL")).toThrow(
      "must use HTTPS",
    );
  });
});
