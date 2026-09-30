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
  current_quote_id: status === "quoted" ? "00000000-0000-4000-8000-000000000099" : null,
  quote_revision: status === "quoted" ? 1 : 0, quote_status: status === "quoted" ? "submitted" : null,
  quote_expires_at: status === "quoted" ? new Date(now.getTime() + 24 * 3600000).toISOString() : null,
  quote_amount: 120, notes: "Synthetic internal note", needs_admin_review: false,
  match_attempt_count: 1, declined_contractor_ids: [], matching_status: "offered",
  preferred_contractor_id: null, package_question_answers: {},
  service_catalog_id: suffix === "11" ? "synthetic-pool-service" : null,
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
  // TRACE-103 R0 readbacks: closed by default (no admission, no interest); specs override per case.
  if (url.pathname === "/rest/v1/rpc/r0_my_trial_access") return send({ homeowner: user.testRole === "homeowner", cells: [] });
  if (url.pathname === "/rest/v1/rpc/r0_my_interest") return send({ verified: true, interests: [], marketing_opted_in: false });
  // TRACE-104 (R0.4) readbacks. Operator reads refuse non-admin sessions like the database.
  if (url.pathname === "/rest/v1/rpc/get_contractor_contact") return send([{ email: "vendor@example.invalid", phone: "synthetic" }]);
  // Count-only reads (the vendor gallery) arrive as HEAD with the total in Content-Range.
  if (request.method === "HEAD") { response.setHeader("Content-Range", "*/0"); response.statusCode = 200; return response.end(); }
  if (url.pathname === "/rest/v1/rpc/r0_public_providers") return send([]);
  if (url.pathname === "/rest/v1/rpc/r0_my_provider_listing") return send(user.testRole !== "vendor" ? { linked: false } : {
    linked: true, contractor_id: contractor, listed: false, active: true, accepting_work: true, approved: true, held: false,
    has_name: true, has_description: false, has_catalog_service: true, service_zips: ["33904"] });
  if (/\/rpc\/r0_(application_notification_overview|invitation_attention|public_listing_inventory|provider_access_queue)$/.test(url.pathname) && user.testRole !== "admin") {
    return send({ code: "42501", message: "Onboarding operator required" }, 403);
  }
  // TRACE-105 readbacks: archived provider ids and existing-provider access queue.
  if (url.pathname === "/rest/v1/rpc/r0_excluded_provider_ids") return send(user.testRole === "admin" ? ["00000000-0000-4000-8000-000000000070"] : []);
  if (url.pathname === "/rest/v1/rpc/r0_provider_access_queue") return send({ checked_at: now.toISOString(), items: [
    { contractor_id: "00000000-0000-4000-8000-000000000071", name: "Synthetic Legacy Services", email: "owner@example.invalid",
      account_linked: false, bound_by_access: false, attempt_id: "00000000-0000-4000-8000-000000000072", mode: "new_account",
      status: "accepted", dispatch_state: "provider_accepted", expires_at: new Date(now.getTime() + 86400000).toISOString(),
      accepted: true, attention: "awaiting_binding" },
  ] });
  if (url.pathname === "/rest/v1/rpc/r0_application_notification_overview") return send({ checked_at: now.toISOString(), stale_after_minutes: 10, items: [
    { application_id: "00000000-0000-4000-8000-000000000050", business_name: "Synthetic Applicant Services", application_status: "pending",
      submitted_at: now.toISOString(), state: "failed", attempts: 1, last_error: "Resend returned 422: invalid from address.", sent_at: null,
      requested_at: null, acknowledged_at: null, acknowledged_reason: null, updated_at: now.toISOString(), needs_attention: true },
    { application_id: "00000000-0000-4000-8000-000000000051", business_name: "Synthetic Uncertain Services", application_status: "pending",
      submitted_at: now.toISOString(), state: "unknown", attempts: 1, last_error: null, sent_at: null,
      requested_at: null, acknowledged_at: null, acknowledged_reason: null, updated_at: now.toISOString(), needs_attention: true },
    { application_id: "00000000-0000-4000-8000-000000000052", business_name: "Synthetic Delivered Services", application_status: "pending",
      submitted_at: now.toISOString(), state: "sent", attempts: 1, last_error: null, sent_at: now.toISOString(),
      requested_at: null, acknowledged_at: null, acknowledged_reason: null, updated_at: now.toISOString(), needs_attention: false },
  ] });
  if (url.pathname === "/rest/v1/rpc/r0_invitation_attention") return send({ checked_at: now.toISOString(), items: [
    { attempt_id: "00000000-0000-4000-8000-000000000060", contractor_id: contractor, application_id: "00000000-0000-4000-8000-000000000050",
      business_name: "Synthetic Vendor", attempt_status: "unknown", dispatch_state: "unknown", onboarding_status: "review",
      created_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString(), reason: "uncertain" },
  ] });
  if (url.pathname === "/rest/v1/rpc/r0_public_listing_inventory") return send({ checked_at: now.toISOString(), items: [
    { contractor_id: contractor, name: "Synthetic Vendor", is_active: true, marketing_enabled: true, account_linked: true,
      onboarding_status: "active", eligible: true, has_content: true, listable: true, excluded: false, exclusion_reason: null,
      excluded_at: null, test_signal: false, featured: false, request_count: 2, invoice_count: 1, review_count: 0 },
    { contractor_id: "00000000-0000-4000-8000-000000000070", name: "Test Vendor Demo", is_active: true, marketing_enabled: true,
      account_linked: false, onboarding_status: null, eligible: true, has_content: false, listable: false, excluded: false,
      exclusion_reason: null, excluded_at: null, test_signal: true, featured: false, request_count: 0, invoice_count: 0, review_count: 0 },
  ] });
  if (url.pathname === "/rest/v1/rpc/vendor_compliance_operations") return send({
    evaluated_at: new Date().toISOString(),
    control: { enforced: false, finalized_at: null, reason: null },
    providers: [{ id: contractor, name: "Synthetic Vendor", active: true, marketing_enabled: true,
      onboarding_status: "active", onboarding_revision: 2, application_id: "00000000-0000-4000-8000-000000000040",
      documents: ["synthetic-vendor/license.pdf", "synthetic-vendor/insurance.pdf"], generic_current: true,
      scoped_current: false, decision: null, decision_reason: null, service_ids: ["lawn"], zip_codes: ["33904"] }],
    requirements: [
      { id: "00000000-0000-4000-8000-000000000041", service_id: "lawn", service_name: "Lawn care", zip_code: "33904", kind: "license", version: "LEE-2026", description: "Reviewed license", effective_at: now.toISOString(), expires_at: null },
      { id: "00000000-0000-4000-8000-000000000042", service_id: "lawn", service_name: "Lawn care", zip_code: "33904", kind: "insurance", version: "LEE-2026", description: "Reviewed insurance", effective_at: now.toISOString(), expires_at: null },
    ],
    evidence: [],
    bindings: [{ requirement_id: "00000000-0000-4000-8000-000000000041", contractor_id: contractor,
      current: true, evidence_id: "00000000-0000-4000-8000-000000000043", evidence_ref: "synthetic-vendor/license.pdf",
      accepted_at: now.toISOString(), expires_at: new Date(now.getTime() + 86400000).toISOString() }],
    services: [{ id: "lawn", name: "Lawn care" }], areas: [{ zip_code: "33904", city: "Cape Coral" }],
  });
  if (url.pathname === "/rest/v1/rpc/vendor_onboarding_intake_status") return send({
    application_id: body.p_application, application_status: "pending",
    latest_version_id: "00000000-0000-4000-8000-000000000051", latest_revision: 1,
    contractor_id: null, onboarding_status: null, onboarding_revision: null,
    onboarding_version_id: null, review_started: false,
  });
  if (url.pathname === "/rest/v1/rpc/vendor_account_link_overview") return send({
    contractor_id: body.p_contractor, onboarding_status: "review", onboarding_revision: 1,
    application_id: "00000000-0000-4000-8000-000000000050",
    application_version_id: "00000000-0000-4000-8000-000000000051", version_current: true,
    recipient_email: "applicant@example.invalid", recipient_valid: true,
    linked: false, linked_user_id: null, linked_email: null, link_reviewed: false, link_source: null,
    accepted_invitation: null, invitation_live: false, vendor_role_held: false, vendor_role_from_activation: false,
    decisions: [], role_decisions: [],
  });
  if (url.pathname === "/rest/v1/rpc/vendor_onboarding_checklist") return send({
    contractor_id: body.p_contractor, onboarding_status: "review", onboarding_revision: 1,
    application_version_id: "00000000-0000-4000-8000-000000000051", version_current: true, application_open: true,
    documents: ["synthetic/applicant/license.pdf", "synthetic/applicant/insurance.pdf"],
    checklist_current: false, eligible: false, scoped_compliance_current: false, cutover_enforced: false,
    account_linked: false, account_reviewed: false, account_email: null, vendor_role_held: false,
    evaluated_at: new Date().toISOString(),
    items: ["identity", "agreement", "coverage", "license", "insurance", "bank_authorization", "profile_pricing", "availability", "test_notification"]
      .map(kind => ({ kind, evidence_id: null, requirement_version: null, evidence_ref: null, accepted_at: null, expires_at: null, state: "missing" })),
    events: [], last_role_decision: null,
  });
  if (url.pathname === "/rest/v1/rpc/vendor_invitation_overview") return send({
    contractor_id: body.p_contractor, onboarding_status: "review", onboarding_revision: 1,
    application_id: "00000000-0000-4000-8000-000000000050",
    application_version_id: "00000000-0000-4000-8000-000000000051", version_current: true,
    recipient_email: "applicant@example.invalid", recipient_valid: true, account_linked: false, recipient_account_id: null,
    attempt: null, prior_attempts: [],
  });
  // TRACE-073 renewal documents: empty by default; specs override per case.
  if (url.pathname === "/rest/v1/rpc/vendor_renewal_document_overview") return send({
    contractor_id: body.p_contractor, onboarding_status: "review", open_limit: 5, documents: [],
  });
  if (url.pathname === "/rest/v1/rpc/vendor_renewal_document_queue") return send({ evaluated_at: new Date().toISOString(), entries: [] });
  if (url.pathname === "/rest/v1/rpc/vendor_own_renewal_documents") return send({ accepting: false, open_limit: 5, documents: [] });
  // TRACE-076/078/079/080/082 finance commands: nothing open by default; specs override per case.
  if (url.pathname === "/rest/v1/rpc/money_finance_operations") return send({ evaluated_at: new Date().toISOString(), requests: [], holds: [], readbacks: [], events: [], refunds: [], refund_releases: [], late_refunds: [], cancellations: [], chargebacks: [],
    ach: { next_period_start: null, ready: [], batches: [] }, recoveries: { owed_total: 0, owed: [], withdrawn: [], late_settlements: [] },
    repayment_returns: { returnable_total: 0, payouts: [] },
    statements: { today: new Date().toISOString().slice(0, 10), statements: [], unevidenced: [] } });
  // TRACE-074 document retention: empty by default; specs override per case.
  if (url.pathname === "/rest/v1/rpc/vendor_document_retention_queue") return send({
    evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, due: [], quarantined: [], holds: [],
  });
  // TRACE-084 application document retention: empty by default; specs override per case.
  if (url.pathname === "/rest/v1/rpc/vendor_application_retention_queue") return send({
    evaluated_at: new Date().toISOString(), retention_days: 90, quarantine_days: 14, unattached_days: 7, upload_grant_hours: 2,
    due: [], unattached_due: [], quarantined: [], kept: [], unattached_kept: [], unrecorded: [], holds: [],
  });
  if (url.pathname === "/rest/v1/rpc/vendor_application_retention_overview") return send({
    application_id: body.p_application, application_status: "pending", has_provider: false, closure: null, closable: true,
    close_outcomes: ["rejected", "abandoned"], retention_days: 90, quarantine_days: 14, unattached_days: 7, hold: null, provider_held: false,
    files: [], unattached_files: [],
  });
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
    if (table === "money_obligations") return send({ current_snapshot_id: '00000000-0000-4000-8000-000000000030', captured: 0, refunded_service: 0, refunded_tax: 0, refunded_tip: 0, service_request_id: '00000000-0000-4000-8000-000000000011' });
    if (table === "user_roles") return send([{ role: user.testRole }]);
    if (table === "invoices") return send([{ id: "00000000-0000-4000-8000-000000000020", invoice_number: "MDS-INV-001", amount: 125, status: "pending", created_at: now.toISOString(), paid_at: null }]);
    if (table === "reviews") return send([]);
    if (["vendor_packages", "services_catalog", "contractor_gallery"].includes(table)) return send([]);
    if (table === "completion_evidence_rules") return send(url.searchParams.get("service_id") === "eq.synthetic-pool-service" ? [{ minimum_photos: 2 }] : []);
    if (table === "vendor_applications") return send([{
      id: "00000000-0000-4000-8000-000000000050", first_name: "Synthetic", last_name: "Applicant",
      business_name: "Synthetic Applicant Services", email: "applicant@example.invalid", phone: "synthetic",
      address: null, services: ["Lawn care"], years_experience: 4, availability: null, service_areas: "33904",
      status: "pending", created_at: now.toISOString(), contractor_id: null, invited_user_id: null,
      invite_status: "not_invited", invited_at: null, invite_expires_at: null, activated_at: null, invite_error: null,
      primary_category: "Lawn care", team_size: null, business_description: null, website: null, preferred_contact: null,
      license_number: null, insurance_policy_number: null, credentials: [], other_certification: null,
      additional_notes: null, document_urls: [],
    }]);
    if (table === "service_requests") {
      const rows = user.testRole === "homeowner" ? [...jobs, job("12", "Synthetic Quote Service", "quoted"), job("13", "Synthetic Pending Service", "pending"), job("14", "Synthetic Review Service", "review_requested"), job("15", "Synthetic Completed Service", "vendor_completed")] : jobs;
      const id = url.searchParams.get("id");
      return send(id?.startsWith("eq.") ? rows.filter(row => row.id === id.slice(3)) : rows);
    }
    if (table === "profiles") return send([{ user_id: homeowner, full_name: "Synthetic Homeowner" }]);
    if (table === "contractors") {
      const rows = [{ id: contractor, user_id: users.vendor, name: "Synthetic Vendor", services: [], is_active: true }];
      return send(url.searchParams.has("user_id") ? rows[0] : rows);
    }
    if (["disputes", "job_match_attempts", "request_match_attempts", "messages", "job_messages", "notifications"].includes(table)) return send([]);
  }
  // Tests exercise persistent failure UI; never claim a real mutation succeeded.
  return send({ message: "Synthetic service unavailable. Please try again.", code: "FIXTURE_ONLY" }, 503);
});
server.listen(55831, "127.0.0.1", () => process.stdout.write("MDS fixture listening on 55831\n"));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
