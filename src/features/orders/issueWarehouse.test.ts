import { describe, expect, it } from "vitest";
import { issueRequestsExceedingStock } from "./catalogMaterialStockLimit";
import { defaultIssueWarehouseId, issuableWarehouses, linesExceedingWarehouseStock, warehouseStockOf } from "./issueWarehouse";

const warehouses = [
  { id: "w-b", isDefault: false, isActive: true },
  { id: "w-off", isDefault: false, isActive: false },
  { id: "w-main", isDefault: true, isActive: true },
];
const stock = [
  { warehouseId: "w-main", inventoryItemId: "i1", quantity: 5 },
  { warehouseId: "w-b", inventoryItemId: "i1", quantity: 1 },
];

describe("issueWarehouse helpers", () => {
  it("lists active warehouses with the default first", () => {
    expect(issuableWarehouses(warehouses).map((w) => w.id)).toEqual(["w-main", "w-b"]);
    expect(issuableWarehouses(undefined)).toEqual([]);
  });

  it("pre-selects the default, then the first active, else empty", () => {
    expect(defaultIssueWarehouseId(warehouses)).toBe("w-main");
    expect(defaultIssueWarehouseId([warehouses[0], warehouses[1]])).toBe("w-b");
    expect(defaultIssueWarehouseId([warehouses[1]])).toBe("");
    expect(defaultIssueWarehouseId(undefined)).toBe("");
  });

  it("reads per-warehouse stock and treats a missing row as zero", () => {
    expect(warehouseStockOf(stock, "w-main", "i1")).toBe(5);
    expect(warehouseStockOf(stock, "w-b", "i1")).toBe(1);
    expect(warehouseStockOf(stock, "w-main", "i2")).toBe(0);
    expect(warehouseStockOf(undefined, "w-main", "i1")).toBe(0);
  });

  it("flags lines above the chosen warehouse stock", () => {
    const lines = [
      { inventoryItemId: "i1", quantity: 3 },
      { inventoryItemId: "i2", quantity: 1 },
    ];
    expect(linesExceedingWarehouseStock(lines, stock, "w-main")).toEqual(["i2"]);
    expect(linesExceedingWarehouseStock(lines, stock, "w-b")).toEqual(["i1", "i2"]);
  });

  it("sums duplicate item issue requests against on-hand stock", () => {
    expect(
      issueRequestsExceedingStock(
        [
          { inventoryItemId: "i1", quantity: 3 },
          { inventoryItemId: "i1", quantity: 3 },
        ],
        stock,
        "w-main",
      ),
    ).toEqual([{ inventoryItemId: "i1", available: 5, requested: 6 }]);
  });
});
