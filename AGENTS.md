<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Mercurius implementation authority

This is an inherited production-intent marketplace. Repository behavior is evidence; it is not permission to redefine the product.

Read these authorities before implementation work:

1. `governance/OWNER-APPROVALS.md`
2. `governance/CONFIGURATION-DECISIONS.md`
3. `mps/PROPOSED-MPS.md`
4. `mds/DESIGN-SYSTEM-BLUEPRINT.md`
5. `mts/TECHNOLOGY-BLUEPRINT.md`
6. `roadmap/MERCURIUS-REBUILD-ROADMAP.md`

Authority order is **MPS → MDS → MTS → implementation evidence**. When files conflict, stop and record the conflict; do not silently choose whichever existing code path is easiest.

## Required working behavior

- Work in one bounded roadmap slice at a time.
- Link material changes to a traceability entry and acceptance evidence.
- Preserve existing data and unrelated owner changes.
- Characterize existing behavior before replacing it.
- Use additive, reviewed database migrations and forward fixes.
- Never copy production customer data into source, fixtures, screenshots, logs, or chat.
- Never commit or print secrets. Use `.env.example` for names and descriptions only.
- Do not modify production accounts, schema, data, billing, DNS, or webhooks without explicit owner authorization for that external action.
- Product state, role, price, fee, payout, matching, cancellation, support, retention, and design semantics come from approved authorities—not page-local invention.
- A change is complete only when its required automated and manual acceptance evidence exists.

## Approved launch configuration

- Geography: all Lee County, Florida ZIP codes through the authoritative backend allowlist.
- Catalog: all services remain visible; unavailable supply displays “Not available yet in your area” and is not bookable.
- Vendors: every approved and otherwise eligible vendor participates.
- Platform fee: 15% of final service subtotal after discounts/adjustments, excluding tax and tips.
- Customer payment: customers pay Mercurius; Mercurius remits provider proceeds.
- Provider payout: weekly direct ACH, eligible 48 hours after homeowner-confirmed completion; disputes held; no Stripe Connect payout design.
- Full policy details live in `governance/CONFIGURATION-DECISIONS.md`.
