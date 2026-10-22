import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { hasTaxInvoiceNumber, isPaidClosureStatus, isTaxInvoiceBlocked } from "./taxInvoice";

const order = { taxInvoiceNumber: "" } as Order;

describe("taxInvoice helpers", () => {
  it("only treats the paid status as a paid closure", () => {
    expect(isPaidClosureStatus("paid")).toBe(true);
    expect(isPaidClosureStatus("completed")).toBe(false);
    expect(isPaidClosureStatus("cancelled")).toBe(false);
  });

  it("requires non-whitespace content", () => {
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "FV-1" })).toBe(true);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "  " })).toBe(false);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: "" })).toBe(false);
    expect(hasTaxInvoiceNumber({ taxInvoiceNumber: undefined })).toBe(false);
  });

  it("blocks only paid closure when required and missing", () => {
    expect(isTaxInvoiceBlocked(order, "paid", true)).toBe(true);
    expect(isTaxInvoiceBlocked(order, "completed", true)).toBe(false);
    expect(isTaxInvoiceBlocked(order, "paid", false)).toBe(false);
    expect(isTaxInvoiceBlocked({ ...order, taxInvoiceNumber: "FV-1" }, "paid", true)).toBe(false);
  });
});
