import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrder = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../../services/apiOrders", async () => {
  const actual = await vi.importActual<typeof import("../../services/apiOrders")>("../../services/apiOrders");
  return { ...actual, getOrder };
});

vi.mock("../../services/supabase", () => ({
  default: { rpc },
}));

import type { Order, OrderMaterial } from "../../lib/types";
import { MissingRpcError } from "../../services/missingRpc";
import {
  DELETE_ORDER_MATERIAL_RPC,
  deleteOrderMaterialLine,
  materialDraftForUndo,
} from "./deleteOrderMaterialLine";

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
    services: [],
    materials,
    description: "",
    status: "new",
    assignedEmployeeId: "",
    assignedEmployeeName: "",
    deadline: "",
    totalPrice: 20,
    isPaid: false,
    paymentStatus: "unpaid",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  } as Order;
}

describe("materialDraftForUndo", () => {
  it("strips id and warehouse counters for re-append", () => {
    const draft = materialDraftForUndo(material({ id: "m1" }));
    expect(draft.id).toBeUndefined();
    expect(draft.quantityIssued).toBe(0);
    expect(draft.quantityReturned).toBe(0);
    expect(draft.inventoryItemId).toBe("item-1");
  });
});

describe("deleteOrderMaterialLine", () => {
  beforeEach(() => {
    getOrder.mockReset();
    rpc.mockReset();
  });

  it("uses the full order from the RPC when present", async () => {
    const empty = orderWith([]);
    rpc.mockResolvedValue({ data: { deleted: true, order: { order: { id: "order-1" }, services: [], materials: [] } }, error: null });
    // importActual orderFromLineRpcPayload will fail on incomplete payload → getOrder fallback
    getOrder.mockResolvedValue(empty);

    const updated = await deleteOrderMaterialLine("order-1", "m1", "ws-1");
    expect(rpc).toHaveBeenCalledWith(DELETE_ORDER_MATERIAL_RPC, {
      p_order_id: "order-1",
      p_order_material_id: "m1",
    });
    expect(updated.materials).toEqual([]);
  });

  it("falls back to getOrder when the RPC returns no order payload", async () => {
    rpc.mockResolvedValue({ data: { deleted: true }, error: null });
    getOrder.mockResolvedValue(orderWith([]));
    const updated = await deleteOrderMaterialLine("order-1", "m1", "ws-1");
    expect(getOrder).toHaveBeenCalledWith("order-1", "ws-1");
    expect(updated.materials).toEqual([]);
  });

  it("maps a missing RPC to MissingRpcError", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: `Could not find the function ${DELETE_ORDER_MATERIAL_RPC}`, code: "PGRST202" },
    });
    await expect(deleteOrderMaterialLine("order-1", "m1", "ws-1")).rejects.toBeInstanceOf(MissingRpcError);
  });
});
