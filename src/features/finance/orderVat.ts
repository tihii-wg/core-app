import { netFromGross, vatIncludedAmount } from "./vat";

export type OrderVatBreakdown = {
  rate: number;
  net: number;
  vat: number;
  gross: number;
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRate(vatRate: number | null | undefined): number | null {
  if (vatRate == null || !Number.isFinite(vatRate) || vatRate <= 0) return null;
  return vatRate;
}

/**
 * Prefer the order's VAT snapshot; fall back to the current workspace rate (display-only for old rows).
 */
export function effectiveOrderVatRate(
  order: { vatRate?: number | null } | null | undefined,
  workspaceRate: number | null | undefined,
): number | null {
  return normalizeRate(order?.vatRate) ?? normalizeRate(workspaceRate);
}

/**
 * VAT-inclusive breakdown of a gross total. Rate null/0 → null (no VAT block).
 * Example: total 1200 @ 20% → { rate: 20, net: 1000, vat: 200, gross: 1200 }.
 */
export function orderVatBreakdown(input: {
  total: number;
  vatRate: number | null | undefined;
}): OrderVatBreakdown | null {
  const gross = Number(input.total);
  if (!Number.isFinite(gross)) return null;
  const rate = normalizeRate(input.vatRate);
  if (rate == null) return null;
  const vat = vatIncludedAmount(gross, rate);
  const net = netFromGross(gross, rate);
  return { rate, net, vat, gross: round2(gross) };
}

/**
 * Prefer a positive stored tax_total; otherwise extract VAT from gross with the given rate.
 */
export function invoiceVatBreakdown(input: {
  total: number;
  taxTotal?: number | null;
  vatRate?: number | null;
}): OrderVatBreakdown | null {
  const gross = Number(input.total);
  if (!Number.isFinite(gross) || gross <= 0) return null;
  const taxTotal = input.taxTotal;
  if (taxTotal != null && Number.isFinite(taxTotal) && taxTotal > 0 && taxTotal < gross) {
    const vat = round2(taxTotal);
    const net = round2(gross - vat);
    const rate = normalizeRate(input.vatRate);
    return {
      rate: rate ?? (net > 0 ? round2((vat / net) * 100) : 0),
      net,
      vat,
      gross: round2(gross),
    };
  }
  return orderVatBreakdown({ total: gross, vatRate: input.vatRate });
}

/** Print / document VAT: invoice tax_total wins, else order snapshot rate, else workspace rate. */
export function documentVatBreakdown(input: {
  total: number;
  orderVatRate?: number | null;
  workspaceVatRate?: number | null;
  invoiceTaxTotal?: number | null;
  /** When true, prefer invoiceTaxTotal over computed extraction. */
  preferInvoiceTaxTotal?: boolean;
}): OrderVatBreakdown | null {
  const rate = effectiveOrderVatRate({ vatRate: input.orderVatRate }, input.workspaceVatRate);
  if (input.preferInvoiceTaxTotal) {
    return invoiceVatBreakdown({
      total: input.total,
      taxTotal: input.invoiceTaxTotal,
      vatRate: rate,
    });
  }
  return orderVatBreakdown({ total: input.total, vatRate: rate });
}
