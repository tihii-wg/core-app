import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import {
  canUseOrderEstimates,
  estimateCardVisibility,
  isEstimateOrder,
  orderKindOf,
} from "./orderEstimates";

function order(partial: Partial<Order> = {}): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-2026-001",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-11-13",
    updatedAt: "2026-11-13",
    ...partial,
  };
}

describe("orderEstimates", () => {
  it("treats missing kind as a normal order", () => {
    expect(orderKindOf(order())).toBe("order");
    expect(isEstimateOrder(order())).toBe(false);
    expect(isEstimateOrder(order({ kind: "estimate" }))).toBe(true);
  });

  it("hides payments / close / warranty / invoice / public link for estimates", () => {
    const visibility = estimateCardVisibility(order({ kind: "estimate" }));
    expect(visibility).toMatchObject({
      isEstimate: true,
      showPayments: false,
      showCloseCancel: false,
      showWarranty: false,
      showPublicLink: false,
      showInvoice: false,
      showConvertButton: true,
      showEstimateBadge: true,
    });
  });

  it("keeps full order card sections for normal orders", () => {
    const visibility = estimateCardVisibility(order({ kind: "order" }));
    expect(visibility.showPayments).toBe(true);
    expect(visibility.showConvertButton).toBe(false);
  });

  it("gates the estimates UI on the feature-support flag", () => {
    expect(canUseOrderEstimates(true)).toBe(true);
    expect(canUseOrderEstimates(false)).toBe(false);
  });
});

describe("client list kind filter", () => {
  it("excludes estimates from the default order summaries", async () => {
    const { clientOrderSummaries } = await import("../clients/clientOrders");
    const rows = clientOrderSummaries(
      [
        order({ id: "ord", kind: "order", orderNumber: "ORD-1" }),
        order({ id: "est", kind: "estimate", orderNumber: "ORD-2" }),
      ],
      "c1",
    );
    expect(rows.map((row) => row.id)).toEqual(["ord"]);
  });

  it("lists only estimates when kind=estimate", async () => {
    const { clientOrderSummaries } = await import("../clients/clientOrders");
    const rows = clientOrderSummaries(
      [
        order({ id: "ord", kind: "order", orderNumber: "ORD-1" }),
        order({
          id: "est",
          kind: "estimate",
          orderNumber: "ORD-2",
          estimateStatus: { name: "Черновик", color: "#888" },
        }),
      ],
      "c1",
      "estimate",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "est", estimateStatus: { name: "Черновик" } });
  });
});
