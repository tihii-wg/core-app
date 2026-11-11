import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getWarehouseStock = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiOrders")>("../../services/apiOrders");
  return { ...actual, getOrder };
});

vi.mock("../../services/supabase", () => ({
  default: { rpc },
}));

vi.mock("../../services/apiWarehouseStock", () => ({
  getWarehouseStock: (...args: unknown[]) => getWarehouseStock(...args),
}));

import type { Order, OrderMaterial } from "../../lib/types";
import {
  applyOrderMaterialLinePatch,
  CHANGE_ORDER_MATERIAL_QUANTITY_RPC,
  InsufficientMaterialStockError,
  patchMaterialsForLineUpdate,
  updateOrderMaterialLine,
} from "./updateOrderMaterialLine";

function material(partial: Partial<OrderMaterial> & { id: string }): OrderMaterial {
  return {
    itemName: "Pad",
    price: 10,
    quantity: 2,
    quantityIssued: 2,
    quantityReturned: 0,
    supplySource: "catalog",
    inventoryItemId: "item-1",
    warehouseId: "wh-1",
    ...partial,
  };
}

function orderWith(materials: OrderMaterial[]): Order {
  return {
    id: "order-1",
    clientId: "c-1",
    clientName: "Ada",
    orderNumber: "ORD-1",
    device: "",
    vin: "",
    carNumber: "",
    service: "",
    services: [{ id: "s1", serviceId: "svc", serviceName: "Oil", price: 40, quantity: 1 }],
    materials,
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 60,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as Order;
}

describe("patchMaterialsForLineUpdate", () => {
  it("patches only the targeted line", () => {
    const lines = [
      material({ id: "m1", quantity: 1, price: 5 }),
      material({ id: "m2", quantity: 3, price: 8, inventoryItemId: "item-2" }),
    ];
    const next = patchMaterialsForLineUpdate(lines, "m2", { quantity: 4, price: 9 });
    expect(next[0]).toEqual(lines[0]);
    expect(next[1]).toMatchObject({ id: "m2", quantity: 4, price: 9 });
  });
});

describe("applyOrderMaterialLinePatch", () => {
  it("leaves omitted fields untouched", () => {
    const line = material({ id: "m1", quantity: 2, price: 10 });
    expect(applyOrderMaterialLinePatch(line, { price: 12 })).toMatchObject({ quantity: 2, price: 12 });
  });
});

describe("updateOrderMaterialLine", () => {
  beforeEach(() => {
    getOrder.mockReset();
    rpc.mockReset();
    getWarehouseStock.mockReset();
    getWarehouseStock.mockResolvedValue([{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 100 }]);
  });

  it("calls the quantity RPC and leaves other lines out of the request", async () => {
    const materials = [material({ id: "m1" }), material({ id: "m2", inventoryItemId: "item-2" })];
    getOrder.mockResolvedValueOnce(orderWith(materials)).mockResolvedValueOnce(
      orderWith([material({ id: "m1", quantity: 3 }), materials[1]!]),
    );
    rpc.mockResolvedValue({ data: { changed: true }, error: null });

    const updated = await updateOrderMaterialLine("order-1", "m1", { quantity: 3 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith(CHANGE_ORDER_MATERIAL_QUANTITY_RPC, {
      p_order_id: "order-1",
      p_order_material_id: "m1",
      p_quantity: 3,
    });
    expect(updated.materials?.[0]?.quantity).toBe(3);
    expect(rpc.mock.calls.some((call) => call[0] === "sync_order_materials")).toBe(false);
  });

  it("blocks catalog increases when warehouse stock is insufficient", async () => {
    getOrder.mockResolvedValue(orderWith([material({ id: "m1", quantity: 2, quantityIssued: 2 })]));
    getWarehouseStock.mockResolvedValue([{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 1 }]);

    await expect(updateOrderMaterialLine("order-1", "m1", { quantity: 5 }, "ws-1")).rejects.toBeInstanceOf(
      InsufficientMaterialStockError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("skips RPCs when quantity is unchanged", async () => {
    const current = orderWith([material({ id: "m1", quantity: 2 })]);
    getOrder.mockResolvedValue(current);
    const updated = await updateOrderMaterialLine("order-1", "m1", { quantity: 2 }, "ws-1");
    expect(rpc).not.toHaveBeenCalled();
    expect(updated.materials?.[0]?.quantity).toBe(2);
  });

  it("uses the material price RPC for price-only edits", async () => {
    getOrder
      .mockResolvedValueOnce(orderWith([material({ id: "m1", price: 10 })]))
      .mockResolvedValueOnce(orderWith([material({ id: "m1", price: 12 })]));
    rpc.mockResolvedValue({ data: { updated: 1 }, error: null });

    await updateOrderMaterialLine("order-1", "m1", { price: 12 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith("crm_set_order_material_prices", {
      p_order_id: "order-1",
      p_lines: [{ line_id: "m1", price: 12 }],
    });
  });
});
