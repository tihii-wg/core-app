import { describe, expect, it } from "vitest";
import { filterEligibleWarrantySourceOrders } from "./apiWarranty";
import type { Order } from "../lib/types";

function order(partial: Partial<Order> & Pick<Order, "id" | "clientId">): Order {
  return {
    orderNumber: partial.orderNumber ?? "ORD-1",
    vehicleId: partial.vehicleId ?? null,
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    description: "",
    status: partial.status ?? "closed",
    closedAt: partial.closedAt ?? "2026-11-04T12:00:00.000Z",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-11-01T12:00:00.000Z",
    updatedAt: "2026-11-01T12:00:00.000Z",
    clientName: "Ada",
    ...partial,
  };
}

describe("filterEligibleWarrantySourceOrders", () => {
  const base = [
    order({ id: "o1", clientId: "c1", vehicleId: "v1", orderNumber: "ORD-1" }),
    order({ id: "o2", clientId: "c1", vehicleId: "v2", orderNumber: "ORD-2" }),
    order({ id: "o3", clientId: "c2", vehicleId: "v1", orderNumber: "ORD-3" }),
    order({ id: "o4", clientId: "c1", vehicleId: "v1", status: "in-progress", closedAt: null, orderNumber: "ORD-4" }),
    order({ id: "o5", clientId: "c1", vehicleId: "v1", status: "cancelled", closedAt: null, orderNumber: "ORD-5" }),
  ];

  it("keeps only same client + vehicle closed originals and excludes self", () => {
    expect(
      filterEligibleWarrantySourceOrders({
        candidates: base,
        clientId: "c1",
        vehicleId: "v1",
        excludeOrderId: "claim-1",
      }).map((row) => row.id),
    ).toEqual(["o1"]);
  });

  it("rejects cross-client and cross-vehicle references", () => {
    expect(
      filterEligibleWarrantySourceOrders({
        candidates: base,
        clientId: "c1",
        vehicleId: "v2",
        excludeOrderId: "x",
      }).map((row) => row.id),
    ).toEqual(["o2"]);
  });
});
