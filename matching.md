# Mercurius Matching Spec

Status: Soft-launch baseline  
Last updated: 2026-08-15  
Scope: Who is eligible for a request, how they are ranked, how offers are made, and how Plan Builder presents choices.

This document is the source of truth for matching behavior. Implementation should follow it; change this file before changing production logic.

---

## 1. Product model

Mercurius is a **managed marketplace**, not an open lead board.

- Independent vendors deliver the work.
- The platform controls **eligibility**, **ranking**, and **offer sequencing**.
- Homeowners may **choose a provider** when options are shown, or use **Match me** for platform sequencing.
- Public copy must not claim a guaranteed “best” or “perfect” match.

### Locked soft-launch decisions

| Decision | Value |
|----------|--------|
| Default offer mode | Sequential exclusive |
| Response window | 4 hours |
| Rank style | Balanced (not pure cheapest) |
| `marketing_enabled` | Required to receive matches |
| Directory pick | Overrides rank if contractor is eligible |
| Plan Builder UX | Option C — show ranked row + default **Match me** |
| Launch scale | ~10 vendors; design must scale |

---

## 2. Request paths

Every service line on a request resolves to one path:

| Path | Condition | Matching behavior |
|------|-----------|-------------------|
| **Fixed** | ≥1 active fixed-price package for service + frequency + area | Rank eligible packages; sequential exclusive offers (or homeowner pick) |
| **Quote** | Covered by active contractor/package but no fixed price | Rank eligible contractors; quote request flow (not a priced booking) |
| **Sourcing** | No eligible coverage | No auto-match; admin/ops only |

Fixed and quote still use the same eligibility + rank helpers. Only the post-match job type differs.

---

## 3. Eligibility (hard filters)

A package/contractor is **eligible** only if all of the following are true:

1. Contractor `is_active = true`
2. Contractor `marketing_enabled = true`
3. Package `is_active = true` and `needs_review = false` (for fixed-price path)
4. Package/service covers the requested **service id**
5. Package supports the requested **frequency** (when frequency-specific)
6. Contractor/package serves the request **geography** (ZIP / service area)
7. Contractor is not blocked / suspended (if such a flag exists later)

### Homeowner-selected provider

If the homeowner explicitly selects a contractor (directory or Plan Builder card):

- That contractor is **priority 1** if still eligible at offer time.
- If no longer eligible, fall back to normal ranked sequential matching and surface an honest message.

### Non-eligible outcomes

- Zero eligible → **Sourcing** path; do not invent coverage.
- Eligible but quote-only → **Quote** path; do not show a fake fixed price.

---

## 4. Ranking (balanced score)

Ranking applies only to the eligible set. Scores are for ordering and admin transparency — not public “Top Rated” claims unless backed by real data later.

### Soft-launch weights

| Factor | Weight | Notes |
|--------|--------|--------|
| Fixed live price available | +40 | Prefer fixed over quote-only |
| Profile strength / completeness | +20 | Existing profile-strength signals |
| Verification badges present | +15 | Licensed, Insured, etc. when stored |
| Price competitiveness within band | +15 | See price band rule |
| Response / accept history | +10 | 0 until real data exists |
| Package recently updated | +5 | Slight preference for fresh pricing |

### Price band rule (anti race-to-bottom)

Among eligible **fixed** packages for the same service + frequency:

1. Compute median effective price of the eligible fixed set.
2. Prefer packages **at or below median + 25%**.
3. Within the band, apply remaining score factors.
4. Do **not** always pick the absolute cheapest.

### Tie-break

Deterministic sort: higher score → lower effective price → contractor name → contractor id.

### What ranking must never do

- Invent ratings, job counts, or reviews
- Promote inactive or `needs_review` packages
- Bypass `marketing_enabled`
- Present editorial Smart Picks language as automated ranking

---

## 5. Offer mode: sequential exclusive (default)

**Exclusive** — only one vendor holds an open offer at a time.  
**Sequential** — on decline or expiry, the next ranked eligible vendor is offered.

### Flow

### Offer lifecycle states

| State | Meaning |
|-------|---------|
| `pending` | Offer is open; vendor may accept/decline; not expired |
| `accepted` | Vendor accepted; request locked to this contractor |
| `declined` | Vendor explicitly declined |
| `expired` | `now > expires_at` and still pending → system marks expired |
| `withdrawn` | System closed the offer (accepted elsewhere, admin reassign, parallel loser, etc.) |

### Decline transition

1. Mark current offer `declined`.
2. Record `declined_at` and actor if available.
3. Immediately call `offer_next_for_request` (or equivalent).
4. Do not re-offer the same contractor for the same request unless admin force-assigns.

### Expiry transition

1. Any read/write path that touches offers may mark `pending` offers with `expires_at < now` as `expired` (check-on-read is acceptable for Phase 1).
2. After marking expired, call `offer_next_for_request`.
3. Cron may later call the same expire+next logic in batch; not required to ship Phase 1.

### Exhausted-match behavior

When no eligible contractors remain who have not already declined/expired/withdrawn for this request:

- Stop auto-offering.
- Set request matching status to an **exhausted / needs_admin / sourcing** state consistent with existing enums (additive if needed).
- Homeowner-facing copy: coordination/sourcing language — not “matched.”
- Admin must be able to force-assign or mark sourcing.

### Concurrency / idempotency

- At most **one** `pending` exclusive offer per request in sequential mode.
- `create_job_offer` must fail or no-op if a pending exclusive offer already exists (unless admin parallel mode).
- `offer_next_for_request` must be idempotent: if a pending offer already exists, do not create a second.
- Accept must re-check eligibility and package still active; if invalid, reject accept and continue sequential flow.
- Accept must withdraw other open offers for the same request in the same transaction when possible.

### Parallel mode (not default)

- Admin or urgent flag only.
- Offer top K (K = 2–3) at once.
- First accept wins; remaining open offers auto-withdrawn.
- Sequential remains the default for launch.

### Response window

- Default: **4 hours** from offer creation (`expires_at = created_at + 4 hours`).
- Vendor UI should show countdown when offers are displayed.
- New sequential offers each get a fresh 4h window.

---

## 6. Price snapshot

When an offer is created:

- Persist the **package id**, **effective price**, **frequency**, and any promotion id used at offer time.
- Later package edits must not change the offered price for that open offer.
- On accept, the job inherits the snapshot unless admin explicitly renegotiates (future).

---

## 7. Plan Builder UX (Option C)

After the homeowner selects a service (e.g. Lawn):

1. Load **eligible** providers via matching eligibility + rank.
2. Show a **horizontal / Netflix-style row** of cards when eligible count ≥ 1.
3. Each card may show: logo, business name, area, badges, live package price **or** “Quote”, primary CTA.
4. Primary automation CTA: **Match me** → creates request and starts **sequential exclusive** from top rank (or continues after request submit).
5. Alternate CTA: **Choose this pro** → request is bound to that contractor as priority 1.

### Card honesty rules

- Show dollar amounts only from live fixed packages.
- Quote-only cards: no fake starting price.
- Empty eligible set: do not show a fake row; show sourcing / request-to-source messaging.

### “Match me” behavior

- Does **not** require the homeowner to pick a card.
- Runs sequential exclusive on the ranked eligible list.
- Homeowner-facing status should be coordination language, not “we found the perfect pro.”

Phase 1 implements the engine only. Plan Builder Netflix UI is Phase 2.

---

## 8. Directory pick

From `/providers` (or public profile):

- Selecting a provider and requesting service pre-binds that contractor.
- Matching still validates eligibility at offer time.
- If eligible → exclusive offer to that contractor first.
- If not → fall back to ranked sequential + message.

---

## 9. Admin overrides

Admin must be able to:

| Action | Purpose |
|--------|---------|
| View eligible list + scores | Transparency / debugging |
| Force assign contractor | Ops control |
| Offer next | Manual sequential step |
| Enable parallel top-K | Urgency |
| Mark sourcing | Override even if packages exist |
| Re-open / reassign | Decline recovery |

Admin tools may show score breakdown; public UI should not expose raw internal scores unless product later decides to.

---

## 10. Job / offer states (minimum)

Offer:

- `pending` → `accepted` | `declined` | `expired` | `withdrawn`

Request (matching-related):

- `awaiting_match` → `offered` → `matched` → (existing job lifecycle)
- or `quote_pending`
- or `sourcing` / exhausted-admin attention

Exact enum names may match existing Supabase values; behavior above is normative. Prefer additive enum values over renames when possible.

---

## 11. Implementation targets

### Phase 1 — engine (launch)

- `find_eligible_packages(request_id | request_payload)` → ranked rows
- `create_job_offer(request_id, contractor_id, package_id, expires_at, price_snapshot)`
- `offer_next_for_request(request_id)` on decline/expiry
- Accept path: lock request, cancel competing offers, start job lifecycle
- Re-check eligibility + active package at accept time
- Honor homeowner-selected contractor
- Filter on `marketing_enabled`
- Check-on-read expiry acceptable; cron optional later

### Phase 2 — Plan Builder row

- Eligible ranked cards after service select
- **Match me** + **Choose this pro**
- Live price / quote labels only

### Phase 3 — learning

- Feed response rate, accept rate, completion into score weights
- Optional mild featured boost that cannot invent eligibility

### Phase 4 — AI assist

- Only after real volume; ranking remains explainable in admin

---

## 12. Defaults (config)

```text
MATCH_MODE_DEFAULT=sequential
RESPONSE_WINDOW_HOURS=4
PARALLEL_K=2
PRICE_BAND_MAX_ABOVE_MEDIAN=0.25
REQUIRE_MARKETING_ENABLED=true
REQUIRE_ACTIVE_PACKAGE_FOR_FIXED=true
HOMEOWNER_PICK_OVERRIDES_RANK=true
PACKAGE_RECENT_DAYS=30
PLAN_BUILDER_UX=option_c_row_plus_match_me