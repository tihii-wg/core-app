import { describe, expect, it } from "vitest";
import type { ClientOrderSummary } from "./clientOrders";
import { clientOrderSummaries } from "./clientOrders";
import { computeClientSettlement, settlementBalanceTone } from "./clientSettlement";
import type { Order } from "../../lib/types";

function summary(partial: Partial<ClientOrderSummary>): ClientOrderSummary {
  return {
    id: "order-1",
    orderNumber: "ORD-2026-001",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    totalPrice: 100,
    status: "completed",
    isPaid: false,
    createdAt: "2026-10-01",
    ...partial,
  };
}

describe("computeClientSettlement — outstanding orders only", () => {
  it("excludes fully paid orders from the list and counts them as settled", () => {
    const result = computeClientSettlement([
      summary({ id: "a", totalPrice: 100, isPaid: true }),
      summary({ id: "b", totalPrice: 250.5, isPaid: true }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.settledOrdersCount).toBe(2);
    expect(result.totalOutstanding).toBe(0);
    expect(result.finalBalance).toBe(0);
    expect(settlementBalanceTone(result.finalBalance)).toBe("settled");
  });

  it("lists unpaid orders with their full remaining amount", () => {
    const result = computeClientSettlement([
      summary({ id: "a", totalPrice: 100 }),
      summary({ id: "b", totalPrice: 40 }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.displayedOrderTotal).toBe(140);
    expect(result.totalOutstanding).toBe(140);
    expect(result.finalBalance).toBe(-140);
    expect(settlementBalanceTone(result.finalBalance)).toBe("debt");
    expect(result.rows.every((row) => row.remaining === row.total && row.remaining > 0)).toBe(true);
  });

  it("handles a client-level partial settlement: paid orders drop out, unpaid remain and reconcile", () => {
    const result = computeClientSettlement([
      summary({ id: "a", orderNumber: "ORD-1", totalPrice: 100, isPaid: true }),
      summary({ id: "b", orderNumber: "ORD-2", totalPrice: 300, isPaid: false }),
      summary({ id: "c", orderNumber: "ORD-3", totalPrice: 50, isPaid: true }),
    ]);
    expect(result.rows.map((row) => row.orderNumber)).toEqual(["ORD-2"]);
    expect(result.settledOrdersCount).toBe(2);
    // Displayed rows reconcile with the displayed subtotal/outstanding.
    expect(result.rows.reduce((sum, row) => sum + row.total, 0)).toBe(result.displayedOrderTotal);
    expect(result.rows.reduce((sum, row) => sum + row.remaining, 0)).toBe(result.totalOutstanding);
    expect(result.totalOutstanding).toBe(300);
  });

  it("excludes cancelled orders from totals and reports the exclusion", () => {
    const result = computeClientSettlement([
      summary({ id: "a", totalPrice: 100 }),
      summary({ id: "b", totalPrice: 500, status: "cancelled" }),
    ]);
    expect(result.totalOutstanding).toBe(100);
    expect(result.rows).toHaveLength(1);
    expect(result.excludedCancelledCount).toBe(1);
  });
});

describe("computeClientSettlement — existing advance combination", () => {
  it("advance smaller than outstanding: 300 - 1000 = -700 (client still owes)", () => {
    const result = computeClientSettlement([summary({ id: "b", totalPrice: 1000 })], 300);
    expect(result.existingBalance).toBe(300);
    expect(result.totalOutstanding).toBe(1000);
    expect(result.finalBalance).toBe(-700);
    expect(settlementBalanceTone(result.finalBalance)).toBe("debt");
  });

  it("advance greater than outstanding: 1000 - 300 = +700 (remaining advance)", () => {
    const result = computeClientSettlement([summary({ id: "b", totalPrice: 300 })], 1000);
    expect(result.finalBalance).toBe(700);
    expect(settlementBalanceTone(result.finalBalance)).toBe("credit");
  });

  it("advance exactly equal to outstanding: 500 - 500 = 0 (settled)", () => {
    const result = computeClientSettlement([summary({ id: "b", totalPrice: 500 })], 500);
    expect(result.finalBalance).toBe(0);
    expect(settlementBalanceTone(result.finalBalance)).toBe("settled");
  });

  it("positive advance with no unpaid orders stays as remaining advance: +300", () => {
    const result = computeClientSettlement([summary({ isPaid: true, totalPrice: 100 })], 300);
    expect(result.rows).toEqual([]);
    expect(result.totalOutstanding).toBe(0);
    expect(result.existingBalance).toBe(300);
    expect(result.finalBalance).toBe(300);
    expect(settlementBalanceTone(result.finalBalance)).toBe("credit");
  });

  it("does not double-count: paid orders never change outstanding, advance is reported unchanged", () => {
    const result = computeClientSettlement(
      [
        summary({ id: "paid-big", totalPrice: 1000, isPaid: true }),
        summary({ id: "open", totalPrice: 300 }),
      ],
      50,
    );
    expect(result.totalOutstanding).toBe(300);
    expect(result.existingBalance).toBe(50);
    expect(result.finalBalance).toBe(-250);
  });
});

describe("settlementBalanceTone", () => {
  it("maps negative to debt, positive to credit, zero to settled", () => {
    expect(settlementBalanceTone(-0.01)).toBe("debt");
    expect(settlementBalanceTone(0.01)).toBe("credit");
    expect(settlementBalanceTone(0)).toBe("settled");
  });
});

describe("settlement input filtering (client + workspace scope)", () => {
  it("clientOrderSummaries includes only the selected client's orders", () => {
    const order = (partial: Partial<Order>): Order =>
      ({
        id: "o1",
        clientId: "client-1",
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
        totalPrice: 10,
        isPaid: true,
        paymentStatus: "paid",
        createdAt: "2026-10-01",
        updatedAt: "2026-10-01",
        ...partial,
      }) as Order;

    const summaries = clientOrderSummaries(
      [order({ id: "mine" }), order({ id: "other-client", clientId: "client-2" }), order({ id: "mine-2", orderNumber: "ORD-2" })],
      "client-1",
    );
    expect(summaries.map((entry) => entry.id).sort()).toEqual(["mine", "mine-2"]);
    expect(summaries.every((entry) => entry.isPaid === true)).toBe(true);
  });
});
