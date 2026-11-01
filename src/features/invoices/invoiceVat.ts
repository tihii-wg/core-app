import { netFromGross, vatIncludedAmount } from "../finance/vat";

export type InvoiceVatLine = {
  /** `recorded`: stored `invoices.tax_total`. `estimated`: derived from the workspace's tax-included rate. */
  kind: "recorded" | "estimated";
  vat: number;
  net: number;
  /** Rate in percent; null for recorded amounts (the stored column carries no rate). */
  ratePercent: number | null;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Resolves the VAT line shown on an invoice. The invoice `total` is treated as the gross amount.
 * A positive stored `tax_total` wins; otherwise an estimate from `estimateRatePercent` (when given);
 * otherwise nothing (existing invoices without tax data stay unchanged). Pure.
 */
export function resolveInvoiceVat(
  total: number,
  taxTotal: number | null,
  estimateRatePercent: number | null,
): InvoiceVatLine | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (taxTotal != null && Number.isFinite(taxTotal) && taxTotal > 0 && taxTotal < total) {
    return { kind: "recorded", vat: round2(taxTotal), net: round2(total - taxTotal), ratePercent: null };
  }
  if (estimateRatePercent != null && estimateRatePercent > 0) {
    return {
      kind: "estimated",
      vat: vatIncludedAmount(total, estimateRatePercent),
      net: netFromGross(total, estimateRatePercent),
      ratePercent: estimateRatePercent,
    };
  }
  return null;
}
