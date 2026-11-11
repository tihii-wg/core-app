import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderMaterial, OrderService } from "../../lib/types";

const api = vi.hoisted(() => ({ getOrder: vi.fn(), updateOrder: vi.fn() }));

vi.mock("../../services/apiOrders", () => ({
  getOrder: api.getOrder,
  updateOrder: api.updateOrder,
}));

import { appendOrderMaterialLines, appendOrderServiceLines } from "./appendOrderLines";

const existingService: OrderService = {
  id: "line-1",
  serviceId: "svc-oil",
  serviceName: "Oil change",
  price: 40,
  quantity: 1,
  technicianId: "emp-2",
  technicianName: "Bob Tech",
  discountType: "percent",
  discountValue: 10,
  warrantyMonths: 6,
};

const existingMaterial: OrderMaterial = {
  id: "mat-1",
  inventoryItemId: "item-filter",
  itemName: "Oil filter",
  price: 12,
  quantity: 1,
  quantityIssued: 1,
  quantityReturned: 0,
  supplySource: "catalog",
  warehouseId: "wh-1",
};

const fresh = {
  id: "order-1",
  clientId: "client-1",
  vehicleId: "veh-1",
  device: "BMW",
  vin: "1HGBH41JXMN109186",
  carNumber: "ABC123",
  description: "Noise",
  assignedEmployeeId: "emp-1",
  deadline: "2026-10-01",
  team: [
    { employeeId: "emp-1", name: "Ada Tech", role: "lead" },
    { employeeId: "emp-2", name: "Bob Tech", role: "helper" },
  ],
  services: [existingService],
  materials: [existingMaterial],
} as unknown as Order;

beforeEach(() => {
  api.getOrder.mockReset();
  api.updateOrder.mockReset();
  api.getOrder.mockResolvedValue(fresh);
  api.updateOrder.mockImplementation(async () => ({ ...fresh, updated: true }));
});

describe("appendOrderServiceLines", () => {
  it("appends drafts to the FRESH services, keeping existing line ids and fields", async () => {
    const draft: OrderService = { serviceId: "svc-tires", serviceName: "Tires", price: 80, quantity: 2.5, warrantyMonths: 3 };

    const result = await appendOrderServiceLines("order-1", [draft], "ws-1");

    expect(api.getOrder).toHaveBeenCalledWith("order-1", "ws-1");
    expect(api.updateOrder).toHaveBeenCalledTimes(1);
    const [payload, workspaceId] = api.updateOrder.mock.calls[0];
    expect(workspaceId).toBe("ws-1");
    expect(payload.services).toEqual([existingService, draft]);
    expect(payload.services[0]).toBe(existingService);
    expect(payload.services[1].id).toBeUndefined();
    expect(result).toMatchObject({ updated: true });
  });

  it("does not touch materials and echoes the fresh order fields updateOrder rewrites", async () => {
    await appendOrderServiceLines("order-1", [{ serviceId: "svc-a", serviceName: "A", price: 1, quantity: 1 }], "ws-1");

    const [payload] = api.updateOrder.mock.calls[0];
    expect("materials" in payload).toBe(false);
    expect(payload).toMatchObject({
      orderId: "order-1",
      vehicleId: "veh-1",
      device: "BMW",
      vin: "1HGBH41JXMN109186",
      carNumber: "ABC123",
      description: "Noise",
      assignedEmployeeId: "emp-1",
      deadline: "2026-10-01",
      team: [
        { employeeId: "emp-1", role: "lead" },
        { employeeId: "emp-2", role: "helper" },
      ],
    });
    // Industry fields / mileage snapshots stay omitted so the DB columns are untouched.
    expect("siteAddress" in payload).toBe(false);
    expect("vehicleMileageSnapshot" in payload).toBe(false);
  });

  it("uses lines added by someone else after the panel loaded (fresh read, not the stale prop)", async () => {
    const concurrent: OrderService = { id: "line-2", serviceId: "svc-x", serviceName: "Added elsewhere", price: 5, quantity: 1 };
    api.getOrder.mockResolvedValue({ ...fresh, services: [existingService, concurrent] });

    await appendOrderServiceLines("order-1", [{ serviceId: "svc-a", serviceName: "A", price: 1, quantity: 1 }], "ws-1");

    const ids = api.updateOrder.mock.calls[0][0].services.map((line: OrderService) => line.id);
    expect(ids).toEqual(["line-1", "line-2", undefined]);
  });

  it("never sends a draft with an order-line id (it would be treated as already saved)", async () => {
    await appendOrderServiceLines(
      "order-1",
      [{ id: "client-side", serviceId: "svc-a", serviceName: "A", price: 1, quantity: 1 }],
      "ws-1",
    );
    expect(api.updateOrder.mock.calls[0][0].services[1]).not.toHaveProperty("id");
  });

  it("propagates API errors (closed order) without swallowing them", async () => {
    api.updateOrder.mockRejectedValue(new Error("closed"));
    await expect(
      appendOrderServiceLines("order-1", [{ serviceId: "svc-a", serviceName: "A", price: 1, quantity: 1 }], "ws-1"),
    ).rejects.toThrow("closed");
  });
});

describe("appendOrderMaterialLines", () => {
  it("includes the new catalog line (with warehouse) after the existing materials, services omitted", async () => {
    const draft: OrderMaterial = {
      inventoryItemId: "item-brake",
      itemName: "Brake pads",
      price: 99,
      quantity: 2,
      supplySource: "catalog",
      warehouseId: "wh-1",
      warrantyMonths: 12,
    };

    await appendOrderMaterialLines("order-1", [draft], "ws-1");

    const [payload, workspaceId] = api.updateOrder.mock.calls[0];
    expect(workspaceId).toBe("ws-1");
    expect(payload.materials).toEqual([existingMaterial, draft]);
    expect(payload.materials[0]).toBe(existingMaterial);
    expect("services" in payload).toBe(false);
    expect(payload.description).toBe("Noise");
  });

  it("supports one-time / customer-supplied drafts next to existing lines", async () => {
    const oneTime: OrderMaterial = { itemName: "Custom bolt", price: 3, quantity: 4, supplySource: "one_time" };
    const customer: OrderMaterial = { itemName: "Own tyre", price: 0, quantity: 1, supplySource: "customer" };

    await appendOrderMaterialLines("order-1", [oneTime, customer], "ws-1");

    expect(api.updateOrder.mock.calls[0][0].materials).toEqual([existingMaterial, oneTime, customer]);
  });

  it("treats an order without a materials array as empty", async () => {
    api.getOrder.mockResolvedValue({ ...fresh, materials: undefined });
    const draft: OrderMaterial = { itemName: "Bolt", price: 1, quantity: 1, supplySource: "one_time" };

    await appendOrderMaterialLines("order-1", [draft], "ws-1");

    expect(api.updateOrder.mock.calls[0][0].materials).toEqual([draft]);
  });

  it("rejects when updateOrder rejects (e.g. insufficient stock)", async () => {
    api.updateOrder.mockRejectedValue(new Error("Insufficient stock"));
    await expect(
      appendOrderMaterialLines("order-1", [{ itemName: "Bolt", price: 1, quantity: 1, supplySource: "one_time" }], "ws-1"),
    ).rejects.toThrow("Insufficient stock");
  });
});
