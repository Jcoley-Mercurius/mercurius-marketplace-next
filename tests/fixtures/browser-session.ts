import type { BrowserContext } from "@playwright/test";

export async function syntheticSession(context: BrowserContext, role: "admin" | "vendor" | "homeowner") {
  const suffix = { admin: "3", vendor: "4", homeowner: "1" }[role];
  const id = `00000000-0000-4000-8000-00000000000${suffix}`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: id, aud: "authenticated", role: "authenticated", exp: expires, fixture: "mds-only", testRole: role })}.synthetic-signature`;
  const session = { access_token: token, refresh_token: "mds-fixture-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user: { id, aud: "authenticated", role: "authenticated", email: `${role}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${encoded(session)}`, url: "http://127.0.0.1:3103", sameSite: "Lax" }]);
}
