import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, OrderMaterial, OrderService } from "../../lib/types";

const api = vi.hoisted(() => ({
  getOrder: vi.fn(),
  updateOrder: vi.fn(),
  appendOrderCatalogServiceLine: vi.fn(),
  orderFromLineRpcPayload: vi.fn(),
}));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", () => ({
  getOrder: (...args: unknown[]) => api.getOrder(...args),
  updateOrder: (...args: unknown[]) => api.updateOrder(...args),
  appendOrderCatalogServiceLine: (...args: unknown[]) => api.appendOrderCatalogServiceLine(...args),
  orderFromLineRpcPayload: (...args: unknown[]) => api.orderFromLineRpcPayload(...args),
}));

vi.mock("../../services/supabase", () => ({
  default: { rpc },
}));

import {
  ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC,
  ADD_ORDER_SERVICE_LINE_RPC,
  appendOrderMaterialLines,
  appendOrderServiceLines,
} from "./appendOrderLines";

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
  api.appendOrderCatalogServiceLine.mockReset();
  api.orderFromLineRpcPayload.mockReset();
  rpc.mockReset();
  api.getOrder.mockResolvedValue(fresh);
  api.updateOrder.mockImplementation(async () => ({ ...fresh, updated: true }));
  api.appendOrderCatalogServiceLine.mockResolvedValue(null);
  // Default: RPCs not installed → fallback paths.
  rpc.mockResolvedValue({
    data: null,
    error: { message: "Could not find the function crm_add_order_service_line", code: "PGRST202" },
  });
});

describe("appendOrderServiceLines", () => {
  it("uses the add-service RPC when present", async () => {
    const fromRpc = { ...fresh, totalPrice: 55 } as Order;
    rpc.mockResolvedValue({ data: fromRpc, error: null });
    api.orderFromLineRpcPayload.mockReturnValue(fromRpc);

    const result = await appendOrderServiceLines(
      "order-1",
      [{ serviceId: "svc-tires", serviceName: "Tires", price: 80, quantity: 1 }],
      "ws-1",
    );
    expect(rpc).toHaveBeenCalledWith(ADD_ORDER_SERVICE_LINE_RPC, expect.objectContaining({
      p_order_id: "order-1",
      p_service_id: "svc-tires",
    }));
    expect(result.totalPrice).toBe(55);
    expect(api.updateOrder).not.toHaveBeenCalled();
  });

  it("falls back to updateOrder when the RPC is missing (multi-line)", async () => {
    const draft: OrderService = { serviceId: "svc-tires", serviceName: "Tires", price: 80, quantity: 2.5, warrantyMonths: 3 };
    // Force multi-line so we skip the single-catalog quick path entirely after missing RPC + null quick.
    const result = await appendOrderServiceLines("order-1", [draft, { ...draft, serviceId: "svc-b" }], "ws-1");

    expect(api.getOrder).toHaveBeenCalledWith("order-1", "ws-1");
    expect(api.updateOrder).toHaveBeenCalledTimes(1);
    const [payload, workspaceId] = api.updateOrder.mock.calls[0];
    expect(workspaceId).toBe("ws-1");
    expect(payload.services).toHaveLength(3);
    expect(result).toMatchObject({ updated: true });
  });

  it("does not touch materials and echoes the fresh order fields updateOrder rewrites", async () => {
    await appendOrderServiceLines("order-1", [
      { serviceId: "svc-a", serviceName: "A", price: 1, quantity: 1 },
      { serviceId: "svc-b", serviceName: "B", price: 1, quantity: 1 },
    ], "ws-1");

    const [payload] = api.updateOrder.mock.calls[0];
    expect("materials" in payload).toBe(false);
    expect(payload).toMatchObject({
      orderId: "order-1",
      vehicleId: "veh-1",
      device: "BMW",
      assignedEmployeeId: "emp-1",
    });
  });
});

describe("appendOrderMaterialLines", () => {
  it("uses the add-and-issue RPC for a single catalog material", async () => {
    const fromRpc = { ...fresh, totalPrice: 200 } as Order;
    rpc.mockResolvedValue({ data: { order: fromRpc }, error: null });
    api.orderFromLineRpcPayload.mockReturnValue(fromRpc);

    const draft: OrderMaterial = {
      inventoryItemId: "item-brake",
      itemName: "Brake pads",
      price: 99,
      quantity: 2,
      supplySource: "catalog",
      warehouseId: "wh-1",
    };
    const result = await appendOrderMaterialLines("order-1", [draft], "ws-1");
    expect(rpc).toHaveBeenCalledWith(ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC, expect.objectContaining({
      p_order_id: "order-1",
      p_inventory_item_id: "item-brake",
      p_warehouse_id: "wh-1",
    }));
    expect(result.totalPrice).toBe(200);
    expect(api.updateOrder).not.toHaveBeenCalled();
  });

  it("falls back to updateOrder when the RPC is missing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${ADD_AND_ISSUE_ORDER_CATALOG_MATERIAL_RPC}`, code: "PGRST202" },
    });
    const draft: OrderMaterial = {
      inventoryItemId: "item-brake",
      itemName: "Brake pads",
      price: 99,
      quantity: 2,
      supplySource: "catalog",
      warehouseId: "wh-1",
    };

    await appendOrderMaterialLines("order-1", [draft], "ws-1");
    expect(api.updateOrder).toHaveBeenCalledTimes(1);
    expect(api.updateOrder.mock.calls[0][0].materials).toEqual([existingMaterial, draft]);
  });

  it("supports one-time / customer-supplied drafts next to existing lines", async () => {
    const oneTime: OrderMaterial = { itemName: "Custom bolt", price: 3, quantity: 4, supplySource: "one_time" };
    const customer: OrderMaterial = { itemName: "Own tyre", price: 0, quantity: 1, supplySource: "customer" };

    await appendOrderMaterialLines("order-1", [oneTime, customer], "ws-1");

    expect(api.updateOrder.mock.calls[0][0].materials).toEqual([existingMaterial, oneTime, customer]);
  });
});
