# Phase 5 — Provider invitation operator interface (TRACE-066)

## Scope and recovered behavior

PR #18 merged at `f47ac84`; this slice starts from that main checkpoint. TRACE-063
delivered the invitation dispatch, reconciliation and acceptance contracts but left
operator queue wiring as an explicit follow-up: "Operator UI wiring is a separate
bounded slice; the old approval/resend buttons remain blocked by the existing
endpoint boundary." This slice is that wiring.

Recovered behavior in `/admin/applications` was a legacy pipeline: a "Send invite" /
"Resend invite" button calling the `vendor-invite` `resend` action, a "Sync
onboarding" button calling its `sync` action, and client code that expected the
recovered response to have provisioned an Auth user, granted the vendor role, linked
a contractor and approved the application in one step. Phase 5 already disabled all
three actions at the endpoint, so every one of those controls could only fail: the
Edge function answers `ONBOARDING_REVIEW_REQUIRED` (409). The sync failure was
swallowed into a console warning at page load. None of that code could succeed, and
none of it is retained.

## Contract

1. The invitation queue belongs to a provider already under onboarding review
   (TRACE-065). It is not offered for an application with no review, for a provider
   linked to the cutover path, or for a closed application.
2. `public.vendor_invitation_overview(p_contractor)` is a new **read-only**,
   operator-only readback. It reports the bound application version and whether a
   newer revision exists, the recipient address carried by that bound snapshot, the
   account-link state, the current attempt and the earlier ones. It declares no
   permission and enforces no transition: every decision stays in the TRACE-053/063
   command functions, so this readback cannot become a second, weaker copy of their
   predicates. It writes nothing.
3. The current attempt is the live one when a live attempt exists (at most one, by
   `public.vendor_one_live_invitation`), otherwise the newest closed one. An accepted
   or revoked attempt stays visible as evidence rather than being buried in history.
4. **Expiry is entered by the operator and has no default.** The panel ships no
   preset, no suggested TTL and no inherited value from a previous attempt. An empty,
   unparseable or past expiry disables preparation before any request is made, and
   `vendor_prepare_invitation` independently rejects a null or past expiry. Nothing
   here claims to know the Auth provider's own link lifetime.
5. The preparation idempotency key is `invitation:<per-provider nonce>:<expiry ISO>`.
   Retrying the same expiry replays the same preparation instead of racing a second
   attempt; changing the expiry produces a different key, and the live-attempt index
   then refuses the second attempt rather than quietly creating one.
6. Every command is a `ConfirmAction`, runs through the existing `vendor-invite`
   actions (`prepare`, `send`, `reconcile`, `close`), and is then confirmed by
   re-reading the server. A command whose readback does not show the expected state
   is reported as unconfirmed and the confirmation stays open; the panel never
   reports success from its own optimism.
7. `send` is offered only for a prepared attempt. A disabled delivery environment
   (`MERCURIUS_INVITATION_MODE` unset, the default) surfaces the endpoint's
   `INVITATION_DELIVERY_DISABLED` verbatim. Nothing is retried automatically.
8. An unknown provider result offers reconciliation with an exact Auth user ID and
   no send control. The identity is still verified in the database against the
   recorded recipient and invitation timing; the panel only refuses an input that is
   not a UUID before spending a request.
9. Closure requires a reason. Revocation is offered for a live attempt; recording an
   expiry is offered only once the operator-entered expiry has passed, and
   `vendor_close_dispatched_invitation` independently refuses an early expiry and
   refuses to close an unreconciled result.
10. Blocking provider state — an existing account, an unusable snapshot recipient, a
    stale bound application version, suspension or rejection — is explained in place
    instead of offering an action that can only fail.

Preparing, sending, reconciling, accepting or closing an invitation still grants no
role, links no account, approves no compliance, proves no mailbox delivery and
activates no provider. The panel states this at each step.

## Execution boundary

No transport, Edge function, environment contract or delivery mode changes in this
slice. Dispatch remains disabled by default and local-only under the TRACE-063
boundary. The new database function is read-only and granted to `authenticated`,
where `vendor_require_operator()` gates it; `anon` and `service_role` are refused.
No production change, email, Auth call, role grant, payment, payout, scheduler
activation or deployment is performed.

## Removed legacy surface

- The `resend` invocation, its provisioning readback and its success toast.
- The `sync` invocation at page load and the "Sync onboarding" button, replaced by a
  plain "Refresh queue" reload of the same authenticated query.
- The blocked "Send invite" / "Resend invite" button.

The recovered `vendor_applications` invite columns are still displayed, relabelled
"Legacy onboarding pipeline" and marked as history, so existing rows remain readable
without implying the queue acts on them.

## Acceptance and follow-ups

Evidence is recorded in PHASE-5-VALIDATION.md. SQL suite 033 covers permissions, the
missing-onboarding case, the pre-preparation state, the reported snapshot recipient,
stale bound versions, each dispatch state, the acceptance receipt, live versus prior
attempt ranking, expiry reporting, and a row fingerprint proving the readback writes
nothing.

Open items for review:

- **Pre-existing MDS defect, surfaced by this slice.** `DialogFooter` bleeds to the
  dialog edge with `-mx-4` while `DialogContent` scrolls with `overflow-y-auto`.
  Once the content scrolls, the footer overflows the padding box by the scrollbar
  width and the dialog scrolls horizontally at 320px. Adding this panel makes the
  applications dialog scroll, so the defect is now reachable there. It is a shared
  MDS primitive used by every dialog; the fix belongs to an MDS slice, not this one.
  The reflow assertion in this slice's browser tests is scoped to the panel and the
  defect is not asserted away.
- The pre-existing dark-theme contrast defect in the applications queue table
  (recorded under TRACE-065) is unchanged.
- Existing-account linking remains the next bounded slice; the panel reports the
  block and offers no action.
- Hosted delivery, mail templates, redirect allowlists, real Auth/mail-sink
  behavior, actual mailbox-delivery receipts, renewal/retention operations and
  authorized integration acceptance remain Phase 5 gates.
- Whether the invitation queue should also appear in the provider compliance
  workbench rather than only in the applications dialog is an operations decision,
  not a page-local one.
