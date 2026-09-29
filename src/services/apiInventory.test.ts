import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInventoryItem, getInventoryItems, toInventoryItem } from "./apiInventory";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser },
    from,
  },
}));

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    order: () => chain,
    insert: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject),
  };

  return chain;
}

describe("inventory api", () => {
  beforeEach(() => {
    getUser.mockReset();
    from.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  });

  it("maps a status view row onto an inventory item", () => {
    expect(
      toInventoryItem({
        id: "item-1",
        workspace_id: "ws-1",
        name: "Brake pads",
        sku: "BP-1",
        description: null,
        category: "Parts",
        quantity: "2",
        min_quantity: "5",
        unit: "pcs",
        purchase_price: "4.5",
        selling_price: null,
        supplier: "Acme",
        location: null,
        is_active: true,
        stock_status: "low_stock",
        created_at: "2026-09-27T00:00:00.000Z",
        updated_at: "2026-09-27T00:00:00.000Z",
      }),
    ).toMatchObject({
      id: "item-1",
      workspaceId: "ws-1",
      quantity: 2,
      minQuantity: 5,
      purchasePrice: 4.5,
      sellingPrice: null,
      stockStatus: "low_stock",
    });
  });

  it("returns an empty list when the workspace has no inventory", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const inventory = query({ data: [], error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "inventory_items_with_status") return inventory;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(getInventoryItems(undefined, "all", { field: "name", ascending: true }, "ws-1")).resolves.toEqual([]);
  });

  it("refuses to query without an active workspace", async () => {
    await expect(getInventoryItems(undefined, "all", { field: "name", ascending: true }, undefined)).rejects.toThrow("No active workspace selected");
    expect(from).not.toHaveBeenCalled();
  });

  it("turns a duplicate SKU into a readable error", async () => {
    const profiles = query({ data: { active_workspace_id: "ws-1" }, error: null });
    const inventory = query({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });

    from.mockImplementation((table: string) => {
      if (table === "profiles") return profiles;
      if (table === "inventory_items") return inventory;
      throw new Error(`Unexpected table ${table}`);
    });

    await expect(
      createInventoryItem({
        name: "Brake pads",
        sku: "BP-1",
        description: "",
        category: "",
        quantity: 1,
        minQuantity: 0,
        unit: "pcs",
        purchasePrice: null,
        sellingPrice: null,
        supplier: "",
        location: "",
        isActive: true,
      }, "ws-1"),
    ).rejects.toThrow("An inventory item with this SKU already exists.");
  });
});
