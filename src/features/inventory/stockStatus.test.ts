import { describe, expect, it } from "vitest";
import { effectiveStockStatus, needsStockAttention, stockStatusFromQuantities } from "./stockStatus";

describe("stockStatusFromQuantities", () => {
  it("marks zero and negative as out of stock", () => {
    expect(stockStatusFromQuantities(0, 5)).toBe("out_of_stock");
    expect(stockStatusFromQuantities(-1, 0)).toBe("out_of_stock");
  });

  it("marks at-or-below minimum as low stock when quantity is positive", () => {
    expect(stockStatusFromQuantities(5, 5)).toBe("low_stock");
    expect(stockStatusFromQuantities(2, 5)).toBe("low_stock");
  });

  it("marks above minimum as in stock", () => {
    expect(stockStatusFromQuantities(6, 5)).toBe("in_stock");
  });

  it("never yields low_stock when minQuantity is 0 (only out at qty <= 0)", () => {
    expect(stockStatusFromQuantities(1, 0)).toBe("in_stock");
    expect(stockStatusFromQuantities(0, 0)).toBe("out_of_stock");
  });
});

describe("effectiveStockStatus", () => {
  it("follows quantity even when stockStatus on the item is stale", () => {
    expect(effectiveStockStatus({ quantity: 0, minQuantity: 5, stockStatus: "in_stock" })).toBe("out_of_stock");
    expect(effectiveStockStatus({ quantity: 5, minQuantity: 5, stockStatus: "in_stock" })).toBe("low_stock");
    expect(effectiveStockStatus({ quantity: 6, minQuantity: 5, stockStatus: "low_stock" })).toBe("in_stock");
  });
});

describe("needsStockAttention", () => {
  it("ignores inactive items", () => {
    expect(
      needsStockAttention({
        isActive: false,
        quantity: 0,
        minQuantity: 1,
        stockStatus: "out_of_stock",
      }),
    ).toBe(false);
  });

  it("flags low and out from quantity, ignoring a stale stockStatus", () => {
    expect(needsStockAttention({ isActive: true, quantity: 2, minQuantity: 5, stockStatus: "in_stock" })).toBe(true);
    expect(needsStockAttention({ isActive: true, quantity: 0, minQuantity: 1, stockStatus: "in_stock" })).toBe(true);
    expect(needsStockAttention({ isActive: true, quantity: 10, minQuantity: 5, stockStatus: "low_stock" })).toBe(false);
  });
});
