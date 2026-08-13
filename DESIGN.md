# DESIGN.md — Mercurius

## 1. Overview
**Creative North Star: "Reliable Local Intelligence"**

Mercurius should feel like a well-run local home-services business that happens to use excellent modern software: calm, trustworthy, and capable. Not flashy startup theater. Not generic teal SaaS.

Surfaces split into two registers:
- **Brand / marketing** — more open, persuasive, breathing room, strong hierarchy
- **Product / portals** — denser, faster, operational clarity (homeowner dashboard, vendor portal, admin)

Key characteristics:
- Warm cream / off-white grounds with deep slate text
- Sage green as the primary action / managed accent
- Occasional coral/warm accent for energy or secondary emphasis — sparingly
- Clean cards, soft elevation, generous marketing spacing
- Strong hierarchy that always points to the next useful action

## 2. Colors
Tokens are expressed to match the live Next.js theme (HSL-style values used in globals).

### Brand
- **Primary / Slate** — deep slate for headlines, structural chrome, strong buttons when not sage  
  Approximate: `hsl(220 20% 15–20%)` / near `#1E293B`–`#0F172A`
- **Accent / Sage** — primary CTAs, managed signals, focus energy  
  Approximate: `hsl(150 35% 45%)`  
  Hover: slightly deeper sage  
  Soft sage tints for chips/badges
- **Coral / Warm accent** — sparse highlights only (not primary actions)

### Surfaces
- **Background** — warm off-white / cream: `hsl(40 20% 98%)` range
- **Surface** — white cards and panels
- **Surface raised** — subtle nested/grouping surfaces
- **Border** — soft warm-gray borders; stronger on inputs/focus

### Text
- **Text** — deep slate (primary body + headlines)
- **Text secondary** — mid slate
- **Text muted** — captions, metadata, placeholders
- **Text inverse** — white on sage or dark buttons

### Semantic
- **Success** — soft green chips for completed / managed / confirmed
- **Warning** — amber for attention
- **Danger** — clear red for errors/destructive only

### Rules
- Do **not** replace sage with teal, cyan, or purple brand systems
- Do **not** use pure black large backgrounds or neon accents
- Accent orange/coral is highlight energy, not the default CTA color
- Soft green status treatments preferred for “managed / completed”
- Maintain WCAG AA contrast minimums

## 3. Typography
Primary stack: **Inter** (or system-ui / -apple-system fallbacks) — intentional for product legibility.

- **Display / Hero** — large, tight tracking, strong weight; marketing only
- **Headline** — section titles
- **Title** — cards, modals, subsections
- **Body** — comfortable reading measure (~60–75 characters)
- **Body small** — helper text, table secondary
- **Label / eyebrow** — uppercase or small tracked labels for categories/status

### Rules
- Hierarchy through size/weight, not decorative display fonts
- Avoid editorial italic serif heroes
- Do not invent a second type system per page

## 4. Elevation & depth
Subtle and functional:
- Default cards: light border + very soft shadow (or border-only on dense product UI)
- Raised interactive cards: slightly stronger border or single soft shadow
- Modals: stronger shadow + dimmed backdrop
- Prefer spacing and borders over nested cards-in-cards

## 5. Components
### Buttons
- **Primary** — sage fill, inverse text, medium radius, clear hover/active
- **Secondary / outline** — slate or sage outline
- **Ghost** — low emphasis
- Destructive — danger color + confirmation pattern
- Comfortable touch targets (~40–44px height)

### Cards
- White surface, light border, medium-large radius, consistent padding
- Avoid deep nesting

### Forms
- Clear labels above fields
- Visible focus rings (sage or strong border)
- Errors: message + border, never color alone

### Navigation
- Clear primary vs secondary actions
- Active states via soft sage background or underline — not heavy fills
- Mobile prioritizes the primary job (request / status / apply)

### Status
- Soft tinted chips + strong text/icon
- Empty states include a clear next action

## 6. Do's and Don'ts
### Do
- Prioritize the user’s next action
- Use sage for commitment actions and deep slate for headlines/structure
- Keep marketing open and product dense-but-clear
- Signal local SWFL credibility
- Stay soft-launch honest in all copy and UI chrome

### Don't
- Don’t invent metrics, ratings, or testimonials
- Don’t drift into purple/blue gradient “AI SaaS” defaults
- Don’t wrap every block in its own shadowed card
- Don’t claim dedicated account managers or universal coverage unless true
- Don’t restyle the brand to teal because a template prefers it
- Don’t make AI features look like a separate product

## 7. Agent usage notes
- Always read PRODUCT.md + this DESIGN.md before generating or polishing UI
- Prefer existing components under the project’s UI kit over inventing new primitives
- When polishing marketing pages, preserve honesty constraints from PRODUCT.md
- Match live sage/cream/slate — do not “upgrade” the palette to generic teal