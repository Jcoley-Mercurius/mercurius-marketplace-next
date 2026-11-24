// DEC-2026-067 (TRACE-160): the pilot standard commission and its promotional half.
//
// Display only. The database computes and stamps every commission amount:
// private.money_commission_policies holds the rate in force, money_publish_snapshot stamps it on
// each booking's snapshot (money_snapshots.commission_rate_bps), and money_split applies the
// stamped rate to captures, refunds, payouts and reconciliation. A booking published before
// DEC-2026-067 keeps its 15% (7.5% promotional) for life. Nothing here is sent to the server, and
// no caller can choose a rate. These values must equal the policy in force: SQL 127 pins the
// database side and tests/unit/commission.test.ts pins this one.

/** Standard commission on the final service subtotal after discounts and adjustments, excluding tax and tips. */
export const STANDARD_COMMISSION_BPS = 1000;
/** DEC-2026-038: one valid applied promotion halves the standard commission. */
export const PROMOTIONAL_COMMISSION_BPS = STANDARD_COMMISSION_BPS / 2;

/** A rate in basis points as a percentage label: 1000 → "10%", 750 → "7.5%". */
export function commissionRateLabel(bps: number) {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export const STANDARD_COMMISSION_LABEL = commissionRateLabel(STANDARD_COMMISSION_BPS);
export const PROMOTIONAL_COMMISSION_LABEL = commissionRateLabel(PROMOTIONAL_COMMISSION_BPS);

/**
 * Commission on whole cents, rounded half away from zero like PostgreSQL round() on numeric
 * (the database rule). Integer arithmetic only; for illustration such as worked examples.
 */
export function commissionCents(baseCents: number, bps: number = STANDARD_COMMISSION_BPS) {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || !Number.isSafeInteger(bps) || bps < 0) throw new Error("INVALID_MINOR_UNITS");
  return Math.floor((baseCents * bps + 5000) / 10000);
}

/** Commission and the vendor's share before any separate deductions, for a standard booking. */
export function standardSplit(serviceCents: number) {
  const commission = commissionCents(serviceCents, STANDARD_COMMISSION_BPS);
  return { commissionCents: commission, vendorProceedsCents: serviceCents - commission };
}
