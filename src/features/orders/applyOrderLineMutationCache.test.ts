import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "../../lib/types";
import { applyOrderLineMutationCache } from "./applyOrderLineMutationCache";

function order(partial: Partial<Order> & { id: string }): Order {
  return {
    clientId: "c1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [],
    materials: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 10,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  } as Order;
}

describe("applyOrderLineMutationCache", () => {
  it("sets the open order and patches only the matching list row", () => {
    const queryClient = new QueryClient();
    const updated = order({ id: "o1", totalPrice: 99, device: "Updated" });
    const other = order({ id: "o2", totalPrice: 20, device: "Other" });

    queryClient.setQueryData(["orders", "ws-1", "page", "k"], {
      orders: [order({ id: "o1", totalPrice: 10 }), other],
      total: 2,
    });
    queryClient.setQueryData(["orders", "ws-1"], [order({ id: "o1", totalPrice: 10 }), other]);

    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    applyOrderLineMutationCache(queryClient, "ws-1", updated);

    expect(queryClient.getQueryData(["order", "o1"])).toEqual(updated);
    const page = queryClient.getQueryData(["orders", "ws-1", "page", "k"]) as { orders: Order[] };
    expect(page.orders[0]).toEqual(updated);
    expect(page.orders[1]).toEqual(other);
    const list = queryClient.getQueryData(["orders", "ws-1"]) as Order[];
    expect(list[0]).toEqual(updated);
    expect(list[1]).toEqual(other);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order_events", "ws-1", "o1"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["clients", "ws-1"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["dashboard", "ws-1"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["warehouse-stock", "ws-1"] });
  });

  it("invalidates stock caches only when stockMoved", () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    applyOrderLineMutationCache(queryClient, "ws-1", order({ id: "o1" }), { stockMoved: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["warehouse-stock", "ws-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory", "ws-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inventory-movements", "ws-1"] });
  });
});
