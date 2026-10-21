# Pricing rollout: migrations, cleanup schedule, promotions gate, replacement drafts

**Prepared:** 2026-10-20 (America/New_York) for TRACE-112–116 on branch `claude/pricing-revisions` (uncommitted; base `main` `fdfb450`).
**Target:** production Supabase project `vugqqyemuptlvcieihww` (the CLI is linked to it) and the Vercel project `mercurius-marketplace-next`.
**Authority:** DEC-2026-037 (migrations pushed before merge, with the owner's authorization), DEC-2026-041/042, [HOSTED-MIGRATION-ROLLOUT.md](HOSTED-MIGRATION-ROLLOUT.md) (backup and rehearsal practice).
**Nothing below has been run against production.** Each step marked **(Josh)** needs that authorization. Steps marked **(finance)** need the finance review in [PRICING-FINANCE-REVIEW.md](PRICING-FINANCE-REVIEW.md).

## 1. Migration inventory

Hosted head is `20261016003000`. On 2026-10-20, read-only (`npx supabase migration list --linked`), all six pricing migrations show no remote version. A catalog check found none of their tables, functions or columns, and 0 `cron.job` rows. **None has been applied.** The request listed five migrations; TRACE-116 adds a sixth.

| Order | File | Depends on | Local | Hosted |
|---|---|---|---|---|
| 1 | `20261018001000_pricing_catalog_calculation.sql` | `20261016002000` (drafts, cadences) | applied | pending |
| 2 | `20261018002000_pricing_vendor_approval.sql` | 1 (`price_selection`, `package_content`, `pricing_content_hash`) | applied | pending |
| 3 | `20261018003000_promotion_offers.sql` | 1 (`pricing_content_hash`); 2 (`package_draft_vendor_link`) | applied | pending |
| 4 | `20261018004000_pricing_owner_decisions.sql` | 2 (drafts, events); 3 | applied | pending |
| 5 | `20261018005000_pricing_checkout_promotions.sql` | 1 (`price_selection`); 3 (offers, redemptions) | applied | pending |
| 6 | `20261018006000_promotion_selection.sql` | 3, 5 (redemptions, gate, `money_source`) | applied | pending |

Locally, 1 went in through `supabase migration up --local`. Files 2–6 were applied with psql and recorded by hand in `supabase_migrations.schema_migrations`, and function bodies were checked against the files. On 2026-10-20 (pre-PR audit) the isolated CI stack (`scripts/phase5-db.sh`, `.phase5-local`, its own project and ports) replayed every migration on an empty database: all six applied in order, the full SQL suite passed (78 files, 4443 checks), and `pricing-concurrency.mjs` and the finance concurrency scripts passed. The main local stack was not reset. CI's "Verify clean replay" step repeats this on the PR.

## 2. Compatibility, legacy data, permissions

- **Additive.** New tables, columns, functions, triggers, partial unique indexes, the `promotion_subsidy` ledger account and the gate row. No drop, no destructive data change.
- **Constraints that changed:** `money_ach_items` balance check, which is equal to the old one when the subsidy is 0, and `promotion_redemptions` checks, on tables created in the same set.
- **Existing rows:**
  - packages get `lineage_id = id` and keep `price_kind` null;
  - existing drafts get their content and stay unapproved;
  - nothing is marked vendor-approved, so no historical approval is fabricated.
- **Unique indexes.** The same-name active package and one active first-booking redemption indexes were checked against hosted on 2026-10-18: 0 same-name groups, no redemptions table yet.
- **Live app after the push, before the deploy.** It keeps working: preview, submission, matching and the checkout source give the same results for packages without add-ons, rule conditions or overlapping rules. That is every live package (14 active, 0 add-ons, 0 overlaps, 2026-10-18). The restated `submit_service_requests` behaves as before for selections without `promotion` or `addons`.
- **New app before the push.** Avoid this order (DEC-2026-037 pushes first). If it happens, the offer RPCs are missing, so the intake and dashboard show no offers and stay usable. Package editing and approval features fail until the push.
- **Permissions.**
  - New `public` functions are `authenticated`-only and check the role inside: homeowner, operator, or vendor bound to the provider.
  - `private` functions and tables are revoked from `anon`, `authenticated` and `service_role`. The exception is the email-notice claim functions (`service_role`, 004).
  - The sweep is callable by no client role.
  - SQL 082–087 assert the grants.
- **Gate.** `private.money_feature_gates.promotions_checkout` is inserted **false**. With it closed, no offer is listed, chosen or checked out.

## 3. Prerequisites for the push (Josh)

1. The rollout commit is fixed: the branch is committed, Codex has reviewed it, CI is green including the clean replay, and the SHA is recorded here.
2. **Backup:** point-in-time recovery is confirmed, or a fresh backup of `vugqqyemuptlvcieihww` is taken from the dashboard. Record the restore point.
3. **Rehearsal (recommended):** restore that backup into a non-production project or branch, run the push and the pgTAP suites there. Data stays hosted.
4. A low-traffic window. `/request`, the vendor portal and Vendor Prices are the affected surfaces.

## 4. Hosted push (Josh)

```sh
npx supabase migration list --linked              # expect the six files above with no remote version
npx supabase db push --linked --dry-run           # expect exactly these six, in this order, and nothing else
npx supabase db push --linked                     # applies them; each file is its own transaction
```

Read back (read-only), expecting six rows, the gate false and no cron job:

```sh
npx supabase migration list --linked
npx supabase db query --linked "select version from supabase_migrations.schema_migrations where version >= '20261018001000' order by 1"
npx supabase db query --linked "select name, enabled from private.money_feature_gates; select count(*) from cron.job"
npx supabase db query --linked "select count(*) filter (where lineage_id = id) as own_lineage, count(*) from public.vendor_packages"
```

**If the push fails part-way:** files before the failing one stay applied; the failing one rolls back. Do not merge. Capture the error and write a forward-fix migration. Restoring the backup is the last resort, because it discards writes made since.

Then merge the PR. Vercel deploys `main` (DEC-2026-037). Smoke checks:

- `/request` with a test homeowner, without submitting;
- Vendor Prices and Promotions in the admin portal;
- the vendor Pricing & Packages page;
- Vercel and Supabase logs for errors.

## 5. Replacement drafts for the six operator-published packages (Josh, after step 4)

DEC-2026-041 item 5. Each live revision stays live until its approved replacement is published.

1. **Verify the workflow** before creating anything. Locally it is proven by SQL 085 and the browser test `vendor-prices`. On production, open Vendor Prices and confirm that each package shows its approval evidence ("operator published", "vendor editor", …). Find the six with this read-only query:
   `select count(*) from public.vendor_packages p where p.is_active and exists (select 1 from private.operator_package_drafts d where d.package_id = p.id and d.status = 'published')`.
   It should return 6. If not, stop and reconcile before continuing.
2. **For each of the six**, in Vendor Prices, choose **Prepare replacement draft** with no price change and the reason "DEC-2026-041 item 5: your approval of the live price". Check the preview against the live package, then **Send for approval**. The command copies the live package exactly; legacy rules become conditions and legacy quote levels become "starting at", both reported in the draft.
3. **Duplicates on retry are refused by the server.**
   - A second "Prepare" for a package with an open draft fails with "A replacement draft for this package is already open".
   - A repeated send of the same revision reuses the vendor's unread in-app notice (TRACE-116), and queues at most one email per revision for an unlinked vendor (004).
   - Before retrying, check the delivery state shown on the draft.
4. **Vendor approval** is the vendor's own authenticated action. Email or a reply is not approval. An unlinked vendor is told by email that they must link their account first. On 2026-10-20 (read-only) **all 14 active vendors on production were unlinked** (no bound account), so every send today queues an email notice only, or is blocked when no contact email is on file, and no replacement can be approved until that vendor links their account (vendor invitation). Plan the six sends with the account-linking outreach; each live revision stays live meanwhile.
5. **Publish** each approved replacement with a reason. Publishing pauses the old revision in the same transaction. Bookings already made keep their terms.
6. **Record** the six draft IDs, their delivery state and the approval inventory (`admin_pricing_approval_inventory`) in the handoff. Copy no customer data.

## 6. Cleanup schedule for unpaid reservations (Josh)

`private.run_promotion_release_sweep()` releases unpaid reservations whose current terms expired, or whose offer ended, changed or was retired before payment.

- **Exactly once.** It runs under the request and obligation locks that checkout uses, and re-checks each reservation before releasing it.
- **Paid bookings are protected.** It skips any request with a captured payment or an open checkout attempt.
- **Overlapping runs skip.** Every run is logged in `private.promotion_sweep_runs`.
- **Evidence:** SQL 087 and `scripts/pricing-concurrency.mjs` (six overlapping runs; cleanup against replacement).

It only matters once offers can be applied, so install it with the push and activate it no later than opening the gate.

**Install inactive** (proposed cadence every 15 minutes; job name `mercurius-promotion-release-sweep`). With a direct connection string, `scripts/install-promotion-sweep.sql` does this with the duplicate checks:
`psql "$DB_URL" -v job_name=mercurius-promotion-release-sweep -v cadence='*/15 * * * *' -f scripts/install-promotion-sweep.sql`

Through the linked CLI the same result is:

```sh
npx supabase db query --linked "select count(*) from cron.job where jobname = 'mercurius-promotion-release-sweep' or command ilike '%run_promotion_release_sweep%'"   # must be 0
npx supabase db query --linked "select cron.schedule('mercurius-promotion-release-sweep', '*/15 * * * *', 'select private.run_promotion_release_sweep();')"
npx supabase db query --linked "select cron.alter_job((select jobid from cron.job where jobname = 'mercurius-promotion-release-sweep'), active := false); select jobid, jobname, schedule, active from cron.job"
```

The CLI route is active between the second and third statements. That is harmless: the sweep releases nothing while the gate is closed and no reservations exist. The psql template avoids even that window.

**Activate**, separately authorized:

```sh
npx supabase db query --linked "select cron.alter_job((select jobid from cron.job where jobname = 'mercurius-promotion-release-sweep'), active := true)"
```

**Monitoring:**

- The admin **Promotions** page shows the gate, whether the job is scheduled and active, the last completed run, runs in the last 24 hours, reservations waiting for cleanup, those held by a checkout, and homeowners asked to choose again.
- Read-only queries:

  ```sh
  npx supabase db query --linked "select outcome, released, finished_at from private.promotion_sweep_runs order by finished_at desc limit 10"
  npx supabase db query --linked "select status, start_time, return_message from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'mercurius-promotion-release-sweep') order by start_time desc limit 10"
  ```

- Investigate when the job is active and any of these holds:
  - no completed run in 1 hour;
  - any `failed` entry in `cron.job_run_details`;
  - "waiting for cleanup" stays above 0 across two runs;
  - "held by a checkout" stays above 0 for more than the 1-hour checkout session limit. That means an attempt was never reconciled, which is a finance reconciliation item.

**Recovery:**

- To stop: `select cron.alter_job((select jobid from cron.job where jobname = 'mercurius-promotion-release-sweep'), active := false)`. To remove: `select cron.unschedule('mercurius-promotion-release-sweep')`.
- A run is a single transaction, so a failed run releases nothing.
- A released reservation is never re-reserved for the homeowner. The homeowner sees "Your offer no longer applies" and chooses another offer or confirms the price without one, because checkout refuses until they do.
- An operator cannot apply an offer on a homeowner's behalf.
- `admin_restore_promotion` applies only to committed (paid) redemptions.

## 7. Opening the promotions gate (Josh, after the finance review)

Preconditions: both sign-offs are recorded in PRICING-FINANCE-REVIEW.md §10 against the deployed commit; the cleanup job is active; and, immediately before the statement below, the production money-code fingerprint equals the signed-off value (read-only):

```sh
npx supabase db query --linked -f scripts/promotion-money-fingerprint.sql   # functions and fingerprint must equal PRICING-FINANCE-REVIEW.md §10
```

If it differs, a listed function changed after the review: do not open the gate. The open items in PRICING-FINANCE-REVIEW.md §9 (items 10–11) are decided first.

```sh
npx supabase db query --linked "update private.money_feature_gates set enabled = true, reason = 'Two-person finance review <date>: <reviewer 1>, <reviewer 2>', changed_at = now() where name = 'promotions_checkout' returning name, enabled, changed_at"
```

**Effect:** live, approved public offers appear on the request review, and code offers appear with their code. Finance can publish snapshots that carry a promotion; checkout charges the discounted total.

**To close again:** the same statement with `enabled = false`. New offers stop at once. A request that already holds an offer shows it as paused, and the homeowner can remove it and continue at the full price (SQL 087). Checkout refuses it until then. Paid bookings keep their terms.

R0 launch restrictions are unchanged throughout: requests and checkout still require trial admission (`r0_trial_admitted`), and the gate opens nothing beyond it.

## 8. Order

1. Codex review of the branch; commit; PR with CI green (clean replay included).
2. Finance review can start on the committed SHA (it can run in parallel with steps 3–5).
3. **(Josh)** Backup or PITR confirmed; optional rehearsal.
4. **(Josh)** `migration list` → `db push --dry-run` → `db push`; read back.
5. Merge, which deploys; smoke checks.
6. **(Josh)** Verify the replacement-draft workflow; prepare and send the six replacement drafts (§5).
7. **(Josh)** Install the cleanup job inactive (§6).
8. **(finance)** Both sign-offs recorded.
9. **(Josh)** Activate the cleanup job, then open the gate (§7).

**Rollback:**

- **Code:** promote the previous production deployment (`vercel promote <dpl_id>`). The schema can stay, because the previous app ignores the new objects.
- **Gate:** close it (§7).
- **Schedule:** deactivate it (§6).
- **Database:** forward fixes only. Previous function bodies are in `20261016002000`, `20260928000000`, `20260905010000`, `20260928232242`, `20260905016000` and `20260904004000`.

## 9. Owner decisions surfaced by this slice

1. **Second finance reviewer.** The review needs two people (PRICING-FINANCE-REVIEW.md §1), and none is named.
2. **Provider replacement for a booking with add-ons or an offer (CFG-007).** Matching now keeps such a booking on the package and provider it was priced from. A provider cancellation or no-show therefore finds no replacement automatically, and CFG-007's path ends in a full refund. The alternative is to rematch another provider at the paid terms. Who would then fund a vendor-funded discount, and can that provider perform the same add-ons? That needs a decision before add-on or promotional bookings are live.
3. **Credits.** No Credits ledger exists. DEC-2026-042's comparison between Credits and a promotion becomes a design task when Credits are specified.
