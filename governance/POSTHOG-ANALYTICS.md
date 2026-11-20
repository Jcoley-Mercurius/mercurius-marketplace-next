# Marketplace usage analytics — TRACE-157

Owner authorization: Josh requested a free-only PostHog integration, approved visits,
clicks, sign-in and conversion tracking plus masked replay, requested a **new dedicated
Mercurius Marketplace project**, and authorized website implementation and validation
on 2026-11-19 ET. This bounded integration implements MPS §11 / Roadmap Phase 7;
it does not accept the rest of Phase 7 or activate booking/payment/email features.

## Project and cost boundary

- Project: **Mercurius Marketplace**, ID **753506**, US Cloud; ingestion host
  `https://us.i.posthog.com`. The legacy Vertex project is not used.
- All 15 available organization product spending caps were independently read back
  as **$0** after creation. Analytics allows 1M events and replay 5K recordings per
  billing period, shared across the organization, including its older projects.
- The organization retains pay-as-you-go naming and its existing retention benefit.
  This change does not buy a plan, support package, group analytics or AI product.
- Logs custom retention cannot be capped. It was unused at readback and this app
  does not initialize PostHog Logs or custom log retention.
- Browser ingestion goes **directly** to PostHog. No Vercel ingestion proxy is added:
  replay proxy bandwidth would incur separate Vercel request/data-transfer usage.
  Some tracking blockers will therefore prevent collection. Consider PostHog's free
  managed proxy separately if this becomes a measured problem.

## Collection contract

The SDK initializes only with the optional production environment configuration,
on either Marketplace HTTPS origin, after explicit opt-in. Unconfigured builds,
preview hosts, refusal, GPC and DNT do not collect PostHog data. Loopback is allowed
only in development for the synthetic test lane. Required Supabase configuration
is unchanged. Existing privacy-redacted Vercel pageviews remain separate.

The preference uses a versioned, six-month SameSite=Lax cookie (Secure on HTTPS)
and a nonidentifying local-storage preference for cross-tab notification. It is
independent of email/SMS marketing consent and essential authentication storage.
The footer reopens preferences. Refusal clears SDK persistence and stops future
capture; previously received data requires the existing privacy-request process.

| Event | Trigger / dimensions |
|---|---|
| `$pageview` | Permitted page route, sanitized URL, safe campaign tags and referring origin; SPA route transitions included |
| `navigation_clicked` | Internal link destination; public provider ID when applicable; no link text or raw href |
| `button_clicked` | Button ordinal and a curated action where supplied; no DOM labels, attributes or values |
| `page_scrolled` | 25/50/75/100 percent milestones on public replay-safe pages |
| `provider_profile_viewed` | Successfully loaded public provider, public provider ID |
| `service_viewed` | Explicit service focus on a public provider profile; service/provider IDs |
| `login_succeeded`, `login_failed` | Explicit password-login outcome; no credentials or error messages |
| `signup_submitted` | Auth provider accepted signup; does not claim email verification |
| `request_started`, `request_step_completed` | Valid forward steps; service count and step only |
| `request_submitted` | Successful request RPC result; reused/idempotent saves excluded; count only |
| `coverage_checked` | Server-confirmed covered/waitlist/uncovered outcome; no ZIP or address |
| `early_access_submitted` | Server confirmed saved outcome, early-access/expansion kind only |

Stable Supabase UUIDs link consented account activity. Logout/account switches reset
the SDK identity. Anonymous browser/session UUID headers link the two server-side
outcomes; these headers never authorize a product action or establish an account.
Server analytics runs after the business response, with bounded timeouts, no
retries and contained errors. It cannot change a submitted request or email result.

The event/property projection drops unknown event families and fields, nested
person properties, DOM data, raw errors, names, emails, phone numbers, messages,
addresses, uploaded files and payment data. All raw queries/fragments are removed.
Only five constrained `utm_*` values are accepted; ad-click IDs and search text are
not collected. This enables campaign attribution, not a connection to an ad account
or proof of ad-platform spend, impressions or performance.

## Replay boundary

Project settings: all inputs/text masked, images blocked, 25% sampling, minimum
10 seconds, 30-day retention. Console and network capture are off. Client config
also blocks embedded content, canvases, private elements and JSON-LD capture.
Only public allowlisted routes qualify; request/contact/early-access forms,
auth, portals, payments, documents and unknown routes do not. Any query string or
fragment prevents replay. Router transitions stop recording before the next page
renders. The project URL blocklist supplies additional private-page/query guards.

`NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED` and the project's recording switch must both
be enabled only after browser snapshot checks pass. A matching public URL is not
permission to capture a private screen.

## Verification and release

- Unit tests: property projection, token/query redaction, consent/GPC/DNT,
  account/reset behavior, replay gating, server outcome minimization and outages.
- `npm run test:analytics`: isolated browser lane with real SDK/recorder and
  synthetic requests; no hosted data/providers. Checks no pre-consent traffic,
  campaign attribution, SPA pageviews, withdrawal, snapshot masking, private-form
  exclusion, 320px preferences/axe and blocked-provider browsing.
- Dedicated `Analytics privacy` CI job runs independently of the database lane.
- Typecheck, changed-file ESLint, unit regression, secret scan and production build
  remain required. A local browser sandbox/download failure is not a passed test.
- Production variables: `NEXT_PUBLIC_POSTHOG_ENABLED`,
  `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`,
  `NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED`. Actual values stay in Vercel configuration.
- Merge via the normal reviewed-PR release path; no schema or migration change.
- Post-deployment: verify the deployment SHA, one consented synthetic pageview and
  navigation in project 753506, refusal stops collection, and billing caps remain $0.
  Test login/request outcomes with isolated fixtures; don't create real service
  requests merely to populate analytics.
- Rollback: promote the previous Vercel production deployment. Setting
  `NEXT_PUBLIC_POSTHOG_ENABLED=0` requires a rebuild; PostHog's recording switch can
  stop replay remotely. An ingestion outage must leave business actions working.

Implementation validation is recorded in the PR; deployment and live ingestion
must be reported separately from local or synthetic evidence.

References verified through the connected PostHog documentation:
[Next.js](https://posthog.com/docs/libraries/next-js),
[replay privacy](https://posthog.com/docs/session-replay/privacy),
[data collection](https://posthog.com/docs/privacy/data-collection),
[proxy cost implications](https://posthog.com/docs/advanced/proxy/nextjs).
