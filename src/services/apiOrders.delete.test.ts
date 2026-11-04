import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteOrder, mapOrderDeleteDbError } from "./apiOrders";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const storageRemove = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser: vi.fn() },
    from,
    rpc,
    storage: {
      from: () => ({
        remove: storageRemove,
      }),
    },
  },
}));

type QueryResult = { data: unknown; error: unknown; count?: number | null };

function invoiceQuery(result: QueryResult, onSelect?: (columns: string) => void) {
  const chain: Record<string, unknown> = {};
  chain.select = (columns: string) => {
    onSelect?.(columns);
    return chain;
  };
  // Final eq resolves.
  let eqs = 0;
  chain.eq = () => {
    eqs += 1;
    if (eqs >= 2) return Promise.resolve(result);
    return chain;
  };
  return chain;
}

function attachmentsQuery(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  let eqs = 0;
  chain.select = () => chain;
  chain.eq = () => {
    eqs += 1;
    if (eqs >= 2) return Promise.resolve(result);
    return chain;
  };
  return chain;
}

function cleanupDeleteQuery(result: QueryResult = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  chain.delete = () => chain;
  chain.eq = () => chain;
  chain.in = () => Promise.resolve(result);
  return chain;
}

describe("mapOrderDeleteDbError", () => {
  it("maps invoice RPC markers and FK violations to the invoice message", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:has_invoice" }).message).toMatch(/invoice/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:has_invoice:INV-1" }).message).toMatch(/INV-1/);
    expect(
      mapOrderDeleteDbError({
        code: "23503",
        message: 'update or delete on table "orders" violates foreign key constraint "invoices_order_id_fkey" on table "invoices"',
      }).message,
    ).toMatch(/invoice/i);
  });

  it("maps not_cancelled and active payment / refund blockers", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:not_cancelled" }).message).toMatch(/cancel/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:has_active_payment:p1" }).message).toMatch(/payment/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:has_refund:count=1" }).message).toMatch(/refund/i);
  });

  it("maps authorization failures", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:forbidden", code: "42501" }).message).toMatch(/permission/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:not_authenticated" }).message).toMatch(/permission/i);
  });

  it("maps stock return failures", () => {
    expect(mapOrderDeleteDbError({ message: "order_delete:issued_materials_on_closed_order" }).message).toMatch(/cancel/i);
    expect(mapOrderDeleteDbError({ message: "order_delete:materials_ledger_mismatch item=x" }).message).toMatch(
      /material|warehouse|return/i,
    );
  });
});

describe("deleteOrder", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    storageRemove.mockReset();
    storageRemove.mockResolvedValue({ data: null, error: null });
  });

  it("blocks deletion when an invoice references the order and does not call the RPC", async () => {
    let invoiceSelect = "";
    from.mockImplementation((table: string) => {
      if (table === "invoices") {
        return invoiceQuery({ data: [{ id: "inv-1", number: "INV-9" }], error: null }, (columns) => {
          invoiceSelect = columns;
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/INV-9|invoice/i);
    expect(rpc).not.toHaveBeenCalled();
    expect(invoiceSelect).toBe("id, number");
    expect(invoiceSelect).not.toMatch(/invoice_number/);
  });

  it("allows the RPC after invoices are removed (annul / erroneous-delete workflow)", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        payments_deleted: 0,
        materials_returned: [],
        attachment_storage_paths: [],
        storage_cleanup_pending: false,
      },
      error: null,
    });

    await expect(deleteOrder("order-1", "ws-1")).resolves.toMatchObject({
      id: "order-1",
      paymentsDeleted: 0,
      storageCleanupComplete: true,
    });
    expect(rpc).toHaveBeenCalledWith("delete_order_with_payments", {
      p_workspace_id: "ws-1",
      p_order_id: "order-1",
    });
  });

  it("leaves the order untouched when the RPC reports an active payment", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_delete:has_active_payment:pay-keep", code: "23514" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/pay-keep|payment/i);
    expect(from).not.toHaveBeenCalledWith("orders");
    expect(from).not.toHaveBeenCalledWith("payments");
  });

  it("requires the protected RPC and refuses client-side fallback deletes", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.delete_order_with_payments" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/delete_order_with_payments|safe_cancelled_order_delete/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("maps not_cancelled from the RPC without deleting anything client-side", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_delete:not_cancelled", code: "P0001" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/cancel/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });

  it("maps active payment blockers from the RPC", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_delete:has_active_payment:pay-1", code: "23514" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/pay-1|payment/i);
  });

  it("maps refund retention blockers from the RPC", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_delete:has_refund:count=2", code: "23514" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/refund/i);
  });

  it("deletes via RPC then cleans Storage paths before reporting success", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") {
        return attachmentsQuery({ data: [{ storage_path: "ws-1/order-1/a.jpg" }], error: null });
      }
      if (table === "order_attachment_cleanup") return cleanupDeleteQuery();
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        payments_deleted: 1,
        materials_returned: [{ warehouse_id: "wh-1", idempotency_key: "order_delete:order-1:wh-1" }],
        attachment_storage_paths: ["ws-1/order-1/a.jpg"],
        storage_cleanup_pending: true,
      },
      error: null,
    });

    await expect(deleteOrder("order-1", "ws-1")).resolves.toEqual({
      id: "order-1",
      paymentsDeleted: 1,
      materialsReturned: [{ warehouse_id: "wh-1", idempotency_key: "order_delete:order-1:wh-1" }],
      attachmentStoragePaths: ["ws-1/order-1/a.jpg"],
      storageCleanupComplete: true,
    });
    expect(rpc).toHaveBeenCalledWith("delete_order_with_payments", {
      p_workspace_id: "ws-1",
      p_order_id: "order-1",
    });
    expect(storageRemove).toHaveBeenCalledWith(["ws-1/order-1/a.jpg"]);
  });

  it("does not report success when Storage cleanup fails after DB delete", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [{ storage_path: "ws-1/order-1/a.jpg" }], error: null });
      if (table === "order_attachment_cleanup") return cleanupDeleteQuery();
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: {
        order_id: "order-1",
        payments_deleted: 0,
        materials_returned: [],
        attachment_storage_paths: ["ws-1/order-1/a.jpg"],
      },
      error: null,
    });
    storageRemove.mockResolvedValue({ data: null, error: { message: "storage down" } });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/Storage|attachment|cleanup/i);
  });

  it("maps authorization failures from the RPC without falling back to partial deletes", async () => {
    from.mockImplementation((table: string) => {
      if (table === "invoices") return invoiceQuery({ data: [], error: null });
      if (table === "order_attachments") return attachmentsQuery({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "order_delete:forbidden" },
    });

    await expect(deleteOrder("order-1", "ws-1")).rejects.toThrow(/permission/i);
    expect(from).not.toHaveBeenCalledWith("orders");
  });
});
