# MDS component foundation

Status: **beta**. Authority: approved MDS §§3–8 and Roadmap Phase 3.

Run a local build with placeholder Supabase configuration and
`MERCURIUS_BUILD_WORKERS=1`, then enable `MDS_CATALOG_ENABLED=1` in the local
server process and visit `/mds`. The route returns 404 unless explicitly enabled;
it is not linked from public navigation and is marked noindex. Examples contain
synthetic data and never call marketplace write APIs.

## Contracts

| Pattern | Contract |
|---|---|
| Button | `commitment` uses sage; default remains neutral slate for compatibility. Default/sm/xs and icon variants have 44px minimum targets. `compact` and `icon-compact` explicitly opt into 40px internal targets. `loading` disables activation and exposes busy state; caller supplies meaningful loading text. Use `render` for Base UI composition, never a nested button. |
| Input, Select, Textarea | Labeled through FormField; native selection and multiline editing. Comfortable minimum 44px, explicit compact Input/Select 40px. Read-only, disabled, invalid and help relationships are supported. Searchable combobox is a later component. |
| FormField | Render function supplies id, required, described-by, and invalid props. Spread them onto exactly one control. Help and errors use distinct stable IDs; errors are announced. FormErrorsContext supplies shared field errors; FormErrorSummary focuses a persistent list of links to affected controls. Routes own validation rules and step focus. |
| Checkbox, Switch | Visible wrapping label gives a minimum 44px effective target; native checkbox keyboard behavior. Switch uses a visible track/thumb, focus ring, and on/off semantics. No destructive action belongs on a Switch. Group validation belongs on a fieldset/legend. |
| Status | Typed MPS §5.1 request vocabulary, explicit text and five semantic tones. Optional live announcement. No legacy-state mapping or backend transition changes. Role guidance and other domain maps belong to Phase 4. |
| ResponsiveDataList | One row/column data model, labelled mobile records, native desktop table with scoped headers, named keyboard-scroll region. Actions require row-specific names. |
| PageHeader | One page title, optional eyebrow/description/metadata/actions; actions wrap on narrow screens. |
| PageState | Loading, empty, error and permission feedback. Dynamic loading/error text is announced; actions remain outside live regions. |
| ConfirmAction | Named entity and consequence, optional required reason, Cancel receives initial focus, focus restores on close. Pending disables repeat clicks and dismissal; failure stays open and receives focus. Server authorization, durable idempotency, and ambiguous-outcome reconciliation remain caller responsibilities. |
| Sheet, Dialog, Tabs | Base UI owns keyboard behavior. Sheets/dialogs require titles and descriptions at call sites, scroll at short heights, and preserve library focus management. Tabs wrap at narrow widths. |

## Tokens and identity

`src/app/globals.css` is the CSS/Tailwind token source. The Phase 3 foundation
section contains explicit light/dark commitment and status pairs. It overrides
legacy mixed accent/focus shades to avoid translucent focus rings and borderline
text contrast. New components must use semantic tokens; do not introduce raw
Tailwind colors at route level. Black overlay backdrops are a documented exception.

Geist is approved for product and marketing; Geist Mono remains for identifiers.
The inherited transparent Hermes PNG retains its geometry. Existing rendered
logo instances use CSS inversion in dark mode. A deterministic full-symbol and
Geist lockup export kit is available at `/mds/brand`; the simplified vector mark
and proposed minimum sizes remain subject to owner review. See `BRAND-ASSETS.md`.

## Verification

After a placeholder/local build, `npm run test:a11y` starts its own server at
127.0.0.1:3103 with the catalog enabled. Tests use one Chromium worker. Catalog/request tests block external origins;
portal tests also allow the isolated synthetic service on 127.0.0.1:55831.
Build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831` and the example
synthetic key before running browser tests. Neither Supabase stack is required. Tests cover
light/dark at 320, 390, 768, 1024, and 1440px, axe, actual content overflow,
keyboard, focus, native controls, confirmation outcomes and theme persistence.

`npm run test:visual` compares platform-specific screenshots. Use
`npm run test:visual -- --update-snapshots` only for a reviewed intentional change.
Windows baselines must not be represented as Linux/macOS baselines. Screenshot
review and human screen-reader validation are separate from axe results.

## Migration boundary

This checkpoint repairs shared primitives, public/portal mobile-sheet composition,
existing main focus targets, global focus/colors, and theme treatment. The catalog
establishes APIs before broad route migration. Request forms, admin request records, vendor job dialogs, and homeowner
payment/service feedback now exercise these patterns with synthetic accounts.
Broader route migration stays staged behind lifecycle alignment.
Do not infer that payment, dispute, vendor job or admin money journeys pass from
the synthetic catalog. Lifecycle, scheduler, and payment integrity remain in their
approved owning phases.
