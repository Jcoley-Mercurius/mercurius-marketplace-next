/** money-v1: integer minor units only. No provider I/O or lifecycle transitions. */
export const MONEY_POLICY = "CFG-005/008:money-v1";
export type Components = Readonly<{ service: number; tax: number; tip: number }>;
export type CommercialTerms = Readonly<{
  service: number; addons: number; discount: number; adjustment: number;
  tax: number; tip: number; deposit: number; currency: "usd";
  sourceVersion: string; policyVersion: string; taxEvidence: string;
  promotionTerms: string | null;
}>;

export function cents(value: number, signed = false): number {
  if (!Number.isSafeInteger(value) || (!signed && value < 0)) throw new Error("INVALID_MINOR_UNITS");
  return value;
}
export function reference(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error("EVIDENCE_REQUIRED");
  return value;
}
export function sum(parts: Components): number {
  return cents(cents(parts.service) + cents(parts.tax) + cents(parts.tip));
}
export function fee(service: number): number {
  // BigInt avoids binary floating-point and intermediate multiplication overflow.
  return Number((BigInt(cents(service)) * 15n + 50n) / 100n);
}
export function commercial(terms: CommercialTerms) {
  if (terms.currency !== "usd") throw new Error("UNSUPPORTED_CURRENCY");
  reference(terms.sourceVersion); reference(terms.policyVersion); reference(terms.taxEvidence);
  if (terms.discount > 0) reference(terms.promotionTerms ?? "");
  const subtotal = cents(cents(terms.service) + cents(terms.addons) - cents(terms.discount) + cents(terms.adjustment, true));
  const total = sum({ service: subtotal, tax: terms.tax, tip: terms.tip });
  if (cents(terms.deposit) > subtotal) throw new Error("DEPOSIT_EXCEEDS_SERVICE");
  return Object.freeze({ ...terms, subtotal, total, platformFee: fee(subtotal), providerPayable: cents(subtotal - fee(subtotal) + terms.tip) });
}
export function retained(original: Components, refunded: Components, chargeback: Components = { service: 0, tax: 0, tip: 0 }) {
  sum(original); sum(refunded); sum(chargeback);
  const result = Object.freeze({
    service: cents(original.service - refunded.service - chargeback.service),
    tax: cents(original.tax - refunded.tax - chargeback.tax),
    tip: cents(original.tip - refunded.tip - chargeback.tip),
  });
  return Object.freeze({ ...result, total: sum(result), platformFee: fee(result.service), providerPayable: cents(result.service - fee(result.service) + result.tip) });
}

export type LedgerAccount = "stripe_clearing" | "customer_advance" | "platform_revenue" | "tax_liability" | "provider_payable" | "processor_expense" | "chargeback_suspense" | "bank";
export type Posting = Readonly<{ account: LedgerAccount; debit: number; credit: number }>;
export function balanced(lines: readonly Posting[]): readonly Posting[] {
  let balance = 0n;
  if (lines.length < 2) throw new Error("EMPTY_JOURNAL");
  for (const line of lines) {
    cents(line.debit); cents(line.credit);
    if ((line.debit > 0) === (line.credit > 0)) throw new Error("INVALID_POSTING");
    balance += BigInt(line.debit) - BigInt(line.credit);
  }
  if (balance !== 0n) throw new Error("UNBALANCED_JOURNAL");
  return Object.freeze(lines.map(line => Object.freeze({ ...line })));
}
export function captureJournal(amount: number): readonly Posting[] {
  cents(amount);
  return balanced([{ account: "stripe_clearing", debit: amount, credit: 0 }, { account: "customer_advance", debit: 0, credit: amount }]);
}
export function earningsJournal(parts: Components): readonly Posting[] {
  const amount = sum(parts), platform = fee(parts.service), provider = parts.service - platform + parts.tip;
  return balanced([
    { account: "customer_advance", debit: amount, credit: 0 },
    ...[{ account: "platform_revenue" as const, debit: 0, credit: platform },
      { account: "tax_liability" as const, debit: 0, credit: parts.tax },
      { account: "provider_payable" as const, debit: 0, credit: provider }].filter(line => line.credit > 0),
  ]);
}
/** Recompute on the cumulative retained subtotal: never round each refund's fee independently. */
export function refundJournal(before: Components, allocation: Components): readonly Posting[] {
  const after = retained(before, allocation), old = retained(before, { service: 0, tax: 0, tip: 0 });
  return balanced([
    ...[{ account: "platform_revenue" as const, debit: old.platformFee - after.platformFee, credit: 0 },
      { account: "provider_payable" as const, debit: old.providerPayable - after.providerPayable, credit: 0 },
      { account: "tax_liability" as const, debit: allocation.tax, credit: 0 }].filter(line => line.debit > 0),
    { account: "stripe_clearing", debit: 0, credit: sum(allocation) },
  ]);
}
export function processorCostJournal(amount: number): readonly Posting[] {
  return balanced([{ account: "processor_expense", debit: cents(amount), credit: 0 }, { account: "stripe_clearing", debit: 0, credit: amount }]);
}

export type CheckoutAttempt = Readonly<{
  id: string; snapshotId: string; amount: number; currency: "usd";
  idempotencyKey: string; createdAt: string; expiresAt: string;
  status: "prepared" | "session_created" | "captured" | "expired" | "reconcile";
  sessionId: string | null; url: string | null;
}>;
export interface CheckoutStore {
  // Database authenticates owner, locks commercial obligation, enforces version and amount.
  prepare(customerId: string, snapshotId: string, mode: "full" | "deposit" | "balance"): Promise<CheckoutAttempt>;
  attach(attemptId: string, sessionId: string, url: string): Promise<void>;
  flag(attemptId: string, code: string): Promise<void>;
}
export interface CheckoutProvider {
  create(input: { attemptId: string; amount: number; currency: "usd"; expiresAt: string; idempotencyKey: string }): Promise<{ id: string; url: string }>;
}
/** Both former checkout entrypoints must delegate here; only IDs/mode cross the browser boundary. */
export async function checkout(store: CheckoutStore, provider: CheckoutProvider, customerId: string, snapshotId: string, mode: "full" | "deposit" | "balance", now: Date) {
  const attempt = await store.prepare(reference(customerId), reference(snapshotId), mode);
  if (attempt.status === "captured") throw new Error("ALREADY_CAPTURED");
  if (attempt.status === "expired" || Date.parse(attempt.expiresAt) <= now.getTime()) throw new Error("CHECKOUT_EXPIRED");
  if (attempt.status === "reconcile") throw new Error("RECONCILIATION_REQUIRED");
  if (attempt.sessionId && attempt.url) return { id: attempt.sessionId, url: attempt.url };
  if (Date.parse(attempt.expiresAt) - now.getTime() < 30 * 60 * 1000) {
    await store.flag(attempt.id, "SESSION_WINDOW_CLOSED");
    throw new Error("RECONCILIATION_REQUIRED");
  }
  // Stripe can prune keys after 24h. Never blindly retry an uncertain operation after that window.
  if (now.getTime() - Date.parse(attempt.createdAt) >= 23 * 60 * 60 * 1000) {
    await store.flag(attempt.id, "IDEMPOTENCY_WINDOW");
    throw new Error("RECONCILIATION_REQUIRED");
  }
  try {
    const session = await provider.create({ attemptId: attempt.id, amount: cents(attempt.amount), currency: attempt.currency, expiresAt: attempt.expiresAt, idempotencyKey: attempt.idempotencyKey });
    reference(session.id); reference(session.url);
    await store.attach(attempt.id, session.id, session.url);
    return session;
  } catch (error) {
    // Preserve the prepared row/key. Network uncertainty is not permission for a new charge.
    throw error;
  }
}

export type PayoutEligibility = Readonly<{
  homeownerConfirmedAt: string | null; confirmationEvidence: string | null;
  disputed: boolean; chargebackOpen: boolean; reconciliationOpen: boolean;
  vendorEligible: boolean; bankAuthorizationEvidence: string | null;
  captured: number; total: number; payable: number;
}>;
export function payoutEligibility(input: PayoutEligibility, now: Date): { eligible: boolean; reason: string } {
  if (!input.homeownerConfirmedAt || !input.confirmationEvidence) return { eligible: false, reason: "HOMEOWNER_CONFIRMATION_REQUIRED" };
  const confirmed = Date.parse(input.homeownerConfirmedAt);
  if (!Number.isFinite(confirmed) || !Number.isFinite(now.getTime())) throw new Error("INVALID_TIME");
  if (input.disputed || input.chargebackOpen) return { eligible: false, reason: "DISPUTE_HOLD" };
  if (input.reconciliationOpen) return { eligible: false, reason: "RECONCILIATION_HOLD" };
  if (!input.vendorEligible || !input.bankAuthorizationEvidence) return { eligible: false, reason: "ONBOARDING_HOLD" };
  if (cents(input.captured) !== cents(input.total)) return { eligible: false, reason: "PAYMENT_INCOMPLETE" };
  if (now.getTime() < confirmed + 48 * 60 * 60 * 1000) return { eligible: false, reason: "48_HOUR_WINDOW" };
  return { eligible: cents(input.payable) > 0, reason: input.payable > 0 ? "ELIGIBLE" : "NO_PAYABLE" };
}

export type BankState = "prepared" | "submitted" | "unknown" | "settled" | "failed" | "returned";
export function bankTransition(from: BankState, to: BankState, evidence: string): BankState {
  reference(evidence);
  const allowed: Record<BankState, BankState[]> = {
    prepared: ["submitted"], submitted: ["unknown", "settled", "failed"],
    unknown: ["settled", "failed"], settled: ["returned"], failed: [], returned: [],
  };
  if (!allowed[from].includes(to)) throw new Error("INVALID_BANK_TRANSITION");
  return to;
}
export function canRetryBank(state: BankState, bankEvidence: string | null): boolean {
  return (state === "failed" || state === "returned") && Boolean(bankEvidence?.trim());
}
