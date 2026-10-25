import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import {
  hasTaxInvoiceNumber,
  isLegalEntityCustomer,
  isPaidClosureStatus,
  isPaidStatusOptionBlocked,
  isTaxInvoiceBlocked,
  resolveClientTypeForTaxGate,
  taxInvoiceNumberPresent,
} from "./taxInvoice";

const base = { taxInvoiceNumber: "", clientType: "organization" as const } as Order;

describe("taxInvoice helpers", () => {
  it("only treats the paid status as a paid closure", () => {
    expect(isPaidClosureStatus("paid")).toBe(true);
    expect(isPaidClosureStatus("completed")).toBe(false);
    expect(isPaidClosureStatus("cancelled")).toBe(false);
  });

  it("identifies legal entities via clients.client_type = organization", () => {
    expect(isLegalEntityCustomer("organization")).toBe(true);
    expect(isLegalEntityCustomer("individual")).toBe(false);
    expect(isLegalEntityCustomer(null)).toBe(false);
    expect(isLegalEntityCustomer(undefined)).toBe(false);
  });

  it("requires non-whitespace content", () => {
    expect(taxInvoiceNumberPresent("FV-1")).toBe(true);
    expect(taxInvoiceNumberPresent("  ")).toBe(false);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "FV-1" })).toBe(true);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "  " })).toBe(false);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "" })).toBe(false);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: undefined })).toBe(false);
  });

  it("fail-closes the UI gate when any source says the customer is a legal entity", () => {
    expect(resolveClientTypeForTaxGate({ clientType: "individual" }, { clientType: "organization" })).toBe("organization");
    expect(resolveClientTypeForTaxGate({ clientType: undefined }, { clientType: "organization" })).toBe("organization");
    expect(resolveClientTypeForTaxGate({ clientType: "individual" }, { clientType: "individual" })).toBe("individual");
    expect(resolveClientTypeForTaxGate({ clientType: undefined }, null)).toBeUndefined();
  });

  it("blocks only legal-entity paid closure when required and missing", () => {
    expect(isTaxInvoiceBlocked(base, "paid", true)).toBe(true);
    expect(isTaxInvoiceBlocked(base, "completed", true)).toBe(false);
    expect(isTaxInvoiceBlocked(base, "paid", false)).toBe(false);
    expect(isTaxInvoiceBlocked({ ...base, taxInvoiceNumber: "FV-1" }, "paid", true)).toBe(false);
    expect(isPaidStatusOptionBlocked(base, true)).toBe(true);
    expect(isPaidStatusOptionBlocked({ ...base, taxInvoiceNumber: "FV-1" }, true)).toBe(false);
  });

  it("never blocks individual customers, even with the setting enabled and no number", () => {
    const individual = { ...base, clientType: "individual" as const, taxInvoiceNumber: "" };
    expect(isTaxInvoiceBlocked(individual, "paid", true)).toBe(false);
  });

  it("re-evaluates when the order's customer type changes", () => {
    const asOrg = { ...base, clientType: "organization" as const, taxInvoiceNumber: "" };
    expect(isTaxInvoiceBlocked(asOrg, "paid", true)).toBe(true);
    const asIndividual = { ...asOrg, clientType: "individual" as const };
    expect(isTaxInvoiceBlocked(asIndividual, "paid", true)).toBe(false);
    // Switching back to organization restores the requirement; existing number is not erased by the helper.
    const backToOrg = { ...asIndividual, clientType: "organization" as const, taxInvoiceNumber: "FV-kept" };
    expect(isTaxInvoiceBlocked(backToOrg, "paid", true)).toBe(false);
    expect(backToOrg.taxInvoiceNumber).toBe("FV-kept");
  });
});
