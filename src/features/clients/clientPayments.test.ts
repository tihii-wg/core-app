import { describe, expect, it } from "vitest";
import type { LedgerPayment } from "../finance/paymentTypes";
import { clientLedgerPayments } from "./clientPayments";

function row(partial: Partial<LedgerPayment> & { id: string }): LedgerPayment {
  return {
    workspaceId: "ws-1",
    orderId: null,
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount: 10,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-10-01T10:00:00Z",
    note: "",
    createdBy: null,
    createdAt: "2026-10-01T10:00:00Z",
    ...partial,
  };
}

describe("clientLedgerPayments", () => {
  it("keeps rows for the client's orders or invoices, newest first", () => {
    const rows = clientLedgerPayments(
      [
        row({ id: "a", orderId: "o1", paidAt: "2026-09-01T10:00:00Z" }),
        row({ id: "b", invoiceId: "inv1", paidAt: "2026-10-05T10:00:00Z" }),
        row({ id: "c", orderId: "other", paidAt: "2026-10-06T10:00:00Z" }),
        row({ id: "d", orderId: "o1", kind: "refund", paidAt: "2026-10-02T10:00:00Z" }),
      ],
      ["o1"],
      ["inv1"],
    );
    expect(rows.map((item) => item.id)).toEqual(["b", "d", "a"]);
  });

  it("skips invalid ledger rows", () => {
    const rows = clientLedgerPayments([row({ id: "bad", orderId: "o1", paidAt: "" })], ["o1"]);
    expect(rows).toEqual([]);
  });
});
