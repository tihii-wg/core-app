import { describe, expect, it } from "vitest";
import { isMaterialPriceBelowPurchase, materialQuantityStockDelta } from "./materialLineStockDelta";

describe("materialQuantityStockDelta", () => {
  it("issues the quantity difference on increase", () => {
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 5, quantityReturned: 0 }, 7)).toEqual({
      kind: "issue",
      quantity: 2,
    });
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 0, quantityReturned: 0 }, 6)).toEqual({
      kind: "issue",
      quantity: 1,
    });
  });

  it("returns no movement when quantity is unchanged", () => {
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 5, quantityReturned: 0 }, 5)).toEqual({
      kind: "none",
    });
  });

  it("returns excess outstanding on shrink past net-outside", () => {
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 5, quantityReturned: 0 }, 3)).toEqual({
      kind: "return",
      quantity: 2,
    });
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 5, quantityReturned: 2 }, 2)).toEqual({
      kind: "return",
      quantity: 1,
    });
  });

  it("does not move stock when shrinking only unissued remainder", () => {
    expect(materialQuantityStockDelta({ quantity: 5, quantityIssued: 3, quantityReturned: 0 }, 4)).toEqual({
      kind: "none",
    });
  });
});

describe("isMaterialPriceBelowPurchase", () => {
  it("flags unit prices strictly below purchase", () => {
    expect(isMaterialPriceBelowPurchase(9, 10)).toBe(true);
    expect(isMaterialPriceBelowPurchase(10, 10)).toBe(false);
    expect(isMaterialPriceBelowPurchase(11, 10)).toBe(false);
    expect(isMaterialPriceBelowPurchase(9, null)).toBe(false);
    expect(isMaterialPriceBelowPurchase(9, 0)).toBe(false);
  });
});
