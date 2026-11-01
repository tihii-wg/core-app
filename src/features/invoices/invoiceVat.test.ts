import { describe, expect, it } from "vitest";
import { resolveInvoiceVat } from "./invoiceVat";

describe("resolveInvoiceVat", () => {
  it("prefers the stored tax_total", () => {
    expect(resolveInvoiceVat(1200, 200, 20)).toEqual({ kind: "recorded", vat: 200, net: 1000, ratePercent: null });
  });

  it("estimates included VAT when nothing is stored", () => {
    expect(resolveInvoiceVat(13950, null, 20)).toEqual({ kind: "estimated", vat: 2325, net: 11625, ratePercent: 20 });
    expect(resolveInvoiceVat(13950, 0, 20)?.kind).toBe("estimated");
  });

  it("returns null for legacy invoices without tax data", () => {
    expect(resolveInvoiceVat(500, null, null)).toBeNull();
    expect(resolveInvoiceVat(0, 10, 20)).toBeNull();
  });

  it("ignores a stored tax_total that is not smaller than the total", () => {
    expect(resolveInvoiceVat(100, 100, null)).toBeNull();
  });
});
