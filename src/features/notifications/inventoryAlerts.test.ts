import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { buildInventoryAlerts } from "./inventoryAlerts";

function item(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item-1",
    workspaceId: "ws",
    name: "Oil",
    sku: "O-1",
    description: "",
    category: "",
    quantity: 10,
    minQuantity: 5,
    unit: "pcs",
    purchasePrice: 1,
    sellingPrice: 2,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "in_stock",
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("buildInventoryAlerts", () => {
  it("skips items above the minimum threshold", () => {
    expect(buildInventoryAlerts([item({ quantity: 10, minQuantity: 5, stockStatus: "in_stock" })])).toEqual([]);
  });

  it("alerts when quantity equals the minimum", () => {
    const alerts = buildInventoryAlerts([item({ id: "a", quantity: 5, minQuantity: 5, stockStatus: "low_stock" })]);
    expect(alerts).toEqual([
      expect.objectContaining({ id: "low_stock:a", kind: "low_stock", quantity: 5, minQuantity: 5 }),
    ]);
  });

  it("alerts when quantity is below the minimum", () => {
    const alerts = buildInventoryAlerts([item({ id: "b", quantity: 2, minQuantity: 5, stockStatus: "low_stock" })]);
    expect(alerts[0]).toMatchObject({ kind: "low_stock", quantity: 2, minQuantity: 5 });
  });

  it("prioritizes out-of-stock over low-stock and omits inactive items", () => {
    const alerts = buildInventoryAlerts([
      item({ id: "low", name: "Pads", quantity: 1, minQuantity: 5, stockStatus: "low_stock" }),
      item({ id: "out", name: "Filter", quantity: 0, minQuantity: 1, stockStatus: "out_of_stock" }),
      item({ id: "dead", name: "Old", quantity: 0, minQuantity: 1, stockStatus: "out_of_stock", isActive: false }),
    ]);
    expect(alerts.map((alert) => alert.itemId)).toEqual(["out", "low"]);
  });

  it("does not emit low-stock when minQuantity is 0 and quantity is positive", () => {
    expect(
      buildInventoryAlerts([item({ quantity: 2, minQuantity: 0, stockStatus: "in_stock" })]),
    ).toEqual([]);
  });

  it("uses quantity over a stale stockStatus when deciding alerts", () => {
    expect(
      buildInventoryAlerts([item({ id: "stale", quantity: 0, minQuantity: 1, stockStatus: "in_stock" })]),
    ).toEqual([expect.objectContaining({ id: "out_of_stock:stale", kind: "out_of_stock", quantity: 0 })]);
    expect(
      buildInventoryAlerts([item({ id: "ok", quantity: 20, minQuantity: 5, stockStatus: "low_stock" })]),
    ).toEqual([]);
  });

  it("uses stable ids so dismissals do not duplicate for the same item", () => {
    const alerts = buildInventoryAlerts([
      item({ id: "x", quantity: 0, minQuantity: 1, stockStatus: "out_of_stock" }),
      item({ id: "x", quantity: 0, minQuantity: 1, stockStatus: "out_of_stock" }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe("out_of_stock:x");
  });
});
