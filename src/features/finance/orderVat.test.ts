import { describe, expect, it } from "vitest";
import { effectiveOrderVatRate, invoiceVatBreakdown, orderVatBreakdown } from "./orderVat";

describe("orderVatBreakdown", () => {
  it("extracts VAT from a VAT-inclusive total (1200 @ 20% → 1000 / 200 / 1200)", () => {
    expect(orderVatBreakdown({ total: 1200, vatRate: 20 })).toEqual({
      rate: 20,
      net: 1000,
      vat: 200,
      gross: 1200,
    });
  });

  it("rounds to 2 decimals", () => {
    // 100 * 20 / 120 = 16.666… → 16.67 VAT, net 83.33
    expect(orderVatBreakdown({ total: 100, vatRate: 20 })).toEqual({
      rate: 20,
      net: 83.33,
      vat: 16.67,
      gross: 100,
    });
  });

  it("returns null when the rate is 0 or null", () => {
    expect(orderVatBreakdown({ total: 1200, vatRate: 0 })).toBeNull();
    expect(orderVatBreakdown({ total: 1200, vatRate: null })).toBeNull();
    expect(orderVatBreakdown({ total: 1200, vatRate: undefined })).toBeNull();
  });
});

describe("effectiveOrderVatRate", () => {
  it("prefers the order snapshot over the workspace rate", () => {
    expect(effectiveOrderVatRate({ vatRate: 12 }, 20)).toBe(12);
  });

  it("falls back to the workspace rate for old orders without a snapshot", () => {
    expect(effectiveOrderVatRate({ vatRate: null }, 20)).toBe(20);
    expect(effectiveOrderVatRate({}, 20)).toBe(20);
  });

  it("returns null when neither rate is set", () => {
    expect(effectiveOrderVatRate({ vatRate: null }, null)).toBeNull();
  });
});

describe("invoiceVatBreakdown", () => {
  it("prefers a positive stored tax_total", () => {
    expect(invoiceVatBreakdown({ total: 1200, taxTotal: 200, vatRate: 20 })).toEqual({
      rate: 20,
      net: 1000,
      vat: 200,
      gross: 1200,
    });
  });

  it("computes from the rate when tax_total is missing", () => {
    expect(invoiceVatBreakdown({ total: 1200, taxTotal: null, vatRate: 20 })).toEqual({
      rate: 20,
      net: 1000,
      vat: 200,
      gross: 1200,
    });
  });
});
