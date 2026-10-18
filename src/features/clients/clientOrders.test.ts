import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import { clientOrderHistoryLine, clientOrderSummaries } from "./clientOrders";

function order(partial: Partial<Order>): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "BMW",
    vin: "",
    carNumber: "",
    service: "Oil",
    services: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 40,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    ...partial,
  };
}

describe("clientOrderSummaries", () => {
  it("returns only the client's orders newest first with status and date", () => {
    const summaries = clientOrderSummaries(
      [
        order({ id: "older", clientId: "c1", orderNumber: "ORD-1", createdAt: "2026-09-01", status: "completed", totalPrice: 10 }),
        order({ id: "newer", clientId: "c1", orderNumber: "ORD-2", createdAt: "2026-10-01", status: "in-progress", totalPrice: 20 }),
        order({ id: "other", clientId: "c9", orderNumber: "ORD-9", createdAt: "2026-10-02" }),
      ],
      "c1",
    );

    expect(summaries.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(summaries[0]).toMatchObject({ status: "in-progress", createdAt: "2026-10-01", totalPrice: 20 });
  });
});

describe("clientOrderHistoryLine", () => {
  it("includes only visible asset fields and the service when present", () => {
    const row = { device: "BMW", carNumber: "ABC123", vin: "VIN17CHARSXXXXXXX", service: "Oil change" };
    expect(clientOrderHistoryLine(row, true, true, false)).toBe("BMW · ABC123 · Oil change");
    expect(clientOrderHistoryLine(row, false, false, false)).toBe("Oil change");
    expect(clientOrderHistoryLine({ ...row, service: "" }, true, false, false)).toBe("BMW");
  });
});
