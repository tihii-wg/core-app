import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderService } from "../../lib/types";
import {
  applyOrderServiceLinePatch,
  parseOrderServiceLinePrice,
  patchServicesForLineUpdate,
  updateOrderServiceLine,
} from "./updateOrderServiceLine";

const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
  updateOrder: (...args: unknown[]) => updateOrder(...args),
}));

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
    getOrder.mockResolvedValue(order);
    updateOrder.mockResolvedValue({ ...order, services: [{ ...lineA, price: 99 }, lineB] });
  });

  it("re-reads the order, patches one line, and saves through updateOrder", async () => {
    await updateOrderServiceLine("order-1", "line-a", { price: 99 }, "ws-1");

    expect(getOrder).toHaveBeenCalledWith("order-1", "ws-1");
    expect(updateOrder).toHaveBeenCalledTimes(1);
    const payload = updateOrder.mock.calls[0][0];
    expect(payload.orderId).toBe("order-1");
    expect(payload.services).toHaveLength(2);
    expect(payload.services[0]).toMatchObject({ id: "line-a", price: 99, quantity: 1 });
    expect(payload.services[1]).toEqual(lineB);
    expect(payload.assignedEmployeeId).toBe("emp-1");
    expect(payload.materials).toBeUndefined();
  });

  it("rejects unknown line ids", async () => {
    await expect(updateOrderServiceLine("order-1", "missing", { price: 1 }, "ws-1")).rejects.toThrow(
      /not found/i,
    );
    expect(updateOrder).not.toHaveBeenCalled();
  });
});
