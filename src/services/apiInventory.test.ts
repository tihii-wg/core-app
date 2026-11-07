import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInventoryItem,
  distinctSupplierNames,
  getInventoryItemDeletePreview,
  getInventoryItems,
  getInventorySuppliers,
  purgeInventoryItem,
  toInventoryItem,
  toInventoryItemDeletePreview,
  toPurgeInventoryItemResult,
} from "./apiInventory";
import { MissingRpcError } from "./missingRpc";

const getUser = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser },
    from,
    rpc,
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

function recordingQuery(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "not"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

describe("inventory suppliers", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("normalizes supplier names: trims, drops empties/nulls, dedupes, sorts", () => {
    expect(distinctSupplierNames([" Beta ", "Acme", "", null, undefined, "Acme", "  ", "Beta"])).toEqual(["Acme", "Beta"]);
    expect(distinctSupplierNames([null, ""])).toEqual([]);
  });

  it("applies the supplier filter as an equality clause scoped to the workspace", async () => {
    const { chain, calls } = recordingQuery({ data: [], error: null });
    from.mockReturnValue(chain);

    await getInventoryItems(undefined, "all", { field: "name", ascending: true }, "ws-1", "Acme");

    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["supplier", "Acme"] });
  });

  it("does not add a supplier clause for 'all' or an empty supplier", async () => {
    for (const supplier of ["all", "", undefined]) {
      const { chain, calls } = recordingQuery({ data: [], error: null });
      from.mockReturnValue(chain);
      await getInventoryItems(undefined, "all", { field: "name", ascending: true }, "ws-1", supplier);
      expect(calls.some((call) => call.method === "eq" && call.args[0] === "supplier")).toBe(false);
    }
  });

  it("combines supplier with search and stock-status filters", async () => {
    const { chain, calls } = recordingQuery({ data: [], error: null });
    from.mockReturnValue(chain);

    await getInventoryItems("brake", "low_stock", { field: "name", ascending: true }, "ws-1", "Acme");

    expect(calls.some((call) => call.method === "or")).toBe(true);
    expect(calls).toContainEqual({ method: "eq", args: ["is_active", true] });
    expect(calls).toContainEqual({ method: "eq", args: ["stock_status", "low_stock"] });
    expect(calls).toContainEqual({ method: "eq", args: ["supplier", "Acme"] });
  });

  it("filter 'active' shows active parts only", async () => {
    const { chain, calls } = recordingQuery({ data: [], error: null });
    from.mockReturnValue(chain);

    await getInventoryItems(undefined, "active", { field: "name", ascending: true }, "ws-1");

    expect(calls).toContainEqual({ method: "eq", args: ["is_active", true] });
    expect(calls.some((call) => call.method === "eq" && call.args[0] === "stock_status")).toBe(false);
  });

  it("filter 'all' does not constrain is_active (orders, warehouses and reports need inactive parts)", async () => {
    const { chain, calls } = recordingQuery({ data: [], error: null });
    from.mockReturnValue(chain);

    await getInventoryItems(undefined, "all", { field: "name", ascending: true }, "ws-1");

    expect(calls.some((call) => call.method === "eq" && call.args[0] === "is_active")).toBe(false);
  });

  it("filter 'inactive' shows inactive parts only", async () => {
    const { chain, calls } = recordingQuery({ data: [], error: null });
    from.mockReturnValue(chain);

    await getInventoryItems(undefined, "inactive", { field: "name", ascending: true }, "ws-1");

    expect(calls).toContainEqual({ method: "eq", args: ["is_active", false] });
  });

  it("loads distinct suppliers for the workspace, ignoring missing values", async () => {
    const { chain, calls } = recordingQuery({
      data: [{ supplier: "Beta" }, { supplier: "Acme" }, { supplier: "Beta" }, { supplier: null }, { supplier: "  " }],
      error: null,
    });
    from.mockReturnValue(chain);

    await expect(getInventorySuppliers("ws-1")).resolves.toEqual(["Acme", "Beta"]);
    expect(calls).toContainEqual({ method: "eq", args: ["workspace_id", "ws-1"] });
  });

  it("refuses to load suppliers without a workspace", async () => {
    await expect(getInventorySuppliers(undefined)).rejects.toThrow("No active workspace selected");
    expect(from).not.toHaveBeenCalled();
  });
});

describe("inventory item purge RPCs", () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it("maps preview jsonb to camelCase including blocking orders", () => {
    expect(
      toInventoryItemDeletePreview({
        item_id: "item-1",
        item_name: "Pads",
        is_owner: true,
        can_delete: false,
        blocking_orders: [{ order_id: "o1", number: "ORD-1", status: "in-progress" }],
        cancelled_orders_count: 2,
        stock_quantity: "3.5",
        movements_count: 4,
        stock_rows_count: 1,
        batches_count: 0,
        serials_count: 1,
        reservations_count: 0,
        draft_document_lines_count: 2,
        posted_document_lines_count: 5,
      }),
    ).toEqual({
      itemId: "item-1",
      itemName: "Pads",
      isOwner: true,
      canDelete: false,
      blockingOrders: [{ orderId: "o1", number: "ORD-1", status: "in-progress" }],
      cancelledOrdersCount: 2,
      stockQuantity: 3.5,
      movementsCount: 4,
      stockRowsCount: 1,
      batchesCount: 0,
      serialsCount: 1,
      reservationsCount: 0,
      draftDocumentLinesCount: 2,
      postedDocumentLinesCount: 5,
    });
  });

  it("maps purge jsonb to camelCase", () => {
    expect(
      toPurgeInventoryItemResult({
        item_id: "item-1",
        deleted: true,
        detached_cancelled_order_lines: 1,
        deleted_movements: 3,
        deleted_stock_rows: 2,
        deleted_draft_document_lines: 4,
      }),
    ).toEqual({
      itemId: "item-1",
      deleted: true,
      detachedCancelledOrderLines: 1,
      deletedMovements: 3,
      deletedStockRows: 2,
      deletedDraftDocumentLines: 4,
    });
  });

  it("calls the preview RPC and returns the mapped preview", async () => {
    rpc.mockResolvedValue({
      data: {
        item_id: "item-1",
        item_name: "Pads",
        is_owner: true,
        can_delete: true,
        blocking_orders: [],
        cancelled_orders_count: 0,
        stock_quantity: 0,
        movements_count: 1,
        stock_rows_count: 0,
        batches_count: 0,
        serials_count: 0,
        reservations_count: 0,
        draft_document_lines_count: 0,
        posted_document_lines_count: 0,
      },
      error: null,
    });

    await expect(getInventoryItemDeletePreview("item-1", "ws-1")).resolves.toMatchObject({
      itemId: "item-1",
      canDelete: true,
      movementsCount: 1,
    });
    expect(rpc).toHaveBeenCalledWith("crm_inventory_item_delete_preview", { p_item_id: "item-1" });
  });

  it("maps used_in_orders with order numbers from error.details", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "inventory_item_purge:used_in_orders", details: "ORD-1, ORD-2" },
    });
    await expect(purgeInventoryItem("item-1", "ws-1")).rejects.toThrow(/ORD-1, ORD-2/);
  });

  it("maps owner_only and not_found purge errors", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "inventory_item_purge:owner_only" },
    });
    await expect(purgeInventoryItem("item-1", "ws-1")).rejects.toThrow(/workspace owner/i);

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "inventory_item_purge:not_found" },
    });
    await expect(purgeInventoryItem("item-1", "ws-1")).rejects.toThrow(/not found/i);
  });

  it("throws MissingRpcError when the preview RPC is not installed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function crm_inventory_item_delete_preview" },
    });
    await expect(getInventoryItemDeletePreview("item-1", "ws-1")).rejects.toBeInstanceOf(MissingRpcError);
  });

  it("throws MissingRpcError when the purge RPC is not installed", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function crm_purge_inventory_item" },
    });
    await expect(purgeInventoryItem("item-1", "ws-1")).rejects.toBeInstanceOf(MissingRpcError);
  });
});

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

  it("derives stockStatus from quantity even when stock_status on the row is stale", () => {
    expect(
      toInventoryItem({
        id: "item-1",
        workspace_id: "ws-1",
        name: "Oil",
        sku: "OIL-1",
        quantity: 0,
        min_quantity: 5,
        unit: "pcs",
        is_active: true,
        stock_status: "in_stock",
      }),
    ).toMatchObject({ quantity: 0, stockStatus: "out_of_stock" });

    expect(
      toInventoryItem({
        id: "item-2",
        workspace_id: "ws-1",
        name: "Filter",
        sku: "F-1",
        quantity: 10,
        min_quantity: 2,
        unit: "pcs",
        is_active: true,
        stock_status: "low_stock",
      }),
    ).toMatchObject({ quantity: 10, stockStatus: "in_stock" });
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
