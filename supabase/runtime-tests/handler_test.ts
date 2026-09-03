// Real Deno + real locked SDK imports, with no network or process permission.
// Capture the HTTP callback rather than opening a listener or invoking a provider.
const name = Deno.args[0];
if (!/^[a-z-]+$/.test(name ?? "")) throw new Error("Expected a function name");
const fixture: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:55421",
  SUPABASE_ANON_KEY: "synthetic-anonymous-key-for-runtime-tests",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key-for-runtime-tests",
  STRIPE_SECRET_KEY: "synthetic-stripe-key-for-runtime-tests",
  STRIPE_WEBHOOK_SECRET: "synthetic-webhook-key-for-runtime-tests",
  BETA_ACCESS_CODE: "SYNTHETIC-BETA-CODE",
  BETA_TOKEN_SECRET: "synthetic-beta-signing-secret-for-runtime-tests",
  JOB_WORKER_SECRET: "synthetic-worker-secret-for-runtime-tests",
  SITE_URL: "http://localhost:3000",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};
Object.defineProperty(Deno.env, "get", { value: (key: string) => fixture[key] });
type Handler = (request: Request) => Response | Promise<Response>;
let handler: Handler;
Object.defineProperty(Deno, "serve", { value: (callback: Handler) => { handler = callback; return {}; } });
let calls: string[] = [];
let unexpected: string[] = [];
let route: ((url: URL, init?: RequestInit) => Response | undefined) | undefined;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.origin === fixture.SUPABASE_URL) {
    const response = route?.(url, init);
    if (response) return response;
  }
  unexpected.push(`${url.origin}${url.pathname}`);
  throw new Error("Unexpected network operation blocked by runtime fixture");
}) as typeof fetch;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
async function request(body: unknown, headers: Record<string, string> = {}, method = "POST") {
  const response = await handler(new Request(`http://localhost/functions/v1/${name}`, {
    method, headers: { "Content-Type": "application/json", ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  equal(unexpected, []);
  return response;
}

Deno.test(`${name}: locked module boots and handles preflight or rejects webhook OPTIONS`, async () => {
  await import(new URL(`../functions/${name}/index.ts`, import.meta.url).href);
  const response = await request({}, {}, "OPTIONS");
  equal(response.status, name === "stripe-webhook" ? 405 : ["checkout-request", "refund-invoice"].includes(name) ? 204 : 200);
  equal(calls, []);
  await response.body?.cancel();
});

Deno.test(`${name}: rejects unauthenticated operations or characterizes legacy fallback`, async () => {
  calls = []; unexpected = []; route = undefined;
  const response = await request(name === "beta-access" ? { action: "redeem", code: "incorrect" } : {});
  const expected: Record<string, number> = {
    "beta-access": 401, "checkout-request": 400, "create-checkout": 400,
    "customer-portal": 400, "job-lifecycle-worker": 401, "list-payment-methods": 400,
    "loyalty-recommend": 401, "refund-invoice": 401, "stripe-webhook": 400,
    // Characterization, NOT security approval: source has no handler-level auth.
    // With no transport credentials it explicitly returns an unemailed fallback.
    "vendor-application-notify": 200, "vendor-invite": 401,
  };
  equal(response.status, expected[name]);
  if (name === "vendor-application-notify") equal((await response.json()).emailed, false);
  else await response.body?.cancel();
  equal(calls, []);
});

if (name === "beta-access") {
  Deno.test("beta gate: issue, verify, reject tampered token", async () => {
    const issued = await request({ action: "redeem", code: fixture.BETA_ACCESS_CODE });
    equal(issued.status, 200);
    const { token } = await issued.json();
    equal(await (await request({ action: "verify", token })).json(), { valid: true });
    equal(await (await request({ action: "verify", token: `${token}x` })).json(), { valid: false });
  });
}

if (name === "vendor-invite") {
  Deno.test("vendor invitation: authenticated non-admin cannot provision accounts", async () => {
    route = (url) => {
      if (url.pathname === "/auth/v1/user") return json({ id: "10000000-0000-4000-8000-000000000003" });
      if (url.pathname === "/rest/v1/rpc/has_role") return json(false);
    };
    const response = await request({ action: "approve", application_id: "synthetic" }, { Authorization: "Bearer synthetic-user-token" });
    equal(response.status, 403);
    await response.body?.cancel();
    equal(calls.length, 2);
  });
}

if (name === "job-lifecycle-worker") {
  Deno.test("worker: invalid scheduler secret is rejected before lifecycle operations", async () => {
    route = (url) => url.pathname === "/rest/v1/internal_worker_tokens" ? json({ token: fixture.JOB_WORKER_SECRET }) : undefined;
    const response = await request({}, { "x-worker-secret": "incorrect" });
    equal(response.status, 401);
    await response.body?.cancel();
    equal(calls, ["GET /rest/v1/internal_worker_tokens"]);
  });
  Deno.test("worker: valid scheduler credential runs an empty synthetic lifecycle batch", async () => {
    calls = []; unexpected = [];
    route = (url) => {
      if (url.pathname === "/rest/v1/rpc/expire_stale_matches") return json(0);
      if (url.pathname === "/rest/v1/service_requests") return json([]);
    };
    const response = await request({ job_id: "must-not-be-used" }, { "x-worker-secret": fixture.JOB_WORKER_SECRET });
    equal(response.status, 200);
    const body = await response.json();
    equal(body.ok, true);
    equal(body.matches_expired, 0);
    equal(body.auto_confirmed, 0);
    equal(calls.length, 5);
    equal(calls.filter((call) => call.startsWith("POST")), ["POST /rest/v1/rpc/expire_stale_matches"]);
  });
}
