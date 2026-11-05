import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const getStatusDefinitionsByIds = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    from,
    rpc,
    auth: { getUser },
  },
}));

vi.mock("./apiStatusDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiStatusDefinitions")>();
  return {
    ...actual,
    getStatusDefinitionsByIds,
  };
});

vi.mock("./apiActivityLog", () => ({
  recordActivity: vi.fn(async () => undefined),
}));

vi.mock("./apiOrderEvents", () => ({
  recordStatusChangeEvents: vi.fn(async () => undefined),
}));

import {
  cancelOrder,
  closeOrder,
  isAuthenticatedWorkspaceOwner,
  setOrderLifecycleRegularCustomStatus,
  updateOrderStatus,
} from "./apiOrders";
import { moveOrderOnBoard } from "./apiOrderBoard";

function thenable(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.is = self;
  chain.neq = self;
  chain.update = self;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

describe("owner regular status on lifecycle orders", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getStatusDefinitionsByIds.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "owner-1" } }, error: null });
    getStatusDefinitionsByIds.mockResolvedValue(
      new Map([
        [
          "d-progress",
          {
            id: "d-progress",
            name: "In Progress",
            color: "#00f",
            entity: "order",
            semanticAction: "normal",
            systemStatus: "in-progress",
          },
        ],
      ]),
    );
  });

  it("isAuthenticatedWorkspaceOwner uses workspaces.owner_id", async () => {
    from.mockImplementation((table: string) => {
      expect(table).toBe("workspaces");
      return thenable({ data: { id: "ws-1" }, error: null });
    });
    await expect(isAuthenticatedWorkspaceOwner("ws-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("workspaces");
  });

  it("setOrderLifecycleRegularCustomStatus calls the owner RPC and preserves closed_at", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "closed",
        closed_at: "2026-11-01T12:00:00.000Z",
        custom_status_id: "d-progress",
      },
      error: null,
    });

    const result = await setOrderLifecycleRegularCustomStatus("order-1", "d-progress", "ws-1");
    expect(rpc).toHaveBeenCalledWith("set_order_lifecycle_regular_custom_status", {
      p_workspace_id: "ws-1",
      p_order_id: "order-1",
      p_custom_status_id: "d-progress",
    });
    expect(result).toEqual({
      status: "closed",
      customStatusId: "d-progress",
      customStatus: { name: "In Progress", color: "#00f" },
      closedAt: "2026-11-01T12:00:00.000Z",
    });
  });

  it("updateOrderStatus still rejects closed/cancelled system writes and blocks closed_at for direct updates", async () => {
    await expect(updateOrderStatus("order-1", "closed", "ws-1")).rejects.toThrow(/close/i);
    await expect(updateOrderStatus("order-1", "cancelled", "ws-1")).rejects.toThrow(/cancel/i);

    from.mockImplementation(() =>
      thenable({
        data: { id: "order-1", status: "closed", closed_at: "2026-11-01T12:00:00.000Z", custom_status_id: null },
        error: null,
      }),
    );
    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(/closed/i);
  });

  it("closeOrder invokes close_order_if_settled RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "closed",
        closed_at: "2026-11-01T12:00:00.000Z",
        custom_status_id: null,
        remaining: 0,
      },
      error: null,
    });
    await expect(closeOrder("order-1", "ws-1")).resolves.toMatchObject({
      ok: true,
      status: "closed",
      customStatusId: null,
    });
    expect(rpc).toHaveBeenCalledWith("close_order_if_settled", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
    });
  });

  it("cancelOrder invokes cancel_order RPC", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, status: "cancelled", closed_at: null, custom_status_id: "d-cancelled" },
      error: null,
    });
    await expect(cancelOrder("order-1", "ws-1")).resolves.toMatchObject({ status: "cancelled" });
    expect(rpc).toHaveBeenCalledWith("cancel_order", {
      p_order_id: "order-1",
      p_workspace_id: "ws-1",
    });
  });

  it("moveOrderOnBoard routes closed/cancelled selections through the owner lifecycle RPC", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "cancelled",
        closed_at: null,
        custom_status_id: "d-progress",
      },
      error: null,
    });
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        return thenable({ data: { custom_status_id: "d-old" }, error: null });
      }
      return thenable({ data: null, error: null });
    });

    const result = await moveOrderOnBoard(
      {
        orderId: "order-1",
        status: "cancelled",
        customStatusId: "d-progress",
        currentStatus: "cancelled",
      },
      "ws-1",
    );

    expect(rpc).toHaveBeenCalledWith("set_order_lifecycle_regular_custom_status", expect.any(Object));
    expect(result).toMatchObject({
      status: "cancelled",
      customStatusId: "d-progress",
    });
  });
});
