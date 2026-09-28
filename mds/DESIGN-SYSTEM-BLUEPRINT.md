# Mercurius Design System Blueprint

**Status:** **APPROVED by owner on 2026-08-29**
**System name:** Mercurius Design System (MDS)
**Creative north star:** Reliable Local Intelligence
**Product baseline:** owner-approved Mercurius Product System

## 1. Design principles

1. **Operational confidence:** every surface makes status, ownership, next action, and exceptions easy to understand.
2. **Local credibility:** the product looks rooted in Southwest Florida and real home-service work, not generic marketplace software.
3. **Honest evidence:** availability, price, ratings, provider trust, progress, and success are shown only when supported.
4. **Calm control:** use hierarchy, spacing, and restrained color rather than decoration or urgency theater.
5. **Accessible by default:** WCAG 2.2 AA, keyboard operation, touch targets, zoom/reflow, motion preferences, and assistive technology are component requirements.
6. **Two densities, one identity:** marketing is open and expressive; portals are compact and operational, but both use one token and component language.
7. **One meaning, one pattern:** the same action, status, error, price, date, and lifecycle event look and read the same wherever they appear.

## 2. System layers

```text
Brand foundations
  → semantic tokens
    → accessible primitives
      → product patterns
        → public / homeowner / vendor / admin templates
          → route compositions
```

Routes may compose approved patterns; they should not invent new colors, control behavior, status meanings, or interaction states.

## 3. Foundations

### 3.1 Identity

- Primary mark: Mercurius/Hermes line-art symbol.
- Required variants: dark-on-light, light-on-dark, single-color, small-size simplified mark, symbol-only, and symbol-plus-wordmark.
- Define clear space from a measurable feature of the mark.
- Define minimum digital sizes for symbol and lockup.
- Do not place the current dark line-art asset directly on dark surfaces.
- Remove unused starter assets from the supported asset catalog.

### 3.2 Imagery

- Hero illustration: editorial, lightly textured, cream/sage/coral SWFL home scenes.
- Service photography: real-feeling provider/home context, natural light, respectful and non-staged posture.
- Proof imagery: functional, legible before/after or completion evidence; not decorative.
- Provider imagery: preserve business identity, use predictable crops, and provide initials fallback.
- Every image pattern defines aspect ratio, crop behavior, loading behavior, fallback, and alt-text rule.

### 3.3 Typography

**Proposed decision:** use **Geist** as the approved product and marketing family because it is implemented, legible, and already supports the current identity. Update documentation from Inter. Use Geist Mono only for identifiers, ZIPs where appropriate, and technical/financial references—not general labels.

| Token | Marketing | Product use |
|---|---|---|
| `display-xl` | 56–72px, 700–800 | Never in portals |
| `display-lg` | 44–56px, 700–800 | Rare launch/empty hero |
| `heading-1` | 36–48px | 28–32px page title |
| `heading-2` | 28–36px | 22–24px section title |
| `heading-3` | 20–24px | 18–20px card/dialog title |
| `body-lg` | 18–20px | 18px guidance |
| `body` | 16px | 14–16px by density |
| `body-sm` | 14px | 14px metadata/helper |
| `label` | 12–14px | 12–14px, never below 12px for essential text |

Essential status, action, validation, amount, or navigation text must not use 9–11px sizing.

### 3.4 Color architecture

Use three layers:

1. **Reference:** raw sage, slate, coral, neutral, red, amber, blue values.
2. **Semantic:** background, surface, text, border, action, focus, success, warning, danger, info.
3. **Component:** button commitment background, status scheduled foreground, field invalid border, and similar contextual aliases.

#### Core rules

- Sage is the commitment and managed-success family.
- Deep slate carries structure and neutral emphasis.
- Coral is brand energy and editorial emphasis, not normal-sized body text on light surfaces.
- Use `sage-dark`, not `sage`, for normal text on light backgrounds.
- `accent` may be used for large text, icons, controls, borders, or fills; normal text requires a token proven at 4.5:1 on its exact surface.
- Never consume Tailwind raw color scales in route code after migration.
- Status tokens must define light/dark foreground, background, border, and icon values.
- Focus indication must meet WCAG 2.2 focus appearance requirements.

### 3.5 Spacing and density

Use the existing 4px-based Tailwind scale with approved aliases:

- `space-control`: 8px
- `space-field`: 12px
- `space-group`: 16px
- `space-card`: 16px compact / 24px comfortable
- `space-section-product`: 24–32px
- `space-section-marketing`: 64–128px by viewport

Density modes:

- `comfortable`: public, authentication, homeowner primary workflows.
- `compact`: vendor/admin tables and configuration.

Compact density may reduce padding and type size but not accessible naming, focus appearance, or essential touch targets.

### 3.6 Radius and elevation

| Token | Use |
|---|---|
| `radius-control` | Inputs, buttons, small tags |
| `radius-card` | Standard product cards |
| `radius-feature` | Marketing/editorial feature cards |
| `radius-pill` | Badges and segmented controls only |
| `elevation-0` | Dense border-only surfaces |
| `elevation-1` | Default marketing/card lift |
| `elevation-2` | Interactive or raised panels |
| `elevation-overlay` | Dialogs, sheets, menus |

Retire parallel local shadow recipes after migration.

### 3.7 Motion

- Motion explains entry, relationship, progress, or state change.
- Marketing entrance motion should remain subtle and non-blocking.
- Product actions must never rely on motion alone.
- Honor reduced motion in Framer and CSS.
- Disable transforms, parallax, auto-scroll, and nonessential transitions under `prefers-reduced-motion: reduce`.
- Avoid hover translation on high-frequency product controls.

## 4. Primitive component contract

### 4.1 Controls

| Component | Required variants/states |
|---|---|
| Button | commitment/sage, neutral/slate, outline, secondary, ghost, destructive; default/hover/active/focus/disabled/loading |
| IconButton | accessible name required; 40px compact, 44px customer-facing |
| Link | inline, navigation, standalone action, external |
| Input | default, filled, invalid, disabled, read-only, prefix/suffix |
| Textarea | same state contract as Input; character guidance where bounded |
| Select/Combobox | label, description, empty, loading, searchable, invalid |
| Checkbox/Radio | 44px effective hit area; group label and error |
| Switch | visible label plus accessible state; not used for one-time destructive actions |
| DateTime | timezone and locale explicit; keyboard/manual entry supported |
| FileUpload | drop/select, progress, type/size error, preview, remove, retry |

Default customer controls are 44px high. Dense internal controls are at least 40px unless an explicitly approved pointer-only table pattern provides a 40px effective hit area.

### 4.2 Containers and overlays

- Card
- Section/Panel
- Dialog
- AlertDialog / ConfirmAction
- Sheet/Drawer
- Popover/Dropdown
- Tabs
- Tooltip

Every dialog and sheet requires an accessible title. Descriptions may be visually hidden but must explain the surface where the title alone is insufficient. Trigger composition must produce exactly one interactive element.

### 4.3 Data and feedback

- Badge
- Status
- Alert/Notice
- Toast
- Progress
- Skeleton
- LoadingState
- EmptyState
- ErrorState
- PermissionState
- DataTable
- ResponsiveDataList
- Pagination
- DefinitionList / KeyValue
- Stat

## 5. Product patterns

### PageHeader

Slots: eyebrow, title, description, metadata, primary action, secondary actions. Marketing and product density variants share one hierarchy.

### FormField

Slots: label, required indicator, control, help, validation, character/format guidance. `id`, label association, description, and error relationship are enforced by API.

### Status

Consumes the approved MPS state vocabulary. Each state maps to:

- canonical label;
- semantic tone;
- optional icon;
- short explanation;
- next-action guidance;
- permitted role visibility.

### MoneySummary

Presents subtotal, add-ons, discounts, tax, customer fee, deposit, paid, refund, balance, platform fee, and provider payable without ambiguous color or wording.

### WorkflowStepper

Used for request intake and lifecycle explanation. Supports current, complete, upcoming, blocked, and error states; announces changes to assistive technology.

### DataTable / ResponsiveDataList

- Desktop: sortable/filterable table with clear headers and row actions.
- Mobile: priority fields become labeled cards or a definition list; secondary detail opens a sheet/dialog.
- Horizontal scrolling is a fallback, not the sole mobile design.
- Row actions have labels or tooltips and 40px hit areas.

### ConfirmAction

Required for destructive, financial, policy, role, payout, refund, and irreversible changes. It displays consequence, affected entity/amount, reason input where required, cancel action, loading/idempotent state, and result.

### OperationalQueue

Consistent filters, totals, age/SLA, owner, priority, status, next action, empty/error/loading, and bulk-action behavior for MPS queues.

### AuthenticationShell

One responsive pattern for homeowner login, vendor login, registration, forgot password, and set password. It defines imagery, heading, help links, validation, status announcement, and mobile behavior.

## 6. Navigation and information architecture

### Public

- Primary: For Homeowners, Find a Pro, For Vendors.
- Secondary: How It Works, Services, Pricing, FAQ, Contact.
- Commitment action: Request Service.
- Remove Admin from public footer.
- Use parent-aware active states.

### Homeowner

Keep service work and account settings separated. Preserve “Request Service” as the dominant action. If dashboard sections remain URL-query states, they must behave predictably with history, focus, deep linking, and screen readers.

### Vendor

Primary groups: Work, Customers/Communication, Offerings, Business/Profile. Plans remain hidden or explicitly informational until the approved MPS releases subscriptions.

### Admin

Group the flat navigation into:

- Marketplace Operations: requests, applications, vendors, homeowners.
- Catalog & Supply: catalog, coverage, pricing templates/reviews.
- Money: invoices, disputes, payouts/reconciliation when built.
- Trust & Support: reviews, quality, tickets, message audit.
- Merchandising & Insights: featured providers, analytics; Smart Picks only if retained.

## 7. Surface templates

### Marketing page

Header → Hero → evidence/value content → optional decision aid → one final CTA → Footer. Do not repeat equivalent CTA sections.

### Portal list/queue

Portal shell → PageHeader → metrics only when decision-relevant → filters → responsive list/table → pagination → empty/error/loading.

### Portal detail

Breadcrumb/back → identity/status header → primary next action → key details → communication/evidence → history/audit → secondary/destructive actions.

### Configuration editor

PageHeader → state summary → grouped fields → preview/impact → sticky or consistent save/cancel → validation summary → dangerous actions separated.

## 8. Accessibility contract

All approved components and route templates must satisfy:

- WCAG 2.2 AA contrast and interaction criteria;
- semantic landmarks and one meaningful page heading;
- skip link to stable `main` target;
- keyboard operation and visible focus;
- focus trap and restoration for overlays;
- accessible names for icon controls;
- titles/descriptions for dialogs and sheets;
- 44px customer touch targets and 40px compact internal targets;
- 200% zoom and 320px reflow without loss of function;
- status/error/success announcements where dynamic;
- errors connected to fields and summarized for long forms;
- reduced-motion behavior;
- non-color status cues;
- text alternatives following decorative/informative/function rules;
- table headers/captions or responsive labeled-data alternatives.

## 9. Content style

- Use sentence case for buttons, headings below page-title level, status explanations, and labels.
- Use verb-led actions: “Request service,” “Send quote,” “Confirm completion.”
- Reserve title case for product/portal names.
- Prefer “provider” in customer-facing content and use “vendor” only for the business portal/operations context where approved.
- Use one commitment CTA: **Request service**. Use **Get started** only when the next screen is not yet a service request.
- Errors state what happened, what remains safe, and what the user can do next.
- Success messages state what changed and the next expected event.
- Destructive confirmations name the entity and consequence.
- Currency always includes locale-aware formatting and clear fee/refund labels.
- Dates include timezone where appointment interpretation could differ.

## 10. Governance and tooling

### Required repositories of truth

1. Token source with generated CSS/Tailwind mappings.
2. Versioned component package within the application until extraction is justified.
3. Storybook or equivalent component catalog containing all states, themes, densities, and viewport examples.
4. MPS status-to-design mapping.
5. Content pattern reference.
6. Asset catalog.

### Quality gates

- TypeScript and lint.
- Component unit/interaction tests.
- axe accessibility tests.
- Keyboard/focus assertions for overlays and critical workflows.
- Visual regression in light/dark and mobile/desktop.
- Raw-color and arbitrary-value lint restrictions with documented exceptions.
- Critical-journey browser tests at 320, 375/390, 768, 1024, and 1440px.
- Manual screen-reader checks for request, checkout, vendor job, dispute, and admin money actions.

### Component maturity

Each component is labeled:

- `experimental`: not for new production flows without review;
- `beta`: API may change, accessibility scenarios documented;
- `stable`: tested, documented, visually baselined;
- `deprecated`: migration path and removal release declared.

## 11. Migration sequence

1. Fix P0 accessibility defects in existing primitives and sheets.
2. Approve typography, theme support, density, and semantic color architecture.
3. Add commitment Button, FormField, Select, Textarea, Switch, Status, PageHeader, and shared state patterns.
4. Migrate critical homeowner request/payment and vendor job flows.
5. Add DataTable/ResponsiveDataList and ConfirmAction; migrate admin money and lifecycle surfaces.
6. Consolidate raw colors, local status maps, radii, shadows, and arbitrary sizes.
7. Reorganize navigation and remove approved deprecated/orphan surfaces.
8. Establish Storybook, accessibility automation, and visual regression.
9. Perform rendered route review in light/dark, mobile/desktop, keyboard, zoom, and screen readers.

This blueprint was approved by the owner on 2026-08-29. Component conformance and rendered accessibility remain implementation gates, not assumptions granted by approval.


## Approved R0 route and state addendum — 2026-09-28

During R0 recruiting (DEC-2026-022), public request/signup entry points lead to homeowner early access, while vendor entry points lead to the existing real application. The normal “Request service” commitment action is reserved for an admitted homeowner. Public services and approved, eligible provider profiles remain explorable; booking is described as “Opening by invitation.” No mock price or unsupported provider/trust claim appears as live. This R0 exception to the public CTA in §6 preserves that CTA for R1 and admitted customers.

The signed-in waiting home prioritizes status, ZIP/interests, editing, factual exploration and account/support controls without an unusable request/payment action or empty-job promise. Existing legitimate history and support stay reachable. Design list-only confirmation, optional account creation, verified waiting, invited, revoked/closed and error states at mobile/desktop, light/dark, keyboard, screen reader and 200% zoom. Approved invited vendors can prepare truthful profile, coverage, availability and actual offers; the Work area explains the no-jobs-yet state while transactions are closed. Reconcile the founder-approved homeowner early-access experience artifact before detailed route/state implementation.
