import { describe, expect, it } from "vitest";
import {
  catalogItemToOrderMaterial,
  consolidateOrderMaterials,
  freeformOrderMaterial,
  isCatalogOrderMaterial,
  orderMaterialsMatch,
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

  it("copies catalog duration and mileage warranty defaults onto new order lines", () => {
    expect(
      catalogItemToOrderMaterial({
        id: "i1",
        name: "Pad",
        sellingPrice: 12,
        warrantyType: "duration",
        warrantyMonths: 12,
        warrantyKm: null,
      }),
    ).toMatchObject({ warrantyMonths: 12, warrantyKm: null });
    expect(
      catalogItemToOrderMaterial({
        id: "i2",
        name: "Belt",
        sellingPrice: 40,
        warrantyType: "mileage",
        warrantyMonths: null,
        warrantyKm: 20000,
      }),
    ).toMatchObject({ warrantyMonths: null, warrantyKm: 20000 });
    expect(
      catalogItemToOrderMaterial({
        id: "i3",
        name: "Kit",
        sellingPrice: 80,
        warrantyType: "both",
        warrantyMonths: 24,
        warrantyKm: 30000,
      }),
    ).toMatchObject({ warrantyMonths: 24, warrantyKm: 30000 });
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

  it("preserves warranty fields through consolidation", () => {
    const result = consolidateOrderMaterials([
      {
        inventoryItemId: "i1",
        itemName: "Pad",
        price: 12,
        quantity: 1,
        supplySource: "catalog",
        warrantyMonths: 24,
        warrantyKm: 30000,
      },
      { itemName: "Gasket", price: 5, quantity: 1, supplySource: "one_time", warrantyDays: 15 },
    ]);
    expect(result.find((line) => line.inventoryItemId === "i1")).toMatchObject({
      warrantyMonths: 24,
      warrantyKm: 30000,
    });
    expect(result.find((line) => line.itemName === "Gasket")).toMatchObject({ warrantyDays: 15 });
  });

  it("detects equivalent material sets for sync-skip", () => {
    const a = [{ inventoryItemId: "i1", itemName: "A", price: 1, quantity: 2, supplySource: "catalog" as const }];
    const b = [{ inventoryItemId: "i1", itemName: "Renamed", price: 99, quantity: 2, supplySource: "catalog" as const }];
    const c = [{ inventoryItemId: "i1", itemName: "A", price: 1, quantity: 3, supplySource: "catalog" as const }];
    expect(orderMaterialsMatch(a, b)).toBe(true);
    expect(orderMaterialsMatch(a, c)).toBe(false);
  });

  it("treats warranty changes as material-set differences so they are persisted", () => {
    const base = {
      inventoryItemId: "i1",
      itemName: "A",
      price: 1,
      quantity: 2,
      supplySource: "catalog" as const,
      warrantyMonths: 12,
      warrantyKm: null as number | null,
    };
    expect(orderMaterialsMatch([base], [{ ...base, warrantyMonths: 24 }])).toBe(false);
    expect(orderMaterialsMatch([base], [{ ...base, warrantyKm: 10000 }])).toBe(false);
    expect(orderMaterialsMatch([base], [{ ...base }])).toBe(true);
  });
});
