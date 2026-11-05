import { describe, expect, it } from "vitest";
import type { Order } from "../../lib/types";
import {
  isMeaningfulOrderEventType,
  RECENT_ORDERS_LIMIT,
  selectOrdersByActivityIds,
  selectRecentOrdersFallback,
  uniqueOrderIdsByLatestActivity,
} from "./recentOrdersByActivity";

function order(id: string, orderNumber: string): Order {
  return {
    id,
    clientId: "c1",
    clientName: "Client",
    orderNumber,
    device: "Car",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    materials: [],
    description: "",
    status: "new",
    customStatusId: null,
    customStatus: null,
    closedAt: null,
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 10,
    subtotal: 10,
    discountTotal: 0,
    isPaid: false,
    paymentStatus: "unpaid",
    taxInvoiceNumber: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

describe("recentOrdersByActivity", () => {
  it("treats known feed event types as meaningful and rejects noise", () => {
    expect(isMeaningfulOrderEventType("payment_recorded")).toBe(true);
    expect(isMeaningfulOrderEventType("status_changed")).toBe(true);
    expect(isMeaningfulOrderEventType("service_added")).toBe(true);
    expect(isMeaningfulOrderEventType("")).toBe(false);
    expect(isMeaningfulOrderEventType("totals_recalculated")).toBe(false);
    expect(isMeaningfulOrderEventType(null)).toBe(false);
  });

  it("dedupes by order id and keeps latest activity first within the limit", () => {
    const ids = uniqueOrderIdsByLatestActivity(
      [
        { orderId: "o-new", eventType: "payment_recorded", createdAt: "2026-11-05T12:00:00.000Z" },
        { orderId: "o-new", eventType: "status_changed", createdAt: "2026-11-05T11:00:00.000Z" },
        { orderId: "o-old", eventType: "service_added", createdAt: "2026-11-05T10:00:00.000Z" },
        { orderId: "o-mid", eventType: "order_field_changed", createdAt: "2026-11-05T09:00:00.000Z" },
        { orderId: "o-skip", eventType: "totals_recalculated", createdAt: "2026-11-05T08:30:00.000Z" },
        { orderId: "o-older", eventType: "order_created", createdAt: "2026-11-04T09:00:00.000Z" },
      ],
      3,
    );
    expect(ids).toEqual(["o-new", "o-old", "o-mid"]);
    expect(ids).toHaveLength(3);
  });

  it("preserves the Recent Orders limit", () => {
    const events = Array.from({ length: 20 }, (_, index) => ({
      orderId: `o-${index}`,
      eventType: "order_created",
      createdAt: `2026-11-05T${String(20 - index).padStart(2, "0")}:00:00.000Z`,
    }));
    expect(uniqueOrderIdsByLatestActivity(events)).toHaveLength(RECENT_ORDERS_LIMIT);
  });

  it("maps activity ids onto hydrated orders without duplicates", () => {
    const orders = [order("a", "ORD-1"), order("b", "ORD-2"), order("c", "ORD-3")];
    expect(selectOrdersByActivityIds(orders, ["b", "b", "a", "missing", "c"], 5).map((item) => item.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("does not pad with inactive orders when activity ids are fewer than the limit", () => {
    const orders = [order("a", "ORD-1"), order("b", "ORD-2"), order("c", "ORD-3")];
    expect(selectOrdersByActivityIds(orders, ["c"], RECENT_ORDERS_LIMIT).map((item) => item.id)).toEqual(["c"]);
  });

  it("falls back to newest-created slice when the activity feed is unavailable", () => {
    const orders = [order("a", "ORD-1"), order("b", "ORD-2"), order("c", "ORD-3"), order("d", "ORD-4"), order("e", "ORD-5"), order("f", "ORD-6")];
    expect(selectRecentOrdersFallback(orders).map((item) => item.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("moves an older order to the top after newer meaningful activity", () => {
    const orders = [order("old", "ORD-OLD"), order("fresh", "ORD-NEW")];
    const ids = uniqueOrderIdsByLatestActivity(
      [
        { orderId: "old", eventType: "payment_recorded", createdAt: "2026-11-05T18:00:00.000Z" },
        { orderId: "fresh", eventType: "order_created", createdAt: "2026-11-01T10:00:00.000Z" },
        { orderId: "old", eventType: "order_created", createdAt: "2026-10-01T10:00:00.000Z" },
      ],
      5,
    );
    expect(selectOrdersByActivityIds(orders, ids).map((item) => item.orderNumber)).toEqual(["ORD-OLD", "ORD-NEW"]);
  });
});
