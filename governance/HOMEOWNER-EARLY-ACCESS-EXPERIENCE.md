# Mercurius homeowner early-access experience v0.1

**September 28, 2026 · Experience design approved by Josh**  
**Consumes:** approved layered-launch direction and existing Marketplace MDS blueprint/tokens/components.  
**Boundary:** approved visual and interaction direction; exact data/consent rules and secure booking control remain MPS/MTS decisions.

## Experience in one view

`Explore Marketplace → Join early access → Optional account → Waiting home → Invitation → Controlled booking`

Joining records interest; creating an account makes a homeowner an early-adopter candidate. Neither action opens booking or grants Credits. Vendor applications and admin review follow their existing flow.

## 1. Public early-access page (`/early-access`, proposed route)

Use the existing public Header/Footer, cream/sage marketing surfaces, shared typography, Card, Input, Label, Button and status components. Avoid a new visual sub-brand or promotional countdown.

### Desktop composition

| Left, explanatory column | Right, form card |
| --- | --- |
| Eyebrow: **Lee County early access** | Heading: **Join early access** |
| H1: **A better way to care for your home is on its way.** | Email address * |
| “Explore local services and providers now. We’re inviting homeowners to book in stages as approved providers become available.” | ZIP code * (Lee County selection/validation); service interests * (multi-select from actual catalog, plus “I’m still exploring”) |
| Three short facts: “Explore now”; “Booking by invitation”; “No payment to join.” | Optional first name; separate unchecked checkbox for product/launch updates; primary button **Join early access** |
| Link: **Browse services** | Privacy link and text: “Joining does not create a service request or guarantee an invitation.” |

On mobile, stack the explanation above the full-width form. Put the heading, one-sentence promise and first field high on the screen; keep all labels visible and a single-column service picker. The form should not be hidden behind a modal or require a password.

### Public entry points

- Header “Request service,” homepage plan builder, service/pricing cards, provider-profile request actions and footer CTAs lead to early access during recruiting, preserving the selected service context when possible.
- A person can still browse the real catalog and approved public providers. Unavailable service and missing provider states stay truthful.
- Direct `/request` and checkout URLs show the same closed-state explanation for non-invited users. MTS must enforce this on the command/backend too; navigation is only the visible layer.
- Public `/register` leads to the optional-account step or explains the early-access sequence; it must not imply immediate booking.

## 2. Submission result and optional account

After a confirmed save, replace the form card with a persistent success panel:

> **You’re on the early-access list.**  
> We’ll invite homeowners in stages when services are ready in their area. Joining did not book a service.  
> **Create my account** · **Continue exploring**

The account button opens the existing auth pattern, with the email prefilled only when it can be done safely. Explain the benefit plainly: “Keep your account ready and see your early-access status.” Do not claim an earlier place in line, a guaranteed trial spot, or an award for signing up. Existing email verification and recovery patterns apply. If the account already exists, show **Sign in** instead of asking for another password. After verification/sign-in, link the interest record using verified ownership and show the waiting home.

If confirmation is unknown after a timeout, show **Check submission** or a safe retry that cannot create duplicate list entries. A duplicate email gets a neutral “We’ve received your interest” response without exposing whether that address has an account. The result is announced to screen readers and focus moves to the result heading.

## 3. Signed-in waiting home (`/dashboard`, recruiting cohort)

Replace the normal job/invoice-first overview for non-invited early-access accounts with a focused waiting state using the existing light portal shell:

| Region | Content/action |
| --- | --- |
| Status banner | **Early access · Waiting for an invitation**; “Booking is opening in stages across Lee County.” |
| Your interests card | ZIP and selected services; **Update interests** and save/readback feedback. Never show an invented queue number. |
| Explore card | **Browse services** and **Explore providers**, with actual available information. |
| Next steps | “We’ll email you if your area and service are selected for a trial. Your account is ready; no booking is active.” |
| Account | Profile settings, email preferences and sign out. |

Hide request, upcoming jobs, invoices, payment methods and messaging actions that would be empty or imply an active transaction. Do not create a fake job, balance or Credits wallet. Existing historical records for a preexisting account must remain accessible; show an honest closed-to-new-bookings notice without hiding legitimate past jobs, invoices or support history.

### Invited trial state

When a specific account is admitted, the status changes to **Invited to book**, with the relevant service/coverage scope and a clear **Request a service** action. If an invitation expires, is revoked, or the service becomes unavailable, explain the state and offer support/interest updates without exposing a booking path. Wider opening removes the recruiting restriction only by an explicit release control.

## 4. Error, accessibility and responsive behavior

| State | Visible behavior |
| --- | --- |
| Invalid ZIP or no Lee County coverage | Inline error; explain Lee County boundary and allow a truthful interest response only if MPS authorizes out-of-area capture. Do not promise a service invitation. |
| Submission refused/rate limited | Preserve typed values; show nontechnical retry guidance and a contact path. |
| Storage unavailable | State that the request was **not confirmed**; do not show success based solely on an attempted email. |
| Email delivery problem | Saved interest remains visible to the operator; do not say an email was sent unless delivery is confirmed. |
| Account verification pending | Explain the verification step and route back to sign-in/status without claiming account access. |
| Signed-in interest record missing | A recovery prompt to add ZIP/services, not an empty booking dashboard. |
| Existing account with history | Preserve history/support while restricting new requests according to cohort authorization. |

Use existing 44px minimum targets and semantic form controls, clear required labels, `aria-describedby` error text, focus order and live-region result announcement. At 320px and 200% zoom, cards stack without horizontal scrolling; at reduced motion, no essential information depends on animation. Test keyboard, screen reader, contrast and both light/dark modes against the MDS WCAG 2.2 AA target.

## 5. What this changes in the existing routes

| Surface | Design treatment |
| --- | --- |
| `/`, `/homeowners`, `/services`, `/pricing`, `/providers`, `/providers/[id]` | Keep current layouts; swap booking promises/CTAs for early access while recruiting. Provider data remains factual. |
| `/request`, `/checkout/[snapshotId]` | Closed or invited state, including direct navigation; preserve legitimate existing records and recovery paths. |
| `/register`, `/login`, `/forgot-password`, `/set-password` | Reuse auth pattern; clarify optional account and verification, retain accessible errors. |
| `/dashboard`, `/account`, homeowner navigation | Waiting home for new non-invited users; preserve account controls and prior transaction history where applicable. |
| `/early-access` | New public form and submission-result states. |

## 6. Product and technical decisions returned for closure

- **MPS:** exact minimum fields, whether name is optional, whether out-of-area interest is accepted, update frequency, marketing consent/retention/deletion, account-to-interest matching and trial admission/exit policy. The fields/layout above are proposed, not approved policy.
- **MDS:** approve the compositions and copy before implementation; review desktop/mobile and all listed states as part of the Marketplace route sweep.
- **MTS:** persistent, deduplicated interest storage; abuse limits; server/database booking and checkout gates; invitation authorization; verified account linking; monitoring and release/rollback. A client redirect is not sufficient.
- **Operations:** owner of early-access review and invitation communications, support contact, and daily failed-form/email check.
- **Vendor email launch acceptance:** verify real hosted vendor application save → admin queue → Resend owner notification to Josh, with a failure visible in operations; separately verify Supabase Auth vendor account invitation delivery. No claim that hosted Resend is already connected.

## Founder approval and next gate

Josh approved the public early-access form composition, optional account step, signed-in waiting home and route/state sweep on September 28, 2026 (ET). The optional-account and staged-invitation product direction was already approved. The proposed minimum fields and separate marketing consent still require product/privacy wording and technical acceptance before live collection; this design approval does not authorize production database migration, email activation, domain move or transactional opening.

**Next:** reconcile the approved experience into a bounded build brief. Specify the server/database booking gate and invited-cohort exception, interest storage and account linkage, route copy, accessible states, operator readback, and hosted form/Resend checks. Preserve the existing rebuild phase order and review each change against the approved Marketplace MPS/MDS/MTS.
