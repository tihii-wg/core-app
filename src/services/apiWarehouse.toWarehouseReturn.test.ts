import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder } from "./apiOrders";
import { issueOrderMaterialsFromWarehouse, returnOrderMaterials, returnOrderMaterialsToWarehouse } from "./apiWarehouse";
import { MissingRpcError } from "./missingRpc";
import { fake } from "../tests/fakeSupabase";
import { installIssueFromWarehouseRpc, installReturnToWarehouseRpc, seedWarehouse } from "../tests/orderRpcMocks";
import { seedCoreApp, USERS, WS, row } from "../tests/coreAppDb";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

const brakePads = { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 5 };
const qty = (quantity: number) => [{ inventoryItemId: "item-a1", quantity }];

async function orderWithIssued(quantity: number) {
  const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }], materials: [brakePads] }, WS.A);
  fake.signInAs(USERS.manager.id);
  installIssueFromWarehouseRpc();
  await issueOrderMaterialsFromWarehouse(String(order.id), qty(quantity), "wh-main", `issue-${quantity}`);
  return String(order.id);
}

function stockOf(warehouseId: string) {
  return Number(fake.all("warehouse_stock").find((item) => item.warehouse_id === warehouseId && item.inventory_item_id === "item-a1")?.quantity ?? 0);
}

describe("returnOrderMaterialsToWarehouse", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.member.id);
    row("inventory_items", "item-a1")!.quantity = 20;
    seedWarehouse(WS.A, "wh-main", { "item-a1": 10 });
    seedWarehouse(WS.A, "wh-small", { "item-a1": 2 });
  });

  it("throws MissingRpcError when the SQL is not applied (no silent global fallback)", async () => {
    installIssueFromWarehouseRpc();
    const order = await createOrder({ clientId: "client-a1", clientName: "", device: "Car", services: [{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }], materials: [brakePads] }, WS.A);
    fake.signInAs(USERS.manager.id);
    await issueOrderMaterialsFromWarehouse(String(order.id), qty(2), "wh-main", "pre");
    await expect(returnOrderMaterialsToWarehouse(String(order.id), qty(1), "wh-main", undefined, "r0")).rejects.toBeInstanceOf(MissingRpcError);
    await returnOrderMaterials(String(order.id), qty(1), undefined, "r0-legacy");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(19);
    expect(stockOf("wh-main")).toBe(8);
  });

  it("increases inventory_items.quantity AND warehouse_stock of the chosen warehouse only", async () => {
    installReturnToWarehouseRpc();
    const order = await orderWithIssued(3);
    const movements = await returnOrderMaterialsToWarehouse(order, qty(2), "wh-main", "leftover", "r1");

    expect(movements).toHaveLength(1);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(19);
    expect(stockOf("wh-main")).toBe(9);
    expect(stockOf("wh-small")).toBe(2);
    expect(fake.all("inventory_movements").filter((row) => row.movement_type === "return")[0]).toMatchObject({
      warehouse_id: "wh-main",
      quantity: 2,
      reason: "leftover",
    });
  });

  it("creates a warehouse_stock row when returning to an empty warehouse", async () => {
    installReturnToWarehouseRpc();
    seedWarehouse(WS.A, "wh-empty");
    const order = await orderWithIssued(2);
    await returnOrderMaterialsToWarehouse(order, qty(1), "wh-empty", undefined, "r2");
    expect(stockOf("wh-empty")).toBe(1);
    expect(stockOf("wh-main")).toBe(8);
  });

  it("rejects returning more than outstanding issued without touching stock", async () => {
    installReturnToWarehouseRpc();
    const order = await orderWithIssued(1);
    await expect(returnOrderMaterialsToWarehouse(order, qty(2), "wh-main", undefined, "r3")).rejects.toThrow(/outstanding issued/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(19);
    expect(stockOf("wh-main")).toBe(9);
  });

  it("is idempotent for the same key + warehouse and rejects reuse with another warehouse", async () => {
    installReturnToWarehouseRpc();
    const order = await orderWithIssued(3);
    const first = await returnOrderMaterialsToWarehouse(order, qty(1), "wh-main", undefined, "same");
    const second = await returnOrderMaterialsToWarehouse(order, qty(1), "wh-main", undefined, "same");
    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(stockOf("wh-main")).toBe(8);
    await expect(returnOrderMaterialsToWarehouse(order, qty(1), "wh-small", undefined, "same")).rejects.toThrow(/idempotency key/i);
  });

  it("keeps the permission rule: a plain member cannot return", async () => {
    installReturnToWarehouseRpc();
    const order = await orderWithIssued(1);
    fake.signInAs(USERS.member.id);
    await expect(returnOrderMaterialsToWarehouse(order, qty(1), "wh-main", undefined, "r5")).rejects.toThrow(/permission/i);
  });
});
