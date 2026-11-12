import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import {
  indexOrderLineComments,
  mergeOrderLineComments,
  stripOrderLineComments,
  withOrderLineComment,
} from "./orderLineComments";

function orderFixture(): Order {
  return {
    id: "o1",
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [
      { id: "svc-1", serviceId: "s1", serviceName: "Oil", price: 100, quantity: 1 },
      { id: "svc-2", serviceId: "s2", serviceName: "Brakes", price: 200, quantity: 1 },
    ],
    materials: [{ id: "mat-1", itemName: "Filter", price: 40, quantity: 1 }],
    description: "",
    status: "in_progress",
    assignedEmployeeId: null,
    assignedEmployeeName: null,
    createdByName: null,
    deadline: "",
    totalPrice: 340,
    discountTotal: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "",
    updatedAt: "",
  } as unknown as Order;
}

describe("orderLineComments merge", () => {
  it("merges comments by line id", () => {
    const indexed = indexOrderLineComments([
      { order_service_id: "svc-1", body: "OEM filter" },
      { order_material_id: "mat-1", body: "Customer part" },
    ]);
    const merged = mergeOrderLineComments(orderFixture(), indexed);
    expect(merged.services?.[0]?.comment).toBe("OEM filter");
    expect(merged.services?.[1]?.comment ?? null).toBeNull();
    expect(merged.materials?.[0]?.comment).toBe("Customer part");
  });

  it("treats missing/empty comment rows as no comments (feature not applied)", () => {
    const mergedEmpty = mergeOrderLineComments(orderFixture(), indexOrderLineComments([]));
    expect(mergedEmpty.services?.every((line) => line.comment == null)).toBe(true);
    expect(mergedEmpty.materials?.every((line) => line.comment == null)).toBe(true);

    const unchanged = mergeOrderLineComments(orderFixture(), null);
    expect(unchanged.services?.[0]?.comment).toBeUndefined();
  });

  it("strips comments for private print / public status", () => {
    const withComments = withOrderLineComment(orderFixture(), "service", "svc-1", "secret");
    const stripped = stripOrderLineComments(withComments);
    expect(stripped.services?.[0]?.comment).toBeNull();
  });
});
