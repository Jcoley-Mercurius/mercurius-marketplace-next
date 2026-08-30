# Mercurius Design System Audit

**Mode:** AUDIT
**Repository:** `Jcoley-Mercurius/mercurius-marketplace-next`
**Evidence baseline:** `main` at `94d608a`
**Audit date:** 2026-08-29
**Governing inputs:** owner-approved MPS and MTS
**Disposition:** **DESIGN DIRECTION ALIGNED; SYSTEM IMPLEMENTATION INCOMPLETE**

## 1. Audit scope and evidence limits

This audit examines visual foundations, identity assets, theme tokens, typography, layout, responsive shells, navigation, components, interaction states, forms, data displays, content patterns, accessibility, implementation consistency, design documentation, and design-quality assurance across public, authentication, homeowner, vendor, and administrator surfaces.

Existing UI is evidence, not automatically approved design truth. Findings use the MPS truth labels **OBSERVED**, **INFERRED**, **PROPOSED**, **APPROVED**, and **DEPRECATED**, and the alignment labels **ALIGNED**, **INCOMPLETE**, **CONFLICTING**, **UNDOCUMENTED**, **DEPRECATED**, and **UNKNOWN**.

Static source, assets, component APIs, route implementations, and calculated token contrast were inspected. A rendered-browser pass could not be completed because two locked dependency installations stalled before producing a runnable Next.js binary. Consequently, exact pixel rendering, runtime focus order, screen-reader output, breakpoint screenshots, and browser-specific behavior are **UNKNOWN** and remain release-verification requirements.

## 2. Executive assessment

Mercurius already has a credible and differentiated design direction. “Reliable Local Intelligence” is expressed through a warm Southwest Florida visual register, restrained sage/cream/slate colors, coral highlights, calm typography, local imagery, honest empty states, and denser operational portals. The system avoids the generic neon or purple “AI marketplace” aesthetic prohibited by its own design notes.

The design direction is stronger than the design-system implementation. The repository has 56 routes and 105 TSX files, but only 12 shared UI primitives. Repeated page-local fields, selects, textareas, switches, status maps, tables, loading states, empty states, and page headers have created substantial drift. The system is best described as **a branded UI kit with emerging patterns**, not yet a governed, accessible, testable design system.

### Overall assessment

| Dimension | Rating | Summary |
|---|---:|---|
| Brand identity | Strong | Distinctive and appropriate for a managed SWFL home-services product. |
| Visual foundations | Good | Useful token base and light/dark themes, but aliases and usage rules are incomplete. |
| Typography | Mixed | Clear hierarchy, but documented Inter conflicts with implemented Geist and local sizing drifts. |
| Components | Weak–moderate | Accessible library base, but primitive coverage is too narrow for the product breadth. |
| Product patterns | Moderate | Portal shells and states are coherent; workflows and dense admin patterns are locally rebuilt. |
| Responsive design | Moderate | Responsive shells and scrolling tables exist; compact controls and dense workflows remain risks. |
| Accessibility | At risk | Good intent in places, but touch targets, sheets, contrast, skip navigation, and focus consistency need work. |
| Dark mode | Incomplete | Global theme exists, but hard-coded colors and the logo asset are not reliably theme-safe. |
| Content design | Good direction | Honest, action-oriented copy; labels, capitalization, and repeated CTA patterns need governance. |
| Quality assurance | Missing | No Storybook, accessibility automation, visual regression, or viewport test matrix. |

## 3. Design-system reconstruction

### 3.1 Creative direction

| Finding | Truth | Classification |
|---|---|---|
| Creative north star is “Reliable Local Intelligence.” | OBSERVED | ALIGNED |
| Marketing should feel open, persuasive, and locally credible. | OBSERVED | ALIGNED |
| Portals should be denser and optimized for operational clarity. | OBSERVED | ALIGNED |
| The intended tone is calm, trustworthy, capable, and managed—not flashy technology theater. | OBSERVED | ALIGNED |
| Florida-specific visual language uses palm/home imagery, cream ground, deep green, and coral sun/energy. | INFERRED from assets and implementation | ALIGNED |

### 3.2 Identity and assets

Observed owned assets include a Hermes/Mercurius line-art mark, a duotone Southwest Florida home illustration, a provider-at-home photograph, and a service-record illustration. The hero illustration is especially successful: it binds the sage, coral, cream, local-home, and editorial qualities into one recognizable visual system.

**Assessment:** ALIGNED but INCOMPLETE.

- No asset usage, safe-area, minimum-size, file-format, cropping, or photography guidance exists.
- No explicit wordmark lockup or small-size simplified mark was found.
- The current transparent line-art logo is very dark and visually disappears against a dark viewer/background; no light-on-dark logo variant is committed.
- Legacy starter SVGs (`next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`) remain in `public/` without product use, adding asset noise.

### 3.3 Color and themes

The repository defines semantic and brand tokens for background, foreground, cards, primary, secondary, accent, destructive, borders, focus, sage, slate, coral, success, warning, and info. It also defines band surfaces, gradients, and five elevation levels across light and dark themes.

**Strengths**

- Brand colors are centralized in `globals.css`.
- Interaction tokens include hover, active, soft, subtle, border, and focus states.
- Light and dark token sets exist and use modern `color-mix` enhancement with static fallbacks.
- Forced-colors handling exists for gradient text.

**Drift and risk**

- Semantic and brand aliases overlap (`accent`, `sage`, `success`; `primary`, `slate`), without a clear rule for which layer a component should consume.
- Source inspection found approximately **602 direct Tailwind references to raw red/amber/blue/violet/emerald/green/orange/purple scales**. Only 79 `dark:` references exist across all TSX files, so many semantic surfaces cannot be assumed dark-safe.
- Calculated light-theme contrast:

| Token | On white | On cream | WCAG implication for normal text |
|---|---:|---:|---|
| `accent` | 4.55:1 | 4.37:1 | Borderline; fails AA on cream at normal text size. |
| `sage` | 3.37:1 | 3.24:1 | Fails AA for normal text. |
| `sage-dark` | 5.46:1 | 5.24:1 | Passes AA. |
| `coral` | 3.56:1 | 3.42:1 | Fails AA for normal text. |
| `muted-foreground` | 5.06:1 | 4.86:1 | Passes AA. |

- Small `text-accent`, `text-sage`, and `text-coral` labels occur throughout marketing and portal UI. Several are therefore **CONFLICTING** with the documented WCAG AA rule.
- Dark mode defaults to the user’s system preference, yet it is not documented as a supported release contract or covered by visual tests.

### 3.4 Typography

**Observed implementation:** Geist and Geist Mono are loaded; `font-sans` and `font-display` both resolve to Geist. Headings, body copy, uppercase eyebrows, tabular figures, and monospaced identifiers form the working hierarchy.

**Conflict:** `DESIGN.md` names Inter as the primary stack while the root layout loads Geist. This is a direct **CONFLICTING** source-of-truth issue.

Other findings:

- Marketing headline utilities provide a useful large-scale hierarchy.
- Portal pages consistently use compact eyebrow → page title → explanatory copy structures.
- At least 47 arbitrary tracked-text definitions and many 9–11px labels create local variations.
- Typography tokens are described conceptually but not encoded as named, reusable styles across marketing and product surfaces.
- Line length is considered in many pages through `max-w-*`, but it is not governed as a component contract.

### 3.5 Spacing, layout, radius, and elevation

**Observed strengths**

- `container-wide`, `container-narrow`, `section`, and `section-sm` give marketing pages a useful layout vocabulary.
- Portal shells consistently use a 256px desktop sidebar, 64px top bar, and mobile sheet navigation.
- Page padding often follows `p-4 sm:p-6 md:p-8`.
- Rounded cards and modest shadows support the calm visual direction.

**Incomplete system**

- Tailwind spacing is used directly rather than through a documented density or component spacing model.
- 182 arbitrary size/text/spacing references were detected.
- Radius tokens exist, but implementation also uses `rounded-2xl`, `rounded-3xl`, `rounded-full`, and arbitrary radii without semantic definitions.
- Elevation is represented by CSS variables, `elev-*`, Tailwind shadows, `card-priority`, and local shadow combinations—too many parallel authorities.
- `Card` uses a strong ring by default while design documentation prefers a soft border and very soft shadow; pages frequently override the component.

## 4. Component-system assessment

### 4.1 Current primitives

The shared UI directory contains: avatar, badge, button, card, dialog, dropdown menu, input, label, separator, sheet, toast, and tabs.

Base UI underpins several interactive primitives, providing a promising accessible foundation. Class Variance Authority and a shared `cn` utility are used correctly for variants and composition.

### 4.2 Critical component gaps

No canonical shared implementation was found for:

- select / combobox;
- textarea;
- checkbox / radio group;
- switch;
- form field, help, error, and required-state composition;
- table / responsive data list;
- page header and action bar;
- status badge and status vocabulary;
- loading, skeleton, empty, warning, error, and permission states across all roles;
- tooltip;
- breadcrumb;
- pagination;
- file upload;
- progress / stepper;
- date and time selection;
- confirmation pattern for destructive or financial actions.

These omissions explain repeated `selectClass`, `textareaClass`, `Field`, `Toggle`, `Loading`, `Empty`, `Stat`, and status-style definitions across the application.

### 4.3 Button conflict

The documented primary commitment action is sage, while the shared `Button` default is deep slate. Pages repeatedly turn default buttons into sage with local class overrides. The component has no named `accent` or `commit` variant.

**Classification:** CONFLICTING / INCOMPLETE.

This causes inconsistent CTA authority and makes hover, active, focus, dark, and disabled behavior easier to drift.

### 4.4 Touch-target conflict

`DESIGN.md` calls for approximately 40–44px controls. Shared control defaults are smaller:

- Button default: 32px
- Button small: 28px
- Button extra-small: 24px
- Button large: 36px
- Icon default: 32px
- Input default: 32px
- Badge: 20px

Many important routes override to 40–44px, especially marketing and sidebars, but admin tables and icon actions commonly use the compact defaults.

**Classification:** CONFLICTING.
**Accessibility impact:** high for touch, motor accessibility, and dense mobile workflows.

### 4.5 State and status drift

Status presentation is redefined across homeowner dashboard, vendor jobs/messages, admin overview, requests, invoices, applications, tickets, pricing, disputes, and reviews. Similar statuses use different green, sage, emerald, blue, violet, amber, and gray treatments.

**Classification:** UNDOCUMENTED / CONFLICTING.

A canonical component must couple approved MPS status semantics to text label, tone, icon, and accessible description. Color must remain reinforcement, never the only distinction.

## 5. Surface assessment

### 5.1 Marketing and public marketplace

**ALIGNED**

- Strong regional identity and editorial hero art.
- Shared header, footer, marketing shell, hero, and CTA components.
- Consistent honesty-oriented empty/loading states for providers and pricing.
- Responsive grids and legible content measures.
- Lucide icons form a consistent icon language.

**INCOMPLETE / CONFLICTING**

- Some routes append bespoke CTA sections in addition to `MarketingCta`; Services repeats essentially the same “Ready to Get Started?” message twice.
- Header CTA naming alternates between “Get Started,” “Request Service,” and route-specific labels without a content hierarchy.
- Desktop header uses exact-route active states, so nested public routes do not receive a parent active state.
- Public mobile menu trigger has no accessible name.
- Public footer includes an Admin link, already identified by the approved MPS as inappropriate public navigation.
- Root metadata describes an “AI-powered” marketplace while the approved product/design direction says AI should not appear as a separate product identity.

### 5.2 Authentication

**ALIGNED**

- Split-screen layouts, local imagery, visible labels, password visibility controls, loading/success/error messaging, and role-specific sign-in language are mostly coherent.

**INCOMPLETE**

- Similar login/register/reset shells are locally composed rather than governed by one authentication pattern.
- Runtime screen-reader order, autofill, validation announcement, and narrow-height behavior remain unverified.

### 5.3 Homeowner portal

**ALIGNED**

- Clear service-first navigation and prominent request action.
- Responsive sidebar-to-sheet shell.
- Good empty, loading, payment-safety, notification, and action-needed states.
- Job cards expose status text and next action.

**INCOMPLETE**

- Dashboard combines multiple product domains in one large client component, encouraging local display-pattern duplication.
- Query-parameter navigation behaves like app tabs but is displayed as route navigation; focus and history expectations need acceptance.
- Touch-target and small-status-label issues persist.
- Mobile sheet lacks an accessible title/description.

### 5.4 Vendor portal

**ALIGNED**

- Navigation and page hierarchy emphasize jobs, messaging, pricing, and profile readiness.
- Form-heavy workflows use explanatory content and meaningful progress/status language.
- Profile and package tools include responsive stacking and explicit states.

**INCOMPLETE**

- Large local editors contain their own fields, toggles, textareas, badges, state cards, and score visualizations.
- Profile strength uses several 9–10px labels below the preferred readable UI floor.
- “Free” plan badge and plan navigation are premature under the approved MPS.
- Dense package configuration requires dedicated mobile and keyboard acceptance testing.

### 5.5 Admin portal

**ALIGNED**

- Dense operational styling is appropriate and consistent at the shell level.
- Shared Admin loading/error/empty/toggle components show movement toward systemization.
- Tables generally use horizontal overflow instead of breaking the viewport.

**INCOMPLETE / HIGH RISK**

- Eighteen flat navigation items create a long, undifferentiated information architecture.
- Multiple pages still recreate the Admin shared patterns instead of using them.
- Tables often have 750–950px minimum widths; horizontal scrolling preserves layout but is not an adequate mobile operational design by itself.
- Small icon-only edit/delete/open actions often use 24–32px targets.
- Raw semantic color scales dominate status and alert presentation and are not consistently dark-safe.
- Financial and destructive actions lack one visual confirmation and high-risk-action pattern.

## 6. Accessibility audit

### Positive evidence

- Shared inputs/buttons have visible focus-ring styles.
- Many icon-only actions have accessible names.
- Dialog primitives include title and description usage in audited instances.
- Form errors sometimes use `aria-invalid`, `aria-describedby`, `role="alert"`, or `aria-live`.
- Loading indicators sometimes include screen-reader-only text.
- Switches use `role="switch"` and `aria-checked` in several locations.
- Framer Motion is configured to honor the user’s reduced-motion preference.
- Forced-color fallback exists for gradient text.

### High-priority gaps

| ID | Finding | Classification | Severity |
|---|---|---|---:|
| A11Y-01 | All four mobile `SheetContent` usages lack `SheetTitle` and `SheetDescription`. | OBSERVED / INCOMPLETE | High |
| A11Y-02 | Sheet triggers wrap a Button rather than using the primitive’s render/composition API, creating probable nested button semantics. | OBSERVED / CONFLICTING | High |
| A11Y-03 | Public mobile menu icon button has no `aria-label`. | OBSERVED / INCOMPLETE | High |
| A11Y-04 | Default buttons and inputs are below the documented 40–44px target. | OBSERVED / CONFLICTING | High |
| A11Y-05 | Accent, sage, and coral are used as small text colors where calculated contrast fails normal-text AA. | OBSERVED / CONFLICTING | High |
| A11Y-06 | No skip navigation or stable main-content target was found. | OBSERVED / INCOMPLETE | Medium |
| A11Y-07 | Plain custom buttons, native selects, checkboxes, and textareas do not consistently inherit the shared focus/error contract. | OBSERVED / INCOMPLETE | High |
| A11Y-08 | CSS-defined animation utilities have no `prefers-reduced-motion` fallback, although currently observed Framer animation is protected. | OBSERVED / INCOMPLETE | Medium |
| A11Y-09 | Runtime focus trapping, restoration, keyboard table workflows, zoom/reflow, and screen-reader output were not rendered. | UNKNOWN | Release gate |

Target conformance should be **WCAG 2.2 AA** for public and authenticated surfaces.

## 7. Responsive and interaction assessment

**Observed responsive strengths**

- Marketing layouts progressively move from single column to 2–4 column grids.
- CTAs stack on small screens.
- Portal sidebars become sheets under the large breakpoint.
- Content padding and type size step up at defined breakpoints.
- Data tables are wrapped in horizontal overflow containers.

**Risks**

- The design system has no documented viewport matrix or density rules.
- Fixed-width mobile sheets (`w-72`, `w-80`) are used without explicit narrow-device fallback.
- Dense admin tables and vendor editors are merely scrollable rather than redesigned into priority-based mobile layouts.
- Hover-dependent image actions are made focus-visible in some places, but hover behavior is not governed across all interactive cards.
- Loading and permission shells use full-screen centering, which may cause abrupt layout shifts and repeated portal context loss.

Rendered verification remains UNKNOWN.

## 8. Content-design assessment

### Strengths

- Copy generally identifies the next action and avoids fabricated supply or success.
- Empty states explain what is absent and often give a recovery path.
- Payment copy distinguishes Stripe-hosted card entry and server confirmation.
- Portal headings explain operational purpose rather than using abstract labels.

### Drift

- Button labels use inconsistent capitalization: “Try Again,” “Sign Out,” “Manage Cards,” “Request a Service,” and sentence-style helper actions coexist.
- The same intent is named “Get Started,” “Request Service,” “Request a Service,” and “Build My Home Plan.”
- Status labels and operational vocabulary are duplicated outside the canonical product lifecycle.
- Very long inline JSX makes copy review and reuse difficult.
- No content pattern defines title, description, confirmation, error, destructive warning, time/date, currency, or policy language.

## 9. Quality and governance gaps

No evidence was found for:

- a component catalog or Storybook;
- visual regression testing;
- automated accessibility testing;
- design-token linting;
- raw-color or arbitrary-value restrictions;
- breakpoint screenshot tests;
- keyboard/screen-reader acceptance scripts;
- component ownership or maturity status;
- design change log or migration policy;
- Figma/library parity documentation;
- browser and device support matrix.

The existing `DESIGN.md` is a useful creative brief, not a complete design-system authority.

## 10. Prioritized findings

### P0 — Release accessibility and interaction

1. Repair mobile sheet naming/composition and public menu accessible naming.
2. Establish 44px customer-facing and at least 40px dense-product touch targets, with documented exceptions.
3. Replace failing text-color combinations with accessible semantic tokens.
4. Decide whether dark mode is supported; if yes, make all semantic surfaces and assets theme-safe, otherwise remove the user-facing toggle until ready.
5. Add automated axe, keyboard, zoom/reflow, and responsive acceptance for critical MPS journeys.

### P1 — System consolidation

6. Resolve Geist versus Inter and approve one type system.
7. Add semantic button variants, especially a sage commitment action.
8. Build canonical Field, Select, Textarea, Checkbox, Switch, Status, PageHeader, DataTable/DataList, Empty/Error/Loading, FileUpload, Stepper, and ConfirmAction patterns.
9. Replace raw semantic color scales and local status maps with approved tokens.
10. Consolidate elevation, radius, spacing, and density authorities.
11. Reorganize admin navigation and define responsive alternatives to wide tables.

### P2 — Brand and content maturity

12. Define logo variants, safe area, sizing, and dark-background usage.
13. Remove unused starter assets and establish image/photography rules.
14. Standardize CTA wording, capitalization, status vocabulary, and feedback copy.
15. Remove duplicate marketing CTAs and route-specific pattern drift.
16. Add Storybook/design catalog and visual regression baselines.

## 11. Release-state conclusion

The current interface is visually credible enough for a controlled internal or assisted pilot, but it is not yet an approved, enforceable Mercurius Design System implementation. The core identity is **ALIGNED**. Accessibility, component coverage, semantic state handling, dark mode, and automated design assurance are **INCOMPLETE**.

The proposed authority is in [DESIGN-SYSTEM-BLUEPRINT.md](./DESIGN-SYSTEM-BLUEPRINT.md). Owner choices are isolated in [MDS-OWNER-DECISIONS.md](./MDS-OWNER-DECISIONS.md).

No application code was modified during this audit.
