import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOrder, mapOrderDeleteDbError } from "./apiOrders";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser: vi.fn() },
    from,
    rpc,
  },
}));

type QueryResult = { data: unknown; error: unknown; count?: number | null };

function limitQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => Promise.resolve(result);
  return chain;
}

function countQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  let eqCount = 0;
  chain.select = () => chain;
  chain.eq = () => {
    eqCount += 1;
    if (eqCount >= 2) return Promise.resolve(result);
    return chain;
  };
  return chain;
}

function deleteQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  chain.delete = () => chain;
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

describe("mapOrderDeleteDbError", () => {
  it("maps invoice RPC markers and FK violations to the invoice message", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:has_invoice" }).message).toMatch(/invoice/i);
    expect(
      mapOrderDeleteDbError({
        code: "23503",
        message: 'update or delete on table "orders" violates foreign key constraint "invoices_order_id_fkey" on table "invoices"',
      }).message,
    ).toMatch(/invoice/i);
  });

  it("maps authorization failures", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:not_member", code: "42501" }).message).toMatch(/permission/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:not_authenticated" }).message).toMatch(/permission/i);
  });

  it("maps missing RPC / payment FK to the manual SQL guidance message", () => {
    expect(mapOrderDeleteDbError({ code: "PGRST202", message: "function not found" }).message).toMatch(
      /delete_order_with_payments/i,
    );
    expect(
      mapOrderDeleteDbError({
        code: "23503",
        message: 'update or delete on table "orders" violates foreign key constraint "payments_order_id_fkey" on table "payments"',
      }).message,
    ).toMatch(/delete_order_with_payments|Nothing was deleted/i);
  });
});

describe("deleteOrder", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("blocks deletion when an invoice references the order and does not call the RPC", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [{ id: "inv-1" }], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/invoice|Nothing was deleted/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("orders");
    expect(from).not.toHaveBeenCalledWith("payments");
  });

  it("deletes an order with payments via the atomic RPC (no client payment DELETE)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [], error: null });
      if (table === "payments") return countQuery({ data: null, error: null, count: 2 });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: { order_id: "order-1", payments_deleted: 2 },
      error: null,
    });

    await expect(deleteOrder("order-1", "ws-1")).resolves.toEqual({ id: "order-1", paymentsDeleted: 2 });
    expect(rpc).toHaveBeenCalledWith("delete_order_with_payments", {
      p_workspace_id: "ws-1",
      p_order_id: "order-1",
    });
    // Must not issue a separate client-side payments delete (append-only).
    expect(from.mock.calls.filter((call) => call[0] === "orders")).toHaveLength(0);
  });

  it("maps authorization failures from the RPC without falling back to partial deletes", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [], error: null });
      if (table === "payments") return countQuery({ data: null, error: null, count: 1 });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "order_delete:not_member" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/permission/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("rolls back to a localized error when the RPC reports has_invoice (nothing deleted client-side)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [], error: null });
      if (table === "payments") return countQuery({ data: null, error: null, count: 0 });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_delete:has_invoice", code: "23514" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/invoice|Nothing was deleted/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("refuses orders with payments when the RPC is not installed (no partial client delete)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [], error: null });
      if (table === "payments") return countQuery({ data: null, error: null, count: 1 });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.delete_order_with_payments" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/delete_order_with_payments|Nothing was deleted/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("falls back to a plain order delete when the RPC is missing and there are no payments", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return limitQuery({ data: [], error: null });
      if (table === "payments") return countQuery({ data: null, error: null, count: 0 });
      if (table === "orders") return deleteQuery({ data: { id: "order-1" }, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });

    await expect(deleteOrder("order-1", "ws-1")).resolves.toEqual({ id: "order-1", paymentsDeleted: 0 });
    expect(from).toHaveBeenCalledWith("orders");
  });
});
