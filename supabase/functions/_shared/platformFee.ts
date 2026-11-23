/** Single source of truth for the platform commission rate. */
export const PLATFORM_FEE_RATE = 0.15;
export const PLATFORM_FEE_PERCENT_LABEL = "15%";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const platformFeeFromAmount = (amount: number): number =>
  round2(Number(amount || 0) * PLATFORM_FEE_RATE);

export const vendorPayoutFromAmount = (amount: number): number =>
  round2(Number(amount || 0) - platformFeeFromAmount(amount));
