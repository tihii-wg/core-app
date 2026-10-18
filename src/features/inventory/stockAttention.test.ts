import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { stockAttentionSummary } from "./stockAttention";

function item(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item-1",
    workspaceId: "ws-1",
    name: "Pads",
    sku: "P-1",
    description: "",
    category: "Parts",
    quantity: 5,
    minQuantity: 2,
    unit: "pcs",
    purchasePrice: 1,
    sellingPrice: 2,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "in_stock",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  };
}

describe("stockAttentionSummary", () => {
  it("is empty when every active item is in stock", () => {
    expect(stockAttentionSummary([item({ stockStatus: "in_stock", quantity: 10, minQuantity: 2 })])).toEqual({
      items: [],
      lowCount: 0,
      outCount: 0,
      attentionCount: 0,
    });
  });

  it("lists out-of-stock before low-stock and ignores inactive items", () => {
    const out = item({ id: "out", name: "Oil", stockStatus: "out_of_stock", quantity: 0, minQuantity: 1 });
    const low = item({ id: "low", name: "Filter", stockStatus: "low_stock", quantity: 1, minQuantity: 3 });
    const inactiveOut = item({
      id: "old",
      name: "Retired",
      stockStatus: "out_of_stock",
      quantity: 0,
      minQuantity: 1,
      isActive: false,
    });
    const ok = item({ id: "ok", name: "Bolts", stockStatus: "in_stock", quantity: 20, minQuantity: 5 });

    const summary = stockAttentionSummary([low, ok, inactiveOut, out]);

    expect(summary.attentionCount).toBe(2);
    expect(summary.outCount).toBe(1);
    expect(summary.lowCount).toBe(1);
    expect(summary.items.map((row) => row.id)).toEqual(["out", "low"]);
  });

  it("sorts equal status by quantity then name", () => {
    const a = item({ id: "a", name: "Beta", stockStatus: "low_stock", quantity: 1, minQuantity: 5 });
    const b = item({ id: "b", name: "Alpha", stockStatus: "low_stock", quantity: 1, minQuantity: 5 });
    const c = item({ id: "c", name: "Cable", stockStatus: "low_stock", quantity: 2, minQuantity: 5 });

    expect(stockAttentionSummary([c, a, b]).items.map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});
