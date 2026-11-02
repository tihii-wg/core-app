import { describe, expect, it } from "vitest";
import {
  catalogItemToOrderMaterial,
  consolidateOrderMaterials,
  freeformOrderMaterial,
  isCatalogOrderMaterial,
  resolveMaterialSupplySource,
} from "./orderMaterialLine";

describe("order material freeform / catalog helpers", () => {
  it("builds catalog and freeform lines", () => {
    expect(catalogItemToOrderMaterial({ id: "i1", name: "Pad", sellingPrice: 12 }, 2)).toMatchObject({
      inventoryItemId: "i1",
      supplySource: "catalog",
      quantity: 2,
      price: 12,
    });
    expect(freeformOrderMaterial({ itemName: " Special ", price: 5, quantity: 1, supplySource: "one_time" })).toMatchObject({
      itemName: "Special",
      supplySource: "one_time",
      price: 5,
    });
    expect(isCatalogOrderMaterial({ inventoryItemId: "i1", supplySource: "catalog" })).toBe(true);
    expect(isCatalogOrderMaterial({ supplySource: "customer" })).toBe(false);
  });

  it("consolidates catalog ids but keeps freeform lines separate", () => {
    const result = consolidateOrderMaterials([
      { inventoryItemId: "i1", itemName: "A", price: 1, quantity: 1, supplySource: "catalog" },
      { inventoryItemId: "i1", itemName: "A", price: 1, quantity: 2, supplySource: "catalog" },
      { itemName: "One-off", price: 9, quantity: 1, supplySource: "one_time" },
      { itemName: "Cust", price: 0, quantity: 1, supplySource: "customer" },
    ]);
    expect(result).toHaveLength(3);
    expect(result.find((line) => line.inventoryItemId === "i1")?.quantity).toBe(3);
    expect(resolveMaterialSupplySource({ supplySource: "customer" })).toBe("customer");
  });
});
