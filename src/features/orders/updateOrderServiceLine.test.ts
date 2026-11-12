import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderService } from "../../lib/types";

const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());
const updateOrderServiceLinePrice = vi.hoisted(() => vi.fn());
const orderFromLineRpcPayload = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
  updateOrder: (...args: unknown[]) => updateOrder(...args),
  updateOrderServiceLinePrice: (...args: unknown[]) => updateOrderServiceLinePrice(...args),
  orderFromLineRpcPayload: (...args: unknown[]) => orderFromLineRpcPayload(...args),
}));

vi.mock("../../services/supabase", () => ({
  default: { rpc },
}));

import {
  applyOrderServiceLinePatch,
  parseOrderServiceLinePrice,
  patchServicesForLineUpdate,
  UPDATE_ORDER_SERVICE_LINE_RPC,
  updateOrderServiceLine,
} from "./updateOrderServiceLine";

const lineA: OrderService = {
  id: "line-a",
  serviceId: "svc-a",
  serviceName: "Oil change",
  price: 40,
  quantity: 1,
  technicianId: "tech-1",
  technicianName: "Ada",
};

const lineB: OrderService = {
  id: "line-b",
  serviceId: "svc-b",
  serviceName: "Wash",
  price: 10,
  quantity: 2,
  technicianId: null,
};

const order = {
  id: "order-1",
  device: "Car",
  carNumber: "ABC",
  vin: "",
  description: "note",
  assignedEmployeeId: "emp-1",
  team: [{ employeeId: "emp-1", role: "lead" }],
  deadline: "2026-11-01",
  vehicleId: null,
  services: [lineA, lineB],
  materials: [],
} as unknown as Order;

describe("parseOrderServiceLinePrice", () => {
  it("accepts comma and dot separators and allows zero", () => {
    expect(parseOrderServiceLinePrice("12,5")).toBe(12.5);
    expect(parseOrderServiceLinePrice("12.50")).toBe(12.5);
    expect(parseOrderServiceLinePrice(0)).toBe(0);
    expect(parseOrderServiceLinePrice("0")).toBe(0);
  });

  it("rejects negatives and non-numbers", () => {
    expect(parseOrderServiceLinePrice("-1")).toBe("invalid");
    expect(parseOrderServiceLinePrice("")).toBe("invalid");
    expect(parseOrderServiceLinePrice("abc")).toBe("invalid");
  });
});

describe("patchServicesForLineUpdate", () => {
  it("patches only the target line", () => {
    const next = patchServicesForLineUpdate([lineA, lineB], "line-a", { price: 55, quantity: 3 });
    expect(next[0]).toMatchObject({ id: "line-a", price: 55, quantity: 3, serviceName: "Oil change" });
    expect(next[1]).toEqual(lineB);
  });

  it("can clear the performer", () => {
    const next = applyOrderServiceLinePatch(lineA, { technicianId: null });
    expect(next.technicianId).toBeNull();
    expect(next.technicianName).toBe("");
  });
});

describe("updateOrderServiceLine", () => {
  beforeEach(() => {
    getOrder.mockReset();
    updateOrder.mockReset();
    updateOrderServiceLinePrice.mockReset();
    orderFromLineRpcPayload.mockReset();
    rpc.mockReset();
    getOrder.mockResolvedValue(order);
    updateOrder.mockResolvedValue({ ...order, services: [{ ...lineA, price: 99 }, lineB] });
    updateOrderServiceLinePrice.mockResolvedValue({ ...order, services: [{ ...lineA, price: 99 }, lineB] });
  });

  it("uses the RPC result when present (no fallback)", async () => {
    const fromRpc = { ...order, totalPrice: 123 } as Order;
    rpc.mockResolvedValue({ data: { order: fromRpc }, error: null });
    orderFromLineRpcPayload.mockReturnValue(fromRpc);

    const result = await updateOrderServiceLine("order-1", "line-a", { price: 99 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith(UPDATE_ORDER_SERVICE_LINE_RPC, expect.objectContaining({
      p_order_id: "order-1",
      p_line_id: "line-a",
      p_price: 99,
      p_set_technician: false,
    }));
    expect(result.totalPrice).toBe(123);
    expect(updateOrderServiceLinePrice).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("falls back to the fast price path when the RPC is missing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${UPDATE_ORDER_SERVICE_LINE_RPC}`, code: "PGRST202" },
    });

    await updateOrderServiceLine("order-1", "line-a", { price: 99 }, "ws-1");
    expect(updateOrderServiceLinePrice).toHaveBeenCalledWith("order-1", "line-a", { price: 99, quantity: undefined }, "ws-1");
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it("falls back to updateOrder for technician changes when the RPC is missing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${UPDATE_ORDER_SERVICE_LINE_RPC}`, code: "PGRST202" },
    });

    await updateOrderServiceLine("order-1", "line-a", { technicianId: "emp-9" }, "ws-1");
    expect(getOrder).toHaveBeenCalledWith("order-1", "ws-1");
    expect(updateOrder).toHaveBeenCalledTimes(1);
    expect(updateOrder.mock.calls[0][0].services[0]).toMatchObject({ id: "line-a", technicianId: "emp-9" });
  });

  it("rejects unknown line ids on the fallback path", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${UPDATE_ORDER_SERVICE_LINE_RPC}`, code: "PGRST202" },
    });
    await expect(updateOrderServiceLine("order-1", "missing", { technicianId: "x" }, "ws-1")).rejects.toThrow(/not found/i);
    expect(updateOrder).not.toHaveBeenCalled();
  });
});
