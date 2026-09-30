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
  JOB_LIFECYCLE_ENABLED: "true",
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
if (name === "refund-invoice") {
  // TRACE-076: the verified token names the actor; a body field never does.
  const operator = "10000000-0000-4000-8000-000000000076";
  const authorization = "10000000-0000-4000-8000-000000000077";
  const withMoney = async (run: () => Promise<void>) => {
    fixture.MERCURIUS_MONEY_MODE = "test"; fixture.STRIPE_SECRET_KEY = "sk_test_" + "synthetic-no-network";
    try { await run(); } finally { delete fixture.MERCURIUS_MONEY_MODE; fixture.STRIPE_SECRET_KEY = "synthetic-stripe-key-for-runtime-tests"; }
  };
  const target = (overrides: Record<string, unknown> = {}) => ({ authorization_id: authorization, payment_id: "pi_synthetic", amount: 2140, attempt_status: "pending", provider_reference: null, settled: false, ...overrides });
  const bodyOf = (init?: RequestInit) => JSON.parse(String(init?.body));

  Deno.test("refund send: the actor is the verified user, not a body field", () => withMoney(async () => {
    calls = []; unexpected = [];
    const actors: string[] = [];
    route = (url, init) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_prepare_refund") { actors.push(bodyOf(init).p_actor); return json({ status: "reconcile" }); }
    };
    const response = await request({ authorization_id: authorization, p_actor: "10000000-0000-4000-8000-000000000099", actor: "10000000-0000-4000-8000-000000000099" }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 200); equal((await response.json()).status, "reconcile");
    equal(actors, [operator]);
    equal(calls.some(call => call.includes("/v1/refunds")), false);
  }));

  Deno.test("refund readback: finance refusal makes no Stripe call", () => withMoney(async () => {
    calls = []; unexpected = [];
    route = (url) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_refund_readback_target") return json({ code: "42501", message: "Restricted finance authority required", details: null, hint: null }, 403);
    };
    const response = await request({ action: "readback", authorization_id: authorization }, { Authorization: "Bearer synthetic-admin" });
    equal(response.status, 403); equal((await response.json()).error, "FINANCE_AUTHORITY_REQUIRED");
    equal(calls, ["GET /auth/v1/user", "POST /rest/v1/rpc/money_refund_readback_target"]);
  }));

  Deno.test("refund readback: an unsent refund is not read back", () => withMoney(async () => {
    calls = []; unexpected = [];
    route = (url) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_refund_readback_target") return json(target({ attempt_status: "not_started" }));
    };
    const response = await request({ action: "readback", authorization_id: authorization }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 409); equal((await response.json()).error, "REFUND_NOT_SENT");
    equal(calls.length, 2);
  }));

  Deno.test("refund readback: a known reference is retrieved and recorded for the verified user", () => withMoney(async () => {
    calls = []; unexpected = [];
    const recorded: unknown[] = [];
    route = (url, init) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_refund_readback_target") { equal(bodyOf(init).p_actor, operator); return json(target({ provider_reference: "re_synthetic" })); }
      if (url.pathname === "/v1/refunds/re_synthetic") return json({ id: "re_synthetic", object: "refund", amount: 2140, status: "succeeded", payment_intent: "pi_synthetic", metadata: { money_authorization_id: authorization } });
      if (url.pathname === "/rest/v1/rpc/money_record_refund_readback") { recorded.push(bodyOf(init)); return json({ attempt_status: "pending", settled: false }); }
    };
    const response = await request({ action: "readback", authorization_id: authorization, p_actor: "10000000-0000-4000-8000-000000000099" }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 200);
    equal(await response.json(), { status: "pending", settled: false, found: true, refund_id: "re_synthetic", provider_status: "succeeded" });
    equal(recorded, [{ p_authorization: authorization, p_actor: operator, p_reference: "re_synthetic", p_status: "succeeded", p_amount: 2140 }]);
    equal(calls.filter(call => call.startsWith("POST /v1/")), []);
  }));

  Deno.test("refund readback: no refund at Stripe records not found", () => withMoney(async () => {
    calls = []; unexpected = [];
    const recorded: unknown[] = [];
    route = (url, init) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_refund_readback_target") return json(target({ attempt_status: "reconcile" }));
      if (url.pathname === "/v1/refunds") {
        equal(url.searchParams.get("payment_intent"), "pi_synthetic");
        return json({ object: "list", has_more: false, data: [{ id: "re_other", object: "refund", amount: 500, status: "succeeded", payment_intent: "pi_synthetic", metadata: { money_authorization_id: "10000000-0000-4000-8000-000000000098" } }] });
      }
      if (url.pathname === "/rest/v1/rpc/money_record_refund_readback") { recorded.push(bodyOf(init)); return json({ attempt_status: "reconcile", settled: false }); }
    };
    const response = await request({ action: "readback", authorization_id: authorization }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 200); equal((await response.json()).found, false);
    equal(recorded, [{ p_authorization: authorization, p_actor: operator, p_reference: null, p_status: null, p_amount: null }]);
  }));

  Deno.test("refund readback: a refund for another payment records nothing", () => withMoney(async () => {
    calls = []; unexpected = [];
    route = (url) => {
      if (url.pathname === "/auth/v1/user") return json({ id: operator });
      if (url.pathname === "/rest/v1/rpc/money_refund_readback_target") return json(target({ provider_reference: "re_synthetic" }));
      if (url.pathname === "/v1/refunds/re_synthetic") return json({ id: "re_synthetic", object: "refund", amount: 2140, status: "succeeded", payment_intent: "pi_elsewhere", metadata: { money_authorization_id: authorization } });
    };
    const response = await request({ action: "readback", authorization_id: authorization }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 409); equal((await response.json()).error, "REFUND_PROVIDER_MISMATCH");
    equal(calls.some(call => call.includes("money_record_refund_readback")), false);
  }));

  Deno.test("refund readback: an unknown action is refused before any lookup", () => withMoney(async () => {
    calls = []; unexpected = [];
    route = (url) => url.pathname === "/auth/v1/user" ? json({ id: operator }) : undefined;
    const response = await request({ action: "mark_settled", authorization_id: authorization }, { Authorization: "Bearer synthetic-operator" });
    equal(response.status, 400); await response.body?.cancel();
    equal(calls, ["GET /auth/v1/user"]);
  }));
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
  Deno.test("worker: copied example credential is rejected without a token lookup", async () => {
    calls = []; unexpected = [];
    route = url => url.pathname === "/rest/v1/internal_worker_tokens" ? json({ token: "YOUR_SERVER_SIDE_WORKER_SECRET" }) : undefined;
    const response = await request({}, { "x-worker-secret": "YOUR_SERVER_SIDE_WORKER_SECRET" });
    equal(response.status, 401); await response.body?.cancel(); equal(calls, []);
  });
  Deno.test("worker: valid scheduler credential runs an empty synthetic lifecycle batch", async () => {
    calls = []; unexpected = [];
    route = (url) => {
      if (url.pathname === "/rest/v1/rpc/run_lifecycle_batch") return json({ ok: true, matches_expired: 0, admin_flagged: 0 });
    };
    const response = await request({ job_id: "must-not-be-used" }, { "x-worker-secret": fixture.JOB_WORKER_SECRET });
    equal(response.status, 200);
    const body = await response.json();
    equal(body.ok, true);
    equal(body.matches_expired, 0);
    equal(body.auto_confirmed, undefined);
    equal(calls, ["POST /rest/v1/rpc/run_lifecycle_batch"]);
  });
}

if (name === "job-lifecycle-worker") {
  Deno.test("worker: disabled by default even for a valid worker secret", async () => {
    calls = []; unexpected = []; delete fixture.JOB_LIFECYCLE_ENABLED;
    const response = await request({}, { "x-worker-secret": fixture.JOB_WORKER_SECRET });
    equal(response.status, 503); await response.body?.cancel(); equal(calls, []);
    fixture.JOB_LIFECYCLE_ENABLED = "true";
  });
  Deno.test("worker: database failure is non-2xx and does not expose details", async () => {
    calls = []; unexpected = [];
    route = url => url.pathname === "/rest/v1/rpc/run_lifecycle_batch"
      ? json({ code: "23514", message: "sensitive synthetic failure detail" }, 400) : undefined;
    const response = await request({}, { "x-worker-secret": fixture.JOB_WORKER_SECRET });
    equal(response.status, 500);
    equal((await response.text()).includes("sensitive synthetic"), false);
    equal(calls.length, 1);
  });
  Deno.test("worker: malformed successful RPC response fails closed", async () => {
    calls = []; unexpected = [];
    route = url => url.pathname === "/rest/v1/rpc/run_lifecycle_batch" ? json(null) : undefined;
    const response = await request({}, { "x-worker-secret": fixture.JOB_WORKER_SECRET });
    equal(response.status, 500); await response.body?.cancel();
  });
  Deno.test("worker: authenticated homeowner is denied", async () => {
    calls = []; unexpected = [];
    route = url => url.pathname === "/auth/v1/user" ? json({ id: "10000000-0000-4000-8000-000000000001" })
      : url.pathname === "/rest/v1/rpc/has_role" ? json(false) : undefined;
    const response = await request({}, { Authorization: "Bearer synthetic-user-token" });
    equal(response.status, 403); await response.body?.cancel();
    equal(calls.length, 2);
  });
  Deno.test("worker: admin identity is verified and passed for audit, caller state ignored", async () => {
    calls = []; unexpected = [];
    const actor = "10000000-0000-4000-8000-000000000004";
    route = (url, init) => {
      if (url.pathname === "/auth/v1/user") return json({ id: actor });
      if (url.pathname === "/rest/v1/rpc/has_role") return json(true);
      if (url.pathname === "/rest/v1/rpc/run_lifecycle_batch") {
        const body = JSON.parse(String(init?.body));
        equal(body._actor_id, actor);
        equal(Object.keys(body).sort(), ["_actor_id", "_run_id"]);
        return json({ ok: true });
      }
    };
    const response = await request({ _actor_id: "forged", _to_status: "homeowner_confirmed" }, { Authorization: "Bearer synthetic-admin-token" });
    equal(response.status, 200); await response.body?.cancel();
  });
}

if (name === "vendor-invite") {
  const attempt = "d4000000-0000-4000-8000-000000000001";
  const recipient = "d1000000-0000-4000-8000-000000000002";
  const operator = "d1000000-0000-4000-8000-000000000001";
  const operatorRoute = (url: URL) => {
    if (url.pathname === "/auth/v1/user") return json({ id: operator });
    if (url.pathname === "/rest/v1/rpc/has_role") return json(true);
  };
  // TRACE-071. Synthetic project ref and site; neither names a real deployment.
  const hostedRef="syntheticref00000001";
  const hosted={MERCURIUS_INVITATION_MODE:"hosted",MERCURIUS_INVITATION_PROJECT_REF:hostedRef,
    MERCURIUS_INVITATION_SITE_ORIGIN:"https://app.example.test",
    SUPABASE_URL:`https://${hostedRef}.supabase.co`,SITE_URL:"https://app.example.test"};
  const delivery=["MERCURIUS_INVITATION_MODE","MERCURIUS_INVITATION_PROJECT_REF","MERCURIUS_INVITATION_SITE_ORIGIN","SUPABASE_URL","SITE_URL"] as const;
  const baseline:Record<string,string|undefined>=Object.fromEntries(delivery.map(key=>[key,fixture[key]]));
  const withDelivery=async(overrides:Record<string,string|undefined>,run:()=>Promise<void>)=>{
    for(const key of delivery){const value=key in overrides?overrides[key]:baseline[key]; if(value===undefined)delete fixture[key]; else fixture[key]=value;}
    try{await run();}finally{for(const key of delivery){const value=baseline[key]; if(value===undefined)delete fixture[key]; else fixture[key]=value;}}
  };
  Deno.test("invitation dispatch: disabled, unknown and mismatched delivery modes never reach Auth", async () => {
    const off:[string,Record<string,string|undefined>][]=[
      ["unset",{}],
      ["unknown mode",{...hosted,MERCURIUS_INVITATION_MODE:"production"}],
      ["local-test against a hosted project",{MERCURIUS_INVITATION_MODE:"local-test",SUPABASE_URL:hosted.SUPABASE_URL}],
      ["local-test with a hosted site",{MERCURIUS_INVITATION_MODE:"local-test",SITE_URL:hosted.SITE_URL}],
      ["hosted without a project pin",{...hosted,MERCURIUS_INVITATION_PROJECT_REF:undefined}],
      ["hosted without a site pin",{...hosted,MERCURIUS_INVITATION_SITE_ORIGIN:undefined}],
      ["hosted against another project",{...hosted,SUPABASE_URL:"https://otherref000000000001.supabase.co"}],
      ["hosted with a malformed pin",{...hosted,MERCURIUS_INVITATION_PROJECT_REF:"synthetic-ref",SUPABASE_URL:"https://synthetic-ref.supabase.co"}],
      ["hosted on a nonstandard project port",{...hosted,SUPABASE_URL:`https://${hostedRef}.supabase.co:8443`}],
      ["hosted over HTTP",{...hosted,SUPABASE_URL:`http://${hostedRef}.supabase.co`}],
      ["hosted through a custom Auth domain",{...hosted,SUPABASE_URL:"https://auth.example.test"}],
      ["hosted against a local stack",{...hosted,SUPABASE_URL:"http://127.0.0.1:55421"}],
      ["hosted with a preview site",{...hosted,SITE_URL:"https://preview.example.test"}],
      ["hosted with an HTTP site",{...hosted,SITE_URL:"http://app.example.test",MERCURIUS_INVITATION_SITE_ORIGIN:"http://app.example.test"}],
      ["hosted with a site path",{...hosted,SITE_URL:"https://app.example.test/portal"}],
      ["hosted with a site query",{...hosted,SITE_URL:"https://app.example.test/?next=https://attacker.invalid"}],
      ["hosted with a site port",{...hosted,SITE_URL:"https://app.example.test:8443",MERCURIUS_INVITATION_SITE_ORIGIN:"https://app.example.test:8443"}],
      ["hosted with a pin that is not an origin",{...hosted,MERCURIUS_INVITATION_SITE_ORIGIN:"https://app.example.test/"}],
      ["hosted with a loopback site",{...hosted,SITE_URL:"https://localhost",MERCURIUS_INVITATION_SITE_ORIGIN:"https://localhost"}],
      ["hosted with an IP site",{...hosted,SITE_URL:"https://203.0.113.7",MERCURIUS_INVITATION_SITE_ORIGIN:"https://203.0.113.7"}],
    ];
    for(const [label,overrides] of off) await withDelivery(overrides,async()=>{
      calls=[]; unexpected=[]; route=undefined;
      const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
      if(response.status!==503)throw new Error(`${label}: expected 503, got ${response.status}`);
      equal(await response.json(),{error:"INVITATION_DELIVERY_DISABLED",emailed:false});
      if(calls.length)throw new Error(`${label}: reached ${calls.join(", ")}`);
    });
  });
  Deno.test("invitation dispatch: pinned hosted mode redirects to the pinned site and records the receipt", async () => {
    await withDelivery(hosted,async()=>{
      calls=[]; unexpected=[]; const order:string[]=[];
      route=(url,init)=>{
        const auth=operatorRoute(url); if(auth)return auth;
        if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation"){order.push("claim");return json({claimed:true,recipient_email:"recipient@example.invalid"});}
        if(url.pathname==="/auth/v1/invite"){
          order.push("invite"); const sent=JSON.parse(String(init?.body));
          equal(sent.email,"recipient@example.invalid"); equal(sent.data,{invitation_attempt:attempt});
          equal(url.searchParams.get("redirect_to"),`https://app.example.test/set-password?invitation=${attempt}`);
          return json({user:{id:recipient}});
        }
        if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation"){order.push("receipt");equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_auth_user:recipient,p_actor:operator});return json(null);}
      };
      const response=await request({action:"send",attempt_id:attempt,email:"attacker@example.invalid",origin:"https://attacker.invalid",redirect_to:"https://attacker.invalid/set-password"},{Authorization:"Bearer synthetic-user-token"});
      equal(response.status,200); equal(await response.json(),{attempt_id:attempt,status:"provider_accepted",delivered:false,activated:false});
      equal(order,["claim","invite","receipt"]);
    });
  });
  Deno.test("invitation dispatch: hosted mode keeps the refusal and unknown contracts", async () => {
    const replies:[()=>Response,string,string[]][]=[
      [()=>json({code:422,error_code:"email_exists",msg:"synthetic"},422),"failed",["refuse"]],
      [()=>{throw new Error("Synthetic lost hosted response");},"unknown",["unknown"]],
    ];
    for(const [reply,expected,writes] of replies) await withDelivery(hosted,async()=>{
      calls=[]; unexpected=[]; const order:string[]=[];
      route=(url,init)=>{
        const auth=operatorRoute(url); if(auth)return auth;
        if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation")return json({claimed:true,recipient_email:"recipient@example.invalid"});
        if(url.pathname==="/auth/v1/invite"){order.push("invite");return reply();}
        if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation"){order.push("refuse");return json(null);}
        if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation"){order.push("unknown");equal(JSON.parse(String(init?.body)).p_auth_user,null);return json(null);}
      };
      const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
      equal(response.status,409); equal((await response.json()).status,expected); equal(order,["invite",...writes]);
    });
  });
  Deno.test("invitation dispatch: reserves first, uses snapshot recipient, and cannot resend", async () => {
    calls=[]; unexpected=[]; fixture.MERCURIUS_INVITATION_MODE="local-test";
    let claimed=false; const order:string[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation") {order.push("claim"); const first=!claimed; claimed=true; return json({claimed:first,recipient_email:"recipient@example.invalid",status:"submitted"});}
      if(url.pathname==="/auth/v1/invite") {
        order.push("invite"); const sent=JSON.parse(String(init?.body));
        equal(sent.email,"recipient@example.invalid");
        // The template builds the recipient link from Site URL plus this attempt.
        equal(sent.data,{invitation_attempt:attempt});
        equal(url.searchParams.get("redirect_to"),`http://localhost:3000/set-password?invitation=${attempt}`);
        return json({user:{id:recipient}});
      }
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation") {
        order.push("receipt"); equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_auth_user:recipient,p_actor:operator}); return json(null);
      }
    };
    let response=await request({action:"send",attempt_id:attempt,email:"attacker@example.invalid",origin:"https://attacker.invalid"},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,200); equal(await response.json(),{attempt_id:attempt,status:"provider_accepted",delivered:false,activated:false});
    response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409); await response.body?.cancel(); equal(order,["claim","invite","receipt","claim"]);
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation dispatch: uncertain Auth result is recorded without a retry", async () => {
    calls=[]; unexpected=[]; fixture.MERCURIUS_INVITATION_MODE="local-test"; let sends=0; let unknown=false;
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation")return json({claimed:true,recipient_email:"recipient@example.invalid"});
      if(url.pathname==="/auth/v1/invite") {sends++; throw new Error("Synthetic lost response");}
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation") {unknown=JSON.parse(String(init?.body)).p_auth_user===null; return json(null);}
    };
    const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409); equal((await response.json()).status,"unknown"); equal(sends,1); equal(unknown,true);
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation dispatch: receipt failure cannot report successful delivery", async () => {
    calls=[]; unexpected=[]; fixture.MERCURIUS_INVITATION_MODE="local-test"; const receipts:unknown[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation")return json({claimed:true,recipient_email:"recipient@example.invalid"});
      if(url.pathname==="/auth/v1/invite")return json({user:{id:recipient}});
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation") {const payload=JSON.parse(String(init?.body));receipts.push(payload.p_auth_user);return payload.p_auth_user ? json({message:"synthetic receipt failure"},500):json(null);}
    };
    const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409); equal((await response.json()).status,"unknown"); equal(receipts,[recipient,null]);
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation acceptance: verified caller token reaches recipient-owned RPC", async () => {
    calls=[];unexpected=[];
    route=(url,init)=>{
      if(url.pathname==="/auth/v1/user")return json({id:recipient});
      if(url.pathname==="/rest/v1/rpc/vendor_accept_invitation") {
        equal(new Headers(init?.headers).get("authorization"),"Bearer synthetic-recipient-token");
        equal(JSON.parse(String(init?.body)),{p_attempt:attempt}); return json(null);
      }
    };
    const response=await request({action:"accept",attempt_id:attempt,auth_user_id:operator},{Authorization:"Bearer synthetic-recipient-token"});
    equal(response.status,200);equal(await response.json(),{status:"accepted",activated:false});equal(calls.length,2);
  });
  Deno.test("invitation reconciliation: reads exact Auth user ID and records authenticated operator", async () => {
    calls=[];unexpected=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname===`/auth/v1/admin/users/${recipient}`)return json({user:{id:recipient}});
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation") {equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_auth_user:recipient,p_actor:operator});return json(null);}
    };
    const response=await request({action:"reconcile",attempt_id:attempt,auth_user_id:recipient},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,200); await response.body?.cancel();equal(calls.some(call=>call.endsWith("/auth/v1/invite")),false);
  });
  // TRACE-063 forward fix. The refusal body mirrors local GoTrue's observed response.
  const refused=()=>json({code:422,error_code:"email_exists",msg:"A user with this email address has already been registered"},422);
  Deno.test("invitation dispatch: Auth's existing-account refusal is recorded as failed, once, never unknown", async () => {
    calls=[];unexpected=[];fixture.MERCURIUS_INVITATION_MODE="local-test";const order:string[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation"){order.push("claim");return json({claimed:true,recipient_email:"recipient@example.invalid"});}
      if(url.pathname==="/auth/v1/invite"){order.push("invite");return refused();}
      if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation"){order.push("refuse");equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_code:"email_exists",p_actor:operator});return json(null);}
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation"){order.push("finish");return json(null);}
    };
    const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409);equal(await response.json(),{error:"INVITATION_RECIPIENT_HAS_ACCOUNT",status:"failed",dispatched:false});
    equal(order,["claim","invite","refuse"]);
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation dispatch: an unrecorded refusal falls back to unknown without a retry", async () => {
    calls=[];unexpected=[];fixture.MERCURIUS_INVITATION_MODE="local-test";const order:string[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation")return json({claimed:true,recipient_email:"recipient@example.invalid"});
      if(url.pathname==="/auth/v1/invite"){order.push("invite");return refused();}
      if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation"){order.push("refuse");return json({message:"synthetic refusal write failure"},500);}
      if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation"){order.push("unknown");equal(JSON.parse(String(init?.body)).p_auth_user,null);return json(null);}
    };
    const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409);equal((await response.json()).status,"unknown");equal(order,["invite","refuse","unknown"]);
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation dispatch: other Auth errors are not treated as refusals", async () => {
    for(const [status,code] of [[422,"validation_failed"],[500,"email_exists"],[429,"over_email_send_rate_limit"]] as const){
      calls=[];unexpected=[];fixture.MERCURIUS_INVITATION_MODE="local-test";const order:string[]=[];
      route=(url)=>{
        const auth=operatorRoute(url); if(auth)return auth;
        if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation")return json({claimed:true,recipient_email:"recipient@example.invalid"});
        if(url.pathname==="/auth/v1/invite"){order.push("invite");return json({code:status,error_code:code,msg:"synthetic"},status);}
        if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation"){order.push("refuse");return json(null);}
        if(url.pathname==="/rest/v1/rpc/vendor_finish_invitation"){order.push("unknown");return json(null);}
      };
      const response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
      equal(response.status,409);equal((await response.json()).status,"unknown");equal(order,["invite","unknown"]);
    }
    delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation refusal reconciliation: reads the exact account ID, never re-invites", async () => {
    calls=[];unexpected=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname===`/auth/v1/admin/users/${recipient}`)return json({user:{id:recipient}});
      if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation"){equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_code:"email_exists",p_actor:operator,p_existing_account:recipient});return json(null);}
    };
    let response=await request({action:"refuse",attempt_id:attempt,auth_user_id:recipient},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,200);equal(await response.json(),{status:"failed",refusal:"email_exists",dispatched:false});
    equal(calls.some(call=>call.endsWith("/auth/v1/invite")),false);
    response=await request({action:"refuse",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,400);await response.body?.cancel();
    route=(url)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname===`/auth/v1/admin/users/${recipient}`)return json({user:{id:recipient}});
      if(url.pathname==="/rest/v1/rpc/vendor_refuse_invitation")return json({message:"Auth refusal evidence mismatch"},400);
    };
    response=await request({action:"refuse",attempt_id:attempt,auth_user_id:recipient},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,409);equal(await response.json(),{error:"INVITATION_REFUSAL_NOT_PROVEN"});
  });
  // TRACE-105: existing-provider access uses the same transport with its own evidence functions.
  Deno.test("existing-provider access: hosted send claims, invites with the reviewed kind and records the receipt", async () => {
    await withDelivery(hosted,async()=>{
      calls=[]; unexpected=[]; const order:string[]=[];
      route=(url,init)=>{
        const auth=operatorRoute(url); if(auth)return auth;
        if(url.pathname==="/rest/v1/rpc/r0_claim_provider_access"){order.push("claim");return json({claimed:true,recipient_email:"owner@example.invalid",business_name:"Synthetic Legacy Co"});}
        if(url.pathname==="/auth/v1/invite"){
          order.push("invite"); const sent=JSON.parse(String(init?.body));
          equal(sent.email,"owner@example.invalid");
          equal(sent.data,{invitation_attempt:attempt,invitation_kind:"existing_provider",business_name:"Synthetic Legacy Co"});
          equal(url.searchParams.get("redirect_to"),`https://app.example.test/set-password?invitation=${attempt}`);
          return json({user:{id:recipient}});
        }
        if(url.pathname==="/rest/v1/rpc/r0_finish_provider_access"){order.push("receipt");equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_auth_user:recipient,p_actor:operator});return json(null);}
      };
      const response=await request({action:"send",source:"existing_provider",attempt_id:attempt,email:"attacker@example.invalid"},{Authorization:"Bearer synthetic-user-token"});
      equal(response.status,200); equal(await response.json(),{attempt_id:attempt,status:"provider_accepted",delivered:false,activated:false});
      equal(order,["claim","invite","receipt"]);
      equal(calls.some(call=>call.includes("/rpc/vendor_")),false);
    });
  });
  Deno.test("existing-provider access: an address that already holds an account is recorded as refused", async () => {
    await withDelivery(hosted,async()=>{
      calls=[]; unexpected=[]; const order:string[]=[];
      route=(url,init)=>{
        const auth=operatorRoute(url); if(auth)return auth;
        if(url.pathname==="/rest/v1/rpc/r0_claim_provider_access")return json({claimed:true,recipient_email:"owner@example.invalid",business_name:"Synthetic Legacy Co"});
        if(url.pathname==="/auth/v1/invite")return json({code:422,error_code:"email_exists",msg:"synthetic"},422);
        if(url.pathname==="/rest/v1/rpc/r0_refuse_provider_access"){order.push("refuse");equal(JSON.parse(String(init?.body)),{p_attempt:attempt,p_code:"email_exists",p_actor:operator});return json(null);}
        if(url.pathname==="/rest/v1/rpc/r0_finish_provider_access"){order.push("finish");return json(null);}
      };
      const response=await request({action:"send",source:"existing_provider",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
      equal(response.status,409); equal(await response.json(),{error:"INVITATION_RECIPIENT_HAS_ACCOUNT",status:"failed",dispatched:false});
      equal(order,["refuse"]);
    });
  });
  Deno.test("existing-provider access: preparation names an existing account only by exact ID", async () => {
    calls=[]; unexpected=[]; const prepared:unknown[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/r0_prepare_provider_access"){prepared.push(JSON.parse(String(init?.body)));return json({attempt_id:attempt,mode:"existing_account",status:"prepared",created:true});}
    };
    const expires=new Date(Date.now()+86400000).toISOString();
    let response=await request({action:"prepare",source:"existing_provider",contractor_id:attempt,business_key:"k1",expires_at:expires,existing_account_id:"owner@example.invalid"},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,400); await response.body?.cancel();
    response=await request({action:"prepare",source:"existing_provider",contractor_id:attempt,business_key:"k1",expires_at:expires,existing_account_id:recipient},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,200); equal(await response.json(),{attempt_id:attempt,mode:"existing_account",status:"prepared",emailed:false});
    equal(prepared,[{p_contractor:attempt,p_key:"k1",p_expires:expires,p_existing_account:recipient}]);
    equal(calls.some(call=>call.includes("/auth/v1/invite")),false);
  });
  Deno.test("existing-provider access: the recipient's acceptance routes to the access receipt", async () => {
    calls=[]; unexpected=[]; let accepted=false;
    route=(url)=>{
      if(url.pathname==="/auth/v1/user")return json({id:recipient});
      if(url.pathname==="/rest/v1/rpc/r0_accept_provider_access"){accepted=true;return json({status:"accepted",recorded:true});}
    };
    const response=await request({action:"accept",source:"existing_provider",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,200); equal(await response.json(),{status:"accepted",activated:false}); equal(accepted,true);
    equal(calls.some(call=>call.includes("/rpc/vendor_accept_invitation")||call.includes("/rpc/has_role")),false);
  });
  Deno.test("existing-provider access: an unknown source is refused before any call", async () => {
    calls=[]; unexpected=[]; route=undefined;
    const response=await request({action:"send",source:"legacy",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,400); await response.body?.cancel(); equal(calls,[]);
  });
}
