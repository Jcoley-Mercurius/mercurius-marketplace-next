# MDS Owner Decisions

**Status:** **APPROVED — recommended defaults accepted by owner on 2026-08-29**
**Purpose:** Resolve the few design-authority choices that materially change implementation scope. The audit provides a recommended default for each.

## Required decisions

- [x] **D1 — Typeface: Geist**
  **Recommended:** Approve Geist and update `DESIGN.md`; do not add Inter merely to match stale documentation.
  **Alternative:** Adopt Inter and migrate the implementation.

- [x] **D2 — Dark mode support: supported and funded in the rebuild**
  **Recommended:** Keep dark mode as a supported feature only if the build roadmap funds complete semantic-color, asset, accessibility, and visual-regression coverage. Otherwise temporarily remove the public toggle and ship an excellent light theme first.

- [x] **D3 — Control density: 44px customer / 40px compact portal**
  **Recommended:** Approve 44px customer-facing targets and 40px compact vendor/admin targets. Permit smaller visible icons only inside a compliant effective hit area.

- [x] **D4 — Primary action color: sage commitment action**
  **Recommended:** Sage is the commitment action; deep slate is neutral/high-emphasis structure. Add a named commitment Button variant and stop local class overrides.

- [x] **D5 — Accessibility target: WCAG 2.2 AA across every role**
  **Recommended:** Approve WCAG 2.2 AA for every public and authenticated surface, including vendor/admin tools.

- [x] **D6 — Admin mobile scope: essential operations supported at 320px**
  **Recommended:** Support essential operational actions on mobile with responsive data-list/detail patterns; permit advanced configuration to be desktop-optimized but never broken at 320px.

- [x] **D7 — Design-system tooling: component catalog, axe, and visual regression**
  **Recommended:** Add Storybook (or an equivalent local component catalog), axe automation, and screenshot regression before broad route migration.

- [x] **D8 — Asset system: retain the Hermes/editorial SWFL direction and add required variants**
  **Recommended:** Approve the existing Hermes mark and editorial SWFL illustration style; commission/export light/dark/small mark variants and remove unused starter assets.

- [x] **D9 — CTA vocabulary: “Request service” is the primary commitment CTA**
  **Recommended:** Use “Request service” as the primary marketplace commitment CTA. Reserve “Get started” for earlier education or account flows and “Build my home plan” for the plan builder only.

- [x] **D10 — Deprecated design surfaces: remove/hide until approved product purpose exists**
  **Recommended:** Remove the public Admin footer link, hide or clearly informationalize Vendor Plans, and omit Smart Picks until its approved MPS purpose exists.

## Decisions already governed by the approved MPS

These do not require a second design approval:

- honest provider, price, coverage, rating, and availability presentation;
- separate homeowner, vendor, and admin operating contexts;
- soft-launch, operationally assisted positioning;
- canonical lifecycle and status semantics;
- provider terminology for customers and vendor terminology for provider operations;
- explicit handling of payment, payout, cancellation, dispute, review, and operational exceptions.

The design system must express those rules consistently rather than redefine them.

## Approval record

```text
MDS disposition: APPROVED | REVISED | DEFERRED
Owner: Repository owner
Date: 2026-08-29
Approved decisions: D1–D10, recommended defaults
Revisions: None stated
Implementation constraints:
Effective design-system version: MDS 1.0 rebuild baseline
```
