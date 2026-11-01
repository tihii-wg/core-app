/** Default VAT rate (percent) used for tax-included prices (Moldova standard rate). */
export const DEFAULT_VAT_RATE_PERCENT = 20;

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** VAT portion of a tax-included (gross) price: gross * rate / (100 + rate). */
export function vatIncludedAmount(gross: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT) {
  if (!Number.isFinite(gross) || !Number.isFinite(ratePercent) || ratePercent <= 0) return 0;
  return round2((gross * ratePercent) / (100 + ratePercent));
}

/** Net (VAT-exclusive) amount for a tax-included (gross) price. */
export function netFromGross(gross: number, ratePercent: number = DEFAULT_VAT_RATE_PERCENT) {
  if (!Number.isFinite(gross)) return 0;
  return round2(gross - vatIncludedAmount(gross, ratePercent));
}
