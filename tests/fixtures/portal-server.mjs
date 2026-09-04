// Isolated HTTP fixture for browser tests, never imported by application code.
// Binds its own port or fails; no forwarding, database, scheduler or credentials.
import { createServer } from "node:http";

const homeowner = "00000000-0000-4000-8000-000000000001";
const contractor = "00000000-0000-4000-8000-000000000002";
const users = {
  admin: "00000000-0000-4000-8000-000000000003",
  vendor: "00000000-0000-4000-8000-000000000004",
  homeowner,
};
function identity(request) {
  try {
    const payload = JSON.parse(Buffer.from((request.headers.authorization ?? "").split(".")[1], "base64url").toString());
    return payload.fixture === "mds-only" && users[payload.testRole] === payload.sub ? payload : null;
  } catch { return null; }
}
const now = new Date();
const job = (suffix, service, status) => ({
  id: `00000000-0000-4000-8000-0000000000${suffix}`, customer_id: homeowner, contractor_id: contractor,
  service_type: service, description: "Synthetic scope for accessibility verification.", status,
  address: "123 Synthetic Test Lane", city: "Cape Coral", state: "FL", zip_code: "33904",
  preferred_date: now.toISOString().slice(0, 10), preferred_time: "Morning",
  created_at: now.toISOString(), updated_at: now.toISOString(), assigned_at: now.toISOString(),
  match_expires_at: new Date(now.getTime() + 4 * 3600000).toISOString(),
  pricing_mode: "fixed", quote_only: false, payment_status: "paid", total_amount: 120,
  quote_amount: 120, notes: "Synthetic internal note", needs_admin_review: false,
  match_attempt_count: 1, declined_contractor_ids: [], matching_status: "offered",
  preferred_contractor_id: null, package_question_answers: {},
});
const jobs = [job("10", "Synthetic Lawn Service", "matched"), job("11", "Synthetic Pool Service", "in_progress")];

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:55831");
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3103");
  response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, prefer, range, x-supabase-api-version");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Content-Type", "application/json");
  const send = (body, status = 200) => { response.statusCode = status; response.end(JSON.stringify(body)); };
  if (request.method === "OPTIONS") return send({});
  if (url.pathname === "/health") return send({ fixture: "mds-only" });
  const user = identity(request);
  if (!user) return send({ message: "Synthetic authentication required" }, 401);
  let body = {};
  if (request.method !== "GET") {
    let raw = "";
    for await (const part of request) raw += part;
    try { body = JSON.parse(raw || "{}"); } catch { /* File uploads fail below. */ }
  }
  if (url.pathname === "/auth/v1/user") return send({ id: user.sub, aud: "authenticated", role: "authenticated", email: `${user.testRole}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: now.toISOString() });
  if (url.pathname === "/rest/v1/rpc/has_role") return send(body._user_id === user.sub && body._role === user.testRole);
  if (url.pathname === "/rest/v1/rpc/expire_stale_matches") return send(null);
  if (/\/rpc\/(find_eligible_packages)/.test(url.pathname)) return send([]);
  if (url.pathname === "/functions/v1/list-payment-methods") return send({ payment_methods: [] });
  if (request.method === "GET") {
    const table = url.pathname.split("/").pop();
    if (table === "money_snapshots") {
      if (user.testRole !== 'homeowner') return send({ message: 'Synthetic owner mismatch' }, 404);
      const id = url.searchParams.get('id')?.replace('eq.', '') ?? '00000000-0000-4000-8000-000000000030';
      return send({ id, obligation_id: '00000000-0000-4000-8000-000000000031', invoice_number: 'M5-SYNTHETIC-001',
        service: 10000, addons: 2000, discount: 1000, adjustment: -1000, tax: 700, tip: 1000, deposit: 3000, total: 11700,
        policy_version: 'CFG-005 / synthetic-v1', expires_at: new Date(Date.now() + (id.endsWith('32') ? -3600000 : 3600000)).toISOString() });
    }
    if (table === "money_obligations") return send({ current_snapshot_id: '00000000-0000-4000-8000-000000000030', captured: 0, refunded_service: 0, refunded_tax: 0, refunded_tip: 0 });
    if (table === "user_roles") return send([{ role: user.testRole }]);
    if (table === "invoices") return send([{ id: "00000000-0000-4000-8000-000000000020", invoice_number: "MDS-INV-001", amount: 125, status: "pending", created_at: now.toISOString(), paid_at: null }]);
    if (table === "reviews") return send([]);
    if (table === "service_requests") return send(user.testRole === "homeowner" ? [...jobs, job("12", "Synthetic Quote Service", "quoted"), job("13", "Synthetic Pending Service", "pending"), job("14", "Synthetic Review Service", "review_requested")] : jobs);
    if (table === "profiles") return send([{ user_id: homeowner, full_name: "Synthetic Homeowner" }]);
    if (table === "contractors") {
      const rows = [{ id: contractor, user_id: users.vendor, name: "Synthetic Vendor", services: [], is_active: true }];
      return send(url.searchParams.has("user_id") ? rows[0] : rows);
    }
    if (["job_match_attempts", "request_match_attempts", "messages", "job_messages", "notifications"].includes(table)) return send([]);
  }
  // Tests exercise persistent failure UI; never claim a real mutation succeeded.
  return send({ message: "Synthetic service unavailable. Please try again.", code: "FIXTURE_ONLY" }, 503);
});
server.listen(55831, "127.0.0.1", () => process.stdout.write("MDS fixture listening on 55831\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
