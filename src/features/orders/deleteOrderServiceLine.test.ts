import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiOrders")>("../../services/apiOrders");
  return { ...actual, getOrder, updateOrder };
});

import type { Order, OrderService } from "../../lib/types";
import { deleteOrderServiceLine, servicesAfterLineDelete } from "./deleteOrderServiceLine";

function service(partial: Partial<OrderService> & { id: string }): OrderService {
  return {
    serviceId: "svc",
    serviceName: "Oil change",
    price: 40,
    quantity: 1,
    ...partial,
  };
}

function orderWith(services: OrderService[]): Order {
  return {
    id: "order-1",
    clientId: "c-1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services,
    materials: [],
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 80,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as Order;
}

describe("servicesAfterLineDelete", () => {
  it("removes only the targeted line", () => {
    const lines = [service({ id: "a", price: 10 }), service({ id: "b", price: 20 })];
    expect(servicesAfterLineDelete(lines, "a")).toEqual([lines[1]]);
  });
});

describe("deleteOrderServiceLine", () => {
  beforeEach(() => {
    getOrder.mockReset();
    updateOrder.mockReset();
  });

  it("re-reads the order and saves without the deleted line", async () => {
    const materials = [{ id: "m1", itemName: "Pad", price: 5, quantity: 1, supplySource: "one_time" as const }];
    const fresh = {
      ...orderWith([service({ id: "a" }), service({ id: "b", serviceName: "Filter" })]),
      materials,
      team: [{ employeeId: "e1", role: "technician" as const }],
    };
    getOrder.mockResolvedValue(fresh);
    updateOrder.mockResolvedValue({ ...fresh, services: [fresh.services[1]!], totalPrice: 40 });

    const updated = await deleteOrderServiceLine("order-1", "a", "ws-1");
    expect(updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        services: [expect.objectContaining({ id: "b" })],
        device: fresh.device,
        description: fresh.description,
      }),
      "ws-1",
    );
    expect(updated.services).toHaveLength(1);
    expect(updated.totalPrice).toBe(40);
  });
});
