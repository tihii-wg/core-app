import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOrder, cancelOrderWithPaymentVoid } from "./apiOrders";
import { MissingRpcError } from "./missingRpc";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { getUser: vi.fn() },
    from,
    rpc,
  },
}));

vi.mock("./apiStatusDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiStatusDefinitions")>();
  return {
    ...actual,
    getStatusDefinitionsByIds: vi.fn(async () => new Map([["def-cancel", { id: "def-cancel", name: "Cancelled", color: "#aaa" }]])),
  };
});

function orderReadQuery(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  return chain;
}

describe("cancelOrder", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("persists cancelled and returns system status cancelled with aligned custom status", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, idempotent: false, order_id: "order-1", custom_status_id: "def-cancel", closed_at: null },
      error: null,
    });

    await expect(cancelOrder("order-1", "ws-1")).resolves.toMatchObject({
      status: "cancelled",
      customStatusId: "def-cancel",
      customStatus: { name: "Cancelled", color: "#aaa" },
      idempotent: false,
    });
    expect(rpc).toHaveBeenCalledWith("cancel_order", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
    });
  });

  it("re-reads the order when the RPC omits custom_status_id and requires status=cancelled", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, idempotent: false, order_id: "order-1", closed_at: null },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return orderReadQuery({ data: { status: "cancelled", custom_status_id: null }, error: null });
      }
      throw new Error(`unexpected ${table}`);
    });

    await expect(cancelOrder("order-1", "ws-1")).resolves.toMatchObject({
      status: "cancelled",
      customStatusId: null,
      customStatus: null,
    });
  });

  it("fails without success when cancellation did not persist on the order row", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, idempotent: false, order_id: "order-1", closed_at: null },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return orderReadQuery({ data: { status: "in-progress", custom_status_id: "def-progress" }, error: null });
      }
      throw new Error(`unexpected ${table}`);
    });

    await expect(cancelOrder("order-1", "ws-1")).rejects.toThrow(/not persist|cancelled/i);
  });

  it("maps RPC failures without claiming success", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_lifecycle:cannot_cancel_closed", code: "P0001" },
    });
    await expect(cancelOrder("order-1", "ws-1")).rejects.toThrow(/closed/i);
  });

  it("rejects unauthorized closed-order cancel RPC errors", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_lifecycle:forbidden_cancel_closed", code: "42501" },
    });
    await expect(cancelOrder("order-1", "ws-1")).rejects.toThrow(/permission|closed/i);
  });
});

describe("cancelOrderWithPaymentVoid", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
  });

  it("calls the combined RPC and returns void counts", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        idempotent: false,
        order_id: "order-1",
        custom_status_id: "def-cancel",
        closed_at: null,
        voided_count: 2,
        voided_total: 120,
        skipped: [{ payment_id: "pay-r", amount: 10, reason: "has_refund" }],
      },
      error: null,
    });

    await expect(
      cancelOrderWithPaymentVoid("order-1", "ws-1", { voidPayments: true, reason: "Client cancelled" }),
    ).resolves.toMatchObject({
      status: "cancelled",
      customStatusId: "def-cancel",
      voidedCount: 2,
      voidedTotal: 120,
      skipped: [{ paymentId: "pay-r", amount: 10, reason: "has_refund" }],
    });
    expect(rpc).toHaveBeenCalledWith("crm_cancel_order_with_payment_void", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
      p_void_payments: true,
      p_reason: "Client cancelled",
    });
  });

  it("maps order_payment_void:forbidden", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "order_payment_void:forbidden", code: "42501" },
    });
    await expect(
      cancelOrderWithPaymentVoid("order-1", "ws-1", { voidPayments: true, reason: "Cancelled order" }),
    ).rejects.toThrow(/permission|void/i);
  });

  it("falls back to cancel_order when the combined RPC is missing", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "crm_cancel_order_with_payment_void") {
        return {
          data: null,
          error: { code: "PGRST202", message: "Could not find the function crm_cancel_order_with_payment_void" },
        };
      }
      if (name === "cancel_order") {
        return {
          data: { ok: true, idempotent: false, order_id: "order-1", custom_status_id: "def-cancel", closed_at: null },
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${name}`);
    });

    await expect(
      cancelOrderWithPaymentVoid("order-1", "ws-1", { voidPayments: true, reason: "Cancelled order" }),
    ).resolves.toMatchObject({
      status: "cancelled",
      voidedCount: 0,
      voidUnavailable: true,
    });
  });

  it("propagates MissingRpcError when cancel_order fallback is also missing", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function crm_cancel_order_with_payment_void" },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function cancel_order" },
      });

    await expect(
      cancelOrderWithPaymentVoid("order-1", "ws-1", { voidPayments: false }),
    ).rejects.toBeInstanceOf(MissingRpcError);
  });
});
