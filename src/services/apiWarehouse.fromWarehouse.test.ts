import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrder } from "./apiOrders";
import { issueOrderMaterials, issueOrderMaterialsFromWarehouse } from "./apiWarehouse";
import { MissingRpcError } from "./missingRpc";
import { fake } from "../tests/fakeSupabase";
import { installIssueFromWarehouseRpc, seedWarehouse } from "../tests/orderRpcMocks";
import { seedCoreApp, USERS, WS, row } from "../tests/coreAppDb";

vi.mock("./supabase", async () => ({ default: (await import("../tests/fakeSupabase")).fakeClient }));

const brakePads = { inventoryItemId: "item-a1", itemName: "Alpha brake pads", price: 12, quantity: 5 };
const issue = (quantity: number) => [{ inventoryItemId: "item-a1", quantity }];

async function orderWithMaterials() {
  const order = await createOrder(
    {
      clientId: "client-a1",
      clientName: "",
      device: "Car",
      services: [{ serviceId: "service-a1", serviceName: "Oil change", price: 40, quantity: 1 }],
      materials: [brakePads],
    },
    WS.A,
  );
  fake.signInAs(USERS.manager.id);
  return String(order.id);
}

function stockOf(warehouseId: string) {
  return Number(fake.all("warehouse_stock").find((item) => item.warehouse_id === warehouseId && item.inventory_item_id === "item-a1")?.quantity);
}

describe("issueOrderMaterialsFromWarehouse", () => {
  beforeEach(() => {
    seedCoreApp();
    fake.signInAs(USERS.member.id);
    row("inventory_items", "item-a1")!.quantity = 20;
    seedWarehouse(WS.A, "wh-main", { "item-a1": 10 });
    seedWarehouse(WS.A, "wh-small", { "item-a1": 2 });
  });

  it("throws MissingRpcError when the SQL is not applied so callers can fall back", async () => {
    const order = await orderWithMaterials();
    await expect(issueOrderMaterialsFromWarehouse(order, issue(1), "wh-main", "k0")).rejects.toBeInstanceOf(MissingRpcError);
    // the legacy 3-arg RPC keeps working
    await issueOrderMaterials(order, issue(1), "k0-legacy");
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(19);
    expect(stockOf("wh-main")).toBe(10);
  });

  it("decreases inventory_items.quantity AND warehouse_stock of the chosen warehouse only", async () => {
    installIssueFromWarehouseRpc();
    const order = await orderWithMaterials();
    const movements = await issueOrderMaterialsFromWarehouse(order, issue(3), "wh-main", "k1");

    expect(movements).toHaveLength(1);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(17);
    expect(stockOf("wh-main")).toBe(7);
    expect(stockOf("wh-small")).toBe(2);
    expect(fake.all("inventory_movements")[0]).toMatchObject({ warehouse_id: "wh-main", movement_type: "issue", quantity: 3 });
    expect(fake.all("order_materials").find((line) => line.order_id === order)).toMatchObject({ quantity_issued: 3 });
  });

  it("rejects an issue above the warehouse stock without touching any stock (never negative)", async () => {
    installIssueFromWarehouseRpc();
    const order = await orderWithMaterials();
    await expect(issueOrderMaterialsFromWarehouse(order, issue(3), "wh-small", "k2")).rejects.toThrow(/selected warehouse/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(20);
    expect(stockOf("wh-small")).toBe(2);
    expect(fake.all("inventory_movements")).toHaveLength(0);
  });

  it("treats a warehouse without a stock row as empty", async () => {
    installIssueFromWarehouseRpc();
    seedWarehouse(WS.A, "wh-empty");
    const order = await orderWithMaterials();
    await expect(issueOrderMaterialsFromWarehouse(order, issue(1), "wh-empty", "k3")).rejects.toThrow(/selected warehouse/i);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(20);
  });

  it("rejects a warehouse of another workspace, an inactive one and a deleted one", async () => {
    installIssueFromWarehouseRpc();
    seedWarehouse(WS.B, "wh-other", { "item-a1": 50 });
    seedWarehouse(WS.A, "wh-off", { "item-a1": 50 }, { isActive: false });
    seedWarehouse(WS.A, "wh-del", { "item-a1": 50 }, { deletedAt: "2026-01-01T00:00:00.000Z" });
    const order = await orderWithMaterials();
    for (const id of ["wh-other", "wh-off", "wh-del", "missing"]) {
      await expect(issueOrderMaterialsFromWarehouse(order, issue(1), id, `k-${id}`)).rejects.toThrow(/warehouse was not found|belongs to another/i);
    }
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(20);
  });

  it("is idempotent for the same key + warehouse and rejects reuse with another warehouse", async () => {
    installIssueFromWarehouseRpc();
    const order = await orderWithMaterials();
    const first = await issueOrderMaterialsFromWarehouse(order, issue(2), "wh-main", "same");
    const second = await issueOrderMaterialsFromWarehouse(order, issue(2), "wh-main", "same");
    expect(second.map((m) => m.id)).toEqual(first.map((m) => m.id));
    expect(stockOf("wh-main")).toBe(8);
    expect(Number(row("inventory_items", "item-a1")?.quantity)).toBe(18);

    await expect(issueOrderMaterialsFromWarehouse(order, issue(2), "wh-small", "same")).rejects.toThrow(/idempotency key/i);
  });

  it("keeps the permission rule: a plain member cannot issue", async () => {
    installIssueFromWarehouseRpc();
    const order = await orderWithMaterials();
    fake.signInAs(USERS.member.id);
    await expect(issueOrderMaterialsFromWarehouse(order, issue(1), "wh-main", "k5")).rejects.toThrow(/permission/i);
  });
});
