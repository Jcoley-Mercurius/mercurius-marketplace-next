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
  if (url.origin === fixture.SUPABASE_URL || url.origin === 'https://api.stripe.com') {
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
  equal(response.status, name === "stripe-webhook" ? 405 : ["checkout-request", "create-checkout", "refund-invoice"].includes(name) ? 204 : 200);
  equal(calls, []);
  await response.body?.cancel();
});

Deno.test(`${name}: rejects unauthenticated operations or characterizes legacy fallback`, async () => {
  calls = []; unexpected = []; route = undefined;
  const response = await request(name === "beta-access" ? { action: "redeem", code: "incorrect" } : {});
  const expected: Record<string, number> = {
    "beta-access": 401, "checkout-request": 401, "create-checkout": 401,
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

if (["checkout-request", "create-checkout", "refund-invoice"].includes(name)) {
  Deno.test(`${name}: execution remains disabled with no provider calls`, async () => {
    calls = []; route = undefined;
    const response = await request({}, { Authorization: "Bearer synthetic-user" });
    equal(response.status, 503); equal(calls, []);
    await response.body?.cancel();
  });
}
if (["checkout-request", "create-checkout"].includes(name)) {
  Deno.test(`${name}: authenticated checkout uses durable amount and stable Stripe key`, async () => {
    calls = []; unexpected = [];
    fixture.MERCURIUS_MONEY_MODE = 'test'; fixture.STRIPE_SECRET_KEY = 'sk_test_' + 'synthetic-no-network';
    const keys: (string | null)[] = [];
    route = (url, init) => {
      if (url.pathname === '/auth/v1/user') return json({ id: '10000000-0000-4000-8000-000000000001' });
      if (url.pathname === '/rest/v1/rpc/money_prepare_checkout') return json({ id: '10000000-0000-4000-8000-000000000002', snapshot_id: '10000000-0000-4000-8000-000000000003', amount: 11700, currency: 'usd', stripe_idempotency_key: 'synthetic-stable-key', created_at: new Date().toISOString(), expires_at: new Date(Date.now()+3600000).toISOString(), status: 'prepared', stripe_session_id: null, checkout_url: null });
      if (url.pathname === '/v1/checkout/sessions') {
        keys.push(new Headers(init?.headers).get('idempotency-key'));
        const fields = new URLSearchParams(String(init?.body));
        equal(fields.get('line_items[0][price_data][unit_amount]'), '11700');
        equal(fields.get('mode'), 'payment');
        equal(fields.has('payment_intent_data[transfer_data][destination]'), false);
        return json({ id: 'cs_synthetic', url: 'https://checkout.stripe.com/synthetic' });
      }
      if (url.pathname === '/rest/v1/rpc/money_attach_checkout') return json(null);
    };
    for (let retry=0;retry<2;retry++) {
      const response = await request({ snapshot_id: '10000000-0000-4000-8000-000000000003', mode: 'full', amount: 1 }, { Authorization: 'Bearer synthetic-user' });
      equal(response.status, 200); equal((await response.json()).url, 'https://checkout.stripe.com/synthetic');
    }
    equal(keys, ['synthetic-stable-key','synthetic-stable-key']);
    delete fixture.MERCURIUS_MONEY_MODE;
  });
}
if (name === 'stripe-webhook') {
  Deno.test('signed webhook commits minimized receipt before failure, then replays', async () => {
    fixture.MERCURIUS_MONEY_MODE='test'; fixture.STRIPE_SECRET_KEY='sk_test_'+'synthetic-no-network';
    const event = { id: 'evt_synthetic', type: 'payment_intent.succeeded', livemode: false, data: { object: { id: 'pi_synthetic', status: 'succeeded', currency: 'usd', amount_received: 11700, metadata: { money_attempt_id: '10000000-0000-4000-8000-000000000003' }, receipt_email: 'private@example.invalid' } } };
    const stamp = Math.floor(Date.now()/1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(fixture.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${stamp}.${JSON.stringify(event)}`)))).map(x=>x.toString(16).padStart(2,'0')).join('');
    let fail=true; const order: string[]=[];
    route = (url,init) => {
      if (url.pathname === '/rest/v1/rpc/money_receive_event') {
        order.push('received'); const payload=JSON.parse(String(init?.body));
        equal(payload.p_payload, { attempt_id: '10000000-0000-4000-8000-000000000003', payment_id: 'pi_synthetic', amount: 11700, currency: 'usd' });
        return json(null);
      }
      if (url.pathname === '/rest/v1/rpc/money_process_event') { order.push('processed'); return json(fail?'failed':'processed'); }
    };
    calls=[]; unexpected=[];
    const first=await request(event,{'stripe-signature':`t=${stamp},v1=${signature}`}); equal(first.status,500); await first.body?.cancel();
    fail=false;
    const second=await request(event,{'stripe-signature':`t=${stamp},v1=${signature}`}); equal(second.status,200); await second.body?.cancel();
    equal(order,['received','processed','received','processed']);
    const bad=await request(event,{'stripe-signature':'invalid'}); equal(bad.status,400); await bad.body?.cancel();
    equal(order.length,4);
    delete fixture.MERCURIUS_MONEY_MODE;
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
