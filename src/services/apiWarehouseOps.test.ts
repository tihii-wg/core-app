import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanRpcMessage,
  createAndPostGoodsReceipt,
  createGoodsReceipt,
  escapeLikePattern,
  getGoodsReceipts,
  getSupplierDeliveries,
  isMissingRpcError,
  mapWarehouseOpsError,
  postGoodsReceipt,
  toWarehouseOp,
} from "./apiWarehouseOps";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({ default: { from, rpc } }));

type Result = { data: unknown; error: { message?: string; code?: string; details?: string; hint?: string } | null };

function chain(result: Result) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "in", "insert", "delete", "single", "ilike"]) {
    self[method] = () => self;
  }
  self.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return self;
}

describe("apiWarehouseOps", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("recognises a missing RPC", () => {
    expect(isMissingRpcError({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpcError({ code: "42883" })).toBe(true);
    expect(isMissingRpcError({ message: "Could not find the function public.crm_post_goods_receipt" })).toBe(true);
    expect(isMissingRpcError({ code: "42501" })).toBe(false);
  });

  it("maps errors to localized copy and strips the RPC prefix", () => {
    expect(mapWarehouseOpsError({ code: "PGRST202" }, "inventory.ops.errors.postFailed").message).toMatch(/20261101030000_warehouse_ops_rpcs/);
    expect(mapWarehouseOpsError({ code: "42501" }, "inventory.ops.errors.postFailed").message).toMatch(/permission/i);
    expect(mapWarehouseOpsError({ code: "55000" }, "inventory.ops.errors.postFailed").message).toMatch(/already posted/i);
    expect(mapWarehouseOpsError({ code: "XX000" }, "inventory.ops.errors.postFailed").message).toMatch(/could not post/i);
    expect(cleanRpcMessage("crm_post_write_off: insufficient stock")).toBe("insufficient stock");
  });

  it("derives posted state from status (receipts) or posted_at (transfers, write-offs)", () => {
    const base = { id: "1", workspace_id: "w", created_at: "2026-11-01T00:00:00Z" };
    expect(toWarehouseOp("receipt", { ...base, status: "draft" }, [])).toMatchObject({ posted: false, status: "draft" });
    expect(toWarehouseOp("receipt", { ...base, status: "posted" }, [])).toMatchObject({ posted: true });
    expect(toWarehouseOp("transfer", { ...base, posted_at: null }, [])).toMatchObject({ posted: false });
    expect(toWarehouseOp("writeOff", { ...base, posted_at: "2026-11-01T01:00:00Z" }, [])).toMatchObject({ posted: true });
    // Column missing (SQL not applied yet) behaves as draft, never as posted.
    expect(toWarehouseOp("transfer", base, [])).toMatchObject({ posted: false });
  });

  it("degrades to unavailable when the table is missing", async () => {
    from.mockReturnValue(chain({ data: null, error: { code: "PGRST205", message: "no table" } }));
    await expect(getGoodsReceipts("ws")).resolves.toEqual({ available: false, rows: [] });
  });

  it("calls the posting RPC and surfaces a missing function as a pointer to the SQL file", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await postGoodsReceipt("r1");
    expect(rpc).toHaveBeenCalledWith("crm_post_goods_receipt", { p_receipt_id: "r1" });

    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    await expect(postGoodsReceipt("r1")).rejects.toThrow(/20261101030000_warehouse_ops_rpcs/);
  });

  it("creates receipts as drafts and never writes stock or item quantities", async () => {
    const insert = vi.fn();
    const result = chain({ data: { id: "r1" }, error: null });
    from.mockImplementation((table: string) => ({
      insert: (payload: unknown) => {
        insert(table, payload);
        return result;
      },
    }));

    await createGoodsReceipt(
      { warehouseId: "wh", lines: [{ inventoryItemId: "i1", itemName: "Filter", quantity: 2, unitCost: 10.5 }] },
      "ws",
    );

    const tables = insert.mock.calls.map(([table]) => table);
    expect(tables).toEqual(["goods_receipts", "goods_receipt_lines"]);
    expect(insert.mock.calls[0][1]).toMatchObject({
      status: "draft",
      workspace_id: "ws",
      warehouse_id: "wh",
      total: 21,
      supplier_name: null,
    });
    expect(insert.mock.calls[1][1]).toEqual([
      expect.objectContaining({ goods_receipt_id: "r1", inventory_item_id: "i1", quantity: 2, unit_cost: 10.5, amount: 21 }),
    ]);
    expect(from).not.toHaveBeenCalledWith("warehouse_stock");
    expect(from).not.toHaveBeenCalledWith("inventory_items");
  });

  it("persists trimmed supplier_name on receipt create", async () => {
    const insert = vi.fn();
    const result = chain({ data: { id: "r3" }, error: null });
    from.mockImplementation((table: string) => ({
      insert: (payload: unknown) => {
        insert(table, payload);
        return result;
      },
    }));

    await createGoodsReceipt(
      {
        warehouseId: "wh",
        supplierName: "  Acme Parts  ",
        lines: [{ inventoryItemId: "i1", itemName: "Filter", quantity: 1, unitCost: 4 }],
      },
      "ws",
    );

    expect(insert.mock.calls[0][1]).toMatchObject({ supplier_name: "Acme Parts", status: "draft" });
  });

  it("retries receipt insert without supplier_name when the column is missing", async () => {
    const insert = vi.fn();
    let attempts = 0;
    from.mockImplementation((table: string) => ({
      insert: (payload: unknown) => {
        insert(table, payload);
        attempts += 1;
        if (table === "goods_receipts" && attempts === 1) {
          return chain({
            data: null,
            error: { code: "PGRST204", message: "Could not find the 'supplier_name' column of 'goods_receipts' in the schema cache" },
          });
        }
        return chain({ data: { id: "r4" }, error: null });
      },
    }));

    await createGoodsReceipt(
      {
        warehouseId: "wh",
        supplierName: "Acme",
        lines: [{ inventoryItemId: "i1", itemName: "Filter", quantity: 1, unitCost: 4 }],
      },
      "ws",
    );

    const receiptInserts = insert.mock.calls.filter(([table]) => table === "goods_receipts");
    expect(receiptInserts).toHaveLength(2);
    expect(receiptInserts[0][1]).toMatchObject({ supplier_name: "Acme" });
    expect(receiptInserts[1][1]).not.toHaveProperty("supplier_name");
    expect(insert.mock.calls.some(([table]) => table === "goods_receipt_lines")).toBe(true);
  });

  it("escapeLikePattern escapes backslash, percent, and underscore", () => {
    expect(escapeLikePattern("Acme_Parts%Co\\Ltd")).toBe("Acme\\_Parts\\%Co\\\\Ltd");
    expect(escapeLikePattern("plain")).toBe("plain");
  });

  function mockSupplierDeliveryQueries(options: {
    exactDocs: Record<string, unknown>[];
    legacyDocs?: Record<string, unknown>[];
    itemIds?: string[];
    onHydrateIn?: (ids: string[]) => void;
    onIlke?: (column: string, pattern: string) => void;
  }) {
    const legacyDocs = options.legacyDocs ?? [];
    const itemIds = options.itemIds ?? (legacyDocs.length > 0 ? ["i1"] : []);
    const hydrateIns: string[][] = [];

    from.mockImplementation((table: string) => {
      if (table === "goods_receipts") {
        let sawIlke = false;
        let sawNullSupplier = false;
        const self: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order", "limit"]) self[method] = () => self;
        self.is = (column: string, value: unknown) => {
          if (column === "supplier_name" && value === null) sawNullSupplier = true;
          return self;
        };
        self.ilike = (column: string, pattern: string) => {
          sawIlke = true;
          options.onIlke?.(column, pattern);
          return self;
        };
        self.in = () => self;
        self.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) => {
          const data = sawNullSupplier ? legacyDocs : sawIlke ? options.exactDocs : [];
          return Promise.resolve({ data, error: null } satisfies Result).then(onFulfilled, onRejected);
        };
        return self;
      }
      if (table === "inventory_items") {
        const self: Record<string, unknown> = {};
        for (const method of ["select", "eq", "in", "order"]) self[method] = () => self;
        self.ilike = (column: string, pattern: string) => {
          options.onIlke?.(column, pattern);
          return self;
        };
        self.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: itemIds.map((id) => ({ id })), error: null } satisfies Result).then(
            onFulfilled,
            onRejected,
          );
        return self;
      }
      if (table === "goods_receipt_lines") {
        let selectingIdsOnly = false;
        let hydrateIds: string[] = [];
        const self: Record<string, unknown> = {};
        for (const method of ["eq", "order", "limit"]) self[method] = () => self;
        self.select = (cols: string) => {
          selectingIdsOnly = cols === "goods_receipt_id";
          return self;
        };
        self.in = (_col: string, ids: string[]) => {
          if (!selectingIdsOnly) {
            hydrateIds = ids;
            hydrateIns.push(ids);
            options.onHydrateIn?.(ids);
          }
          return self;
        };
        self.then = (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) => {
          if (selectingIdsOnly) {
            return Promise.resolve({
              data: [
                ...legacyDocs.map((doc) => ({ goods_receipt_id: doc.id })),
                ...options.exactDocs.map((doc) => ({ goods_receipt_id: doc.id })),
              ],
              error: null,
            } satisfies Result).then(onFulfilled, onRejected);
          }
          const allDocs = [...options.exactDocs, ...legacyDocs];
          const data = hydrateIds.flatMap((id, index) => {
            const doc = allDocs.find((candidate) => String(candidate.id) === id);
            if (!doc) return [];
            return [
              {
                id: `l-${id}`,
                goods_receipt_id: id,
                inventory_item_id: "i1",
                item_name: "Pad",
                quantity: 1,
                unit_cost: toNum(doc.total) || 1,
                amount: toNum(doc.total) || 1,
                position: index,
              },
            ];
          });
          return Promise.resolve({ data, error: null } satisfies Result).then(onFulfilled, onRejected);
        };
        return self;
      }
      return chain({ data: [], error: null });
    });

    return { hydrateIns };
  }

  function toNum(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  it("getSupplierDeliveries merges exact supplier_name matches with legacy item fallback without duplicates", async () => {
    const exactDoc = {
      id: "r-exact",
      workspace_id: "ws",
      warehouse_id: "wh",
      status: "posted",
      number: "GR-1",
      comment: null,
      total: 10,
      created_at: "2026-11-02T00:00:00Z",
      received_at: "2026-11-02T00:00:00Z",
      supplier_name: "Acme",
      deleted_at: null,
    };
    const legacyDoc = {
      id: "r-legacy",
      workspace_id: "ws",
      warehouse_id: "wh",
      status: "posted",
      number: "GR-2",
      comment: null,
      total: 20,
      created_at: "2026-11-01T00:00:00Z",
      received_at: "2026-11-01T00:00:00Z",
      supplier_name: null,
      deleted_at: null,
    };

    mockSupplierDeliveryQueries({ exactDocs: [exactDoc], legacyDocs: [legacyDoc] });

    const page = await getSupplierDeliveries("ws", "Acme");
    expect(page.rows.map((row) => row.id)).toEqual(["r-exact", "r-legacy"]);
    expect(page.rows[0]).toMatchObject({ supplierName: "Acme", matchedByLegacy: false });
    expect(page.rows[1]).toMatchObject({ supplierName: null, matchedByLegacy: true });
    expect(page.hasMore).toBe(false);
    expect(page).toMatchObject({
      totalCount: 2,
      postedTotal: 30,
      lastDeliveryAt: "2026-11-02T00:00:00Z",
    });
  });

  it("getSupplierDeliveries escapes LIKE wildcards in supplier ilike filters", async () => {
    const patterns: string[] = [];
    mockSupplierDeliveryQueries({
      exactDocs: [],
      onIlke: (_column, pattern) => patterns.push(pattern),
    });

    await getSupplierDeliveries("ws", "Shop_A%");
    expect(patterns).toEqual(["Shop\\_A\\%", "Shop\\_A\\%"]);
  });

  it("getSupplierDeliveries summary uses the full list and hydrates only the requested page", async () => {
    const docs = Array.from({ length: 5 }, (_, index) => {
      const day = String(5 - index).padStart(2, "0");
      return {
        id: `r-${index}`,
        workspace_id: "ws",
        warehouse_id: "wh",
        status: index === 4 ? "draft" : "posted",
        number: `GR-${index}`,
        comment: null,
        total: 10 * (index + 1),
        created_at: `2026-11-${day}T00:00:00Z`,
        received_at: `2026-11-${day}T00:00:00Z`,
        supplier_name: "Acme",
        deleted_at: null,
      };
    });
    // Sorted by received_at desc → r-0 .. r-4 (days 05..01)
    const hydrateIns: string[][] = [];
    mockSupplierDeliveryQueries({
      exactDocs: docs,
      onHydrateIn: (ids) => hydrateIns.push(ids),
    });

    const page = await getSupplierDeliveries("ws", "Acme", 1, 2);
    expect(page.totalCount).toBe(5);
    expect(page.totalCount).toBeGreaterThan(page.pageSize);
    expect(page.pageSize).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.rows.map((row) => row.id)).toEqual(["r-0", "r-1"]);
    // Draft (r-4, total 50) excluded from postedTotal: 10+20+30+40 = 100
    expect(page.postedTotal).toBe(100);
    expect(page.lastDeliveryAt).toBe("2026-11-05T00:00:00Z");
    expect(hydrateIns).toEqual([["r-0", "r-1"]]);

    hydrateIns.length = 0;
    const page2 = await getSupplierDeliveries("ws", "Acme", 2, 2);
    expect(page2.rows.map((row) => row.id)).toEqual(["r-2", "r-3"]);
    expect(page2.totalCount).toBe(5);
    expect(hydrateIns).toEqual([["r-2", "r-3"]]);
  });

  it("createAndPostGoodsReceipt creates a draft then posts via the same RPC", async () => {
    const insert = vi.fn();
    const result = chain({ data: { id: "r2" }, error: null });
    from.mockImplementation((table: string) => ({
      insert: (payload: unknown) => {
        insert(table, payload);
        return result;
      },
    }));
    rpc.mockResolvedValueOnce({ data: {}, error: null });

    await expect(
      createAndPostGoodsReceipt(
        { warehouseId: "wh", lines: [{ inventoryItemId: "i1", itemName: "Filter", quantity: 1, unitCost: 4 }] },
        "ws",
      ),
    ).resolves.toBe("r2");

    expect(insert.mock.calls.map(([table]) => table)).toEqual(["goods_receipts", "goods_receipt_lines"]);
    expect(rpc).toHaveBeenCalledWith("crm_post_goods_receipt", { p_receipt_id: "r2" });
  });
});
