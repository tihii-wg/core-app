import { describe, expect, it } from "vitest";
import type { Invoice, Order } from "../../lib/types";
import {
  combinedOutstanding,
  computePaymentBalance,
  filterPayments,
  findLegacyUnreconciled,
  invoicePaymentBalance,
  netByLinkCategory,
  netCollected,
  netReceiptsOnDate,
  assertWorkspaceCurrencyMatch,
  invoiceOrderLockDecision,
  ledgerCurrencyGate,
  normalizeCurrencyCode,
  orderHasOutstandingBalance,
  orderPaymentBalance,
  paymentsAffectingInvoice,
  paymentsAffectingOrder,
  paymentsForCurrency,
  paymentsInPeriod,
  refundableRemaining,
  remainingForTotal,
  roundMoney,
  wouldExceedRemaining,
} from "./paymentCalculations";
import type { LedgerPayment } from "./paymentTypes";

function payment(partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "amount" | "kind">): LedgerPayment {
  return {
    workspaceId: "ws-a",
    orderId: null,
    invoiceId: null,
    relatedPaymentId: null,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-06-15T12:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-06-15T12:00:00.000Z",
    ...partial,
  };
}

function order(partial: Partial<Order> & Pick<Order, "id">): Order {
  return {
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "completed",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 100,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
    ...partial,
  };
}

function invoice(partial: Partial<Invoice> & Pick<Invoice, "id" | "status">): Invoice {
  return {
    workspaceId: "ws-a",
    invoiceNumber: "INV-1",
    clientId: "c1",
    clientName: "Ada",
    device: "",
    carNumber: "",
    vin: "",
    description: "",
    subtotal: 100,
    amount: 100,
    total: 100,
    dueDate: "2026-07-01",
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
    ...partial,
  };
}

describe("netCollected", () => {
  it("sums payments minus refunds and skips invalid rows", () => {
    expect(
      netCollected([
        payment({ id: "1", kind: "payment", amount: 100 }),
        payment({ id: "2", kind: "payment", amount: 40 }),
        payment({ id: "3", kind: "refund", amount: 25, relatedPaymentId: "1" }),
        payment({ id: "bad", kind: "payment", amount: 0 }),
        payment({ id: "bad2", kind: "payment", amount: 10, paidAt: "" }),
      ]),
    ).toBe(115);
  });
});

describe("partial and full payments", () => {
  it("derives unpaid / partial / paid from net vs order totalPrice", () => {
    const o = order({ id: "o1", totalPrice: 100 });
    expect(orderPaymentBalance(o, []).status).toBe("unpaid");
    expect(orderPaymentBalance(o, [payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" })]).status).toBe("partial");
    expect(orderPaymentBalance(o, [payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" }), payment({ id: "p2", kind: "payment", amount: 60, orderId: "o1" })]).status).toBe(
      "paid",
    );
  });

  it("orderHasOutstandingBalance keeps unpaid and partial, excludes paid and cancelled", () => {
    const unpaid = order({ id: "o1", totalPrice: 100 });
    const partialRows = [payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" })];
    const paidRows = [
      payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" }),
      payment({ id: "p2", kind: "payment", amount: 60, orderId: "o1" }),
    ];
    expect(orderHasOutstandingBalance(unpaid, [])).toBe(true);
    expect(orderHasOutstandingBalance(unpaid, partialRows)).toBe(true);
    expect(orderHasOutstandingBalance(unpaid, paidRows)).toBe(false);
    expect(orderHasOutstandingBalance({ ...unpaid, status: "cancelled" }, [])).toBe(false);
    expect(orderHasOutstandingBalance({ ...unpaid, isPaid: true, status: "paid" }, [])).toBe(false);
  });

  it("reports overpayment separately and clamps remaining at zero", () => {
    const balance = computePaymentBalance(100, [payment({ id: "p1", kind: "payment", amount: 120 })], false);
    expect(balance.remaining).toBe(0);
    expect(balance.overpayment).toBe(20);
    expect(balance.status).toBe("paid");
  });
});

describe("multiple payments and refunds", () => {
  it("limits refunds to the original payment remaining", () => {
    const original = payment({ id: "p1", kind: "payment", amount: 100 });
    const rows = [original, payment({ id: "r1", kind: "refund", amount: 30, relatedPaymentId: "p1" })];
    expect(refundableRemaining(original, rows)).toBe(70);
    expect(refundableRemaining(payment({ id: "r1", kind: "refund", amount: 30 }), rows)).toBe(0);
  });
});

describe("invoice-linked vs no-invoice categorization", () => {
  it("counts a dual-linked payment only in the invoice bucket", () => {
    const split = netByLinkCategory([
      payment({ id: "1", kind: "payment", amount: 80, invoiceId: "inv-1", orderId: "o1" }),
      payment({ id: "2", kind: "payment", amount: 20, orderId: "o2" }),
      payment({ id: "3", kind: "refund", amount: 10, invoiceId: "inv-1", orderId: "o1", relatedPaymentId: "1" }),
    ]);
    expect(split.invoiceLinked).toBe(70);
    expect(split.noInvoice).toBe(20);
    expect(split.net).toBe(90);
    expect(split.refunds).toBe(10);
  });
});

describe("no double counting", () => {
  it("does not treat legacy paid flags as ledger money when ledger rows exist", () => {
    const o = order({ id: "o1", totalPrice: 100, isPaid: true, status: "paid" });
    const balance = orderPaymentBalance(o, [payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" })]);
    expect(balance.netPaid).toBe(40);
    expect(balance.status).toBe("partial");
    expect(balance.isLegacyUnreconciled).toBe(false);
  });
});

describe("multiple currencies", () => {
  it("never mixes currencies when summing", () => {
    const rows = [
      payment({ id: "1", kind: "payment", amount: 100, currencyCode: "MDL" }),
      payment({ id: "2", kind: "payment", amount: 50, currencyCode: "EUR" }),
    ];
    expect(netCollected(paymentsForCurrency(rows, "MDL"))).toBe(100);
    expect(netCollected(paymentsForCurrency(rows, "EUR"))).toBe(50);
  });
});

describe("date-range filtering", () => {
  it("filters by paid_at date key", () => {
    const rows = [
      payment({ id: "1", kind: "payment", amount: 10, paidAt: "2026-06-01T10:00:00.000Z" }),
      payment({ id: "2", kind: "payment", amount: 20, paidAt: "2026-06-15T10:00:00.000Z" }),
      payment({ id: "3", kind: "payment", amount: 30, paidAt: "2026-07-01T10:00:00.000Z" }),
    ];
    expect(paymentsInPeriod(rows, { start: "2026-06-01", end: "2026-06-30" }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterPayments(rows, { paidFrom: "2026-06-10", paidTo: "2026-06-20" }).map((r) => r.id)).toEqual(["2"]);
    expect(netReceiptsOnDate(rows, "2026-06-15", "MDL")).toBe(20);
  });
});

describe("legacy records without ledger entries", () => {
  it("lists legacy paid invoices and orders without double-counting linked pairs", () => {
    const legacy = findLegacyUnreconciled(
      [
        order({ id: "o1", orderNumber: "ORD-1", totalPrice: 100, isPaid: true, status: "paid" }),
        order({ id: "o2", orderNumber: "ORD-2", totalPrice: 50, isPaid: true, status: "paid" }),
      ],
      [
        invoice({ id: "inv-1", invoiceNumber: "INV-1", status: "paid", orderId: "o1", total: 100, amount: 100, paidAt: "2026-06-10" }),
      ],
      [],
    );
    expect(legacy).toEqual([
      expect.objectContaining({ kind: "invoice", id: "inv-1", amount: 100, dateReliable: true }),
      expect.objectContaining({ kind: "order", id: "o2", amount: 50, dateReliable: false, attributedDate: null }),
    ]);
  });

  it("marks legacy order balance without inventing ledger netPaid", () => {
    const balance = orderPaymentBalance(order({ id: "o1", totalPrice: 80, isPaid: true, status: "paid" }), []);
    expect(balance.hasLedger).toBe(false);
    expect(balance.isLegacyUnreconciled).toBe(true);
    expect(balance.netPaid).toBe(0);
    expect(balance.status).toBe("paid");
  });
});

describe("invoice outstanding", () => {
  it("uses invoice total minus net ledger payments", () => {
    const inv = invoice({ id: "inv-1", status: "sent", total: 100, amount: 100 });
    expect(invoicePaymentBalance(inv, [payment({ id: "p1", kind: "payment", amount: 30, invoiceId: "inv-1" })]).remaining).toBe(70);
    expect(combinedOutstanding([], [inv], [payment({ id: "p1", kind: "payment", amount: 30, invoiceId: "inv-1" })]).invoicePart).toBe(70);
  });
});

describe("roundMoney", () => {
  it("rounds to cents", () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });
});

describe("order-only, invoice-only, and dual-linked payments", () => {
  it("counts an order-only payment toward the order balance", () => {
    const balance = orderPaymentBalance(order({ id: "o1", totalPrice: 100 }), [
      payment({ id: "p1", kind: "payment", amount: 40, orderId: "o1" }),
    ]);
    expect(balance).toMatchObject({ netPaid: 40, remaining: 60, status: "partial" });
  });

  it("counts an invoice-only payment toward the invoice balance", () => {
    const balance = invoicePaymentBalance(invoice({ id: "inv-1", status: "sent", total: 100, amount: 100 }), [
      payment({ id: "p1", kind: "payment", amount: 100, invoiceId: "inv-1" }),
    ]);
    expect(balance).toMatchObject({ netPaid: 100, remaining: 0, status: "paid" });
  });

  it("counts a dual-linked payment once for category and once per document balance", () => {
    const rows = [payment({ id: "p1", kind: "payment", amount: 50, orderId: "o1", invoiceId: "inv-1" })];
    expect(netByLinkCategory(rows)).toEqual({
      invoiceLinked: 50,
      noInvoice: 0,
      refunds: 0,
      grossPayments: 50,
      net: 50,
    });
    expect(paymentsAffectingOrder(rows, "o1", "inv-1")).toHaveLength(1);
    expect(orderPaymentBalance(order({ id: "o1", totalPrice: 100 }), rows, "inv-1").netPaid).toBe(50);
    expect(invoicePaymentBalance(invoice({ id: "inv-1", status: "sent", total: 100, amount: 100 }), rows).netPaid).toBe(50);
  });
});

describe("overpayment and exact settlement", () => {
  it("rejects a proposed amount above remaining and accepts exact settlement", () => {
    const linked = [payment({ id: "p1", kind: "payment", amount: 70, orderId: "o1" })];
    expect(remainingForTotal(100, linked)).toBe(30);
    expect(wouldExceedRemaining(100, linked, 30.01)).toBe(true);
    expect(wouldExceedRemaining(100, linked, 30)).toBe(false);
    expect(wouldExceedRemaining(100, linked, 0)).toBe(true);
    expect(wouldExceedRemaining(100, linked, -5)).toBe(true);
  });
});

describe("refund limits", () => {
  it("supports partial and full refunds and blocks oversized refunds", () => {
    const original = payment({ id: "p1", kind: "payment", amount: 100, orderId: "o1" });
    const afterPartial = [original, payment({ id: "r1", kind: "refund", amount: 40, relatedPaymentId: "p1", orderId: "o1" })];
    expect(refundableRemaining(original, afterPartial)).toBe(60);
    const afterFull = [
      original,
      payment({ id: "r1", kind: "refund", amount: 40, relatedPaymentId: "p1" }),
      payment({ id: "r2", kind: "refund", amount: 60, relatedPaymentId: "p1" }),
    ];
    expect(refundableRemaining(original, afterFull)).toBe(0);
    expect(refundableRemaining(original, [
      original,
      payment({ id: "r1", kind: "refund", amount: 40, relatedPaymentId: "p1" }),
      payment({ id: "r-race", kind: "refund", amount: 70, relatedPaymentId: "p1" }),
    ])).toBe(0);
  });
});

describe("currency isolation", () => {
  it("normalizes codes and never mixes currencies in remaining checks", () => {
    expect(normalizeCurrencyCode(" mdl ")).toBe("MDL");
    const rows = [
      payment({ id: "1", kind: "payment", amount: 100, currencyCode: "MDL", orderId: "o1" }),
      payment({ id: "2", kind: "payment", amount: 50, currencyCode: "EUR", orderId: "o1" }),
    ];
    expect(remainingForTotal(100, paymentsForCurrency(rows, "MDL").filter((r) => r.orderId === "o1"))).toBe(0);
    expect(netCollected(paymentsForCurrency(rows, "EUR"))).toBe(50);
    expect(ledgerCurrencyGate(rows, "MDL")).toBe("mixed");
    expect(ledgerCurrencyGate([rows[0]], "EUR")).toBe("mismatch");
    expect(ledgerCurrencyGate([rows[0]], "MDL")).toBe("ok");
  });
});

describe("order-only payment before invoice creation", () => {
  it("reduces invoice remaining by prior order-only ledger rows without double-counting", () => {
    const orderOnly = payment({ id: "p-order", kind: "payment", amount: 40, orderId: "o1", invoiceId: null });
    const invoiceLinked = payment({ id: "p-inv", kind: "payment", amount: 25, orderId: "o1", invoiceId: "inv-1" });
    const inv = invoice({ id: "inv-1", status: "sent", orderId: "o1", total: 100, amount: 100 });

    expect(paymentsAffectingInvoice([orderOnly, invoiceLinked], "inv-1", "o1").map((r) => r.id)).toEqual(["p-order", "p-inv"]);
    expect(invoicePaymentBalance(inv, [orderOnly]).remaining).toBe(60);
    expect(invoicePaymentBalance(inv, [orderOnly, invoiceLinked]).remaining).toBe(35);
    expect(wouldExceedRemaining(100, paymentsAffectingInvoice([orderOnly], "inv-1", "o1"), 61)).toBe(true);
    expect(wouldExceedRemaining(100, paymentsAffectingInvoice([orderOnly], "inv-1", "o1"), 60)).toBe(false);
  });
});

describe("invoiceOrderLockDecision", () => {
  it("fails closed with retry when an order appears after peek without an order lock", () => {
    expect(invoiceOrderLockDecision({ lockedOrderId: null, invoiceOrderIdAfterLock: "o1" })).toBe("retry");
  });

  it("rejects mismatched or dropped order links after lock", () => {
    expect(invoiceOrderLockDecision({ lockedOrderId: "o1", invoiceOrderIdAfterLock: "o2" })).toBe("mismatch");
    expect(invoiceOrderLockDecision({ lockedOrderId: "o1", invoiceOrderIdAfterLock: null })).toBe("mismatch");
  });

  it("accepts a consistent locked order or a true invoice-only document", () => {
    expect(invoiceOrderLockDecision({ lockedOrderId: "o1", invoiceOrderIdAfterLock: "o1" })).toBe("ok");
    expect(invoiceOrderLockDecision({ lockedOrderId: null, invoiceOrderIdAfterLock: null })).toBe("ok");
  });
});

describe("assertWorkspaceCurrencyMatch", () => {
  it("fails closed for missing, blank, or non-three-letter workspace currency", () => {
    expect(assertWorkspaceCurrencyMatch(null, "MDL")).toBe("workspace_invalid");
    expect(assertWorkspaceCurrencyMatch("", "MDL")).toBe("workspace_invalid");
    expect(assertWorkspaceCurrencyMatch("MD", "MDL")).toBe("workspace_invalid");
    expect(assertWorkspaceCurrencyMatch("moldovan", "MDL")).toBe("workspace_invalid");
  });

  it("requires the payment currency to match a valid workspace currency", () => {
    expect(assertWorkspaceCurrencyMatch("MDL", "EUR")).toBe("mismatch");
    expect(assertWorkspaceCurrencyMatch(" mdl ", "MDL")).toBe("ok");
  });
});

describe("invalid amounts", () => {
  it("treats zero/negative/non-finite amounts as invalid ledger money", () => {
    expect(netCollected([payment({ id: "1", kind: "payment", amount: 0 })])).toBe(0);
    expect(netCollected([payment({ id: "2", kind: "payment", amount: -10 })])).toBe(0);
    expect(wouldExceedRemaining(100, [], Number.NaN)).toBe(true);
  });
});
