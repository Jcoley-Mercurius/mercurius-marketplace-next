// TRACE-104 evidence: runs the catalog hook's package query as anonymous and signed-in users against a local stack
// loaded with r0-signed-in-catalog.sql. ANON and SVC are the local stack's demo keys (supabase status).
import { createClient } from "@supabase/supabase-js";
const url = "http://127.0.0.1:55421", anonKey = process.env.ANON, service = process.env.SVC;
const admin = createClient(url, service, { auth: { persistSession: false } });
const email = `home-${Date.now()}@example.test`, password = "Synthetic-pass-123";
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const signed = createClient(url, anonKey, { auth: { persistSession: false } });
const s = await signed.auth.signInWithPassword({ email, password }); if (s.error) throw s.error;
// Exactly the hook's package query.
const q = (c) => c.from("vendor_packages").select("id, service_id, name, contractor_id, contractors!inner(id, name, is_active)").eq("is_active", true).eq("needs_review", false).eq("contractors.is_active", true).eq("service_id", "rp-live");
const listed = async (c) => { const r = await c.rpc("r0_public_providers").select("id"); if (r.error) throw r.error; return new Set(r.data.map((p) => p.id)); };
for (const [label, c] of [["anonymous", anon], ["signed-in homeowner", signed]]) {
  const rows = (await q(c)).data;
  const ids = await listed(c);
  console.log(`${label}: before fix ${JSON.stringify(rows.map((r) => r.contractors.name))}; after fix ${JSON.stringify(rows.filter((r) => ids.has(r.contractor_id)).map((r) => r.contractors.name))}`);
}
await admin.auth.admin.deleteUser(created.data.user.id);
