import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import type { LedgerPayment } from "../finance/paymentTypes";
import { listUpcomingPaymentStages } from "./upcomingPaymentStages";

const TODAY = new Date(2026, 10, 8);

function order(partial: Partial<Order> & Pick<Order, "id" | "orderNumber">): Order {
  return {
    clientId: "c1",
    clientName: "Ada",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "in-progress",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 1000,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

function payment(orderId: string, amount: number): LedgerPayment {
  return {
    id: `p-${orderId}-${amount}`,
    workspaceId: "ws",
    orderId,
    invoiceId: null,
    relatedPaymentId: null,
    kind: "payment",
    amount,
    currencyCode: "MDL",
    paymentMethod: "cash",
    paidAt: "2026-11-01T10:00:00.000Z",
    note: "",
    createdBy: null,
    createdAt: "2026-11-01T10:00:00.000Z",
  };
}

const stage = (orderId: string, position: number, percent: number | null, dueDate: string | null) => ({
  orderId,
  position,
  name: `Stage ${position + 1}`,
  mode: percent == null ? ("remainder" as const) : ("percent" as const),
  percent,
  dueDate,
});

describe("listUpcomingPaymentStages", () => {
  it("returns overdue and next-7-day unpaid stages sorted by due date, with remaining after waterfall", () => {
    const rows = listUpcomingPaymentStages({
      orders: [order({ id: "o1", orderNumber: "ORD-1" }), order({ id: "o2", orderNumber: "ORD-2", clientName: "Bob" })],
      stages: [
        stage("o1", 0, 50, "2026-11-01"), // paid 300 of 500 → partial, overdue, remaining 200
        stage("o1", 1, null, "2026-11-12"), // within 7 days, remaining 500
        stage("o2", 0, 30, "2026-11-20"), // outside window
        stage("o2", 1, null, null), // no due date
      ],
      payments: [payment("o1", 300)],
      today: TODAY,
    });

    expect(rows.map((row) => [row.orderNumber, row.stage.name, row.stage.remaining, row.overdue])).toEqual([
      ["ORD-1", "Stage 1", 200, true],
      ["ORD-1", "Stage 2", 500, false],
    ]);
  });

  it("skips fully paid stages, cancelled orders and legacy-paid orders", () => {
    const rows = listUpcomingPaymentStages({
      orders: [
        order({ id: "paid", orderNumber: "PAID" }),
        order({ id: "cancelled", orderNumber: "CANC", status: "cancelled" }),
        order({ id: "legacy", orderNumber: "LEGACY", isPaid: true }),
      ],
      stages: [
        stage("paid", 0, 100, "2026-11-05"),
        stage("cancelled", 0, 100, "2026-11-05"),
        stage("legacy", 0, 100, "2026-11-05"),
      ],
      payments: [payment("paid", 1000)],
      today: TODAY,
    });
    expect(rows).toEqual([]);
  });

  it("includes a stage due today", () => {
    const rows = listUpcomingPaymentStages({
      orders: [order({ id: "o1", orderNumber: "ORD-1" })],
      stages: [stage("o1", 0, 100, "2026-11-08")],
      payments: [],
      today: TODAY,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.overdue).toBe(false);
  });
});
