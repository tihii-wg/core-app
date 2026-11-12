import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.hoisted(() => vi.fn());
const updateOrder = vi.hoisted(() => vi.fn());
const orderFromLineRpcPayload = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getWarehouseStock = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiOrders")>("../../services/apiOrders");
  return {
    ...actual,
    getOrder,
    updateOrder,
    orderFromLineRpcPayload: (...args: unknown[]) => orderFromLineRpcPayload(...args),
  };
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
  diffOrderMaterialLinePatch,
  InsufficientMaterialStockError,
  orderMaterialLinePatchIsEmpty,
  patchMaterialsForLineUpdate,
  UPDATE_ORDER_MATERIAL_LINE_RPC,
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

function missingRpc(name: string) {
  return {
    data: null,
    error: { message: `Could not find the function ${name}`, code: "PGRST202" },
  };
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

describe("applyOrderMaterialLinePatch / diff", () => {
  it("leaves omitted fields untouched", () => {
    const line = material({ id: "m1", quantity: 2, price: 10 });
    expect(applyOrderMaterialLinePatch(line, { price: 12 })).toMatchObject({ quantity: 2, price: 12 });
  });

  it("diffs warranty clears and warehouse moves", () => {
    const original = material({
      id: "m1",
      quantityIssued: 0,
      quantityReturned: 0,
      warrantyMonths: 6,
      warrantyKm: 10000,
    });
    const draft = { ...original, warrantyMonths: null, warrantyKm: null, warehouseId: "wh-2" };
    const patch = diffOrderMaterialLinePatch(original, draft);
    expect(patch).toEqual({
      warehouseId: "wh-2",
      warrantyMonths: null,
      warrantyDays: null,
      warrantyKm: null,
    });
    expect(orderMaterialLinePatchIsEmpty(patch)).toBe(false);
  });
});

describe("updateOrderMaterialLine", () => {
  beforeEach(() => {
    getOrder.mockReset();
    updateOrder.mockReset();
    orderFromLineRpcPayload.mockReset();
    rpc.mockReset();
    getWarehouseStock.mockReset();
    getWarehouseStock.mockResolvedValue([{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 100 }]);
  });

  it("uses the atomic edit RPC when present", async () => {
    const materials = [material({ id: "m1", quantityIssued: 0, quantityReturned: 0 })];
    const fromRpc = orderWith([material({ id: "m1", quantity: 3, quantityIssued: 3, quantityReturned: 0 })]);
    getOrder.mockResolvedValue(orderWith(materials));
    rpc.mockResolvedValue({ data: { order: fromRpc }, error: null });
    orderFromLineRpcPayload.mockReturnValue(fromRpc);

    const updated = await updateOrderMaterialLine("order-1", "m1", { quantity: 3 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith(
      UPDATE_ORDER_MATERIAL_LINE_RPC,
      expect.objectContaining({
        p_order_id: "order-1",
        p_line_id: "m1",
        p_quantity: 3,
        p_set_warehouse: false,
        p_set_warranty: false,
      }),
    );
    expect(updated.materials?.[0]?.quantity).toBe(3);
    expect(rpc.mock.calls.some((call) => call[0] === CHANGE_ORDER_MATERIAL_QUANTITY_RPC)).toBe(false);
  });

  it("falls back to the quantity RPC when the edit RPC is missing", async () => {
    const materials = [material({ id: "m1" }), material({ id: "m2", inventoryItemId: "item-2" })];
    const afterQty = orderWith([material({ id: "m1", quantity: 3 }), materials[1]!]);
    getOrder.mockResolvedValueOnce(orderWith(materials)).mockResolvedValueOnce(afterQty);
    rpc
      .mockResolvedValueOnce(missingRpc(UPDATE_ORDER_MATERIAL_LINE_RPC))
      .mockResolvedValueOnce({ data: { changed: true }, error: null });
    orderFromLineRpcPayload.mockReturnValue(afterQty);

    const updated = await updateOrderMaterialLine("order-1", "m1", { quantity: 3 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith(CHANGE_ORDER_MATERIAL_QUANTITY_RPC, {
      p_order_id: "order-1",
      p_order_material_id: "m1",
      p_quantity: 3,
    });
    expect(updated.materials?.[0]?.quantity).toBe(3);
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
    rpc.mockResolvedValue(missingRpc(UPDATE_ORDER_MATERIAL_LINE_RPC));
    const updated = await updateOrderMaterialLine("order-1", "m1", { quantity: 2 }, "ws-1");
    expect(rpc.mock.calls.filter((call) => call[0] === CHANGE_ORDER_MATERIAL_QUANTITY_RPC)).toHaveLength(0);
    expect(updated.materials?.[0]?.quantity).toBe(2);
  });

  it("falls back to the material price RPC for price-only edits when the edit RPC is missing", async () => {
    const afterPrice = orderWith([material({ id: "m1", price: 12 })]);
    getOrder.mockResolvedValueOnce(orderWith([material({ id: "m1", price: 10 })])).mockResolvedValueOnce(afterPrice);
    rpc
      .mockResolvedValueOnce(missingRpc(UPDATE_ORDER_MATERIAL_LINE_RPC))
      .mockResolvedValueOnce({ data: { updated: 1 }, error: null });
    orderFromLineRpcPayload.mockReturnValue(afterPrice);

    await updateOrderMaterialLine("order-1", "m1", { price: 12 }, "ws-1");
    expect(rpc).toHaveBeenCalledWith("crm_set_order_material_prices", {
      p_order_id: "order-1",
      p_lines: [{ line_id: "m1", price: 12 }],
    });
  });

  it("falls back to updateOrder for warranty clears when the edit RPC is missing", async () => {
    const current = material({
      id: "m1",
      quantityIssued: 0,
      quantityReturned: 0,
      warrantyMonths: 12,
      warrantyKm: 5000,
    });
    getOrder.mockResolvedValue(orderWith([current]));
    rpc.mockResolvedValue(missingRpc(UPDATE_ORDER_MATERIAL_LINE_RPC));
    updateOrder.mockResolvedValue(
      orderWith([{ ...current, warrantyMonths: null, warrantyDays: null, warrantyKm: null }]),
    );

    await updateOrderMaterialLine(
      "order-1",
      "m1",
      { warrantyMonths: null, warrantyDays: null, warrantyKm: null },
      "ws-1",
    );
    expect(updateOrder).toHaveBeenCalledTimes(1);
    expect(updateOrder.mock.calls[0][0].materials[0]).toMatchObject({
      id: "m1",
      warrantyMonths: null,
      warrantyDays: null,
      warrantyKm: null,
    });
  });

  it("rejects warehouse moves after stock has been issued", async () => {
    getOrder.mockResolvedValue(orderWith([material({ id: "m1", quantityIssued: 1, quantityReturned: 0 })]));
    await expect(
      updateOrderMaterialLine("order-1", "m1", { warehouseId: "wh-2" }, "ws-1"),
    ).rejects.toThrow(/верните|Return|Returnați|returnBeforeChangeWarehouse/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends p_set_warranty with cleared values when the edit RPC accepts them", async () => {
    const current = material({
      id: "m1",
      quantityIssued: 0,
      quantityReturned: 0,
      warrantyMonths: 12,
      warrantyKm: 5000,
    });
    const fromRpc = orderWith([{ ...current, warrantyMonths: null, warrantyKm: null }]);
    getOrder.mockResolvedValue(orderWith([current]));
    rpc.mockResolvedValue({ data: { order: fromRpc }, error: null });
    orderFromLineRpcPayload.mockReturnValue(fromRpc);

    await updateOrderMaterialLine(
      "order-1",
      "m1",
      { warrantyMonths: null, warrantyDays: null, warrantyKm: null },
      "ws-1",
    );
    expect(rpc).toHaveBeenCalledWith(
      UPDATE_ORDER_MATERIAL_LINE_RPC,
      expect.objectContaining({
        p_set_warranty: true,
        p_warranty_months: null,
        p_warranty_days: null,
        p_warranty_km: null,
      }),
    );
    expect(updateOrder).not.toHaveBeenCalled();
  });
});
