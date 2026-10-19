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

## Architecture, implementation, and review

- Codex is the lead architect and code reviewer: define bounded slices, identify
  governing requirements and acceptance criteria, and review implementation diffs
  and verification evidence.
- Claude implements the slices: follow the agreed scope, update code and relevant
  tests/documentation, and return a reviewable diff with exact verification results
  and unresolved issues.
- Claude-specific implementation guidance, including the managed Next.js rules,
  lives in `CLAUDE.md`, which imports this shared authority file.
- Before reviewing Next.js code, Codex also reads the framework guidance in
  `CLAUDE.md` and the relevant installed Next.js documentation.
- Keep implementation and review tied to the same roadmap slice and traceability
  entry. Record findings and fixes without treating review as phase acceptance or
  production activation.
- The owner's explicit task instructions may adjust this division of work.

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

## Release and deployment (DEC-2026-037)

- Merging a reviewed PR to `main` is the release approval: Vercel deploys `main` to
  production automatically. Other branches do not deploy (`vercel.json`), because
  preview builds share the production database and email keys.
- A PR with a migration has it pushed to hosted **before** merge: dry run
  (`supabase db push --linked --dry-run`), then `supabase db push --linked`, with the
  owner's authorization. Migrations stay additive so the live site keeps working on the
  newer schema until the deploy lands.
- If a migration was missed, push it as soon as it is noticed; if a deploy misbehaves,
  promote the previous production deployment (`vercel promote <dpl_id>`) and fix forward.
- Manual `vercel deploy --prod` remains for exceptional releases with owner instruction.

## Approved launch configuration

- Geography: all Lee County, Florida ZIP codes through the authoritative backend allowlist.
- Catalog: all services remain visible; unavailable supply displays “Not available yet in your area” and is not bookable.
- Vendors: every approved and otherwise eligible vendor participates.
- Platform fee: 15% of final service subtotal after discounts/adjustments, excluding tax and tips.
- Customer payment: customers pay Mercurius; Mercurius remits provider proceeds.
- Provider payout: weekly direct ACH, eligible 48 hours after homeowner-confirmed completion; disputes held; no Stripe Connect payout design.
- Full policy details live in `governance/CONFIGURATION-DECISIONS.md`.

## Agent workspace navigation

- Start with `docs/agent/README.md` for the folder map and local workflow, and
  `docs/agent/HANDOFF.md` for the dated checkpoint. Verify branch/status before edits.
- The navigation docs do not supersede the six authorities above or their gates.
- After reading the authorities, load only the slice-specific implementation and
  evidence needed. Search targeted directories; avoid bulk-loading historical
  audits, generated schema, lockfiles, or vendored skills without a concrete need.
- Keep the handoff concise: base commit, bounded scope, evidence, unresolved gates,
  and next action. Do not duplicate product policy into session notes.
