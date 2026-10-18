import { describe, expect, it } from "vitest";
import {
  catalogItemToOrderMaterial,
  consolidateOrderMaterials,
  normalizeOrderMaterialQuantity,
  parseOrderMaterialQuantity,
  sumOrderMaterialLines,
} from "./orderMaterialLine";

describe("orderMaterialLine", () => {
  it("snapshots selling price and consolidates duplicate inventory items", () => {
    const line = catalogItemToOrderMaterial({ id: "item-1", name: "Pads", sellingPrice: 12 }, 2);
    expect(line).toEqual({ inventoryItemId: "item-1", itemName: "Pads", price: 12, quantity: 2 });

    expect(
      consolidateOrderMaterials([
        { inventoryItemId: "item-1", itemName: "Pads", price: 12, quantity: 2 },
        { inventoryItemId: "item-1", itemName: "Pads", price: 12, quantity: 3 },
      ]),
    ).toEqual([{ inventoryItemId: "item-1", itemName: "Pads", price: 12, quantity: 5 }]);

    expect(sumOrderMaterialLines([{ price: 12, quantity: 2 }, { price: 8, quantity: 1 }])).toBe(32);
  });

  it("treats a missing selling price as zero", () => {
    expect(catalogItemToOrderMaterial({ id: "item-2", name: "Filter", sellingPrice: null }).price).toBe(0);
  });

  it("accepts positive integers only and does not round fractions", () => {
    expect(parseOrderMaterialQuantity(3)).toBe(3);
    expect(parseOrderMaterialQuantity("7")).toBe(7);
    expect(parseOrderMaterialQuantity(1.0)).toBe(1);

    expect(parseOrderMaterialQuantity("")).toBeNull();
    expect(parseOrderMaterialQuantity("   ")).toBeNull();
    expect(parseOrderMaterialQuantity(null)).toBeNull();
    expect(parseOrderMaterialQuantity(undefined)).toBeNull();
    expect(parseOrderMaterialQuantity("abc")).toBeNull();
    expect(parseOrderMaterialQuantity(0)).toBeNull();
    expect(parseOrderMaterialQuantity(-1)).toBeNull();
    expect(parseOrderMaterialQuantity(1.4)).toBeNull();
    expect(parseOrderMaterialQuantity(1.5)).toBeNull();
    expect(parseOrderMaterialQuantity("1.4")).toBeNull();
    expect(parseOrderMaterialQuantity("1.5")).toBeNull();

    expect(normalizeOrderMaterialQuantity(1.4)).toBe(0);
    expect(normalizeOrderMaterialQuantity(2)).toBe(2);
  });

  it("drops invalid quantities when consolidating instead of inventing values", () => {
    expect(
      consolidateOrderMaterials([
        { inventoryItemId: "item-3", itemName: "Oil", price: 10, quantity: 1.4 },
        { inventoryItemId: "item-3", itemName: "Oil", price: 10, quantity: 1.5 },
        { inventoryItemId: "item-3", itemName: "Oil", price: 10, quantity: 0 },
        { inventoryItemId: "item-4", itemName: "Filter", price: 5, quantity: 2 },
      ]),
    ).toEqual([{ inventoryItemId: "item-4", itemName: "Filter", price: 5, quantity: 2 }]);

    expect(sumOrderMaterialLines([{ price: 10, quantity: 1.5 }, { price: 5, quantity: 2 }])).toBe(10);
  });

  it("rejects non-integer quantities when creating a catalog line", () => {
    expect(() => catalogItemToOrderMaterial({ id: "item-3", name: "Oil", sellingPrice: 10 }, 1.4)).toThrow(/positive whole number/i);
    expect(() => catalogItemToOrderMaterial({ id: "item-3", name: "Oil", sellingPrice: 10 }, 0)).toThrow(/positive whole number/i);
  });
});
