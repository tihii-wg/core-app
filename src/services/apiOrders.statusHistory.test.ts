import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const getStatusDefinitionsByIds = vi.hoisted(() => vi.fn());
const resolveCustomStatusForSystemStatus = vi.hoisted(() => vi.fn());
const recordActivity = vi.hoisted(() => vi.fn(async () => ({ recorded: true })));
const recordStatusChangeEvents = vi.hoisted(() => vi.fn(async () => undefined));
const recordOrderEvent = vi.hoisted(() => vi.fn(async () => ({ recorded: true })));

vi.mock("./supabase", () => ({
  default: {
    from,
    rpc,
    auth: {
      getUser,
      getSession: async () => {
        const result = await getUser();
        return {
          data: { session: result?.data?.user ? { user: result.data.user } : null },
          error: result?.error ?? null,
        };
      },
    },
  },
}));

vi.mock("./apiStatusDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiStatusDefinitions")>();
  return {
    ...actual,
    getStatusDefinitionsByIds,
    resolveCustomStatusForSystemStatus,
  };
});

vi.mock("./apiActivityLog", () => ({
  recordActivity,
}));

vi.mock("./apiOrderEvents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./apiOrderEvents")>();
  return {
    ...actual,
    recordStatusChangeEvents,
    recordOrderEvent,
  };
});

import { updateOrderStatus } from "./apiOrders";
import { moveOrderOnBoard } from "./apiOrderBoard";
import { closeOrder, cancelOrder } from "./apiOrders";
import { buildStatusEventInputs } from "./apiOrderEvents";

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

describe("order status history — single source of truth", () => {
  beforeEach(() => {
    from.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getStatusDefinitionsByIds.mockReset();
    resolveCustomStatusForSystemStatus.mockReset();
    recordActivity.mockClear();
    recordStatusChangeEvents.mockClear();
    recordOrderEvent.mockClear();

    getUser.mockResolvedValue({ data: { user: { id: "user-1", email: "a@b.c" } }, error: null });
    getStatusDefinitionsByIds.mockResolvedValue(
      new Map([
        ["d-new", { id: "d-new", name: "New", color: "#111", entity: "order", semanticAction: "normal", systemStatus: "new" }],
        [
          "d-progress",
          {
            id: "d-progress",
            name: "In Progress",
            color: "#222",
            entity: "order",
            semanticAction: "normal",
            systemStatus: "in-progress",
          },
        ],
      ]),
    );
    resolveCustomStatusForSystemStatus.mockResolvedValue({
      id: "d-progress",
      name: "In Progress",
      color: "#222",
    });
  });

  it("updateOrderStatus records activity once and never dual-writes order_events RPC", async () => {
    from.mockImplementation(() =>
      thenable({
        data: { id: "order-1", status: "new", closed_at: null, custom_status_id: "d-new" },
        error: null,
      }),
    );
    // First call: load existing; second: update returning rows
    let calls = 0;
    from.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return thenable({
          data: { id: "order-1", status: "new", closed_at: null, custom_status_id: "d-new" },
          error: null,
        });
      }
      return thenable({
        data: [{ id: "order-1", status: "in-progress", custom_status_id: "d-progress" }],
        error: null,
      });
    });

    await updateOrderStatus("order-1", "in-progress", "ws-1");

    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "order.status_changed",
        details: expect.objectContaining({ from: "new", to: "in-progress" }),
      }),
    );
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
    expect(recordOrderEvent).not.toHaveBeenCalled();
  });

  it("repeating the same status update does not create activity or feed RPC writes", async () => {
    from.mockImplementation(() =>
      thenable({
        data: { id: "order-1", status: "in-progress", closed_at: null, custom_status_id: "d-progress" },
        error: null,
      }),
    );
    resolveCustomStatusForSystemStatus.mockResolvedValue({
      id: "d-progress",
      name: "In Progress",
      color: "#222",
    });

    await updateOrderStatus("order-1", "in-progress", "ws-1");

    expect(recordActivity).not.toHaveBeenCalled();
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
  });

  it("failed status update does not record activity or feed events", async () => {
    from.mockImplementation(() =>
      thenable({
        data: { id: "order-1", status: "new", closed_at: null, custom_status_id: "d-new" },
        error: null,
      }),
    );
    let calls = 0;
    from.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return thenable({
          data: { id: "order-1", status: "new", closed_at: null, custom_status_id: "d-new" },
          error: null,
        });
      }
      return thenable({ data: null, error: { message: "permission denied", code: "42501" } });
    });

    await expect(updateOrderStatus("order-1", "in-progress", "ws-1")).rejects.toThrow(/permission/i);
    expect(recordActivity).not.toHaveBeenCalled();
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
  });

  it("Kanban moveOrderOnBoard uses one updateOrderStatus write and does not call recordStatusChangeEvents", async () => {
    let orderCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === "orders") {
        orderCalls += 1;
        // One preloaded SELECT in moveOrderOnBoard, then a single UPDATE in updateOrderStatus.
        if (orderCalls === 1) {
          return thenable({
            data: { status: "new", closed_at: null, custom_status_id: "d-new" },
            error: null,
          });
        }
        return thenable({
          data: [{ id: "order-1", status: "in-progress", custom_status_id: "d-progress" }],
          error: null,
        });
      }
      return thenable({ data: null, error: null });
    });

    await moveOrderOnBoard(
      {
        orderId: "order-1",
        status: "in-progress",
        customStatusId: "d-progress",
        currentStatus: "new",
      },
      "ws-1",
    );

    expect(orderCalls).toBe(2);
    expect(recordActivity).toHaveBeenCalledTimes(1);
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
    expect(recordOrderEvent).not.toHaveBeenCalled();
  });

  it("closeOrder and cancelOrder do not call app-layer status history writers", async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        status: "closed",
        closed_at: "2026-11-05T12:00:00.000Z",
        custom_status_id: null,
        remaining: 0,
      },
      error: null,
    });
    from.mockImplementation(() => thenable({ data: null, error: null }));

    await closeOrder("order-1", "ws-1");
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();

    recordStatusChangeEvents.mockClear();
    recordActivity.mockClear();
    rpc.mockResolvedValue({
      data: { ok: true, status: "cancelled", closed_at: null, custom_status_id: "d-cancelled" },
      error: null,
    });
    getStatusDefinitionsByIds.mockResolvedValue(
      new Map([["d-cancelled", { id: "d-cancelled", name: "Cancelled", color: null }]]),
    );

    await cancelOrder("order-1", "ws-1");
    expect(recordStatusChangeEvents).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();
  });

  it("buildStatusEventInputs never emits two status_changed rows for one transition", () => {
    expect(
      buildStatusEventInputs({
        orderId: "o",
        source: "app",
        from: "new",
        to: "in-progress",
        fromCustomStatusId: "a",
        toCustomStatusId: "b",
        fromCustomStatusName: "A",
        toCustomStatusName: "B",
      }),
    ).toHaveLength(1);
  });
});
