import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanRpcMessage,
  createGoodsReceipt,
  getGoodsReceipts,
  isMissingRpcError,
  mapWarehouseOpsError,
  postGoodsReceipt,
  toWarehouseOp,
} from "./apiWarehouseOps";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({ default: { from, rpc } }));

type Result = { data: unknown; error: { message?: string; code?: string } | null };

function chain(result: Result) {
  const self: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "in", "insert", "delete", "single"]) self[method] = () => self;
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
    expect(insert.mock.calls[0][1]).toMatchObject({ status: "draft", workspace_id: "ws", warehouse_id: "wh", total: 21 });
    expect(insert.mock.calls[1][1]).toEqual([
      expect.objectContaining({ goods_receipt_id: "r1", inventory_item_id: "i1", quantity: 2, unit_cost: 10.5, amount: 21 }),
    ]);
    expect(from).not.toHaveBeenCalledWith("warehouse_stock");
    expect(from).not.toHaveBeenCalledWith("inventory_items");
  });
});
