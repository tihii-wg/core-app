import { describe, expect, it } from "vitest";
import {
  assignCreatedItemToOpLines,
  hasValidQtyPrecision,
  lineAmount,
  parseDecimalInput,
  previewStockAfter,
  roundQty,
  stockByItemForWarehouse,
  sumLineAmounts,
  totalsByItem,
  validateOpLines,
  type OpDraftLine,
  type OpLineInput,
} from "./warehouseOps";

const line = (overrides: Partial<OpLineInput> = {}): OpLineInput => ({
  inventoryItemId: "item-1",
  itemName: "Oil filter",
  quantity: 2,
  unitCost: 10,
  ...overrides,
});

describe("quantity math", () => {
  it("rounds to 2 decimals without float drift", () => {
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
    expect(roundQty(1.005)).toBe(1.01);
  });

  it("computes line amounts and totals in cents", () => {
    expect(lineAmount(3, 0.1)).toBe(0.3);
    expect(lineAmount(1.5, 19.99)).toBe(29.99);
    expect(sumLineAmounts([line({ quantity: 3, unitCost: 0.1 }), line({ quantity: 1, unitCost: 0.2 })])).toBe(0.5);
  });

  it("parses decimal input with comma or dot", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput(" 2.25 ")).toBe(2.25);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
  });

  it("detects more than 2 decimals", () => {
    expect(hasValidQtyPrecision(1.25)).toBe(true);
    expect(hasValidQtyPrecision(1.255)).toBe(false);
  });

  it("sums repeated items", () => {
    const totals = totalsByItem([
      { inventoryItemId: "a", quantity: 1.1 },
      { inventoryItemId: "a", quantity: 2.2 },
      { inventoryItemId: "b", quantity: 1 },
    ]);
    expect(totals.get("a")).toBe(3.3);
    expect(totals.get("b")).toBe(1);
  });
});

describe("validateOpLines", () => {
  it("rejects empty drafts and bad lines", () => {
    expect(validateOpLines("receipt", [])).toEqual({ code: "noLines" });
    expect(validateOpLines("receipt", [line({ inventoryItemId: "" })])).toEqual({ code: "noItem", index: 0 });
    expect(validateOpLines("receipt", [line({ quantity: 0 })])).toEqual({ code: "quantityPositive", index: 0 });
    expect(validateOpLines("receipt", [line({ quantity: 1.234 })])).toEqual({ code: "quantityPrecision", index: 0 });
    expect(validateOpLines("receipt", [line(), line({ unitCost: -1 })])).toEqual({ code: "costNegative", index: 1 });
  });

  it("does not need stock for receipts", () => {
    expect(validateOpLines("receipt", [line({ quantity: 999 })], new Map())).toBeNull();
  });

  it("checks the per-item total against source stock for transfers and write-offs", () => {
    const available = new Map([["item-1", 3]]);
    expect(validateOpLines("transfer", [line({ quantity: 3 })], available)).toBeNull();
    expect(validateOpLines("writeOff", [line({ quantity: 2 }), line({ quantity: 2 })], available)).toEqual({
      code: "insufficientStock",
      index: 0,
      inventoryItemId: "item-1",
      available: 3,
      requested: 4,
    });
    expect(validateOpLines("transfer", [line()], new Map())).toMatchObject({ code: "insufficientStock", available: 0 });
  });
});

describe("stockByItemForWarehouse", () => {
  it("filters by warehouse", () => {
    const map = stockByItemForWarehouse(
      [
        { warehouseId: "w1", inventoryItemId: "a", quantity: 5 },
        { warehouseId: "w2", inventoryItemId: "a", quantity: 7 },
      ],
      "w1",
    );
    expect(map.get("a")).toBe(5);
  });
});

describe("previewStockAfter", () => {
  const current = { from: 10, to: 4, total: 14 };

  it("receipt adds to destination and total", () => {
    expect(previewStockAfter("receipt", current, 3)).toEqual({ from: 10, to: 7, total: 17 });
  });

  it("transfer moves stock and keeps the total", () => {
    expect(previewStockAfter("transfer", current, 3)).toEqual({ from: 7, to: 7, total: 14 });
  });

  it("write-off reduces source and total", () => {
    expect(previewStockAfter("writeOff", current, 3)).toEqual({ from: 7, to: 4, total: 11 });
    expect(previewStockAfter("supplierReturn", current, 3)).toEqual({ from: 7, to: 4, total: 11 });
  });
});

describe("assignCreatedItemToOpLines", () => {
  let nextKey = 100;
  const makeLine = (): OpDraftLine => ({ key: ++nextKey, itemId: "", quantity: "", unitCost: "" });

  it("fills the first empty line without adding a duplicate row", () => {
    const lines: OpDraftLine[] = [
      { key: 1, itemId: "", quantity: "", unitCost: "" },
      { key: 2, itemId: "existing", quantity: "2", unitCost: "5" },
    ];
    expect(assignCreatedItemToOpLines(lines, "new", "12", makeLine)).toEqual([
      { key: 1, itemId: "new", quantity: "", unitCost: "12" },
      { key: 2, itemId: "existing", quantity: "2", unitCost: "5" },
    ]);
  });

  it("appends a line when every line already has an item", () => {
    const lines: OpDraftLine[] = [{ key: 1, itemId: "a", quantity: "1", unitCost: "3" }];
    const result = assignCreatedItemToOpLines(lines, "b", "9", makeLine);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(lines[0]);
    expect(result[1]).toMatchObject({ itemId: "b", unitCost: "9", quantity: "" });
  });

  it("does not add a second line for an item already selected", () => {
    const lines: OpDraftLine[] = [{ key: 1, itemId: "a", quantity: "1", unitCost: "3" }];
    expect(assignCreatedItemToOpLines(lines, "a", "99", makeLine)).toBe(lines);
  });
});
