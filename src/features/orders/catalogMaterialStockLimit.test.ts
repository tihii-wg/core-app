import { describe, expect, it } from "vitest";
import type { OrderMaterial } from "../../lib/types";
import {
  catalogLineOutstanding,
  catalogLineWarehouseClaim,
  checkCatalogMaterialQuantity,
  issueRequestsExceedingStock,
  maxAllowedCatalogMaterialQuantity,
  otherCatalogLinesWarehouseClaim,
  parseInsufficientStockRpcMessage,
  resolveCatalogLineStockLimit,
} from "./catalogMaterialStockLimit";

function line(partial: Partial<OrderMaterial> & { id: string }): OrderMaterial {
  return {
    itemName: "Pad",
    price: 10,
    quantity: 5,
    quantityIssued: 0,
    quantityReturned: 0,
    supplySource: "catalog",
    inventoryItemId: "item-1",
    warehouseId: "wh-1",
    ...partial,
  };
}

describe("catalogLineOutstanding / claim", () => {
  it("counts already-issued quantity as outstanding (available to this line)", () => {
    expect(catalogLineOutstanding({ quantityIssued: 5, quantityReturned: 0 })).toBe(5);
    expect(catalogLineOutstanding({ quantityIssued: 5, quantityReturned: 2 })).toBe(3);
    expect(catalogLineWarehouseClaim({ quantity: 5, quantityIssued: 5, quantityReturned: 0 })).toBe(0);
    expect(catalogLineWarehouseClaim({ quantity: 8, quantityIssued: 5, quantityReturned: 0 })).toBe(3);
  });
});

describe("maxAllowedCatalogMaterialQuantity", () => {
  it("allows keeping or decreasing a fully issued line when warehouse is empty", () => {
    expect(
      maxAllowedCatalogMaterialQuantity({ warehouseOnHand: 0, lineOutstanding: 5, otherLinesClaim: 0 }),
    ).toBe(5);
  });

  it("requires extra on-hand stock to increase past outstanding", () => {
    expect(
      maxAllowedCatalogMaterialQuantity({ warehouseOnHand: 2, lineOutstanding: 5, otherLinesClaim: 0 }),
    ).toBe(7);
  });

  it("subtracts sibling line claims", () => {
    expect(
      maxAllowedCatalogMaterialQuantity({ warehouseOnHand: 10, lineOutstanding: 0, otherLinesClaim: 4 }),
    ).toBe(6);
  });
});

describe("otherCatalogLinesWarehouseClaim / resolve", () => {
  it("sums duplicate lines of the same item + warehouse", () => {
    const lines = [
      line({ id: "a", quantity: 3, quantityIssued: 0 }),
      line({ id: "b", quantity: 4, quantityIssued: 1, quantityReturned: 0 }),
      line({ id: "c", inventoryItemId: "item-2", quantity: 9 }),
    ];
    // b claims max(0, 4-1) = 3; exclude a → other claim for a is 3
    expect(otherCatalogLinesWarehouseClaim(lines, "item-1", "wh-1", { lineId: "a" })).toBe(3);
  });

  it("resolveCatalogLineStockLimit applies stock + outstanding − siblings", () => {
    const lines = [
      line({ id: "a", quantity: 5, quantityIssued: 5 }),
      line({ id: "b", quantity: 2, quantityIssued: 0 }),
    ];
    const stock = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 3 }];
    const limit = resolveCatalogLineStockLimit({
      line: lines[0]!,
      lines,
      stock,
      exclude: { lineId: "a" },
    });
    // on hand 3 − sibling claim 2 + outstanding 5 = 6
    expect(limit?.max).toBe(6);
  });
});

describe("checkCatalogMaterialQuantity", () => {
  it("allows 5→5 and 5→3; blocks 5→8 when only 2 on hand", () => {
    expect(
      checkCatalogMaterialQuantity({
        desiredQuantity: 5,
        warehouseOnHand: 0,
        lineOutstanding: 5,
      }).ok,
    ).toBe(true);
    expect(
      checkCatalogMaterialQuantity({
        desiredQuantity: 3,
        warehouseOnHand: 0,
        lineOutstanding: 5,
      }).ok,
    ).toBe(true);
    const over = checkCatalogMaterialQuantity({
      desiredQuantity: 8,
      warehouseOnHand: 2,
      lineOutstanding: 5,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.max).toBe(7);
      expect(over.neededFromWarehouse).toBe(3);
    }
  });

  it("blocks zero-stock new lines", () => {
    const check = checkCatalogMaterialQuantity({
      desiredQuantity: 1,
      warehouseOnHand: 0,
      lineOutstanding: 0,
    });
    expect(check.ok).toBe(false);
    expect(check.max).toBe(0);
  });
});

describe("issueRequestsExceedingStock", () => {
  it("sums requests for the same item across lines", () => {
    const stock = [{ warehouseId: "wh-1", inventoryItemId: "item-1", quantity: 4 }];
    const over = issueRequestsExceedingStock(
      [
        { inventoryItemId: "item-1", quantity: 3 },
        { inventoryItemId: "item-1", quantity: 2 },
      ],
      stock,
      "wh-1",
    );
    expect(over).toEqual([{ inventoryItemId: "item-1", available: 4, requested: 5 }]);
  });
});

describe("parseInsufficientStockRpcMessage", () => {
  it("parses order_material:insufficient_stock available/requested", () => {
    expect(
      parseInsufficientStockRpcMessage("order_material:insufficient_stock available=2 requested=5"),
    ).toEqual({ available: 2, requested: 5 });
  });

  it("recognizes legacy insufficient_warehouse_stock", () => {
    expect(parseInsufficientStockRpcMessage("insufficient_warehouse_stock")).toEqual({
      available: undefined,
      requested: undefined,
    });
  });
});
