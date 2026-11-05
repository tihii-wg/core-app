import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { orderPaymentBalance } from "../finance/paymentCalculations";
import type { LedgerPayment } from "../finance/paymentTypes";
import { isOpenOrder } from "../orders/orderVisibility";

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "Golf",
    vin: "",
    carNumber: "",
    service: "Oil",
    services: [],
    materials: [],
    description: "",
    status: "closed",
    customStatusId: null,
    customStatus: null,
    closedAt: "2026-11-01T12:00:00.000Z",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 100,
    subtotal: 100,
    discountTotal: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    taxInvoiceNumber: "",
    createdAt: "2026-10-01",
    updatedAt: "2026-11-01",
    ...overrides,
  };
}

function payment(partial: Partial<LedgerPayment> & Pick<LedgerPayment, "id" | "amount" | "kind">): LedgerPayment {
  return {
    workspaceId: "ws",
    orderId: "order-1",
    invoiceId: null,
    relatedPaymentId: null,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-11-01T00:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...partial,
  };
}

describe("Dashboard / Orders status parity helpers", () => {
  it("derives Paid from the payment ledger even when orders.is_paid is false", () => {
    const order = baseOrder({ isPaid: false, paymentStatus: "unpaid", status: "closed" });
    const payments = [payment({ id: "pay-1", amount: 100, kind: "payment" })];

    // Same helper Orders.tsx uses — Dashboard must call this instead of order.paymentStatus.
    expect(orderPaymentBalance(order, payments).status).toBe("paid");
    expect(order.paymentStatus).toBe("unpaid");
  });

  it("treats system status closed as not open work (Active Orders card)", () => {
    expect(isOpenOrder(baseOrder({ status: "closed" }))).toBe(false);
    expect(isOpenOrder(baseOrder({ status: "completed" }))).toBe(false);
    expect(isOpenOrder(baseOrder({ status: "in-progress", closedAt: null }))).toBe(true);
  });
});
