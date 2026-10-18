import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { InventoryItem } from "../../lib/types";
import { syncInventoryItemCaches } from "./syncInventoryCaches";

function item(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item-1",
    workspaceId: "ws-a",
    name: "Pads",
    sku: "AP-1",
    description: "",
    category: "Parts",
    quantity: 2,
    minQuantity: 5,
    unit: "pcs",
    purchasePrice: 10,
    sellingPrice: 12,
    supplier: "",
    location: "",
    isActive: true,
    stockStatus: "low_stock",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...partial,
  };
}

describe("syncInventoryItemCaches", () => {
  it("updates detail and list caches with the new quantity and stockStatus", () => {
    const client = new QueryClient();
    const ws = "ws-a";
    const before = item({ quantity: 2, stockStatus: "low_stock" });
    const after = item({ quantity: 30, stockStatus: "in_stock" });

    client.setQueryData(["inventory", ws, before.id], before);
    client.setQueryData(["inventory", ws, "", "all", "created_at", false], [before]);

    syncInventoryItemCaches(client, ws, after);

    expect(client.getQueryData(["inventory", ws, before.id])).toEqual(after);
    expect(client.getQueryData(["inventory", ws, "", "all", "created_at", false])).toEqual([after]);
  });

  it("does nothing when workspaceId is missing", () => {
    const client = new QueryClient();
    client.setQueryData(["inventory", "ws-a", "item-1"], item({}));
    syncInventoryItemCaches(client, undefined, item({ quantity: 99, stockStatus: "in_stock" }));
    expect(client.getQueryData<InventoryItem>(["inventory", "ws-a", "item-1"])?.quantity).toBe(2);
  });
});
