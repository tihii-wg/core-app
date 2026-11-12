import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());
const deleteOrderServiceLineDirect = vi.hoisted(() => vi.fn());
const orderFromLineRpcPayload = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
  updateOrder: (...args: unknown[]) => updateOrder(...args),
  deleteOrderServiceLineDirect: (...args: unknown[]) => deleteOrderServiceLineDirect(...args),
  orderFromLineRpcPayload: (...args: unknown[]) => orderFromLineRpcPayload(...args),
}));

vi.mock("../../services/supabase", () => ({
  default: { rpc },
}));

import type { Order, OrderService } from "../../lib/types";
import {
  DELETE_ORDER_SERVICE_LINE_RPC,
  deleteOrderServiceLine,
  servicesAfterLineDelete,
} from "./deleteOrderServiceLine";

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
    deleteOrderServiceLineDirect.mockReset();
    orderFromLineRpcPayload.mockReset();
    rpc.mockReset();
  });

  it("uses the RPC result when present", async () => {
    const fromRpc = orderWith([service({ id: "b" })]);
    rpc.mockResolvedValue({ data: fromRpc, error: null });
    orderFromLineRpcPayload.mockReturnValue(fromRpc);

    const updated = await deleteOrderServiceLine("order-1", "a", "ws-1");
    expect(rpc).toHaveBeenCalledWith(DELETE_ORDER_SERVICE_LINE_RPC, {
      p_order_id: "order-1",
      p_line_id: "a",
    });
    expect(updated.services).toHaveLength(1);
    expect(deleteOrderServiceLineDirect).not.toHaveBeenCalled();
  });

  it("falls back to deleteOrderServiceLineDirect when the RPC is missing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${DELETE_ORDER_SERVICE_LINE_RPC}`, code: "PGRST202" },
    });
    deleteOrderServiceLineDirect.mockResolvedValue(orderWith([service({ id: "b" })]));

    const updated = await deleteOrderServiceLine("order-1", "a", "ws-1");
    expect(deleteOrderServiceLineDirect).toHaveBeenCalledWith("order-1", "a", "ws-1");
    expect(updated.services[0]?.id).toBe("b");
  });

  it("fullRebuild re-reads and saves through updateOrder", async () => {
    const fresh = orderWith([service({ id: "a" }), service({ id: "b", serviceName: "Filter" })]);
    getOrder.mockResolvedValue(fresh);
    updateOrder.mockResolvedValue({ ...fresh, services: [fresh.services[1]!], totalPrice: 40 });

    const updated = await deleteOrderServiceLine("order-1", "a", "ws-1", { fullRebuild: true });
    expect(updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order-1",
        services: [expect.objectContaining({ id: "b" })],
      }),
      "ws-1",
    );
    expect(updated.totalPrice).toBe(40);
  });
});
