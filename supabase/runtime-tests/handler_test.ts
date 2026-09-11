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
  Deno.test("invitation dispatch: disabled and hosted modes never reach Auth", async () => {
    calls=[]; unexpected=[]; route=undefined;
    let response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,503); await response.body?.cancel(); equal(calls,[]);
    fixture.MERCURIUS_INVITATION_MODE="local-test";
    const local=fixture.SUPABASE_URL; fixture.SUPABASE_URL="https://synthetic.supabase.co";
    response=await request({action:"send",attempt_id:attempt},{Authorization:"Bearer synthetic-user-token"});
    equal(response.status,503); await response.body?.cancel(); equal(calls,[]);
    fixture.SUPABASE_URL=local; delete fixture.MERCURIUS_INVITATION_MODE;
  });
  Deno.test("invitation dispatch: reserves first, uses snapshot recipient, and cannot resend", async () => {
    calls=[]; unexpected=[]; fixture.MERCURIUS_INVITATION_MODE="local-test";
    let claimed=false; const order:string[]=[];
    route=(url,init)=>{
      const auth=operatorRoute(url); if(auth)return auth;
      if(url.pathname==="/rest/v1/rpc/vendor_claim_invitation") {order.push("claim"); const first=!claimed; claimed=true; return json({claimed:first,recipient_email:"recipient@example.invalid",status:"submitted"});}
      if(url.pathname==="/auth/v1/invite") {
        order.push("invite"); equal(JSON.parse(String(init?.body)).email,"recipient@example.invalid");
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
}
