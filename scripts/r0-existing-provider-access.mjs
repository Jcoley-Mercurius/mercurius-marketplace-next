// TRACE-105 local end-to-end (synthetic data only). Requires the local stack and
// `supabase functions serve vendor-invite` with MERCURIUS_INVITATION_MODE=local-test, SITE_URL=http://localhost:3000,
// and (DEC-2026-029 follow-up) the site served against the local stack at SITE (default http://127.0.0.1:3200).
// Usage: ANON=<local anon key> SERVICE=<local service key> node scripts/r0-existing-provider-access.mjs
// Local end-to-end: real local Auth + mail sink + served vendor-invite. Synthetic data only.
// Prints facts, never tokens or links.
import { execSync } from "node:child_process";

const API = "http://127.0.0.1:55421";
const MAIL = "http://127.0.0.1:55424";
const SITE = process.env.SITE ?? "http://127.0.0.1:3200";
const ANON = process.env.ANON;
const SERVICE = process.env.SERVICE;
const DB = "postgresql://postgres:postgres@127.0.0.1:55422/postgres";
const run = Date.now().toString(36);
const operatorEmail = `operator.${run}@example.test`;
const ownerEmail = `owner.${run}@example.test`;
const otherEmail = `other.${run}@example.test`;
const psql = (sql) => execSync(`psql ${DB} -qAt -X -v ON_ERROR_STOP=1 -c ${JSON.stringify(sql)}`).toString().trim();
const results = [];
const check = (label, ok, detail = "") => { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`); };

async function http(path, { method = "POST", token, body, key = ANON } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}
const signIn = async (email, password) => (await http("/auth/v1/token?grant_type=password", { body: { email, password } })).data?.access_token;
const rpc = (name, args, token) => http(`/rest/v1/rpc/${name}`, { token, body: args });
const edge = (body, token) => http("/functions/v1/vendor-invite", { token, body });

// Fixtures: operator (admin) and a legacy provider with no application.
const created = await http("/auth/v1/admin/users", { key: SERVICE, body: { email: operatorEmail, password: `Op-${run}-pass!`, email_confirm: true } });
const operatorId = created.data.id;
psql(`insert into public.user_roles(user_id,role) values ('${operatorId}','admin')`);
const contractor = psql(`insert into public.contractors(name,bio,services,is_active,marketing_enabled) values ('Synthetic Legacy Lawn ${run}','Existing profile content','{lawn-mowing}',true,false) returning id`);
const other = psql(`insert into public.contractors(name,bio,services,is_active,marketing_enabled) values ('Synthetic Other ${run}','Other content','{lawn-mowing}',true,false) returning id`);
const operator = await signIn(operatorEmail, `Op-${run}-pass!`);

const contact = await rpc("r0_record_provider_contact", { p_contractor: contractor, p_email: ownerEmail.toUpperCase(), p_confirmation: "Synthetic owner confirmation", p_reason: "Local e2e", p_key: `e2e-contact-${run}` }, operator);
check("operator records the owner-confirmed contact", contact.status === 200 && contact.data?.recorded === true);
const expires = new Date(Date.now() + 7 * 86400000).toISOString();
const prepared = await edge({ source: "existing_provider", action: "prepare", contractor_id: contractor, business_key: `e2e-prep-${run}`, expires_at: expires }, operator);
check("prepare returns a new-account attempt and sends nothing", prepared.status === 200 && prepared.data?.mode === "new_account" && prepared.data?.emailed === false);
const attempt = prepared.data?.attempt_id;
const sent = await edge({ source: "existing_provider", action: "send", attempt_id: attempt }, operator);
check("send is recorded as provider accepted, not delivered", sent.status === 200 && sent.data?.status === "provider_accepted" && sent.data?.delivered === false, `HTTP ${sent.status}`);
const again = await edge({ source: "existing_provider", action: "send", attempt_id: attempt }, operator);
check("a second send is refused without contacting Auth", again.status === 409);

// Mailbox evidence from the local mail sink.
let message = null;
for (let i = 0; i < 20 && !message; i++) {
  const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + ownerEmail)}`)).json();
  if (list.messages?.length) message = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
  else await new Promise((r) => setTimeout(r, 500));
}
check("the email arrived in the recipient mailbox (local sink)", !!message);
const html = (message?.HTML ?? "").replace(/\s+/g, " ");
check("subject is the reviewed subject", message?.Subject === "Set up your Mercurius provider account", message?.Subject);
check("email names the existing business profile", html.includes(`Synthetic Legacy Lawn ${run}`));
check("email says the recipient chooses their own password", /choose your\s+own password/.test(html));
check("email separates setup from compliance approval and listing", /separate from Mercurius(&#39;|'|’)s compliance review/.test(html) && /does not approve your business/.test(html));
check("email states the link lifetime and support contact", /works until your invitation expires/.test(html) && !/24 hours/.test(html) && html.includes("hello@mercuriusmarketplace.com"));
check("email has no application wording", !/reviewing your application/.test(html));
check("email promises no jobs, booking, Founding Vendor or Credits", !/(Founding|Credits|jobs are|booking is open|you will be listed)/i.test(html));
const href = (html.match(/href="([^"]*invitation\/open[^"]*)"/) ?? [])[1]?.replace(/&amp;/g, "&");
const link = href ? new URL(href) : null;
check("link targets the site's /invitation/open with the access kind and a key", !!link && link.origin === "http://localhost:3000" && link.pathname === "/invitation/open"
  && link.searchParams.get("kind") === "existing_provider" && link.searchParams.get("invitation") === attempt && /^[A-Za-z0-9_-]{43}$/.test(link.searchParams.get("key") ?? ""));
check("the email carries no Auth token", !/token_hash/.test(html));
const opens = () => psql(`select count(*) from private.provider_invitation_opens where attempt_id='${attempt}'`);
const page = await fetch(`${SITE}${link?.pathname}${link?.search}`);
check("loading the link's page (as a mail scanner would) spends nothing", page.status === 200 && opens() === "0", `HTTP ${page.status}`);
const openLink = async () => {
  const res = await fetch(`${SITE}/api/invitations/open`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitation: link?.searchParams.get("invitation"), kind: link?.searchParams.get("kind"), key: link?.searchParams.get("key") }) });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};
// Day 3 of the invitation: the 24-hour Auth link would be dead; the Mercurius link is not.
psql(`update private.r0_provider_access_dispatches set started_at=now()-interval '3 days', resolved_at=now()-interval '3 days' where attempt_id='${attempt}'`);
const opened = await openLink();
const minted = opened.data?.redirect ? new URL(opened.data.redirect, SITE) : null;
check("on day 3 Continue mints a fresh sign-in for the password step", opened.status === 200 && minted?.pathname === "/set-password"
  && minted.searchParams.get("type") === "magiclink" && minted.searchParams.get("kind") === "existing_provider" && opens() === "1", `HTTP ${opened.status}`);
const tokenHash = minted?.searchParams.get("token_hash");

// Recipient: verify (POST, scanner-safe), reuse refused, set password, accept.
const verified = await http("/auth/v1/verify", { body: { type: "magiclink", token_hash: tokenHash } });
const recipientToken = verified.data?.access_token;
check("the minted sign-in verifies by POST and confirms the address", verified.status === 200 && !!recipientToken && !!verified.data?.user?.email_confirmed_at);
const reused = await http("/auth/v1/verify", { body: { type: "magiclink", token_hash: tokenHash } });
check("the same sign-in cannot be reused", reused.status >= 400, `HTTP ${reused.status}`);
const wrongKey = await (async () => { const real = link?.searchParams.get("key"); link?.searchParams.set("key", "B".repeat(43)); const r = await openLink(); link?.searchParams.set("key", real ?? ""); return r; })();
check("a wrong key is refused with the generic message", wrongKey.status === 410 && /no longer valid/.test(wrongKey.data?.error ?? ""));
const password = `Owner-${run}-pass!`;
const setPw = await http("/auth/v1/user", { method: "PUT", token: recipientToken, body: { password } });
check("the recipient chooses a password", setPw.status === 200);
const early = await rpc("r0_bind_provider_access", { p_contractor: contractor, p_attempt: attempt, p_reason: "too early", p_key: `e2e-early-${run}` }, operator);
check("binding is refused before acceptance", early.status >= 400 && /Accepted access invitation required/.test(JSON.stringify(early.data)));
const wrongSource = await edge({ action: "accept", attempt_id: attempt }, recipientToken);
check("the application accept path does not accept an access attempt", wrongSource.status === 409);
const accepted = await edge({ source: "existing_provider", action: "accept", attempt_id: attempt }, recipientToken);
check("the recipient explicitly accepts", accepted.status === 200 && accepted.data?.status === "accepted" && accepted.data?.activated === false);
const afterAcceptance = await openLink();
check("the link stops working once the invitation is accepted", afterAcceptance.status === 410);
check("acceptance removes the key from the account's metadata", psql(`select (raw_user_meta_data ? 'invitation_key')::text from auth.users where lower(email)=lower('${ownerEmail}')`) === "false");
check("acceptance is recorded once with no link or vendor role", psql(`select count(*) from private.r0_provider_access_acceptances where attempt_id='${attempt}'`) === "1"
  && psql(`select coalesce(user_id::text,'none') from public.contractors where id='${contractor}'`) === "none");

// Operator binding and resulting access.
const bound = await rpc("r0_bind_provider_access", { p_contractor: contractor, p_attempt: attempt, p_reason: "Owner-confirmed contact accepted (local e2e)", p_key: `e2e-bind-${run}` }, operator);
check("operator binds the accepted account to the exact profile", bound.status === 200 && bound.data?.vendor_role_granted === true);
const vendor = await signIn(ownerEmail, password);
const role = await rpc("has_role", { _user_id: bound.data?.auth_user_id, _role: "vendor" }, vendor);
check("the vendor signs in with the chosen password and holds the vendor role", !!vendor && role.data === true);
const mine = await rpc("r0_my_provider_listing", {}, vendor);
check("portal readback: setup access, not approved, not listed", mine.data?.setup_access === true && mine.data?.approved === false && mine.data?.listed === false);
const own = await http(`/rest/v1/contractors?id=eq.${contractor}`, { method: "PATCH", token: vendor, body: { tagline: "Set up by owner" } });
check("the vendor edits its own profile", own.status < 300);
const flags = await http(`/rest/v1/contractors?id=eq.${contractor}`, { method: "PATCH", token: vendor, body: { marketing_enabled: true } });
check("the vendor cannot turn on its own listing flag", flags.status >= 400);
await http(`/rest/v1/contractors?id=eq.${other}`, { method: "PATCH", token: vendor, body: { bio: "hijack" } });
check("the vendor cannot edit another provider", psql(`select bio from public.contractors where id='${other}'`) === "Other content");
const job = await rpc("vendor_accept_job", { _job_id: crypto.randomUUID() }, vendor);
check("the vendor has no job to accept", job.status >= 400);
const queue = await rpc("r0_provider_access_queue", {}, vendor);
check("the vendor cannot read other providers' access records", queue.status >= 400);
const listed = await http(`/rest/v1/rpc/r0_public_providers`, { body: { p_contractor: contractor } });
check("the provider is not in the public directory", Array.isArray(listed.data) && listed.data.length === 0);
const checkout = await rpc("money_prepare_checkout", { p_snapshot: crypto.randomUUID(), p_mode: "full" }, vendor);
check("checkout stays refused for this account", checkout.status === 403 && checkout.data?.code === "42501" && checkout.data?.message === "Homeowner authorization required");

// Existing-account handling: a new-account invitation to a registered address.
await http("/auth/v1/admin/users", { key: SERVICE, body: { email: otherEmail, password: `Other-${run}-pass!`, email_confirm: true } });
await rpc("r0_record_provider_contact", { p_contractor: other, p_email: otherEmail, p_confirmation: "Synthetic", p_reason: "Local e2e", p_key: `e2e-contact2-${run}` }, operator);
const p2 = await edge({ source: "existing_provider", action: "prepare", contractor_id: other, business_key: `e2e-prep2-${run}`, expires_at: expires }, operator);
const s2 = await edge({ source: "existing_provider", action: "send", attempt_id: p2.data?.attempt_id }, operator);
check("Auth refuses a registered address; recorded as refused, nothing sent", s2.status === 409 && s2.data?.error === "INVITATION_RECIPIENT_HAS_ACCOUNT"
  && psql(`select status from private.r0_provider_access_attempts where id='${p2.data?.attempt_id}'`) === "failed");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
