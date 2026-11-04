import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelOrder } from "./apiOrders";

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
});
